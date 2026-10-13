package com.arcflow.approval.graph;

import com.arcflow.approval.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static com.arcflow.approval.graph.GraphApprovalServiceTest.*;
import static com.arcflow.approval.graph.GraphEngineTest.*;
import static org.junit.jupiter.api.Assertions.*;

class GraphBusinessScenariosTest {
    @TempDir Path directory;
    static final Clock NOW=Clock.fixed(Instant.parse("2026-10-13T00:00:00Z"),ZoneOffset.UTC);
    static BusinessDocument.Travel travel(String amount) { return new BusinessDocument.Travel(1,"TRAVEL-1","Visit","Synthetic review","Shanghai","2026-11-01","2026-11-03","CUSTOMER_VISIT",new BigDecimal(amount),"CNY","SALES"); }
    static BusinessDocument.Receiving receiving(boolean rejected) { return new BusinessDocument.Receiving(1,"RECEIVING-1","Receipt","Synthetic receipt","PO-1","EAST","2026-10-13",List.of(new BusinessDocument.ReceivingLine("L1","POL1","Equipment","PCS",10,10,rejected?8:10,rejected?2:0,rejected?"Damaged":""))); }
    static BusinessDocument.QuoteDiscount quote(String requested) { return new BusinessDocument.QuoteDiscount("Q-1","Discount","Synthetic proposal","CUSTOMER-1",1,"Equipment",10,new BigDecimal("1000"),new BigDecimal(requested),"CNY","2026-10-14"); }
    static final class Source implements QuoteDiscountCase.QuoteSource {
        Set<String> readers=Set.of("alice","bob","carol"); int revision=1;
        public Optional<QuoteDiscountCase.QuoteVersion> find(String id,int version) { return id.equals("Q-1")&&version==1?Optional.of(new QuoteDiscountCase.QuoteVersion(id,1,"CUSTOMER-1","alice",readers,"Equipment",10,new BigDecimal("1000"),"CNY","2026-10-14")):Optional.empty(); }
        public int currentRevision(String id) { return id.equals("Q-1")?revision:0; }
        public List<QuoteDiscountCase.QuoteVersion> available() { return List.of(find("Q-1",1).orElseThrow()); }
    }
    static Memory memory(GraphDefinition definition) { var store=new Memory(); store.value=new GraphApprovalStore.Snapshot(14,definition,new GraphApprovalStore.Draft(0,1,definition),List.of());return store; }
    static String key(BusinessDocument document) { return document instanceof BusinessDocument.QuoteDiscount q?GraphQuotePolicy.revisionKey(q.businessId(),q.quoteRevision()):"submission"; }
    static GraphInstance start(GraphDefinition definition,BusinessDocument document) { return GraphEngine.start("request",key(document),"alice",definition,document,NOW.instant().toString()); }
    static GraphInstance vote(GraphInstance instance,String node,String decision) { var task=instance.tasks().stream().filter(t->t.nodeId().equals(node)).findFirst().orElseThrow();return GraphEngine.decide(instance,task.id(),task.participants().get(0),decision,"",node+"-vote",NOW.instant().toString()); }
    @Test void allThreeActualTopologiesRouteBothWaysWithIndependentTasksAndWaitingJoins() {
        for (int i=0;i<3;i++) {
            var definition=List.of(GraphSamples.travel(),GraphSamples.receiving(),GraphSamples.quote()).get(i);
            var high=List.<BusinessDocument>of(travel("10000"),receiving(true),quote("800")).get(i);
            var low=List.<BusinessDocument>of(travel("9999.99"),receiving(false),quote("800.01")).get(i);
            var instance=start(definition,high);
            if(i==0) {assertEquals(List.of("manager"),active(instance));instance=vote(instance,"manager","APPROVE");}
            var nodes=active(instance); assertEquals(2,nodes.size()); assertEquals(1,instance.forks().size());
            instance=vote(instance,nodes.get(0),"APPROVE"); assertEquals(List.of(nodes.get(1)),active(instance));
            assertEquals(1,instance.forks().get(0).arrivedBranchIds().size()); assertFalse(instance.forks().get(0).fired());
            assertEquals(0,instance.events().stream().filter(e->e.type().equals("JOIN_FIRED")).count());
            instance=vote(instance,nodes.get(1),"APPROVE"); assertTrue(instance.forks().get(0).fired());
            assertEquals(1,instance.events().stream().filter(e->e.type().equals("JOIN_FIRED")).count());
            if(i==2) {assertEquals(List.of("final"),active(instance)); instance=vote(instance,"final","APPROVE");}
            assertEquals("APPROVED",instance.status());GraphEngine.validateInstance(instance);
            var ordinary=start(definition,low); assertEquals("otherwise",ordinary.routes().get(0).selectedEdgeId());
            assertEquals(List.of(i==0?"manager":"standard"),active(ordinary)); ordinary=vote(ordinary,active(ordinary).get(0),"APPROVE");
            if(i==2)ordinary=vote(ordinary,"final","APPROVE");assertEquals("APPROVED",ordinary.status());assertTrue(ordinary.forks().isEmpty());
        }
    }
    @Test void eachParallelRejectionCancelsSiblingAndNeverFiresJoin() {
        for(int i=0;i<3;i++) {
            var definition=List.of(GraphSamples.travel(),GraphSamples.receiving(),GraphSamples.quote()).get(i);
            var document=List.<BusinessDocument>of(travel("20000"),receiving(true),quote("750")).get(i);
            var instance=start(definition,document);if(i==0)instance=vote(instance,"manager","APPROVE");
            instance=vote(instance,active(instance).get(0),"REJECT");assertEquals("REJECTED",instance.status());assertTrue(active(instance).isEmpty());
            assertEquals(1,instance.tasks().stream().filter(t->t.status().equals("CANCELLED")).count());assertFalse(instance.forks().get(0).fired());GraphEngine.validateInstance(instance);
        }
    }
    @Test void boundFamiliesApplyToDraftsPreviewsAndConditionlessHistoricalDefinitions() throws Exception {
        var definitions=List.of(GraphSamples.travel(),GraphSamples.receiving(),GraphSamples.quote());
        var documents=List.<BusinessDocument>of(travel("20000"),receiving(true),quote("750"));
        for(int i=0;i<3;i++) {
            var d=definitions.get(i);var store=memory(d);var service=new GraphApprovalService(store,new Directory(),NOW,new Source());
            var other=documents.get((i+1)%3);status(400,()->service.preview("alice",d,other));status(400,()->service.submit("alice",1,other,"wrong"));
            var bad=new GraphDefinition(d.schemaVersion(),d.id(),1,d.name(),d.nodes(),d.edges().stream().map(e->e.condition()==null?e:new GraphDefinition.Edge(e.id(),e.source(),e.target(),e.label(),new ConditionalRouting.Rule("ALL",List.of(ConditionalRouting.Predicate.money("GT","CNY",BigDecimal.TEN))),false)).toList());
            status(400,()->service.saveDraft("alice",0,bad));assertEquals(0,store.snapshot().draft().revision());
            var linear=linear(d.id());GraphDefinition.validate(linear);assertThrows(IllegalArgumentException.class,()->start(linear,other));
            var right=start(linear,documents.get(i));GraphEngine.validateInstance(right);
            var wrong=new GraphInstance(right.id(),right.submissionKey(),right.applicantId(),right.status(),right.createdAt(),right.updatedAt(),right.commandRevision(),right.definition(),other,right.tasks(),right.forks(),right.routes(),right.events(),right.commands());
            assertThrows(IllegalArgumentException.class,()->GraphApprovalService.validateSnapshot(new GraphApprovalStore.Snapshot(14,linear.withVersion(2),new GraphApprovalStore.Draft(1,2,linear.withVersion(2)),List.of(wrong))));
            var ownDocument=documents.get(i);status(400,()->service.preview("alice",GraphSamples.payment(),ownDocument));
        }
        assertThrows(IllegalArgumentException.class,()->start(linear("custom-legacy"),travel("100")));
        assertNotNull(start(linear("custom-legacy"),payment("100")));
    }
    static GraphDefinition linear(String id) { return linear(Set.of("travel-graph","receiving-graph","quote-graph").contains(id)?6:5,id); }
    static GraphDefinition linear(int schema,String id) { return new GraphDefinition(schema,id,1,"Conditionless",List.of(GraphSamples.structural("start","start","Start",null),GraphSamples.approval("review","Review","bob"),GraphSamples.structural("end","end","End",null)),List.of(GraphSamples.edge("one","start","review","Review"),GraphSamples.edge("two","review","end","Done"))); }
    @Test void newServicesKeepPublicationCasFrozenVersionsIdentityAndRetries() throws Exception {
        for(int i=0;i<3;i++) {
            var definition=List.of(GraphSamples.travel(),GraphSamples.receiving(),GraphSamples.quote()).get(i);
            var document=List.<BusinessDocument>of(travel("100"),receiving(false),quote("950")).get(i);
            var store=memory(definition);var service=new GraphApprovalService(store,new Directory(),NOW,new Source());
            var submitted=service.submit("alice",1,document,key(document));
            assertEquals(submitted,service.submit("alice",1,document,key(document)));status(403,()->service.get("dana",submitted.id()));assertTrue(service.list("dana").isEmpty());
            status(403,()->service.saveDraft("bob",0,definition));service.saveDraft("alice",0,definition);service.publish("alice",1,1);
            status(409,()->service.publish("alice",1,1));status(409,()->service.saveDraft("alice",1,definition));
            assertEquals(submitted,service.submit("alice",1,document,key(document)));assertEquals(1,service.get("alice",submitted.id()).definition().version());
            status(409,()->service.submit("alice",2,document,key(document)));
            if(i<2){status(403,()->service.get("carol",submitted.id()));status(409,()->service.submit("alice",1,document,"fresh"));}
            var task=submitted.tasks().get(0);status(403,()->service.decide("carol",submitted.id(),task.id(),"APPROVE","","wrong-actor"));
            var decision=service.decide("bob",submitted.id(),task.id(),"APPROVE","","decision");assertEquals(decision,service.decide("bob",submitted.id(),task.id(),"APPROVE","","decision"));
        }
    }
    @Test void quoteSourceGuardsOwnerImmutableFieldsPreviewSelectedReadersAndCanonicalKey() throws Exception {
        var source=new Source();var store=memory(GraphSamples.quote());var service=new GraphApprovalService(store,new Directory(),NOW,source);
        assertEquals(1,service.quotes("alice").size());assertTrue(service.quotes("dana").isEmpty());
        status(403,()->service.submit("bob",1,quote("800"),key(quote("800"))));status(403,()->service.preview("dana",GraphSamples.quote(),quote("800")));
        status(400,()->service.submit("alice",1,quote("800"),"arbitrary"));
        var q=quote("800");var changed=new BusinessDocument.QuoteDiscount(q.businessId(),q.title(),q.reason(),q.customerRef(),1,q.item(),11,q.listUnitPrice(),q.requestedUnitPrice(),q.currency(),q.validUntil());
        status(409,()->service.submit("alice",1,changed,key(changed)));status(409,()->service.preview("alice",GraphSamples.quote(),changed));
        source.readers=Set.of("alice","bob");status(403,()->service.preview("alice",GraphSamples.quote(),q));status(403,()->service.submit("alice",1,q,key(q)));assertTrue(store.snapshot().requests().isEmpty());
        assertThrows(IllegalArgumentException.class,()->new GraphApprovalService(store,new Directory()));
    }
    @Test void sourceRevocationDuringDirectoryLookupIsRecheckedBeforeCreateAndPreviewReturn() throws Exception {
        var source=new Source();var directory=new Directory();
        ActorDirectory mutating=new ActorDirectory() {
            public Optional<ApprovalService.Person> findActive(String actor){return directory.findActive(actor);}
            public List<ApprovalService.Person> listActive(){return directory.listActive();}
            public boolean canPublish(String actor){return directory.canPublish(actor);}
            public boolean canAssignApproval(String actor){source.readers=Set.of("alice","bob");return true;}
        };
        var store=memory(GraphSamples.quote());var service=new GraphApprovalService(store,mutating,NOW,source);var q=quote("800");
        status(403,()->service.submit("alice",1,q,key(q)));assertTrue(store.snapshot().requests().isEmpty());
        source.readers=Set.of("alice","bob","carol");status(403,()->service.preview("alice",GraphSamples.quote(),q));assertTrue(store.snapshot().requests().isEmpty());
    }
    @Test void quoteHistoricalRetrySurvivesExpiryAndSourceRevisionButNotAccessRevocation() throws Exception {
        var source=new Source();var store=memory(GraphSamples.quote());var fresh=new GraphApprovalService(store,new Directory(),NOW,source);var q=quote("800");var original=fresh.submit("alice",1,q,key(q));
        source.revision=2;var later=new GraphApprovalService(store,new Directory(),Clock.fixed(Instant.parse("2026-11-01T00:00:00Z"),ZoneOffset.UTC),source);
        assertEquals(original,later.submit("alice",1,q,key(q)));assertEquals(original,later.get("carol",original.id()));
        status(409,()->later.submit("alice",1,quote("700"),key(q)));
        var empty=memory(GraphSamples.quote());var expired=new GraphApprovalService(empty,new Directory(),Clock.fixed(Instant.parse("2026-11-01T00:00:00Z"),ZoneOffset.UTC),source);
        status(409,()->expired.submit("alice",1,q,key(q)));source.revision=1;status(400,()->expired.submit("alice",1,q,key(q)));
        source.readers=Set.of("alice","bob");assertTrue(later.list("carol").isEmpty());status(404,()->later.get("carol",original.id()));status(404,()->later.decide("carol",original.id(),original.id()+":finance","APPROVE","","revoked"));
        source.readers=Set.of("alice");assertEquals(original,later.submit("alice",1,q,key(q)));
    }
    @Test void concurrentQuoteRevisionSubmissionsConvergeAndChangedPayloadConflicts() throws Exception {
        var store=memory(GraphSamples.quote());var service=new GraphApprovalService(store,new Directory(),NOW,new Source());var q=quote("800");var pool=Executors.newFixedThreadPool(2);
        try {var a=pool.submit(()->service.submit("alice",1,q,key(q)));var b=pool.submit(()->service.submit("alice",1,q,key(q)));assertEquals(a.get().id(),b.get().id());}finally{pool.shutdownNow();}
        assertEquals(1,store.snapshot().requests().size());status(409,()->service.submit("alice",1,quote("700"),key(q)));
    }
    @Test void allNewJsonStoresRestartAndRejectCorruptHistoricalSnapshotsWithoutOverwritingBytes() throws Exception {
        for(int i=0;i<3;i++) {
            var definition=List.of(GraphSamples.travel(),GraphSamples.receiving(),GraphSamples.quote()).get(i);var document=List.<BusinessDocument>of(travel("20000"),receiving(true),quote("800")).get(i);
            Path file=directory.resolve(i+".graph.json");var mapper=GraphApprovalService.strictMapper(new ObjectMapper());GraphInstance before;
            try(var store=new JsonGraphApprovalStore(mapper,file.toString(),definition)) {var service=new GraphApprovalService(store,new Directory(),NOW,new Source());before=service.submit("alice",1,document,key(document));if(i==0)before=service.decide("bob",before.id(),before.id()+":manager","APPROVE","","manager");var task=before.tasks().stream().filter(t->t.status().equals("ACTIVE")).findFirst().orElseThrow();before=service.decide(task.participants().get(0),before.id(),task.id(),"APPROVE","","first");service.saveDraft("alice",0,definition);service.publish("alice",1,1);}
            try(var store=new JsonGraphApprovalStore(mapper,file.toString(),definition)) {assertEquals(before,store.snapshot().requests().get(0));GraphApprovalService.validateSnapshot(store.snapshot());}
            var tree=mapper.readTree(Files.readString(file));((com.fasterxml.jackson.databind.node.ObjectNode)tree.path("requests").get(0)).set("business",mapper.valueToTree(payment("100")));Files.writeString(file,mapper.writeValueAsString(tree));String corrupt=Files.readString(file);
            assertThrows(java.io.IOException.class,()->new JsonGraphApprovalStore(mapper,file.toString(),definition));assertEquals(corrupt,Files.readString(file));
        }
    }
    @Test void schemaFiveCollidingIdsRetainPaymentAcrossJsonRestartAndNewHostsRejectDowngrade() throws Exception {
        for(var next:List.of(GraphSamples.travel(),GraphSamples.receiving(),GraphSamples.quote())) {
            var legacy=linear(5,next.id());Path file=directory.resolve(next.id()+".graph.json");GraphInstance paymentRequest;
            try(var store=new JsonGraphApprovalStore(new ObjectMapper(),file.toString(),legacy)) {
                var service=new GraphApprovalService(store,new Directory());assertEquals(GraphScenarios.PAYMENT,service.scenario());assertEquals(5,service.schemaVersion());
                paymentRequest=service.submit("alice",1,payment("100"),"legacy-custom");
                paymentRequest=service.decide("bob",paymentRequest.id(),paymentRequest.id()+":review","APPROVE","","legacy-review");
                status(400,()->service.saveDraft("alice",0,next));status(400,()->service.preview("alice",next,payment("100")));
                var mixed=new GraphApprovalStore.Snapshot(14,legacy,new GraphApprovalStore.Draft(0,1,linear(6,next.id())),List.of());
                assertThrows(IllegalArgumentException.class,()->GraphApprovalService.validateSnapshot(mixed));
            }
            byte[] bytes=Files.readAllBytes(file);
            try(var store=new JsonGraphApprovalStore(new ObjectMapper(),file.toString(),legacy)) {assertEquals(paymentRequest,store.snapshot().requests().get(0));GraphEngine.validateInstance(paymentRequest);}
            assertThrows(java.io.IOException.class,()->new JsonGraphApprovalStore(new ObjectMapper(),file.toString(),next));assertArrayEquals(bytes,Files.readAllBytes(file));
            var current=memory(next);var service=new GraphApprovalService(current,new Directory(),NOW,new Source());
            status(400,()->service.saveDraft("alice",0,legacy));status(400,()->service.preview("alice",legacy,payment("100")));
            var mixedHistory=new GraphApprovalStore.Snapshot(14,next.withVersion(2),new GraphApprovalStore.Draft(1,2,next.withVersion(2)),List.of(paymentRequest));
            assertThrows(IllegalArgumentException.class,()->GraphApprovalService.validateSnapshot(mixedHistory));
        }
        assertThrows(IllegalArgumentException.class,()->GraphDefinition.validate(linear(6,"payment-graph")));
        assertThrows(IllegalArgumentException.class,()->GraphDefinition.validate(linear(6,"unregistered-graph")));
    }
    @Test void quoteNoncanonicalDurableKeyIsRejectedBeforeJsonMutation() throws Exception {
        Path file=directory.resolve("bad-key.graph.json");try(var store=new JsonGraphApprovalStore(new ObjectMapper(),file.toString(),GraphSamples.quote())) {
            var before=store.snapshot();String bytes=Files.readString(file);var bad=GraphEngine.start("r","arbitrary","alice",GraphSamples.quote(),quote("800"),NOW.instant().toString());
            assertThrows(IllegalArgumentException.class,()->store.create(1,bad));assertEquals(before,store.snapshot());assertEquals(bytes,Files.readString(file));
        }
    }
    @Test void percentRoutingUsesExactComparisonAtRoundingBoundaryAndStrictShapes() throws Exception {
        var q=new BusinessDocument.QuoteDiscount("Q-1","T","R","C",1,"I",1,new BigDecimal("999999999.99"),new BigDecimal("800000000"),"CNY","2099-12-31");q.validate();assertEquals(0,q.discountPercent().compareTo(new BigDecimal("20")));
        assertFalse(ConditionalRouting.evaluate(percent("GTE","20"),q).result());assertTrue(ConditionalRouting.evaluate(percent("LT","20"),q).result());
        assertTrue(ConditionalRouting.evaluate(percent("GT","0"),q).result());assertFalse(ConditionalRouting.evaluate(percent("GTE","100"),q).result());assertTrue(ConditionalRouting.evaluate(percent("LTE","100"),q).result());
        assertTrue(ConditionalRouting.evaluate(percent("EQ","20"),quote("800")).result());
        var money=new ConditionalRouting.Predicate("quote.reductionTotal","EQ","CNY",new BigDecimal("2000"),null,null);assertTrue(ConditionalRouting.evaluate(money,quote("800")).result());
        var mapper=GraphApprovalService.strictMapper(new ObjectMapper());
        for(String json:List.of("{\"field\":\"quote.discountPercent\",\"operator\":\"GTE\",\"threshold\":20,\"currency\":\"CNY\"}","{\"field\":\"quote.discountPercent\",\"operator\":\"GTE\",\"threshold\":100.01}","{\"field\":\"quote.discountPercent\",\"operator\":\"GTE\",\"threshold\":\"20\"}","{\"field\":\"quote.discountPercent\",\"operator\":\"GTE\",\"threshold\":20.001}","{\"field\":\"travel.estimatedCost\",\"operator\":\"GTE\",\"threshold\":10}","{\"field\":\"quote.invented\",\"operator\":\"EQ\",\"threshold\":0}"))assertThrows(Exception.class,()->mapper.readValue(json,ConditionalRouting.Predicate.class));
        var wrongCurrency=new ConditionalRouting.Predicate("travel.estimatedCost","GTE","USD",BigDecimal.TEN,null,null);assertThrows(IllegalArgumentException.class,()->ConditionalRouting.evaluate(wrongCurrency,travel("100")));
    }
    static ConditionalRouting.Predicate percent(String operator,String threshold) {return new ConditionalRouting.Predicate("quote.discountPercent",operator,null,new BigDecimal(threshold),null,null);}
}
