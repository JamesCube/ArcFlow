package com.arcflow.approval.jdbc;

import com.arcflow.approval.ActorDirectory;
import com.arcflow.approval.ApprovalService;
import com.arcflow.approval.BusinessDocument;
import com.arcflow.approval.ProcessDefinition;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

import javax.sql.DataSource;
import java.util.concurrent.TimeoutException;
import static com.arcflow.approval.jdbc.ServerTestSupport.GateDataSource;

/** The same semantic contract runs on each real server, never a compatibility-mode substitute. */
abstract class ServerApprovalStoreContract {
    protected DataSource dataSource;
    protected static final ActorDirectory USERS = new ActorDirectory() {
        private final Map<String, ApprovalService.Person> people = Map.of(
            "alice", new ApprovalService.Person("alice", "Alice"),
            "bob", new ApprovalService.Person("bob", "Bob"),
            "carol", new ApprovalService.Person("carol", "Carol"));
        public Optional<ApprovalService.Person> findActive(String id) { return Optional.ofNullable(people.get(id)); }
        public List<ApprovalService.Person> listActive() { return List.copyOf(people.values()); }
        public boolean canPublish(String id) { return "alice".equals(id); }
    };

    protected ApprovalService open() throws IOException {
        return new ApprovalService(new JdbcApprovalStore(dataSource, new ObjectMapper(), ProcessDefinition.legacy("bob")), USERS);
    }
    protected void sql(String sql) throws Exception {
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) { statement.execute(sql); }
    }
    protected int count(String table) throws Exception {
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement();
             var result = statement.executeQuery("SELECT COUNT(*) FROM " + table)) {
            assertTrue(result.next()); return result.getInt(1);
        }
    }
    protected static int result(Callable<?> action) throws Exception {
        try { action.call(); return 200; }
        catch (ResponseStatusException e) { return e.getStatusCode().value(); }
    }
    protected static <T> List<T> race(List<Callable<T>> actions) throws Exception {
        var executor = Executors.newFixedThreadPool(actions.size());
        var gate = new CountDownLatch(1);
        try {
            var futures = new ArrayList<Future<T>>();
            for (var action : actions) futures.add(executor.submit(() -> { gate.await(); return action.call(); }));
            gate.countDown();
            var results = new ArrayList<T>();
            for (var future : futures) results.add(future.get(30, TimeUnit.SECONDS));
            return results;
        } finally { executor.shutdownNow(); assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS)); }
    }
    protected static BusinessDocument.Expense expenseDocument() {
        return new BusinessDocument.Expense(1,"EXP-SQL-1","Office expense","Synthetic references only","OPERATIONS","CNY",List.of(
            new BusinessDocument.ExpenseLine("line-1","2026-10-01","OFFICE","Supplies",new BigDecimal("0.10"),"RECEIPT-1"),
            new BusinessDocument.ExpenseLine("line-2","2026-10-02","TRAVEL","Transit",new BigDecimal("0.20"),"RECEIPT-2")));
    }
    protected ApprovalService expenseService() throws IOException {
        return new ApprovalService(new JdbcApprovalStore(dataSource,new ObjectMapper(),com.arcflow.approval.ScenarioCatalog.expense("bob","carol").initialProcess()),USERS);
    }
    @Test void expenseTypedSnapshotGlobalKeysAndMemberProjectionRemainProcessIsolated() throws Exception {
        ApprovalService.Request approved;
        try(var expenses=expenseService(); var leave=open()) {
            var created=expenses.submitDocument("alice",expenseDocument(),1,"expense-shared");
            assertEquals("0.3",((BusinessDocument.Expense)created.business()).total().toPlainString());
            assertEquals(409,result(()->leave.submit("alice","Leave","Rest",1,1,"expense-shared"))); assertTrue(leave.list("alice").isEmpty());
            assertEquals(404,result(()->leave.decide("bob",created.id(),"manager","APPROVE","")));
            expenses.decide("bob",created.id(),"manager","APPROVE","Reviewed");
            var query=new java.util.LinkedHashMap<String,java.util.List<String>>(); query.put("box",List.of("PENDING"));
            assertEquals(1,expenses.inbox("carol",query).items().size()); assertEquals(0,leave.inbox("carol",query).items().size());
            approved=expenses.decide("carol",created.id(),"finance","APPROVE","Reviewed");
            assertEquals(created.business(),approved.business()); assertEquals("APPROVED",approved.status());
        }
        try(var reopened=expenseService()) { assertEquals(List.of(approved),reopened.list("alice")); assertEquals(approved,reopened.submitDocument("alice",expenseDocument(),1,"expense-shared")); }
    }
    @Test void expenseConcurrentRetryCreatesOneRequestBindingAndExactAudit() throws Exception {
        try(var first=expenseService(); var second=expenseService()) {
            var commands=new ArrayList<Callable<ApprovalService.Request>>();
            for(int i=0;i<8;i++) { var service=i%2==0?first:second; commands.add(()->service.submitDocument("alice",expenseDocument(),1,"expense-race")); }
            var saved=race(commands); assertTrue(saved.stream().allMatch(saved.get(0)::equals));
            assertEquals(1,count("arc_request")); assertEquals(1,count("arc_submission_key")); assertEquals(1,count("arc_request_event")); assertEquals(2,count("arc_request_member"));
        }
    }

    protected static BusinessDocument.Travel travelDocument() {
        return new BusinessDocument.Travel(1,"TRIP-SQL-1","Customer visit","Synthetic itinerary only"," Shanghai ",
            "2026-10-08","2026-10-10","CUSTOMER_VISIT",new BigDecimal("1234.50"),"CNY","SALES");
    }
    protected ApprovalService travelService() throws IOException {
        return new ApprovalService(new JdbcApprovalStore(dataSource,new ObjectMapper(),com.arcflow.approval.ScenarioCatalog.travel("bob","carol").initialProcess()),USERS);
    }
    @Test void travelTypedSnapshotGlobalKeysAndMemberProjectionRemainProcessIsolated() throws Exception {
        ApprovalService.Request approved;
        try(var travel=travelService(); var leave=open(); var expenses=expenseService()) {
            var created=travel.submitDocument("alice",travelDocument(),1,"travel-shared");
            var document=(BusinessDocument.Travel)created.business(); assertEquals("Shanghai",document.destination());
            assertEquals(new BigDecimal("1234.5"),document.estimatedCost()); assertEquals(3,document.durationDays()); assertEquals(0,created.days());
            assertEquals(409,result(()->leave.submit("alice","Leave","Rest",1,1,"travel-shared")));
            assertEquals(409,result(()->expenses.submitDocument("alice",expenseDocument(),1,"travel-shared")));
            assertTrue(leave.list("alice").isEmpty()); assertTrue(expenses.list("alice").isEmpty());
            assertEquals(404,result(()->leave.decide("bob",created.id(),"tripReview","APPROVE","")));
            assertEquals(404,result(()->expenses.decide("bob",created.id(),"tripReview","APPROVE","")));
            var pending=Map.of("box",List.of("PENDING")); var handled=Map.of("box",List.of("HANDLED"));
            assertEquals(List.of(created),travel.inbox("bob",pending).items()); assertTrue(travel.inbox("carol",pending).items().isEmpty());
            var first=travel.decide("bob",created.id(),"tripReview","APPROVE","Reviewed itinerary");
            assertTrue(travel.inbox("bob",pending).items().isEmpty()); assertEquals(List.of(first),travel.inbox("bob",handled).items());
            assertEquals(List.of(first),travel.inbox("carol",pending).items());
            assertTrue(leave.inbox("carol",pending).items().isEmpty()); assertTrue(expenses.inbox("carol",pending).items().isEmpty());
            travel.publish("alice",1,com.arcflow.approval.ScenarioCatalog.travel("carol","bob").initialProcess());
            assertEquals(409,result(()->travel.submitDocument("alice",travelDocument(),1,"stale-fresh")));
            approved=travel.decide("carol",created.id(),"budget","APPROVE","Reviewed budget");
            assertEquals(created.business(),approved.business()); assertEquals(created.definition(),approved.definition());
            assertEquals(1,approved.processVersion()); assertEquals("APPROVED",approved.status());
            assertTrue(travel.inbox("carol",pending).items().isEmpty()); assertEquals(List.of(approved),travel.inbox("carol",handled).items());
            assertEquals(List.of(approved),travel.inbox("bob",handled).items());
            assertEquals(1,count("arc_request")); assertEquals(1,count("arc_submission_key")); assertEquals(3,count("arc_request_event")); assertEquals(2,count("arc_request_member"));
        }
        try(var reopened=travelService()) {
            assertEquals(2,reopened.process().version()); assertEquals(List.of(approved),reopened.list("alice"));
            assertEquals(approved,reopened.submitDocument("alice",travelDocument(),1,"travel-shared"));
            var changed=new BusinessDocument.Travel(1,"TRIP-SQL-1","Customer visit","Synthetic itinerary only","Beijing",
                "2026-10-08","2026-10-10","CUSTOMER_VISIT",new BigDecimal("1234.50"),"CNY","SALES");
            assertEquals(409,result(()->reopened.submitDocument("alice",changed,1,"travel-shared")));
            assertEquals(3,count("arc_request_event"));
        }
    }
    @Test void travelConcurrentRetryCreatesOneRequestBindingAndExactAudit() throws Exception {
        ApprovalService.Request saved;
        try(var first=travelService(); var second=travelService()) {
            var commands=new ArrayList<Callable<ApprovalService.Request>>();
            var canonical=new BusinessDocument.Travel(1,"TRIP-SQL-1","Customer visit","Synthetic itinerary only","Shanghai",
                "2026-10-08","2026-10-10","CUSTOMER_VISIT",new BigDecimal("1234.5"),"CNY","SALES");
            for(int i=0;i<8;i++) { var service=i%2==0?first:second; var document=i%2==0?travelDocument():canonical; commands.add(()->service.submitDocument("alice",document,1,"travel-race")); }
            var results=race(commands); saved=results.get(0); assertTrue(results.stream().allMatch(saved::equals));
            assertEquals(1,count("arc_request")); assertEquals(1,count("arc_submission_key")); assertEquals(1,count("arc_request_event")); assertEquals(2,count("arc_request_member"));
        }
        try(var reopened=travelService()) { assertEquals(List.of(saved),reopened.list("alice")); assertEquals(saved,reopened.submitDocument("alice",travelDocument(),1,"travel-race")); }
    }

    protected static BusinessDocument.SealUse sealUseDocument() {
        return new BusinessDocument.SealUse(1,"SEAL-SQL-1","Synthetic seal-use review","Review only, no stamping",
            "Synthetic delivery document","DOC-SQL-1","OFFICIAL",2);
    }
    protected ApprovalService sealUseService() throws IOException {
        return new ApprovalService(new JdbcApprovalStore(dataSource,new ObjectMapper(),
            com.arcflow.approval.ScenarioCatalog.sealUse("bob","carol").initialProcess()),USERS);
    }
    @Test void sealUseTypedSnapshotGlobalKeysAndMemberProjectionRemainProcessIsolated() throws Exception {
        ApprovalService.Request approved;
        try(var seals=sealUseService(); var expenses=expenseService(); var leave=open()) {
            var created=seals.submitDocument("alice",sealUseDocument(),1,"seal-shared");
            assertEquals(sealUseDocument(),created.business());
            assertEquals("oa-seal-use",created.processId());
            assertEquals(409,result(()->expenses.submitDocument("alice",expenseDocument(),1,"seal-shared")));
            assertEquals(409,result(()->leave.submit("alice","Leave","Rest",1,1,"seal-shared")));
            assertTrue(expenses.list("alice").isEmpty()); assertTrue(leave.list("alice").isEmpty());
            assertEquals(404,result(()->expenses.decide("bob",created.id(),"documentReview","APPROVE","")));
            assertEquals(403,result(()->seals.decide("alice",created.id(),"documentReview","APPROVE","")));
            var query=Map.of("box",List.of("PENDING"));
            assertEquals(1,seals.inbox("bob",query).items().size());
            assertEquals(0,expenses.inbox("bob",query).items().size());
            seals.decide("bob",created.id(),"documentReview","APPROVE","Document reviewed");
            assertEquals(0,seals.inbox("bob",query).items().size());
            assertEquals(1,seals.inbox("carol",query).items().size());
            approved=seals.decide("carol",created.id(),"sealReview","APPROVE","Review only, no seal applied");
            assertEquals(created.business(),approved.business()); assertEquals("APPROVED",approved.status());
            assertEquals(3,approved.history().size());
        }
        try(var reopened=sealUseService()) {
            assertEquals(List.of(approved),reopened.list("alice"));
            assertEquals(approved,reopened.submitDocument("alice",sealUseDocument(),1,"seal-shared"));
            assertEquals(approved,reopened.decide("carol",approved.id(),"sealReview","APPROVE","Retry cannot rewrite notes"));
        }
    }
    @Test void sealUseConcurrentRetryCreatesOneRequestBindingAndExactAudit() throws Exception {
        try(var first=sealUseService(); var second=sealUseService()) {
            var commands=new ArrayList<Callable<ApprovalService.Request>>();
            for(int i=0;i<8;i++) { var service=i%2==0?first:second; commands.add(()->service.submitDocument("alice",sealUseDocument(),1,"seal-race")); }
            var saved=race(commands); assertTrue(saved.stream().allMatch(saved.get(0)::equals));
            assertEquals(1,count("arc_request")); assertEquals(1,count("arc_submission_key"));
            assertEquals(1,count("arc_request_event")); assertEquals(2,count("arc_request_member"));
        }
    }
    @Test void sealUseEveryFieldAndVersionBindsRetryAfterRejectionAndReopen() throws Exception {
        ApprovalService.Request rejected;
        var original=sealUseDocument();
        var changes=List.of(
            new BusinessDocument.SealUse(1,"SEAL-SQL-2",original.title(),original.reason(),original.documentName(),original.documentRef(),original.sealType(),original.copyCount()),
            original.withText("Changed title",original.reason()), original.withText(original.title(),"Changed purpose"),
            new BusinessDocument.SealUse(1,original.businessId(),original.title(),original.reason(),"Changed document",original.documentRef(),original.sealType(),original.copyCount()),
            new BusinessDocument.SealUse(1,original.businessId(),original.title(),original.reason(),original.documentName(),"DOC-SQL-2",original.sealType(),original.copyCount()),
            new BusinessDocument.SealUse(1,original.businessId(),original.title(),original.reason(),original.documentName(),original.documentRef(),"CONTRACT",original.copyCount()),
            new BusinessDocument.SealUse(1,original.businessId(),original.title(),original.reason(),original.documentName(),original.documentRef(),original.sealType(),3));
        try(var seals=sealUseService()) {
            var saved=seals.submitDocument("alice",original,1,"seal-rejected");
            var definition=seals.process();
            seals.publish("alice",1,new ProcessDefinition(definition.schemaVersion(),definition.id(),1,"Changed policy",definition.nodes()));
            rejected=seals.decide("bob",saved.id(),"documentReview","REJECT","Synthetic reason");
            assertEquals("REJECTED",rejected.status()); assertEquals(definition,rejected.definition());
        }
        try(var seals=sealUseService()) {
            assertEquals(rejected,seals.submitDocument("alice",original,1,"seal-rejected"));
            for(var changed:changes) assertEquals(409,result(()->seals.submitDocument("alice",changed,1,"seal-rejected")));
            assertEquals(409,result(()->seals.submitDocument("alice",original,2,"seal-rejected")));
            assertEquals(409,result(()->seals.decide("bob",rejected.id(),"documentReview","APPROVE","")));
            assertEquals(1,count("arc_request")); assertEquals(1,count("arc_submission_key")); assertEquals(2,count("arc_request_event"));
            // References are not uniqueness constraints; a distinct valid key creates a new request.
            var another=seals.submitDocument("alice",original,2,"seal-another");
            assertNotEquals(rejected.id(),another.id()); assertEquals(2,count("arc_submission_key"));
        }
    }
    @Test void sealUseFailedAuditRollsBackTypedRequestMembersAndKey() throws Exception {
        try(var seals=sealUseService()) {
            sql("ALTER TABLE arc_request_event ADD CONSTRAINT fail_seal_submission CHECK (event_index > 0)");
            assertThrows(IOException.class,()->seals.submitDocument("alice",sealUseDocument(),1,"seal-failed"));
            assertEquals(0,count("arc_request")); assertEquals(0,count("arc_submission_key"));
            assertEquals(0,count("arc_request_event")); assertEquals(0,count("arc_request_member"));
            sql("ALTER TABLE arc_request_event DROP CONSTRAINT fail_seal_submission");
            var saved=seals.submitDocument("alice",sealUseDocument(),1,"seal-failed");
            assertEquals(saved,seals.submitDocument("alice",sealUseDocument(),1,"seal-failed"));
        }
    }

    protected static BusinessDocument.Receiving receivingDocument() {
        return new BusinessDocument.Receiving(1,"GR-SQL-1","Goods receipt","Synthetic manually entered PO","PO-SQL-1","EAST","2026-10-09",List.of(
            new BusinessDocument.ReceivingLine("line-1","PO-L1","Demo sensors","PCS",20,10,8,2,"Damaged casing"),
            new BusinessDocument.ReceivingLine("line-2","PO-L2","Demo cables","BOX",10,5,5,0,"")));
    }
    protected ApprovalService receivingService() throws IOException {
        return new ApprovalService(new JdbcApprovalStore(dataSource,new ObjectMapper(),com.arcflow.approval.ScenarioCatalog.receiving("bob","carol","bob").initialProcess()),USERS);
    }
    @Test void receivingTypedSnapshotAllVotesAndProcessIsolation() throws Exception {
        ApprovalService.Request approved;
        try(var receipts=receivingService();var leave=open()) {
            var created=receipts.submitDocument("alice",receivingDocument(),1,"receiving-global");
            assertEquals(409,result(()->leave.submit("alice","Leave","Rest",1,1,"receiving-global")));assertTrue(leave.list("alice").isEmpty());
            assertEquals(404,result(()->leave.decide("bob",created.id(),"receiving-inspection","APPROVE","")));
            var first=receipts.decide("bob",created.id(),"receiving-inspection","APPROVE","Warehouse");assertEquals("receiving-inspection",first.currentStepId());
            assertEquals(1,receipts.inbox("carol",Map.of("box",List.of("PENDING"))).items().size());
            assertEquals(0,receipts.inbox("bob",Map.of("box",List.of("PENDING"))).items().size());
            var original=receipts.process();receipts.publish("alice",1,new ProcessDefinition(original.schemaVersion(),original.id(),1,"Updated receipt policy",original.nodes()));
            var second=receipts.decide("carol",created.id(),"receiving-inspection","APPROVE","Quality");assertEquals("procurement-review",second.currentStepId());
            assertEquals(1,receipts.inbox("bob",Map.of("box",List.of("PENDING"))).items().size());
            approved=receipts.decide("bob",created.id(),"procurement-review","APPROVE","Procurement");
            assertEquals("APPROVED",approved.status());assertEquals(4,approved.history().size());assertEquals(created.business(),approved.business());assertEquals(created.definition(),approved.definition());
        }
        try(var reopened=receivingService()){assertEquals(List.of(approved),reopened.list("alice"));assertEquals(approved,reopened.submitDocument("alice",receivingDocument(),1,"receiving-global"));}
    }
    @Test void receivingConcurrentRetryAndRepeatedReviewerRemainExact() throws Exception {
        try(var first=receivingService();var second=receivingService()) {
            var commands=new ArrayList<Callable<ApprovalService.Request>>();
            for(int i=0;i<8;i++){var service=i%2==0?first:second;commands.add(()->service.submitDocument("alice",receivingDocument(),1,"receiving-race"));}
            var saved=race(commands);assertTrue(saved.stream().allMatch(saved.get(0)::equals));String id=saved.get(0).id();
            assertEquals(1,count("arc_request"));assertEquals(1,count("arc_submission_key"));assertEquals(1,count("arc_request_event"));assertEquals(2,count("arc_request_member"));
            commands.clear();for(int i=0;i<8;i++){var service=i%2==0?first:second;commands.add(()->service.decide("bob",id,"receiving-inspection","APPROVE","Warehouse"));}
            var votes=race(commands);assertTrue(votes.stream().allMatch(votes.get(0)::equals));assertEquals(2,count("arc_request_event"));
            first.decide("carol",id,"receiving-inspection","APPROVE","Quality");var done=second.decide("bob",id,"procurement-review","APPROVE","Procurement");
            assertEquals("APPROVED",done.status());assertEquals(4,count("arc_request_event"));
        }
    }
    @Test void receivingRawNegativeZeroPayloadCannotBeRead() throws Exception {
        String id;
        try(var service=receivingService()){id=service.submitDocument("alice",receivingDocument(),1,"receiving-negative-zero").id();}
        try(var connection=dataSource.getConnection();var query=connection.prepareStatement("SELECT request_json FROM arc_request WHERE request_id = ?")) {
            query.setString(1,id);try(var rows=query.executeQuery()){assertTrue(rows.next());String original=rows.getString(1),bad=original.replace("\"rejected\":0","\"rejected\":-0");assertNotEquals(original,bad);
                try(var update=connection.prepareStatement("UPDATE arc_request SET request_json = ? WHERE request_id = ?")){update.setString(1,bad);update.setString(2,id);assertEquals(1,update.executeUpdate());}}
        }
        try(var reopened=receivingService()){assertThrows(java.io.UncheckedIOException.class,()->reopened.list("alice"));}
        assertEquals(1,count("arc_request_event"));
    }
    @Test void receivingHostRejectsWrongBusinessTypeBeforeMutation() throws Exception {
        var entry=com.arcflow.approval.ScenarioCatalog.receiving("bob","carol","bob");
        try(var service=receivingService();var host=new com.arcflow.approval.ScenarioCase(entry,service,USERS)) {
            var wrong=service.submitDocument("alice",expenseDocument(),1,"receiving-wrong-type");
            assertThrows(IllegalStateException.class,()->new com.arcflow.approval.ScenarioCase(entry,service,USERS));
            assertThrows(IllegalStateException.class,()->host.decide("bob",wrong.id(),"receiving-inspection","APPROVE","Do not write"));
            assertEquals(1,count("arc_request_event"));assertEquals(wrong,service.list("alice").get(0));
        }
    }

    /** One fresh schema, four exact typed processes; SQL revision and member readiness stay unchanged. */
    private final class MixedScenarios implements AutoCloseable {
        final List<ProcessDefinition> definitions = List.of(
            com.arcflow.approval.ScenarioCatalog.expense("bob","carol").initialProcess(),
            com.arcflow.approval.ScenarioCatalog.travel("bob","carol").initialProcess(),
            com.arcflow.approval.ScenarioCatalog.sealUse("bob","carol").initialProcess(),
            com.arcflow.approval.ScenarioCatalog.receiving("bob","carol","bob").initialProcess());
        final List<BusinessDocument> documents = List.of(expenseDocument(),travelDocument(),sealUseDocument(),receivingDocument());
        final List<String> firstSteps = List.of("manager","tripReview","documentReview","receiving-inspection");
        final List<ApprovalService> services = new ArrayList<>();
        MixedScenarios() throws IOException {
            try {
                for (var definition : definitions)
                    services.add(new ApprovalService(new JdbcApprovalStore(dataSource,new ObjectMapper(),definition),USERS));
            } catch (IOException | RuntimeException failure) { close(); throw failure; }
        }
        List<ApprovalService.Request> submitAll(String prefix) throws IOException {
            var result = new ArrayList<ApprovalService.Request>();
            for (int i=0;i<services.size();i++)
                result.add(services.get(i).submitDocument("alice",documents.get(i),1,prefix+i));
            return List.copyOf(result);
        }
        @Override public void close() throws IOException { for (var service : services) service.close(); }
    }
    private void assertMixedCounts(int requests,int events) throws Exception {
        assertEquals(requests,count("arc_request")); assertEquals(requests,count("arc_submission_key"));
        assertEquals(events,count("arc_request_event")); assertEquals(2*requests,count("arc_request_member"));
        assertEquals(4,count("arc_process_head"));
        try(var connection=dataSource.getConnection();var statement=connection.createStatement();
            var rows=statement.executeQuery("SELECT ready, last_request_id FROM arc_member_projection_state WHERE singleton_id = 1")) {
            assertTrue(rows.next()); assertTrue(rows.getBoolean(1)); assertNull(rows.getString(2)); assertFalse(rows.next());
        }
    }
    @Test void mixedScenarioDatabaseReadsDecisionsAndInboxesRemainProcessIsolated() throws Exception {
        try(var mixed=new MixedScenarios()) {
            var saved=mixed.submitAll("mixed-isolation-");
            var pending=Map.of("box",List.of("PENDING")); var handled=Map.of("box",List.of("HANDLED"));
            for(int i=0;i<4;i++) {
                var service=mixed.services.get(i); var own=saved.get(i);
                assertEquals(List.of(own),service.list("alice")); assertEquals(List.of(own),service.inbox("bob",pending).items());
                for(int j=0;j<4;j++) if(i!=j) {
                    var foreign=saved.get(j); String foreignStep=mixed.firstSteps.get(j);
                    assertEquals(404,result(()->service.decide("bob",foreign.id(),foreignStep,"APPROVE","Wrong process")));
                }
                var first=service.decide("bob",own.id(),mixed.firstSteps.get(i),"APPROVE","First review");
                assertEquals(List.of(first),service.inbox("bob",handled).items()); assertTrue(service.inbox("bob",pending).items().isEmpty());
                assertEquals(List.of(first),service.inbox("carol",pending).items());
            }
            // Receiving reuses Bob: the first vote is handled while the next stage is pending.
            var receipts=mixed.services.get(3); var receiving=saved.get(3);
            var next=receipts.decide("carol",receiving.id(),"receiving-inspection","APPROVE","Quality review");
            assertEquals(List.of(next),receipts.inbox("bob",handled).items()); assertEquals(List.of(next),receipts.inbox("bob",pending).items());
            var finalSteps=List.of("finance","budget","sealReview","procurement-review");
            for(int i=0;i<4;i++) {
                var service=mixed.services.get(i);
                var done=service.decide(i==3?"bob":"carol",saved.get(i).id(),finalSteps.get(i),"APPROVE","Final review");
                assertEquals("APPROVED",done.status()); assertEquals(saved.get(i).business(),done.business());
                assertEquals(saved.get(i).definition(),done.definition()); assertTrue(service.inbox("bob",pending).items().isEmpty());
                assertTrue(service.inbox("carol",pending).items().isEmpty()); assertEquals(List.of(done),service.list("alice"));
            }
            assertMixedCounts(4,13);
        }
    }
    @Test void mixedScenarioDatabaseSubmissionKeysStayApplicantGlobalAcrossEveryType() throws Exception {
        try(var mixed=new MixedScenarios()) {
            for(int winner=0;winner<4;winner++) {
                String key="mixed-global-"+winner;
                var saved=mixed.services.get(winner).submitDocument("alice",mixed.documents.get(winner),1,key);
                for(int contender=0;contender<4;contender++) {
                    var service=mixed.services.get(contender); var document=mixed.documents.get(contender);
                    if(contender==winner) assertEquals(saved,service.submitDocument("alice",document,1,key));
                    else assertEquals(409,result(()->service.submitDocument("alice",document,1,key)));
                }
            }
            assertMixedCounts(4,4);
            for(var service:mixed.services) assertEquals(1,service.list("alice").size());
        }
    }
    @Test void mixedScenarioDatabaseRestartPreservesTypedSnapshotsKeysAndIndependentVersions() throws Exception {
        var expected=new ArrayList<ApprovalService.Request>();
        try(var mixed=new MixedScenarios()) {
            var saved=mixed.submitAll("mixed-restart-");
            for(int i=0;i<4;i++) expected.add(mixed.services.get(i).decide("bob",saved.get(i).id(),mixed.firstSteps.get(i),"APPROVE","Persisted first vote"));
            var travel=mixed.services.get(1); var definition=travel.process();
            travel.publish("alice",1,new ProcessDefinition(definition.schemaVersion(),definition.id(),1,"Independent travel revision",definition.nodes()));
        }
        try(var reopened=new MixedScenarios()) {
            for(int i=0;i<4;i++) {
                var service=reopened.services.get(i); var saved=expected.get(i);
                assertEquals(List.of(saved),service.list("alice"));
                assertEquals(saved,service.submitDocument("alice",reopened.documents.get(i),1,"mixed-restart-"+i));
                assertEquals(saved,service.decide("bob",saved.id(),reopened.firstSteps.get(i),"APPROVE","Ignored retry"));
                assertEquals(i==1?2:1,service.process().version());
                assertEquals(List.of(saved),service.inbox("carol",Map.of("box",List.of("PENDING"))).items());
            }
            assertMixedCounts(4,8); assertEquals(5,count("arc_process_version"));
        }
    }
    @Test void mixedScenarioDatabaseConcurrentDifferentTypesCreateOneGlobalKeyWinner() throws Exception {
        var firstGate=new GateDataSource(dataSource,"INSERT INTO arc_submission_key");
        var secondGate=new GateDataSource(dataSource,"INSERT INTO arc_submission_key");
        var executor=Executors.newFixedThreadPool(2);
        try(var mixed=new MixedScenarios()) {
            var seeded=mixed.submitAll("mixed-race-seed-");
            try(var travel=new ApprovalService(new JdbcApprovalStore(firstGate,new ObjectMapper(),mixed.definitions.get(1)),USERS);
                var receiving=new ApprovalService(new JdbcApprovalStore(secondGate,new ObjectMapper(),mixed.definitions.get(3)),USERS)) {
                var first=executor.submit(()->result(()->travel.submitDocument("alice",travelDocument(),1,"mixed-race")));
                var second=executor.submit(()->result(()->receiving.submitDocument("alice",receivingDocument(),1,"mixed-race")));
                assertTrue(firstGate.entered.await(5,TimeUnit.SECONDS)); assertTrue(secondGate.entered.await(5,TimeUnit.SECONDS));
                firstGate.release.countDown(); secondGate.release.countDown();
                assertEquals(List.of(200,409),List.of(first.get(15,TimeUnit.SECONDS),second.get(15,TimeUnit.SECONDS)).stream().sorted().toList());
            }
            assertMixedCounts(5,5);
            for(int i=0;i<4;i++) assertTrue(mixed.services.get(i).list("alice").contains(seeded.get(i)));
        } finally {
            firstGate.release.countDown(); secondGate.release.countDown(); executor.shutdownNow(); assertTrue(executor.awaitTermination(10,TimeUnit.SECONDS));
        }
        try(var reopened=new MixedScenarios()) {
            int replayed=0;
            for(int i:List.of(1,3)) {
                var service=reopened.services.get(i); var document=reopened.documents.get(i);
                int status=result(()->service.submitDocument("alice",document,1,"mixed-race"));
                if(status==200) replayed++; else assertEquals(409,status);
            }
            assertEquals(1,replayed); assertMixedCounts(5,5);
        }
    }
    @Test void mixedScenarioDatabaseFailedWritesRollBackRequestAuditKeyAndMembersTogether() throws Exception {
        try(var mixed=new MixedScenarios()) {
            var seeded=mixed.submitAll("mixed-rollback-seed-");
            for(int i=0;i<4;i++) {
                var inserted=new java.util.concurrent.atomic.AtomicBoolean();
                var failing=ServerTestSupport.failAfterStatement(dataSource,"INSERT INTO arc_submission_key",inserted);
                var document=mixed.documents.get(i); String key="mixed-failed-"+i;
                try(var service=new ApprovalService(new JdbcApprovalStore(failing,new ObjectMapper(),mixed.definitions.get(i)),USERS)) {
                    assertThrows(IOException.class,()->service.submitDocument("alice",document,1,key)); assertTrue(inserted.get());
                }
                assertMixedCounts(4,4);
                for(int j=0;j<4;j++) {
                    var service=mixed.services.get(j); assertEquals(List.of(seeded.get(j)),service.list("alice"));
                    assertEquals(List.of(seeded.get(j)),service.inbox("bob",Map.of("box",List.of("PENDING"))).items());
                    assertTrue(service.inbox("bob",Map.of("box",List.of("HANDLED"))).items().isEmpty());
                }
            }
            // A failed key was never reserved, so every same-key retry succeeds after reopening normally.
        }
        try(var reopened=new MixedScenarios()) {
            var retried=reopened.submitAll("mixed-failed-");
            for(int i=0;i<4;i++) assertEquals(retried.get(i),reopened.services.get(i).submitDocument("alice",reopened.documents.get(i),1,"mixed-failed-"+i));
            assertMixedCounts(8,8);
        }
    }

    @Test void concurrentInitializationCreatesOneConsistentHead() throws Exception {
        var constructors = new ArrayList<Callable<Integer>>();
        for (int i = 0; i < 8; i++) constructors.add(() -> { try (var service = open()) { return service.process().version(); } });
        assertEquals(java.util.Collections.nCopies(8, 1), race(constructors));
        assertEquals(1, count("arc_process_head"));
        assertEquals(1, count("arc_process_version"));
    }
    @Test void duplicateDecisionsAcrossIndependentInstancesAppendExactlyOneEventAndSurviveReopen() throws Exception {
        String id;
        ApprovalService.Request committed;
        try (var first = open(); var second = open()) {
            id = first.submit("alice", "Leave", "Family", 2, 1).id();
            assertEquals(1, second.list("alice").size());
            var decisions = new ArrayList<Callable<ApprovalService.Request>>();
            for (int i = 0; i < 12; i++) {
                var service = i % 2 == 0 ? first : second;
                decisions.add(() -> service.decide("bob", id, "manager", "APPROVE", "approved"));
            }
            var results = race(decisions);
            committed = results.get(0);
            assertEquals("APPROVED", committed.status());
            for (var result : results) assertEquals(committed, result);
            assertEquals(2, count("arc_request_event"));
        }
        try (var restarted = open()) {
            assertEquals(committed, restarted.list("alice").get(0));
            assertEquals(committed, restarted.decide("bob", id, "manager", "APPROVE", "ignored retry"));
        }
    }
    @Test void oppositeDecisionsHaveOneWinnerAndOneConflict() throws Exception {
        try (var first = open(); var second = open()) {
            var request = first.submit("alice", "Leave", "Family", 2, 1);
            var results = race(List.of(
                () -> result(() -> first.decide("bob", request.id(), "manager", "APPROVE", "yes")),
                () -> result(() -> second.decide("bob", request.id(), "manager", "REJECT", "no"))));
            assertEquals(List.of(200, 409), results.stream().sorted().toList());
            assertEquals(2, first.list("alice").get(0).history().size());
            assertEquals(2, count("arc_request_event"));
        }
    }
    @Test void failingAuditInsertRollsBackRequestInsertAndDecisionUpdate() throws Exception {
        try (var service = open()) {
            sql("ALTER TABLE arc_request_event ADD CONSTRAINT fail_submission CHECK (event_index > 0)");
            assertThrows(IOException.class, () -> service.submit("alice", "Leave", "Rest", 1, 1));
            assertEquals(0, count("arc_request"));
            assertEquals(0, count("arc_request_event"));
            dropCheck("arc_request_event", "fail_submission");
            var request = service.submit("alice", "Leave", "Rest", 1, 1);
            sql("ALTER TABLE arc_request_event ADD CONSTRAINT fail_decision CHECK (event_index = 0)");
            assertThrows(IOException.class, () -> service.decide("bob", request.id(), "manager", "APPROVE", "first try"));
            assertEquals(request, service.list("alice").get(0));
            assertEquals(1, count("arc_request_event"));
            dropCheck("arc_request_event", "fail_decision");
            assertEquals("APPROVED", service.decide("bob", request.id(), "manager", "APPROVE", "retry").status());
            assertEquals(2, count("arc_request_event"));
        }
    }
    @Test void concurrentPublicationRetainsOneNewVersionAndExistingRequestSnapshot() throws Exception {
        try (var first = open(); var second = open()) {
            var request = first.submit("alice", "Leave", "Rest", 1, 1);
            var proposed = ProcessDefinition.legacy("carol");
            var results = race(List.of(
                () -> result(() -> first.publish("alice", 1, proposed)),
                () -> result(() -> second.publish("alice", 1, proposed))));
            assertEquals(List.of(200, 409), results.stream().sorted().toList());
            assertEquals(2, count("arc_process_version"));
            assertEquals(2, second.process().version());
            assertEquals(request.definition(), second.list("alice").get(0).definition());
            assertEquals(409, result(() -> second.submit("alice", "Stale", "Rest", 1, 1)));
            assertEquals("APPROVED", second.decide("bob", request.id(), "manager", "APPROVE", "old definition").status());
            assertEquals("carol", first.submit("alice", "New", "Rest", 1, 2).approverId());
        }
    }

    @Test void concurrentAllParticipantApprovalsAndTheirRetriesAppendExactlyTwoDecisionEvents() throws Exception {
        concurrentNonClosingParticipantVotes("ALL", "APPROVE", "APPROVED");
    }

    @Test void concurrentAnyParticipantRejectionsAndTheirRetriesAppendExactlyTwoDecisionEvents() throws Exception {
        concurrentNonClosingParticipantVotes("ANY", "REJECT", "REJECTED");
    }

    private void concurrentNonClosingParticipantVotes(String mode, String decision, String finalStatus) throws Exception {
        String id;
        ApprovalService.Request committed;
        try (var first = openParallel(mode); var second = openParallel(mode)) {
            id = first.submit("alice", "Parallel leave", "Rest", 1, 1).id();
            var actions = new ArrayList<Callable<ApprovalService.Request>>();
            for (int i = 0; i < 12; i++) {
                var service = i % 2 == 0 ? first : second;
                String actor = i % 3 == 0 ? "bob" : "carol";
                actions.add(() -> service.decide(actor, id, "review", decision, "participant vote"));
            }
            for (var result : race(actions)) {
                assertTrue(result.history().size() == 2 || result.history().size() == 3);
                assertEquals("review", result.history().get(1).stepId());
            }
            committed = first.list("alice").get(0);
            assertEquals(finalStatus, committed.status());
            assertNull(committed.currentStepId());
            assertEquals(List.of(), ApprovalService.pendingApproverIds(committed));
            assertEquals(List.of("bob", "carol"), committed.history().subList(1, 3).stream()
                .map(ApprovalService.Event::actorId).sorted().toList());
            assertEquals(List.of(decision, decision), committed.history().subList(1, 3).stream()
                .map(ApprovalService.Event::action).toList());
            assertEquals(3, count("arc_request_event"));
            assertEquals(2, requestRevision());
        }
        try (var reopened = open()) {
            assertEquals(committed, reopened.list("alice").get(0));
            assertEquals(committed, reopened.decide("bob", id, "review", decision, "ignored replay"));
            assertEquals(committed, reopened.decide("carol", id, "review", decision, "ignored replay"));
            String opposite = "APPROVE".equals(decision) ? "REJECT" : "APPROVE";
            assertEquals(409, result(() -> reopened.decide("bob", id, "review", opposite, "opposite replay")));
            assertEquals(3, count("arc_request_event"));
        }
    }

    @Test void concurrentAllRejectionsCloseGroupWithOneWinnerAndOneUnvotedConflict() throws Exception {
        concurrentClosingParticipantVotes("ALL", "REJECT", "REJECTED");
    }

    @Test void concurrentAnyApprovalsCloseGroupWithOneWinnerAndOneUnvotedConflict() throws Exception {
        concurrentClosingParticipantVotes("ANY", "APPROVE", "APPROVED");
    }

    @Test void allApproveThenRejectRaceRetainsPartialApprovalAndRejectsGroup() throws Exception {
        ParallelJdbcApprovalStoreTest.assertMixedVoteRace(dataSource, "ALL", "APPROVE");
    }

    @Test void allRejectThenApproveRaceClosesGroupAndConflictsUnvotedApprover() throws Exception {
        ParallelJdbcApprovalStoreTest.assertMixedVoteRace(dataSource, "ALL", "REJECT");
    }

    @Test void anyApproveThenRejectRaceClosesGroupAndConflictsUnvotedRejector() throws Exception {
        ParallelJdbcApprovalStoreTest.assertMixedVoteRace(dataSource, "ANY", "APPROVE");
    }

    @Test void anyRejectThenApproveRaceRetainsPartialRejectionAndApprovesGroup() throws Exception {
        ParallelJdbcApprovalStoreTest.assertMixedVoteRace(dataSource, "ANY", "REJECT");
    }

    private void concurrentClosingParticipantVotes(String mode, String decision, String finalStatus) throws Exception {
        try (var first = openParallel(mode); var second = openParallel(mode)) {
            var request = first.submit("alice", "Parallel leave", "Rest", 1, 1);
            var results = race(List.of(
                () -> result(() -> first.decide("bob", request.id(), "review", decision, "Bob's vote")),
                () -> result(() -> second.decide("carol", request.id(), "review", decision, "Carol's vote"))));
            assertEquals(List.of(200, 409), results.stream().sorted().toList());
            var committed = first.list("alice").get(0);
            assertEquals(finalStatus, committed.status());
            assertEquals(2, committed.history().size());
            assertEquals(2, count("arc_request_event"));
            assertEquals(1, requestRevision());
            String winner = committed.history().get(1).actorId();
            String loser = "bob".equals(winner) ? "carol" : "bob";
            assertEquals(committed, second.decide(winner, request.id(), "review", decision, "replay"));
            assertEquals(409, result(() -> second.decide(loser, request.id(), "review", decision, "late vote")));
            assertEquals(2, count("arc_request_event"));
        }
    }

    protected ApprovalService openParallel(String mode) throws IOException {
        var definition = ParallelJdbcApprovalStoreTest.definition(mode);
        return new ApprovalService(new JdbcApprovalStore(dataSource, new ObjectMapper(), definition), USERS);
    }

    protected int requestRevision() throws Exception {
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement();
             var result = statement.executeQuery("SELECT revision FROM arc_request")) {
            assertTrue(result.next()); return result.getInt(1);
        }
    }

    protected void dropCheck(String table, String constraint) throws Exception {
        sql("ALTER TABLE " + table + " DROP CONSTRAINT " + constraint);
    }
    @Test void allClosingAuditFailureRollsBackMembershipAndRevision() throws Exception { closingAuditFailure("ALL"); }
    @Test void anyClosingAuditFailureRollsBackMembershipAndRevision() throws Exception { closingAuditFailure("ANY"); }

    private void closingAuditFailure(String mode) throws Exception {
        String vote = "ALL".equals(mode) ? "APPROVE" : "REJECT";
        try (var first = openParallel(mode); var second = openParallel(mode)) {
            var original = first.submit("alice", "Leave", "Rest", 1, 1);
            var pending = first.decide("carol", original.id(), "review", vote, "first vote");
            sql("ALTER TABLE arc_request_event ADD CONSTRAINT refuse_closing_vote CHECK (event_index < 2)");
            assertThrows(IOException.class, () -> second.decide("bob", original.id(), "review", vote, "failed"));
            assertEquals(pending, first.list("alice").get(0));
            assertEquals(List.of("bob"), ApprovalService.pendingApproverIds(second.list("alice").get(0)));
            assertEquals(1, requestRevision());
            assertEquals(2, count("arc_request_event"));
            dropCheck("arc_request_event", "refuse_closing_vote");
            assertEquals("ALL".equals(mode) ? "APPROVED" : "REJECTED", second.decide("bob", original.id(), "review", vote, "retry").status());
            assertEquals(2, requestRevision());
            assertEquals(3, count("arc_request_event"));
        }
    }

    @Test void failedHeadUpdateRollsBackInsertedPublicationVersion() throws Exception {
        try (var service = open()) {
            sql("ALTER TABLE arc_process_head ADD CONSTRAINT refuse_publication CHECK (active_version = 1)");
            assertThrows(IOException.class, () -> service.publish("alice", 1, ProcessDefinition.legacy("carol")));
            assertEquals(1, service.process().version());
            assertEquals(1, count("arc_process_version"));
        }
    }

    @Test void partialAnyGroupAndRetainedDefinitionSurviveAdapterReopen() throws Exception { reopenPartialGroup("ANY"); }
    @Test void partialAllGroupAndRetainedDefinitionSurviveAdapterReopen() throws Exception { reopenPartialGroup("ALL"); }

    private void reopenPartialGroup(String mode) throws Exception {
        String partialVote = "ALL".equals(mode) ? "APPROVE" : "REJECT";
        ApprovalService.Request pending;
        try (var service = openParallel(mode)) {
            var original = service.submit("alice", "Leave", "Rest", 1, 1);
            pending = service.decide("bob", original.id(), "review", partialVote, "partial vote");
            service.publish("alice", 1, ProcessDefinition.legacy("bob"));
        }
        try (var reopened = open()) {
            assertEquals(2, reopened.process().version());
            assertEquals(pending, reopened.list("alice").get(0));
            assertEquals(List.of("carol"), ApprovalService.pendingApproverIds(pending));
            assertEquals(pending, reopened.decide("bob", pending.id(), "review", partialVote, "idempotent replay"));
            assertEquals("APPROVED", reopened.decide("carol", pending.id(), "review", "APPROVE", "remaining participant").status());
            assertEquals(3, count("arc_request_event"));
            assertEquals(2, count("arc_process_version"));
        }
    }

    @Test void corruptedAuditFailsClosedAfterReopen() throws Exception {
        String id;
        try (var service = open()) { id = service.submit("alice", "Leave", "Rest", 1, 1).id(); }
        sql("UPDATE arc_request_event SET event_json = '{}'");
        try (var service = open()) {
            assertThrows(java.io.UncheckedIOException.class, () -> service.list("alice"));
            assertThrows(IOException.class, () -> service.decide("bob", id, "manager", "APPROVE", "fail closed"));
            assertEquals(0, requestRevision());
        }
    }

    @Test void nonlockingReadKeepsStateAndAuditInOneSnapshotAcrossCommit() throws Exception {
        var gate = new GateDataSource(dataSource, "SELECT event_index, event_json FROM arc_request_event");
        var executor = Executors.newSingleThreadExecutor();
        try (var writer = open(); var reader = new JdbcApprovalStore(gate, new ObjectMapper(), ProcessDefinition.legacy("bob"))) {
            var original = writer.submit("alice", "Leave", "Rest", 1, 1);
            var reading = executor.submit(() -> reader.request(original.id()));
            assertTrue(gate.entered.await(5, TimeUnit.SECONDS));
            writer.decide("bob", original.id(), "manager", "APPROVE", "concurrent commit");
            gate.release.countDown();
            assertEquals(original, reading.get(10, TimeUnit.SECONDS));
            assertEquals("APPROVED", reader.request(original.id()).status());
        } finally { gate.release.countDown(); executor.shutdownNow(); assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS)); }
    }

    @Test void publicationLocksOutStaleSubmissionUntilNewHeadCommits() throws Exception {
        var gate = new GateDataSource(dataSource, "UPDATE arc_process_head");
        var contender = new GateDataSource(dataSource, "SELECT active_version FROM arc_process_head WHERE process_id = ? FOR UPDATE", false);
        contender.release.countDown(); // Observe the lock attempt, without delaying it outside the database.
        var executor = Executors.newFixedThreadPool(2);
        try (var publishing = new ApprovalService(new JdbcApprovalStore(gate, new ObjectMapper(), ProcessDefinition.legacy("bob")), USERS);
             var submitting = new ApprovalService(new JdbcApprovalStore(contender, new ObjectMapper(), ProcessDefinition.legacy("bob")), USERS)) {
            contender.arm(); // Initializer also locks the head; observe only the actual contender below.
            var publication = executor.submit(() -> publishing.publish("alice", 1, ProcessDefinition.legacy("carol")));
            assertTrue(gate.entered.await(5, TimeUnit.SECONDS));
            var submission = executor.submit(() -> result(() -> submitting.submit("alice", "Stale", "Rest", 1, 1)));
            assertTrue(contender.entered.await(5, TimeUnit.SECONDS));
            assertThrows(TimeoutException.class, () -> submission.get(150, TimeUnit.MILLISECONDS));
            gate.release.countDown();
            assertEquals(2, publication.get(10, TimeUnit.SECONDS).version());
            assertEquals(409, submission.get(10, TimeUnit.SECONDS));
            assertEquals(0, count("arc_request"));
            assertEquals(0, count("arc_request_event"));
        } finally { gate.release.countDown(); executor.shutdownNow(); assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS)); }
    }

    @Test void submissionLocksOutPublicationUntilItsOldSnapshotCommits() throws Exception {
        var gate = new GateDataSource(dataSource, "INSERT INTO arc_request (");
        var contender = new GateDataSource(dataSource, "SELECT active_version FROM arc_process_head WHERE process_id = ? FOR UPDATE", false);
        contender.release.countDown();
        var executor = Executors.newFixedThreadPool(2);
        try (var submitting = new ApprovalService(new JdbcApprovalStore(gate, new ObjectMapper(), ProcessDefinition.legacy("bob")), USERS);
             var publishing = new ApprovalService(new JdbcApprovalStore(contender, new ObjectMapper(), ProcessDefinition.legacy("bob")), USERS)) {
            contender.arm();
            var submission = executor.submit(() -> submitting.submit("alice", "Leave", "Rest", 1, 1));
            assertTrue(gate.entered.await(5, TimeUnit.SECONDS));
            var publication = executor.submit(() -> publishing.publish("alice", 1, ProcessDefinition.legacy("carol")));
            assertTrue(contender.entered.await(5, TimeUnit.SECONDS));
            assertThrows(TimeoutException.class, () -> publication.get(150, TimeUnit.MILLISECONDS));
            gate.release.countDown();
            var request = submission.get(10, TimeUnit.SECONDS);
            assertEquals(2, publication.get(10, TimeUnit.SECONDS).version());
            assertEquals(1, request.processVersion());
            assertEquals(request, publishing.list("alice").get(0));
            assertEquals(1, count("arc_request_event"));
        } finally { gate.release.countDown(); executor.shutdownNow(); assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS)); }
    }

    @Test void concurrentInitializersWithDifferentDefaultsKeepOneCompleteWinningSnapshot() throws Exception {
        var gates = new ArrayList<GateDataSource>();
        var futures = new ArrayList<Future<ProcessDefinition>>();
        var executor = Executors.newFixedThreadPool(8);
        try {
            for (int i = 0; i < 8; i++) {
                var initial = ProcessDefinition.legacy(i % 2 == 0 ? "bob" : "carol");
                var gate = new GateDataSource(dataSource, "INSERT INTO arc_process_version");
                gates.add(gate);
                futures.add(executor.submit(() -> {
                    try (var store = new JdbcApprovalStore(gate, new ObjectMapper(), initial)) { return store.process(); }
                }));
            }
            // Every initializer has observed an absent head before any version insert can proceed.
            for (var gate : gates) assertTrue(gate.entered.await(5, TimeUnit.SECONDS));
            for (var gate : gates) gate.release.countDown();
            var winner = futures.get(0).get(10, TimeUnit.SECONDS);
            for (var future : futures) assertEquals(winner, future.get(10, TimeUnit.SECONDS));
            assertEquals(1, count("arc_process_head"));
            assertEquals(1, count("arc_process_version"));
        } finally {
            for (var gate : gates) gate.release.countDown();
            executor.shutdownNow();
            assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS));
        }
    }

    @Test void simultaneousIdenticalSubmissionKeysCreateExactlyOneRequestAndSubmitEvent() throws Exception {
        try (var first = open(); var second = open()) {
            var calls = new ArrayList<Callable<ApprovalService.Request>>();
            for (int i = 0; i < 12; i++) {
                var service = i % 2 == 0 ? first : second;
                calls.add(() -> service.submit("alice", "Leave", "Rest", 2, 1, "retry-1"));
            }
            var results = race(calls);
            for (var request : results) assertEquals(results.get(0), request);
            assertEquals(1, count("arc_request"));
            assertEquals(1, count("arc_request_event"));
            assertEquals(1, count("arc_submission_key"));
        }
    }

    @Test void simultaneousChangedIntentForOneKeyHasOneWinnerAndOneConflict() throws Exception {
        try (var first = open(); var second = open()) {
            var results = race(List.of(
                () -> result(() -> first.submit("alice", "First intent", "Rest", 2, 1, "changed")),
                () -> result(() -> second.submit("alice", "Other intent", "Rest", 2, 1, "changed"))));
            assertEquals(List.of(200, 409), results.stream().sorted().toList());
            assertEquals(1, count("arc_request"));
            assertEquals(1, count("arc_request_event"));
            assertEquals(1, count("arc_submission_key"));
        }
    }

    @Test void normalizedRetryReturnsCurrentGroupStateAfterPublicationAndStoreReopen() throws Exception {
        ApprovalService.Request pending;
        try (var first = openParallel("ALL")) {
            var request = first.submit("alice", " Leave ", " Rest ", 2, 1, "normalized");
            pending = first.decide("bob", request.id(), "review", "APPROVE", "partial approval");
            first.publish("alice", 1, ProcessDefinition.legacy("carol"));
        }
        try (var reopened = open()) {
            assertEquals(pending, reopened.submit("alice", "Leave", "Rest", 2, 1, "normalized"));
            assertEquals(409, result(() -> reopened.submit("alice", "Leave", "Rest", 2, 2, "normalized")));
            var approved = reopened.decide("carol", pending.id(), "review", "APPROVE", "done");
            assertEquals(approved, reopened.submit("alice", "Leave", "Rest", 2, 1, "normalized"));
            assertEquals(1, count("arc_request"));
            assertEquals(3, count("arc_request_event"));
            assertEquals(1, count("arc_submission_key"));
        }
    }

    @Test void submissionKeysAreExactCaseSensitiveAndScopedToApplicant() throws Exception {
        try (var service = open(); var store = new JdbcApprovalStore(dataSource, new ObjectMapper(), ProcessDefinition.legacy("bob"))) {
            var upper = service.submit("alice", "Leave", "Rest", 1, 1, "Key-A");
            var lower = service.submit("alice", "Leave", "Rest", 1, 1, "key-a");
            var other = service.submit("carol", "Leave", "Rest", 1, 1, "Key-A");
            assertNotEquals(upper.id(), lower.id());
            assertNotEquals(upper.id(), other.id());
            assertEquals(upper, store.submission("alice", "Key-A"));
            assertEquals(lower, store.submission("alice", "key-a"));
            assertEquals(other, store.submission("carol", "Key-A"));
            assertNull(store.submission("alice", "KEY-A"));
            assertNull(store.submission("bob", "Key-A"));
            assertEquals(3, count("arc_submission_key"));
        }
    }

    @Test void unkeyedSubmissionsStillCreateIndependentRequests() throws Exception {
        try (var service = open()) {
            assertNotEquals(service.submit("alice", "Leave", "Rest", 1, 1).id(),
                service.submit("alice", "Leave", "Rest", 1, 1).id());
            assertEquals(2, count("arc_request"));
            assertEquals(2, count("arc_request_event"));
            assertEquals(0, count("arc_submission_key"));
        }
    }

    @Test void mappingToAnotherApplicantsRequestFailsClosed() throws Exception {
        try (var service = open()) {
            service.submit("alice", "Leave", "Rest", 1, 1, "owner");
            var other = service.submit("carol", "Private", "Other applicant", 1, 1);
            try (var connection = dataSource.getConnection(); var statement = connection.prepareStatement(
                    "UPDATE arc_submission_key SET request_id = ? WHERE applicant_id = ?")) {
                statement.setString(1, other.id()); statement.setString(2, "alice");
                assertEquals(1, statement.executeUpdate());
            }
        }
        try (var store = new JdbcApprovalStore(dataSource, new ObjectMapper(), ProcessDefinition.legacy("bob")); var service = open()) {
            assertThrows(IOException.class, () -> store.submission("alice", "owner"));
            assertThrows(IOException.class, () -> service.submit("alice", "Leave", "Rest", 1, 1, "owner"));
            assertThrows(IOException.class, () -> store.create(1, candidate("new", "Leave"), "owner"));
            assertEquals(2, count("arc_request"));
        }
    }

    @Test void persistedAuditCorruptionAlsoFailsClosedOnSubmissionReplay() throws Exception {
        try (var service = open()) { service.submit("alice", "Leave", "Rest", 1, 1, "corrupt"); }
        sql("UPDATE arc_request_event SET event_json = '{}'");
        try (var store = new JdbcApprovalStore(dataSource, new ObjectMapper(), ProcessDefinition.legacy("bob")); var service = open()) {
            assertThrows(IOException.class, () -> store.submission("alice", "corrupt"));
            assertThrows(IOException.class, () -> service.submit("alice", "Leave", "Rest", 1, 1, "corrupt"));
            assertThrows(IOException.class, () -> store.create(1, candidate("new", "Leave"), "corrupt"));
            assertEquals(1, count("arc_request"));
        }
    }

    @Test void failureBeforeKeyInsertionRollsBackRequestAuditAndLeavesKeyReusable() throws Exception {
        try (var service = open()) {
            sql("ALTER TABLE arc_request_event ADD CONSTRAINT refuse_keyed_submit CHECK (event_index > 0)");
            assertThrows(IOException.class, () -> service.submit("alice", "Leave", "Rest", 1, 1, "retry"));
            assertEmptySubmissionTables();
            dropCheck("arc_request_event", "refuse_keyed_submit");
            service.submit("alice", "Leave", "Rest", 1, 1, "retry");
            assertEquals(1, count("arc_submission_key"));
        }
    }

    @Test void failedKeyInsertionRollsBackBothEarlierRequestAndAuditInsertions() throws Exception {
        try (var service = open()) {
            sql("ALTER TABLE arc_submission_key ADD CONSTRAINT refuse_key CHECK (submission_key <> 'retry')");
            assertThrows(IOException.class, () -> service.submit("alice", "Leave", "Rest", 1, 1, "retry"));
            assertEmptySubmissionTables();
            dropCheck("arc_submission_key", "refuse_key");
            service.submit("alice", "Leave", "Rest", 1, 1, "retry");
            assertEquals(1, count("arc_submission_key"));
        }
    }

    @Test void failureAfterRealKeyInsertionRollsBackAllThreeWritesAndKeyIsReusable() throws Exception {
        var inserted = new java.util.concurrent.atomic.AtomicBoolean();
        var failureSource = ServerTestSupport.failAfterStatement(dataSource, "INSERT INTO arc_submission_key", inserted);
        try (var failing = new ApprovalService(new JdbcApprovalStore(failureSource, new ObjectMapper(), ProcessDefinition.legacy("bob")), USERS)) {
            assertThrows(IOException.class, () -> failing.submit("alice", "Leave", "Rest", 1, 1, "retry"));
            assertTrue(inserted.get(), "The failure must happen after the database executed the key INSERT");
            assertEmptySubmissionTables();
        }
        try (var service = open()) {
            service.submit("alice", "Leave", "Rest", 1, 1, "retry");
            assertEquals(1, count("arc_submission_key"));
        }
    }

    @Test void lostCommitAcknowledgementCanRetryDurablyWithoutAnotherRequestOrSubmitEvent() throws Exception {
        var lost = new java.util.concurrent.atomic.AtomicBoolean();
        var uncertainSource = ServerTestSupport.loseKeyedCommitAcknowledgement(dataSource, lost);
        try (var uncertain = new ApprovalService(new JdbcApprovalStore(uncertainSource, new ObjectMapper(), ProcessDefinition.legacy("bob")), USERS)) {
            assertThrows(IOException.class, () -> uncertain.submit("alice", "Leave", "Rest", 1, 1, "lost-ack"));
            assertTrue(lost.get(), "The real COMMIT must succeed before its acknowledgement is lost");
            assertEquals(1, count("arc_request"));
            assertEquals(1, count("arc_request_event"));
            assertEquals(1, count("arc_submission_key"));
        }
        try (var reopened = open()) {
            var committed = reopened.list("alice").get(0);
            var approved = reopened.decide("bob", committed.id(), "manager", "APPROVE", "after uncertain commit");
            reopened.publish("alice", 1, ProcessDefinition.legacy("carol"));
            assertEquals(approved, reopened.submit("alice", "Leave", "Rest", 1, 1, "lost-ack"));
            assertEquals(1, count("arc_request"));
            assertEquals(2, count("arc_request_event"));
            assertEquals(1, count("arc_submission_key"));
        }
    }

    @Test void submissionKeyForeignKeyAndBothUniquenessConstraintsAreEnforced() throws Exception {
        try (var service = open()) {
            var request = service.submit("alice", "Leave", "Rest", 1, 1, "key");
            assertThrows(java.sql.SQLException.class, () -> sql("INSERT INTO arc_submission_key VALUES ('alice', 'missing', 'missing')"));
            try (var connection = dataSource.getConnection(); var statement = connection.prepareStatement(
                    "INSERT INTO arc_submission_key (applicant_id, submission_key, request_id) VALUES (?, ?, ?)")) {
                statement.setString(1, "alice"); statement.setString(2, "other"); statement.setString(3, request.id());
                assertThrows(java.sql.SQLException.class, statement::executeUpdate);
            }
            assertThrows(java.sql.SQLException.class, () -> sql("INSERT INTO arc_submission_key SELECT * FROM arc_submission_key"));
            assertEquals(1, count("arc_submission_key"));
        }
    }

    @Test void submissionLookupUsesOneSnapshotAcrossConcurrentDecisionCommit() throws Exception {
        var gate = new GateDataSource(dataSource, "SELECT event_index, event_json FROM arc_request_event");
        var executor = Executors.newSingleThreadExecutor();
        try (var writer = open(); var reader = new JdbcApprovalStore(gate, new ObjectMapper(), ProcessDefinition.legacy("bob"))) {
            var original = writer.submit("alice", "Leave", "Rest", 1, 1, "snapshot");
            var reading = executor.submit(() -> reader.submission("alice", "snapshot"));
            assertTrue(gate.entered.await(5, TimeUnit.SECONDS));
            var approved = writer.decide("bob", original.id(), "manager", "APPROVE", "concurrent commit");
            gate.release.countDown();
            assertEquals(original, reading.get(10, TimeUnit.SECONDS));
            assertEquals(approved, reader.submission("alice", "snapshot"));
        } finally { gate.release.countDown(); executor.shutdownNow(); assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS)); }
    }

    @Test void keyedCreateReplayLocksCurrentRequestUntilAuditValidationCompletes() throws Exception {
        var gate = new GateDataSource(dataSource, "SELECT event_index, event_json FROM arc_request_event");
        var executor = Executors.newFixedThreadPool(2);
        try (var writer = open(); var replaying = new JdbcApprovalStore(gate, new ObjectMapper(), ProcessDefinition.legacy("bob"))) {
            var original = writer.submit("alice", "Leave", "Rest", 1, 1, "locked");
            var replay = executor.submit(() -> replaying.create(1, candidate("another-id", "Other intent"), "locked"));
            assertTrue(gate.entered.await(5, TimeUnit.SECONDS));
            var decision = executor.submit(() -> writer.decide("bob", original.id(), "manager", "APPROVE", "concurrent update"));
            assertThrows(TimeoutException.class, () -> decision.get(150, TimeUnit.MILLISECONDS));
            gate.release.countDown();
            assertEquals(original, replay.get(10, TimeUnit.SECONDS));
            assertEquals("APPROVED", decision.get(10, TimeUnit.SECONDS).status());
            assertEquals(1, count("arc_request"));
        } finally { gate.release.countDown(); executor.shutdownNow(); assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS)); }
    }

    @Test void keyedCreateReplaysBeforeVersionCheckButFreshKeyCannotUseStaleVersion() throws Exception {
        try (var store = new JdbcApprovalStore(dataSource, new ObjectMapper(), ProcessDefinition.legacy("bob"))) {
            var original = store.create(1, candidate("original", "Leave"), "old-version");
            var initial = ProcessDefinition.legacy("carol");
            assertTrue(store.publish("alice", 1, new ProcessDefinition(initial.schemaVersion(), initial.id(), 2, initial.name(), initial.nodes())));
            assertEquals(original, store.create(1, candidate("new-id", "Changed intent"), "old-version"));
            assertNull(store.create(1, candidate("fresh-id", "Leave"), "fresh-key"));
            assertEquals(1, count("arc_request"));
            assertEquals(1, count("arc_request_event"));
            assertEquals(1, count("arc_submission_key"));
        }
    }

    @Test void explicitRevisionTwoUpgradePreservesLegacyRequestsAndDoesNotBackfillKeys() throws Exception {
        ApprovalService.Request legacy;
        try (var service = open()) { legacy = service.submit("alice", "Leave", "Rest", 1, 1); }
        sql("DROP TABLE arc_submission_key");
        assertThrows(IOException.class, this::open, "Missing migration must fail before initialization writes");
        String dialect;
        try (var connection = dataSource.getConnection()) {
            dialect = switch (connection.getMetaData().getDatabaseProductName()) {
                case "MySQL" -> "mysql"; case "PostgreSQL" -> "postgresql"; case "H2" -> "h2";
                default -> throw new AssertionError("Unexpected test database");
            };
        }
        try (var input = JdbcApprovalStore.class.getResourceAsStream("upgrade-" + dialect + "-v1-to-v2.sql")) {
            assertNotNull(input);
            String ddl = new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8).replaceAll("(?m)^\\s*--.*$", "");
            for (String statement : ddl.split(";")) if (!statement.isBlank()) sql(statement);
        }
        try (var service = open()) {
            assertEquals(legacy, service.list("alice").get(0));
            assertEquals(0, count("arc_submission_key"));
            var keyed = service.submit("alice", "Leave", "Rest", 1, 1, "after-upgrade");
            assertNotEquals(legacy.id(), keyed.id());
            assertEquals(keyed, service.submit("alice", "Leave", "Rest", 1, 1, "after-upgrade"));
            assertEquals(2, count("arc_request"));
        }
    }

    protected static ProcessDefinition procurementDefinition(String approver) {
        var base = ProcessDefinition.legacy(approver);
        return new ProcessDefinition(base.schemaVersion(), "procurement-approval", 1, "Procurement approval", base.nodes());
    }

    private ApprovalService open(ProcessDefinition definition) throws IOException {
        return new ApprovalService(new JdbcApprovalStore(dataSource, new ObjectMapper(), definition), USERS);
    }

    protected static BusinessDocument.Procurement procurement() {
        return new BusinessDocument.Procurement("purchase:2026/001", "Team laptops", "Replacement equipment",
            "Laptop", 3, new BigDecimal("1299.95"), "USD");
    }

    @Test void procurementSnapshotDecisionAndKeyReplaySurvivePublicationAndAdapterReopen() throws Exception {
        ApprovalService.Request original;
        ApprovalService.Request approved;
        var definition = procurementDefinition("bob");
        var priceCases = new ArrayList<ApprovalService.Request>();
        var amounts = List.of("10", "100", "1000000000", "0.10");
        try (var service = open(definition)) {
            original = service.submitDocument("alice", procurement(), 1, "purchase-001");
            assertEquals(procurement(), original.business());
            assertEquals(0, original.days());
            assertEquals(definition.id(), original.processId());
            assertEquals(409, result(() -> service.submitDocument("alice",
                new BusinessDocument.Procurement("purchase:2026/001", "Team laptops", "Replacement equipment",
                    "Laptop", 4, new BigDecimal("1299.95"), "USD"), 1, "purchase-001")));
            service.publish("alice", 1, procurementDefinition("carol"));
            approved = service.decide("bob", original.id(), "manager", "APPROVE", "Budget checked");
            assertEquals(procurement(), approved.business());
            assertEquals(original.definition(), approved.definition());
            assertEquals("APPROVED", approved.status());
            for (int i = 0; i < amounts.size(); i++) {
                var priceDocument = new BusinessDocument.Procurement("purchase:price/" + i, "Price precision", "Canonical decimal test",
                    "Equipment", 1, new BigDecimal(amounts.get(i)), "USD");
                var submitted = service.submitDocument("alice", priceDocument, 2, "price-case-" + i);
                var savedBusiness = (BusinessDocument.Procurement) submitted.business();
                assertEquals(new BigDecimal(amounts.get(i)).stripTrailingZeros(), savedBusiness.unitPrice());
                priceCases.add(service.decide("carol", submitted.id(), "manager", "APPROVE", "Price checked"));
            }
        }
        try (var restarted = open(procurementDefinition("carol"))) {
            assertEquals(2, restarted.process().version());
            var restored = restarted.list("alice");
            assertEquals(1 + priceCases.size(), restored.size());
            assertTrue(restored.contains(approved));
            for (int i = 0; i < priceCases.size(); i++) {
                var expected = priceCases.get(i);
                assertTrue(restored.contains(expected), "Canonical decimal snapshot must survive persistence and reopen: " + amounts.get(i));
                assertEquals(expected, restarted.submitDocument("alice", expected.business(), 2, "price-case-" + i));
            }
            assertEquals(approved, restarted.submitDocument("alice", procurement(), 1, "purchase-001"));
            assertEquals(approved, restarted.decide("bob", original.id(), "manager", "APPROVE", "retry"));
            assertEquals(2 + 2 * priceCases.size(), count("arc_request_event"));
            assertEquals(1 + priceCases.size(), count("arc_submission_key"));
        }
    }

    @Test void configuredProcessesIsolateReadsWritesAndPublicationsInOneDatabase() throws Exception {
        var leaveDefinition = ProcessDefinition.legacy("bob");
        var procurementDefinition = procurementDefinition("bob");
        try (var leaves = new JdbcApprovalStore(dataSource, new ObjectMapper(), leaveDefinition);
             var purchases = new JdbcApprovalStore(dataSource, new ObjectMapper(), procurementDefinition);
             var leaveService = new ApprovalService(leaves, USERS);
             var purchaseService = new ApprovalService(purchases, USERS)) {
            var leave = leaveService.submit("alice", "Leave", "Rest", 2, 1);
            var purchase = purchaseService.submitDocument("alice", procurement(), 1, null);
            assertEquals(List.of(leave), leaves.requests());
            assertEquals(List.of(purchase), purchases.requests());
            assertNull(leaves.request(purchase.id()));
            assertNull(purchases.request(leave.id()));
            assertEquals(404, result(() -> leaveService.decide("bob", purchase.id(), "manager", "APPROVE", "wrong process")));
            assertEquals(404, result(() -> purchaseService.decide("bob", leave.id(), "manager", "APPROVE", "wrong process")));
            assertThrows(IllegalArgumentException.class, () -> leaves.create(1, purchase));
            assertThrows(IllegalArgumentException.class, () -> purchases.create(1, leave));
            var foreignPublication = new ProcessDefinition(2, procurementDefinition.id(), 2, "Purchases", procurementDefinition.nodes());
            assertThrows(IllegalArgumentException.class, () -> leaves.publish("alice", 1, foreignPublication));
            var approved = purchaseService.decide("bob", purchase.id(), "manager", "APPROVE", "Authorized");
            assertThrows(IllegalArgumentException.class, () -> leaves.update(0, approved));
            purchaseService.publish("alice", 1, procurementDefinition("carol"));
            assertEquals(1, leaves.process().version());
            assertEquals(2, purchases.process().version());
            assertEquals(List.of(leave), leaves.requests());
            assertEquals(2, count("arc_process_head"));
            assertEquals(3, count("arc_process_version"));
        }
    }

    @Test void submissionKeysRemainApplicantGlobalAndCannotReplayAnotherProcess() throws Exception {
        // Use identical business intent in both processes to isolate the process-ID check itself.
        try (var first = open(ProcessDefinition.legacy("bob")); var second = open(procurementDefinition("bob"));
             var otherStore = new JdbcApprovalStore(dataSource, new ObjectMapper(), procurementDefinition("bob"))) {
            var saved = first.submitDocument("alice", procurement(), 1, "global-key");
            assertEquals(saved, otherStore.submission("alice", "global-key"));
            assertNull(otherStore.request(saved.id()));
            assertEquals(409, result(() -> second.submitDocument("alice", procurement(), 1, "global-key")));
            assertEquals(saved, first.submitDocument("alice", procurement(), 1, "global-key"));
            assertEquals(1, count("arc_request"));
            assertEquals(1, count("arc_request_event"));
            assertEquals(1, count("arc_submission_key"));
        }
    }

    @Test void differentProcessHeadLocksStillProduceOneGlobalKeyWinnerAndAConflict() throws Exception {
        var firstGate = new GateDataSource(dataSource, "INSERT INTO arc_submission_key");
        var secondGate = new GateDataSource(dataSource, "INSERT INTO arc_submission_key");
        var executor = Executors.newFixedThreadPool(2);
        try (var first = new ApprovalService(new JdbcApprovalStore(firstGate, new ObjectMapper(), ProcessDefinition.legacy("bob")), USERS);
             var second = new ApprovalService(new JdbcApprovalStore(secondGate, new ObjectMapper(), procurementDefinition("bob")), USERS)) {
            var firstSubmit = executor.submit(() -> result(() -> first.submitDocument("alice", procurement(), 1, "racing-global-key")));
            var secondSubmit = executor.submit(() -> result(() -> second.submitDocument("alice", procurement(), 1, "racing-global-key")));
            assertTrue(firstGate.entered.await(5, TimeUnit.SECONDS));
            assertTrue(secondGate.entered.await(5, TimeUnit.SECONDS));
            // Both transactions have passed the empty key lookup and hold different process heads.
            firstGate.release.countDown();
            secondGate.release.countDown();
            var statuses = List.of(firstSubmit.get(15, TimeUnit.SECONDS), secondSubmit.get(15, TimeUnit.SECONDS));
            assertEquals(List.of(200, 409), statuses.stream().sorted().toList());
            assertEquals(1, count("arc_request"));
            assertEquals(1, count("arc_request_event"));
            assertEquals(1, count("arc_submission_key"));
            assertEquals(1, first.list("alice").size() + second.list("alice").size());
        } finally {
            firstGate.release.countDown(); secondGate.release.countDown();
            executor.shutdownNow(); assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS));
        }
    }

    @Test void businessSnapshotCannotChangeWhileAppendingAnOtherwiseValidDecision() throws Exception {
        try (var store = new JdbcApprovalStore(dataSource, new ObjectMapper(), procurementDefinition("bob"));
             var service = new ApprovalService(store, USERS)) {
            var original = service.submitDocument("alice", procurement(), 1, "immutable");
            String now = java.time.Instant.now().toString();
            var history = new ArrayList<>(original.history());
            history.add(new ApprovalService.Event("bob", "APPROVE", "Approved", now, "manager"));
            var changedDocument = new BusinessDocument.Procurement(procurement().businessId(), procurement().title(), procurement().reason(),
                procurement().item(), 4, procurement().unitPrice(), procurement().currency());
            var rewritten = new ApprovalService.Request(original.id(), original.title(), original.reason(), original.days(), "alice", "bob",
                "APPROVED", original.createdAt(), now, "APPROVE", "Approved", original.processId(), original.processVersion(),
                history, original.definition(), null, changedDocument);
            ApprovalService.validateRequest(rewritten);
            assertThrows(IllegalArgumentException.class, () -> store.update(0, rewritten));
            assertEquals(original, store.request(original.id()));
            assertEquals(1, count("arc_request_event"));
            assertEquals(procurement(), service.decide("bob", original.id(), "manager", "APPROVE", "Approved").business());
        }
    }

    @Test void strictRequestDecoderRetainsLegacyShapeAndRejectsUnknownBusinessFields() throws Exception {
        ApprovalService.Request legacy;
        ApprovalService.Request purchase;
        try (var service = open()) {
            legacy = service.submit("alice", "Leave", "Rest", 2, 1);
            purchase = service.submitDocument("alice", procurement(), 1, null);
        }
        var mapper = new ObjectMapper();
        var legacyJson = mapper.valueToTree(legacy);
        assertFalse(legacyJson.has("business"));
        try (var reopened = open()) {
            assertTrue(reopened.list("alice").contains(legacy));
            assertNull(reopened.decide("bob", legacy.id(), "manager", "APPROVE", "Legacy reply").business());
        }
        var corrupted = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.valueToTree(purchase);
        ((com.fasterxml.jackson.databind.node.ObjectNode) corrupted.get("business")).put("unrecognized", true);
        try (var connection = dataSource.getConnection(); var statement = connection.prepareStatement(
                "UPDATE arc_request SET request_json = ? WHERE request_id = ?")) {
            statement.setString(1, mapper.writeValueAsString(corrupted));
            statement.setString(2, purchase.id());
            assertEquals(1, statement.executeUpdate());
        }
        try (var store = new JdbcApprovalStore(dataSource, mapper, ProcessDefinition.legacy("bob"))) {
            assertThrows(IOException.class, () -> store.request(purchase.id()));
        }
    }

    @Test void duplicateRequestIdentityNeverBecomesSuccessfulKeyedReplay() throws Exception {
        try (var store = new JdbcApprovalStore(dataSource, new ObjectMapper(), ProcessDefinition.legacy("bob"))) {
            var original = candidate("duplicate-request", "Leave");
            assertTrue(store.create(1, original));
            assertThrows(IOException.class, () -> store.create(1, original, "fresh-key"));
            assertNull(store.submission("alice", "fresh-key"));
            assertEquals(1, count("arc_request"));
            assertEquals(1, count("arc_request_event"));
            assertEquals(0, count("arc_submission_key"));
        }
    }

    @Test void cleanKeyDuplicateWithoutDurableWinnerRemainsFailureAndRollsBack() throws Exception {
        String state;
        int code;
        try (var connection = dataSource.getConnection()) {
            boolean mysql = "MySQL".equals(connection.getMetaData().getDatabaseProductName());
            state = mysql ? "23000" : "23505";
            code = mysql ? 1062 : 0;
        }
        var inserted = new java.util.concurrent.atomic.AtomicBoolean();
        // Inject a known duplicate after a real insert, then let the adapter roll back all writes.
        // A duplicate signal alone must never manufacture a successful replay without a durable key.
        var failing = ServerTestSupport.failAfterStatement(dataSource, "INSERT INTO arc_submission_key", inserted,
            () -> new java.sql.SQLException("Injected duplicate without a committed winner", state, code));
        try (var service = new ApprovalService(new JdbcApprovalStore(failing, new ObjectMapper(), procurementDefinition("bob")), USERS)) {
            assertThrows(IOException.class, () -> service.submitDocument("alice", procurement(), 1, "no-winner"));
            assertTrue(inserted.get());
            assertEmptySubmissionTables();
        }
        try (var service = open(procurementDefinition("bob"))) {
            assertEquals(procurement(), service.submitDocument("alice", procurement(), 1, "no-winner").business());
        }
    }

    private void assertEmptySubmissionTables() throws Exception {
        assertEquals(0, count("arc_request"));
        assertEquals(0, count("arc_request_event"));
        assertEquals(0, count("arc_submission_key"));
    }

    private static ApprovalService.Request candidate(String id, String title) {
        var definition = ProcessDefinition.legacy("bob");
        String now = "2026-10-05T12:00:00Z";
        return new ApprovalService.Request(id, title, "Rest", 1, "alice", "bob", "PENDING", now, now,
            null, null, definition.id(), definition.version(),
            List.of(new ApprovalService.Event("alice", "SUBMIT", "", now, null)), definition, "manager");
    }

}
