package com.arcflow.demo;

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
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"APPROVAL_ALICE_PASSWORD=test-alice-password","APPROVAL_BOB_PASSWORD=test-bob-password","APPROVAL_CAROL_PASSWORD=test-carol-password"})
@AutoConfigureMockMvc
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class ConditionalRoutingApiTest {
    @Autowired MockMvc mvc; @Autowired ObjectMapper mapper;
    static final String BASE="/api/scenarios/erp-payment";
    @DynamicPropertySource static void data(DynamicPropertyRegistry registry)throws Exception{var file=Files.createTempDirectory("routing-api-").resolve("state.json");registry.add("approval.data-file",file::toString);}
    MockHttpServletRequestBuilder write(String path,String actor){return post(path).with(httpBasic(actor,"test-"+actor+"-password")).header("X-Arcflow-Client","approval-demo").contentType("application/json");}
    JsonNode result(ResultActions action)throws Exception{return mapper.readTree(action.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));}
    JsonNode read(String path,String actor)throws Exception{return result(mvc.perform(get(path).with(httpBasic(actor,"test-"+actor+"-password"))).andExpect(status().isOk()));}
    ObjectNode definition(String processId)throws Exception{return (ObjectNode)mapper.readTree("""
        {"schemaVersion":4,"id":"%s","version":1,"name":"Typed conditional review","nodes":[
        {"id":"start","type":"start","name":"Submit","assigneeId":null},
        {"id":"base","type":"approval","name":"Mandatory review","assigneeId":"bob"},
        {"id":"risk","type":"approval","name":"High amount review","assigneeId":"carol","runIf":{"mode":"ALL","predicates":[{"field":"payment.netTotal","operator":"GTE","currency":"CNY","threshold":10000}]}},
        {"id":"final","type":"approval","name":"Final review","assigneeId":"bob"},
        {"id":"end","type":"end","name":"Complete","assigneeId":null}]}
        """.formatted(processId));}
    ResultActions publish(String path,ObjectNode definition)throws Exception{return mvc.perform(write(path+"/process","alice").content(mapper.createObjectNode().put("expectedVersion",definition.path("version").asInt()).set("definition",definition).toString()));}
    ObjectNode input(boolean high)throws Exception{var body=mapper.createObjectNode().put("processVersion",2);var business=(ObjectNode)mapper.readTree(PaymentContractApiTest.PAYMENT_DOCUMENT);if(high)((ObjectNode)business.path("lines").get(0)).put("invoiceAmount",15000).put("previouslySettledAmount",0).put("allocationAmount",15000);return body.set("business",business);}
    ResultActions submit(ObjectNode input,String key)throws Exception{return mvc.perform(write(BASE+"/documents","alice").header("Idempotency-Key",key).content(input.toString()));}
    ResultActions vote(String actor,String id,String step,String decision)throws Exception{return mvc.perform(write(BASE+"/requests/"+id+"/decisions",actor).content(mapper.createObjectNode().put("stepId",step).put("decision",decision).put("comment","Independent human vote").toString()));}
    @Test void twoBusinessInputsProduceDifferentFrozenPathsAndSkippedOnlyReviewerCannotReadOrVote()throws Exception{
        var published=result(publish(BASE,definition("erp-payment")).andExpect(status().isOk()));assertEquals(2,published.path("version").asInt());
        var low=result(submit(input(false),"low").andExpect(status().isCreated())).get("request");assertEquals(mapper.readTree("[\"base\",\"final\"]"),low.path("routing").path("stepIds"));assertEquals(published,low.get("definition"));
        assertTrue(read(BASE+"/requests","carol").isEmpty());vote("carol",low.path("id").asText(),"risk","APPROVE").andExpect(status().isNotFound());
        var high=result(submit(input(true),"high").andExpect(status().isCreated())).get("request");assertEquals(mapper.readTree("[\"base\",\"risk\",\"final\"]"),high.path("routing").path("stepIds"));assertEquals(1,read(BASE+"/requests","carol").size());
        String lowId=low.path("id").asText(),highId=high.path("id").asText();
        assertEquals("final",result(vote("bob",lowId,"base","APPROVE").andExpect(status().isOk())).path("request").path("currentStepId").asText());
        assertEquals("APPROVED",result(vote("bob",lowId,"final","APPROVE").andExpect(status().isOk())).path("request").path("status").asText());
        vote("carol",highId,"risk","APPROVE").andExpect(status().isConflict());vote("bob",highId,"base","APPROVE").andExpect(status().isOk());
        var rejected=result(vote("carol",highId,"risk","REJECT").andExpect(status().isOk())).get("request");assertEquals("REJECTED",rejected.path("status").asText());assertEquals(high.get("routing"),rejected.get("routing"));
        assertEquals(rejected,result(submit(input(true),"high").andExpect(status().isCreated())).get("request"));assertEquals(3,rejected.path("history").size());
    }
    @Test void routesAndEvaluationsAreNeverAcceptedFromClientAndCurrencyMismatchIsExplicit()throws Exception{
        publish(BASE,definition("erp-payment")).andExpect(status().isOk());
        for(String field:List.of("routing","stepIds","evaluations","selectedStepIds")){var body=input(false);body.putArray(field);submit(body,"forged-"+field).andExpect(status().isBadRequest());}
        var foreign=input(false);((ObjectNode)foreign.get("business")).put("currency","USD");var failure=result(submit(foreign,"foreign").andExpect(status().isBadRequest()));assertTrue(failure.path("message").asText().contains("currency"));
        assertTrue(read(BASE+"/requests","alice").isEmpty());
    }
    @Test void invalidRulesCrossScenarioAndGenericDefinitionsCannotPublish()throws Exception{
        var baseline=definition("erp-payment");var bad=new ArrayList<ObjectNode>();
        var script=baseline.deepCopy();((ObjectNode)script.path("nodes").get(2).path("runIf")).put("script","return true");bad.add(script);
        var string=baseline.deepCopy();((ObjectNode)string.path("nodes").get(2).path("runIf").path("predicates").get(0)).put("threshold","10000");bad.add(string);
        var nested=baseline.deepCopy();((ObjectNode)nested.path("nodes").get(2).path("runIf").path("predicates").get(0)).put("field","business.lines[0].amount");bad.add(nested);
        var old=baseline.deepCopy();old.put("schemaVersion",3);bad.add(old);
        var nullRule=baseline.deepCopy();((ObjectNode)nullRule.path("nodes").get(2)).putNull("runIf");bad.add(nullRule);
        for(var invalid:bad)publish(BASE,invalid).andExpect(status().isBadRequest());
        publish("/api/scenarios/crm-contract",definition("crm-contract")).andExpect(status().isBadRequest());
        publish("/api/scenarios/erp-receiving",definition("erp-receiving")).andExpect(status().isBadRequest());
        publish("/api",definition("leave-approval")).andExpect(status().isBadRequest());
        assertEquals(1,read(BASE+"/process","alice").path("version").asInt());
    }
    @Test void republishAffectsOnlyNewSubmissionWhileOldKeysAndDecisionsKeepRoute()throws Exception{
        publish(BASE,definition("erp-payment")).andExpect(status().isOk());var original=result(submit(input(false),"old").andExpect(status().isCreated())).get("request");
        var next=definition("erp-payment");next.put("version",2);((ObjectNode)next.path("nodes").get(2).path("runIf").path("predicates").get(0)).put("threshold",100);publish(BASE,next).andExpect(status().isOk());
        assertEquals(original,result(submit(input(false),"old").andExpect(status().isCreated())).get("request"));var newInput=input(false).put("processVersion",3);
        var newer=result(submit(newInput,"new").andExpect(status().isCreated())).get("request");assertEquals(3,newer.path("routing").path("stepIds").size());
        assertEquals("final",result(vote("bob",original.path("id").asText(),"base","APPROVE").andExpect(status().isOk())).path("request").path("currentStepId").asText());
        submit(newInput,"old").andExpect(status().isConflict());
    }
}
