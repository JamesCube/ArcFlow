package com.arcflow.demo;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
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
class ScenarioApiTest {
    static final String BASE="/api/scenarios/oa-expense";
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @DynamicPropertySource static void data(DynamicPropertyRegistry registry) throws Exception {
        var file=Files.createTempDirectory("scenario-api-test-").resolve("state.json"); registry.add("approval.data-file",file::toString);
    }
    ObjectNode input() throws Exception { return (ObjectNode)mapper.readTree("""
        {"business":{"type":"expense","documentVersion":1,"businessId":"EXP-DEMO-001","title":"Expense claim","reason":"Synthetic receipt references only","costCenter":"ENGINEERING","currency":"CNY","lines":[{"lineId":"line-1","spentOn":"2026-10-01","category":"OFFICE","description":"Demo stationery","amount":0.10,"receiptRef":"R-DEMO-001"},{"lineId":"line-2","spentOn":"2026-10-02","category":"TRAVEL","description":"Demo transit","amount":0.20,"receiptRef":"R-DEMO-002"}]},"processVersion":1}
        """); }
    MockHttpServletRequestBuilder write(String path,String actor) { return post(path).with(httpBasic(actor,"test-"+actor+"-password")).header("X-Arcflow-Client","approval-demo").contentType("application/json"); }
    JsonNode result(ResultActions action) throws Exception { return mapper.readTree(action.andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8)); }
    ResultActions submit(String body,String key) throws Exception { return mvc.perform(write(BASE+"/documents","alice").header("Idempotency-Key",key).content(body)); }
    ResultActions decide(String actor,String id,String step,String decision) throws Exception { return mvc.perform(write(BASE+"/requests/"+id+"/decisions",actor).content("{\"stepId\":\""+step+"\",\"decision\":\""+decision+"\",\"comment\":\"Synthetic review\"}")); }
    @Test void catalogAndTwoRealApprovalStagesAreIsolatedAndExactlyKeyed() throws Exception {
        var catalog=result(mvc.perform(get("/api/scenarios").with(httpBasic("alice","test-alice-password"))).andExpect(status().isOk()));
        assertEquals("oa-expense",catalog.get(0).path("id").asText()); assertEquals(20,catalog.get(0).path("lineItems").path("maxItems").asInt());
        var created=result(submit(input().toString(),"expense-one").andExpect(status().isCreated())); String id=created.path("request").path("id").asText();
        assertEquals("0.30",created.path("total").asText()); assertEquals("oa-expense",created.path("request").path("processId").asText());
        assertEquals(created,result(submit(input().toString(),"expense-one").andExpect(status().isCreated())));
        decide("alice",id,"manager","APPROVE").andExpect(status().isForbidden()); decide("carol",id,"finance","APPROVE").andExpect(status().isConflict());
        var first=result(decide("bob",id,"manager","APPROVE").andExpect(status().isOk())); assertEquals("PENDING",first.path("request").path("status").asText());
        var done=result(decide("carol",id,"finance","APPROVE").andExpect(status().isOk())); assertEquals("APPROVED",done.path("request").path("status").asText());
        assertEquals(created.path("request").path("business"),done.path("request").path("business")); assertEquals(3,done.path("request").path("history").size());
        assertEquals(done,result(submit(input().toString(),"expense-one").andExpect(status().isCreated())));
        assertEquals(0,result(mvc.perform(get("/api/requests").with(httpBasic("alice","test-alice-password"))).andExpect(status().isOk())).size());
        mvc.perform(write("/api/requests/"+id+"/decisions","bob").content("{\"stepId\":\"manager\",\"decision\":\"APPROVE\",\"comment\":\"\"}")).andExpect(status().isNotFound());
        mvc.perform(write("/api/documents","alice").content(input().toString())).andExpect(status().isBadRequest());
        var changed=input(); ((ObjectNode)changed.get("business")).put("costCenter","SALES"); submit(changed.toString(),"expense-one").andExpect(status().isConflict());
    }
    @Test void rejectionCannotBeOverwrittenAndPublicationPinsExistingSnapshots() throws Exception {
        var created=result(submit(input().toString(),"expense-two").andExpect(status().isCreated())); String id=created.path("request").path("id").asText();
        var definition=(ObjectNode)created.path("request").path("definition").deepCopy(); definition.put("name","Updated expense policy");
        var publication=mapper.createObjectNode().put("expectedVersion",1).set("definition",definition);
        mvc.perform(write(BASE+"/process","bob").content(publication.toString())).andExpect(status().isForbidden());
        assertEquals(2,result(mvc.perform(write(BASE+"/process","alice").content(publication.toString())).andExpect(status().isOk())).path("version").asInt());
        submit(input().toString(),"new-stale").andExpect(status().isConflict());
        var rejected=result(decide("bob",id,"manager","REJECT").andExpect(status().isOk())); assertEquals("REJECTED",rejected.path("request").path("status").asText());
        assertEquals(1,rejected.path("request").path("processVersion").asInt()); assertEquals(rejected,result(submit(input().toString(),"expense-two").andExpect(status().isCreated())));
        decide("bob",id,"manager","APPROVE").andExpect(status().isConflict());
    }
    @Test void authKeyTypePrecisionAndUnknownFieldsFailClosed() throws Exception {
        mvc.perform(get("/api/scenarios")).andExpect(status().isUnauthorized()); mvc.perform(get("/api/scenarios").with(user("mallory"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/scenarios/missing/process").with(httpBasic("alice","test-alice-password"))).andExpect(status().isNotFound());
        mvc.perform(write(BASE+"/documents","alice").content(input().toString())).andExpect(status().isBadRequest());
        mvc.perform(write(BASE+"/documents","alice").header("Idempotency-Key","x","y").content(input().toString())).andExpect(status().isBadRequest());
        mvc.perform(write(BASE+"/documents","alice").header("Idempotency-Key","key").header("Origin","https://attacker.example").content(input().toString())).andExpect(status().isForbidden());
        for(String value:new String[]{"\"0.10\"","0.001","true","null","0","-1","1000000000.01"}) {
            String body=input().toString().replaceFirst("\"amount\":0[.]1(?:0)?", "\"amount\":"+value); submit(body,"bad").andExpect(status().isBadRequest());
        }
        for(String field:new String[]{"applicantId","processId","total"}) { var body=input(); body.put(field,"forged"); submit(body.toString(),"bad").andExpect(status().isBadRequest()); }
        var wrongType=input(); ((ObjectNode)wrongType.get("business")).put("type","procurement"); submit(wrongType.toString(),"bad").andExpect(status().isBadRequest());
        var duplicate=input().toString().replace("\"documentVersion\":1","\"documentVersion\":1,\"documentVersion\":2"); submit(duplicate,"bad").andExpect(status().isBadRequest());
        var lines=input(); ((ObjectNode)lines.path("business").path("lines").get(1)).put("receiptRef","R-DEMO-001"); submit(lines.toString(),"bad").andExpect(status().isBadRequest());
        var controls=input(); ((ObjectNode)controls.path("business").path("lines").get(0)).put("description","\u0000"); submit(controls.toString(),"control-text").andExpect(status().isBadRequest());
    }
}
