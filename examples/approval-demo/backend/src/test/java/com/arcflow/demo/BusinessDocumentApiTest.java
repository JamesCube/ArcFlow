package com.arcflow.demo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"APPROVAL_ALICE_PASSWORD=test-alice-password", "APPROVAL_BOB_PASSWORD=test-bob-password", "APPROVAL_CAROL_PASSWORD=test-carol-password"})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class BusinessDocumentApiTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @DynamicPropertySource static void data(DynamicPropertyRegistry registry) throws Exception {
        var file = Files.createTempDirectory("business-api-test-").resolve("state.json");
        registry.add("approval.data-file", file::toString);
    }

    @Test void procurementUsesRealApprovalLifecycleAndReturnsCurrentStateOnReplay() throws Exception {
        ObjectNode input = procurement();
        JsonNode created = result(submit("alice", input, "procurement:001").andExpect(status().isCreated()));
        assertEquals("alice", created.path("applicantId").textValue());
        assertEquals("procurement", created.path("business").path("type").textValue());
        assertEquals("PO-001", created.path("business").path("businessId").textValue());
        assertEquals("Laptop", created.path("business").path("item").textValue());
        assertEquals(0, created.path("days").intValue());
        assertEquals(2, created.path("business").path("quantity").intValue());
        assertEquals(0, created.path("business").path("unitPrice").decimalValue().compareTo(new java.math.BigDecimal("1299.50")));
        assertEquals("PENDING", created.path("status").textValue());
        assertEquals("manager", created.path("currentStepId").textValue());
        assertEquals(1, created.path("history").size());
        assertFalse(created.toString().contains("procurement:001"));
        assertEquals(created, list("bob").get(0));
        assertEquals(0, list("carol").size());
        ObjectNode normalized = input.deepCopy();
        business(normalized).put("title", "  Equipment  ").put("reason", "  New team member  ")
            .put("item", "  Laptop  ").put("unitPrice", new java.math.BigDecimal("1299.5"));
        assertEquals(created, result(submit("alice", normalized, "procurement:001").andExpect(status().isCreated())));

        decide("carol", created, "APPROVE").andExpect(status().isNotFound());
        decide("alice", created, "APPROVE").andExpect(status().isForbidden());
        // Publishing the same configured route at a new version never replaces the instance snapshot.
        ObjectNode proposed = (ObjectNode) created.path("definition").deepCopy();
        ((ObjectNode) proposed.path("nodes").get(1)).put("assigneeId", "carol");
        ObjectNode publication = mapper.createObjectNode().put("expectedVersion", 1);
        publication.set("definition", proposed);
        result(mvc.perform(write("/api/process", "alice").content(publication.toString())).andExpect(status().isOk()));
        assertEquals(created, result(submit("alice", input, "procurement:001").andExpect(status().isCreated())));
        submit("alice", input, null).andExpect(status().isConflict());
        JsonNode approved = result(decide("bob", created, "APPROVE").andExpect(status().isOk()));
        assertEquals("APPROVED", approved.path("status").textValue());
        assertTrue(approved.path("currentStepId").isNull());
        assertEquals(2, approved.path("history").size());
        assertEquals(created.path("definition"), approved.path("definition"));
        assertEquals(created.path("business"), approved.path("business"));
        assertEquals(approved, result(decide("bob", created, "APPROVE").andExpect(status().isOk())));
        decide("bob", created, "REJECT").andExpect(status().isConflict());
        assertEquals(approved, result(submit("alice", input, "procurement:001").andExpect(status().isCreated())));
        assertEquals(1, list("alice").size());
    }

    @Test void procurementInboxReturnsExactBusinessSnapshotAndCurrentHandledStateOnRetry() throws Exception {
        ObjectNode input = procurement();
        JsonNode request = result(submit("alice", input, "procurement-inbox").andExpect(status().isCreated()));
        JsonNode pending = result(mvc.perform(get("/api/requests/inbox?limit=1").with(httpBasic("bob", "test-bob-password")))
            .andExpect(status().isOk()));
        assertEquals(request, pending.path("items").get(0));
        assertEquals(input.path("business"), pending.path("items").get(0).path("business"));
        JsonNode approved = result(decide("bob", request, "APPROVE").andExpect(status().isOk()));
        assertEquals(approved, result(submit("alice", input, "procurement-inbox").andExpect(status().isCreated())));
        JsonNode handled = result(mvc.perform(get("/api/requests/inbox?box=HANDLED&status=APPROVED&processVersion=1")
            .with(httpBasic("bob", "test-bob-password"))).andExpect(status().isOk()));
        assertEquals(approved, handled.path("items").get(0));
        assertEquals(request.path("business"), handled.path("items").get(0).path("business"));
        assertTrue(handled.path("nextCursor").isNull());
        mvc.perform(get("/api/requests/inbox").with(httpBasic("bob", "test-bob-password")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items").isEmpty());
        mvc.perform(get("/api/requests/inbox?box=HANDLED").with(httpBasic("carol", "test-carol-password")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items").isEmpty());
    }

    @Test void typedLeaveAndLegacyLeavePreserveTheirDistinctContracts() throws Exception {
        ObjectNode leave = leave();
        JsonNode typed = result(submit("alice", leave, "typed-leave").andExpect(status().isCreated()));
        assertEquals(leave.path("business"), typed.path("business"));
        assertEquals(2, typed.path("days").intValue());
        ObjectNode oldInput = legacy();
        JsonNode old = result(mvc.perform(write("/api/requests", "alice").header("Idempotency-Key", "old-leave")
            .content(oldInput.toString())).andExpect(status().isCreated()));
        Set<String> expected = Set.of("id", "title", "reason", "days", "applicantId", "approverId", "status", "createdAt",
            "updatedAt", "decision", "comment", "processId", "processVersion", "history", "definition", "currentStepId");
        var fields = new HashSet<String>(); old.fieldNames().forEachRemaining(fields::add);
        assertEquals(expected, fields);
        JsonNode rejected = result(decide("bob", old, "REJECT").andExpect(status().isOk()));
        assertFalse(rejected.has("business"));
        assertEquals("REJECTED", rejected.path("status").textValue());
        assertEquals(rejected, result(mvc.perform(write("/api/requests", "alice").header("Idempotency-Key", "old-leave")
            .content(oldInput.toString())).andExpect(status().isCreated())));
        mvc.perform(write("/api/requests", "alice").content(leave.toString())).andExpect(status().isBadRequest());
        oldInput.set("business", leave.path("business"));
        mvc.perform(write("/api/requests", "alice").content(oldInput.toString())).andExpect(status().isBadRequest());
        submit("alice", legacy(), null).andExpect(status().isBadRequest());
        assertEquals(2, list("alice").size());
    }

    @Test void submissionKeyIntentIncludesTypeIdentityAndEveryBusinessField() throws Exception {
        ObjectNode original = procurement();
        JsonNode created = result(submit("alice", original, "shared-intent").andExpect(status().isCreated()));
        for (String field : List.of("businessId", "title", "reason", "item", "currency")) {
            ObjectNode changed = original.deepCopy();
            business(changed).put(field, field.equals("currency") ? "CNY" : "Changed");
            submit("alice", changed, "shared-intent").andExpect(status().isConflict());
        }
        for (String field : List.of("quantity", "unitPrice")) {
            ObjectNode changed = original.deepCopy(); business(changed).put(field, 3);
            submit("alice", changed, "shared-intent").andExpect(status().isConflict());
        }
        submit("alice", original.deepCopy().put("processVersion", 2), "shared-intent").andExpect(status().isConflict());
        submit("alice", leave(), "shared-intent").andExpect(status().isConflict());
        mvc.perform(write("/api/requests", "alice").header("Idempotency-Key", "shared-intent")
            .content(legacy().toString())).andExpect(status().isConflict());
        mvc.perform(write("/api/requests", "alice").header("Idempotency-Key", "legacy-intent")
            .content(legacy().toString())).andExpect(status().isCreated());
        submit("alice", leave(), "legacy-intent").andExpect(status().isConflict());
        JsonNode other = result(submit("carol", original, "shared-intent").andExpect(status().isCreated()));
        assertNotEquals(created.path("id"), other.path("id"));
        assertEquals("carol", other.path("applicantId").textValue());
        assertEquals(other, list("carol").get(0));
        assertEquals(2, list("alice").size());
    }

    @Test void documentEndpointEnforcesPrincipalHeadersAndNonIdempotentCompatibility() throws Exception {
        ObjectNode input = procurement();
        mvc.perform(post("/api/documents").header("X-Arcflow-Client", "approval-demo").contentType("application/json")
            .content(input.toString())).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/documents").with(httpBasic("alice", "test-alice-password")).contentType("application/json")
            .content(input.toString())).andExpect(status().isForbidden());
        mvc.perform(write("/api/documents", "alice").header("Origin", "https://evil.example").content(input.toString()))
            .andExpect(status().isForbidden());
        mvc.perform(write("/api/documents", "alice").contentType("text/plain").content(input.toString()))
            .andExpect(status().isUnsupportedMediaType());
        submit("bob", input, "assigned-user").andExpect(status().isBadRequest());
        for (String key : List.of("", " ", "a,b", "bad/key", ".invalid", "a".repeat(129)))
            submit("alice", input, key).andExpect(status().isBadRequest());
        mvc.perform(write("/api/documents", "alice").header("Idempotency-Key", "first", "second")
            .content(input.toString())).andExpect(status().isBadRequest());
        assertEquals(0, list("alice").size());
        JsonNode first = result(submit("alice", input, null).andExpect(status().isCreated()));
        JsonNode second = result(submit("alice", input, null).andExpect(status().isCreated()));
        assertNotEquals(first.path("id"), second.path("id"));
        assertEquals(2, list("alice").size());
    }

    @Test void strictDocumentBoundaryRejectsMalformedTypesMissingFieldsAndNumericCoercion() throws Exception {
        ObjectNode valid = procurement();
        var invalid = new ArrayList<String>();
        for (String raw : List.of("null", "[]", "1", "true", "\"document\"", "{", "{}", valid + " {}")) invalid.add(raw);
        for (String field : List.of("business", "processVersion")) {
            ObjectNode missing = valid.deepCopy(); missing.remove(field); invalid.add(missing.toString());
        }
        for (String value : List.of("null", "0", "-1", "1.5", "\"1\"", "true", "2147483648", "[]", "{}")) {
            ObjectNode changed = valid.deepCopy(); changed.set("processVersion", mapper.readTree(value)); invalid.add(changed.toString());
        }
        for (String value : List.of("null", "[]", "1", "true", "\"procurement\"", "{}")) {
            ObjectNode changed = valid.deepCopy(); changed.set("business", mapper.readTree(value)); invalid.add(changed.toString());
        }
        for (String field : List.of("type", "businessId", "title", "reason", "item", "quantity", "unitPrice", "currency")) {
            ObjectNode missing = valid.deepCopy(); business(missing).remove(field); invalid.add(missing.toString());
            ObjectNode nil = valid.deepCopy(); business(nil).putNull(field); invalid.add(nil.toString());
        }
        for (String field : List.of("businessId", "title", "reason", "item", "currency")) {
            for (String value : List.of("42", "1.5", "true", "[]", "{}", "\"\"", "\" \"")) {
                ObjectNode changed = valid.deepCopy(); business(changed).set(field, mapper.readTree(value)); invalid.add(changed.toString());
            }
        }
        for (String value : List.of("\"expense\"", "\"Procurement\"", "\"\"", "42", "true", "[]", "{}")) {
            ObjectNode changed = valid.deepCopy(); business(changed).set("type", mapper.readTree(value)); invalid.add(changed.toString());
        }
        for (String value : List.of("0", "-1", "100001", "2147483648", "1.5", "\"2\"", "true", "[]", "{}")) {
            ObjectNode changed = valid.deepCopy(); business(changed).set("quantity", mapper.readTree(value)); invalid.add(changed.toString());
        }
        for (String value : List.of("0", "-1", "1.001", "1000000000.01", "1e100", "\"1299.50\"", "\"NaN\"", "true", "[]", "{}")) {
            ObjectNode changed = valid.deepCopy(); business(changed).set("unitPrice", mapper.readTree(value)); invalid.add(changed.toString());
        }
        for (String field : List.of("applicantId", "approverId", "idempotencyKey", "processId", "days")) {
            invalid.add(valid.deepCopy().put(field, "forged").toString());
            ObjectNode changed = valid.deepCopy(); business(changed).put(field, "forged"); invalid.add(changed.toString());
        }
        invalid.add(valid.deepCopy().put("business", "procurement").toString());
        ObjectNode yen = valid.deepCopy(); business(yen).put("currency", "JPY"); invalid.add(yen.toString());
        invalid.add(valid.toString().replace("\"quantity\":2", "\"quantity\":2,\"quantity\":3"));
        invalid.add(valid.toString().replace("\"type\":\"procurement\"", "\"type\":\"procurement\",\"type\":\"leave\""));
        for (String value : List.of("null", "0", "366", "1.5", "\"2\"", "2147483648")) {
            ObjectNode changed = leave(); business(changed).set("days", mapper.readTree(value)); invalid.add(changed.toString());
        }
        ObjectNode missingDays = leave(); business(missingDays).remove("days"); invalid.add(missingDays.toString());
        for (String body : invalid) {
            var response = mvc.perform(write("/api/documents", "alice").header("Idempotency-Key", "invalid-then-correct")
                .content(body)).andReturn().getResponse();
            assertEquals(400, response.getStatus(), body + ": " + response.getContentAsString());
            assertTrue(mapper.readTree(response.getContentAsString()).path("message").isTextual());
        }
        assertEquals(0, list("alice").size());
        submit("alice", valid, "invalid-then-correct").andExpect(status().isCreated());
        assertEquals(1, list("alice").size());
    }

    private ObjectNode procurement() {
        ObjectNode input = mapper.createObjectNode().put("processVersion", 1);
        input.putObject("business").put("type", "procurement").put("businessId", "PO-001")
            .put("title", "Equipment").put("reason", "New team member").put("item", "Laptop")
            .put("quantity", 2).put("unitPrice", new java.math.BigDecimal("1299.50")).put("currency", "USD");
        return input;
    }
    private ObjectNode leave() {
        ObjectNode input = mapper.createObjectNode().put("processVersion", 1);
        input.putObject("business").put("type", "leave").put("businessId", "LEAVE-001")
            .put("title", "Leave").put("reason", "Rest").put("days", 2);
        return input;
    }
    private ObjectNode legacy() { return mapper.createObjectNode().put("title", "Leave").put("reason", "Rest").put("days", 2).put("processVersion", 1); }
    private static ObjectNode business(ObjectNode input) { return (ObjectNode) input.get("business"); }
    private MockHttpServletRequestBuilder write(String path, String actor) {
        return post(path).with(httpBasic(actor, "test-" + actor + "-password"))
            .header("X-Arcflow-Client", "approval-demo").contentType("application/json");
    }
    private ResultActions submit(String actor, ObjectNode input, String key) throws Exception {
        var request = write("/api/documents", actor).content(input.toString());
        if (key != null) request.header("Idempotency-Key", key);
        return mvc.perform(request);
    }
    private ResultActions decide(String actor, JsonNode request, String action) throws Exception {
        return mvc.perform(write("/api/requests/" + request.path("id").textValue() + "/decisions", actor)
            .content(mapper.createObjectNode().put("stepId", "manager").put("decision", action).put("comment", "Reviewed").toString()));
    }
    private JsonNode list(String actor) throws Exception {
        return result(mvc.perform(get("/api/requests").with(httpBasic(actor, "test-" + actor + "-password"))).andExpect(status().isOk()));
    }
    private JsonNode result(ResultActions result) throws Exception { return mapper.readTree(result.andReturn().getResponse().getContentAsString()); }
}
