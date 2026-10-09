package com.arcflow.approval;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class ReceivingScenarioTest {
    @TempDir Path dir;
    final ObjectMapper mapper=ApprovalService.strictMapper(new ObjectMapper());
    final ActorDirectoryTest.Directory actors=new ActorDirectoryTest.Directory();
    ReceivingScenarioTest() { actors.active.addAll(List.of("303","404")); }
    ScenarioCatalog.Entry entry() { return ScenarioCatalog.receiving("202","303","202"); }
    Path file() { return dir.resolve("receiving.json"); }
    ApprovalService service() throws IOException { return new ApprovalService(mapper,file().toString(),actors,entry().initialProcess()); }
    ScenarioCase host() throws IOException { return new ScenarioCase(entry(),service(),actors); }
    static BusinessDocument.Receiving receipt() { return new BusinessDocument.Receiving(1,"GR-DEMO-1"," Receiving review "," Synthetic inspection ","PO-DEMO-1","EAST","2026-10-09",List.of(
        new BusinessDocument.ReceivingLine("line-1","PO-L1"," Demo sensors ","PCS",20,10,8,2," Damaged casing "),
        new BusinessDocument.ReceivingLine("line-2","PO-L2"," Demo cables ","BOX",10,5,5,0,""),
        new BusinessDocument.ReceivingLine("line-3","PO-L3"," Backordered part ","PCS",5,0,0,0,""))); }
    BusinessDocument.Receiving decode(ObjectNode node) throws IOException { return (BusinessDocument.Receiving)mapper.treeToValue(node,BusinessDocument.class); }
    ObjectNode node() { return mapper.valueToTree(receipt()); }
    @Test void allVotesThenSameActorDifferentStagePreserveExactFrozenDataAcrossRetryAndRestart() throws Exception {
        var mutable=new ArrayList<>(receipt().lines()); var original=new BusinessDocument.Receiving(1,receipt().businessId(),receipt().title(),receipt().reason(),receipt().purchaseOrderRef(),receipt().warehouse(),receipt().receivedOn(),mutable); mutable.clear();
        assertEquals(3,original.lines().size()); assertThrows(UnsupportedOperationException.class,()->original.lines().clear());
        ScenarioCase.View done;
        try(var host=host()) {
            var created=host.submit("101",original,1,"receipt"); assertNull(created.total());
            assertEquals(new BusinessDocument.ReceivingSummary("receiving",3,1,List.of(new BusinessDocument.ReceivingQuantities("PCS",10,8,2),new BusinessDocument.ReceivingQuantities("BOX",5,5,0))),created.summary());
            assertEquals("Receiving review",created.request().title()); assertEquals(0,created.request().days());
            assertEquals(10,mapper.readTree(Files.readAllBytes(file())).path("schemaVersion").asInt());
            assertEquals("Demo sensors",((BusinessDocument.Receiving)created.request().business()).lines().get(0).description());
            var first=host.decide("202",created.request().id(),"receiving-inspection","APPROVE","Warehouse counted");
            assertEquals("receiving-inspection",first.request().currentStepId()); assertEquals("303",first.request().approverId());
            assertEquals(first,host.decide("202",created.request().id(),"receiving-inspection","APPROVE","Retry cannot rewrite"));
            ActorDirectoryTest.status(409,()->host.decide("202",created.request().id(),"procurement-review","APPROVE","Too early"));
            var second=host.decide("303",created.request().id(),"receiving-inspection","APPROVE","Quality recorded exceptions");
            assertEquals("procurement-review",second.request().currentStepId());
            done=host.decide("202",created.request().id(),"procurement-review","APPROVE","Procurement reviewed");
            assertEquals("APPROVED",done.request().status()); assertEquals(4,done.request().history().size());
            assertEquals(created.request().business(),done.request().business()); assertEquals(created.summary(),done.summary());
        }
        try(var host=host()) { assertEquals(List.of(done),host.list("101")); assertEquals(done,host.submit("101",receipt(),1,"receipt")); }
    }
    @Test void singleAllRejectionIsTerminalAndUnrelatedActorsCannotReadOrVote() throws Exception {
        try(var host=host()) {
            var created=host.submit("101",receipt(),1,"reject"); String id=created.request().id();
            assertTrue(host.list("404").isEmpty()); ActorDirectoryTest.status(404,()->host.decide("404",id,"receiving-inspection","APPROVE",""));
            ActorDirectoryTest.status(403,()->host.decide("101",id,"receiving-inspection","APPROVE",""));
            var rejected=host.decide("303",id,"receiving-inspection","REJECT","Inspection incomplete"); assertEquals("REJECTED",rejected.request().status());
            assertEquals(2,rejected.request().history().size()); assertEquals(rejected,host.decide("303",id,"receiving-inspection","REJECT","retry"));
            ActorDirectoryTest.status(409,()->host.decide("202",id,"receiving-inspection","APPROVE",""));
            actors.active.remove("101"); ActorDirectoryTest.status(403,()->host.submit("101",receipt(),1,"reject"));
        }
    }
    @Test void strictNumericLexemesMissingUnknownAndDuplicateFieldsCannotEnterDocument() throws Exception {
        String good=mapper.writeValueAsString(receipt());
        for(String value:List.of("-0","1.0","1e0","1.0000000000000000001","\"1\"","true","null","2147483648","1e400")) {
            for(String field:List.of("ordered","received","accepted","rejected")) {
                String bad=good.replaceFirst("\\\""+field+"\\\":\\d+","\""+field+"\":"+value);
                assertThrows(IOException.class,()->mapper.readValue(bad,BusinessDocument.class),field+"="+value);
            }
        }
        for(String field:List.of("documentVersion","businessId","title","reason","purchaseOrderRef","warehouse","receivedOn","lines")) {
            var bad=node();bad.remove(field);assertThrows(IOException.class,()->decode(bad),field);
        }
        for(String field:List.of("lineId","orderLineRef","description","unit","ordered","received","accepted","rejected","exceptionReason")) {
            var bad=node();((ObjectNode)bad.path("lines").get(0)).remove(field);assertThrows(IOException.class,()->decode(bad),field);
        }
        assertThrows(IOException.class,()->mapper.readValue(good.replace("\"ordered\":20","\"ordered\":20,\"ordered\":1"),BusinessDocument.class));
        var unknown=node(); unknown.put("total",15);assertThrows(IOException.class,()->decode(unknown));
    }
    @Test void integerBoundsReconciliationAndRequiredExceptionReasonsAreEnforced() throws Exception {
        var bads=new ArrayList<ObjectNode>();
        for(String field:List.of("ordered","received","accepted","rejected")) for(int value:List.of(-1,100001,Integer.MAX_VALUE)) {
            var bad=node();((ObjectNode)bad.path("lines").get(0)).put(field,value);bads.add(bad);
        }
        for(String value:List.of("", " \u0000 ","\u0085\u00a0\uFEFF")) { var bad=node();((ObjectNode)bad.path("lines").get(0)).put("exceptionReason",value);bads.add(bad); }
        var noOrder=node();((ObjectNode)noOrder.path("lines").get(0)).put("ordered",0);bads.add(noOrder);
        var excess=node();((ObjectNode)excess.path("lines").get(0)).put("received",21).put("accepted",19);bads.add(excess);
        var mismatch=node();((ObjectNode)mismatch.path("lines").get(0)).put("accepted",9);bads.add(mismatch);
        var none=node();for(var line:none.path("lines"))((ObjectNode)line).put("received",0).put("accepted",0).put("rejected",0);bads.add(none);
        for(String date:List.of("0000-01-01","2026-02-29","2026-2-01")) { var bad=node();bad.put("receivedOn",date);bads.add(bad); }
        for(String field:List.of("title","reason")) {var bad=node();bad.put(field,"\u0085\u00a0\uFEFF");bads.add(bad);}
        try(var host=host()) { for(var bad:bads) ActorDirectoryTest.status(400,()->host.submit("101",decode(bad),1,"invalid")); assertTrue(host.list("101").isEmpty()); }
        var max=node(); ((ObjectNode)max.path("lines").get(0)).put("ordered",100000).put("received",100000).put("accepted",0).put("rejected",100000);
        decode(max).validate(); receipt().validate();
    }
    @Test void duplicateLineReferencesLineBoundsAndWrongScenarioRejectButCrossRequestPoIsNotDeduplicated() throws Exception {
        try(var host=host()) {
            for(String field:List.of("lineId","orderLineRef")) { var bad=node();((ObjectNode)bad.path("lines").get(1)).put(field,bad.path("lines").get(0).path(field).asText());ActorDirectoryTest.status(400,()->host.submit("101",decode(bad),1,"bad")); }
            var empty=node(); empty.putArray("lines");ActorDirectoryTest.status(400,()->host.submit("101",decode(empty),1,"bad"));
            var many=node();var lines=many.putArray("lines");for(int i=0;i<21;i++)lines.add(node().path("lines").get(0));ActorDirectoryTest.status(400,()->host.submit("101",decode(many),1,"bad"));
            ActorDirectoryTest.status(400,()->host.submit("101",ExpenseScenarioTest.expense(),1,"bad"));ActorDirectoryTest.status(400,()->host.submit("101",receipt(),1,null));
            var first=host.submit("101",receipt(),1,"one");var second=host.submit("101",receipt(),1,"two");assertNotEquals(first.request().id(),second.request().id());
            assertEquals(2,host.list("101").size()); // Honest scope: different keys do not reserve or debit a PO balance.
        }
    }
    @Test void sameKeyChangedQuantityTextUnitOrLineOrderConflicts() throws Exception {
        try(var host=host()) {
            var saved=host.submit("101",receipt(),1,"key");
            for(String field:List.of("unit","exceptionReason","orderLineRef")) {
                var bad=node();((ObjectNode)bad.path("lines").get(0)).put(field,field.equals("unit")?"BOX":"changed");ActorDirectoryTest.status(409,()->host.submit("101",decode(bad),1,"key"));
            }
            var changed=node();((ObjectNode)changed.path("lines").get(0)).put("received",11).put("accepted",9);ActorDirectoryTest.status(409,()->host.submit("101",decode(changed),1,"key"));
            var ordered=new ArrayList<>(receipt().lines());Collections.reverse(ordered);var reordered=new BusinessDocument.Receiving(1,receipt().businessId(),receipt().title(),receipt().reason(),receipt().purchaseOrderRef(),receipt().warehouse(),receipt().receivedOn(),ordered);ActorDirectoryTest.status(409,()->host.submit("101",reordered,1,"key"));
            assertEquals(saved,host.submit("101",receipt(),1,"key"));
        }
    }
    @Test void designerCanPublishAnyVersionWhileOldAllSnapshotKeepsItsRules() throws Exception {
        try(var host=host()) {
            var old=host.submit("101",receipt(),1,"old");var original=host.process("101");var nodes=new ArrayList<>(original.nodes());var n=nodes.get(1);
            nodes.set(1,new ProcessDefinition.ProcessNode(n.id(),n.type(),"Changed to ANY",null,n.assigneeIds(),"ANY"));
            var edited=new ProcessDefinition(3,original.id(),1,"New review policy",nodes);
            ActorDirectoryTest.status(403,()->host.publish("202",1,edited));assertEquals(2,host.publish("1",1,edited).version());
            ActorDirectoryTest.status(409,()->host.submit("101",receipt(),1,"stale"));var newer=host.submit("101",receipt(),2,"new");
            assertEquals("ALL",old.request().definition().nodes().get(1).completionMode());assertEquals("ANY",newer.request().definition().nodes().get(1).completionMode());
            var pending=host.decide("202",newer.request().id(),n.id(),"REJECT","");assertEquals("PENDING",pending.request().status());assertEquals(n.id(),pending.request().currentStepId());
            assertEquals("procurement-review",host.decide("303",newer.request().id(),n.id(),"APPROVE","").request().currentStepId());
            assertEquals(n.id(),host.decide("202",old.request().id(),n.id(),"APPROVE","").request().currentStepId());
            var rejected=host.submit("101",receipt(),2,"all-reject");host.decide("202",rejected.request().id(),n.id(),"REJECT","");assertEquals("REJECTED",host.decide("303",rejected.request().id(),n.id(),"REJECT","").request().status());
        }
    }
    @Test void schemaSevenUpgradeKeepsImmediateBytesWhileEightNineAndTamperedReceivingFailClosed() throws Exception {
        try(var service=service()) {service.submitDocument("101",ExpenseScenarioTest.expense(),1,"old");}
        byte[] before=Files.readAllBytes(file());assertEquals(7,mapper.readTree(before).path("schemaVersion").asInt());
        try(var service=service()) {service.submitDocument("101",receipt(),1,"new");assertArrayEquals(before,Files.readAllBytes(file().resolveSibling("receiving.json.schema7.bak")));}
        byte[] good=Files.readAllBytes(file());
        for(int schema:List.of(7,8,9,11)) {var bad=(ObjectNode)mapper.readTree(good);bad.put("schemaVersion",schema);byte[] bytes=mapper.writeValueAsBytes(bad);Files.write(file(),bytes);assertThrows(IOException.class,this::service);assertArrayEquals(bytes,Files.readAllBytes(file()));}
        var oversized=(ObjectNode)mapper.readTree(good);oversized.put("schemaVersion",4294967306L);Files.write(file(),mapper.writeValueAsBytes(oversized));assertThrows(IOException.class,this::service);
        Files.write(file(),good);try(var service=service()){assertEquals(2,service.list("101").size());}
        var bad=(ObjectNode)mapper.readTree(good);((ObjectNode)bad.path("requests").get(1).path("business").path("lines").get(0)).put("accepted",9);Files.write(file(),mapper.writeValueAsBytes(bad));assertThrows(IOException.class,this::service);
    }
    @Test void failedUpgradeAndConcurrentRetriesCannotPublishPartialState() throws Exception {
        try(var service=service()){service.submitDocument("101",ExpenseScenarioTest.expense(),1,"old");}
        byte[] before=Files.readAllBytes(file());
        try(var service=service()) {
            Files.delete(file());Files.createDirectory(file());Files.writeString(file().resolve("block"),"block");
            assertThrows(IOException.class,()->service.submitDocument("101",receipt(),1,"key"));assertEquals(1,service.list("101").size());
            assertArrayEquals(before,Files.readAllBytes(file().resolveSibling("receiving.json.schema7.bak")));
            Files.delete(file().resolve("block"));Files.delete(file());Files.write(file(),before);
            var pool=Executors.newFixedThreadPool(8);var gate=new CountDownLatch(1);
            try {var futures=new ArrayList<Future<ApprovalService.Request>>();for(int i=0;i<8;i++)futures.add(pool.submit(()->{gate.await();return service.submitDocument("101",receipt(),1,"key");}));gate.countDown();var ids=new HashSet<String>();for(var future:futures)ids.add(future.get(10,TimeUnit.SECONDS).id());assertEquals(1,ids.size());assertEquals(2,service.list("101").size());}
            finally {pool.shutdownNow();}
        }
    }
    @Test void negativeZeroCannotHideInRequestOrSnapshotTreeConversion() throws Exception {
        ApprovalService.Request request;
        try(var service=service()) {request=service.submitDocument("101",receipt(),1,"zero");}
        String canonical=mapper.writeValueAsString(request);
        for(String field:List.of("received","accepted","rejected")) {
            String bad=canonical.replace("\""+field+"\":0", "\""+field+"\":-0");
            assertNotEquals(canonical,bad);
            assertThrows(IOException.class,()->mapper.readValue(bad,ApprovalService.Request.class),field);
        }
        byte[] good=Files.readAllBytes(file());
        for(String field:List.of("received","accepted","rejected")) {
            byte[] bad=new String(good,java.nio.charset.StandardCharsets.UTF_8).replace("\""+field+"\" : 0", "\""+field+"\" : -0").getBytes(java.nio.charset.StandardCharsets.UTF_8);
            assertFalse(Arrays.equals(good,bad)); Files.write(file(),bad);
            assertThrows(IOException.class,this::service,field); assertArrayEquals(bad,Files.readAllBytes(file()));
        }
        Files.write(file(),good);try(var service=service()){assertEquals(List.of(request),service.list("101"));}
    }
    @Test void sameProcessWrongBusinessTypeCannotOpenAnIsolatedHost() throws Exception {
        try(var service=service()) {
            var wrong=service.submitDocument("101",ExpenseScenarioTest.expense(),1,"wrong-type"); byte[] before=Files.readAllBytes(file());
            assertThrows(IllegalStateException.class,()->new ScenarioCase(entry(),service,actors));
            assertArrayEquals(before,Files.readAllBytes(file())); assertEquals(1,service.list("101").get(0).history().size());
            assertEquals(wrong,service.list("101").get(0));
        }
    }
    @Test void activeHostPollutionIsRejectedBeforeDecisionSubmissionOrPublicationMutation() throws Exception {
        try(var service=service();var host=new ScenarioCase(entry(),service,actors)) {
            var wrong=service.submitDocument("101",ExpenseScenarioTest.expense(),1,"wrong-type");byte[] before=Files.readAllBytes(file());
            assertThrows(IllegalStateException.class,()->host.decide("202",wrong.id(),"receiving-inspection","APPROVE","Never save"));
            assertThrows(IllegalStateException.class,()->host.submit("101",receipt(),1,"new"));
            assertThrows(IllegalStateException.class,()->host.publish("1",1,service.process()));
            assertArrayEquals(before,Files.readAllBytes(file()));assertEquals(1,service.list("101").get(0).history().size());
        }
        try(var service=service()){assertEquals(1,service.list("101").get(0).history().size());}
    }
    @Test void typedDecisionChecksExactRequestEvenIfPreflightReadIsStale() throws Exception {
        try(var store=new JsonApprovalStore(mapper,file().toString(),entry().initialProcess())) {
            ApprovalStore staleList=new ApprovalStore() {
                public ProcessDefinition process()throws IOException{return store.process();}
                public List<ApprovalService.Request> requests(){return List.of();}
                public ApprovalService.Request request(String id)throws IOException{return store.request(id);}
                public boolean publish(String actor,int version,ProcessDefinition next)throws IOException{return store.publish(actor,version,next);}
                public boolean create(int version,ApprovalService.Request next)throws IOException{return store.create(version,next);}
                public ApprovalService.Request submission(String actor,String key)throws IOException{return store.submission(actor,key);}
                public ApprovalService.Request create(int version,ApprovalService.Request next,String key)throws IOException{return store.create(version,next,key);}
                public boolean update(int revision,ApprovalService.Request next)throws IOException{return store.update(revision,next);}
                public void close(){}
            };
            try(var service=new ApprovalService(staleList,actors);var host=new ScenarioCase(entry(),service,actors)) {
                var wrong=service.submitDocument("101",ExpenseScenarioTest.expense(),1,"wrong-type");byte[] before=Files.readAllBytes(file());
                assertThrows(IOException.class,()->host.decide("202",wrong.id(),"receiving-inspection","APPROVE","Never save"));
                assertArrayEquals(before,Files.readAllBytes(file()));assertEquals(1,store.request(wrong.id()).history().size());
            }
        }
    }

    @Test void negativeZeroIsRejectedBeforeTypeLastPolymorphicBuffering() throws Exception {
        var reordered=node();reordered.remove("type");reordered.put("type","receiving");
        String good=mapper.writeValueAsString(reordered);mapper.readValue(good,BusinessDocument.class).validate();
        for(String field:List.of("received","accepted","rejected")) {
            String bad=good.replace("\""+field+"\":0", "\""+field+"\":-0");assertNotEquals(good,bad);
            assertThrows(IOException.class,()->mapper.readValue(bad,BusinessDocument.class),field);
            assertThrows(IOException.class,()->mapper.readValue(bad.getBytes(java.nio.charset.StandardCharsets.UTF_8),BusinessDocument.class),field);
        }
    }

}
