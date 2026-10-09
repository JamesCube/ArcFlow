package com.arcflow.approval.jdbc;

import com.arcflow.approval.*;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** The identical frozen-route and projection contract runs against H2, PostgreSQL and MySQL. */
abstract class ConditionalRoutingStoreContract extends PaymentContractStoreContract {
    private static final ObjectMapper JSON=ApprovalService.strictMapper(new ObjectMapper());
    private static ConditionalRouting.Rule money(String threshold){return new ConditionalRouting.Rule("ALL",List.of(ConditionalRouting.Predicate.money("GTE","CNY",new BigDecimal(threshold))));}
    private static ProcessDefinition definition(String threshold){return new ProcessDefinition(4,"erp-payment",1,"Routed payment",List.of(
        new ProcessDefinition.ProcessNode("start","start","Submit",null),
        new ProcessDefinition.ProcessNode("base","approval","Mandatory","bob"),
        new ProcessDefinition.ProcessNode("risk","parallelApproval","Extra review",null,List.of("bob","carol"),"ALL",money(threshold)),
        new ProcessDefinition.ProcessNode("final","approval","Final","bob"),
        new ProcessDefinition.ProcessNode("end","end","End",null)));}
    private ApprovalService routeService()throws IOException{return new ApprovalService(new JdbcApprovalStore(dataSource,JSON,definition("10000")),USERS);}
    private List<String> memberActors(String id)throws Exception{
        try(var c=dataSource.getConnection();var q=c.prepareStatement("SELECT actor_id FROM arc_request_member WHERE request_id = ? ORDER BY actor_id")){q.setString(1,id);try(var rows=q.executeQuery()){var ids=new ArrayList<String>();while(rows.next())ids.add(rows.getString(1));return ids;}}
    }
    private String payload(String id)throws Exception{try(var c=dataSource.getConnection();var q=c.prepareStatement("SELECT request_json FROM arc_request WHERE request_id = ?")){q.setString(1,id);try(var r=q.executeQuery()){assertTrue(r.next());return r.getString(1);}}}
    private void payload(String id,String value)throws Exception{try(var c=dataSource.getConnection();var q=c.prepareStatement("UPDATE arc_request SET request_json = ? WHERE request_id = ?")){q.setString(1,value);q.setString(2,id);assertEquals(1,q.executeUpdate());}}
    @Test void conditionalRouteSkipsProjectionReadAndVoteRightsAndSurvivesReopen()throws Exception{
        ApprovalService.Request done;
        try(var service=routeService()){
            var low=service.submitDocument("alice",paymentDocument(),1,"low");assertEquals(List.of("base","final"),low.routing().stepIds());
            assertEquals(List.of("bob"),memberActors(low.id()));assertTrue(service.list("carol").isEmpty());assertTrue(service.inbox("carol",Map.of()).items().isEmpty());
            assertEquals(404,result(()->service.decide("carol",low.id(),"risk","APPROVE","Skipped")));
            var next=service.decide("bob",low.id(),"base","APPROVE","First vote");assertEquals("final",next.currentStepId());assertEquals(low.routing(),next.routing());
            done=service.decide("bob",low.id(),"final","APPROVE","Separate final vote");assertEquals("APPROVED",done.status());assertEquals(3,done.history().size());
            assertTrue(service.inbox("carol",Map.of("box",List.of("HANDLED"))).items().isEmpty());assertEquals(List.of("bob"),memberActors(low.id()));
        }
        try(var service=routeService()){assertEquals(done,service.submitDocument("alice",paymentDocument(),1,"low"));assertEquals(done,service.decide("bob",done.id(),"base","APPROVE","Retry"));}
    }
    @Test void conditionalRouteKeepsRetainedDefinitionAndOriginalPathAfterRepublish()throws Exception{
        try(var service=routeService()){
            var low=service.submitDocument("alice",paymentDocument(),1,"before");service.publishForDocument("alice",1,definition("100"),BusinessDocument.PaymentRequest.class);
            var high=service.submitDocument("alice",paymentDocument(),2,"after");assertEquals(List.of("base","risk","final"),high.routing().stepIds());
            assertEquals(List.of("bob"),memberActors(low.id()));assertEquals(List.of("bob","carol"),memberActors(high.id()));
            assertEquals(low,service.submitDocument("alice",paymentDocument(),1,"before"));assertEquals(1,low.processVersion());assertEquals(2,high.processVersion());
            service.decide("bob",high.id(),"base","APPROVE","");var partial=service.decide("carol",high.id(),"risk","APPROVE","");assertEquals("risk",partial.currentStepId());
            assertEquals(List.of("bob"),ApprovalService.pendingApproverIds(partial));var next=service.decide("bob",high.id(),"risk","APPROVE","");assertEquals("final",next.currentStepId());
            var done=service.decide("bob",high.id(),"final","APPROVE","");assertEquals("APPROVED",done.status());assertEquals(5,done.history().size());assertEquals(high.routing(),done.routing());
            assertEquals(List.of(high.definition()),List.of(service.process()));assertEquals("final",service.decide("bob",low.id(),"base","APPROVE","").currentStepId());
        }
    }
    @Test void conditionalRouteConcurrentRetryAndMemberVotesRemainAtomic()throws Exception{
        try(var first=routeService();var second=routeService()){
            first.publishForDocument("alice",1,definition("100"),BusinessDocument.PaymentRequest.class);
            var commands=new ArrayList<Callable<ApprovalService.Request>>();for(int i=0;i<8;i++){var s=i%2==0?first:second;commands.add(()->s.submitDocument("alice",paymentDocument(),2,"route-race"));}
            var results=race(commands);var created=results.get(0);assertTrue(results.stream().allMatch(created::equals));
            assertEquals(1,count("arc_request"));assertEquals(1,count("arc_submission_key"));assertEquals(1,count("arc_request_event"));assertEquals(2,count("arc_request_member"));
            first.decide("bob",created.id(),"base","APPROVE","");race(List.of(()->first.decide("bob",created.id(),"risk","APPROVE","Bob"),()->second.decide("carol",created.id(),"risk","APPROVE","Carol")));
            var current=first.submitDocument("alice",paymentDocument(),2,"route-race");assertEquals("final",current.currentStepId());assertEquals(4,current.history().size());assertEquals(created.routing(),current.routing());
            assertEquals(4,count("arc_request_event"));assertEquals(2,count("arc_request_member"));
        }
    }
    @Test void conditionalRouteFailedAuditRollsBackRequestRouteKeyAndMembers()throws Exception{
        var inserted=new AtomicBoolean();var source=ServerTestSupport.failAfterStatement(dataSource,"INSERT INTO arc_request_event",inserted);
        try(var service=new ApprovalService(new JdbcApprovalStore(source,JSON,definition("10000")),USERS)){
            assertThrows(IOException.class,()->service.submitDocument("alice",paymentDocument(),1,"route-rollback"));assertTrue(inserted.get());
            for(String table:List.of("arc_request","arc_request_event","arc_request_member","arc_submission_key"))assertEquals(0,count(table));
        }
        try(var service=routeService()){var saved=service.submitDocument("alice",paymentDocument(),1,"route-rollback");assertEquals(List.of("base","final"),saved.routing().stepIds());assertEquals(1,count("arc_request_member"));}
    }
    @Test void conditionalRouteTamperedPayloadIsRejectedBeforeReadOrMutation()throws Exception{
        try(var service=routeService()){
            var created=service.submitDocument("alice",paymentDocument(),1,"route-tamper");String original=payload(created.id());
            var forged=(ObjectNode)JSON.readTree(original);((ObjectNode)forged.get("routing")).putArray("stepIds").add("base").add("risk").add("final");String bytes=forged.toString();payload(created.id(),bytes);
            assertThrows(UncheckedIOException.class,()->service.list("alice"));assertThrows(IOException.class,()->service.decide("bob",created.id(),"base","APPROVE","Must not write"));
            assertEquals(bytes,payload(created.id()));assertEquals(1,count("arc_request_event"));assertEquals(1,count("arc_request_member"));payload(created.id(),original);
            assertEquals(created,service.submitDocument("alice",paymentDocument(),1,"route-tamper"));
        }
    }
    @Test void conditionalRouteOldReadyProjectionAndOriginalPayloadRemainUnchanged()throws Exception{
        var legacy=ScenarioCatalog.paymentRequest("bob","carol").initialProcess();ApprovalService.Request old;String original;
        try(var service=new ApprovalService(new JdbcApprovalStore(dataSource,JSON,legacy),USERS)){
            old=service.submitDocument("alice",paymentDocument(),1,"legacy");original=payload(old.id());assertNull(old.routing());assertEquals(List.of("bob","carol"),memberActors(old.id()));
            service.publishForDocument("alice",1,definition("10000"),BusinessDocument.PaymentRequest.class);var newer=service.submitDocument("alice",paymentDocument(),2,"routed");
            assertEquals(List.of("bob"),memberActors(newer.id()));assertEquals(original,payload(old.id()));assertEquals(List.of("bob","carol"),memberActors(old.id()));
            assertEquals(old,service.submitDocument("alice",paymentDocument(),1,"legacy"));
        }
        try(var service=routeService()){assertEquals(original,payload(old.id()));assertEquals(List.of("bob","carol"),memberActors(old.id()));assertEquals(old,service.submitDocument("alice",paymentDocument(),1,"legacy"));}
    }
    @Test void conditionalRoutePublicationAndSubmissionRaceCannotMixVersionAndPath()throws Exception{
        try(var first=routeService();var second=routeService()){
            var results=race(List.<Callable<Integer>>of(()->{first.publishForDocument("alice",1,definition("100"),BusinessDocument.PaymentRequest.class);return 200;},()->result(()->second.submitDocument("alice",paymentDocument(),1,"publication-race"))));
            assertEquals(200,results.get(0));assertTrue(List.of(200,409).contains(results.get(1)));
            for(var saved:first.list("alice")){assertEquals(1,saved.processVersion());assertEquals(List.of("base","final"),saved.routing().stepIds());assertEquals(definition("10000"),saved.definition());}
            var current=first.submitDocument("alice",paymentDocument(),2,"current");assertEquals(List.of("base","risk","final"),current.routing().stepIds());
        }
    }
    @Test void conditionalRouteRetainedVersionAndStrictBooleanChecksMatchJsonContract()throws Exception{
        try(var service=routeService()){
            var created=service.submitDocument("alice",paymentDocument(),1,"strict");String original=payload(created.id());
            service.publishForDocument("alice",1,definition("100"),BusinessDocument.PaymentRequest.class);
            var forged=(ObjectNode)JSON.readTree(original);var definition=(ObjectNode)forged.get("definition");
            ((ObjectNode)definition.path("nodes").get(2).path("runIf").path("predicates").get(0)).put("threshold",1);
            forged.set("routing",JSON.valueToTree(ConditionalRouting.freeze(JSON.treeToValue(definition,ProcessDefinition.class),created.business())));
            var variants=new ArrayList<ObjectNode>();variants.add(forged);
            for(JsonNode value:List.of(TextNode.valueOf("false"),IntNode.valueOf(0),DoubleNode.valueOf(0.0)))for(boolean atom:List.of(false,true)){
                var variant=(ObjectNode)JSON.readTree(original);var evaluation=(ObjectNode)variant.path("routing").path("evaluations").get(0);
                if(atom)evaluation=(ObjectNode)evaluation.path("predicates").get(0);evaluation.set("result",value);variants.add(variant);
            }
            for(var variant:variants){String bytes=variant.toString();payload(created.id(),bytes);assertThrows(UncheckedIOException.class,()->service.list("alice"));assertThrows(IOException.class,()->service.decide("bob",created.id(),"base","APPROVE",""));assertEquals(bytes,payload(created.id()));assertEquals(1,count("arc_request_event"));}
            payload(created.id(),original);assertEquals(created,service.submitDocument("alice",paymentDocument(),1,"strict"));
        }
    }

    @Test void conditionalRouteLostCommitAcknowledgementReplaysOriginalPathAfterPublication()throws Exception{
        var lost=new AtomicBoolean();var uncertain=ServerTestSupport.loseKeyedCommitAcknowledgement(dataSource,lost);
        try(var service=new ApprovalService(new JdbcApprovalStore(uncertain,JSON,definition("10000")),USERS)){
            assertThrows(IOException.class,()->service.submitDocument("alice",paymentDocument(),1,"route-lost-ack"));assertTrue(lost.get());
        }
        try(var service=routeService()){
            service.publishForDocument("alice",1,definition("100"),BusinessDocument.PaymentRequest.class);
            var original=service.submitDocument("alice",paymentDocument(),1,"route-lost-ack");assertEquals(List.of("base","final"),original.routing().stepIds());
            assertEquals(1,original.history().size());assertEquals(1,original.processVersion());assertEquals(List.of("bob"),memberActors(original.id()));
            assertEquals(original,service.submitDocument("alice",paymentDocument(),1,"route-lost-ack"));assertEquals(1,count("arc_request"));assertEquals(1,count("arc_submission_key"));assertEquals(1,count("arc_request_event"));
        }
    }

}
