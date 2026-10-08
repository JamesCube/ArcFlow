package com.arcflow.demo;

import com.arcflow.approval.ApprovalService;
import com.arcflow.approval.ProcessDefinition;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerAdapter;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"APPROVAL_ALICE_PASSWORD=test-alice-password", "APPROVAL_BOB_PASSWORD=test-bob-password", "APPROVAL_CAROL_PASSWORD=test-carol-password"})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class ApprovalApiTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired RequestMappingHandlerAdapter handlerAdapter;

    @DynamicPropertySource static void data(DynamicPropertyRegistry registry) throws Exception {
        var file = Files.createTempDirectory("approval-api-test-").resolve("state.json");
        registry.add("approval.data-file", file::toString);
    }

    @Test void httpJsonUsesTheSharedStrictJackson2Mapper() {
        // A Jackson 2 bean alone is insufficient: Boot 4 defaults to Jackson 3 for MVC.
        // Verify the converter selected for every body family, not just mapper presence.
        for (Class<?> body : List.of(ApprovalController.Submission.class,
                ApprovalController.DocumentSubmission.class, ApprovalController.Publication.class,
                ApprovalController.Decision.class, QuoteDiscountController.Submission.class,
                QuoteDiscountController.Decision.class)) {
            var reader = handlerAdapter.getMessageConverters().stream()
                .filter(converter -> converter.canRead(body, MediaType.APPLICATION_JSON)).findFirst().orElseThrow();
            var jackson = assertInstanceOf(MappingJackson2HttpMessageConverter.class, reader);
            assertSame(mapper, jackson.getObjectMapper());
        }
        var writer = handlerAdapter.getMessageConverters().stream()
            .filter(converter -> converter.canWrite(ApprovalService.Request.class, MediaType.APPLICATION_JSON))
            .findFirst().orElseThrow();
        assertSame(mapper, assertInstanceOf(MappingJackson2HttpMessageConverter.class, writer).getObjectMapper());
        assertTrue(mapper.isEnabled(com.fasterxml.jackson.databind.DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS));
        assertTrue(mapper.isEnabled(com.fasterxml.jackson.core.StreamReadFeature.STRICT_DUPLICATE_DETECTION.mappedFeature()));
        assertThrows(com.fasterxml.jackson.core.JsonProcessingException.class,
            () -> mapper.readValue("{\"title\":42,\"reason\":\"test\",\"days\":1,\"processVersion\":1}", ApprovalController.Submission.class));
    }

    @Test void authenticationAndBrowserBoundariesApplyToEveryApi() throws Exception {
        for (String path : List.of("/api/me", "/api/people", "/api/process", "/api/requests", "/api/requests/inbox")) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.message").isString()).andExpect(header().doesNotExist("WWW-Authenticate"))
                .andExpect(header().doesNotExist("Set-Cookie"));
        }
        mvc.perform(get("/api/me").with(httpBasic("alice", "wrong"))).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/me").with(httpBasic("unknown", "test-alice-password"))).andExpect(status().isUnauthorized());
        for (String user : List.of("alice", "bob", "carol")) {
            mvc.perform(authenticated(get("/api/me"), user)).andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(user)).andExpect(header().doesNotExist("Set-Cookie"));
        }
        mvc.perform(get("/api/me")).andExpect(status().isUnauthorized()); // Basic authentication is not a session.
        mvc.perform(authenticated(get("/not-an-api"), "alice")).andExpect(status().isForbidden());
        mvc.perform(authenticated(get("/api/me"), "alice").header("Origin", "https://evil.example"))
            .andExpect(status().isForbidden());
        mvc.perform(authenticated(get("/api/process"), "alice").header("Sec-Fetch-Site", "cross-site"))
            .andExpect(status().isForbidden());

        for (String path : List.of("/api/process", "/api/requests", "/api/documents", "/api/requests/missing/decisions")) {
            mvc.perform(post(path).header("X-Arcflow-Client", "approval-demo").contentType("application/json").content("{}"))
                .andExpect(status().isUnauthorized());
            mvc.perform(authenticated(post(path), "alice").contentType("application/json").content("{}"))
                .andExpect(status().isForbidden());
            mvc.perform(authenticated(post(path), "alice").header("X-Arcflow-Client", "wrong").contentType("application/json").content("{}"))
                .andExpect(status().isForbidden());
            mvc.perform(write(path, "alice").header("Origin", "https://evil.example").content("{}"))
                .andExpect(status().isForbidden());
            mvc.perform(write(path, "alice").header("Origin", "null").content("{}"))
                .andExpect(status().isForbidden());
            mvc.perform(write(path, "alice").header("Origin", "http://localhost:5173").header("Sec-Fetch-Site", "cross-site").content("{}"))
                .andExpect(status().isForbidden());
        }
        mvc.perform(authenticated(post("/api/requests"), "alice").header("X-Arcflow-Client", "approval-demo")
                .contentType("text/plain").content(submission(1).toString())).andExpect(status().isUnsupportedMediaType());
        assertEquals(0, getJson("/api/requests", "alice").size());
        mvc.perform(write("/api/requests", "alice").header("Origin", "http://localhost:5173")
                .header("Sec-Fetch-Site", "same-origin").content(submission(1).toString()))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.applicantId").value("alice"));
    }

    @Test void initialContractHasOrderedFixedEndpointsAndKnownPeople() throws Exception {
        JsonNode process = getJson("/api/process", "alice");
        assertEquals(definition(1, "bob"), process);
        assertEquals(2, process.path("schemaVersion").intValue());
        assertEquals(List.of("start", "manager", "end"), nodeIds(process));
        assertEquals(5, process.size());
        JsonNode people = getJson("/api/people", "alice");
        assertEquals(3, people.size());
        assertEquals(List.of("alice", "bob", "carol"),
            mapper.convertValue(people.findValues("id"), mapper.getTypeFactory().constructCollectionType(List.class, String.class)));
        for (JsonNode person : people) assertEquals(2, person.size());
    }

    @Test void onlyAliceCanPublishAndPublishingUsesOptimisticVersions() throws Exception {
        ObjectNode proposal = definition(1, "carol", "bob");
        proposal.put("name", "Two stage leave approval");
        for (String user : List.of("bob", "carol")) {
            postJson("/api/process", user, publication(1, proposal)).andExpect(status().isForbidden());
            mvc.perform(write("/api/process", user).content("{")).andExpect(status().isForbidden());
            mvc.perform(write("/api/process", user).content("{}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.message").value("Forbidden"));
        }
        assertEquals(definition(1, "bob"), getJson("/api/process", "alice"));
        JsonNode published = response(postJson("/api/process", "alice", publication(1, proposal))
            .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(2)));
        assertEquals(proposal.path("nodes"), published.path("nodes"));
        assertEquals("Two stage leave approval", published.path("name").textValue());
        postJson("/api/process", "alice", publication(1, proposal)).andExpect(status().isConflict());
        postJson("/api/process", "alice", publication(2, definition(1, "bob"))).andExpect(status().isConflict());
        postJson("/api/process", "alice", publication(2, definition(3, "bob"))).andExpect(status().isConflict());
        assertEquals(published, getJson("/api/process", "bob"));
        JsonNode next = response(postJson("/api/process", "alice", publication(2, definition(2, "bob")))
            .andExpect(status().isOk()));
        assertEquals(3, next.path("version").intValue());
    }

    @Test void processPublicationRejectsUnknownFieldsScalarCoercionAndIncompleteJson() throws Exception {
        List<InvalidBody> invalid = new ArrayList<>();
        ObjectNode valid = publication(1, definition(1, "bob"));
        for (String field : List.of("expectedVersion", "definition"))
            invalid.add(changed("missing " + field, valid, n -> n.remove(field)));
        for (String value : List.of("null", "0", "-1", "1.5", "\"1\"", "true", "[]", "{}"))
            invalid.add(changed("expectedVersion " + value, valid, n -> n.set("expectedVersion", json(value))));
        invalid.add(changed("unknown publication field", valid, n -> n.put("actorId", "alice")));
        for (String value : List.of("null", "1", "\"definition\"", "true", "[]"))
            invalid.add(changed("definition " + value, valid, n -> n.set("definition", json(value))));
        for (String field : List.of("schemaVersion", "id", "version", "name", "nodes"))
            invalid.add(changed("missing definition " + field, valid, n -> object(n, "definition").remove(field)));
        invalid.add(changed("unknown definition field", valid, n -> object(n, "definition").put("layout", "forged")));
        for (String field : List.of("schemaVersion", "version")) {
            for (String value : List.of("null", "1.5", "\"2\"", "true"))
                invalid.add(changed(field + " scalar " + value, valid, n -> object(n, "definition").set(field, json(value))));
        }
        for (String field : List.of("id", "name")) {
            for (String value : List.of("42", "1.5", "true", "[]", "{}"))
                invalid.add(changed(field + " scalar " + value, valid, n -> object(n, "definition").set(field, json(value))));
        }
        for (String value : List.of("null", "{}", "\"nodes\"", "1", "true", "[null]"))
            invalid.add(changed("nodes shape " + value, valid, n -> object(n, "definition").set("nodes", json(value))));
        for (String field : List.of("id", "type", "name", "assigneeId")) {
            invalid.add(changed("missing approval " + field, valid, n -> node(object(n, "definition"), 1).remove(field)));
            for (String value : List.of("42", "1.5", "true", "[]", "{}"))
                invalid.add(changed("node " + field + " scalar " + value, valid,
                    n -> node(object(n, "definition"), 1).set(field, json(value))));
        }
        invalid.add(changed("missing nullable start assignee", valid, n -> node(object(n, "definition"), 0).remove("assigneeId")));
        invalid.add(changed("unknown node field", valid, n -> node(object(n, "definition"), 1).put("condition", "always")));
        invalid.add(new InvalidBody("duplicate expectedVersion", valid.toString().replace("\"expectedVersion\":1", "\"expectedVersion\":1,\"expectedVersion\":1")));
        invalid.add(new InvalidBody("duplicate nested name", valid.toString().replace("\"name\":\"Leave approval\"", "\"name\":\"Leave approval\",\"name\":\"Forged\"")));
        invalid.add(new InvalidBody("trailing object", valid + " {}"));
        for (String body : List.of("null", "[]", "1", "true", "\"publication\"", "{"))
            invalid.add(new InvalidBody("top-level " + body, body));
        assertInvalidBodies("/api/process", "alice", invalid);
        assertEquals(definition(1, "bob"), getJson("/api/process", "alice"));
    }

    @Test void processPublicationValidatesLinearShapeNamesIdsAndAssignees() throws Exception {
        List<InvalidBody> invalid = new ArrayList<>();
        ObjectNode valid = definition(1, "bob");
        for (int schema : List.of(0, 1, 4)) invalid.add(invalidDefinition("schema " + schema, valid, n -> n.put("schemaVersion", schema)));
        invalid.add(invalidDefinition("wrong process id", valid, n -> n.put("id", "other-process")));
        invalid.add(invalidDefinition("zero version", valid, n -> n.put("version", 0)));
        for (String name : List.of("", "  ", "x".repeat(121), "bad\nname", "bad\u0000name")) {
            invalid.add(invalidDefinition("invalid process name", valid, n -> n.put("name", name)));
            invalid.add(invalidDefinition("invalid node name", valid, n -> node(n, 1).put("name", name)));
        }
        invalid.add(invalidDefinition("null process name", valid, n -> n.putNull("name")));
        invalid.add(invalidDefinition("null node name", valid, n -> node(n, 1).putNull("name")));
        for (String id : List.of("", "  ", "1bad", "bad id", "bad/id", "x".repeat(65), "start", "end"))
            invalid.add(invalidDefinition("invalid approval id " + id, valid, n -> node(n, 1).put("id", id)));
        invalid.add(invalidDefinition("duplicate id", definition(1, "bob", "carol"), n -> node(n, 2).put("id", "manager")));
        invalid.add(invalidDefinition("null node id", valid, n -> node(n, 1).putNull("id")));
        for (int index : List.of(0, 2)) {
            invalid.add(invalidDefinition("renamed endpoint id", valid, n -> node(n, index).put("id", "other")));
            invalid.add(invalidDefinition("changed endpoint type", valid, n -> node(n, index).put("type", "approval")));
            invalid.add(invalidDefinition("assigned endpoint", valid, n -> node(n, index).put("assigneeId", "bob")));
        }
        for (String type : List.of("start", "end", "gateway", "parallel", "", "APPROVAL"))
            invalid.add(invalidDefinition("unsupported middle type " + type, valid, n -> node(n, 1).put("type", type)));
        for (String assignee : List.of("alice", "unknown", "", "Bob", " bob "))
            invalid.add(invalidDefinition("invalid assignee " + assignee, valid, n -> node(n, 1).put("assigneeId", assignee)));
        invalid.add(invalidDefinition("unassigned approval", valid, n -> node(n, 1).putNull("assigneeId")));
        invalid.add(invalidDefinition("no approvals", valid, n -> ((ArrayNode) n.get("nodes")).remove(1)));
        invalid.add(invalidDefinition("empty nodes", valid, n -> n.putArray("nodes")));
        invalid.add(invalidDefinition("nine approvals", definition(1, "bob", "bob", "bob", "bob", "bob", "bob", "bob", "bob", "bob"), n -> {}));
        invalid.add(invalidDefinition("reordered endpoints", valid, n -> {
            ArrayNode nodes = (ArrayNode) n.get("nodes");
            JsonNode first = nodes.get(0); nodes.set(0, nodes.get(2)); nodes.set(2, first);
        }));
        assertInvalidBodies("/api/process", "alice", invalid);
        assertEquals(definition(1, "bob"), getJson("/api/process", "alice"));
        ObjectNode maximum = definition(1, "bob", "carol", "bob", "carol", "bob", "carol", "bob", "carol");
        maximum.put("name", "x".repeat(120));
        node(maximum, 1).put("name", "y".repeat(120));
        node(maximum, 1).put("id", "a".repeat(64));
        postJson("/api/process", "alice", publication(1, maximum)).andExpect(status().isOk())
            .andExpect(jsonPath("$.nodes.length()").value(10));
    }

    @Test void submissionFieldsAreStrictAndCallerCannotChooseActorOrApprovers() throws Exception {
        List<InvalidBody> invalid = new ArrayList<>();
        ObjectNode valid = submission(1);
        for (String field : List.of("title", "reason", "days", "processVersion"))
            invalid.add(changed("missing " + field, valid, n -> n.remove(field)));
        for (String field : List.of("title", "reason")) {
            for (String value : List.of("null", "\"\"", "\"  \"", "42", "true", "[]", "{}"))
                invalid.add(changed(field + " " + value, valid, n -> n.set(field, json(value))));
            invalid.add(changed("too long " + field, valid, n -> n.put(field, "x".repeat(field.equals("title") ? 121 : 2001))));
        }
        for (String field : List.of("days", "processVersion")) {
            for (String value : List.of("null", "0", "-1", "1.9", "\"1\"", "true", "[]", "{}"))
                invalid.add(changed(field + " " + value, valid, n -> n.set(field, json(value))));
        }
        invalid.add(changed("too many days", valid, n -> n.put("days", 366)));
        for (String field : List.of("applicantId", "actorId", "approverId", "definition", "currentStepId", "status", "history", "processId"))
            invalid.add(changed("forged " + field, valid, n -> n.put(field, "bob")));
        invalid.add(new InvalidBody("duplicate days", valid.toString().replace("\"days\":2", "\"days\":2,\"days\":3")));
        invalid.add(new InvalidBody("trailing value", valid + " true"));
        for (String body : List.of("null", "[]", "1", "true", "\"submission\"", "{"))
            invalid.add(new InvalidBody("top-level " + body, body));
        assertInvalidBodies("/api/requests", "alice", invalid);
        assertEquals(0, getJson("/api/requests", "alice").size());
        ObjectNode maximum = submission(1).put("title", "x".repeat(120)).put("reason", "y".repeat(2000)).put("days", 365);
        postJson("/api/requests", "alice", maximum).andExpect(status().isCreated());
        JsonNode created = response(postJson("/api/requests", "alice", submission(1).put("title", " Leave ").put("reason", " Rest ").put("days", 1))
            .andExpect(status().isCreated()));
        assertEquals("Leave", created.path("title").textValue());
        assertEquals("Rest", created.path("reason").textValue());
        assertEquals("alice", created.path("applicantId").textValue());
        assertEquals("bob", created.path("approverId").textValue());
        assertEquals("manager", created.path("currentStepId").textValue());
        assertEquals(definition(1, "bob"), created.get("definition"));
        assertEquals(1, created.path("history").size());
        assertTrue(created.path("history").get(0).path("stepId").isNull());
    }

    @Test void keyedSubmissionReplaysNormalizedIntentAndCurrentStateAfterPublication() throws Exception {
        String key = "web:submission-001";
        JsonNode initial = response(mvc.perform(write("/api/requests", "alice").header("Idempotency-Key", key)
            .content(submission(1).toString())).andExpect(status().isCreated()));
        assertFalse(initial.has("idempotencyKey"));
        assertFalse(initial.toString().contains(key));
        JsonNode replay = response(mvc.perform(write("/api/requests", "alice").header("Idempotency-Key", key)
            .content(submission(1).put("title", "  Leave  ").put("reason", " Rest ").toString()))
            .andExpect(status().isCreated()));
        assertEquals(initial, replay);
        for (ObjectNode changed : List.of(submission(1).put("title", "Different"), submission(1).put("reason", "Different"),
                submission(1).put("days", 3), submission(2))) {
            mvc.perform(write("/api/requests", "alice").header("Idempotency-Key", key).content(changed.toString()))
                .andExpect(status().isConflict());
        }
        postJson("/api/process", "alice", publication(1, definition(1, "carol"))).andExpect(status().isOk());
        assertEquals(initial, response(mvc.perform(write("/api/requests", "alice").header("Idempotency-Key", key)
            .content(submission(1).toString())).andExpect(status().isCreated())));
        JsonNode terminal = response(decide("bob", initial, "manager", "APPROVE", "done").andExpect(status().isOk()));
        assertEquals(terminal, response(mvc.perform(write("/api/requests", "alice").header("Idempotency-Key", key)
            .content(submission(1).toString())).andExpect(status().isCreated())));
        assertEquals(1, getJson("/api/requests", "alice").size());
        assertEquals(2, terminal.path("history").size());
    }

    @Test void submissionKeysAreScopedToTrustedApplicantAndAbsentHeaderRemainsNonIdempotent() throws Exception {
        String key = "shared-client-key";
        JsonNode alice = response(mvc.perform(write("/api/requests", "alice").header("Idempotency-Key", key)
            .content(submission(1).toString())).andExpect(status().isCreated()));
        JsonNode carol = response(mvc.perform(write("/api/requests", "carol").header("Idempotency-Key", key)
            .content(submission(1).toString())).andExpect(status().isCreated()));
        assertNotEquals(alice.path("id"), carol.path("id"));
        assertEquals("carol", carol.path("applicantId").textValue());
        assertEquals(carol, getJson("/api/requests", "carol").get(0));
        mvc.perform(write("/api/requests", "bob").header("Idempotency-Key", key).content(submission(1).toString()))
            .andExpect(status().isBadRequest()); // Same key cannot bypass self-assignment validation for another actor.
        mvc.perform(write("/api/requests", "carol").header("Idempotency-Key", key)
            .content(submission(1).put("applicantId", "alice").toString())).andExpect(status().isBadRequest());
        mvc.perform(post("/api/requests").header("X-Arcflow-Client", "approval-demo").header("Idempotency-Key", key)
            .contentType("application/json").content(submission(1).toString())).andExpect(status().isUnauthorized());
        JsonNode firstUnkeyed = submit("alice", 1), secondUnkeyed = submit("alice", 1);
        assertNotEquals(firstUnkeyed.path("id"), secondUnkeyed.path("id"));
        assertNotEquals(alice.path("id"), firstUnkeyed.path("id"));
    }

    @Test void submissionHeaderRejectsEmptyMalformedOversizedAndDuplicateValuesWithoutWrites() throws Exception {
        for (String key : List.of("", " ", " key", "key ", "a,b", "a/b", "_leading", "key\\nvalue", "密钥", "a".repeat(129))) {
            mvc.perform(write("/api/requests", "alice").header("Idempotency-Key", key).content(submission(1).toString()))
                .andExpect(status().isBadRequest());
        }
        mvc.perform(write("/api/requests", "alice").header("Idempotency-Key", "same", "same")
            .content(submission(1).toString())).andExpect(status().isBadRequest());
        mvc.perform(write("/api/requests", "alice").header("Idempotency-Key", "first", "second")
            .content(submission(1).toString())).andExpect(status().isBadRequest());
        assertEquals(0, getJson("/api/requests", "alice").size());
        mvc.perform(write("/api/requests", "alice").header("Idempotency-Key", "A" + "x".repeat(127))
            .content(submission(1).toString())).andExpect(status().isCreated());
        assertEquals(1, getJson("/api/requests", "alice").size());
    }

    @Test void staleSubmissionsAndSelfApprovalAtAnyPositionAreRejected() throws Exception {
        postJson("/api/requests", "bob", submission(1)).andExpect(status().isBadRequest());
        postJson("/api/requests", "alice", submission(2)).andExpect(status().isConflict());
        postJson("/api/process", "alice", publication(1, definition(1, "bob", "carol"))).andExpect(status().isOk());
        postJson("/api/requests", "alice", submission(1)).andExpect(status().isConflict());
        postJson("/api/requests", "bob", submission(2)).andExpect(status().isBadRequest());
        postJson("/api/requests", "carol", submission(2)).andExpect(status().isBadRequest());
        assertEquals(0, getJson("/api/requests", "alice").size());
        submit("alice", 2);
        postJson("/api/process", "alice", publication(2, definition(2, "carol", "bob"))).andExpect(status().isOk());
        postJson("/api/requests", "bob", submission(3)).andExpect(status().isBadRequest());
        postJson("/api/requests", "carol", submission(3)).andExpect(status().isBadRequest());
        assertEquals(1, getJson("/api/requests", "alice").size());
    }

    @Test void requestVisibilityIncludesOnlyApplicantAndSnapshottedApprovers() throws Exception {
        JsonNode aliceRequest = submit("alice", 1);
        assertEquals(0, getJson("/api/requests", "carol").size());
        decide("carol", aliceRequest, "manager", "APPROVE", "").andExpect(status().isNotFound());
        decide("alice", aliceRequest, "manager", "APPROVE", "").andExpect(status().isForbidden());
        postJson("/api/requests/missing/decisions", "bob", decision("manager", "APPROVE", ""))
            .andExpect(status().isNotFound());
        JsonNode carolRequest = submit("carol", 1);
        assertEquals(1, getJson("/api/requests", "alice").size());
        assertEquals(carolRequest, getJson("/api/requests", "carol").get(0));
        assertEquals(2, getJson("/api/requests", "bob").size());
        decide("alice", carolRequest, "manager", "APPROVE", "").andExpect(status().isNotFound());
        postJson("/api/process", "alice", publication(1, definition(1, "bob", "carol"))).andExpect(status().isOk());
        JsonNode multi = submit("alice", 2);
        assertTrue(getJson("/api/requests", "bob").toString().contains(multi.path("id").textValue()));
        assertTrue(getJson("/api/requests", "carol").toString().contains(multi.path("id").textValue()));
        assertFalse(getJson("/api/requests", "carol").toString().contains(aliceRequest.path("id").textValue()));
    }

    @Test void sequentialDecisionsAuthorizeExactStepAndReplayWithoutChangingHistory() throws Exception {
        postJson("/api/process", "alice", publication(1, definition(1, "bob", "carol", "bob"))).andExpect(status().isOk());
        JsonNode initial = submit("alice", 2);
        decide("carol", initial, "step2", "APPROVE", "early").andExpect(status().isConflict());
        decide("bob", initial, "step2", "APPROVE", "forged").andExpect(status().isForbidden());
        decide("alice", initial, "manager", "APPROVE", "self").andExpect(status().isForbidden());
        decide("carol", initial, "manager", "APPROVE", "forged").andExpect(status().isForbidden());
        decide("bob", initial, "does-not-exist", "APPROVE", "").andExpect(status().isConflict());
        JsonNode first = response(decide("bob", initial, "manager", "APPROVE", "  first review  ").andExpect(status().isOk()));
        assertStep(first, "PENDING", "step2", "carol", 2);
        assertEquals("first review", first.path("history").get(1).path("comment").textValue());
        assertEquals(initial.path("history").get(0), first.path("history").get(0));
        assertEquals(first, response(decide("bob", initial, "manager", "APPROVE", "changed replay comment").andExpect(status().isOk())));
        decide("bob", initial, "manager", "REJECT", "opposite").andExpect(status().isConflict());
        decide("carol", initial, "manager", "APPROVE", "replay attack").andExpect(status().isForbidden());
        decide("bob", initial, "step3", "APPROVE", "too early").andExpect(status().isConflict());
        JsonNode second = response(decide("carol", initial, "step2", "APPROVE", null).andExpect(status().isOk()));
        assertStep(second, "PENDING", "step3", "bob", 3);
        assertEquals("", second.path("history").get(2).path("comment").textValue());
        assertEquals(first.path("history").get(1), second.path("history").get(1));
        assertEquals(second, response(decide("bob", initial, "manager", "APPROVE", "old step replay").andExpect(status().isOk())));
        JsonNode terminal = response(decide("bob", initial, "step3", "APPROVE", "done").andExpect(status().isOk()));
        assertStep(terminal, "APPROVED", null, "bob", 4);
        assertEquals(List.of("SUBMIT", "APPROVE", "APPROVE", "APPROVE"), eventValues(terminal, "action"));
        assertEquals(List.of("alice", "bob", "carol", "bob"), eventValues(terminal, "actorId"));
        assertEquals("manager", terminal.path("history").get(1).path("stepId").textValue());
        assertEquals("step2", terminal.path("history").get(2).path("stepId").textValue());
        assertEquals("step3", terminal.path("history").get(3).path("stepId").textValue());
        for (String step : List.of("manager", "step3"))
            assertEquals(terminal, response(decide("bob", initial, step, "APPROVE", "changed").andExpect(status().isOk())));
        assertEquals(terminal, response(decide("carol", initial, "step2", "APPROVE", "changed").andExpect(status().isOk())));
        decide("bob", initial, "step3", "REJECT", "opposite").andExpect(status().isConflict());
        decide("bob", initial, "step2", "APPROVE", "wrong actor replay").andExpect(status().isForbidden());
        assertEquals(terminal, getJson("/api/requests", "alice").get(0));
    }

    @Test void rejectionIsTerminalAndCannotBeBypassedByLaterSteps() throws Exception {
        postJson("/api/process", "alice", publication(1, definition(1, "bob", "carol"))).andExpect(status().isOk());
        JsonNode initial = submit("alice", 2);
        JsonNode rejected = response(decide("bob", initial, "manager", "REJECT", "not available").andExpect(status().isOk()));
        assertStep(rejected, "REJECTED", null, "bob", 2);
        assertEquals(rejected, response(decide("bob", initial, "manager", "REJECT", "different").andExpect(status().isOk())));
        decide("bob", initial, "manager", "APPROVE", "opposite").andExpect(status().isConflict());
        decide("carol", initial, "step2", "APPROVE", "bypass").andExpect(status().isConflict());
        decide("carol", initial, "step2", "REJECT", "extra").andExpect(status().isConflict());
        decide("carol", initial, "manager", "REJECT", "replay").andExpect(status().isForbidden());
        assertEquals(rejected, getJson("/api/requests", "alice").get(0));
    }

    @Test void publishingNeverChangesExistingRequestsOrTheirAuthorization() throws Exception {
        JsonNode old = submit("alice", 1);
        ObjectNode replacement = definition(1, "carol");
        node(replacement, 1).put("id", "replacement").put("name", "New reviewer");
        postJson("/api/process", "alice", publication(1, replacement)).andExpect(status().isOk());
        assertEquals(old, getJson("/api/requests", "alice").get(0));
        assertEquals(0, getJson("/api/requests", "carol").size());
        decide("carol", old, "manager", "APPROVE", "new editor assignment").andExpect(status().isNotFound());
        decide("bob", old, "replacement", "APPROVE", "new step").andExpect(status().isConflict());
        JsonNode completedOld = response(decide("bob", old, "manager", "APPROVE", "original process").andExpect(status().isOk()));
        assertEquals(old.path("definition"), completedOld.path("definition"));
        assertEquals(1, completedOld.path("processVersion").intValue());
        JsonNode newer = submit("alice", 2);
        assertEquals("replacement", newer.path("currentStepId").textValue());
        assertEquals("carol", newer.path("approverId").textValue());
        assertEquals(2, newer.path("definition").path("version").intValue());
        postJson("/api/process", "alice", publication(2, definition(2, "bob", "bob"))).andExpect(status().isOk());
        decide("bob", newer, "replacement", "APPROVE", "current global assignee").andExpect(status().isNotFound());
        JsonNode completedNewer = response(decide("carol", newer, "replacement", "APPROVE", "snapshotted assignment").andExpect(status().isOk()));
        assertEquals(newer.path("definition"), completedNewer.path("definition"));
        assertEquals(2, completedNewer.path("processVersion").intValue());
        assertEquals(completedOld, getJson("/api/requests", "bob").get(0));
        assertEquals(1, getJson("/api/requests", "bob").size());
    }

    @Test void decisionsRejectMissingFieldsForgedIdentityAndScalarCoercion() throws Exception {
        JsonNode initial = submit("alice", 1);
        String path = "/api/requests/" + initial.path("id").textValue() + "/decisions";
        ObjectNode valid = decision("manager", "APPROVE", "fine");
        List<InvalidBody> invalid = new ArrayList<>();
        for (String field : List.of("stepId", "decision")) {
            invalid.add(changed("missing " + field, valid, n -> n.remove(field)));
            for (String value : List.of("null", "\"\"", "\"  \"", "1", "true", "[]", "{}"))
                invalid.add(changed(field + " " + value, valid, n -> n.set(field, json(value))));
        }
        invalid.add(changed("long stepId", valid, n -> n.put("stepId", "x".repeat(65))));
        for (String value : List.of("approve", "PENDING", "APPROVED", "APPROVE "))
            invalid.add(changed("invalid decision " + value, valid, n -> n.put("decision", value)));
        for (String value : List.of("1", "1.5", "true", "[]", "{}"))
            invalid.add(changed("comment " + value, valid, n -> n.set("comment", json(value))));
        invalid.add(changed("long comment", valid, n -> n.put("comment", "x".repeat(2001))));
        for (String field : List.of("actorId", "applicantId", "approverId", "processVersion", "currentStepId", "history", "status"))
            invalid.add(changed("forged " + field, valid, n -> n.put(field, "alice")));
        invalid.add(new InvalidBody("duplicate stepId", valid.toString().replace("\"stepId\":\"manager\"", "\"stepId\":\"manager\",\"stepId\":\"manager\"")));
        invalid.add(new InvalidBody("trailing decision", valid + " {}"));
        for (String body : List.of("null", "[]", "1", "true", "\"decision\"", "{"))
            invalid.add(new InvalidBody("top-level " + body, body));
        assertInvalidBodies(path, "bob", invalid);
        assertEquals(initial, getJson("/api/requests", "alice").get(0));
        JsonNode maximum = response(postJson(path, "bob", decision("manager", "APPROVE", "x".repeat(2000))).andExpect(status().isOk()));
        assertEquals(2000, maximum.path("comment").textValue().length());
        JsonNode another = submit("alice", 1);
        ObjectNode noComment = decision("manager", "REJECT", "discarded");
        noComment.remove("comment");
        postJson("/api/requests/" + another.path("id").textValue() + "/decisions", "bob", noComment)
            .andExpect(status().isOk()).andExpect(jsonPath("$.comment").value(""));
    }

    @Test void allGroupsPublishReloadAndAuthorizeEachVoteWithoutSkippingTheNextStep() throws Exception {
        var proposal = groupDefinition(1, "ALL");
        for (String user : List.of("bob", "carol"))
            postJson("/api/process", user, publication(1, proposal)).andExpect(status().isForbidden());
        JsonNode published = response(postJson("/api/process", "alice", publication(1, proposal)).andExpect(status().isOk()));
        assertEquals(3, published.path("schemaVersion").intValue());
        assertEquals(proposal.path("nodes"), getJson("/api/process", "bob").path("nodes"));
        postJson("/api/process", "alice", publication(1, proposal)).andExpect(status().isConflict());
        postJson("/api/requests", "bob", submission(2)).andExpect(status().isBadRequest());
        JsonNode initial = submit("alice", 2);
        assertStep(initial, "PENDING", "manager", "bob", 1);
        decide("alice", initial, "manager", "APPROVE", "forged voter").andExpect(status().isForbidden());
        decide("carol", initial, "step2", "APPROVE", "future").andExpect(status().isConflict());
        JsonNode partial = response(decide("carol", initial, "manager", "APPROVE", "Carol first").andExpect(status().isOk()));
        assertStep(partial, "PENDING", "manager", "bob", 2);
        assertEquals(partial, response(decide("carol", initial, "manager", "APPROVE", "retry").andExpect(status().isOk())));
        decide("carol", initial, "manager", "REJECT", "opposite").andExpect(status().isConflict());
        JsonNode next = response(decide("bob", initial, "manager", "APPROVE", "Bob second").andExpect(status().isOk()));
        assertStep(next, "PENDING", "step2", "carol", 3);
        assertEquals(next, response(decide("carol", initial, "manager", "APPROVE", "late retry").andExpect(status().isOk())));
        decide("bob", initial, "step2", "APPROVE", "wrong assignee").andExpect(status().isForbidden());
        JsonNode done = response(decide("carol", initial, "step2", "APPROVE", "Final").andExpect(status().isOk()));
        assertStep(done, "APPROVED", null, "carol", 4);
        assertEquals(published, done.path("definition"));
        assertEquals(List.of("alice", "carol", "bob", "carol"), eventValues(done, "actorId"));
    }

    @Test void anyAndAllRulesHaveDistinctPartialAndTerminalRejectionSemantics() throws Exception {
        postJson("/api/process", "alice", publication(1, groupDefinition(1, "ANY"))).andExpect(status().isOk());
        JsonNode first = submit("alice", 2);
        JsonNode rejectedVote = response(decide("bob", first, "manager", "REJECT", "One no").andExpect(status().isOk()));
        assertStep(rejectedVote, "PENDING", "manager", "carol", 2);
        JsonNode allRejected = response(decide("carol", first, "manager", "REJECT", "Two no").andExpect(status().isOk()));
        assertStep(allRejected, "REJECTED", null, "carol", 3);
        JsonNode second = submit("alice", 2);
        JsonNode anyApproved = response(decide("bob", second, "manager", "APPROVE", "One yes").andExpect(status().isOk()));
        assertStep(anyApproved, "PENDING", "step2", "carol", 2);
        decide("carol", second, "manager", "APPROVE", "Unneeded vote").andExpect(status().isConflict());
        postJson("/api/process", "alice", publication(2, groupDefinition(2, "ALL"))).andExpect(status().isOk());
        JsonNode third = submit("alice", 3);
        JsonNode allFailed = response(decide("bob", third, "manager", "REJECT", "Veto").andExpect(status().isOk()));
        assertStep(allFailed, "REJECTED", null, "bob", 2);
        decide("carol", third, "manager", "APPROVE", "Too late").andExpect(status().isConflict());
        JsonNode saved = getJson("/api/requests", "alice");
        assertEquals(3, saved.size());
        assertEquals(allRejected, requestById(saved, first));
        assertEquals(anyApproved, requestById(saved, second));
        assertEquals(allFailed, requestById(saved, third));
    }

    @Test void groupsRejectDuplicateParticipantsUnsupportedModesAndForgedActorFields() throws Exception {
        List<InvalidBody> invalid = new ArrayList<>();
        var valid = groupDefinition(1, "ALL");
        for (String members : List.of("[]", "[\"bob\"]", "[\"bob\",\"bob\"]", "[\"bob\",\"alice\"]", "null", "\"bob\"", "[\"bob\",2]"))
            invalid.add(invalidDefinition("invalid group members " + members, valid, n -> node(n, 1).set("assigneeIds", json(members))));
        for (String field : List.of("assigneeIds", "completionMode"))
            invalid.add(invalidDefinition("missing " + field, valid, n -> node(n, 1).remove(field)));
        invalid.add(invalidDefinition("unsupported mode", valid, n -> node(n, 1).put("completionMode", "MAJORITY")));
        invalid.add(invalidDefinition("single assignee in group", valid, n -> node(n, 1).put("assigneeId", "bob")));
        invalid.add(invalidDefinition("schema2 group", valid, n -> n.put("schemaVersion", 2)));
        invalid.add(invalidDefinition("script on group", valid, n -> node(n, 1).put("script", "execute")));
        assertInvalidBodies("/api/process", "alice", invalid);
        assertEquals(1, getJson("/api/process", "alice").path("version").intValue());
        postJson("/api/process", "alice", publication(1, valid)).andExpect(status().isOk());
        JsonNode item = submit("alice", 2);
        ObjectNode forged = decision("manager", "APPROVE", "forged").put("actorId", "bob");
        postJson("/api/requests/" + item.path("id").textValue() + "/decisions", "alice", forged).andExpect(status().isBadRequest());
        assertEquals(item, getJson("/api/requests", "alice").get(0));
    }

    @Test void changingBackToSchema2KeepsExistingGroupSnapshotsAndLegacySingleApprovals() throws Exception {
        JsonNode legacy = submit("alice", 1);
        postJson("/api/process", "alice", publication(1, groupDefinition(1, "ALL"))).andExpect(status().isOk());
        JsonNode grouped = submit("alice", 2);
        postJson("/api/process", "alice", publication(2, definition(2, "bob"))).andExpect(status().isOk());
        assertEquals(2, getJson("/api/process", "alice").path("schemaVersion").intValue());
        JsonNode saved = getJson("/api/requests", "alice");
        assertEquals(2, saved.size());
        assertEquals(legacy, requestById(saved, legacy));
        assertEquals(grouped, requestById(saved, grouped));
        assertEquals(3, requestById(saved, grouped).path("definition").path("schemaVersion").intValue());
        assertStep(response(decide("bob", legacy, "manager", "APPROVE", "Legacy").andExpect(status().isOk())), "APPROVED", null, "bob", 2);
        assertStep(response(decide("bob", grouped, "manager", "APPROVE", "Group partial").andExpect(status().isOk())), "PENDING", "manager", "carol", 2);
        JsonNode fresh = submit("alice", 3);
        assertStep(response(decide("bob", fresh, "manager", "APPROVE", "Single").andExpect(status().isOk())), "APPROVED", null, "bob", 2);
    }

    @Test void inboxUsesOnlyAuthenticatedActorAndKeepsLegacyVisibility() throws Exception {
        postJson("/api/process", "alice", publication(1, definition(1, "bob", "carol"))).andExpect(status().isOk());
        JsonNode request = submit("alice", 2);
        assertEquals(1, getJson("/api/requests", "carol").size());
        for (String actor : List.of("alice", "carol")) {
            JsonNode inbox = getJson("/api/requests/inbox", actor);
            assertEquals(0, inbox.path("items").size()); assertTrue(inbox.path("nextCursor").isNull());
        }
        assertEquals(request, getJson("/api/requests/inbox", "bob").path("items").get(0));
        for (String forged : List.of("actor", "actorId", "userId", "applicantId", "approverId"))
            mvc.perform(authenticated(get("/api/requests/inbox").param(forged, "bob"), "carol")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/requests/inbox")).andExpect(status().isUnauthorized());
        mvc.perform(authenticated(get("/api/requests/inbox"), "bob").header("Origin", "https://evil.example"))
            .andExpect(status().isForbidden());
    }

    @Test void inboxIncludesAllMembersAndOnlyActualHandledVotesAcrossStages() throws Exception {
        postJson("/api/process", "alice", publication(1, groupDefinition(1, "ALL"))).andExpect(status().isOk());
        JsonNode request = submit("alice", 2);
        for (String actor : List.of("bob", "carol")) assertEquals(request, getJson("/api/requests/inbox", actor).path("items").get(0));
        JsonNode partial = response(decide("carol", request, "manager", "APPROVE", "first").andExpect(status().isOk()));
        assertEquals(0, getJson("/api/requests/inbox", "carol").path("items").size());
        assertEquals(partial, getJson("/api/requests/inbox?box=HANDLED&status=PENDING&processVersion=2", "carol").path("items").get(0));
        JsonNode advanced = response(decide("bob", request, "manager", "APPROVE", "second").andExpect(status().isOk()));
        for (String box : List.of("PENDING", "HANDLED"))
            assertEquals(advanced, getJson("/api/requests/inbox?box=" + box, "carol").path("items").get(0));
        JsonNode terminal = response(decide("carol", request, "step2", "APPROVE", "final").andExpect(status().isOk()));
        for (String actor : List.of("bob", "carol")) {
            assertEquals(0, getJson("/api/requests/inbox", actor).path("items").size());
            assertEquals(terminal, getJson("/api/requests/inbox?box=HANDLED&status=APPROVED", actor).path("items").get(0));
        }
    }

    @Test void inboxAnyWinnerDoesNotMarkUnvotedLoserAsHandled() throws Exception {
        ObjectNode definition = groupDefinition(1, "ANY"); ((ArrayNode) definition.path("nodes")).remove(2);
        postJson("/api/process", "alice", publication(1, definition)).andExpect(status().isOk());
        JsonNode request = submit("alice", 2);
        decide("bob", request, "manager", "APPROVE", "winner").andExpect(status().isOk());
        for (String box : List.of("PENDING", "HANDLED")) assertEquals(0,
            getJson("/api/requests/inbox?box=" + box, "carol").path("items").size());
        assertEquals(1, getJson("/api/requests", "carol").size());
        assertEquals(1, getJson("/api/requests/inbox?box=HANDLED", "bob").path("items").size());
    }

    @Test void inboxPaginatesWithoutDuplicatesAndRejectsForeignCursorsAndInvalidParameters() throws Exception {
        postJson("/api/process", "alice", publication(1, groupDefinition(1, "ALL"))).andExpect(status().isOk());
        List<JsonNode> submitted = new ArrayList<>();
        for (int i = 0; i < 4; i++) submitted.add(submit("alice", 2));
        submitted.sort((a, b) -> {
            int time = java.time.Instant.parse(b.path("createdAt").textValue()).compareTo(java.time.Instant.parse(a.path("createdAt").textValue()));
            return time == 0 ? b.path("id").textValue().compareTo(a.path("id").textValue()) : time;
        });
        List<String> seen = new ArrayList<>();
        JsonNode first = getJson("/api/requests/inbox?limit=1", "bob");
        assertEquals(2, first.size());
        String initialCursor = first.path("nextCursor").textValue(); assertNotNull(initialCursor);
        JsonNode current = first;
        while (true) {
            current.path("items").forEach(item -> seen.add(item.path("id").textValue()));
            if (current.path("nextCursor").isNull()) break;
            current = response(mvc.perform(authenticated(get("/api/requests/inbox").param("limit", "1")
                .param("cursor", current.path("nextCursor").textValue()), "bob")).andExpect(status().isOk()));
        }
        assertEquals(submitted.stream().map(item -> item.path("id").textValue()).toList(), seen);
        mvc.perform(authenticated(get("/api/requests/inbox").param("cursor", initialCursor), "carol")).andExpect(status().isBadRequest());
        for (String[] changed : List.of(new String[]{"box", "HANDLED"}, new String[]{"status", "PENDING"}, new String[]{"processVersion", "2"}))
            mvc.perform(authenticated(get("/api/requests/inbox").param(changed[0], changed[1]).param("cursor", initialCursor), "bob"))
                .andExpect(status().isBadRequest());
        for (String bad : List.of("0", "101", "-1", "1.5", "true", "", " 1", "99999999999999"))
            mvc.perform(authenticated(get("/api/requests/inbox").param("limit", bad), "bob")).andExpect(status().isBadRequest());
        for (String bad : List.of("", "broken!", "A".repeat(1025), initialCursor + "="))
            mvc.perform(authenticated(get("/api/requests/inbox").param("cursor", bad), "bob")).andExpect(status().isBadRequest());
        for (String[] bad : List.of(new String[]{"box", "VISIBLE"}, new String[]{"status", "DONE"}, new String[]{"processVersion", "0"}))
            mvc.perform(authenticated(get("/api/requests/inbox").param(bad[0], bad[1]), "bob")).andExpect(status().isBadRequest());
        mvc.perform(authenticated(get("/api/requests/inbox").param("limit", "1", "2"), "bob")).andExpect(status().isBadRequest());
        assertEquals(4, getJson("/api/requests", "alice").size());
    }

    private ObjectNode groupDefinition(int version, String mode) {
        ObjectNode d = definition(version, "bob", "carol");
        d.put("schemaVersion", 3);
        ObjectNode group = node(d, 1);
        group.put("type", "parallelApproval").putNull("assigneeId").put("completionMode", mode);
        group.putArray("assigneeIds").add("bob").add("carol");
        return d;
    }

    private MockHttpServletRequestBuilder authenticated(MockHttpServletRequestBuilder request, String user) {
        return request.with(httpBasic(user, "test-" + user + "-password"));
    }
    private MockHttpServletRequestBuilder write(String path, String user) {
        return authenticated(post(path), user).header("X-Arcflow-Client", "approval-demo").contentType("application/json");
    }
    private ResultActions postJson(String path, String user, JsonNode body) throws Exception {
        return mvc.perform(write(path, user).content(body.toString()));
    }
    private JsonNode getJson(String path, String user) throws Exception {
        return response(mvc.perform(authenticated(get(path), user)).andExpect(status().isOk()));
    }
    private JsonNode requestById(JsonNode requests, JsonNode expected) {
        assertTrue(requests.isArray());
        JsonNode found = null;
        for (JsonNode request : requests) {
            if (expected.path("id").equals(request.path("id"))) {
                assertNull(found, "Duplicate request ID in response");
                found = request;
            }
        }
        assertNotNull(found, "Request is missing from response: " + expected.path("id").textValue());
        return found;
    }
    private JsonNode response(ResultActions result) throws Exception {
        return mapper.readTree(result.andReturn().getResponse().getContentAsString());
    }
    private ObjectNode submission(int version) {
        return mapper.createObjectNode().put("title", "Leave").put("reason", "Rest").put("days", 2).put("processVersion", version);
    }
    private ObjectNode decision(String step, String action, String comment) {
        return mapper.createObjectNode().put("stepId", step).put("decision", action).put("comment", comment);
    }
    private ObjectNode publication(int expectedVersion, ObjectNode definition) {
        ObjectNode body = mapper.createObjectNode().put("expectedVersion", expectedVersion);
        body.set("definition", definition); return body;
    }
    private ObjectNode definition(int version, String... assignees) {
        ObjectNode process = mapper.createObjectNode().put("schemaVersion", 2).put("id", "leave-approval")
            .put("version", version).put("name", "Leave approval");
        ArrayNode nodes = process.putArray("nodes");
        nodes.addObject().put("id", "start").put("type", "start").put("name", "Submit leave").putNull("assigneeId");
        for (int i = 0; i < assignees.length; i++)
            nodes.addObject().put("id", i == 0 ? "manager" : "step" + (i + 1)).put("type", "approval")
                .put("name", i == 0 ? "Designated approver" : "Review " + (i + 1)).put("assigneeId", assignees[i]);
        nodes.addObject().put("id", "end").put("type", "end").put("name", "Completed").putNull("assigneeId");
        return process;
    }
    private JsonNode submit(String user, int version) throws Exception {
        return response(postJson("/api/requests", user, submission(version)).andExpect(status().isCreated()));
    }
    private ResultActions decide(String user, JsonNode request, String step, String action, String comment) throws Exception {
        return postJson("/api/requests/" + request.path("id").textValue() + "/decisions", user, decision(step, action, comment));
    }
    private static ObjectNode object(ObjectNode parent, String field) { return (ObjectNode) parent.get(field); }
    private static ObjectNode node(ObjectNode definition, int index) { return (ObjectNode) definition.get("nodes").get(index); }
    private JsonNode json(String raw) {
        try { return mapper.readTree(raw); }
        catch (Exception ex) { throw new IllegalArgumentException("Invalid test fixture", ex); }
    }
    private record InvalidBody(String description, String body) {}
    private InvalidBody changed(String description, ObjectNode original, Consumer<ObjectNode> change) {
        ObjectNode copy = original.deepCopy(); change.accept(copy); return new InvalidBody(description, copy.toString());
    }
    private InvalidBody invalidDefinition(String description, ObjectNode original, Consumer<ObjectNode> change) {
        ObjectNode copy = original.deepCopy(); change.accept(copy);
        return new InvalidBody(description, publication(1, copy).toString());
    }
    private void assertInvalidBodies(String path, String user, List<InvalidBody> cases) throws Exception {
        for (InvalidBody invalid : cases) {
            var result = mvc.perform(write(path, user).content(invalid.body())).andReturn();
            assertEquals(400, result.getResponse().getStatus(), invalid.description() + ": " + result.getResponse().getContentAsString());
            assertTrue(mapper.readTree(result.getResponse().getContentAsString()).path("message").isTextual(), invalid.description());
        }
    }
    private List<String> nodeIds(JsonNode process) {
        List<String> ids = new ArrayList<>(); process.path("nodes").forEach(n -> ids.add(n.path("id").textValue())); return ids;
    }
    private List<String> eventValues(JsonNode request, String field) {
        List<String> values = new ArrayList<>(); request.path("history").forEach(e -> values.add(e.path(field).textValue())); return values;
    }
    private void assertStep(JsonNode request, String status, String step, String approver, int historySize) {
        assertEquals(status, request.path("status").textValue());
        assertEquals(step, request.path("currentStepId").textValue());
        assertEquals(approver, request.path("approverId").textValue());
        assertEquals(historySize, request.path("history").size());
    }
}
