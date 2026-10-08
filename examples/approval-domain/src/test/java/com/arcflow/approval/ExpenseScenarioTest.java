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

class ExpenseScenarioTest {
    @TempDir Path dir;
    final ObjectMapper mapper=ApprovalService.strictMapper(new ObjectMapper());
    final ActorDirectoryTest.Directory actors=new ActorDirectoryTest.Directory();
    ExpenseScenarioTest() { actors.active.addAll(List.of("303","404")); }
    Path file() { return dir.resolve("expenses.json"); }
    ScenarioCatalog.Entry entry() { return ScenarioCatalog.expense("202","303"); }
    ApprovalService service() throws IOException { return new ApprovalService(mapper,file().toString(),actors,entry().initialProcess()); }
    ScenarioCase host() throws IOException { return new ScenarioCase(entry(),service(),actors); }
    static BusinessDocument.Expense expense() { return new BusinessDocument.Expense(1,"EXP-1"," Expense "," Demo expenses ","ENGINEERING","CNY",List.of(
        new BusinessDocument.ExpenseLine("line-1","2026-10-01","OFFICE"," Stationery ",new BigDecimal("0.10"),"RECEIPT-1"),
        new BusinessDocument.ExpenseLine("line-2","2026-10-02","TRAVEL"," Transit ",new BigDecimal("0.20"),"RECEIPT-2"))); }
    @Test void deepImmutableDistinctFormSchemaAndExactTotalsSurviveApprovedReplayAndRestart() throws Exception {
        var mutable=new ArrayList<>(expense().lines()); var original=new BusinessDocument.Expense(1,"EXP-1"," Expense "," Demo expenses ","ENGINEERING","CNY",mutable); mutable.clear();
        assertEquals(2,original.lines().size()); assertThrows(UnsupportedOperationException.class,()->original.lines().clear());
        ScenarioCase.View approved;
        try(var host=host()) {
            var created=host.submit("101",original,1,"expense"); assertEquals("0.30",created.total()); assertEquals("Expense",created.request().title());
            assertEquals("Stationery",((BusinessDocument.Expense)created.request().business()).lines().get(0).description());
            assertEquals(0,created.request().days()); assertEquals(7,mapper.readTree(Files.readAllBytes(file())).path("schemaVersion").asInt());
            assertEquals("PENDING",host.decide("202",created.request().id(),"manager","APPROVE","Verified").request().status());
            approved=host.decide("303",created.request().id(),"finance","APPROVE","Reviewed"); assertEquals("APPROVED",approved.request().status());
            assertEquals(created.request().business(),approved.request().business());
        }
        try(var host=host()) { assertEquals(List.of(approved),host.list("101")); assertEquals(approved,host.submit("101",expense(),1,"expense")); }
    }
    @Test void strictFieldsLineRulesAndCanonicalIntentRejectTampering() throws Exception {
        var node=(ObjectNode)mapper.valueToTree(expense());
        for(String field:List.of("type","documentVersion","businessId","title","reason","costCenter","currency","lines")) {
            var bad=node.deepCopy(); bad.remove(field); assertThrows(IOException.class,()->mapper.treeToValue(bad,BusinessDocument.class),field);
        }
        for(String field:List.of("lineId","spentOn","category","description","amount","receiptRef")) {
            var bad=node.deepCopy(); ((ObjectNode)bad.path("lines").get(0)).remove(field); assertThrows(IOException.class,()->mapper.treeToValue(bad,BusinessDocument.class),field);
        }
        for(String patch:List.of("\"spentOn\":\"2026-02-30\"","\"spentOn\":\"0000-01-01\"","\"category\":\"HIDDEN\"","\"description\":\" \"","\"amount\":0","\"amount\":0.001","\"amount\":1000000000.01","\"receiptRef\":\"bad ref\"")) {
            var bad=node.deepCopy(); var value=mapper.readTree("{"+patch+"}"); String field=value.fieldNames().next(); ((ObjectNode)bad.path("lines").get(0)).set(field,value.get(field));
            var decoded=mapper.treeToValue(bad,BusinessDocument.class); assertThrows(IllegalArgumentException.class,decoded::validate,patch);
        }
        try(var host=host()) {
            var saved=host.submit("101",expense(),1,"key");
            for(String field:List.of("businessId","title","reason","costCenter","currency")) {
                var changed=node.deepCopy().put(field,field.equals("currency")?"USD":field.equals("costCenter")?"SALES":"OTHER");
                var decoded=mapper.treeToValue(changed,BusinessDocument.class); ActorDirectoryTest.status(409,()->host.submit("101",decoded,1,"key"));
            }
            for(String field:List.of("lineId","spentOn","category","description","amount","receiptRef")) {
                var changed=node.deepCopy(); var line=(ObjectNode)changed.path("lines").get(0);
                if(field.equals("amount")) line.put(field,new BigDecimal("0.11")); else line.put(field,field.equals("spentOn")?"2026-10-03":field.equals("category")?"MEALS":"OTHER");
                var decoded=mapper.treeToValue(changed,BusinessDocument.class); ActorDirectoryTest.status(409,()->host.submit("101",decoded,1,"key"));
            }
            assertEquals(saved,host.submit("101",expense(),1,"key")); actors.active.remove("101"); ActorDirectoryTest.status(403,()->host.submit("101",expense(),1,"key"));
        }
    }
    @Test void descriptionsMustRemainNonblankAfterCanonicalNormalization() throws Exception {
        var node=(ObjectNode)mapper.valueToTree(expense());
        for(String text:List.of("\u0000", " \u0000 ", "\t\u0000\r")) {
            var invalid=node.deepCopy(); ((ObjectNode)invalid.path("lines").get(0)).put("description",text);
            var decoded=mapper.treeToValue(invalid,BusinessDocument.class); assertThrows(IllegalArgumentException.class,decoded::validate);
            try(var host=host()) { ActorDirectoryTest.status(400,()->host.submit("101",decoded,1,"invalid-text")); assertTrue(host.list("101").isEmpty()); }
        }
    }
    @Test void duplicateReferencesBoundedLinesPrecisionAndWrongTypeCannotEnterScenario() throws Exception {
        try(var host=host()) {
            var original=expense(); var variants=new ArrayList<BusinessDocument.Expense>();
            variants.add(new BusinessDocument.Expense(2,original.businessId(),original.title(),original.reason(),original.costCenter(),original.currency(),original.lines()));
            variants.add(new BusinessDocument.Expense(1,original.businessId(),original.title(),original.reason(),"BAD",original.currency(),original.lines()));
            variants.add(new BusinessDocument.Expense(1,original.businessId(),original.title(),original.reason(),original.costCenter(),"JPY",original.lines()));
            variants.add(new BusinessDocument.Expense(1,original.businessId(),original.title(),original.reason(),original.costCenter(),original.currency(),List.of()));
            variants.add(new BusinessDocument.Expense(1,original.businessId(),original.title(),original.reason(),original.costCenter(),original.currency(),Collections.nCopies(21,original.lines().get(0))));
            variants.add(new BusinessDocument.Expense(1,original.businessId(),original.title(),original.reason(),original.costCenter(),original.currency(),Collections.nCopies(2,original.lines().get(0))));
            var line=original.lines().get(0); var duplicateReceipt=new BusinessDocument.ExpenseLine("different-line",line.spentOn(),line.category(),line.description(),line.amount(),line.receiptRef());
            variants.add(new BusinessDocument.Expense(1,original.businessId(),original.title(),original.reason(),original.costCenter(),original.currency(),List.of(line,duplicateReceipt)));
            for(var bad:variants) ActorDirectoryTest.status(400,()->host.submit("101",bad,1,"bad"));
            ActorDirectoryTest.status(400,()->host.submit("101",new BusinessDocument.Leave("L-1","Leave","Rest",1),1,"bad"));
            ActorDirectoryTest.status(400,()->host.submit("101",expense(),1,null)); assertTrue(host.list("101").isEmpty());
        }
    }
    @Test void schemaFiveAndSixUpgradePreserveImmediateBytesAndNeverDowngrade() throws Exception {
        for(int schema:List.of(5,6)) {
            Path path=dir.resolve("old-"+schema+".json"); byte[] before;
            try(var service=new ApprovalService(mapper,path.toString(),actors,entry().initialProcess())) {
                if(schema==5) service.submitDocument("101",new BusinessDocument.Leave("L-1","Leave","Rest",1),1,"old");
                else service.submitDocument("101",new BusinessDocument.QuoteDiscount("Q-1","Quote","Reason","C-1",1,"Item",1,new BigDecimal("1.00"),new BigDecimal("0.50"),"CNY","2099-01-01"),1,"old");
            }
            try(var service=new ApprovalService(mapper,path.toString(),actors,entry().initialProcess())) {
                var old=service.list("101").get(0); service.decide("202",old.id(),"manager","APPROVE","Before upgrade"); before=Files.readAllBytes(path);
                assertEquals(schema,mapper.readTree(before).path("schemaVersion").asInt()); service.submitDocument("101",expense(),1,"new");
                assertArrayEquals(before,Files.readAllBytes(path.resolveSibling(path.getFileName()+".schema"+schema+".bak")));
                service.submit("101","Legacy","Rest",1,1,"legacy"); assertEquals(7,mapper.readTree(Files.readAllBytes(path)).path("schemaVersion").asInt());
            }
            byte[] good=Files.readAllBytes(path); var bad=(ObjectNode)mapper.readTree(good); bad.put("schemaVersion",schema); Files.write(path,mapper.writeValueAsBytes(bad));
            assertThrows(IOException.class,()->new ApprovalService(mapper,path.toString(),actors,entry().initialProcess())); Files.write(path,good);
            try(var service=new ApprovalService(mapper,path.toString(),actors,entry().initialProcess())) { assertEquals(3,service.list("101").size()); }
        }
    }
    @Test void failedSchemaUpgradePublishesNeitherRequestNorKeyAndRetryKeepsBackup() throws Exception {
        byte[] before;
        try(var service=service()) { service.submitDocument("101",new BusinessDocument.Leave("L-1","Leave","Rest",1),1,"old"); }
        before=Files.readAllBytes(file());
        try(var service=service()) {
            Files.delete(file()); Files.createDirectory(file()); Files.writeString(file().resolve("block"),"block");
            assertThrows(IOException.class,()->service.submitDocument("101",expense(),1,"key")); assertEquals(1,service.list("101").size());
            assertArrayEquals(before,Files.readAllBytes(file().resolveSibling("expenses.json.schema5.bak")));
            Files.delete(file().resolve("block")); Files.delete(file()); Files.write(file(),before);
            assertEquals("EXP-1",service.submitDocument("101",expense(),1,"key").business().businessId()); assertEquals(2,service.list("101").size());
            assertArrayEquals(before,Files.readAllBytes(file().resolveSibling("expenses.json.schema5.bak")));
        }
    }
    @Test void concurrentRetryAndAllAnyVotingUseExistingDurableLifecycle() throws Exception {
        try(var host=host()) {
            var pool=Executors.newFixedThreadPool(8); var gate=new CountDownLatch(1);
            try { var futures=new ArrayList<Future<ScenarioCase.View>>(); for(int i=0;i<8;i++) futures.add(pool.submit(()->{gate.await();return host.submit("101",expense(),1,"race");}));
                gate.countDown(); var ids=new HashSet<String>(); for(var future:futures) ids.add(future.get(10,TimeUnit.SECONDS).request().id()); assertEquals(1,ids.size()); assertEquals(1,host.list("101").size());
            } finally { pool.shutdownNow(); }
        }
        for(String mode:List.of("ALL","ANY")) {
            var template=ParallelApprovalTest.definition(mode,false); var process=new ProcessDefinition(3,"oa-expense",1,"Expense",template.nodes());
            try(var service=new ApprovalService(mapper,dir.resolve(mode+".json").toString(),actors,process)) {
                var request=service.submitDocument("101",expense(),1,"key"); var first=service.decide("202",request.id(),"review","REJECT","");
                assertEquals(mode.equals("ALL")?"REJECTED":"PENDING",first.status());
                if(mode.equals("ANY")) assertEquals("APPROVED",service.decide("303",request.id(),"review","APPROVE","").status());
            }
        }
    }
}
