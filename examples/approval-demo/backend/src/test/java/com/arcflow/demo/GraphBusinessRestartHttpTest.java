package com.arcflow.demo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

/** Real host shutdown/reopen for all three business families, while one parallel branch waits. */
class GraphBusinessRestartHttpTest {
    @TempDir Path directory;
    @Test void restoresEveryScenarioFrozenVersionSourceBindingAndWaitingJoinAcrossHttpRestart()throws Exception {
        var harness=new GraphRestartHttpTest();var fixtures=new GraphBusinessApiTest();fixtures.mapper=harness.mapper;
        Path data=directory.resolve("requests.json");Map<String,JsonNode> waiting=new LinkedHashMap<>();Map<String,ObjectNode> submissions=new LinkedHashMap<>();Map<String,String> keys=new LinkedHashMap<>();
        try(var first=harness.open(data)) {
            for(String scenario:List.of("travel","receiving","quote")) {
                var doc=fixtures.document(scenario,true,"Q-DEMO-001");String key=fixtures.key(scenario,doc,"restart-"+scenario);keys.put(scenario,key);
                ObjectNode submission=harness.mapper.createObjectNode().put("expectedVersion",1);submission.set("business",doc);submissions.put(scenario,submission);
                var created=harness.callScenario(first,scenario,"POST","/requests","alice",submission,key,201);String id=created.path("id").asText();
                if(scenario.equals("travel"))created=harness.callScenario(first,scenario,"POST","/requests/"+id+"/tasks/"+id+"%3Amanager/decision","bob",decision(harness,"manager"),"manager",200);
                var active=fixtures.active(created);var task=active.get(0);
                var before=harness.callScenario(first,scenario,"POST","/requests/"+id+"/tasks/"+task.path("id").asText().replace(":","%3A")+"/decision",task.path("participants").get(0).asText(),decision(harness,"first"),"first",200);
                assertFalse(before.path("forks").get(0).path("fired").asBoolean());assertEquals(1,before.path("forks").get(0).path("arrivedBranchIds").size());waiting.put(scenario,before);
                var definition=harness.callScenario(first,scenario,"GET","/process","alice",null,null,200);ObjectNode draft=harness.mapper.createObjectNode().put("expectedRevision",0);draft.set("definition",definition);
                harness.callScenario(first,scenario,"PUT","/draft","alice",draft,null,200);harness.callScenario(first,scenario,"POST","/publish","alice",harness.mapper.createObjectNode().put("expectedVersion",1).put("expectedDraftRevision",1),null,200);
            }
        }
        for(String suffix:List.of(".travel.graph.json",".receiving.graph.json",".quote.graph.json"))assertEquals(14,harness.mapper.readTree(Files.readString(Path.of(data+suffix))).path("storageSchemaVersion").asInt());
        byte[] payment=Files.readAllBytes(Path.of(data+".graph.json"));
        try(var second=harness.open(data)) {
            for(String scenario:waiting.keySet()) {
                var before=waiting.get(scenario);String id=before.path("id").asText();
                assertEquals(before,harness.callScenario(second,scenario,"GET","/requests/"+id,"alice",null,null,200));assertEquals(before,harness.callScenario(second,scenario,"POST","/requests","alice",submissions.get(scenario),keys.get(scenario),201));assertEquals(1,before.path("definition").path("version").asInt());
                var task=fixtures.active(before).get(0);var joined=harness.callScenario(second,scenario,"POST","/requests/"+id+"/tasks/"+task.path("id").asText().replace(":","%3A")+"/decision",task.path("participants").get(0).asText(),decision(harness,"second"),"second",200);
                assertTrue(joined.path("forks").get(0).path("fired").asBoolean());assertEquals(before.path("business"),joined.path("business"));
                if(scenario.equals("quote"))joined=harness.callScenario(second,scenario,"POST","/requests/"+id+"/tasks/"+id+"%3Afinal/decision","carol",decision(harness,"final"),"final",200);
                assertEquals("APPROVED",joined.path("status").asText());
                assertEquals(joined,harness.callScenario(second,scenario,"POST","/requests/"+id+"/tasks/"+task.path("id").asText().replace(":","%3A")+"/decision",task.path("participants").get(0).asText(),decision(harness,"second"),"second",200));
            }
        }
        assertArrayEquals(payment,Files.readAllBytes(Path.of(data+".graph.json")));
    }
    ObjectNode decision(GraphRestartHttpTest harness,String comment){return harness.mapper.createObjectNode().put("decision","APPROVE").put("comment",comment);}
}
