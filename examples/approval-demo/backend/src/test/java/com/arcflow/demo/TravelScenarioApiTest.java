package com.arcflow.demo;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"APPROVAL_ALICE_PASSWORD=test-alice-password", "APPROVAL_BOB_PASSWORD=test-bob-password", "APPROVAL_CAROL_PASSWORD=test-carol-password"})
@AutoConfigureMockMvc
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class TravelScenarioApiTest {
    static final String BASE="/api/scenarios/oa-travel";
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @DynamicPropertySource static void data(DynamicPropertyRegistry registry) throws Exception {
        var file=Files.createTempDirectory("travel-scenario-api-test-").resolve("state.json"); registry.add("approval.data-file",file::toString);
    }
    ObjectNode input() throws Exception { return (ObjectNode)mapper.readTree("""
        {"business":{"type":"travel","documentVersion":1,"businessId":"TRIP-DEMO-001","title":"Customer visit","reason":"Synthetic itinerary only","destination":" Shanghai ","startDate":"2026-10-08","endDate":"2026-10-10","purpose":"CUSTOMER_VISIT","estimatedCost":1234.50,"currency":"CNY","costCenter":"SALES"},"processVersion":1}
        """); }
    MockHttpServletRequestBuilder write(String path,String actor) { return post(path).with(httpBasic(actor,"test-"+actor+"-password")).header("X-Arcflow-Client","approval-demo").contentType("application/json"); }
    JsonNode result(ResultActions action) throws Exception { return mapper.readTree(action.andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8)); }
    ResultActions submit(String body,String key) throws Exception { return mvc.perform(write(BASE+"/documents","alice").header("Idempotency-Key",key).content(body)); }
    ResultActions decide(String actor,String id,String step,String decision) throws Exception { return mvc.perform(write(BASE+"/requests/"+id+"/decisions",actor).content("{\"stepId\":\""+step+"\",\"decision\":\""+decision+"\",\"comment\":\"Synthetic review\"}")); }
    @Test void twoScenarioCatalogAndTravelApprovalAreTypedIsolatedAndExactlyKeyed() throws Exception {
        var catalog=result(mvc.perform(get("/api/scenarios").with(httpBasic("alice","test-alice-password"))).andExpect(status().isOk()));
        assertEquals(4,catalog.size()); var entries=new HashMap<String,JsonNode>(); catalog.forEach(item->entries.put(item.path("id").asText(),item));
        assertEquals(Set.of("erp-receiving","oa-expense","oa-seal-use","oa-travel"),entries.keySet()); assertEquals(20,entries.get("oa-expense").path("lineItems").path("maxItems").asInt());
        var template=entries.get("oa-travel"); assertEquals("travel",template.path("documentType").asText()); assertEquals(1,template.path("documentVersion").asInt()); assertTrue(template.path("lineItems").isNull());
        var process=result(mvc.perform(get(BASE+"/process").with(httpBasic("alice","test-alice-password"))).andExpect(status().isOk()));
        assertEquals("oa-travel",process.path("id").asText()); assertEquals("tripReview",process.path("nodes").get(1).path("id").asText()); assertEquals("budget",process.path("nodes").get(2).path("id").asText());
        var created=result(submit(input().toString(),"travel-one").andExpect(status().isCreated())); String id=created.path("request").path("id").asText();
        assertEquals("1234.50",created.path("total").asText()); assertEquals("oa-travel",created.path("request").path("processId").asText());
        assertEquals("Shanghai",created.path("request").path("business").path("destination").asText()); assertEquals(0,created.path("request").path("days").asInt());
        var canonical=input(); ((ObjectNode)canonical.get("business")).put("destination","Shanghai").put("estimatedCost",new BigDecimal("1234.5"));
        assertEquals(created,result(submit(canonical.toString(),"travel-one").andExpect(status().isCreated())));
        decide("alice",id,"tripReview","APPROVE").andExpect(status().isForbidden()); decide("carol",id,"budget","APPROVE").andExpect(status().isConflict());
        var first=result(decide("bob",id,"tripReview","APPROVE").andExpect(status().isOk())); assertEquals("PENDING",first.path("request").path("status").asText());
        var done=result(decide("carol",id,"budget","APPROVE").andExpect(status().isOk())); assertEquals("APPROVED",done.path("request").path("status").asText());
        assertEquals(created.path("request").path("business"),done.path("request").path("business")); assertEquals(3,done.path("request").path("history").size());
        assertEquals(done,result(submit(input().toString(),"travel-one").andExpect(status().isCreated())));
        assertEquals(1,result(mvc.perform(get(BASE+"/requests").with(httpBasic("alice","test-alice-password"))).andExpect(status().isOk())).size());
        for(String path:List.of("/api/requests","/api/scenarios/oa-expense/requests")) assertEquals(0,result(mvc.perform(get(path).with(httpBasic("alice","test-alice-password"))).andExpect(status().isOk())).size());
        for(String path:List.of("/api/requests/"+id+"/decisions","/api/scenarios/oa-expense/requests/"+id+"/decisions"))
            mvc.perform(write(path,"bob").content("{\"stepId\":\"tripReview\",\"decision\":\"APPROVE\",\"comment\":\"\"}")).andExpect(status().isNotFound());
        mvc.perform(write("/api/documents","alice").content(input().toString())).andExpect(status().isBadRequest());
        mvc.perform(write("/api/scenarios/oa-expense/documents","alice").header("Idempotency-Key","wrong-type").content(input().toString())).andExpect(status().isBadRequest());
        var changed=input(); ((ObjectNode)changed.get("business")).put("destination","Beijing"); submit(changed.toString(),"travel-one").andExpect(status().isConflict());
    }
    @Test void publicationPinsTravelSnapshotAndRejectsStaleFreshKeys() throws Exception {
        var created=result(submit(input().toString(),"travel-two").andExpect(status().isCreated())); String id=created.path("request").path("id").asText();
        var definition=(ObjectNode)created.path("request").path("definition").deepCopy(); definition.put("name","Updated travel policy");
        ((ObjectNode)definition.path("nodes").get(1)).put("assigneeId","carol");
        var publication=mapper.createObjectNode().put("expectedVersion",1).set("definition",definition);
        mvc.perform(write(BASE+"/process","bob").content(publication.toString())).andExpect(status().isForbidden());
        assertEquals(2,result(mvc.perform(write(BASE+"/process","alice").content(publication.toString())).andExpect(status().isOk())).path("version").asInt());
        submit(input().toString(),"fresh-stale").andExpect(status().isConflict());
        var rejected=result(decide("bob",id,"tripReview","REJECT").andExpect(status().isOk())); assertEquals("REJECTED",rejected.path("request").path("status").asText());
        assertEquals(1,rejected.path("request").path("processVersion").asInt()); assertEquals(created.path("request").path("definition"),rejected.path("request").path("definition"));
        assertEquals(rejected,result(submit(input().toString(),"travel-two").andExpect(status().isCreated())));
        assertEquals(rejected,result(decide("bob",id,"tripReview","REJECT").andExpect(status().isOk()))); decide("bob",id,"tripReview","APPROVE").andExpect(status().isConflict());
        var fresh=input(); fresh.put("processVersion",2); var next=result(submit(fresh.toString(),"fresh-current").andExpect(status().isCreated()));
        assertEquals("carol",next.path("request").path("approverId").asText());
        assertEquals(1,result(mvc.perform(get("/api/scenarios/oa-expense/process").with(httpBasic("alice","test-alice-password"))).andExpect(status().isOk())).path("version").asInt());
    }
    @Test void authOriginIdempotencyHeadersAndWrongDocumentTypesFailClosed() throws Exception {
        for(String path:List.of("/api/scenarios",BASE+"/process",BASE+"/requests")) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized()); mvc.perform(get(path).with(user("mallory"))).andExpect(status().isForbidden());
        }
        mvc.perform(get("/api/scenarios/missing/process").with(httpBasic("alice","test-alice-password"))).andExpect(status().isNotFound());
        mvc.perform(write(BASE+"/documents","alice").content(input().toString())).andExpect(status().isBadRequest());
        mvc.perform(write(BASE+"/documents","alice").header("Idempotency-Key","x","y").content(input().toString())).andExpect(status().isBadRequest());
        for(String key:List.of("","bad key","a".repeat(129))) submit(input().toString(),key).andExpect(status().isBadRequest());
        mvc.perform(write(BASE+"/documents","alice").header("Idempotency-Key","key").header("Origin","https://attacker.example").content(input().toString())).andExpect(status().isForbidden());
        var leave=input(); leave.set("business",mapper.readTree("{\"type\":\"leave\",\"businessId\":\"L-1\",\"title\":\"Leave\",\"reason\":\"Rest\",\"days\":1}"));
        submit(leave.toString(),"wrong-type").andExpect(status().isBadRequest());
        assertEquals(0,result(mvc.perform(get(BASE+"/requests").with(httpBasic("alice","test-alice-password"))).andExpect(status().isOk())).size());
    }
    @Test void missingNullUnknownDuplicateAndCoercedFieldsFailBeforePersistence() throws Exception {
        for(String field:List.of("business","processVersion")) {
            var missing=input(); missing.remove(field); submit(missing.toString(),"invalid").andExpect(status().isBadRequest());
            var nil=input(); nil.putNull(field); submit(nil.toString(),"invalid").andExpect(status().isBadRequest());
        }
        for(String field:List.of("type","documentVersion","businessId","title","reason","destination","startDate","endDate","purpose","estimatedCost","currency","costCenter")) {
            var missing=input(); ((ObjectNode)missing.get("business")).remove(field); submit(missing.toString(),"invalid").andExpect(status().isBadRequest());
            var nil=input(); ((ObjectNode)nil.get("business")).putNull(field); submit(nil.toString(),"invalid").andExpect(status().isBadRequest());
        }
        for(String field:List.of("applicantId","processId","total","durationDays","unrecognized")) {
            var root=input(); root.put(field,"forged"); submit(root.toString(),"invalid").andExpect(status().isBadRequest());
            var business=input(); ((ObjectNode)business.get("business")).put(field,"forged"); submit(business.toString(),"invalid").andExpect(status().isBadRequest());
        }
        for(String value:List.of("\"1234.50\"","true","null","0","-1","0.001","1000000000.01")) {
            var raw=input().toString().replaceFirst("\"estimatedCost\":[0-9.]+","\"estimatedCost\":"+value); submit(raw,"invalid").andExpect(status().isBadRequest());
        }
        var duplicate=input().toString().replace("\"documentVersion\":1","\"documentVersion\":1,\"documentVersion\":1"); submit(duplicate,"invalid").andExpect(status().isBadRequest());
        submit(input()+" {}","invalid").andExpect(status().isBadRequest());
        var controls=input(); ((ObjectNode)controls.get("business")).put("destination","\u0000"); submit(controls.toString(),"invalid").andExpect(status().isBadRequest());
        assertEquals(0,result(mvc.perform(get(BASE+"/requests").with(httpBasic("alice","test-alice-password"))).andExpect(status().isOk())).size());
    }
    @Test void strictDateDurationAndYenValidationStillAcceptBoundaryEstimates() throws Exception {
        for(var dates:List.of(List.of("0000-01-01","0000-01-01"),List.of("2026-02-29","2026-03-01"),List.of("1900-02-29","1900-03-01"),
                List.of("2026-01-01","2026-04-01"),List.of("2026-10-10","2026-10-08"),List.of("2026-1-01","2026-01-02"))) {
            var body=input(); ((ObjectNode)body.get("business")).put("startDate",dates.get(0)).put("endDate",dates.get(1)); submit(body.toString(),"bad-date").andExpect(status().isBadRequest());
        }
        var yen=input(); ((ObjectNode)yen.get("business")).put("currency","JPY").put("estimatedCost",new BigDecimal("1.50")); submit(yen.toString(),"yen").andExpect(status().isBadRequest());
        ((ObjectNode)yen.get("business")).put("estimatedCost",new BigDecimal("1000000000.00")).put("startDate","2026-01-01").put("endDate","2026-03-31");
        assertEquals("1000000000",result(submit(yen.toString(),"yen").andExpect(status().isCreated())).path("total").asText());
        for(String date:List.of("0001-01-01","2000-02-29","9999-12-31")) {
            var body=input(); ((ObjectNode)body.get("business")).put("startDate",date).put("endDate",date).put("estimatedCost",new BigDecimal("0.01"));
            assertEquals("0.01",result(submit(body.toString(),"date-"+date).andExpect(status().isCreated())).path("total").asText());
        }
    }
}
