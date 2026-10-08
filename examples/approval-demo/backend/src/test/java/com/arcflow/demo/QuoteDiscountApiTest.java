package com.arcflow.demo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.nio.file.Files;
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
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"APPROVAL_ALICE_PASSWORD=test-alice-password", "APPROVAL_BOB_PASSWORD=test-bob-password", "APPROVAL_CAROL_PASSWORD=test-carol-password"})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class QuoteDiscountApiTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @DynamicPropertySource static void data(DynamicPropertyRegistry registry) throws Exception {
        var file = Files.createTempDirectory("quote-api-test-").resolve("state.json");
        registry.add("approval.data-file", file::toString);
    }
    ObjectNode input() throws Exception {
        return (ObjectNode) mapper.readTree("""
            {"business":{"type":"quoteDiscount","businessId":"Q-DEMO-001","title":"报价折扣审批 / Quote discount approval",
             "reason":"十套设备的合成报价 / Synthetic quote for ten equipment sets","customerRef":"CUSTOMER-DEMO-A","quoteRevision":1,
             "item":"设备套装 / Equipment set","quantity":10,"listUnitPrice":1000.00,"requestedUnitPrice":850.00,"currency":"CNY","validUntil":"2099-12-31"},"processVersion":1}
            """);
    }
    MockHttpServletRequestBuilder write(String path, String actor) {
        return post(path).with(httpBasic(actor, "test-" + actor + "-password")).header("X-Arcflow-Client", "approval-demo").contentType("application/json");
    }
    JsonNode result(ResultActions action) throws Exception { return mapper.readTree(action.andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8)); }
    JsonNode submit(ObjectNode input) throws Exception { return result(mvc.perform(write("/api/crm/documents", "alice").content(input.toString())).andExpect(status().isCreated())); }
    ResultActions decide(String actor, String id, String step, String decision) throws Exception {
        return mvc.perform(write("/api/crm/requests/" + id + "/decisions", actor).content(mapper.createObjectNode().put("stepId", step).put("decision", decision).put("comment", "Reviewed synthetic quote").toString()));
    }
    @Test void realAuthenticatedControllerCompletesTwoHumanStepsWithExactAmounts() throws Exception {
        var created = submit(input()); var request = created.path("request"); String id = request.path("id").asText();
        assertEquals("8500.00", created.path("requestedTotal").asText()); assertEquals("1500.00", created.path("reductionTotal").asText());
        assertEquals("15", created.path("discountPercent").asText()); assertTrue(created.path("thresholdReached").asBoolean());
        assertEquals("quote-discount", request.path("processId").asText()); assertEquals("alice", request.path("applicantId").asText());
        assertEquals("salesManager", request.path("currentStepId").asText()); assertEquals(0, request.path("days").asInt());
        assertEquals(created, submit(input()));
        decide("carol", id, "finance", "APPROVE").andExpect(status().isConflict());
        decide("alice", id, "salesManager", "APPROVE").andExpect(status().isForbidden());
        var intermediate = result(decide("bob", id, "salesManager", "APPROVE").andExpect(status().isOk()));
        assertEquals("PENDING", intermediate.path("request").path("status").asText());
        var approved = result(decide("carol", id, "finance", "APPROVE").andExpect(status().isOk()));
        assertEquals("APPROVED", approved.path("request").path("status").asText());
        assertEquals(3, approved.path("request").path("history").size()); assertEquals(request.path("business"), approved.path("request").path("business"));
        assertEquals(approved, submit(input())); assertEquals(approved, result(decide("carol", id, "finance", "APPROVE").andExpect(status().isOk())));
        decide("carol", id, "finance", "REJECT").andExpect(status().isConflict());
    }
    @Test void hostRejectsAuthoritativeFieldTamperingRoutingInjectionAndNonOwnerSubmission() throws Exception {
        mvc.perform(write("/api/crm/documents", "bob").content(input().toString())).andExpect(status().isForbidden());
        for (String field : new String[]{"customerRef", "quoteRevision", "listUnitPrice"}) {
            var input = input(); var business = (ObjectNode) input.get("business");
            if (field.equals("customerRef")) business.put(field, "OTHER-CUSTOMER"); else business.put(field, field.equals("quoteRevision") ? 2 : 1100);
            mvc.perform(write("/api/crm/documents", "alice").content(input.toString())).andExpect(status().is(field.equals("quoteRevision") ? 404 : 409));
        }
        for (String field : new String[]{"processId", "applicantId", "approverId"}) {
            var input = input(); input.put(field, "bob");
            mvc.perform(write("/api/crm/documents", "alice").content(input.toString())).andExpect(status().isBadRequest());
        }
        mvc.perform(write("/api/documents", "alice").content(input().toString())).andExpect(status().isBadRequest());
        var noAuth = post("/api/crm/documents").header("X-Arcflow-Client", "approval-demo").contentType("application/json").content(input().toString());
        mvc.perform(noAuth).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/crm/documents").with(user("mallory")).header("X-Arcflow-Client", "approval-demo").contentType("application/json").content(input().toString())).andExpect(status().isForbidden());
    }
    @Test void quoteVersionBindingRejectsChangedIntentAndDoesNotPretendToAcceptCustomKeys() throws Exception {
        var created = submit(input()); var changed = input(); ((ObjectNode) changed.get("business")).put("requestedUnitPrice", new BigDecimal("800.00"));
        mvc.perform(write("/api/crm/documents", "alice").content(changed.toString())).andExpect(status().isConflict());
        mvc.perform(write("/api/crm/documents", "alice").header("Idempotency-Key", "custom").content(input().toString())).andExpect(status().isBadRequest());
        var list = result(mvc.perform(get("/api/crm/requests").with(httpBasic("alice", "test-alice-password"))).andExpect(status().isOk()));
        assertEquals(1, list.size()); assertEquals(created, list.get(0));
        assertEquals(0, result(mvc.perform(get("/api/requests").with(httpBasic("alice", "test-alice-password"))).andExpect(status().isOk())).size());
        mvc.perform(write("/api/requests/" + created.path("request").path("id").asText() + "/decisions", "bob").content("{\"stepId\":\"salesManager\",\"decision\":\"APPROVE\",\"comment\":\"\"}")).andExpect(status().isNotFound());
    }
    @Test void malformedDecimalAndUnknownDerivedFieldsFailClosed() throws Exception {
        for (String value : new String[]{"\"850\"", "850.001", "true", "null", "1000", "0"}) {
            String input = input().toString().replaceFirst("\"requestedUnitPrice\":[0-9.]+", "\"requestedUnitPrice\":" + value);
            mvc.perform(write("/api/crm/documents", "alice").content(input)).andExpect(status().isBadRequest());
        }
        var unknown = input(); ((ObjectNode) unknown.get("business")).put("requestedTotal", 1);
        mvc.perform(write("/api/crm/documents", "alice").content(unknown.toString())).andExpect(status().isBadRequest());
        String duplicate = input().toString().replace("\"quoteRevision\":1", "\"quoteRevision\":1,\"quoteRevision\":2");
        mvc.perform(write("/api/crm/documents", "alice").content(duplicate)).andExpect(status().isBadRequest());
        mvc.perform(write("/api/crm/documents", "alice").header("Origin", "https://attacker.example").content(input().toString())).andExpect(status().isForbidden());
    }
}
