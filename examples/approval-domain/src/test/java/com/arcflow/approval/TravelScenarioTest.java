package com.arcflow.approval;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class TravelScenarioTest {
    @TempDir Path dir;
    final ObjectMapper mapper=ApprovalService.strictMapper(new ObjectMapper());
    final ActorDirectoryTest.Directory actors=new ActorDirectoryTest.Directory();
    TravelScenarioTest() { actors.active.addAll(List.of("303","404")); }
    Path file() { return dir.resolve("travel.json"); }
    ScenarioCatalog.Entry entry() { return ScenarioCatalog.travel("202","303"); }
    ApprovalService service(Path path) throws IOException { return new ApprovalService(mapper,path.toString(),actors,entry().initialProcess()); }
    ScenarioCase host() throws IOException { return new ScenarioCase(entry(),service(file()),actors); }
    static BusinessDocument.Travel travel() {
        return new BusinessDocument.Travel(1,"TRIP-1"," Customer visit "," Synthetic itinerary "," Shanghai ",
            "2026-10-08","2026-10-10","CUSTOMER_VISIT",new BigDecimal("1234.50"),"CNY","SALES");
    }
    static BusinessDocument.Travel dates(String start,String end) {
        var t=travel(); return new BusinessDocument.Travel(t.documentVersion(),t.businessId(),t.title(),t.reason(),t.destination(),
            start,end,t.purpose(),t.estimatedCost(),t.currency(),t.costCenter());
    }
    static BusinessDocument.Travel amount(String value,String currency) {
        var t=travel(); return new BusinessDocument.Travel(t.documentVersion(),t.businessId(),t.title(),t.reason(),t.destination(),
            t.startDate(),t.endDate(),t.purpose(),value==null?null:new BigDecimal(value),currency,t.costCenter());
    }
    ObjectNode node() { return mapper.valueToTree(travel()); }
    BusinessDocument decode(ObjectNode node) throws IOException { return mapper.treeToValue(node,BusinessDocument.class); }
    void rejects(ObjectNode bad) throws Exception {
        BusinessDocument document;
        try { document=decode(bad); } catch(IOException expected) { return; }
        assertThrows(IllegalArgumentException.class,document::validate,bad.toString());
        try(var host=host()) { ActorDirectoryTest.status(400,()->host.submit("101",document,1,"invalid")); assertTrue(host.list("101").isEmpty()); }
    }
    @Test void dedicatedTypedCatalogNormalizesSnapshotAndApprovedReplaySurvivesRestart() throws Exception {
        var catalog=entry(); assertEquals("oa-travel",catalog.template().id()); assertEquals("travel",catalog.template().documentType());
        assertEquals(BusinessDocument.Travel.class,catalog.documentClass()); assertNull(catalog.template().lineItems());
        assertEquals(List.of("tripReview","budget"),catalog.initialProcess().approvals().stream().map(ProcessDefinition.ProcessNode::id).toList());
        var paths=catalog.template().sections().stream().flatMap(s->s.fields().stream()).map(ScenarioCatalog.Field::path).toList();
        assertEquals(Set.of("businessId","title","reason","destination","startDate","endDate","purpose","estimatedCost","currency","costCenter"),new HashSet<>(paths));
        assertEquals(paths.size(),new HashSet<>(paths).size());
        ScenarioCase.View approved;
        try(var host=host()) {
            var created=host.submit("101",travel(),1,"trip"); var document=(BusinessDocument.Travel)created.request().business();
            assertEquals("1234.50",created.total()); assertEquals("Customer visit",document.title()); assertEquals("Synthetic itinerary",document.reason());
            assertEquals("Shanghai",document.destination()); assertEquals(new BigDecimal("1234.5"),document.estimatedCost()); assertEquals(3,document.durationDays());
            assertEquals(0,created.request().days()); assertEquals("oa-travel",created.request().processId());
            assertEquals(8,mapper.readTree(Files.readAllBytes(file())).path("schemaVersion").asInt());
            assertEquals("PENDING",host.decide("202",created.request().id(),"tripReview","APPROVE","Reviewed itinerary").request().status());
            approved=host.decide("303",created.request().id(),"budget","APPROVE","Reviewed estimate");
            assertEquals("APPROVED",approved.request().status()); assertEquals(created.request().business(),approved.request().business());
            assertEquals(3,approved.request().history().size());
        }
        try(var host=host()) { assertEquals(List.of(approved),host.list("101")); assertEquals(approved,host.submit("101",travel(),1,"trip")); }
    }
    @Test void strictMissingUnknownNullAndCoercedFieldsCannotBecomeDocuments() throws Exception {
        for(String field:List.of("type","documentVersion","businessId","title","reason","destination","startDate","endDate","purpose","estimatedCost","currency","costCenter")) {
            var missing=node(); missing.remove(field); assertThrows(IOException.class,()->decode(missing),field);
            var nil=node(); nil.putNull(field); rejects(nil);
        }
        for(String field:List.of("durationDays","total","applicantId","processId","lines","unrecognized")) {
            var unknown=node(); unknown.put(field,"forged"); assertThrows(IOException.class,()->decode(unknown),field);
        }
        for(String patch:List.of("\"estimatedCost\":\"1.25\"","\"estimatedCost\":true","\"documentVersion\":\"1\"",
                "\"documentVersion\":1.5","\"documentVersion\":true","\"destination\":123","\"startDate\":20261008")) {
            var fields=mapper.readTree("{"+patch+"}"); var bad=node(); fields.fields().forEachRemaining(e->bad.set(e.getKey(),e.getValue()));
            assertThrows(IOException.class,()->decode(bad),patch);
        }
        var json=mapper.writeValueAsString(travel());
        assertThrows(IOException.class,()->mapper.readValue(json.replace("\"documentVersion\":1","\"documentVersion\":1,\"documentVersion\":2"),BusinessDocument.class));
        assertThrows(IOException.class,()->mapper.readValue(json+" {}",BusinessDocument.class));
        assertFalse(mapper.readTree(json).has("durationDays")); assertFalse(mapper.readTree(json).has("total"));
    }
    @Test void calendarDatesUseStrictGregorianBoundsAndInclusiveOneToNinetyDays() {
        for(String date:List.of("0001-01-01","9999-12-31","2000-02-29","2024-02-29","2026-10-08")) {
            var one=dates(date,date); assertDoesNotThrow(one::validate,date); assertEquals(1,one.durationDays(),date);
        }
        for(var span:List.of(List.of("2026-01-01","2026-03-31"),List.of("2024-01-01","2024-03-30"))) {
            var ninety=dates(span.get(0),span.get(1)); assertDoesNotThrow(ninety::validate); assertEquals(90,ninety.durationDays());
        }
        for(String bad:List.of("0000-01-01","10000-01-01","-001-01-01","1900-02-29","2026-02-29","2026-02-30",
                "2026-04-31","2026-00-01","2026-13-01","2026-01-00","2026-1-01","2026-01-1"," 2026-01-01","2026-01-01 ","2026-01-01T00:00:00Z")) {
            assertThrows(IllegalArgumentException.class,dates(bad,"2026-10-10")::validate,bad);
            assertThrows(IllegalArgumentException.class,dates("2026-10-08",bad)::validate,bad);
        }
        assertThrows(IllegalArgumentException.class,dates("2026-10-10","2026-10-08")::validate);
        assertThrows(IllegalArgumentException.class,dates("2026-01-01","2026-04-01")::validate);
        assertThrows(IllegalArgumentException.class,dates("2024-01-01","2024-03-31")::validate);
    }
    @Test void identityTextDestinationPurposeCurrencyAndCostCenterAreBounded() throws Exception {
        for(String field:List.of("businessId","title","reason","destination","purpose","currency","costCenter")) {
            var blank=node(); blank.put(field," "); rejects(blank);
        }
        for(var limit:Map.of("businessId",128,"title",120,"reason",2000,"destination",160).entrySet()) {
            var valid=node(); valid.put(limit.getKey(),"A".repeat(limit.getValue())); assertDoesNotThrow(decode(valid)::validate);
            var tooLong=node(); tooLong.put(limit.getKey(),"A".repeat(limit.getValue()+1)); rejects(tooLong);
        }
        for(String bad:List.of("bad reference","/leading","中文"," leading","trailing ")) { var invalid=node(); invalid.put("businessId",bad); rejects(invalid); }
        for(String text:List.of("\u0000"," \u0000 ","\t\u0000\r")) { var invalid=node(); invalid.put("destination",text); rejects(invalid); }
        for(String purpose:List.of("CUSTOMER_VISIT","PROJECT_DELIVERY","TRAINING","CONFERENCE","OTHER")) {
            var valid=node(); valid.put("purpose",purpose); assertDoesNotThrow(decode(valid)::validate);
        }
        for(String center:List.of("ENGINEERING","SALES","OPERATIONS")) { var valid=node(); valid.put("costCenter",center); assertDoesNotThrow(decode(valid)::validate); }
        for(String field:List.of("purpose","currency","costCenter")) { var invalid=node(); invalid.put(field,"UNSUPPORTED"); rejects(invalid); }
        for(int version:List.of(0,2,-1)) { var invalid=node(); invalid.put("documentVersion",version); rejects(invalid); }
    }
    @Test void exactPositiveEstimateBoundsAndWholeYenHaveStableDisplayAndPersistence() throws Exception {
        for(String bad:List.of("0","-0.01","0.001","1.000","1000000000.01","1000000001")) assertThrows(IllegalArgumentException.class,amount(bad,"CNY")::validate,bad);
        assertThrows(IllegalArgumentException.class,amount(null,"CNY")::validate);
        assertThrows(IllegalArgumentException.class,amount("0.01","JPY")::validate);
        var saved=new ArrayList<ScenarioCase.View>();
        try(var host=host()) {
            for(String currency:List.of("CNY","USD","EUR","GBP","JPY")) for(String value:List.of("1","1.00","1000000000.00")) {
                var created=host.submit("101",amount(value,currency),1,currency+"-"+value); saved.add(created);
                assertEquals(new BigDecimal(value).stripTrailingZeros(),((BusinessDocument.Travel)created.request().business()).estimatedCost());
                assertEquals(new BigDecimal(value).setScale(currency.equals("JPY")?0:2).toPlainString(),created.total());
            }
            var pennies=host.submit("101",amount("0.01","CNY"),1,"pennies"); saved.add(pennies); assertEquals("0.01",pennies.total());
        }
        try(var host=host()) { assertEquals(new HashSet<>(saved),new HashSet<>(host.list("101"))); }
    }
    @Test void canonicalRetriesReplayButEveryChangedBusinessIntentConflicts() throws Exception {
        try(var host=host()) {
            var saved=host.submit("101",travel(),1,"intent");
            var equivalent=node(); equivalent.put("title","Customer visit").put("reason","Synthetic itinerary").put("destination","Shanghai").put("estimatedCost",new BigDecimal("1234.5"));
            assertEquals(saved,host.submit("101",decode(equivalent),1,"intent"));
            var changes=Map.ofEntries(Map.entry("businessId","TRIP-2"),Map.entry("title","Changed title"),Map.entry("reason","Changed reason"),
                Map.entry("destination","Beijing"),Map.entry("startDate","2026-10-09"),Map.entry("endDate","2026-10-11"),
                Map.entry("purpose","CONFERENCE"),Map.entry("currency","USD"),Map.entry("costCenter","OPERATIONS"));
            for(var change:changes.entrySet()) { var changed=node(); changed.put(change.getKey(),change.getValue()); var decoded=decode(changed); ActorDirectoryTest.status(409,()->host.submit("101",decoded,1,"intent")); }
            ActorDirectoryTest.status(409,()->host.submit("101",amount("1234.51","CNY"),1,"intent"));
            assertEquals(1,host.list("101").size()); assertEquals(1,host.list("101").get(0).request().history().size());
            actors.active.remove("101"); ActorDirectoryTest.status(403,()->host.submit("101",travel(),1,"intent"));
        }
    }
    @Test void wrongTypeMissingKeyInactiveUsersAndCrossProcessRequestsFailClosed() throws Exception {
        var expense=ScenarioCatalog.expense("202","303");
        try(var host=host(); var other=new ScenarioCase(expense,new ApprovalService(mapper,dir.resolve("expense.json").toString(),actors,expense.initialProcess()),actors)) {
            ActorDirectoryTest.status(400,()->host.submit("101",new BusinessDocument.Leave("L-1","Leave","Rest",1),1,"wrong"));
            ActorDirectoryTest.status(400,()->host.submit("101",ExpenseScenarioTest.expense(),1,"wrong"));
            ActorDirectoryTest.status(400,()->host.submit("101",null,1,"wrong"));
            ActorDirectoryTest.status(400,()->host.submit("101",travel(),1,null));
            for(String actor:List.of("missing","","404-invalid")) { ActorDirectoryTest.status(403,()->host.list(actor)); ActorDirectoryTest.status(403,()->host.process(actor)); ActorDirectoryTest.status(403,()->host.template(actor)); }
            var saved=host.submit("101",travel(),1,"trip"); assertTrue(host.list("404").isEmpty()); assertTrue(other.list("101").isEmpty());
            ActorDirectoryTest.status(404,()->other.decide("202",saved.request().id(),"tripReview","APPROVE",""));
            ActorDirectoryTest.status(400,()->other.submit("101",travel(),1,"trip"));
            ActorDirectoryTest.status(403,()->host.decide("101",saved.request().id(),"tripReview","APPROVE",""));
            ActorDirectoryTest.status(409,()->host.decide("303",saved.request().id(),"budget","APPROVE",""));
            actors.active.remove("202"); ActorDirectoryTest.status(403,()->host.decide("202",saved.request().id(),"tripReview","APPROVE",""));
        }
    }
    @Test void publishedProcessPinsOriginalReviewersAndRejectionCannotBeOverwritten() throws Exception {
        ScenarioCase.View rejected;
        try(var host=host()) {
            var first=host.submit("101",travel(),1,"old"); var proposed=ScenarioCatalog.travel("404","303").initialProcess();
            ActorDirectoryTest.status(403,()->host.publish("101",1,proposed));
            ActorDirectoryTest.status(400,()->host.publish("1",1,ScenarioCatalog.expense("202","303").initialProcess()));
            assertEquals(2,host.publish("1",1,proposed).version());
            ActorDirectoryTest.status(409,()->host.submit("101",travel(),1,"fresh-stale"));
            assertEquals(first,host.submit("101",travel(),1,"old"));
            rejected=host.decide("202",first.request().id(),"tripReview","REJECT","No itinerary approval");
            assertEquals("REJECTED",rejected.request().status()); assertEquals(1,rejected.request().processVersion());
            assertEquals(first.request().definition(),rejected.request().definition());
            assertEquals(rejected,host.decide("202",first.request().id(),"tripReview","REJECT","retry"));
            ActorDirectoryTest.status(409,()->host.decide("202",first.request().id(),"tripReview","APPROVE",""));
            ActorDirectoryTest.status(409,()->host.decide("303",first.request().id(),"budget","APPROVE",""));
            var next=host.submit("101",travel(),2,"new"); assertEquals("404",next.request().approverId());
            assertEquals("PENDING",host.decide("404",next.request().id(),"tripReview","APPROVE","").request().status());
        }
        try(var host=host()) { assertEquals(2,host.process("101").version()); assertEquals(rejected,host.submit("101",travel(),1,"old")); }
    }
    BusinessDocument olderDocument(int schema) {
        return switch(schema) {
            case 5 -> new BusinessDocument.Leave("L-1","Leave","Rest",1);
            case 6 -> new BusinessDocument.QuoteDiscount("Q-1","Quote","Reason","C-1",1,"Item",1,new BigDecimal("1.00"),new BigDecimal("0.50"),"CNY","2099-01-01");
            case 7 -> ExpenseScenarioTest.expense();
            default -> throw new AssertionError(schema);
        };
    }
    @Test void schemasFiveSixAndSevenUpgradeFromImmediateBytesAndNeverDowngrade() throws Exception {
        for(int schema:List.of(5,6,7)) {
            Path path=dir.resolve("old-"+schema+".json"); byte[] before;
            try(var service=service(path)) { service.submitDocument("101",olderDocument(schema),1,"old"); }
            byte[] untouched=Files.readAllBytes(path);
            try(var service=service(path)) {
                assertArrayEquals(untouched,Files.readAllBytes(path)); var old=service.list("101").get(0);
                service.decide("202",old.id(),"tripReview","APPROVE","Immediately before upgrade"); before=Files.readAllBytes(path);
                assertEquals(schema,mapper.readTree(before).path("schemaVersion").asInt()); assertFalse(Arrays.equals(untouched,before));
                var created=service.submitDocument("101",travel(),1,"travel"); assertEquals("TRIP-1",created.business().businessId());
                assertArrayEquals(before,Files.readAllBytes(path.resolveSibling(path.getFileName()+".schema"+schema+".bak")));
                service.submit("101","Legacy","Rest",1,1,"legacy"); service.publish("1",1,service.process());
                assertEquals(8,mapper.readTree(Files.readAllBytes(path)).path("schemaVersion").asInt());
            }
            try(var service=service(path)) { assertEquals(3,service.list("101").size()); assertEquals(2,service.process().version()); }
        }
    }
    @Test void travelSnapshotsAreRejectedUnderEveryOlderSchemaWithoutChangingFile() throws Exception {
        try(var service=service(file())) { service.submitDocument("101",travel(),1,"travel"); }
        byte[] good=Files.readAllBytes(file());
        for(int schema=1;schema<8;schema++) {
            var bad=(ObjectNode)mapper.readTree(good); bad.put("schemaVersion",schema); byte[] invalid=mapper.writeValueAsBytes(bad); Files.write(file(),invalid);
            assertThrows(IOException.class,()->service(file()),"schema "+schema); assertArrayEquals(invalid,Files.readAllBytes(file()));
        }
        Files.write(file(),good); try(var service=service(file())) { assertEquals(1,service.list("101").size()); }
    }
    @Test void failedSchemaUpgradesPublishNeitherRequestNorKeyAndRetryPreservesBackup() throws Exception {
        for(int schema:List.of(5,6,7)) {
            Path path=dir.resolve("failed-"+schema+".json");
            try(var service=service(path)) { service.submitDocument("101",olderDocument(schema),1,"old"); }
            byte[] before=Files.readAllBytes(path); Path backup=path.resolveSibling(path.getFileName()+".schema"+schema+".bak");
            try(var service=service(path)) {
                Files.delete(path); Files.createDirectory(path); Files.writeString(path.resolve("block"),"block");
                assertThrows(IOException.class,()->service.submitDocument("101",travel(),1,"key")); assertEquals(1,service.list("101").size());
                assertArrayEquals(before,Files.readAllBytes(backup));
                Files.delete(path.resolve("block")); Files.delete(path); Files.write(path,before);
                // Changed intent on the same key proves that the failed attempt did not bind it in memory.
                var changed=amount("1234.51","CNY"); var saved=service.submitDocument("101",changed,1,"key");
                assertEquals(changed.estimatedCost(),((BusinessDocument.Travel)saved.business()).estimatedCost()); assertEquals(2,service.list("101").size());
                assertEquals(saved,service.submitDocument("101",changed,1,"key")); assertArrayEquals(before,Files.readAllBytes(backup));
            }
            try(var service=service(path)) { assertEquals(2,service.list("101").size()); assertEquals(8,mapper.readTree(Files.readAllBytes(path)).path("schemaVersion").asInt()); }
        }
    }
    @Test void concurrentCanonicalRetriesCreateExactlyOneDurableRequest() throws Exception {
        ScenarioCase.View saved;
        try(var host=host()) {
            var pool=Executors.newFixedThreadPool(8); var gate=new CountDownLatch(1);
            try {
                var futures=new ArrayList<Future<ScenarioCase.View>>();
                for(int i=0;i<8;i++) futures.add(pool.submit(()->{ gate.await(); return host.submit("101",travel(),1,"race"); }));
                gate.countDown(); saved=futures.get(0).get(10,TimeUnit.SECONDS);
                for(var future:futures) assertEquals(saved,future.get(10,TimeUnit.SECONDS));
                assertEquals(List.of(saved),host.list("101")); assertEquals(1,saved.request().history().size());
            } finally { pool.shutdownNow(); assertTrue(pool.awaitTermination(10,TimeUnit.SECONDS)); }
        }
        try(var host=host()) { assertEquals(List.of(saved),host.list("101")); }
    }
    @Test void oldSchemaOneThroughFourRetainRecordsAndBackupOnDirectTravelUpgrade() throws Exception {
        for(int schema:List.of(1,2,3,4)) {
            Path path=dir.resolve("legacy-"+schema+".json");
            var definition=schema==3?ParallelApprovalTest.definition("ALL",false):ProcessDefinition.legacy("202");
            try(var service=new ApprovalService(mapper,path.toString(),actors,definition)) {
                service.submit("101","Historical leave","Rest",1,1,schema==4?"old":null);
            }
            if(schema==1) {
                var old=(ObjectNode)mapper.readTree(Files.readAllBytes(path)); old.put("schemaVersion",1); old.remove("definition");
                var row=(ObjectNode)old.path("requests").get(0); row.remove(List.of("definition","currentStepId"));
                for(var event:row.path("history")) ((ObjectNode)event).remove("stepId");
                Files.write(path,mapper.writeValueAsBytes(old));
            }
            byte[] before=Files.readAllBytes(path);
            ApprovalService.Request historical;
            try(var service=new ApprovalService(mapper,path.toString(),actors,definition)) {
                assertArrayEquals(before,Files.readAllBytes(path)); assertEquals(1,service.list("101").size());
                historical=service.list("101").get(0);
                service.submitDocument("101",travel(),1,"travel");
                assertEquals(historical,service.list("101").stream().filter(r->r.id().equals(historical.id())).findFirst().orElseThrow());
                assertArrayEquals(before,Files.readAllBytes(path.resolveSibling(path.getFileName()+".schema"+schema+".bak")));
                assertEquals(8,mapper.readTree(Files.readAllBytes(path)).path("schemaVersion").asInt());
            }
            try(var service=new ApprovalService(mapper,path.toString(),actors,definition)) {
                assertEquals(2,service.list("101").size());
                assertEquals(historical,service.list("101").stream().filter(r->r.id().equals(historical.id())).findFirst().orElseThrow());
                if(schema==4) assertEquals(historical,service.submit("101","Historical leave","Rest",1,1,"old"));
            }
        }
    }
    @Test void corruptedTravelSnapshotsFailClosedWithoutRewritingOrLeakingLocks() throws Exception {
        try(var service=service(file())) { service.submitDocument("101",travel(),1,"saved"); }
        byte[] good=Files.readAllBytes(file());
        var mutations=List.<java.util.function.Consumer<ObjectNode>>of(
            root -> ((ObjectNode)root.path("requests").get(0).path("business")).put("endDate","2026-10-07"),
            root -> ((ObjectNode)root.path("requests").get(0).path("business")).put("estimatedCost",new BigDecimal("0.001")),
            root -> ((ObjectNode)root.path("requests").get(0).path("business")).put("durationDays",3),
            root -> ((ObjectNode)root.path("requests").get(0).path("business")).putNull("destination"),
            root -> ((ObjectNode)root.path("requests").get(0)).put("days",3),
            root -> ((ObjectNode)root.path("requests").get(0)).put("title","Forged projection"),
            root -> ((ObjectNode)root.path("requests").get(0)).put("processId","oa-expense"),
            root -> ((ObjectNode)root.path("submissions").get(0)).put("applicantId","202"));
        for(var mutation:mutations) {
            var corrupt=(ObjectNode)mapper.readTree(good); mutation.accept(corrupt);
            byte[] bytes=mapper.writeValueAsBytes(corrupt); Files.write(file(),bytes);
            assertThrows(IOException.class,()->service(file())); assertArrayEquals(bytes,Files.readAllBytes(file()));
            Files.write(file(),good);
            try(var service=service(file())) { assertEquals(1,service.list("101").size()); }
        }
    }
}
