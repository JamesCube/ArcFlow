package com.arcflow.approval;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class ConditionalRoutingTest {
    @TempDir Path dir;
    final ObjectMapper mapper = ApprovalService.strictMapper(new ObjectMapper());
    final ActorDirectoryTest.Directory actors = new ActorDirectoryTest.Directory();
    ConditionalRoutingTest() { actors.active.addAll(List.of("303", "404", "505")); }
    static ConditionalRouting.Rule money(String operator, String amount) {
        return new ConditionalRouting.Rule("ALL", List.of(ConditionalRouting.Predicate.money(operator,"CNY",new BigDecimal(amount))));
    }
    static ProcessDefinition definition(ConditionalRouting.Rule rule) {
        return new ProcessDefinition(4,"erp-payment",1,"Conditional payment",List.of(
            new ProcessDefinition.ProcessNode("start","start","Submit",null),
            new ProcessDefinition.ProcessNode("base","approval","Mandatory review","202"),
            new ProcessDefinition.ProcessNode("risk","parallelApproval","Extra risk review",null,List.of("303","404"),"ALL",rule),
            new ProcessDefinition.ProcessNode("final","parallelApproval","Final review",null,List.of("202","505"),"ANY"),
            new ProcessDefinition.ProcessNode("end","end","Complete",null)));
    }
    Path file() { return dir.resolve("state.json"); }
    ApprovalService open(ProcessDefinition definition) throws IOException { return new ApprovalService(mapper,file().toString(),actors,definition); }
    BusinessDocument.PaymentRequest payment(String amount) {
        return new BusinessDocument.PaymentRequest(1,"PAY-ROUTE","Payment","Synthetic routing test","SUPPLIER-DEMO","CNY","2099-01-01",List.of(
            new BusinessDocument.PaymentLine("L1","INV1","Synthetic invoice",new BigDecimal(amount),BigDecimal.ZERO,new BigDecimal(amount),BigDecimal.ZERO,"")));
    }
    ApprovalService.Request submit(ApprovalService service,String amount,String key) throws IOException { return service.submitDocument("101",payment(amount),1,key); }
    @Test void exactThresholdChoosesOrderedPathsAndFrozenFacts() throws Exception {
        var def=definition(money("GTE","10000"));
        try(var service=open(def)) {
            var low=submit(service,"9999.99","low"); var equal=submit(service,"10000","equal"); var high=submit(service,"10000.01","high");
            assertEquals(List.of("base","final"),low.routing().stepIds());
            assertEquals(List.of("base","risk","final"),equal.routing().stepIds()); assertEquals(equal.routing().stepIds(),high.routing().stepIds());
            assertEquals(new ConditionalRouting.Fact("payment.netTotal","CNY 9999.99",false),low.routing().evaluations().get(0).predicates().get(0));
            assertEquals(def,low.definition());assertEquals(def,equal.definition());assertEquals(5,low.definition().nodes().size());
            assertEquals(13,mapper.readTree(Files.readAllBytes(file())).path("schemaVersion").asInt());
        }
        try(var service=open(def)) { assertEquals(List.of("base","final"),submit(service,"9999.99","low").routing().stepIds()); }
    }
    @Test void allMoneyOperatorsAreExactAtBoundaryIncludingTenthsAndMaximum() {
        for(String operator:List.of("EQ","GT","GTE","LT","LTE")) for(String value:List.of("0.29","0.30","0.31")) {
            int comparison=new BigDecimal(value).compareTo(new BigDecimal("0.30"));
            boolean expected=switch(operator){case "EQ"->comparison==0;case "GT"->comparison>0;case "GTE"->comparison>=0;case "LT"->comparison<0;default->comparison<=0;};
            assertEquals(expected,ConditionalRouting.freeze(definition(money(operator,"0.30")),payment(value)).stepIds().contains("risk"));
        }
        ProcessDefinition.validate(definition(money("LTE","20000000000")));
        assertThrows(IllegalArgumentException.class,()->ProcessDefinition.validate(definition(money("GTE","20000000000.01"))));
    }
    @Test void skippedOnlyActorsHaveNoReadVotePendingOrHandledRights() throws Exception {
        try(var service=open(definition(money("GTE","10000")))) {
            var low=submit(service,"6500","low");assertTrue(service.list("303").isEmpty());assertTrue(service.list("404").isEmpty());
            ActorDirectoryTest.status(404,()->service.decide("303",low.id(),"risk","APPROVE","Forbidden"));
            assertEquals(List.of("202","505"),InboxQuery.members(low).stream().map(InboxQuery.Member::actorId).toList());
            assertTrue(service.inbox("303",Map.of()).items().isEmpty());
            var next=service.decide("202",low.id(),"base","APPROVE","Base vote");assertEquals("final",next.currentStepId());
            var partial=service.decide("202",low.id(),"final","REJECT","Individual rejection");assertEquals("PENDING",partial.status());
            var done=service.decide("505",low.id(),"final","APPROVE","Another reviewer");assertEquals("APPROVED",done.status());
            assertEquals(4,done.history().size());assertEquals(low.routing(),done.routing());assertTrue(service.inbox("303",Map.of("box",List.of("HANDLED"))).items().isEmpty());
            assertEquals(done,service.decide("202",low.id(),"base","APPROVE","Retry ignored"));
            ActorDirectoryTest.status(409,()->service.decide("202",low.id(),"base","REJECT","Opposite"));
        }
    }
    @Test void selectedAllVotesAreIndependentAndRejectWithoutInventedEvents() throws Exception {
        try(var service=open(definition(money("GTE","10000")))) {
            var high=submit(service,"10000","high");ActorDirectoryTest.status(409,()->service.decide("303",high.id(),"risk","APPROVE","Too early"));
            service.decide("202",high.id(),"base","APPROVE","");var partial=service.decide("303",high.id(),"risk","APPROVE","");
            assertEquals("risk",partial.currentStepId());assertEquals(List.of("404"),ApprovalService.pendingApproverIds(partial));
            var rejected=service.decide("404",high.id(),"risk","REJECT","");assertEquals("REJECTED",rejected.status());assertEquals(4,rejected.history().size());
            assertTrue(service.inbox("505",Map.of("box",List.of("HANDLED"))).items().isEmpty());
        }
    }
    @Test void newDefinitionsCannotRerouteExistingRequestsOrKeyReplays() throws Exception {
        var def=definition(money("GTE","10000"));ApprovalService.Request saved;
        try(var service=open(def)) {
            saved=submit(service,"6500","old");var changed=definition(money("GTE","100"));
            service.publishForDocument("1",1,changed,BusinessDocument.PaymentRequest.class);
            var newer=service.submitDocument("101",payment("6500"),2,"new");assertTrue(newer.routing().stepIds().contains("risk"));
            assertEquals(saved,submit(service,"6500","old"));assertEquals(def,saved.definition());
            ActorDirectoryTest.status(409,()->service.submitDocument("101",payment("6500"),2,"old"));
            var next=service.decide("202",saved.id(),"base","APPROVE","");assertEquals("final",next.currentStepId());
        }
        try(var service=open(def)) { assertEquals(saved.routing(),submit(service,"6500","old").routing());assertEquals(2,service.process().version()); }
    }
    @Test void currencyMismatchAndCrossTypeRulesRejectBeforeAnyWriteEvenAnyShortCircuit() throws Exception {
        var rule=new ConditionalRouting.Rule("ANY",List.of(ConditionalRouting.Predicate.money("GTE","CNY",BigDecimal.ZERO),ConditionalRouting.Predicate.money("LT","CNY",BigDecimal.TEN)));
        try(var service=open(definition(rule))) {
            var foreign=payment("5");foreign=new BusinessDocument.PaymentRequest(1,foreign.businessId(),foreign.title(),foreign.reason(),foreign.supplierRef(),"USD",foreign.requestedPaymentOn(),foreign.lines());
            var document=foreign;ActorDirectoryTest.status(400,()->service.submitDocument("101",document,1,"foreign"));assertFalse(Files.exists(file()));
            ActorDirectoryTest.status(400,()->service.submitDocument("101",PaymentContractDocumentTest.contract(),1,"wrong"));
            assertFalse(Files.exists(file()));
        }
        var mixed=new ConditionalRouting.Rule("ANY",List.of(ConditionalRouting.Predicate.money("GT","CNY",BigDecimal.ZERO),ConditionalRouting.Predicate.money("GT","USD",BigDecimal.ZERO)));
        assertThrows(IllegalArgumentException.class,()->ProcessDefinition.validate(definition(mixed)));
    }
    @Test void receivingAndContractPredicatesUseTypedFrozenBusiness() throws Exception {
        var receipt=ReceivingScenarioTest.receipt();var contract=PaymentContractDocumentTest.contract();
        for(var pair:List.of(Map.entry(new ConditionalRouting.Rule("ALL",List.of(ConditionalRouting.Predicate.flag(true))), (BusinessDocument)receipt),
                             Map.entry(new ConditionalRouting.Rule("ANY",List.of(ConditionalRouting.Predicate.terms("EQ","STANDARD"),ConditionalRouting.Predicate.terms("IN","NONSTANDARD"))), (BusinessDocument)contract))) {
            var route=ConditionalRouting.freeze(definition(pair.getKey()),pair.getValue());assertTrue(route.stepIds().contains("risk"));
        }
        var node=(ObjectNode)mapper.valueToTree(receipt);for(JsonNode line:node.path("lines")){var row=(ObjectNode)line;row.put("accepted",row.path("received").intValue()).put("rejected",0).put("exceptionReason","");}
        assertFalse(ConditionalRouting.freeze(definition(new ConditionalRouting.Rule("ALL",List.of(ConditionalRouting.Predicate.flag(true)))),mapper.treeToValue(node,BusinessDocument.class)).stepIds().contains("risk"));
        var standard=(ObjectNode)mapper.valueToTree(contract);standard.put("termsKind","STANDARD").put("deviationReason","");
        assertFalse(ConditionalRouting.freeze(definition(new ConditionalRouting.Rule("ALL",List.of(ConditionalRouting.Predicate.terms("EQ","NONSTANDARD")))),mapper.treeToValue(standard,BusinessDocument.class)).stepIds().contains("risk"));
    }
    @Test void malformedConditionsOldSchemaAndAllConditionalPathsFailClosed() throws Exception {
        var baseline=(ObjectNode)mapper.valueToTree(definition(money("GTE","10000")));
        var mutations=new ArrayList<ObjectNode>();
        var old=baseline.deepCopy();old.put("schemaVersion",3);mutations.add(old);
        var all=baseline.deepCopy();((ObjectNode)all.path("nodes").get(1)).set("runIf",all.path("nodes").get(2).get("runIf"));((ObjectNode)all.path("nodes").get(3)).set("runIf",all.path("nodes").get(2).get("runIf"));mutations.add(all);
        var boundary=baseline.deepCopy();((ObjectNode)boundary.path("nodes").get(0)).set("runIf",boundary.path("nodes").get(2).get("runIf"));mutations.add(boundary);
        for(String field:List.of("mode","predicates")){var missing=baseline.deepCopy();((ObjectNode)missing.path("nodes").get(2).get("runIf")).remove(field);mutations.add(missing);}
        for(String field:List.of("field","operator","currency","threshold")){var missing=baseline.deepCopy();((ObjectNode)missing.path("nodes").get(2).path("runIf").path("predicates").get(0)).remove(field);mutations.add(missing);}
        for(String field:List.of("script","expression","stepIds")){var unknown=baseline.deepCopy();((ObjectNode)unknown.path("nodes").get(2).get("runIf")).put(field,"true");mutations.add(unknown);}
        for(var mutation:mutations)assertThrows(Exception.class,()->ProcessDefinition.validate(mapper.treeToValue(mutation,ProcessDefinition.class)));
        assertThrows(IllegalArgumentException.class,()->ConditionalRouting.Rule.fromJson(mapper.readTree("{\"mode\":\"ALL\",\"predicates\":[{\"field\":\"payment.netTotal\",\"operator\":\"GTE\",\"currency\":\"CNY\",\"threshold\":\"100\"}]}")));
        var nine=new ConditionalRouting.Rule("ALL",Collections.nCopies(8,ConditionalRouting.Predicate.money("GTE","CNY",BigDecimal.ZERO)));
        var nodes=new ArrayList<>(definition(nine).nodes());nodes.set(3,new ProcessDefinition.ProcessNode("final","approval","Extra","202",null,null,money("GT","0")));
        assertThrows(IllegalArgumentException.class,()->ProcessDefinition.validate(new ProcessDefinition(4,"erp-payment",1,"Too many",nodes)));
    }
    @Test void skippedSelfAssignmentStillRejectsAndGenericPublishCannotEnableRouting() throws Exception {
        var nodes=new ArrayList<>(definition(money("GTE","10000")).nodes());nodes.set(2,new ProcessDefinition.ProcessNode("risk","approval","Skipped self","101",null,null,money("GTE","10000")));
        try(var service=open(new ProcessDefinition(4,"erp-payment",1,"Self-assignment",nodes))) {
            ActorDirectoryTest.status(400,()->submit(service,"1","self"));assertFalse(Files.exists(file()));
            ActorDirectoryTest.status(400,()->service.publish("1",1,definition(money("GTE","10000"))));
            ActorDirectoryTest.status(400,()->service.publishForDocument("1",1,definition(money("GTE","10000")),BusinessDocument.ContractApproval.class));
        }
    }
    @Test void concurrentKeyAndVotesKeepOneFrozenRouteAndExactHistory() throws Exception {
        try(var service=open(definition(money("GTE","10000")))) {
            var executor=Executors.newFixedThreadPool(8);try {
                var gate=new CountDownLatch(1);var tasks=new ArrayList<Future<ApprovalService.Request>>();
                for(int i=0;i<16;i++)tasks.add(executor.submit(()->{gate.await();return submit(service,"10000","same");}));gate.countDown();
                var created=tasks.get(0).get();for(var task:tasks)assertEquals(created,task.get());assertEquals(1,service.list("101").size());
                service.decide("202",created.id(),"base","APPROVE","");
                var a=executor.submit(()->service.decide("303",created.id(),"risk","APPROVE","A"));var b=executor.submit(()->service.decide("404",created.id(),"risk","APPROVE","B"));a.get();b.get();
                var saved=submit(service,"10000","same");assertEquals("final",saved.currentStepId());assertEquals(4,saved.history().size());assertEquals(created.routing(),saved.routing());
            } finally {executor.shutdownNow();}
        }
    }
}
