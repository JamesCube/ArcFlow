package com.arcflow.approval.jdbc;

import com.arcflow.approval.BusinessDocument;
import com.arcflow.approval.graph.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Same transactional contract executed against H2 and actual PostgreSQL/MySQL servers. */
abstract class GraphStoreContract {
    protected DataSource dataSource;
    final ObjectMapper mapper = new ObjectMapper();
    protected JdbcGraphApprovalStore open() throws IOException { return open(dataSource); }
    JdbcGraphApprovalStore open(DataSource source) throws IOException { return new JdbcGraphApprovalStore(source, mapper, definition()); }
    protected void install(String dialect) throws Exception {
        try (var input = JdbcGraphApprovalStore.class.getResourceAsStream("graph-schema-" + dialect + ".sql")) {
            assertNotNull(input); String ddl = new String(input.readAllBytes(), StandardCharsets.UTF_8).replaceAll("(?m)^\\s*--.*$", "");
            for (String statement : ddl.split(";")) if (!statement.isBlank()) sql(statement);
        }
    }
    void sql(String text) throws Exception { try (var c = dataSource.getConnection(); var s = c.createStatement()) { s.execute(text); } }
    long count(String table) throws Exception { try (var c = dataSource.getConnection(); var s = c.createStatement(); var rows = s.executeQuery("SELECT COUNT(*) FROM " + table)) { rows.next(); return rows.getLong(1); } }
    boolean flag(String table, String actor, String flag) throws Exception {
        try (var c = dataSource.getConnection(); var s = c.prepareStatement("SELECT " + flag + " FROM " + table + " WHERE request_id = ? AND actor_id = ?")) {
            s.setString(1, "request-1"); s.setString(2, actor); try (var rows = s.executeQuery()) { assertTrue(rows.next()); boolean result = rows.getBoolean(1); assertFalse(rows.next()); return result; }
        }
    }
    static final String AT = "2026-10-11T07:00:00Z";
    static GraphDefinition definition() {
        return new GraphDefinition(5, "graph-payment", 1, "Parallel payment", List.of(
            node("start", "start", List.of(), null), node("fork", "parallelFork", List.of(), "join"),
            node("left", "approval", List.of("bob"), null), node("right", "approval", List.of("bob"), null),
            node("join", "parallelJoin", List.of(), "fork"), node("final", "approval", List.of("carol"), null), node("end", "end", List.of(), null)),
            List.of(edge("s", "start", "fork"), edge("l", "fork", "left"), edge("r", "fork", "right"),
                edge("lj", "left", "join"), edge("rj", "right", "join"), edge("jf", "join", "final"), edge("fe", "final", "end")));
    }
    static GraphDefinition.Node node(String id, String type, List<String> actors, String pair) {
        return new GraphDefinition.Node(id, type, id, actors, actors.isEmpty() ? null : "ALL", pair);
    }
    static GraphDefinition.Edge edge(String id, String source, String target) { return new GraphDefinition.Edge(id, source, target, id, null, false); }
    static BusinessDocument.PaymentRequest payment() {
        return new BusinessDocument.PaymentRequest(1,"PAY-GRAPH-TEST","Payment review","Synthetic fixture","SUPPLIER-TEST","CNY","2099-01-15",List.of(
            new BusinessDocument.PaymentLine("line-1","INV-TEST-01","Components",new BigDecimal("10000.00"),BigDecimal.ZERO,new BigDecimal("9000.00"),BigDecimal.ZERO,"")));
    }
    static GraphInstance initial() { return GraphEngine.start("request-1", "submit-1", "alice", definition(), payment(), AT); }
    static GraphInstance vote(GraphInstance before, String node, String actor, String decision, String command) {
        return GraphEngine.decide(before, before.id() + ":" + node, actor, decision, "", command, AT);
    }
    @Test void quoteCanonicalIdentityRejectsBeforeAnyJdbcMutationAndSurvivesRestart() throws Exception {
        var definition=GraphSamples.quote();var business=new BusinessDocument.QuoteDiscount("Q-JDBC","Quote","Synthetic quote","CUSTOMER",1,"Item",10,new BigDecimal("1000"),new BigDecimal("800"),"CNY","2099-12-31");
        var invalid=GraphEngine.start("quote-request","arbitrary","alice",definition,business,AT);
        GraphInstance waiting;
        try(var store=new JdbcGraphApprovalStore(dataSource,mapper,definition)) {
            var before=store.snapshot();
            assertThrows(IllegalArgumentException.class,()->store.create(1,invalid));assertEquals(before,store.snapshot());
            for(String table:List.of("arc_graph_request","arc_graph_task","arc_graph_task_member","arc_graph_request_member","arc_graph_event","arc_graph_command"))assertEquals(0,count(table),table);
            var initial=GraphEngine.start("quote-request",GraphQuotePolicy.revisionKey(business.businessId(),business.quoteRevision()),"alice",definition,business,AT);
            assertTrue(store.create(1,initial));waiting=vote(initial,"commercial","bob","APPROVE","commercial");assertTrue(store.replace(initial.id(),0,waiting));assertFalse(waiting.forks().get(0).fired());
        }
        try(var store=new JdbcGraphApprovalStore(dataSource,mapper,definition)) {
            assertEquals(waiting,store.snapshot().requests().get(0));var joined=vote(waiting,"finance","carol","APPROVE","finance");assertTrue(store.replace(waiting.id(),1,joined));assertTrue(joined.forks().get(0).fired());assertEquals("final",joined.tasks().get(joined.tasks().size()-1).nodeId());
        }
    }
    static BusinessDocument businessGraphDocument(String family,boolean high,String id) {
        return switch(family) {
            case "travel" -> new BusinessDocument.Travel(1,id,"Travel","Synthetic review","Shanghai","2026-11-01","2026-11-03","CUSTOMER_VISIT",new BigDecimal(high?"10000":"100"),"CNY","SALES");
            case "receiving" -> new BusinessDocument.Receiving(1,id,"Receipt","Synthetic review","PO-1","EAST","2026-10-13",List.of(new BusinessDocument.ReceivingLine("L1","POL1","Item","PCS",10,10,high?8:10,high?2:0,high?"Damaged":"")));
            default -> new BusinessDocument.QuoteDiscount(id,"Quote","Synthetic review","CUSTOMER",1,"Item",10,new BigDecimal("1000"),new BigDecimal(high?"800":"900"),"CNY","2099-12-31");
        };
    }
    static String graphBusinessKey(BusinessDocument document,String fallback) {
        return document instanceof BusinessDocument.QuoteDiscount q?GraphQuotePolicy.revisionKey(q.businessId(),q.quoteRevision()):fallback;
    }
    @Test void businessGraphFamiliesPersistPartialJoinsAndIsolateTypedSnapshots() throws Exception {
        for(var definition:List.of(GraphSamples.travel(),GraphSamples.receiving(),GraphSamples.quote())) {
            String family=GraphScenarios.forDefinition(definition).key();var high=businessGraphDocument(family,true,"HIGH-"+family);var low=businessGraphDocument(family,false,"LOW-"+family);GraphInstance waiting;
            try(var store=new JdbcGraphApprovalStore(dataSource,mapper,definition)) {
                var instance=GraphEngine.start(family+"-high",graphBusinessKey(high,"high-"+family),"alice",definition,high,AT);assertTrue(store.create(1,instance));
                if(family.equals("travel")){var approved=vote(instance,"manager","bob","APPROVE","manager");assertTrue(store.replace(instance.id(),instance.commandRevision(),approved));instance=approved;}
                var tasks=instance.tasks().stream().filter(t->t.status().equals("ACTIVE")).toList();assertEquals(2,tasks.size());var task=tasks.get(0);
                waiting=vote(instance,task.nodeId(),task.participants().get(0),"APPROVE","first");assertTrue(store.replace(instance.id(),instance.commandRevision(),waiting));assertFalse(waiting.forks().get(0).fired());assertEquals(1,waiting.forks().get(0).arrivedBranchIds().size());
                var ordinary=GraphEngine.start(family+"-low",graphBusinessKey(low,"low-"+family),"alice",definition,low,AT);assertTrue(store.create(1,ordinary));assertEquals("otherwise",ordinary.routes().get(0).selectedEdgeId());assertTrue(ordinary.forks().isEmpty());
                assertThrows(IllegalArgumentException.class,()->GraphEngine.start("wrong", "wrong", "alice",definition,payment(),AT));
            }
            try(var store=new JdbcGraphApprovalStore(dataSource,mapper,definition)) {
                var snapshot=store.snapshot();assertEquals(2,snapshot.requests().size());assertTrue(snapshot.requests().stream().allMatch(r->r.business().getClass()==high.getClass()));
                assertEquals(waiting,snapshot.requests().stream().filter(r->r.id().equals(family+"-high")).findFirst().orElseThrow());
                var task=waiting.tasks().stream().filter(t->t.status().equals("ACTIVE")).findFirst().orElseThrow();var joined=vote(waiting,task.nodeId(),task.participants().get(0),"APPROVE","second");assertTrue(store.replace(waiting.id(),waiting.commandRevision(),joined));assertTrue(joined.forks().get(0).fired());
                if(family.equals("quote")){var complete=vote(joined,"final","carol","APPROVE","final");assertTrue(store.replace(joined.id(),joined.commandRevision(),complete));joined=complete;}assertEquals("APPROVED",joined.status());
                var rejectionDocument=businessGraphDocument(family,true,"REJECT-"+family);var reject=GraphEngine.start(family+"-reject",graphBusinessKey(rejectionDocument,"reject-"+family),"alice",definition,rejectionDocument,AT);assertTrue(store.create(1,reject));
                if(family.equals("travel")){var approved=vote(reject,"manager","bob","APPROVE","manager");assertTrue(store.replace(reject.id(),0,approved));reject=approved;}
                var first=reject.tasks().stream().filter(t->t.status().equals("ACTIVE")).findFirst().orElseThrow();var terminal=vote(reject,first.nodeId(),first.participants().get(0),"REJECT","reject");assertTrue(store.replace(reject.id(),reject.commandRevision(),terminal));assertEquals("REJECTED",terminal.status());assertTrue(terminal.tasks().stream().noneMatch(t->t.status().equals("ACTIVE")));
            }
        }
    }
    @Test void schemaFiveCollidingBusinessIdsRemainPaymentAndRejectSchemaSixReopen() throws Exception {
        for(var newDefinition:List.of(GraphSamples.travel(),GraphSamples.receiving(),GraphSamples.quote())) {
            var legacy=new GraphDefinition(5,newDefinition.id(),1,"Legacy payment custom ID",definition().nodes(),definition().edges());GraphInstance waiting;
            try(var store=new JdbcGraphApprovalStore(dataSource,mapper,legacy)) {
                var initial=GraphEngine.start("legacy-"+legacy.id(),"legacy-key-"+legacy.id(),"alice",legacy,payment(),AT);assertTrue(store.create(1,initial));waiting=vote(initial,"left","bob","APPROVE","left");assertTrue(store.replace(initial.id(),0,waiting));
                assertThrows(IllegalArgumentException.class,()->store.saveDraft(0,new GraphApprovalStore.Draft(1,1,newDefinition)));assertEquals(0,store.snapshot().draft().revision());
            }
            long rows=count("arc_graph_request"),events=count("arc_graph_event");
            assertThrows(IOException.class,()->new JdbcGraphApprovalStore(dataSource,mapper,newDefinition));assertEquals(rows,count("arc_graph_request"));assertEquals(events,count("arc_graph_event"));
            try(var reopened=new JdbcGraphApprovalStore(dataSource,mapper,legacy)){assertEquals(waiting,reopened.snapshot().requests().get(0));GraphEngine.validateInstance(waiting);}
        }
    }
    @Test void freshSchemaIsExplicitUnknownSchemaRejectedAndLegacyTablesUntouched() throws Exception {
        sql("CREATE TABLE arc_request (legacy_marker INTEGER PRIMARY KEY)"); sql("INSERT INTO arc_request VALUES (73)");
        try (var store = open()) { assertTrue(store.create(1, initial())); assertEquals(1, count("arc_request")); }
        sql("UPDATE arc_graph_schema SET schema_version = 2");
        assertThrows(IOException.class, this::open);
        assertEquals(1, count("arc_graph_request")); assertEquals(1, count("arc_request"));
    }
    @Test void initializationAndRestartPreserveEveryDurableProjection() throws Exception {
        GraphInstance next;
        try (var store = open()) {
            assertEquals(14, store.snapshot().storageSchemaVersion()); assertTrue(store.create(1, initial()));
            next = vote(initial(), "left", "bob", "APPROVE", "left-1"); assertTrue(store.replace(next.id(), 0, next));
            assertEquals(next.events().size(), count("arc_graph_event")); assertEquals(1, count("arc_graph_command"));
            assertEquals(2, count("arc_graph_task")); assertEquals(2, count("arc_graph_task_member"));
        }
        try (var reopened = open()) { assertEquals(next, reopened.snapshot().requests().get(0)); }
    }
    @Test void sameActorHasTwoTaskRowsAndRequestFlagsAreLogicalOr() throws Exception {
        try (var store = open()) {
            store.create(1, initial()); assertEquals(2, count("arc_graph_task_member"));
            assertTrue(flag("arc_graph_request_member", "bob", "pending")); assertFalse(flag("arc_graph_request_member", "bob", "handled"));
            var one = vote(initial(), "left", "bob", "APPROVE", "left"); store.replace(one.id(), 0, one);
            assertTrue(flag("arc_graph_request_member", "bob", "pending")); assertTrue(flag("arc_graph_request_member", "bob", "handled"));
            var two = vote(one, "right", "bob", "APPROVE", "right"); store.replace(two.id(), 1, two);
            assertFalse(flag("arc_graph_request_member", "bob", "pending")); assertTrue(flag("arc_graph_request_member", "bob", "handled"));
            assertTrue(flag("arc_graph_request_member", "carol", "pending")); assertEquals(3, count("arc_graph_task_member"));
        }
    }
    @Test void terminalRejectionCancelsTasksAndPendingMembersInSameCommit() throws Exception {
        try (var store = open()) {
            store.create(1, initial()); var next = vote(initial(), "left", "bob", "REJECT", "reject"); store.replace(next.id(), 0, next);
            assertEquals("REJECTED", store.snapshot().requests().get(0).status());
            assertFalse(flag("arc_graph_request_member", "bob", "pending")); assertFalse(flag("arc_graph_request_member", "carol", "pending"));
            assertEquals(0, pendingTasks());
        }
        try (var reopened = open()) { assertEquals("REJECTED", reopened.snapshot().requests().get(0).status()); }
    }
    long pendingTasks() throws Exception {
        try (var c = dataSource.getConnection(); var s = c.createStatement(); var rows = s.executeQuery("SELECT COUNT(*) FROM arc_graph_task_member WHERE pending = TRUE")) { rows.next(); return rows.getLong(1); }
    }
    @Test void draftAndPublishUseSeparateCasAndOldInstancesKeepOriginalDefinition() throws Exception {
        try (var a = open(); var b = open()) {
            a.create(1, initial());
            var incomplete = new GraphDefinition(5, definition().id(), 1, "Saved partial", List.of(), List.of());
            assertTrue(a.saveDraft(0, new GraphApprovalStore.Draft(1, 1, incomplete)));
            assertEquals(incomplete, b.snapshot().draft().definition());
            assertFalse(b.saveDraft(0, new GraphApprovalStore.Draft(1, 1, definition())));
            assertThrows(IllegalArgumentException.class, () -> a.publish(1, 1, incomplete.withVersion(2)));
            assertTrue(a.saveDraft(1, new GraphApprovalStore.Draft(2, 1, definition())));
            assertFalse(b.publish(1, 1, definition().withVersion(2)));
            assertTrue(a.publish(1, 2, definition().withVersion(2)));
            assertFalse(b.create(1, initial()));
            assertEquals(2, count("arc_graph_version")); assertEquals(1, b.snapshot().requests().get(0).definition().version());
            assertEquals(3, b.snapshot().draft().revision());
        }
    }
    @Test void duplicateSubmissionAndOppositeStaleDecisionAreSafeConflicts() throws Exception {
        try (var a = open(); var b = open()) {
            assertTrue(a.create(1, initial())); assertFalse(b.create(1, initial()));
            assertFalse(b.create(1, GraphEngine.start("request-2", "submit-1", "alice", definition(), payment(), AT)));
            assertTrue(b.create(1, GraphEngine.start("request-3", "submit-1", "dave", definition(), payment(), AT)));
            var yes = vote(initial(), "left", "bob", "APPROVE", "decide"); var no = vote(initial(), "left", "bob", "REJECT", "reject");
            assertTrue(a.replace(yes.id(), 0, yes)); assertFalse(b.replace(no.id(), 0, no)); assertFalse(b.replace(yes.id(), 0, yes));
            assertEquals(1, count("arc_graph_command")); assertEquals(2, count("arc_graph_request"));
        }
    }
    @Test void concurrentBranchCompletionsUseRequestWideCasAndJoinFiresOnlyOnce() throws Exception {
        try (var a = open(); var b = open()) {
            a.create(1, initial()); var gate = new CountDownLatch(1); var pool = Executors.newFixedThreadPool(2);
            try {
                var left = pool.submit(() -> { gate.await(); retry(a, "left", "APPROVE"); return null; });
                var right = pool.submit(() -> { gate.await(); retry(b, "right", "APPROVE"); return null; });
                gate.countDown(); left.get(15, TimeUnit.SECONDS); right.get(15, TimeUnit.SECONDS);
            } finally { pool.shutdownNow(); }
            var result = a.snapshot().requests().get(0);
            assertEquals(2, result.commandRevision()); assertEquals(1, result.events().stream().filter(e -> e.type().equals("JOIN_FIRED")).count());
            assertEquals(1, result.tasks().stream().filter(t -> t.nodeId().equals("final")).count()); assertEquals(2, count("arc_graph_command"));
        }
    }
    static void retry(GraphApprovalStore store, String branch, String decision) throws IOException {
        while (true) { var before = store.snapshot().requests().get(0); if (!before.status().equals("PENDING")) return;
            var next = vote(before, branch, "bob", decision, "cmd-" + branch); if (store.replace(before.id(), before.commandRevision(), next)) return; }
    }
    @Test void parallelApprovalVersusRejectionRaceNeverLeavesActiveWork() throws Exception {
        try (var a = open(); var b = open()) {
            a.create(1, initial()); var gate = new CountDownLatch(1); var pool = Executors.newFixedThreadPool(2);
            try {
                var left = pool.submit(() -> { gate.await(); retry(a, "left", "APPROVE"); return null; });
                var right = pool.submit(() -> { gate.await(); retry(b, "right", "REJECT"); return null; });
                gate.countDown(); left.get(15, TimeUnit.SECONDS); right.get(15, TimeUnit.SECONDS);
            } finally { pool.shutdownNow(); }
            var result = a.snapshot().requests().get(0); assertEquals("REJECTED", result.status());
            assertTrue(result.tasks().stream().noneMatch(t -> t.status().equals("ACTIVE"))); assertEquals(0, pendingTasks());
        }
    }
    @Test void creationAuditTaskAndMemberFailuresRollbackEveryTable() throws Exception {
        for (String prefix : List.of("INSERT INTO arc_graph_event", "INSERT INTO arc_graph_task ", "INSERT INTO arc_graph_task_member", "INSERT INTO arc_graph_request_member")) {
            var failed = new AtomicBoolean();
            try (var store = open(ServerTestSupport.failAfterStatement(dataSource, prefix, failed))) { assertThrows(IOException.class, () -> store.create(1, initial())); }
            assertTrue(failed.get(), prefix);
            for (String table : List.of("arc_graph_request", "arc_graph_event", "arc_graph_command", "arc_graph_task", "arc_graph_task_member", "arc_graph_request_member")) assertEquals(0, count(table), prefix + ":" + table);
            try (var store = open()) { assertTrue(store.snapshot().requests().isEmpty()); }
        }
    }
    @Test void decisionAuditCommandTaskAndMemberFailuresRollbackStateAndEarlierWrites() throws Exception {
        try (var store = open()) { store.create(1, initial()); }
        var next = vote(initial(), "left", "bob", "APPROVE", "left");
        for (String prefix : List.of("INSERT INTO arc_graph_event", "INSERT INTO arc_graph_command", "INSERT INTO arc_graph_task ", "INSERT INTO arc_graph_task_member", "INSERT INTO arc_graph_request_member")) {
            var failed = new AtomicBoolean();
            try (var store = open(ServerTestSupport.failAfterStatement(dataSource, prefix, failed))) { assertThrows(IOException.class, () -> store.replace(next.id(), 0, next)); }
            assertTrue(failed.get(), prefix);
            try (var store = open()) { assertEquals(initial(), store.snapshot().requests().get(0)); }
            assertEquals(initial().events().size(), count("arc_graph_event")); assertEquals(0, count("arc_graph_command")); assertEquals(2, pendingTasks());
        }
    }
    @Test void lostCreateAndDecisionCommitAcknowledgementsReconcileFromDurableState() throws Exception {
        var lostCreate = new AtomicBoolean();
        try (var store = open(loseAcknowledgement(dataSource, "INSERT INTO arc_graph_request (", lostCreate))) {
            assertThrows(IOException.class, () -> store.create(1, initial()));
        }
        assertTrue(lostCreate.get());
        try (var store = open()) { assertEquals(initial(), store.snapshot().requests().get(0)); assertFalse(store.create(1, initial())); }
        var next = vote(initial(), "left", "bob", "APPROVE", "left"); var lostDecision = new AtomicBoolean();
        try (var store = open(loseAcknowledgement(dataSource, "UPDATE arc_graph_request SET", lostDecision))) {
            assertThrows(IOException.class, () -> store.replace(next.id(), 0, next));
        }
        assertTrue(lostDecision.get());
        try (var store = open()) { assertEquals(next, store.snapshot().requests().get(0)); assertFalse(store.replace(next.id(), 0, next)); }
        assertEquals(1, count("arc_graph_command"));
    }
    @Test void missingAuditFailsOnReadAndRestart() throws Exception {
        try (var store = open()) { store.create(1, initial()); sql("DELETE FROM arc_graph_event WHERE event_sequence = 1"); assertThrows(IOException.class, store::snapshot); }
        assertThrows(IOException.class, this::open);
    }
    @Test void changedTaskProjectionFailsOnReadAndRestart() throws Exception {
        try (var store = open()) { store.create(1, initial()); sql("UPDATE arc_graph_task SET task_status = 'COMPLETED'"); assertThrows(IOException.class, store::snapshot); }
        assertThrows(IOException.class, this::open);
    }
    @Test void incorrectAggregatedPendingMembershipFailsClosed() throws Exception {
        try (var store = open()) { store.create(1, initial()); sql("UPDATE arc_graph_request_member SET pending = FALSE WHERE actor_id = 'bob'"); assertThrows(IOException.class, store::snapshot); }
        assertThrows(IOException.class, this::open);
    }
    @Test void missingTaskMemberFailsClosed() throws Exception {
        try (var store = open()) { store.create(1, initial()); sql("DELETE FROM arc_graph_task_member WHERE task_id = 'request-1:left'"); assertThrows(IOException.class, store::snapshot); }
        assertThrows(IOException.class, this::open);
    }
    @Test void corruptCommandProjectionFailsClosed() throws Exception {
        try (var store = open()) {
            store.create(1, initial()); var next = vote(initial(), "left", "bob", "APPROVE", "left"); store.replace(next.id(), 0, next);
            sql("UPDATE arc_graph_command SET command_json = '{}' "); assertThrows(IOException.class, store::snapshot);
        }
        assertThrows(IOException.class, this::open);
    }
    @Test void unknownPersistedJsonFieldsAndMissingNullablePropertiesFailClosed() throws Exception {
        try (var store = open()) {
            store.create(1, initial());
            var json = mapper.valueToTree(initial()); ((com.fasterxml.jackson.databind.node.ObjectNode)json).put("extra", true);
            try (var c = dataSource.getConnection(); var s = c.prepareStatement("UPDATE arc_graph_request SET request_json = ?")) { s.setString(1, json.toString()); s.executeUpdate(); }
            assertThrows(IOException.class, store::snapshot);
        }
        assertThrows(IOException.class, this::open);
    }
    @Test void invalidTransitionIsRejectedBeforeAnyMutation() throws Exception {
        try (var store = open()) {
            store.create(1, initial()); var next = vote(initial(), "left", "bob", "APPROVE", "left");
            var two = vote(next, "right", "bob", "APPROVE", "right");
            assertThrows(IllegalArgumentException.class, () -> store.replace(two.id(), 0, two));
            assertEquals(initial(), store.snapshot().requests().get(0)); assertEquals(0, count("arc_graph_command"));
        }
    }
    @Test void serviceDuplicateOppositeAndChangedPayloadRemainSafeAfterRestart() throws Exception {
        GraphInstance first, decided;
        try (var service = new GraphApprovalService(open(), directory())) {
            first = service.submit("alice", 1, payment(), "service-submit");
            assertEquals(first, service.submit("alice", 1, payment(), "service-submit"));
            decided = service.decide("bob", first.id(), first.id() + ":left", "APPROVE", "Accepted", "service-command");
            assertEquals(decided, service.decide("bob", first.id(), first.id() + ":left", "APPROVE", "Accepted", "service-command"));
        }
        try (var service = new GraphApprovalService(open(), directory())) {
            assertEquals(decided, service.decide("bob", first.id(), first.id() + ":left", "APPROVE", "Accepted", "service-command"));
            var changed = assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> service.decide("bob", first.id(), first.id() + ":left", "APPROVE", "Changed", "service-command"));
            assertEquals(409, changed.getStatusCode().value());
            var opposite = assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> service.decide("bob", first.id(), first.id() + ":left", "REJECT", "No", "other-command"));
            assertEquals(409, opposite.getStatusCode().value());
            var conflict = assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> service.decide("bob", first.id(), first.id() + ":right", "APPROVE", "Accepted", "service-command"));
            assertEquals(409, conflict.getStatusCode().value());
        }
        assertEquals(1, count("arc_graph_request")); assertEquals(1, count("arc_graph_command"));
    }
    @Test void successfulFreshKeyVoteRetryBindsAliasAcrossRestartWithoutDoubleVoting() throws Exception {
        GraphInstance first, voted, alias;
        try (var service = new GraphApprovalService(open(), directory())) {
            first = service.submit("alice", 1, payment(), "alias-submit");
            voted = service.decide("bob", first.id(), first.id() + ":left", "APPROVE", "Accepted", "original-key");
            alias = service.decide("bob", first.id(), first.id() + ":left", "APPROVE", "Accepted", "alias-key");
            assertEquals(voted.tasks(), alias.tasks()); assertEquals(voted.forks(), alias.forks());
            assertEquals(voted.commandRevision() + 1, alias.commandRevision());
            assertEquals(1, alias.tasks().get(0).votes().size()); assertEquals(2, alias.commands().size());
        }
        try (var service = new GraphApprovalService(open(), directory())) {
            assertEquals(alias, service.decide("bob", first.id(), first.id() + ":left", "APPROVE", "Accepted", "alias-key"));
            var conflict = assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> service.decide("bob", first.id(), first.id() + ":right", "APPROVE", "Accepted", "alias-key"));
            assertEquals(409, conflict.getStatusCode().value());
        }
        assertEquals(2, count("arc_graph_command"));
    }
    static com.arcflow.approval.ActorDirectory directory() {
        var people = List.of("alice", "bob", "carol", "dave").stream().map(id -> new com.arcflow.approval.ApprovalService.Person(id, id)).toList();
        return new com.arcflow.approval.ActorDirectory() {
            public java.util.Optional<com.arcflow.approval.ApprovalService.Person> findActive(String id) { return people.stream().filter(p -> p.id().equals(id)).findFirst(); }
            public List<com.arcflow.approval.ApprovalService.Person> listActive() { return people; }
            public boolean canPublish(String id) { return "alice".equals(id); }
        };
    }
    @Test void anyGroupPartialRejectionSurvivesRestartAndReleasesJoinOnlyAfterApproval() throws Exception {
        var base = definition(); var nodes = base.nodes().stream().map(n -> n.id().equals("left")
            ? new GraphDefinition.Node(n.id(), "parallelApproval", n.name(), List.of("bob", "carol"), "ANY", null) : n).toList();
        var group = new GraphDefinition(5, base.id(), 1, base.name(), nodes, base.edges());
        GraphInstance first = GraphEngine.start("request-1", "submit-1", "alice", group, payment(), AT), partial;
        try (var store = new JdbcGraphApprovalStore(dataSource, mapper, group)) {
            store.create(1, first); var no = vote(first, "left", "carol", "REJECT", "carol-no"); store.replace(no.id(), 0, no);
            partial = vote(no, "right", "bob", "APPROVE", "right-yes"); store.replace(partial.id(), 1, partial);
            assertEquals("ACTIVE", partial.tasks().get(0).status()); assertFalse(partial.forks().get(0).fired());
        }
        try (var store = new JdbcGraphApprovalStore(dataSource, mapper, group)) {
            assertEquals(partial, store.snapshot().requests().get(0));
            var yes = vote(partial, "left", "bob", "APPROVE", "bob-yes"); store.replace(yes.id(), 2, yes);
            assertTrue(yes.forks().get(0).fired()); assertEquals(1, yes.events().stream().filter(e -> e.type().equals("JOIN_FIRED")).count());
            assertFalse(flag("arc_graph_request_member", "bob", "pending")); assertTrue(flag("arc_graph_request_member", "carol", "pending"));
            var done = vote(yes, "final", "carol", "APPROVE", "final-yes"); store.replace(done.id(), 3, done); assertEquals("APPROVED", done.status());
        }
    }
    @Test void frozenConditionalRouteExcludesUnselectedBranchFromMemberProjection() throws Exception {
        var nodes = List.of(node("start", "start", List.of(), null), node("route", "exclusiveGateway", List.of(), "merge"),
            node("high", "approval", List.of("dave"), null), node("ordinary", "approval", List.of("bob"), null),
            node("merge", "exclusiveMerge", List.of(), "route"), node("end", "end", List.of(), null));
        var condition = new com.arcflow.approval.ConditionalRouting.Rule("ALL", List.of(com.arcflow.approval.ConditionalRouting.Predicate.money("GTE", "CNY", new BigDecimal("10000.00"))));
        var edges = List.of(edge("start-route", "start", "route"), new GraphDefinition.Edge("high-branch", "route", "high", "High", condition, false),
            new GraphDefinition.Edge("default-branch", "route", "ordinary", "Default", null, true), edge("high-merge", "high", "merge"), edge("ordinary-merge", "ordinary", "merge"), edge("merge-end", "merge", "end"));
        var conditional = new GraphDefinition(5, definition().id(), 1, "Conditional", nodes, edges);
        var initial = GraphEngine.start("request-1", "submit-1", "alice", conditional, payment(), AT);
        try (var store = new JdbcGraphApprovalStore(dataSource, mapper, conditional)) {
            assertTrue(store.create(1, initial)); assertEquals(2, count("arc_graph_request_member"));
            assertEquals("default-branch", initial.routes().get(0).selectedEdgeId()); assertTrue(flag("arc_graph_request_member", "bob", "pending"));
        }
        try (var store = new JdbcGraphApprovalStore(dataSource, mapper, conditional)) { assertEquals(initial, store.snapshot().requests().get(0)); }
        try (var c = dataSource.getConnection(); var s = c.createStatement(); var rows = s.executeQuery("SELECT COUNT(*) FROM arc_graph_request_member WHERE actor_id = 'dave'")) { rows.next(); assertEquals(0, rows.getInt(1)); }
    }
    @Test void malformedStoredTimestampIsAnIoFailureWithoutMutation() throws Exception {
        try (var store = open()) {
            store.create(1, initial()); var json = (com.fasterxml.jackson.databind.node.ObjectNode)mapper.valueToTree(initial()); json.put("createdAt", "not-an-instant");
            try (var c = dataSource.getConnection(); var statement = c.prepareStatement("UPDATE arc_graph_request SET created_at = ?, request_json = ?")) {
                statement.setString(1, "not-an-instant"); statement.setString(2, json.toString()); statement.executeUpdate();
            }
            assertThrows(IOException.class, store::snapshot); assertEquals(1, count("arc_graph_request"));
        }
        assertThrows(IOException.class, this::open);
    }
    @Test void maximumRuntimeIdentityLengthsFitTaskAndCommandProjections() throws Exception {
        String longNode = "L".repeat(64), longRequest = "R".repeat(128), longKey = "K".repeat(128);
        var base = definition(); var nodes = base.nodes().stream().map(n -> n.id().equals("left")
            ? new GraphDefinition.Node(longNode, n.type(), n.name(), n.assigneeIds(), n.completionMode(), n.pairId()) : n).toList();
        var edges = base.edges().stream().map(e -> new GraphDefinition.Edge(e.id(), e.source().equals("left") ? longNode : e.source(),
            e.target().equals("left") ? longNode : e.target(), e.label(), e.condition(), e.defaultBranch())).toList();
        var large = new GraphDefinition(5, base.id(), 1, base.name(), nodes, edges);
        var initial = GraphEngine.start(longRequest, longKey, "alice", large, payment(), AT);
        GraphInstance decided;
        try (var store = new JdbcGraphApprovalStore(dataSource, mapper, large)) {
            assertTrue(store.create(1, initial)); decided = vote(initial, longNode, "bob", "APPROVE", longKey);
            assertTrue(store.replace(longRequest, 0, decided)); assertEquals(193, decided.tasks().get(0).id().length());
        }
        try (var store = new JdbcGraphApprovalStore(dataSource, mapper, large)) { assertEquals(decided, store.snapshot().requests().get(0)); }
    }
    static DataSource loseAcknowledgement(DataSource delegate, String prefix, AtomicBoolean lost) {
        return (DataSource)Proxy.newProxyInstance(GraphStoreContract.class.getClassLoader(), new Class<?>[]{DataSource.class}, (p,m,a) -> {
            try {
                Object result = m.invoke(delegate,a); if (!m.getName().equals("getConnection")) return result;
                Connection c = (Connection)result; boolean[] wrote = {false};
                return Proxy.newProxyInstance(GraphStoreContract.class.getClassLoader(), new Class<?>[]{Connection.class}, (cp,cm,ca) -> {
                    try {
                        Object value = cm.invoke(c,ca);
                        if (cm.getName().equals("commit") && wrote[0] && lost.compareAndSet(false,true)) throw new SQLException("Lost graph commit acknowledgement", "08006");
                        if (!cm.getName().equals("prepareStatement") || !((String)ca[0]).startsWith(prefix)) return value;
                        PreparedStatement statement = (PreparedStatement)value;
                        return Proxy.newProxyInstance(GraphStoreContract.class.getClassLoader(), new Class<?>[]{PreparedStatement.class}, (sp,sm,sa) -> {
                            try { Object outcome = sm.invoke(statement,sa); if (sm.getName().equals("executeUpdate")) wrote[0] = true; return outcome; }
                            catch (InvocationTargetException failure) { throw failure.getCause(); }
                        });
                    } catch (InvocationTargetException failure) { throw failure.getCause(); }
                });
            } catch (InvocationTargetException failure) { throw failure.getCause(); }
        });
    }
}
