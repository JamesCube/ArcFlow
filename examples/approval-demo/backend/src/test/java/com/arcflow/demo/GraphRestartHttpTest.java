package com.arcflow.demo;

import com.arcflow.approval.ApprovalService;
import com.arcflow.approval.graph.GraphDefinition;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import static org.junit.jupiter.api.Assertions.*;

/** Real loopback HTTP, complete Spring host shutdown and fresh file-backed host restart. */
class GraphRestartHttpTest {
    @TempDir Path directory;
    final ObjectMapper mapper=ApprovalService.strictMapper(new ObjectMapper());
    final HttpClient client=HttpClient.newHttpClient();
    ConfigurableApplicationContext open(Path path) {
        return new SpringApplicationBuilder(ApprovalApplication.class).run(
            "--server.port=0","--approval.data-file="+path,"--spring.main.banner-mode=off",
            "--APPROVAL_ALICE_PASSWORD=test-alice-password","--APPROVAL_BOB_PASSWORD=test-bob-password","--APPROVAL_CAROL_PASSWORD=test-carol-password");
    }
    JsonNode call(ConfigurableApplicationContext context,String method,String path,String actor,JsonNode body,String key,int status)throws Exception {
        var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+((WebServerApplicationContext)context).getWebServer().getPort()+"/api/graphs/payment"+path))
            .header("Authorization","Basic "+Base64.getEncoder().encodeToString((actor+":test-"+actor+"-password").getBytes(StandardCharsets.UTF_8)))
            .header("X-Arcflow-Client","approval-demo").header("Content-Type","application/json");
        if(key!=null)request.header("Idempotency-Key",key);
        request.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body.toString()));
        var response=client.send(request.build(),HttpResponse.BodyHandlers.ofString());assertEquals(status,response.statusCode(),response.body());return mapper.readTree(response.body());
    }
    GraphDefinition.Node node(String id,String type,String actor,String pair) { return new GraphDefinition.Node(id,type,id,actor==null?List.of():List.of(actor),actor==null?null:"ALL",pair); }
    GraphDefinition.Edge edge(String id,String from,String to) { return new GraphDefinition.Edge(id,from,to,id,null,false); }
    @Test void restartsWithFrozenBusinessOneOutstandingBranchAndDurableCommandReplay()throws Exception {
        Path data=directory.resolve("requests.json");String id;JsonNode frozen,beforeRestart;ObjectNode submission;
        try(var first=open(data)) {
            var workspace=call(first,"GET","/workspace","alice",null,null,200);
            var definition=new GraphDefinition(5,workspace.path("definition").path("id").asText(),1,"Restart acceptance",
                List.of(node("start","start",null,null),node("fork","parallelFork",null,"join"),node("a","approval","bob",null),
                    node("b","approval","carol",null),node("join","parallelJoin",null,"fork"),node("final","approval","bob",null),node("end","end",null,null)),
                List.of(edge("enter","start","fork"),edge("branchA","fork","a"),edge("branchB","fork","b"),edge("aJoin","a","join"),edge("bJoin","b","join"),edge("finish","join","final"),edge("exit","final","end")));
            var draft=mapper.createObjectNode().put("expectedRevision",workspace.path("draft").path("revision").asLong());draft.set("definition",mapper.valueToTree(definition));
            var saved=call(first,"PUT","/draft","alice",draft,null,200);
            call(first,"POST","/publish","alice",mapper.createObjectNode().put("expectedVersion",1).put("expectedDraftRevision",saved.path("revision").asLong()),null,200);
            submission=mapper.createObjectNode().put("expectedVersion",2);submission.set("business",mapper.readTree(PaymentContractApiTest.PAYMENT_DOCUMENT));
            var created=call(first,"POST","/requests","alice",submission,"restart-submit",201);id=created.path("id").asText();frozen=created.path("business");
            beforeRestart=call(first,"POST","/requests/"+id+"/tasks/"+id+"%3Aa/decision","bob",mapper.createObjectNode().put("decision","APPROVE").put("comment","first branch"),"first-command",200);
            assertEquals(1,beforeRestart.path("commandRevision").asLong());assertFalse(beforeRestart.path("forks").get(0).path("fired").asBoolean());
        }
        Path graph=Path.of(data+".graph.json");assertTrue(Files.isRegularFile(graph));assertEquals(14,mapper.readTree(Files.readString(graph)).path("storageSchemaVersion").asInt());
        byte[] legacy=Files.exists(data)?Files.readAllBytes(data):null;
        try(var second=open(data)) {
            assertEquals(beforeRestart,call(second,"GET","/requests/"+id,"alice",null,null,200));
            assertEquals(beforeRestart,call(second,"POST","/requests","alice",submission,"restart-submit",201));
            var joined=call(second,"POST","/requests/"+id+"/tasks/"+id+"%3Ab/decision","carol",mapper.createObjectNode().put("decision","APPROVE").put("comment","second branch"),"second-command",200);
            assertEquals(frozen,joined.get("business"));assertTrue(joined.path("forks").get(0).path("fired").asBoolean());assertEquals(2,joined.path("commandRevision").asLong());
            var complete=call(second,"POST","/requests/"+id+"/tasks/"+id+"%3Afinal/decision","bob",mapper.createObjectNode().put("decision","APPROVE").put("comment","final"),"final-command",200);
            assertEquals("APPROVED",complete.path("status").asText());
            var alias=call(second,"POST","/requests/"+id+"/tasks/"+id+"%3Ab/decision","carol",mapper.createObjectNode().put("decision","APPROVE").put("comment","alias audit note"),"second-alias",200);
            assertEquals(complete.get("tasks"),alias.get("tasks"));assertEquals(4,alias.path("commandRevision").asLong());
        }
        try(var third=open(data)) {
            var current=call(third,"GET","/requests/"+id,"alice",null,null,200);
            call(third,"POST","/requests/"+id+"/tasks/"+id+"%3Ab/decision","carol",mapper.createObjectNode().put("decision","APPROVE").put("comment","second branch"),"second-command",200);
            assertEquals(current,call(third,"GET","/requests/"+id,"alice",null,null,200));call(third,"POST","/requests/"+id+"/tasks/"+id+"%3Ab/decision","carol",mapper.createObjectNode().put("decision","APPROVE").put("comment","alias audit note"),"second-alias",200);
            call(third,"POST","/requests/"+id+"/tasks/"+id+"%3Ab/decision","carol",mapper.createObjectNode().put("decision","APPROVE").put("comment","changed alias payload"),"second-alias",409);
            assertEquals(current,call(third,"GET","/requests/"+id,"alice",null,null,200));assertEquals(4,current.path("commands").size());assertEquals(frozen,current.get("business"));
        }
        if(legacy!=null)assertArrayEquals(legacy,Files.readAllBytes(data));else assertFalse(Files.exists(data));
    }
}
