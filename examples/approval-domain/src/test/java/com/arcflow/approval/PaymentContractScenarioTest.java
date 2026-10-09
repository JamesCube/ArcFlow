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

class PaymentContractScenarioTest {
    @TempDir Path dir;
    final ObjectMapper mapper=ApprovalService.strictMapper(new ObjectMapper());
    final ActorDirectoryTest.Directory actors=new ActorDirectoryTest.Directory();
    PaymentContractScenarioTest(){actors.active.addAll(List.of("303","404"));}
    ScenarioCatalog.Entry payment(){return ScenarioCatalog.paymentRequest("202","303");}
    ScenarioCatalog.Entry contract(){return ScenarioCatalog.contractApproval("202","303");}
    ApprovalService service(ScenarioCatalog.Entry entry)throws IOException{return new ApprovalService(mapper,dir.resolve(entry.template().id()+".json").toString(),actors,entry.initialProcess());}
    ScenarioCase host(ScenarioCatalog.Entry entry)throws IOException{return new ScenarioCase(entry,service(entry),actors);}
    BusinessDocument doc(ScenarioCatalog.Entry entry){return entry.documentClass()==BusinessDocument.PaymentRequest.class?PaymentContractDocumentTest.payment():PaymentContractDocumentTest.contract();}
    ObjectNode node(BusinessDocument document){return mapper.valueToTree(document);}
    BusinessDocument decode(ObjectNode node)throws IOException{return mapper.treeToValue(node,BusinessDocument.class);}
    @Test void paymentAllAndAnyAreRealIndependentStagesWithExactFrozenSummary()throws Exception{
        ScenarioCase.View done;
        try(var host=host(payment())){
            var request=host.submit("101",doc(payment()),1,"payment");String id=request.request().id();
            assertEquals("6500.00",request.total());assertEquals("7000.00",request.paymentSummary().grossAllocation());assertNull(request.summary());
            assertEquals(List.of("202","303"),ApprovalService.pendingApproverIds(request.request()));
            var partial=host.decide("202",id,"payment-check","APPROVE","Amounts checked");assertEquals("PENDING",partial.request().status());assertEquals("payment-check",partial.request().currentStepId());assertEquals(List.of("303"),ApprovalService.pendingApproverIds(partial.request()));
            assertEquals(partial,host.decide("202",id,"payment-check","APPROVE","Retry must not overwrite"));
            ActorDirectoryTest.status(409,()->host.decide("202",id,"payment-final","APPROVE","Too early"));
            var next=host.decide("303",id,"payment-check","APPROVE","Purpose checked");assertEquals("payment-final",next.request().currentStepId());assertEquals(List.of("202","303"),ApprovalService.pendingApproverIds(next.request()));
            var rejection=host.decide("202",id,"payment-final","REJECT","Need further review");assertEquals("PENDING",rejection.request().status());assertEquals(List.of("303"),ApprovalService.pendingApproverIds(rejection.request()));
            done=host.decide("303",id,"payment-final","APPROVE","Reviewed independently");assertEquals("APPROVED",done.request().status());assertEquals(5,done.request().history().size());assertEquals(request.request().business(),done.request().business());assertEquals(request.paymentSummary(),done.paymentSummary());
        }
        try(var host=host(payment())){assertEquals(done,host.submit("101",doc(payment()),1,"payment"));assertEquals(List.of(done),host.list("101"));}
    }
    @Test void paymentAnyRequiresAllRejectionsAndAllRejectionDoesNotInventOtherVotes()throws Exception{
        try(var host=host(payment())){
            var all=host.submit("101",doc(payment()),1,"all-reject");var rejected=host.decide("303",all.request().id(),"payment-check","REJECT","Mismatch");assertEquals("REJECTED",rejected.request().status());assertEquals(2,rejected.request().history().size());assertEquals(List.of("101","303"),rejected.request().history().stream().map(ApprovalService.Event::actorId).toList());
            var any=host.submit("101",doc(payment()),1,"any-reject");String id=any.request().id();host.decide("202",id,"payment-check","APPROVE","");host.decide("303",id,"payment-check","APPROVE","");assertEquals("PENDING",host.decide("303",id,"payment-final","REJECT","").request().status());assertEquals("REJECTED",host.decide("202",id,"payment-final","REJECT","").request().status());
        }
    }
    @Test void contractSameReviewerMustVoteAgainAndAllRejectionRemainsInternalReview()throws Exception{
        try(var host=host(contract())){
            var initial=host.submit("101",doc(contract()),1,"contract");String id=initial.request().id();assertEquals("100000.00",initial.total());assertNull(initial.summary());assertNull(initial.paymentSummary());
            var joint=host.decide("202",id,"commercial-review","APPROVE","Commercial terms reviewed");assertEquals("contract-review",joint.request().currentStepId());assertEquals(List.of("202","303"),ApprovalService.pendingApproverIds(joint.request()));
            assertEquals(joint,host.decide("202",id,"commercial-review","APPROVE","Old step replay"));
            var partial=host.decide("202",id,"contract-review","APPROVE","Second independent decision");assertEquals("PENDING",partial.request().status());assertEquals(List.of("303"),ApprovalService.pendingApproverIds(partial.request()));
            var terminal=host.decide("303",id,"contract-review","REJECT","Draft needs revision");assertEquals("REJECTED",terminal.request().status());assertEquals(initial.request().business(),terminal.request().business());assertEquals(4,terminal.request().history().size());
            assertEquals(terminal,host.submit("101",doc(contract()),1,"contract"));
            var newIntent=host.submit("101",doc(contract()),1,"new-intent-same-declared-revision");assertNotEquals(id,newIntent.request().id());assertEquals("PENDING",newIntent.request().status());
        }
    }
    @Test void publishedContractAnyVersionFreezesOldDefinitionAndNewTermData()throws Exception{
        try(var host=host(contract())){
            var old=host.submit("101",doc(contract()),1,"old");var definition=host.process("101");var nodes=new ArrayList<>(definition.nodes());nodes.add(nodes.size()-1,new ProcessDefinition.ProcessNode("contract-final","parallelApproval","Final internal review",null,List.of("202","303"),"ANY"));
            var changed=new ProcessDefinition(3,definition.id(),1,definition.name(),nodes);ActorDirectoryTest.status(403,()->host.publish("202",1,changed));assertEquals(2,host.publish("1",1,changed).version());
            var newer=host.submit("101",doc(contract()),2,"new");assertEquals(4,old.request().definition().nodes().size());assertEquals(5,newer.request().definition().nodes().size());ActorDirectoryTest.status(409,()->host.submit("101",doc(contract()),2,"old"));assertEquals(old,host.submit("101",doc(contract()),1,"old"));
            for(var request:List.of(old,newer)){host.decide("202",request.request().id(),"commercial-review","APPROVE","");host.decide("202",request.request().id(),"contract-review","APPROVE","");var after=host.decide("303",request.request().id(),"contract-review","APPROVE","");assertEquals(request==old?"APPROVED":"PENDING",after.request().status());}
            assertEquals("PENDING",host.decide("202",newer.request().id(),"contract-final","REJECT","").request().status());assertEquals("APPROVED",host.decide("303",newer.request().id(),"contract-final","APPROVE","").request().status());
        }
        try(var host=host(contract())){assertEquals(2,host.process("101").version());assertEquals(1,host.submit("101",doc(contract()),1,"old").request().processVersion());}
    }
    @Test void paymentPublishChangesNewRequestsOnlyAndCrossRequestInvoiceUseIsExplicitlyAllowed()throws Exception{
        try(var host=host(payment())){
            var old=host.submit("101",doc(payment()),1,"old");var definition=host.process("101");var nodes=new ArrayList<>(definition.nodes());nodes.set(2,new ProcessDefinition.ProcessNode("payment-final","approval","Single final review","303"));host.publish("1",1,new ProcessDefinition(3,definition.id(),1,definition.name(),nodes));
            var newer=host.submit("101",doc(payment()),2,"new");assertEquals("ANY",old.request().definition().nodes().get(2).completionMode());assertEquals("approval",newer.request().definition().nodes().get(2).type());assertEquals(old.paymentSummary(),newer.paymentSummary());assertNotEquals(old.request().id(),newer.request().id());
            ActorDirectoryTest.status(409,()->host.submit("101",doc(payment()),2,"old"));assertEquals(old,host.submit("101",doc(payment()),1,"old"));
        }
    }
    @Test void everyValidRootAndLineMutationBindsApplicantKeyIncludingOrdering()throws Exception{
        for(var entry:List.of(payment(),contract()))try(var host=host(entry)){
            BusinessDocument original=doc(entry);var baseline=node(original);var saved=host.submit("101",original,1,"key");var changes=new ArrayList<ObjectNode>();
            for(String field:List.of("businessId","title","reason",entry.documentClass()==BusinessDocument.PaymentRequest.class?"supplierRef":"customerRef")){var n=baseline.deepCopy();n.put(field,field.equals("title")||field.equals("reason")?"Changed text":"NEW-DEMO-REF");changes.add(n);}
            var currency=baseline.deepCopy();currency.put("currency","USD");changes.add(currency);
            String[] lineFields=original instanceof BusinessDocument.PaymentRequest?new String[]{"lineId","invoiceRef","description","deductionReason"}:new String[]{"lineId","milestoneRef","description","acceptanceCriteria"};
            for(String field:lineFields){var n=baseline.deepCopy();((ObjectNode)n.path("lines").get(0)).put(field,"CHANGED");changes.add(n);}
            if(original instanceof BusinessDocument.PaymentRequest){for(String field:List.of("invoiceAmount","previouslySettledAmount","allocationAmount","deductionAmount")){var n=baseline.deepCopy();var row=(ObjectNode)n.path("lines").get(0);row.put(field,row.get(field).decimalValue().add(PaymentContractDocumentTest.money("0.01")));changes.add(n);}var date=baseline.deepCopy();date.put("requestedPaymentOn","2099-01-16");changes.add(date);var order=baseline.deepCopy();var rows=order.putArray("lines");rows.add(baseline.path("lines").get(1));rows.add(baseline.path("lines").get(0));changes.add(order);}
            else {for(String field:List.of("documentRef","deviationReason")){var n=baseline.deepCopy();n.put(field,"CHANGED");changes.add(n);}var revision=baseline.deepCopy();revision.put("contractRevision",2);changes.add(revision);var category=baseline.deepCopy();category.put("contractCategory","PRODUCT");changes.add(category);var standard=baseline.deepCopy();standard.put("termsKind","STANDARD").put("deviationReason","");changes.add(standard);var dates=baseline.deepCopy();dates.put("startOn","2098-12-31").put("endOn","2100-01-01");changes.add(dates);var due=baseline.deepCopy();((ObjectNode)due.path("lines").get(0)).put("dueOn","2099-01-16");changes.add(due);var amount=baseline.deepCopy();amount.put("contractAmount",100001);((ObjectNode)amount.path("lines").get(0)).put("amount",30001);changes.add(amount);}
            for(var changed:changes){var decoded=decode(changed);decoded.validate();ActorDirectoryTest.status(409,()->host.submit("101",decoded,1,"key"));}
            assertEquals(saved,host.submit("101",original,1,"key"));assertEquals(1,host.list("101").size());
        }
    }
    @Test void isolatedHostsRejectWrongTypesAndUnrelatedActorsBeforeMutation()throws Exception{
        for(var entry:List.of(payment(),contract()))try(var host=host(entry)){
            ActorDirectoryTest.status(400,()->host.submit("101",entry.documentClass()==BusinessDocument.PaymentRequest.class?doc(contract()):doc(payment()),1,"wrong"));ActorDirectoryTest.status(400,()->host.submit("101",doc(entry),1,null));assertTrue(host.list("101").isEmpty());
            var saved=host.submit("101",doc(entry),1,"right");assertTrue(host.list("404").isEmpty());ActorDirectoryTest.status(404,()->host.decide("404",saved.request().id(),saved.request().currentStepId(),"APPROVE",""));ActorDirectoryTest.status(403,()->host.decide("101",saved.request().id(),saved.request().currentStepId(),"APPROVE",""));
        }
    }
    @Test void concurrentRetriesBindOneRequestAndRejectedMutationsNeverCreateBackup()throws Exception{
        for(var entry:List.of(payment(),contract()))try(var host=host(entry)){
            var executor=Executors.newFixedThreadPool(8);try{var start=new CountDownLatch(1);var tasks=new ArrayList<Future<ScenarioCase.View>>();for(int i=0;i<16;i++)tasks.add(executor.submit(()->{start.await();return host.submit("101",doc(entry),1,"race");}));start.countDown();var first=tasks.get(0).get();for(var task:tasks)assertEquals(first,task.get());assertEquals(1,host.list("101").size());}finally{executor.shutdownNow();}
            Path path=dir.resolve(entry.template().id()+".json");byte[] before=Files.readAllBytes(path);var invalid=node(doc(entry));invalid.put("documentVersion",2);ActorDirectoryTest.status(400,()->host.submit("101",decode(invalid),1,"bad"));assertArrayEquals(before,Files.readAllBytes(path));
        }
    }
}
