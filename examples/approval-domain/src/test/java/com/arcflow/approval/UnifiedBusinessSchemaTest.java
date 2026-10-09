package com.arcflow.approval;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Stream;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

/** Synthetic mixed-type store tests do not authorize mixed-type isolated scenario hosts. */
class UnifiedBusinessSchemaTest {
    @TempDir Path dir;
    final ObjectMapper mapper = ApprovalService.strictMapper(new ObjectMapper());
    final ActorDirectoryTest.Directory actors = new ActorDirectoryTest.Directory();
    final ProcessDefinition process = ProcessDefinition.legacy("202");
    ApprovalService open(Path path) throws IOException { return new ApprovalService(mapper, path.toString(), actors, process); }
    Path backup(Path path, int schema) { return path.resolveSibling(path.getFileName() + ".schema" + schema + ".bak"); }
    int schema(Path path) throws IOException { return mapper.readTree(Files.readAllBytes(path)).path("schemaVersion").intValue(); }
    List<BusinessDocument> documents() {
        return List.of(new BusinessDocument.Leave("L-1", "Leave", "Rest", 2),
            new BusinessDocument.Procurement("P-1", "Purchase", "Reason", "Item", 2, new BigDecimal("1.25"), "CNY"),
            new BusinessDocument.QuoteDiscount("Q-1", "Quote", "Reason", "C-1", 1, "Item", 1,
                new BigDecimal("2.00"), new BigDecimal("1.00"), "CNY", "2099-01-01"),
            ExpenseScenarioTest.expense(), TravelScenarioTest.travel(), SealUseDocumentTest.seal(), ReceivingScenarioTest.receipt(), PaymentContractDocumentTest.payment(), PaymentContractDocumentTest.contract());
    }
    Map<Path,byte[]> backups() throws IOException {
        var result = new HashMap<Path,byte[]>();
        try (var files = Files.list(dir)) { for (var path : files.filter(p -> p.toString().endsWith(".bak")).toList()) result.put(path, Files.readAllBytes(path)); }
        return result;
    }
    void sameBackups(Map<Path,byte[]> expected) throws IOException {
        var actual = backups(); assertEquals(expected.keySet(), actual.keySet());
        for (var item : expected.entrySet()) assertArrayEquals(item.getValue(), actual.get(item.getKey()));
    }
    byte[] noncanonical(Path path) throws IOException {
        byte[] bytes = (" \r\n" + Files.readString(path).replace("\n", "\r\n") + "\t\r\n").getBytes(StandardCharsets.UTF_8);
        Files.write(path, bytes); return bytes;
    }
    @Test void typeClassAndMinimumSchemaRegistryExactlyMatchesSealedJacksonContract() {
        Map<String,Class<?>> jackson = new HashMap<>();
        for (var type : BusinessDocument.class.getAnnotation(JsonSubTypes.class).value()) assertNull(jackson.put(type.name(), type.value()));
        Map<String,Class<?>> registered = new HashMap<>();
        for (var entry : BusinessDocumentSchema.ENTRIES) assertNull(registered.put(entry.wireType(), entry.documentClass()));
        assertEquals(jackson, registered); assertEquals(9, registered.size());
        assertEquals(new HashSet<>(Arrays.asList(BusinessDocument.class.getPermittedSubclasses())), new HashSet<>(registered.values()));
        assertEquals(List.of(5,5,6,7,8,9,10,11,12), BusinessDocumentSchema.ENTRIES.stream().map(BusinessDocumentSchema.Entry::minimumSnapshotSchema).toList());
        assertNull(BusinessDocumentSchema.forType("Travel")); assertNull(BusinessDocumentSchema.forType("future"));
    }
    @TestFactory Stream<DynamicTest> everyKnownWrapperReadsEligibleTypesWithoutChangingBytesOrBackups() {
        return java.util.stream.IntStream.rangeClosed(1,12).mapToObj(version -> DynamicTest.dynamicTest("wrapper " + version, () -> {
            Path path = dir.resolve("read-" + version + ".json");
            List<ApprovalService.Request> expected;
            try (var service = open(path)) {
                service.submit("101", "Legacy", "Rest", 2, 1, version >= 4 ? "legacy" : null);
                for (var document : documents()) if (BusinessDocumentSchema.forDocument(document).minimumSnapshotSchema() <= version)
                    service.submitDocument("101", document, 1, document.getClass().getSimpleName());
                expected = service.list("101");
            }
            var root = (ObjectNode) mapper.readTree(Files.readAllBytes(path)); root.put("schemaVersion", version);
            if (version == 1) {
                root.remove("definition");
                for (var row : root.path("requests")) {
                    ((ObjectNode)row).remove(List.of("definition", "currentStepId"));
                    for (var event : row.path("history")) ((ObjectNode)event).remove("stepId");
                }
            }
            Files.write(path, mapper.writeValueAsBytes(root)); byte[] original = noncanonical(path);
            Files.writeString(backup(path,version), "Pre-existing backup must survive read"); var before = backups();
            try (var service = open(path)) { assertEquals(expected, service.list("101")); }
            assertArrayEquals(original, Files.readAllBytes(path)); sameBackups(before);
        }));
    }
    @Test void wrappersEightNineTenReadEmptyAndOldOnlyFilesWithoutRewriteAndNeverDowngradeOnWrites() throws Exception {
        for (int wrapper : List.of(8,9,10,11,12)) for (boolean empty : List.of(false,true)) {
            Path path = dir.resolve("old-only-"+wrapper+"-"+empty+".json");
            try(var service=open(path)){ service.submitDocument("101", ExpenseScenarioTest.expense(),1,"old"); }
            var root=(ObjectNode)mapper.readTree(Files.readAllBytes(path)); root.put("schemaVersion",wrapper);
            if(empty){root.putArray("requests");root.putArray("submissions");}
            Files.write(path,mapper.writeValueAsBytes(root));byte[] original=noncanonical(path);var before=backups();
            try(var service=open(path)){
                assertEquals(empty?0:1,service.list("101").size());
                assertArrayEquals(original,Files.readAllBytes(path));sameBackups(before);
                service.submit("101","Later legacy","Rest",1,1,"legacy");
                service.publish("1",1,service.process());
                assertEquals(wrapper,schema(path));sameBackups(before);
            }
            try(var service=open(path)){assertEquals(empty?1:2,service.list("101").size());assertEquals(2,service.process().version());}
        }
    }
    @TestFactory Stream<DynamicTest> everyNewTypePermutationUsesMonotonicSchemasAndImmediateSequentialBackups() {
        List<List<Integer>> orders=List.of(List.of(4,5,6),List.of(4,6,5),List.of(5,4,6),List.of(5,6,4),List.of(6,4,5),List.of(6,5,4));
        return orders.stream().map(order->DynamicTest.dynamicTest(order.toString(),()->{
            Path path=dir.resolve("order-"+order.toString().replaceAll("[^0-9]","")+".json");
            try(var service=open(path)){service.submitDocument("101",ExpenseScenarioTest.expense(),1,"old");}
            noncanonical(path);List<ApprovalService.Request> expected;int current=7;
            try(var service=open(path)){
                for(int index:order){
                    // Intervening valid writes must become the next upgrade's immediate original.
                    var prior=service.list("101").get(service.list("101").size()-1);
                    service.decide("202",prior.id(),"manager","APPROVE","Between type upgrades");
                    service.publish("1",service.process().version(),service.process());
                    byte[] before=Files.readAllBytes(path);var beforeBackups=backups();
                    var document=documents().get(index);int next=Math.max(current,BusinessDocumentSchema.forDocument(document).minimumSnapshotSchema());
                    service.submitDocument("101",document,service.process().version(),"type-"+index);
                    assertEquals(next,schema(path));
                    if(next>current)assertArrayEquals(before,Files.readAllBytes(backup(path,current)));
                    else sameBackups(beforeBackups);
                    current=next;
                }
                for(int index:List.of(4,5,3,0,1,2))service.submitDocument("101",documents().get(index),service.process().version(),"later-"+index);
                service.submit("101","Later legacy","Rest",1,service.process().version(),"later-legacy");
                service.publish("1",service.process().version(),service.process());assertEquals(10,schema(path));
                expected=service.list("101");
            }
            byte[] finalBytes=Files.readAllBytes(path);var finalBackups=backups();
            try(var service=open(path)){
                assertEquals(expected,service.list("101"));
                var old=expected.get(0);assertEquals(old,service.submitDocument("101",ExpenseScenarioTest.expense(),1,"old"));
                for(int index:order){var saved=expected.stream().filter(x->x.business()!=null && x.business().getClass().equals(documents().get(index).getClass())).findFirst().orElseThrow();
                    assertEquals(saved,service.submitDocument("101",documents().get(index),saved.processVersion(),"type-"+index));}
            }
            assertArrayEquals(finalBytes,Files.readAllBytes(path));sameBackups(finalBackups);
        }));
    }
    @TestFactory Stream<DynamicTest> fiveNewTypesInAll120WriteOrdersNeverDowngradeAndKeepImmediateBackups() {
        var orders = new ArrayList<List<Integer>>(); permutations(new ArrayList<>(), List.of(4,5,6,7,8), orders);
        assertEquals(120, orders.size());
        return orders.stream().map(order -> DynamicTest.dynamicTest("five-type order " + order, () -> {
            Path path = dir.resolve("five-order-" + order.toString().replaceAll("[^0-9]", "") + ".json");
            int current = 7;
            try (var service = open(path)) {
                service.submitDocument("101", ExpenseScenarioTest.expense(), 1, "expense");
                for (int index : order) {
                    byte[] immediate = Files.readAllBytes(path);
                    var document = documents().get(index);
                    int next = Math.max(current, BusinessDocumentSchema.forDocument(document).minimumSnapshotSchema());
                    service.submitDocument("101", document, 1, "new-" + index);
                    assertEquals(next, schema(path));
                    if (next > current) assertArrayEquals(immediate, Files.readAllBytes(backup(path,current)));
                    current = next;
                }
                for (int index = 0; index < documents().size(); index++) service.submitDocument("101", documents().get(index), 1, "again-"+index);
                var first = service.list("101").get(0); service.decide("202", first.id(), "manager", "APPROVE", "Old type decision");
                service.publish("1",1,service.process());
                service.submit("101","Legacy after all types","Rest",1,2,"legacy"); assertEquals(12,schema(path));
            }
            byte[] finalBytes=Files.readAllBytes(path);
            try (var service=open(path)) {
                assertEquals(16,service.list("101").size());
                for(int index:order) assertEquals(documents().get(index).withText(documents().get(index).title().trim(),documents().get(index).reason().trim()),service.submitDocument("101",documents().get(index),1,"new-"+index).business());
                assertEquals(12,schema(path));
            }
            assertArrayEquals(finalBytes,Files.readAllBytes(path));
        }));
    }
    private static void permutations(List<Integer> prefix,List<Integer> remaining,List<List<Integer>> result) {
        if(remaining.isEmpty()){result.add(List.copyOf(prefix));return;}
        for(int value:remaining){var next=new ArrayList<>(prefix);next.add(value);var rest=new ArrayList<>(remaining);rest.remove(Integer.valueOf(value));permutations(next,rest,result);}
    }
    @Test void paymentAndContractFailedUpgradesRetainImmediateBytesAndNeverPublishKeys() throws Exception {
        for(int index:List.of(7,8)){
            Path path=dir.resolve("failure-schema-"+index+".json");
            try(var service=open(path)){
                for(int i=0;i<index;i++)service.submitDocument("101",documents().get(i),1,"seed-"+i);
                var request=service.list("101").get(0);service.decide("202",request.id(),"manager","APPROVE","Before next upgrade");service.publish("1",1,service.process());
            }
            byte[] immediate=noncanonical(path);int from=index==7?10:11;
            Files.writeString(backup(path,from),"Existing historical backup");var old=backups();
            try(var store=new JsonApprovalStore(mapper,path.toString(),process);var service=new ApprovalService(store,actors)){
                var requests=service.list("101");Path saved=path.resolveSibling(path.getFileName()+".saved");Files.move(path,saved);Files.createDirectory(path);Files.writeString(path.resolve("block"),"block");
                try{assertThrows(IOException.class,()->service.submitDocument("101",documents().get(index),2,"new"));assertEquals(requests,service.list("101"));assertNull(store.submission("101","new"));}
                finally{Files.delete(path.resolve("block"));Files.delete(path);Files.move(saved,path);}
                assertArrayEquals(immediate,Files.readAllBytes(path));for(var item:old.entrySet())assertArrayEquals(item.getValue(),Files.readAllBytes(item.getKey()));
                var all=backups();assertEquals(old.size()+1,all.size());var fresh=all.entrySet().stream().filter(e->!old.containsKey(e.getKey())).findFirst().orElseThrow();assertArrayEquals(immediate,fresh.getValue());
                var created=service.submitDocument("101",documents().get(index),2,"new");assertEquals(created,store.submission("101","new"));assertEquals(from+1,schema(path));sameBackups(all);
            }
            try(var service=open(path)){assertEquals(index+1,service.list("101").size());assertEquals(2,service.submitDocument("101",documents().get(index),2,"new").processVersion());}
        }
    }
    @Test void everyTypeBelowItsMinimumAndUnknownTypeFailWithoutChangingAnySavedBytes() throws Exception {
        for(int index=0;index<documents().size();index++){
            var document=documents().get(index);Path path=dir.resolve("minimum-"+index+".json");
            try(var service=open(path)){service.submitDocument("101",document,1,"saved-key");}
            var valid=(ObjectNode)mapper.readTree(Files.readAllBytes(path));
            for(int wrapper=1;wrapper<BusinessDocumentSchema.forDocument(document).minimumSnapshotSchema();wrapper++){
                var bad=valid.deepCopy().put("schemaVersion",wrapper);byte[] bytes=mapper.writeValueAsBytes(bad);Files.write(path,bytes);var before=backups();
                assertThrows(IOException.class,()->open(path));assertArrayEquals(bytes,Files.readAllBytes(path));sameBackups(before);
            }
            for(String type:List.of("unknown","Travel","SealUse","Receiving","")){
                var bad=valid.deepCopy().put("schemaVersion",12);((ObjectNode)bad.path("requests").get(0).path("business")).put("type",type);
                byte[] bytes=mapper.writeValueAsBytes(bad);Files.write(path,bytes);var before=backups();
                assertThrows(IOException.class,()->open(path));assertArrayEquals(bytes,Files.readAllBytes(path));sameBackups(before);
            }
        }
    }
    @Test void malformedUnifiedSnapshotsNeverMutateSnapshotBackupsOrSavedBindings() throws Exception {
        Path path=dir.resolve("all-types-corruption.json");List<ApprovalService.Request> expected;
        try(var service=open(path)){
            for(var document:documents())service.submitDocument("101",document,1,document.getClass().getSimpleName());
            expected=service.list("101");
        }
        byte[] original=Files.readAllBytes(path);var root=(ObjectNode)mapper.readTree(original);var before=backups();
        List<String> malformed=new ArrayList<>();
        String raw=mapper.writeValueAsString(root);
        malformed.add(raw.replaceFirst("\\{", "{\"schemaVersion\":10,"));
        malformed.add(raw + " {}");
        for(String field:List.of("schemaVersion","definition","requests","submissions")){
            var bad=root.deepCopy();bad.remove(field);malformed.add(mapper.writeValueAsString(bad));
        }
        var extra=root.deepCopy();extra.put("unknownRoot",true);malformed.add(mapper.writeValueAsString(extra));
        for(int index=0;index<documents().size();index++){
            for(String type:List.of("future","Travel","SealUse","Receiving")){
                var bad=root.deepCopy();((ObjectNode)bad.path("requests").get(index).path("business")).put("type",type);
                malformed.add(mapper.writeValueAsString(bad));
            }
            for(String field:List.of("type","businessId","title","reason")){
                var bad=root.deepCopy();((ObjectNode)bad.path("requests").get(index).path("business")).remove(field);
                malformed.add(mapper.writeValueAsString(bad));
            }
            var nil=root.deepCopy();((ObjectNode)nil.path("requests").get(index)).putNull("business");malformed.add(mapper.writeValueAsString(nil));
            var extraBusiness=root.deepCopy();((ObjectNode)extraBusiness.path("requests").get(index).path("business")).put("unregistered",1);malformed.add(mapper.writeValueAsString(extraBusiness));
            if(index>=3){var future=root.deepCopy();((ObjectNode)future.path("requests").get(index).path("business")).put("documentVersion",2);malformed.add(mapper.writeValueAsString(future));}
        }
        for(String invalid:malformed){
            byte[] bytes=invalid.getBytes(StandardCharsets.UTF_8);Files.write(path,bytes);
            assertThrows(IOException.class,()->open(path));assertArrayEquals(bytes,Files.readAllBytes(path));sameBackups(before);
        }
        Files.write(path,original);
        try(var service=open(path)){
            assertEquals(expected,service.list("101"));
            for(int i=0;i<documents().size();i++)assertEquals(expected.get(i),service.submitDocument("101",documents().get(i),1,documents().get(i).getClass().getSimpleName()));
        }
        assertArrayEquals(original,Files.readAllBytes(path));sameBackups(before);
    }
    @Test void schemaNineAtomicUpgradeFailurePreservesAllEarlierBackupsAndDoesNotPublishNewKey() throws Exception {
        Path path=dir.resolve("failed-ten.json");
        try(var service=open(path)){
            service.submitDocument("101",ExpenseScenarioTest.expense(),1,"expense");
            service.submitDocument("101",TravelScenarioTest.travel(),1,"travel");
            service.submitDocument("101",SealUseDocumentTest.seal(),1,"seal");
        }
        byte[] bytes=noncanonical(path);var older=backups();
        Files.writeString(backup(path,9),"Historical collision");older=backups();
        try(var store=new JsonApprovalStore(mapper,path.toString(),process);var service=new ApprovalService(store,actors)){
            var requests=service.list("101");Path saved=path.resolveSibling("saved-nine.json");Files.move(path,saved);Files.createDirectory(path);Files.writeString(path.resolve("block"),"block");
            Map<Path,byte[]> failed;
            try{
                assertThrows(IOException.class,()->service.submitDocument("101",ReceivingScenarioTest.receipt(),1,"receiving"));
                assertEquals(requests,service.list("101"));assertNull(store.submission("101","receiving"));assertEquals(9,schema(saved));
                failed=backups();assertEquals(older.size()+1,failed.size());
                for(var entry:older.entrySet())assertArrayEquals(entry.getValue(),failed.get(entry.getKey()));
                var newly=failed.keySet().stream().filter(p->!p.equals(backup(path,7))&&!p.equals(backup(path,8))&&!p.equals(backup(path,9))).findFirst().orElseThrow();
                assertArrayEquals(bytes,failed.get(newly));
            }finally{Files.delete(path.resolve("block"));Files.delete(path);Files.move(saved,path);}
            var created=service.submitDocument("101",ReceivingScenarioTest.receipt(),1,"receiving");
            assertEquals(created,store.submission("101","receiving"));assertEquals(10,schema(path));sameBackups(failed);
        }
        try(var service=open(path)){assertEquals(4,service.list("101").size());}
    }
}
