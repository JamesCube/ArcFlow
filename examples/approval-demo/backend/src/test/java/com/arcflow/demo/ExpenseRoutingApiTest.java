package com.arcflow.demo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** The existing expense HTTP host accepts one finite, server-derived monetary fact. */
@SpringBootTest(properties={"APPROVAL_ALICE_PASSWORD=test-alice-password","APPROVAL_BOB_PASSWORD=test-bob-password","APPROVAL_CAROL_PASSWORD=test-carol-password"})
@AutoConfigureMockMvc
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class ExpenseRoutingApiTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    static final String BASE="/api/scenarios/oa-expense";
    static Path dataFile;
    @DynamicPropertySource static void data(DynamicPropertyRegistry registry)throws Exception {
        dataFile=Files.createTempDirectory("expense-routing-api-").resolve("state.json");
        registry.add("approval.data-file",dataFile::toString);
    }
    Path expenseFile(){return Path.of(dataFile+".scenario-oa-expense.json");}
    JsonNode result(ResultActions action)throws Exception{return mapper.readTree(action.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));}
    JsonNode read(String path,String actor)throws Exception{return result(mvc.perform(get(path).with(httpBasic(actor,"test-"+actor+"-password"))).andExpect(status().isOk()));}
    ResultActions postBody(String path,String actor,JsonNode body,String key)throws Exception {
        var request=post(path).with(httpBasic(actor,"test-"+actor+"-password")).header("X-Arcflow-Client","approval-demo").contentType("application/json").content(body.toString());
        if(key!=null) request.header("Idempotency-Key",key);
        return mvc.perform(request);
    }
    ObjectNode publication(int version,String threshold)throws Exception {
        return (ObjectNode)mapper.readTree("""
            {"expectedVersion":%d,"definition":{"schemaVersion":4,"id":"oa-expense","version":%d,"name":"Synthetic expense routing","nodes":[
            {"id":"start","type":"start","name":"Submit","assigneeId":null},
            {"id":"base","type":"approval","name":"Mandatory review","assigneeId":"bob"},
            {"id":"risk","type":"approval","name":"Amount review","assigneeId":"carol","runIf":{"mode":"ALL","predicates":[{"field":"expense.totalAmount","operator":"GTE","currency":"CNY","threshold":%s}]}},
            {"id":"final","type":"approval","name":"Final review","assigneeId":"bob"},
            {"id":"end","type":"end","name":"Complete","assigneeId":null}]}}
            """.formatted(version,version,threshold));
    }
    ObjectNode submission(String second)throws Exception {
        return (ObjectNode)mapper.readTree("""
            {"processVersion":2,"business":{"type":"expense","documentVersion":1,"businessId":"EXP-HTTP-001","title":"Synthetic expense","reason":"Exact multiline routing test","costCenter":"ENGINEERING","currency":"CNY","lines":[
            {"lineId":"line-1","spentOn":"2026-10-01","category":"OFFICE","description":"Synthetic supplies","amount":0.10,"receiptRef":"R-1"},
            {"lineId":"line-2","spentOn":"2026-10-02","category":"TRAVEL","description":"Synthetic transit","amount":%s,"receiptRef":"R-2"}]}}
            """.formatted(second));
    }
    JsonNode publish(int version,String threshold)throws Exception{return result(postBody(BASE+"/process","alice",publication(version,threshold),null).andExpect(status().isOk()));}
    ResultActions submit(ObjectNode body,String key)throws Exception{return postBody(BASE+"/documents","alice",body,key);}
    ResultActions vote(String actor,JsonNode request,String step,String decision)throws Exception {
        return postBody(BASE+"/requests/"+request.path("id").asText()+"/decisions",actor,
            mapper.createObjectNode().put("stepId",step).put("decision",decision).put("comment","Synthetic independent review"),null);
    }
    @Test void exactMultilineBelowEqualAndAboveSelectFrozenRoutesAndRequireHumanVotes()throws Exception {
        JsonNode published=publish(1,"0.30");
        assertEquals(published,read(BASE+"/process","alice"));
        assertEquals(2,published.path("version").asInt());
        var low=result(submit(submission("0.19"),"below").andExpect(status().isCreated()));
        var equal=result(submit(submission("0.20"),"equal").andExpect(status().isCreated()));
        var high=result(submit(submission("0.21"),"above").andExpect(status().isCreated()));
        for(var view:List.of(low,equal,high)) {
            var request=view.get("request");
            assertEquals("PENDING",request.path("status").asText());
            assertEquals("base",request.path("currentStepId").asText());
            assertEquals(published,request.get("definition"));
            assertEquals(1,request.path("routing").path("schemaVersion").asInt());
        }
        assertEquals("0.29",low.path("total").asText());
        assertEquals("0.30",equal.path("total").asText());
        assertEquals("0.31",high.path("total").asText());
        assertEquals(mapper.readTree("[\"base\",\"final\"]"),low.path("request").path("routing").path("stepIds"));
        for(var view:List.of(equal,high)) assertEquals(mapper.readTree("[\"base\",\"risk\",\"final\"]"),view.path("request").path("routing").path("stepIds"));
        assertEquals("CNY 0.3",equal.path("request").path("routing").path("evaluations").get(0).path("predicates").get(0).path("actualValue").asText());
        var lowRequest=low.get("request");
        assertTrue(java.util.stream.StreamSupport.stream(read(BASE+"/requests","carol").spliterator(),false).noneMatch(v->v.path("request").path("id").equals(lowRequest.path("id"))));
        vote("carol",lowRequest,"risk","APPROVE").andExpect(status().isNotFound());
        var next=result(vote("bob",lowRequest,"base","APPROVE").andExpect(status().isOk())).get("request");
        assertEquals("final",next.path("currentStepId").asText());
        assertEquals("APPROVED",result(vote("bob",next,"final","APPROVE").andExpect(status().isOk())).path("request").path("status").asText());
        var equalRequest=equal.get("request");
        vote("carol",equalRequest,"risk","APPROVE").andExpect(status().isConflict());
        next=result(vote("bob",equalRequest,"base","APPROVE").andExpect(status().isOk())).get("request");
        assertEquals("risk",next.path("currentStepId").asText());
        next=result(vote("carol",next,"risk","APPROVE").andExpect(status().isOk())).get("request");
        assertEquals("APPROVED",result(vote("bob",next,"final","APPROVE").andExpect(status().isOk())).path("request").path("status").asText());
        var highApprove=result(submit(submission("0.21"),"above-approve").andExpect(status().isCreated())).get("request");
        next=result(vote("bob",highApprove,"base","APPROVE").andExpect(status().isOk())).get("request");
        assertEquals("risk",next.path("currentStepId").asText());
        next=result(vote("carol",next,"risk","APPROVE").andExpect(status().isOk())).get("request");
        assertEquals("APPROVED",result(vote("bob",next,"final","APPROVE").andExpect(status().isOk())).path("request").path("status").asText());
        next=result(vote("bob",high.get("request"),"base","APPROVE").andExpect(status().isOk())).get("request");
        var rejected=result(vote("carol",next,"risk","REJECT").andExpect(status().isOk()));
        assertEquals("REJECTED",rejected.path("request").path("status").asText());
        assertEquals(high.path("request").get("routing"),rejected.path("request").get("routing"));
        assertEquals(rejected,result(submit(submission("0.21"),"above").andExpect(status().isCreated())));
    }
    @Test void currencyMismatchAndForgedDerivedFieldsDoNotWriteOrReserveKeys()throws Exception {
        publish(1,"0.30"); byte[] before=Files.readAllBytes(expenseFile());
        var foreign=submission("0.20");((ObjectNode)foreign.get("business")).put("currency","USD");
        var error=result(submit(foreign,"reusable").andExpect(status().isBadRequest()));
        assertTrue(error.path("message").asText().contains("currency"));
        assertArrayEquals(before,Files.readAllBytes(expenseFile()));
        assertTrue(read(BASE+"/requests","alice").isEmpty());
        for(String field:List.of("routing","stepIds","evaluations","selectedStepIds","total","totalAmount")) {
            var forged=submission("0.20");forged.putArray(field);
            submit(forged,"forged-"+field).andExpect(status().isBadRequest());
            assertArrayEquals(before,Files.readAllBytes(expenseFile()));
        }
        var forged=submission("0.20");((ObjectNode)forged.get("business")).put("totalAmount",0.01);
        submit(forged,"forged-business").andExpect(status().isBadRequest());
        assertArrayEquals(before,Files.readAllBytes(expenseFile()));
        var valid=result(submit(submission("0.20"),"reusable").andExpect(status().isCreated()));
        assertEquals("0.30",valid.path("total").asText());
        assertEquals(1,read(BASE+"/requests","alice").size());
    }
    @Test void publicationIsValidatedWithoutWritesAndExpenseRulesCannotEscapeHost()throws Exception {
        var baseline=publication(1,"0.30");
        postBody(BASE+"/process","bob",baseline,null).andExpect(status().isForbidden());
        var original=read(BASE+"/process","alice");
        for(String currency:List.of("", "BTC")) {
            var invalid=baseline.deepCopy();((ObjectNode)invalid.path("definition").path("nodes").get(2).path("runIf").path("predicates").get(0)).put("currency",currency);
            postBody(BASE+"/process","alice",invalid,null).andExpect(status().isBadRequest());
        }
        for(String threshold:List.of("-0.01","0.001","20000000000.01")) postBody(BASE+"/process","alice",publication(1,threshold),null).andExpect(status().isBadRequest());
        var invalid=baseline.deepCopy();((ObjectNode)invalid.path("definition")).put("schemaVersion",3);
        postBody(BASE+"/process","alice",invalid,null).andExpect(status().isBadRequest());
        for(String scenario:List.of("erp-payment","erp-receiving","crm-contract","oa-travel","oa-seal-use")) {
            var cross=baseline.deepCopy();((ObjectNode)cross.get("definition")).put("id",scenario);
            postBody("/api/scenarios/"+scenario+"/process","alice",cross,null).andExpect(status().isBadRequest());
        }
        var generic=baseline.deepCopy();((ObjectNode)generic.get("definition")).put("id","leave-approval");
        postBody("/api/process","alice",generic,null).andExpect(status().isBadRequest());
        assertEquals(original,read(BASE+"/process","alice"));
        postBody(BASE+"/process","alice",baseline,null).andExpect(status().isOk());
        postBody(BASE+"/process","alice",baseline,null).andExpect(status().isConflict());
    }
    @Test void republishKeepsPriorBusinessDefinitionRouteAndIdempotencyFrozen()throws Exception {
        publish(1,"0.30");var input=submission("0.19");
        var original=result(submit(input,"frozen").andExpect(status().isCreated()));
        publish(2,"0.10");
        assertEquals(original,result(submit(input,"frozen").andExpect(status().isCreated())));
        submit(input,"new-stale").andExpect(status().isConflict());
        var newer=result(submit(input.deepCopy().put("processVersion",3),"new").andExpect(status().isCreated()));
        assertEquals(3,newer.path("request").path("routing").path("stepIds").size());
        submit(input.deepCopy().put("processVersion",3),"frozen").andExpect(status().isConflict());
        var next=result(vote("bob",original.get("request"),"base","APPROVE").andExpect(status().isOk()));
        assertEquals("final",next.path("request").path("currentStepId").asText());
        assertEquals(original.path("request").get("definition"),next.path("request").get("definition"));
        assertEquals(original.path("request").get("business"),next.path("request").get("business"));
        assertEquals(original.path("request").get("routing"),next.path("request").get("routing"));
        assertEquals(13,mapper.readTree(Files.readAllBytes(expenseFile())).path("schemaVersion").asInt());
    }
}
