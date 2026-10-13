package com.arcflow.demo;

import com.arcflow.approval.graph.GraphQuotePolicy;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"APPROVAL_ALICE_PASSWORD=test-alice-password","APPROVAL_BOB_PASSWORD=test-bob-password","APPROVAL_CAROL_PASSWORD=test-carol-password"})
@AutoConfigureMockMvc
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class GraphBusinessApiTest {
    @Autowired MockMvc mvc; @Autowired ObjectMapper mapper;
    @DynamicPropertySource static void data(DynamicPropertyRegistry registry)throws Exception {var file=Files.createTempDirectory("graph-business-api-").resolve("state.json");registry.add("approval.data-file",file::toString);}
    String base(String scenario){return "/api/graphs/"+scenario;}
    MockHttpServletRequestBuilder write(String path,String actor){return post(path).with(httpBasic(actor,"test-"+actor+"-password")).header("X-Arcflow-Client","approval-demo").contentType("application/json");}
    JsonNode result(ResultActions action)throws Exception{return mapper.readTree(action.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));}
    JsonNode read(String path,String actor)throws Exception{return result(mvc.perform(get(path).with(httpBasic(actor,"test-"+actor+"-password"))).andExpect(status().isOk()));}
    ObjectNode document(String scenario,boolean high,String quoteId)throws Exception {
        return (ObjectNode)mapper.readTree(switch(scenario){
            case "travel" -> """
                {"type":"travel","documentVersion":1,"businessId":"TRAVEL-GRAPH","title":"Synthetic visit","reason":"Project review","destination":"Shanghai","startDate":"2026-11-01","endDate":"2026-11-03","purpose":"CUSTOMER_VISIT","estimatedCost":%s,"currency":"CNY","costCenter":"SALES"}
                """.formatted(high?"10000":"9999.99");
            case "receiving" -> """
                {"type":"receiving","documentVersion":1,"businessId":"RECEIPT-GRAPH","title":"Synthetic receiving","reason":"Quality review","purchaseOrderRef":"PO-1","warehouse":"EAST","receivedOn":"2026-10-13","lines":[{"lineId":"L1","orderLineRef":"POL1","description":"Equipment","unit":"PCS","ordered":10,"received":10,"accepted":%s,"rejected":%s,"exceptionReason":"Synthetic quality finding"}]}
                """.formatted(high?"8":"10",high?"2":"0");
            default -> """
                {"type":"quoteDiscount","businessId":"%s","title":"Synthetic discount","reason":"Commercial review","customerRef":"CUSTOMER-DEMO-A","quoteRevision":1,"item":"设备套装 / Equipment set","quantity":10,"listUnitPrice":1000,"requestedUnitPrice":%s,"currency":"CNY","validUntil":"2099-12-31"}
                """.formatted(quoteId,high?"800":"900");
        });
    }
    String key(String scenario,ObjectNode doc,String other){return scenario.equals("quote")?GraphQuotePolicy.revisionKey(doc.path("businessId").asText(),doc.path("quoteRevision").asInt()):other;}
    ResultActions submit(String scenario,ObjectNode document,String key,String actor)throws Exception{return mvc.perform(write(base(scenario)+"/requests",actor).header("Idempotency-Key",key).content(mapper.createObjectNode().put("expectedVersion",1).set("business",document).toString()));}
    JsonNode decide(String scenario,JsonNode request,String node,String actor,String decision,String key)throws Exception{
        String path=base(scenario)+"/requests/"+request.path("id").asText()+"/tasks/"+request.path("id").asText()+"%3A"+node+"/decision";
        return result(mvc.perform(post(java.net.URI.create(path)).with(httpBasic(actor,"test-"+actor+"-password")).header("X-Arcflow-Client","approval-demo").header("Idempotency-Key",key).contentType("application/json").content(mapper.createObjectNode().put("decision",decision).put("comment","Synthetic review").toString())).andExpect(status().isOk()));
    }
    List<JsonNode> active(JsonNode request){List<JsonNode> tasks=new ArrayList<>();request.path("tasks").forEach(t->{if(t.path("status").asText().equals("ACTIVE"))tasks.add(t);});return tasks;}
    @Test void realBusinessGraphsRunTrueAndDefaultPathsWithIndependentTaskJoinAndRejection()throws Exception{
        for(String scenario:List.of("travel","receiving","quote")){
            var capabilities=read(base(scenario)+"/capabilities","alice");assertEquals(6,capabilities.path("schemaVersion").asInt());assertEquals(scenario.equals("quote")?"quoteDiscount":scenario,capabilities.path("businessType").asText());
            var doc=document(scenario,true,"Q-DEMO-001");var request=result(submit(scenario,doc,key(scenario,doc,"high"),"alice").andExpect(status().isCreated()));
            assertEquals(request,result(submit(scenario,doc,key(scenario,doc,"high"),"alice").andExpect(status().isCreated())));
            if(scenario.equals("travel"))request=decide(scenario,request,"manager","bob","APPROVE","manager");
            var tasks=active(request);assertEquals(2,tasks.size());var first=tasks.get(0);var second=tasks.get(1);
            request=decide(scenario,request,first.path("nodeId").asText(),first.path("participants").get(0).asText(),"APPROVE","first");
            assertEquals(1,active(request).size());assertEquals(second.path("id").asText(),active(request).get(0).path("id").asText());assertFalse(request.path("forks").get(0).path("fired").asBoolean());
            request=decide(scenario,request,second.path("nodeId").asText(),second.path("participants").get(0).asText(),"APPROVE","second");
            assertTrue(request.path("forks").get(0).path("fired").asBoolean());if(scenario.equals("quote"))request=decide(scenario,request,"final","carol","APPROVE","final");assertEquals("APPROVED",request.path("status").asText());
            var low=document(scenario,false,"Q-GRAPH-002");var ordinary=result(submit(scenario,low,key(scenario,low,"low"),"alice").andExpect(status().isCreated()));assertEquals("otherwise",ordinary.path("routes").get(0).path("selectedEdgeId").asText());assertEquals(1,active(ordinary).size());
            ordinary=decide(scenario,ordinary,scenario.equals("travel")?"manager":"standard","bob","APPROVE","ordinary");if(scenario.equals("quote"))ordinary=decide(scenario,ordinary,"final","carol","APPROVE","ordinary-final");assertEquals("APPROVED",ordinary.path("status").asText());assertTrue(ordinary.path("forks").isEmpty());
            var rejectedDoc=document(scenario,true,"Q-GRAPH-003");var rejected=result(submit(scenario,rejectedDoc,key(scenario,rejectedDoc,"reject"),"alice").andExpect(status().isCreated()));if(scenario.equals("travel"))rejected=decide(scenario,rejected,"manager","bob","APPROVE","reject-manager");var target=active(rejected).get(0);rejected=decide(scenario,rejected,target.path("nodeId").asText(),target.path("participants").get(0).asText(),"REJECT","reject-review");assertEquals("REJECTED",rejected.path("status").asText());assertTrue(active(rejected).isEmpty());
        }
        assertTrue(read("/api/graphs/payment/requests","alice").isEmpty());
    }
    @Test void sourceQuotePolicyCannotBeBypassedThroughGraphHttpAndStrictWireRejectsDerivedFacts()throws Exception{
        var quotes=read(base("quote")+"/quotes","alice");assertEquals(3,quotes.size());assertFalse(read(base("quote")+"/capabilities","bob").path("permissions").path("canSubmit").asBoolean());
        var doc=document("quote",true,"Q-DEMO-001");String key=key("quote",doc,"");submit("quote",doc,key,"bob").andExpect(status().isForbidden());submit("quote",doc,"browser-key","alice").andExpect(status().isBadRequest());
        var forged=doc.deepCopy().put("quantity",11);submit("quote",forged,key,"alice").andExpect(status().isConflict());
        var derived=doc.deepCopy().put("discountPercent",20);submit("quote",derived,key,"alice").andExpect(status().isBadRequest());
        var unknown=doc.deepCopy().put("businessId","Q-UNKNOWN");submit("quote",unknown,key("quote",unknown,""),"alice").andExpect(status().isNotFound());
        var process=read(base("quote")+"/process","alice");mvc.perform(write(base("quote")+"/preview","alice").content(mapper.createObjectNode().set("definition",process).toString())).andExpect(status().isBadRequest());
        var preview=mapper.createObjectNode();preview.set("definition",process);preview.set("business",forged);mvc.perform(write(base("quote")+"/preview","alice").content(preview.toString())).andExpect(status().isConflict());
        var accepted=result(submit("quote",doc,key,"alice").andExpect(status().isCreated()));submit("quote",doc.deepCopy().put("requestedUnitPrice",700),key,"alice").andExpect(status().isConflict());assertEquals(accepted,result(submit("quote",doc,key,"alice").andExpect(status().isCreated())));
    }
    @Test void endpointFamilyAndDraftFactValidationAreAuthoritativeAndPublicationCasRemainsScoped()throws Exception{
        for(String scenario:List.of("travel","receiving","quote")){
            var wrong=document(scenario.equals("travel")?"receiving":"travel",true,"Q-DEMO-001");submit(scenario,wrong,"wrong-family","alice").andExpect(status().isBadRequest());
            ObjectNode definition=(ObjectNode)read(base(scenario)+"/process","alice");assertEquals(6,definition.path("schemaVersion").asInt());
            ObjectNode downgraded=definition.deepCopy().put("schemaVersion",5);ObjectNode downgradeBody=mapper.createObjectNode().put("expectedRevision",0);downgradeBody.set("definition",downgraded);
            mvc.perform(put(base(scenario)+"/draft").with(httpBasic("alice","test-alice-password")).header("X-Arcflow-Client","approval-demo").contentType("application/json").content(downgradeBody.toString())).andExpect(status().isBadRequest());
            var paymentDefinition=read("/api/graphs/payment/process","alice");var preview=mapper.createObjectNode();preview.set("definition",paymentDefinition);preview.set("business",document(scenario,true,"Q-DEMO-001"));mvc.perform(write(base(scenario)+"/preview","alice").content(preview.toString())).andExpect(status().isBadRequest());
            ObjectNode bad=definition.deepCopy();for(JsonNode edge:bad.path("edges"))if(!edge.path("condition").isNull()){((ObjectNode)edge.path("condition").path("predicates").get(0)).put("field","unknown.fact");break;}
            var body=mapper.createObjectNode().put("expectedRevision",0);body.set("definition",bad);mvc.perform(put(base(scenario)+"/draft").with(httpBasic("alice","test-alice-password")).header("X-Arcflow-Client","approval-demo").contentType("application/json").content(body.toString())).andExpect(status().isBadRequest());
            body.set("definition",definition);mvc.perform(put(base(scenario)+"/draft").with(httpBasic("alice","test-alice-password")).header("X-Arcflow-Client","approval-demo").contentType("application/json").content(body.toString())).andExpect(status().isOk());
            var publication=mapper.createObjectNode().put("expectedVersion",1).put("expectedDraftRevision",1);mvc.perform(write(base(scenario)+"/publish","alice").content(publication.toString())).andExpect(status().isOk());mvc.perform(write(base(scenario)+"/publish","alice").content(publication.toString())).andExpect(status().isConflict());
        }
        mvc.perform(get("/api/graphs/unknown/process").with(httpBasic("alice","test-alice-password"))).andExpect(status().isNotFound());
        mvc.perform(get("/api/graphs/travel/quotes").with(httpBasic("alice","test-alice-password"))).andExpect(status().isBadRequest());
    }
}
