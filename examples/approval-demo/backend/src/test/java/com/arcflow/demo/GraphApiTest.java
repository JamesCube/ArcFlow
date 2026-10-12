package com.arcflow.demo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
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

/** Security, wire decoding, isolated persistence, graph routing and task-level decisions together. */
@SpringBootTest(properties={"APPROVAL_ALICE_PASSWORD=test-alice-password","APPROVAL_BOB_PASSWORD=test-bob-password","APPROVAL_CAROL_PASSWORD=test-carol-password"})
@AutoConfigureMockMvc
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class GraphApiTest {
    static final String BASE="/api/graphs/payment";
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @DynamicPropertySource static void data(DynamicPropertyRegistry registry)throws Exception {
        var file=Files.createTempDirectory("graph-api-").resolve("state.json");registry.add("approval.data-file",file::toString);
    }
    MockHttpServletRequestBuilder write(String path,String actor) {
        return post(path).with(httpBasic(actor,"test-"+actor+"-password")).header("X-Arcflow-Client","approval-demo").contentType("application/json");
    }
    MockHttpServletRequestBuilder draft(String actor) {
        return put(BASE+"/draft").with(httpBasic(actor,"test-"+actor+"-password")).header("X-Arcflow-Client","approval-demo").contentType("application/json");
    }
    JsonNode result(ResultActions action)throws Exception { return mapper.readTree(action.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8)); }
    JsonNode read(String path,String actor)throws Exception { return result(mvc.perform(get(path).with(httpBasic(actor,"test-"+actor+"-password"))).andExpect(status().isOk())); }
    ObjectNode business()throws Exception { return (ObjectNode)mapper.readTree(PaymentContractApiTest.PAYMENT_DOCUMENT); }
    ObjectNode submission(int version)throws Exception { return mapper.createObjectNode().put("expectedVersion",version).set("business",business()); }
    ResultActions submit(String actor,ObjectNode body,String key)throws Exception { return mvc.perform(write(BASE+"/requests",actor).header("Idempotency-Key",key).content(body.toString())); }
    ResultActions decide(String actor,String id,String task,String decision,String key)throws Exception {
        return mvc.perform(post(java.net.URI.create(BASE+"/requests/"+id+"/tasks/"+task.replace(":","%3A")+"/decision")).with(httpBasic(actor,"test-"+actor+"-password")).header("X-Arcflow-Client","approval-demo").contentType("application/json")
            .header("Idempotency-Key",key).content(mapper.createObjectNode().put("decision",decision).put("comment","Reviewed synthetic payment").toString()));
    }
    ResultActions save(ObjectNode definition,long revision)throws Exception {
        return mvc.perform(draft("alice").content(mapper.createObjectNode().put("expectedRevision",revision).set("definition",definition).toString()));
    }
    ResultActions publish(int version,long revision)throws Exception {
        return mvc.perform(write(BASE+"/publish","alice").content(mapper.createObjectNode().put("expectedVersion",version).put("expectedDraftRevision",revision).toString()));
    }
    ObjectNode graph()throws Exception {
        var current=read(BASE+"/process","alice");
        return (ObjectNode)mapper.readTree("""
        {"schemaVersion":5,"id":"%s","version":%d,"name":"Payment branching and parallel review","nodes":[
          {"id":"start","type":"start","name":"Submit","assigneeIds":[],"completionMode":null,"pairId":null},
          {"id":"amount","type":"exclusiveGateway","name":"Net payment threshold","assigneeIds":[],"completionMode":null,"pairId":"merge"},
          {"id":"high","type":"approval","name":"High amount","assigneeIds":["carol"],"completionMode":"ALL","pairId":null},
          {"id":"low","type":"approval","name":"Ordinary amount","assigneeIds":["bob"],"completionMode":"ALL","pairId":null},
          {"id":"merge","type":"exclusiveMerge","name":"Selected route complete","assigneeIds":[],"completionMode":null,"pairId":"amount"},
          {"id":"fork","type":"parallelFork","name":"Independent checks","assigneeIds":[],"completionMode":null,"pairId":"join"},
          {"id":"a","type":"approval","name":"Invoice check","assigneeIds":["bob"],"completionMode":"ALL","pairId":null},
          {"id":"b","type":"approval","name":"Allocation check","assigneeIds":["bob"],"completionMode":"ALL","pairId":null},
          {"id":"join","type":"parallelJoin","name":"Both checks done","assigneeIds":[],"completionMode":null,"pairId":"fork"},
          {"id":"final","type":"approval","name":"Final review","assigneeIds":["bob"],"completionMode":"ALL","pairId":null},
          {"id":"end","type":"end","name":"Complete","assigneeIds":[],"completionMode":null,"pairId":null}],
        "edges":[
          {"id":"enter","source":"start","target":"amount","label":"Evaluate","condition":null,"defaultBranch":false},
          {"id":"highBranch","source":"amount","target":"high","label":"At least 10000 CNY","condition":{"mode":"ALL","predicates":[{"field":"payment.netTotal","operator":"GTE","currency":"CNY","threshold":10000}]},"defaultBranch":false},
          {"id":"lowBranch","source":"amount","target":"low","label":"Otherwise","condition":null,"defaultBranch":true},
          {"id":"highMerge","source":"high","target":"merge","label":"High done","condition":null,"defaultBranch":false},
          {"id":"lowMerge","source":"low","target":"merge","label":"Low done","condition":null,"defaultBranch":false},
          {"id":"parallel","source":"merge","target":"fork","label":"Start checks","condition":null,"defaultBranch":false},
          {"id":"branchA","source":"fork","target":"a","label":"Invoice","condition":null,"defaultBranch":false},
          {"id":"branchB","source":"fork","target":"b","label":"Allocation","condition":null,"defaultBranch":false},
          {"id":"aJoin","source":"a","target":"join","label":"Invoice done","condition":null,"defaultBranch":false},
          {"id":"bJoin","source":"b","target":"join","label":"Allocation done","condition":null,"defaultBranch":false},
          {"id":"finish","source":"join","target":"final","label":"All complete","condition":null,"defaultBranch":false},
          {"id":"exit","source":"final","target":"end","label":"Approved","condition":null,"defaultBranch":false}]}
        """.formatted(current.path("id").asText(),current.path("version").asInt()));
    }
    JsonNode install(ObjectNode definition)throws Exception {
        var workspace=read(BASE+"/workspace","alice");
        var saved=result(save(definition,workspace.path("draft").path("revision").asLong()).andExpect(status().isOk()));
        return result(publish(workspace.path("definition").path("version").asInt(),saved.path("revision").asLong()).andExpect(status().isOk()));
    }
    List<JsonNode> active(JsonNode instance) { var list=new ArrayList<JsonNode>();instance.path("tasks").forEach(t->{if("ACTIVE".equals(t.path("status").asText()))list.add(t);});return list; }
    JsonNode nodeTask(JsonNode instance,String node) { for(var task:instance.path("tasks"))if(node.equals(task.path("nodeId").asText()))return task;throw new AssertionError("Task not found: "+node); }

    @Test void authenticatesAndUsesCurrentDirectoryAndPublisherPermissions()throws Exception {
        for(String path:List.of("/process","/capabilities","/users","/workspace","/requests"))mvc.perform(get(BASE+path)).andExpect(status().isUnauthorized());
        var capabilities=read(BASE+"/capabilities","alice");assertTrue(capabilities.path("permissions").path("canPublish").asBoolean());assertEquals(32,capabilities.path("limits").path("maxNodes").asInt());
        assertFalse(read(BASE+"/capabilities","bob").path("permissions").path("canPublish").asBoolean());
        var users=read(BASE+"/users","alice");assertEquals(Set.of("bob","carol"),Set.of(users.get(0).path("id").asText(),users.get(1).path("id").asText()));
        mvc.perform(get(BASE+"/workspace").with(httpBasic("bob","test-bob-password"))).andExpect(status().isForbidden());
        var graph=graph();var body=mapper.createObjectNode().put("expectedRevision",0).set("definition",graph);
        mvc.perform(draft("bob").content(body.toString())).andExpect(status().isForbidden());
        mvc.perform(write(BASE+"/validate","bob").content(graph.toString())).andExpect(status().isForbidden());
        mvc.perform(write(BASE+"/preview","bob").content(mapper.createObjectNode().set("definition",graph).toString())).andExpect(status().isBadRequest());
        var preview=mapper.createObjectNode();preview.set("definition",graph);preview.set("business",business());
        mvc.perform(write(BASE+"/preview","bob").content(preview.toString())).andExpect(status().isForbidden());
        mvc.perform(write(BASE+"/publish","bob").content("{\"expectedVersion\":1,\"expectedDraftRevision\":0}")).andExpect(status().isForbidden());
        mvc.perform(get(BASE+"/requests").with(user("removed").roles("USER"))).andExpect(status().isForbidden());
    }
    @Test void preservesOriginAndClientHeaderProtectionOnEveryGraphWrite()throws Exception {
        mvc.perform(post(BASE+"/validate").with(httpBasic("alice","test-alice-password")).contentType("application/json").content(graph().toString())).andExpect(status().isForbidden());
        mvc.perform(put(BASE+"/draft").with(httpBasic("alice","test-alice-password")).contentType("application/json").content("{}")).andExpect(status().isForbidden());
        mvc.perform(write(BASE+"/validate","alice").header("Origin","https://foreign.example").content(graph().toString())).andExpect(status().isForbidden());
        mvc.perform(get(BASE+"/process").with(httpBasic("alice","test-alice-password")).header("Sec-Fetch-Site","cross-site")).andExpect(status().isForbidden());
        mvc.perform(write(BASE+"/validate","alice").header("Origin","http://localhost:5173").content(graph().toString())).andExpect(status().isOk());
    }
    @Test void incompleteDraftsPersistButCannotPublishAndBothCompareAndSwapTokensMatter()throws Exception {
        var workspace=read(BASE+"/workspace","alice");var definition=graph();definition.set("edges",mapper.createArrayNode());long revision=workspace.path("draft").path("revision").asLong();
        var saved=result(save(definition,revision).andExpect(status().isOk()));assertEquals(revision+1,saved.path("revision").asLong());
        assertEquals(saved,read(BASE+"/workspace","alice").get("draft"));assertEquals(workspace.get("definition"),read(BASE+"/process","alice"));
        var validation=result(mvc.perform(write(BASE+"/validate","alice").content(definition.toString())).andExpect(status().isOk()));assertFalse(validation.path("diagnostics").isEmpty());
        publish(1,saved.path("revision").asLong()).andExpect(status().isBadRequest());save(graph(),revision).andExpect(status().isConflict());
        var ready=result(save(graph(),saved.path("revision").asLong()).andExpect(status().isOk()));
        publish(1,saved.path("revision").asLong()).andExpect(status().isConflict());publish(2,ready.path("revision").asLong()).andExpect(status().isConflict());
        var published=result(publish(1,ready.path("revision").asLong()).andExpect(status().isOk()));assertEquals(2,published.path("version").asInt());
        var after=read(BASE+"/workspace","alice");assertEquals(published,after.path("draft").path("definition"));assertEquals(2,after.path("draft").path("baseVersion").asInt());assertTrue(after.path("requests").isEmpty());
    }
    @Test void invalidTopologyDiagnosticsBlockPublicationWithoutChangingPublishedVersion()throws Exception {
        var variants=new ArrayList<ObjectNode>();
        var cycle=graph();((ObjectNode)cycle.path("edges").get(10)).put("target","fork");variants.add(cycle);
        var crossing=graph();((ObjectNode)crossing.path("edges").get(8)).put("target","b");variants.add(crossing);
        var pair=graph();((ObjectNode)pair.path("nodes").get(5)).put("pairId","merge");variants.add(pair);
        var noDefault=graph();((ObjectNode)noDefault.path("edges").get(2)).put("defaultBranch",false);variants.add(noDefault);
        var detached=graph();((ArrayNode)detached.get("nodes")).add(mapper.createObjectNode().put("id","detached").put("type","approval").put("name","Detached").put("completionMode","ALL").putNull("pairId").set("assigneeIds",mapper.createArrayNode().add("bob")));variants.add(detached);
        for(var invalid:variants) {
            var before=read(BASE+"/workspace","alice");
            var diagnostic=result(mvc.perform(write(BASE+"/validate","alice").content(invalid.toString())).andExpect(status().isOk()));assertFalse(diagnostic.path("diagnostics").isEmpty());
            var saved=result(save(invalid,before.path("draft").path("revision").asLong()).andExpect(status().isOk()));
            publish(1,saved.path("revision").asLong()).andExpect(status().isBadRequest());assertEquals(before.get("definition"),read(BASE+"/process","alice"));
        }
    }
    @Test void previewUsesServerNetTotalWithoutWritingAndRejectsWrongTypeCurrencyAndForgedTotals()throws Exception {
        var definition=graph();var before=read(BASE+"/workspace","alice");
        var input=mapper.createObjectNode();input.set("definition",definition);input.set("business",business());
        var preview=result(mvc.perform(write(BASE+"/preview","alice").content(input.toString())).andExpect(status().isOk()));
        assertEquals("low",active(preview).get(0).path("nodeId").asText());assertEquals("lowBranch",preview.path("routes").get(0).path("selectedEdgeId").asText());
        assertEquals("CNY 6500",preview.path("routes").get(0).path("evaluations").get(0).path("facts").get(0).path("actualValue").asText());
        assertEquals(before,read(BASE+"/workspace","alice"));assertTrue(read(BASE+"/requests","alice").isEmpty());
        ((ObjectNode)input.get("business")).put("currency","USD");mvc.perform(write(BASE+"/preview","alice").content(input.toString())).andExpect(status().isBadRequest());
        input.set("business",mapper.readTree(PaymentContractApiTest.CONTRACT_DOCUMENT));mvc.perform(write(BASE+"/preview","alice").content(input.toString())).andExpect(status().isBadRequest());
        input.set("business",business().put("netTotal",999999));mvc.perform(write(BASE+"/preview","alice").content(input.toString())).andExpect(status().isBadRequest());
        assertEquals(before,read(BASE+"/workspace","alice"));
    }
    @Test void strictGraphAndBusinessBodiesNeverAcceptMissingUnknownDuplicateOrComputedState()throws Exception {
        var graph=graph();
        for(String field:List.of("schemaVersion","id","version","name","nodes","edges")){var bad=graph.deepCopy();bad.remove(field);mvc.perform(write(BASE+"/validate","alice").content(bad.toString())).andExpect(status().isBadRequest());}
        for(String field:List.of("id","type","name","assigneeIds","completionMode","pairId")){var bad=graph.deepCopy();((ObjectNode)bad.path("nodes").get(0)).remove(field);mvc.perform(write(BASE+"/validate","alice").content(bad.toString())).andExpect(status().isBadRequest());}
        for(String field:List.of("id","source","target","label","condition","defaultBranch")){var bad=graph.deepCopy();((ObjectNode)bad.path("edges").get(0)).remove(field);mvc.perform(write(BASE+"/validate","alice").content(bad.toString())).andExpect(status().isBadRequest());}
        var forged=graph.deepCopy().put("script","return true");mvc.perform(write(BASE+"/validate","alice").content(forged.toString())).andExpect(status().isBadRequest());
        for(String raw:List.of(graph.toString()+" {}",graph.toString().replace("\"schemaVersion\":5","\"schemaVersion\":5,\"schemaVersion\":5"),graph.toString().replace("\"defaultBranch\":false","\"defaultBranch\":\"false\"")))mvc.perform(write(BASE+"/validate","alice").content(raw)).andExpect(status().isBadRequest());
        install(graph);
        for(String field:List.of("applicantId","tasks","routes","definition","commandRevision","status"))submit("alice",submission(2).put(field,"forged"),"forged-"+field).andExpect(status().isBadRequest());
        for(String raw:List.of(submission(2).toString().replace("\"documentVersion\":1","\"documentVersion\":-0"),submission(2).toString().replace("\"documentVersion\":1","\"documentVersion\":1.0"),submission(2).toString().replace("\"documentVersion\":1","\"documentVersion\":\"1\"")))mvc.perform(write(BASE+"/requests","alice").header("Idempotency-Key","bad-number").content(raw)).andExpect(status().isBadRequest());
        mvc.perform(write(BASE+"/requests","alice").content(submission(2).toString())).andExpect(status().isBadRequest());
        mvc.perform(write(BASE+"/requests","alice").header("Idempotency-Key","one","two").content(submission(2).toString())).andExpect(status().isBadRequest());
        assertTrue(read(BASE+"/requests","alice").isEmpty());
    }
    @Test void newPublicationDoesNotChangeExistingBusinessRoutesOrReadVisibility()throws Exception {
        var published=install(graph());var created=result(submit("alice",submission(2),"frozen").andExpect(status().isCreated()));String id=created.path("id").asText();
        assertEquals(published,created.get("definition"));assertTrue(read(BASE+"/requests","carol").isEmpty());
        mvc.perform(get(BASE+"/requests/"+id).with(httpBasic("carol","test-carol-password"))).andExpect(status().isForbidden());
        decide("carol",id,id+":low","APPROVE","wrong-reader").andExpect(status().isForbidden());
        var next=graph();((ObjectNode)next.path("edges").get(1).path("condition").path("predicates").get(0)).put("threshold",5000);install(next);
        assertEquals(created,read(BASE+"/requests/"+id,"alice"));assertEquals(created,result(submit("alice",submission(2),"frozen").andExpect(status().isCreated())));
        var newer=result(submit("bob",submission(3),"newer").andExpect(status().isCreated()));assertEquals("high",active(newer).get(0).path("nodeId").asText());assertEquals(1,read(BASE+"/requests","carol").size());
        mvc.perform(get(BASE+"/requests/"+newer.path("id").asText()).with(httpBasic("alice","test-alice-password"))).andExpect(status().isForbidden());
        submit("alice",submission(3),"frozen").andExpect(status().isConflict());
    }
    @Test void concurrentDistinctTaskCommandsSurviveAndJoinActivatesExactlyOnce()throws Exception {
        install(graph());var created=result(submit("alice",submission(2),"parallel").andExpect(status().isCreated()));String id=created.path("id").asText();
        var forked=result(decide("bob",id,id+":low","APPROVE","first").andExpect(status().isOk()));assertEquals(Set.of("a","b"),Set.of(active(forked).get(0).path("nodeId").asText(),active(forked).get(1).path("nodeId").asText()));
        assertEquals(2,forked.path("forks").get(0).path("expectedBranchIds").size());
        var executor=Executors.newFixedThreadPool(2);
        try {
            var first=executor.submit(()->decide("bob",id,id+":a","APPROVE","command-a").andExpect(status().isOk()));
            var second=executor.submit(()->decide("bob",id,id+":b","APPROVE","command-b").andExpect(status().isOk()));
            first.get(20,TimeUnit.SECONDS);second.get(20,TimeUnit.SECONDS);
        } finally {executor.shutdownNow();}
        var joined=read(BASE+"/requests/"+id,"alice");assertEquals(3,joined.path("commandRevision").asLong());assertEquals(3,joined.path("commands").size());assertEquals(1,active(joined).size());assertEquals("final",active(joined).get(0).path("nodeId").asText());
        assertTrue(joined.path("forks").get(0).path("fired").asBoolean());assertEquals(2,joined.path("forks").get(0).path("arrivedBranchIds").size());
        result(decide("bob",id,id+":a","APPROVE","command-a").andExpect(status().isOk()));assertEquals(joined,read(BASE+"/requests/"+id,"alice"));
        decide("bob",id,id+":a","REJECT","command-a").andExpect(status().isConflict());
        decide("bob",id,id+":a","REJECT","opposite").andExpect(status().isConflict());
        var completed=result(decide("bob",id,id+":final","APPROVE","final-command").andExpect(status().isOk()));assertEquals("APPROVED",completed.path("status").asText());assertTrue(active(completed).isEmpty());assertEquals(4,completed.path("commandRevision").asLong());
        long sequence=0;for(var event:completed.path("events"))assertEquals(++sequence,event.path("sequence").asLong());
    }
    @Test void freshKeyReplayIsDurablyBoundWithoutDuplicatingTheOriginalVote()throws Exception {
        install(graph());var created=result(submit("alice",submission(2),"alias-submit").andExpect(status().isCreated()));String id=created.path("id").asText();
        var voted=result(decide("bob",id,id+":low","APPROVE","original-command").andExpect(status().isOk()));
        var alias=result(decide("bob",id,id+":low","APPROVE","alias-command").andExpect(status().isOk()));
        assertEquals(voted.get("tasks"),alias.get("tasks"));assertEquals(2,alias.path("commandRevision").asLong());assertEquals(2,alias.path("commands").size());
        assertEquals("COMMAND_REPLAYED",alias.path("events").get(alias.path("events").size()-1).path("type").asText());
        assertEquals(alias,result(decide("bob",id,id+":low","APPROVE","alias-command").andExpect(status().isOk())));
        assertEquals(alias,result(decide("bob",id,id+":low","APPROVE","original-command").andExpect(status().isOk())));
        decide("bob",id,id+":a","APPROVE","alias-command").andExpect(status().isConflict());
        decide("bob",id,id+":low","REJECT","alias-command").andExpect(status().isConflict());
        assertEquals(alias,read(BASE+"/requests/"+id,"alice"));
    }
    @Test void terminalRejectionCancelsSiblingTasksAtomicallyAndUnknownTasksCannotVote()throws Exception {
        install(graph());var created=result(submit("alice",submission(2),"reject").andExpect(status().isCreated()));String id=created.path("id").asText();
        decide("bob",id,id+":final","APPROVE","premature").andExpect(status().isNotFound());
        decide("bob",id,id+":low","APPROVE","first").andExpect(status().isOk());
        var rejected=result(decide("bob",id,id+":a","REJECT","reject-a").andExpect(status().isOk()));assertEquals("REJECTED",rejected.path("status").asText());assertEquals("CANCELLED",nodeTask(rejected,"b").path("status").asText());assertTrue(active(rejected).isEmpty());
        decide("bob",id,id+":b","APPROVE","late-b").andExpect(status().isConflict());assertEquals(rejected,read(BASE+"/requests/"+id,"alice"));
    }
}
