package com.arcflow.demo;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
class ReceivingApiTest {
    static final String BASE="/api/scenarios/erp-receiving";
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @DynamicPropertySource static void data(DynamicPropertyRegistry registry) throws Exception {
        var file=Files.createTempDirectory("receiving-api-test-").resolve("state.json");registry.add("approval.data-file",file::toString);
    }
    ObjectNode input() throws Exception {return (ObjectNode)mapper.readTree("""
        {"business":{"type":"receiving","documentVersion":1,"businessId":"GR-DEMO-001","title":"Goods receipt review","reason":"Synthetic manual PO snapshot","purchaseOrderRef":"PO-DEMO-001","warehouse":"EAST","receivedOn":"2026-10-09","lines":[{"lineId":"line-1","orderLineRef":"PO-L1","description":"Demo sensor","unit":"PCS","ordered":20,"received":10,"accepted":8,"rejected":2,"exceptionReason":"Damaged casing"},{"lineId":"line-2","orderLineRef":"PO-L2","description":"Demo cables","unit":"BOX","ordered":10,"received":5,"accepted":5,"rejected":0,"exceptionReason":""}]},"processVersion":1}
        """);}
    MockHttpServletRequestBuilder write(String path,String actor){return post(path).with(httpBasic(actor,"test-"+actor+"-password")).header("X-Arcflow-Client","approval-demo").contentType("application/json");}
    JsonNode result(ResultActions action)throws Exception{return mapper.readTree(action.andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8));}
    ResultActions submit(String body,String key)throws Exception{return mvc.perform(write(BASE+"/documents","alice").header("Idempotency-Key",key).content(body));}
    ResultActions decide(String actor,String id,String step,String decision)throws Exception{return mvc.perform(write(BASE+"/requests/"+id+"/decisions",actor).content("{\"stepId\":\""+step+"\",\"decision\":\""+decision+"\",\"comment\":\"Synthetic review\"}"));}
    @Test void twoTypedCatalogEntriesAndQuantitySummaryKeepExpenseContractUnchanged()throws Exception{
        var catalog=result(mvc.perform(get("/api/scenarios").with(httpBasic("alice","test-alice-password"))).andExpect(status().isOk()));
        assertEquals(4,catalog.size());var types=new HashSet<String>();catalog.forEach(t->types.add(t.path("id").asText()));assertEquals(Set.of("erp-receiving","oa-expense","oa-seal-use","oa-travel"),types);
        var created=result(submit(input().toString(),"one").andExpect(status().isCreated()));assertTrue(created.has("total"));assertTrue(created.get("total").isNull());
        assertEquals("receiving",created.path("summary").path("kind").asText());assertEquals(1,created.path("summary").path("exceptionLineCount").asInt());
        var quantities=created.path("summary").path("quantities");assertEquals(2,quantities.size());assertEquals("PCS",quantities.get(0).path("unit").asText());assertEquals(10,quantities.get(0).path("received").asInt());assertEquals("BOX",quantities.get(1).path("unit").asText());
        String id=created.path("request").path("id").asText();assertEquals(created,result(submit(input().toString(),"one").andExpect(status().isCreated())));
        var first=result(decide("bob",id,"receiving-inspection","APPROVE").andExpect(status().isOk()));assertEquals("receiving-inspection",first.path("request").path("currentStepId").asText());
        assertEquals(first,result(decide("bob",id,"receiving-inspection","APPROVE").andExpect(status().isOk())));
        decide("bob",id,"procurement-review","APPROVE").andExpect(status().isConflict());
        var second=result(decide("carol",id,"receiving-inspection","APPROVE").andExpect(status().isOk()));assertEquals("procurement-review",second.path("request").path("currentStepId").asText());
        var done=result(decide("bob",id,"procurement-review","APPROVE").andExpect(status().isOk()));assertEquals("APPROVED",done.path("request").path("status").asText());assertEquals(4,done.path("request").path("history").size());
        assertEquals(created.path("request").path("business"),done.path("request").path("business"));assertEquals(created.path("summary"),done.path("summary"));
        assertEquals(0,result(mvc.perform(get("/api/scenarios/oa-expense/requests").with(httpBasic("alice","test-alice-password"))).andExpect(status().isOk())).size());
        mvc.perform(write("/api/documents","alice").content(input().toString())).andExpect(status().isBadRequest());
        mvc.perform(write("/api/scenarios/oa-expense/documents","alice").header("Idempotency-Key","wrong-host").content(input().toString())).andExpect(status().isBadRequest());
        mvc.perform(write("/api/scenarios/oa-expense/requests/"+id+"/decisions","bob").content("{\"stepId\":\"receiving-inspection\",\"decision\":\"APPROVE\",\"comment\":\"\"}")).andExpect(status().isNotFound());
    }
    @Test void authPublicationAndAnyRejectionBoundariesRemainReal()throws Exception{
        mvc.perform(get(BASE+"/requests")).andExpect(status().isUnauthorized());mvc.perform(get(BASE+"/requests").with(user("mallory"))).andExpect(status().isForbidden());
        var created=result(submit(input().toString(),"old").andExpect(status().isCreated()));String id=created.path("request").path("id").asText();
        decide("alice",id,"receiving-inspection","APPROVE").andExpect(status().isForbidden());
        var definition=(ObjectNode)created.path("request").path("definition").deepCopy();((ObjectNode)definition.path("nodes").get(1)).put("completionMode","ANY");
        var publication=mapper.createObjectNode().put("expectedVersion",1).set("definition",definition);
        mvc.perform(write(BASE+"/process","bob").content(publication.toString())).andExpect(status().isForbidden());mvc.perform(write(BASE+"/process","alice").content(publication.toString())).andExpect(status().isOk());
        submit(input().toString(),"stale").andExpect(status().isConflict());
        var rejected=result(decide("carol",id,"receiving-inspection","REJECT").andExpect(status().isOk()));assertEquals("REJECTED",rejected.path("request").path("status").asText());assertEquals(1,rejected.path("request").path("processVersion").asInt());
        decide("bob",id,"receiving-inspection","APPROVE").andExpect(status().isConflict());
        var body=input();body.put("processVersion",2);var newer=result(submit(body.toString(),"new").andExpect(status().isCreated()));String next=newer.path("request").path("id").asText();
        assertEquals("PENDING",result(decide("bob",next,"receiving-inspection","REJECT").andExpect(status().isOk())).path("request").path("status").asText());
        assertEquals("procurement-review",result(decide("carol",next,"receiving-inspection","APPROVE").andExpect(status().isOk())).path("request").path("currentStepId").asText());
    }
    @Test void lexicalIntegersReconciliationAndExactlyOneKeyAreEnforcedAtHttpBoundary()throws Exception{
        mvc.perform(write(BASE+"/documents","alice").content(input().toString())).andExpect(status().isBadRequest());mvc.perform(write(BASE+"/documents","alice").header("Idempotency-Key","x","y").content(input().toString())).andExpect(status().isBadRequest());
        for(String value:List.of("-0","10.0","10e0","10.0000000000000000001","\"10\"","null","true","-1","100001","2147483648"))submit(input().toString().replace("\"received\":10","\"received\":"+value),"bad").andExpect(status().isBadRequest());
        for(String field:List.of("applicantId","total","summary")){var body=input();body.put(field,"forged");submit(body.toString(),"bad").andExpect(status().isBadRequest());}
        var mismatch=input();((ObjectNode)mismatch.path("business").path("lines").get(0)).put("accepted",9);submit(mismatch.toString(),"bad").andExpect(status().isBadRequest());
        var reason=input();((ObjectNode)reason.path("business").path("lines").get(0)).put("exceptionReason","\u00a0\u0085\uFEFF");submit(reason.toString(),"bad").andExpect(status().isBadRequest());
        submit(input().toString().replace("\"received\":10","\"received\":10,\"received\":9"),"bad").andExpect(status().isBadRequest());
        var created=result(submit(input().toString(),"good").andExpect(status().isCreated()));var changed=input();((ObjectNode)changed.path("business").path("lines").get(0)).put("received",11).put("accepted",9);submit(changed.toString(),"good").andExpect(status().isConflict());
        assertEquals(created,result(submit(input().toString(),"good").andExpect(status().isCreated())));
    }
    @Test void typeLastNegativeZeroIsRejectedBeforePolymorphicBuffering()throws Exception{
        var body=input();var business=(ObjectNode)body.get("business");business.remove("type");business.put("type","receiving");
        String good=body.toString();String bad=good.replace("\"rejected\":0","\"rejected\":-0");assertNotEquals(good,bad);
        submit(bad,"type-last").andExpect(status().isBadRequest());
        assertEquals(0,result(mvc.perform(get(BASE+"/requests").with(httpBasic("alice","test-alice-password"))).andExpect(status().isOk())).size());
        submit(good,"type-last").andExpect(status().isCreated());
    }

}
