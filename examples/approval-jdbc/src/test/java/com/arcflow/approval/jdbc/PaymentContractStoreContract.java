package com.arcflow.approval.jdbc;

import com.arcflow.approval.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Identical payment/contract durability contract on H2 and both actual server families. */
abstract class PaymentContractStoreContract extends ServerApprovalStoreContract {
    private static final ObjectMapper JSON = ApprovalService.strictMapper(new ObjectMapper());
    private static final Map<String,List<String>> PENDING = Map.of("box",List.of("PENDING"));
    private static final Map<String,List<String>> HANDLED = Map.of("box",List.of("HANDLED"));

    static BusinessDocument.PaymentRequest paymentDocument() {
        return new BusinessDocument.PaymentRequest(1,"PAY-SQL-1","Payment application","Synthetic invoice snapshots only",
            "SUPPLIER-DEMO-A","CNY","2099-01-15",List.of(
                new BusinessDocument.PaymentLine("line-1","INV-DEMO-01","Synthetic equipment",new BigDecimal("10000"),new BigDecimal("4000"),new BigDecimal("4500"),new BigDecimal("500"),"Synthetic quality deduction"),
                new BusinessDocument.PaymentLine("line-2","INV-DEMO-02","Synthetic supplies",new BigDecimal("4000"),BigDecimal.ZERO,new BigDecimal("2500"),BigDecimal.ZERO,"")));
    }
    static BusinessDocument.ContractApproval contractDocument() {
        return new BusinessDocument.ContractApproval(1,"CONTRACT-SQL-1","Internal contract review","Synthetic draft, no signature",
            "CUSTOMER-DEMO-A",1,"SERVICE","CNY",new BigDecimal("100000"),"2099-01-01","2099-12-31","NONSTANDARD",
            "Synthetic liability limit deviation","DOC-CONTRACT-DEMO-01",List.of(
                new BusinessDocument.ContractMilestone("line-1","M1","Proposal","2099-01-15",new BigDecimal("30000"),"Proposal delivered and confirmed"),
                new BusinessDocument.ContractMilestone("line-2","M2","Interim delivery","2099-06-30",new BigDecimal("40000"),"Interim acceptance"),
                new BusinessDocument.ContractMilestone("line-3","M3","Final delivery","2099-12-15",new BigDecimal("30000"),"Final acceptance")));
    }
    private ScenarioCatalog.Entry entry(boolean payment) {
        return payment?ScenarioCatalog.paymentRequest("bob","carol"):ScenarioCatalog.contractApproval("bob","carol");
    }
    private ApprovalService service(boolean payment) throws IOException {
        return new ApprovalService(new JdbcApprovalStore(dataSource,new ObjectMapper(),entry(payment).initialProcess()),USERS);
    }
    private BusinessDocument document(boolean payment) { return payment?paymentDocument():contractDocument(); }
    private void counts(int requests,int events) throws Exception {
        assertEquals(requests,count("arc_request")); assertEquals(requests,count("arc_submission_key"));
        assertEquals(events,count("arc_request_event")); assertEquals(requests*2,count("arc_request_member"));
    }
    private List<ApprovalService.Request> inbox(ApprovalService service,String actor,Map<String,List<String>> box) throws IOException {
        return service.inbox(actor,box).items();
    }

    @Test void paymentAllThenAnyVotesRemainIndependentAndDurable() throws Exception {
        ApprovalService.Request done;
        try(var payment=service(true); var contract=service(false); var leave=open()) {
            var created=payment.submitDocument("alice",paymentDocument(),1,"payment-durable");
            assertEquals(List.of(created),inbox(payment,"bob",PENDING)); assertEquals(List.of(created),inbox(payment,"carol",PENDING));
            assertEquals(404,result(()->contract.decide("bob",created.id(),"payment-check","APPROVE","")));
            assertEquals(404,result(()->leave.decide("bob",created.id(),"payment-check","APPROVE","")));
            assertEquals(409,result(()->payment.decide("bob",created.id(),"payment-final","APPROVE","Future step")));
            var first=payment.decide("bob",created.id(),"payment-check","APPROVE","Original ALL opinion");
            assertEquals("PENDING",first.status()); assertEquals("payment-check",first.currentStepId());
            assertTrue(inbox(payment,"bob",PENDING).isEmpty()); assertEquals(List.of(first),inbox(payment,"carol",PENDING));
            assertEquals(first,payment.decide("bob",created.id(),"payment-check","APPROVE","Do not overwrite"));
            assertEquals(first,payment.submitDocument("alice",paymentDocument(),1,"payment-durable"));
            var finalStep=payment.decide("carol",created.id(),"payment-check","APPROVE","ALL complete");
            assertEquals("payment-final",finalStep.currentStepId());
            assertEquals(List.of(finalStep),inbox(payment,"bob",PENDING)); assertEquals(List.of(finalStep),inbox(payment,"bob",HANDLED));
            var declined=payment.decide("bob",created.id(),"payment-final","REJECT","Independent ANY opinion");
            assertEquals("PENDING",declined.status()); assertEquals("payment-final",declined.currentStepId());
            assertEquals(List.of(declined),inbox(payment,"carol",PENDING));
            done=payment.decide("carol",created.id(),"payment-final","APPROVE","ANY approved");
            assertEquals("APPROVED",done.status()); assertEquals(5,done.history().size());
            assertEquals("Original ALL opinion",done.history().get(1).comment());
            assertEquals(created.business(),done.business()); assertEquals(created.definition(),done.definition());
            assertTrue(inbox(payment,"bob",PENDING).isEmpty()); assertTrue(inbox(payment,"carol",PENDING).isEmpty());
            counts(1,5);
        }
        try(var payment=service(true)) {
            assertEquals(done,payment.submitDocument("alice",paymentDocument(),1,"payment-durable"));
            assertEquals(done,payment.decide("bob",done.id(),"payment-check","APPROVE","Later retry"));
            assertEquals(409,result(()->payment.decide("bob",done.id(),"payment-final","APPROVE","Opposite")));
            assertEquals(List.of(done),inbox(payment,"bob",HANDLED)); counts(1,5);
        }
    }

    @Test void paymentAllRejectsImmediatelyAndAnyRequiresEveryRejection() throws Exception {
        try(var payment=service(true)) {
            var all=payment.submitDocument("alice",paymentDocument(),1,"payment-all-reject");
            var rejected=payment.decide("bob",all.id(),"payment-check","REJECT","ALL veto");
            assertEquals("REJECTED",rejected.status()); assertEquals(2,rejected.history().size());
            assertTrue(inbox(payment,"carol",HANDLED).isEmpty()); assertTrue(inbox(payment,"carol",PENDING).isEmpty());
            assertEquals(409,result(()->payment.decide("carol",all.id(),"payment-check","APPROVE","Closed")));
            var any=payment.submitDocument("alice",paymentDocument(),1,"payment-any-reject");
            payment.decide("bob",any.id(),"payment-check","APPROVE",""); payment.decide("carol",any.id(),"payment-check","APPROVE","");
            assertEquals("PENDING",payment.decide("bob",any.id(),"payment-final","REJECT","One rejection").status());
            var finalReject=payment.decide("carol",any.id(),"payment-final","REJECT","Both rejected");
            assertEquals("REJECTED",finalReject.status()); assertEquals(5,finalReject.history().size()); counts(2,7);
            assertEquals(rejected,payment.submitDocument("alice",paymentDocument(),1,"payment-all-reject"));
        }
    }

    @Test void contractRepeatedActorAllRejectionAndOptionalAnySnapshotSurviveReopen() throws Exception {
        ApprovalService.Request oldRejected,newApproved;
        try(var contract=service(false)) {
            var old=contract.submitDocument("alice",contractDocument(),1,"contract-old");
            var definition=contract.process(); var nodes=new ArrayList<>(definition.nodes());
            nodes.add(nodes.size()-1,new ProcessDefinition.ProcessNode("contract-final","parallelApproval","Optional final review",null,List.of("bob","carol"),"ANY"));
            contract.publish("alice",1,new ProcessDefinition(3,definition.id(),1,"Contract policy v2",nodes));
            var newRequest=contract.submitDocument("alice",contractDocument(),2,"contract-new");
            assertEquals(2,old.definition().approvals().size()); assertEquals(definition,old.definition());
            assertEquals(409,result(()->contract.submitDocument("alice",contractDocument(),1,"stale-contract")));
            assertEquals(409,result(()->contract.decide("bob",old.id(),"contract-review","APPROVE","Future")));
            var first=contract.decide("bob",old.id(),"commercial-review","APPROVE","Commercial original");
            assertEquals("contract-review",first.currentStepId());
            assertTrue(inbox(contract,"bob",PENDING).stream().anyMatch(r->r.id().equals(old.id())));
            assertTrue(inbox(contract,"bob",HANDLED).stream().anyMatch(r->r.id().equals(old.id())));
            var partial=contract.decide("bob",old.id(),"contract-review","APPROVE","Second independent vote");
            assertEquals("PENDING",partial.status());
            oldRejected=contract.decide("carol",old.id(),"contract-review","REJECT","Contract terms rejected");
            assertEquals("REJECTED",oldRejected.status()); assertEquals(4,oldRejected.history().size());
            assertEquals(definition,oldRejected.definition()); assertEquals(1,oldRejected.processVersion());
            assertEquals(oldRejected,contract.decide("bob",old.id(),"commercial-review","APPROVE","Ignored retry"));
            contract.decide("bob",newRequest.id(),"commercial-review","APPROVE","");
            contract.decide("bob",newRequest.id(),"contract-review","APPROVE","");
            var any=contract.decide("carol",newRequest.id(),"contract-review","APPROVE","");
            assertEquals("contract-final",any.currentStepId());
            assertEquals("PENDING",contract.decide("bob",newRequest.id(),"contract-final","REJECT","").status());
            newApproved=contract.decide("carol",newRequest.id(),"contract-final","APPROVE","");
            assertEquals("APPROVED",newApproved.status()); assertEquals(6,newApproved.history().size()); counts(2,10);
        }
        try(var contract=service(false)) {
            assertEquals(2,contract.process().version());
            assertEquals(oldRejected,contract.submitDocument("alice",contractDocument(),1,"contract-old"));
            assertEquals(newApproved,contract.submitDocument("alice",contractDocument(),2,"contract-new"));
            assertEquals(409,result(()->contract.decide("carol",oldRejected.id(),"contract-review","APPROVE","Opposite")));
            counts(2,10);
        }
    }

    @Test void paymentAndContractKeysAreApplicantGlobalAcrossEveryRegisteredType() throws Exception {
        var definitions=List.of(ProcessDefinition.legacy("bob"),ProcessDefinition.legacy("bob"),ProcessDefinition.legacy("bob"),ScenarioCatalog.expense("bob","carol").initialProcess(),
            ScenarioCatalog.travel("bob","carol").initialProcess(),ScenarioCatalog.sealUse("bob","carol").initialProcess(),
            ScenarioCatalog.receiving("bob","carol","bob").initialProcess(),entry(true).initialProcess(),entry(false).initialProcess());
        var documents=List.of(new BusinessDocument.Leave("LEAVE-SQL-1","Leave","Rest",1),new BusinessDocument.Procurement("PO-SQL-1","Procurement","Synthetic","Equipment",1,new BigDecimal("100"),"CNY"),new BusinessDocument.QuoteDiscount("QUOTE-SQL-1","Quote","Synthetic","CUSTOMER-DEMO-A",1,"Equipment",1,new BigDecimal("100"),new BigDecimal("90"),"CNY","2099-12-31"),expenseDocument(),travelDocument(),sealUseDocument(),receivingDocument(),paymentDocument(),contractDocument());
        for(boolean payment:List.of(true,false)) {
            String key=payment?"payment-global":"contract-global";
            try(var winner=service(payment)) {
                var saved=winner.submitDocument("alice",document(payment),1,key);
                for(int i=0;i<definitions.size();i++) try(var contender=new ApprovalService(new JdbcApprovalStore(dataSource,new ObjectMapper(),definitions.get(i)),USERS)) {
                    var intent=documents.get(i);
                    if(intent.getClass().equals(document(payment).getClass())) assertEquals(saved,contender.submitDocument("alice",intent,1,key));
                    else assertEquals(409,result(()->contender.submitDocument("alice",intent,1,key)));
                }
            }
        }
        counts(2,2);
    }

    @Test void paymentAndContractConcurrentRetriesCreateOneBindingAndExactAudit() throws Exception {
        for(boolean payment:List.of(true,false)) try(var first=service(payment);var second=service(payment)) {
            String key=payment?"payment-race":"contract-race"; var intent=document(payment);
            var commands=new ArrayList<Callable<ApprovalService.Request>>();
            for(int i=0;i<8;i++){var service=i%2==0?first:second;commands.add(()->service.submitDocument("alice",intent,1,key));}
            var submissions=race(commands); var saved=submissions.get(0); assertTrue(submissions.stream().allMatch(saved::equals));
            String step=payment?"payment-check":"commercial-review";
            commands.clear();for(int i=0;i<8;i++){var service=i%2==0?first:second;commands.add(()->service.decide("bob",saved.id(),step,"APPROVE","Concurrent opinion"));}
            var votes=race(commands);assertTrue(votes.stream().allMatch(votes.get(0)::equals));
            assertEquals(2,votes.get(0).history().size());
        }
        counts(2,4);
    }

    @Test void paymentAndContractCrossProcessRaceHasOneGlobalKeyWinner() throws Exception {
        // Two distinct process-head locks reach the same applicant-global key concurrently.
        var gate=new ServerTestSupport.GateDataSource(dataSource,"INSERT INTO arc_submission_key");
        try(var payment=new ApprovalService(new JdbcApprovalStore(gate,new ObjectMapper(),entry(true).initialProcess()),USERS);
            var contract=service(false)) {
            var executor=java.util.concurrent.Executors.newSingleThreadExecutor();
            try {
                var held=executor.submit(()->result(()->payment.submitDocument("alice",paymentDocument(),1,"cross-global")));
                assertTrue(gate.entered.await(10,java.util.concurrent.TimeUnit.SECONDS));
                var winner=contract.submitDocument("alice",contractDocument(),1,"cross-global");
                gate.release.countDown(); assertEquals(409,held.get(20,java.util.concurrent.TimeUnit.SECONDS));
                assertEquals(winner,contract.submitDocument("alice",contractDocument(),1,"cross-global"));
                assertTrue(payment.list("alice").isEmpty()); counts(1,1);
            } finally { gate.release.countDown(); executor.shutdownNow(); assertTrue(executor.awaitTermination(10,java.util.concurrent.TimeUnit.SECONDS)); }
        }
    }

    private List<BusinessDocument> changedIntents(boolean payment) throws Exception {
        var original=(ObjectNode)JSON.valueToTree(document(payment)); var changed=new ArrayList<BusinessDocument>();
        var head=new LinkedHashMap<String,String>();
        head.put("businessId","NEW-SQL-ID");head.put("title","Changed title");head.put("reason","Changed reason");head.put("currency","USD");
        if(payment){head.put("supplierRef","SUPPLIER-OTHER");head.put("requestedPaymentOn","2099-01-16");}
        else {head.put("customerRef","CUSTOMER-OTHER");head.put("contractCategory","PRODUCT");head.put("startOn","2098-12-31");head.put("endOn","2100-01-01");head.put("deviationReason","Different deviation");head.put("documentRef","DOC-OTHER");}
        for(var item:head.entrySet()){var copy=original.deepCopy();copy.put(item.getKey(),item.getValue());changed.add(JSON.treeToValue(copy,BusinessDocument.class));}
        if(!payment){var copy=original.deepCopy();copy.put("contractRevision",2);changed.add(JSON.treeToValue(copy,BusinessDocument.class));
            copy=original.deepCopy();copy.put("termsKind","STANDARD").put("deviationReason","");changed.add(JSON.treeToValue(copy,BusinessDocument.class));
            copy=original.deepCopy();copy.put("contractAmount",new BigDecimal("100000.01"));((ObjectNode)copy.path("lines").get(2)).put("amount",new BigDecimal("30000.01"));changed.add(JSON.treeToValue(copy,BusinessDocument.class));}
        for(int i=0;i<original.path("lines").size();i++) {
            var values=new LinkedHashMap<String,String>();values.put("lineId","changed-line-"+i);values.put("description","Changed line description");
            if(payment){values.put("invoiceRef","INV-CHANGED-"+i);values.put("deductionReason","Changed deduction explanation");}
            else{values.put("milestoneRef","M-CHANGED-"+i);values.put("acceptanceCriteria","Changed acceptance condition");values.put("dueOn",List.of("2099-01-16","2099-07-01","2099-12-16").get(i));}
            for(var item:values.entrySet()){var copy=original.deepCopy();((ObjectNode)copy.path("lines").get(i)).put(item.getKey(),item.getValue());changed.add(JSON.treeToValue(copy,BusinessDocument.class));}
            for(String field:payment?List.of("invoiceAmount","previouslySettledAmount","allocationAmount","deductionAmount"):List.of("amount")) {
                var copy=original.deepCopy();var line=(ObjectNode)copy.path("lines").get(i);
                line.put(field,line.path(field).decimalValue().add(new BigDecimal("0.01")));
                if(field.equals("deductionAmount"))line.put("deductionReason","Changed deduction explanation");
                if(!payment){int other=(i+1)%3;var offset=(ObjectNode)copy.path("lines").get(other);offset.put("amount",offset.path("amount").decimalValue().subtract(new BigDecimal("0.01")));}
                changed.add(JSON.treeToValue(copy,BusinessDocument.class));
            }
        }
        var reordered=original.deepCopy();var lines=JSON.createArrayNode();
        for(int i=original.path("lines").size()-1;i>=0;i--){var line=(ObjectNode)original.path("lines").get(i).deepCopy();if(!payment)line.put("dueOn","2099-06-30");lines.add(line);}
        reordered.set("lines",lines);changed.add(JSON.treeToValue(reordered,BusinessDocument.class));return changed;
    }
    private void everyFieldReplay(boolean payment) throws Exception {
        String key=payment?"payment-intent":"contract-intent";ApprovalService.Request rejected;
        try(var service=service(payment)) {
            var saved=service.submitDocument("alice",document(payment),1,key);var original=service.process();
            service.publish("alice",1,new ProcessDefinition(original.schemaVersion(),original.id(),1,"New policy",original.nodes()));
            rejected=service.decide("bob",saved.id(),payment?"payment-check":"commercial-review","REJECT","Original rejected opinion");
        }
        try(var service=service(payment)) {
            assertEquals(rejected,service.submitDocument("alice",document(payment),1,key));
            for(var changed:changedIntents(payment))assertEquals(409,result(()->service.submitDocument("alice",changed,1,key)),changed.toString());
            assertEquals(409,result(()->service.submitDocument("alice",document(payment),2,key))); counts(1,2);
            var newer=service.submitDocument("alice",document(payment),2,key+"-new");assertNotEquals(rejected.id(),newer.id());
            assertEquals(rejected.business(),newer.business());assertEquals(2,newer.processVersion());counts(2,3);
        }
    }
    @Test void paymentEveryFieldAndOriginalVersionBindRetryAfterTerminalReopen() throws Exception { everyFieldReplay(true); }
    @Test void contractEveryFieldAndOriginalVersionBindRetryAfterTerminalReopen() throws Exception { everyFieldReplay(false); }

    @Test void paymentAndContractFailedWritesRollBackRequestAuditKeyAndMembersTogether() throws Exception {
        for(boolean payment:List.of(true,false))for(String prefix:List.of("INSERT INTO arc_request_event","INSERT INTO arc_request_member","INSERT INTO arc_submission_key")) {
            var executed=new AtomicBoolean(); var fault=ServerTestSupport.failAfterStatement(dataSource,prefix,executed);
            try(var failed=new ApprovalService(new JdbcApprovalStore(fault,new ObjectMapper(),entry(payment).initialProcess()),USERS)) {
                assertThrows(IOException.class,()->failed.submitDocument("alice",document(payment),1,"failed-write"));assertTrue(executed.get());counts(0,0);
            }
        }
        try(var payment=service(true);var contract=service(false)) {
            payment.submitDocument("alice",paymentDocument(),1,"payment-after-failure");contract.submitDocument("alice",contractDocument(),1,"contract-after-failure");counts(2,2);
        }
    }

    @Test void paymentAndContractFailedDecisionKeepsProjectionAndOriginalVoteUnchanged() throws Exception {
        for(boolean payment:List.of(true,false)) {
            var executed=new AtomicBoolean();var fault=ServerTestSupport.failAfterStatement(dataSource,"INSERT INTO arc_request_event",executed);
            try(var original=service(payment)) {
                var saved=original.submitDocument("alice",document(payment),1,payment?"payment-decision":"contract-decision");
                try(var failed=new ApprovalService(new JdbcApprovalStore(fault,new ObjectMapper(),entry(payment).initialProcess()),USERS)) {
                    assertThrows(IOException.class,()->failed.decide("bob",saved.id(),payment?"payment-check":"commercial-review","APPROVE","Must roll back"));assertTrue(executed.get());
                }
                assertEquals(List.of(saved),original.list("alice"));assertEquals(List.of(saved),inbox(original,"bob",PENDING));assertTrue(inbox(original,"bob",HANDLED).isEmpty());
            }
        }
        counts(2,2);
    }

    @Test void paymentAndContractLostCommitAcknowledgementReplaysOneDurableWinner() throws Exception {
        for(boolean payment:List.of(true,false)) {
            var lost=new AtomicBoolean();var uncertain=ServerTestSupport.loseKeyedCommitAcknowledgement(dataSource,lost);
            String key=payment?"payment-lost-response":"contract-lost-response";
            try(var service=new ApprovalService(new JdbcApprovalStore(uncertain,new ObjectMapper(),entry(payment).initialProcess()),USERS)) {
                assertThrows(IOException.class,()->service.submitDocument("alice",document(payment),1,key));assertTrue(lost.get());
            }
            try(var reopened=service(payment)) {
                var saved=reopened.submitDocument("alice",document(payment),1,key);
                assertEquals(List.of(saved),reopened.list("alice"));assertEquals(1,saved.history().size());
                assertEquals(saved,reopened.submitDocument("alice",document(payment),1,key));
            }
        }
        counts(2,2);
    }

    @Test void paymentAndContractWrongTypeHostsFailBeforeAnyDecisionMutation() throws Exception {
        for(boolean payment:List.of(true,false))try(var service=service(payment);var host=new ScenarioCase(entry(payment),service,USERS)) {
            var wrong=service.submitDocument("alice",document(!payment),1,payment?"payment-wrong":"contract-wrong");
            assertThrows(IllegalStateException.class,()->new ScenarioCase(entry(payment),service,USERS));
            assertThrows(IllegalStateException.class,()->host.decide("bob",wrong.id(),payment?"payment-check":"commercial-review","APPROVE","Do not write"));
            assertEquals(List.of(wrong),service.list("alice"));
        }
        counts(2,2);
    }

    @Test void paymentAndContractInvalidPersistedAmountsFailClosedWithoutAuditMutation() throws Exception {
        for(boolean payment:List.of(true,false)) {
            String id;try(var service=service(payment)){id=service.submitDocument("alice",document(payment),1,payment?"payment-corrupt":"contract-corrupt").id();}
            try(var connection=dataSource.getConnection();var query=connection.prepareStatement("SELECT request_json FROM arc_request WHERE request_id = ?")) {
                query.setString(1,id);try(var rows=query.executeQuery()) {assertTrue(rows.next());var raw=(ObjectNode)JSON.readTree(rows.getString(1));
                    if(payment)((ObjectNode)raw.path("business").path("lines").get(0)).put("allocationAmount",new BigDecimal("6000.01"));
                    else((ObjectNode)raw.path("business")).put("contractAmount",new BigDecimal("100000.01"));
                    try(var update=connection.prepareStatement("UPDATE arc_request SET request_json = ? WHERE request_id = ?")){update.setString(1,raw.toString());update.setString(2,id);assertEquals(1,update.executeUpdate());}
                }
            }
            try(var reopened=service(payment)){assertThrows(UncheckedIOException.class,()->reopened.list("alice"));assertThrows(IOException.class,()->inbox(reopened,"bob",PENDING));}
        }
        counts(2,2);
    }
}
