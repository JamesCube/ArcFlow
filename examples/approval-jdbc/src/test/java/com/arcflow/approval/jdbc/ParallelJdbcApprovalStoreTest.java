package com.arcflow.approval.jdbc;

import com.arcflow.approval.ActorDirectory;
import com.arcflow.approval.ApprovalService;
import com.arcflow.approval.ApprovalService.Request;
import com.arcflow.approval.ProcessDefinition;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.PrintWriter;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.function.Predicate;
import java.util.logging.Logger;
import javax.sql.DataSource;
import org.h2.jdbcx.JdbcDataSource;
import org.h2.tools.RunScript;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

/** Exercises participant-level compare-and-set retries through independent services and real JDBC transactions. */
class ParallelJdbcApprovalStoreTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final ActorDirectory USERS = new ActorDirectory() {
        private final List<ApprovalService.Person> people = List.of(
            new ApprovalService.Person("alice", "Alice"), new ApprovalService.Person("bob", "Bob"),
            new ApprovalService.Person("carol", "Carol"), new ApprovalService.Person("dave", "Dave"));
        public Optional<ApprovalService.Person> findActive(String id) { return people.stream().filter(p -> p.id().equals(id)).findFirst(); }
        public List<ApprovalService.Person> listActive() { return people; }
        public boolean canPublish(String id) { return "alice".equals(id); }
    };
    @TempDir Path temp;

    @Test void allConcurrentApprovalsRetryStaleRevisionWithoutLosingEitherParticipant() throws Exception {
        var dataSource = initialized();
        var results = orderedRace(dataSource, definition("ALL"), "bob", "APPROVE", "carol", "APPROVE");
        assertEquals(List.of(200, 200), results);
        try (var store = store(dataSource, definition("ALL"))) {
            var saved = store.requests().get(0);
            assertEquals("APPROVED", saved.status());
            assertEquals(List.of("alice", "bob", "carol"), saved.history().stream().map(ApprovalService.Event::actorId).toList());
            assertEquals(List.of("SUBMIT", "APPROVE", "APPROVE"), saved.history().stream().map(ApprovalService.Event::action).toList());
            assertNull(saved.currentStepId());
            assertEquals(List.of(), ApprovalService.pendingApproverIds(saved));
            assertAudit(dataSource, 2, 3);
        }
    }

    @Test void anyConcurrentRejectionsRetryStaleRevisionAndRejectOnlyAfterAllParticipants() throws Exception {
        var dataSource = initialized();
        assertEquals(List.of(200, 200), orderedRace(dataSource, definition("ANY"), "bob", "REJECT", "carol", "REJECT"));
        try (var service = open(dataSource, definition("ANY"))) {
            var saved = service.list("alice").get(0);
            assertEquals("REJECTED", saved.status());
            assertEquals(List.of("alice", "bob", "carol"), saved.history().stream().map(ApprovalService.Event::actorId).toList());
            assertAudit(dataSource, 2, 3);
            assertEquals(saved, service.decide("bob", saved.id(), "review", "REJECT", "ignored replay"));
            status(409, () -> service.decide("bob", saved.id(), "review", "APPROVE", "opposite"));
            assertAudit(dataSource, 2, 3);
        }
    }

    @Test void firstDecisiveParticipantClosesGroupBeforeAnAlreadyWaitingUnvotedParticipant() throws Exception {
        for (String mode : List.of("ALL", "ANY")) {
            var dataSource = initialized();
            String decisive = "ALL".equals(mode) ? "REJECT" : "APPROVE";
            assertEquals(List.of(200, 409), orderedRace(dataSource, definition(mode), "bob", decisive, "carol", decisive));
            try (var service = open(dataSource, definition(mode))) {
                var saved = service.list("alice").get(0);
                assertEquals("ALL".equals(mode) ? "REJECTED" : "APPROVED", saved.status());
                assertEquals(List.of("alice", "bob"), saved.history().stream().map(ApprovalService.Event::actorId).toList());
                assertEquals(saved, service.decide("bob", saved.id(), "review", decisive, "ignored replay"));
                status(409, () -> service.decide("carol", saved.id(), "review", decisive, "late participant"));
                assertAudit(dataSource, 1, 2);
            }
        }
    }

    @Test void concurrentDuplicateOrOppositeVoteFromSameParticipantHasOneDurableEvent() throws Exception {
        for (String competingVote : List.of("APPROVE", "REJECT")) {
            var dataSource = initialized();
            assertEquals(List.of(200, "APPROVE".equals(competingVote) ? 200 : 409),
                orderedRace(dataSource, definition("ALL"), "bob", "APPROVE", "bob", competingVote));
            try (var store = store(dataSource, definition("ALL"))) {
                var saved = store.requests().get(0);
                assertEquals("PENDING", saved.status());
                assertEquals("review", saved.currentStepId());
                assertEquals("carol", saved.approverId());
                assertEquals(List.of("carol"), ApprovalService.pendingApproverIds(saved));
                assertAudit(dataSource, 1, 2);
            }
        }
    }

    @Test void allApproveThenRejectRaceRetainsPartialApprovalAndRejectsGroup() throws Exception {
        assertMixedVoteRace("ALL", "APPROVE");
    }

    @Test void allRejectThenApproveRaceClosesGroupAndConflictsUnvotedApprover() throws Exception {
        assertMixedVoteRace("ALL", "REJECT");
    }

    @Test void anyApproveThenRejectRaceClosesGroupAndConflictsUnvotedRejector() throws Exception {
        assertMixedVoteRace("ANY", "APPROVE");
    }

    @Test void anyRejectThenApproveRaceRetainsPartialRejectionAndApprovesGroup() throws Exception {
        assertMixedVoteRace("ANY", "REJECT");
    }

    private static void assertMixedVoteRace(String mode, String firstVote) throws Exception {
        assertMixedVoteRace(initialized(), mode, firstVote);
    }

    /** Shared by H2 and the real PostgreSQL suite; the caller supplies an already migrated empty database. */
    static void assertMixedVoteRace(DataSource dataSource, String mode, String firstVote) throws Exception {
        String decisiveVote = "ALL".equals(mode) ? "REJECT" : "APPROVE";
        String finalStatus = "ALL".equals(mode) ? "REJECTED" : "APPROVED";
        String secondVote = "APPROVE".equals(firstVote) ? "REJECT" : "APPROVE";
        boolean firstCloses = decisiveVote.equals(firstVote);
        var outcomes = orderedRace(dataSource, definition(mode), "bob", firstVote, "carol", secondVote, firstResponse -> {
            assertEquals(firstCloses ? finalStatus : "PENDING", firstResponse.status());
            assertEquals(firstCloses ? null : "review", firstResponse.currentStepId());
            assertEquals(firstCloses ? List.of() : List.of("carol"), ApprovalService.pendingApproverIds(firstResponse));
            assertEquals(firstCloses ? "bob" : "carol", firstResponse.approverId());
            assertEquals(List.of("SUBMIT", firstVote), firstResponse.history().stream().map(ApprovalService.Event::action).toList());
            assertEquals(List.of("alice", "bob"), firstResponse.history().stream().map(ApprovalService.Event::actorId).toList());
        });
        assertEquals(List.of(200, firstCloses ? 409 : 200), outcomes);
        try (var service = open(dataSource, definition(mode))) {
            var saved = service.list("alice").get(0);
            assertEquals(finalStatus, saved.status());
            assertNull(saved.currentStepId());
            assertEquals(List.of(), ApprovalService.pendingApproverIds(saved));
            assertEquals(decisiveVote, saved.decision());
            assertEquals(firstCloses ? "bob" : "carol", saved.approverId());
            assertEquals(firstCloses ? List.of("SUBMIT", firstVote) : List.of("SUBMIT", firstVote, secondVote),
                saved.history().stream().map(ApprovalService.Event::action).toList());
            assertEquals(firstCloses ? List.of("alice", "bob") : List.of("alice", "bob", "carol"),
                saved.history().stream().map(ApprovalService.Event::actorId).toList());
            assertEquals(firstCloses ? List.of("first") : List.of("first", "second"),
                saved.history().subList(1, saved.history().size()).stream().map(ApprovalService.Event::comment).toList());
            assertTrue(saved.history().subList(1, saved.history().size()).stream().allMatch(event -> "review".equals(event.stepId())));
            assertEquals(saved, service.decide("bob", saved.id(), "review", firstVote, "idempotent first vote"));
            status(409, () -> service.decide("bob", saved.id(), "review", secondVote, "opposite first vote"));
            if (firstCloses) {
                status(409, () -> service.decide("carol", saved.id(), "review", secondVote, "unvoted participant retry"));
            } else {
                assertEquals(saved, service.decide("carol", saved.id(), "review", secondVote, "idempotent closing vote"));
            }
            status(409, () -> service.decide("carol", saved.id(), "review", firstVote, "unvoted or opposite vote"));
            assertAudit(dataSource, firstCloses ? 1 : 2, firstCloses ? 2 : 3);
        }
    }

    @Test void fileRestartPreservesPartialGroupAndPublicationCannotChangeItsMembershipOrLaterStep() throws Exception {
        String location = "file:" + temp.resolve("parallel-approvals");
        var dataSource = database(location);
        install(dataSource);
        var nodes = new ArrayList<>(definition("ALL", "bob", "carol", "dave").nodes());
        nodes.add(nodes.size() - 1, new ProcessDefinition.ProcessNode("final-review", "approval", "Final review", "bob"));
        var originalDefinition = new ProcessDefinition(3, "leave-approval", 1, "Parallel then sequential", nodes);
        Request pending;
        try (var first = open(dataSource, originalDefinition)) {
            var original = first.submit("alice", "Leave", "Rest", 1, 1);
            pending = first.decide("carol", original.id(), "review", "APPROVE", "saved before restart");
            assertEquals("review", pending.currentStepId());
            assertEquals("bob", pending.approverId());
            assertEquals(List.of("bob", "dave"), ApprovalService.pendingApproverIds(pending));
            var published = first.publish("alice", 1, ProcessDefinition.legacy("carol"));
            assertEquals(2, published.version());
        }
        // No connection remains open; reopen the file through a new DataSource and default definition.
        var reopenedDataSource = database(location);
        try (var restarted = open(reopenedDataSource, ProcessDefinition.legacy("bob"))) {
            assertEquals(2, restarted.process().version());
            assertEquals(pending, restarted.list("alice").get(0));
            assertEquals(originalDefinition, restarted.list("dave").get(0).definition());
            var oneRemaining = restarted.decide("bob", pending.id(), "review", "APPROVE", "second participant");
            assertEquals(List.of("dave"), ApprovalService.pendingApproverIds(oneRemaining));
            assertEquals("dave", oneRemaining.approverId());
            var sequential = restarted.decide("dave", pending.id(), "review", "APPROVE", "last participant");
            assertEquals("final-review", sequential.currentStepId());
            assertEquals(List.of("bob"), ApprovalService.pendingApproverIds(sequential));
            assertEquals(sequential, restarted.decide("bob", pending.id(), "review", "APPROVE", "old group replay"));
            assertAudit(reopenedDataSource, 3, 4);
            var completed = restarted.decide("bob", pending.id(), "final-review", "APPROVE", "separate step");
            assertEquals("APPROVED", completed.status());
            assertAudit(reopenedDataSource, 4, 5);
        }
    }

    @Test void schemaTwoPendingRequestCompletesItsOldSequenceAfterSchemaThreePublicationAndFileRestart() throws Exception {
        String location = "file:" + temp.resolve("schema-upgrade");
        var dataSource = database(location);
        install(dataSource);
        var nodes = new ArrayList<>(ProcessDefinition.legacy("bob").nodes());
        nodes.add(nodes.size() - 1, new ProcessDefinition.ProcessNode("final-review", "approval", "Final review", "carol"));
        var oldDefinition = new ProcessDefinition(2, "leave-approval", 1, "Existing sequential process", nodes);
        Request pending;
        ProcessDefinition published;
        try (var service = open(dataSource, oldDefinition)) {
            var submitted = service.submit("alice", "Existing leave", "Rest", 1, 1);
            pending = service.decide("bob", submitted.id(), "manager", "APPROVE", "before schema upgrade");
            assertEquals("PENDING", pending.status());
            assertEquals("final-review", pending.currentStepId());
            published = service.publish("alice", 1, definition("ANY", "bob", "dave"));
            assertEquals(3, published.schemaVersion());
            assertEquals(2, published.version());
            assertEquals(pending, service.list("alice").get(0));
        }

        // Exercise an actual closed file database with the schema-3 process now active.
        var reopenedDataSource = database(location);
        try (var restarted = open(reopenedDataSource, definition("ALL"))) {
            assertEquals(published, restarted.process());
            assertEquals(pending, restarted.list("alice").get(0));
            assertEquals(oldDefinition, restarted.list("carol").get(0).definition());
            assertTrue(restarted.list("dave").isEmpty());
            assertEquals(List.of("carol"), ApprovalService.pendingApproverIds(pending));
            assertEquals(pending, restarted.decide("bob", pending.id(), "manager", "APPROVE", "old step replay"));
            var completed = restarted.decide("carol", pending.id(), "final-review", "APPROVE", "after schema upgrade");
            assertEquals("APPROVED", completed.status());
            assertEquals(oldDefinition, completed.definition());
            assertEquals(1, completed.processVersion());
            assertEquals(List.of("alice", "bob", "carol"), completed.history().stream().map(ApprovalService.Event::actorId).toList());
            assertEquals(List.of("manager", "final-review"), completed.history().subList(1, 3).stream().map(ApprovalService.Event::stepId).toList());
            assertAudit(reopenedDataSource, 2, 3);
            assertEquals(2, scalar(reopenedDataSource, "SELECT COUNT(*) FROM arc_process_version"));

            var newRequest = restarted.submit("alice", "New leave", "Rest", 1, 2);
            assertEquals(published, newRequest.definition());
            assertEquals("review", newRequest.currentStepId());
            assertEquals(List.of("bob", "dave"), ApprovalService.pendingApproverIds(newRequest));
            assertEquals(List.of(newRequest), restarted.list("dave"));
            assertEquals(4, scalar(reopenedDataSource, "SELECT COUNT(*) FROM arc_request_event"));
        }
    }

    @Test void failedParticipantAuditRollsBackClosingVoteRevisionAndPendingMembership() throws Exception {
        for (String mode : List.of("ALL", "ANY")) {
            var dataSource = initialized();
            String vote = "ALL".equals(mode) ? "APPROVE" : "REJECT";
            try (var first = open(dataSource, definition(mode)); var second = open(dataSource, definition(mode))) {
                var original = first.submit("alice", "Leave", "Rest", 1, 1);
                var pending = first.decide("carol", original.id(), "review", vote, "committed participant");
                sql(dataSource, "ALTER TABLE arc_request_event ADD CONSTRAINT refuse_closing_vote CHECK (event_index < 2)");
                assertThrows(IOException.class, () -> second.decide("bob", original.id(), "review", vote, "rolled back"));
                assertEquals(pending, first.list("alice").get(0));
                assertEquals(List.of("bob"), ApprovalService.pendingApproverIds(second.list("alice").get(0)));
                assertAudit(dataSource, 1, 2);
                sql(dataSource, "ALTER TABLE arc_request_event DROP CONSTRAINT refuse_closing_vote");
                var completed = second.decide("bob", original.id(), "review", vote, "successful retry");
                assertEquals("ALL".equals(mode) ? "APPROVED" : "REJECTED", completed.status());
                assertEquals("successful retry", completed.history().get(2).comment());
                assertAudit(dataSource, 2, 3);
            }
        }
    }

    @Test void originalSchemaTwoStoredJsonWithoutNewNodeFieldsRemainsStrictlyReadableAndUpdatable() throws Exception {
        var dataSource = initialized();
        Request original;
        var legacy = ProcessDefinition.legacy("bob");
        try (var service = open(dataSource, legacy)) { original = service.submit("alice", "Leave", "Rest", 1, 1); }
        var definitionJson = MAPPER.valueToTree(legacy);
        removeParallelFields((ObjectNode) definitionJson);
        var requestJson = (ObjectNode) MAPPER.valueToTree(original);
        removeParallelFields((ObjectNode) requestJson.get("definition"));
        replaceJson(dataSource, "arc_process_version", "definition_json", definitionJson.toString());
        replaceJson(dataSource, "arc_request", "request_json", requestJson.toString());
        try (var restored = store(dataSource, definition("ALL"))) {
            assertEquals(legacy, restored.process());
            assertEquals(original, restored.request(original.id()));
            assertEquals(List.of(original), restored.requests());
        }
        try (var service = open(dataSource, definition("ALL"))) {
            assertEquals("APPROVED", service.decide("bob", original.id(), "manager", "APPROVE", "legacy still executes").status());
            assertAudit(dataSource, 1, 2);
        }
    }

    @Test void malformedParallelFieldsFailClosedInRetainedDefinitionAndRequestSnapshot() throws Exception {
        List<Consumer<ObjectNode>> corruptions = List.of(
            node -> node.remove("assigneeIds"),
            node -> node.remove("completionMode"),
            node -> node.putNull("assigneeIds"),
            node -> node.put("assigneeIds", "bob"),
            node -> node.putArray("assigneeIds").add("bob").add(17),
            node -> node.putArray("assigneeIds").add("bob").add("bob"),
            node -> node.put("completionMode", "SOME"),
            node -> node.put("completionMode", true),
            node -> node.put("assigneeId", "bob"));
        for (var corruption : corruptions) {
            for (boolean corruptRetainedDefinition : List.of(true, false)) {
                var dataSource = initialized();
                var definition = definition("ALL");
                Request original;
                try (var service = open(dataSource, definition)) { original = service.submit("alice", "Leave", "Rest", 1, 1); }
                try (var restored = store(dataSource, definition)) {
                    ObjectNode document = MAPPER.valueToTree(corruptRetainedDefinition ? definition : original);
                    var definitionNode = corruptRetainedDefinition ? document : (ObjectNode) document.get("definition");
                    corruption.accept((ObjectNode) definitionNode.get("nodes").get(1));
                    replaceJson(dataSource, corruptRetainedDefinition ? "arc_process_version" : "arc_request",
                        corruptRetainedDefinition ? "definition_json" : "request_json", document.toString());
                    if (corruptRetainedDefinition) assertThrows(IOException.class, restored::process);
                    assertThrows(IOException.class, () -> restored.request(original.id()));
                    assertThrows(IOException.class, restored::requests);
                }
            }
        }
    }

    @Test void legacyCompatibilityDoesNotMakeOriginalNodeFieldsOptional() throws Exception {
        for (String missing : List.of("id", "type", "name", "assigneeId")) {
            var dataSource = initialized();
            var legacy = ProcessDefinition.legacy("bob");
            try (var restored = store(dataSource, legacy)) {
                ObjectNode document = MAPPER.valueToTree(legacy);
                removeParallelFields(document);
                // assigneeId is intentionally null on a start node, but its presence is still required.
                ((ObjectNode) document.get("nodes").get(0)).remove(missing);
                replaceJson(dataSource, "arc_process_version", "definition_json", document.toString());
                assertThrows(IOException.class, restored::process);
            }
        }
    }

    /** Both decisions load revision zero before the first commits; the second must retry its failed CAS. */
    private static List<Integer> orderedRace(DataSource dataSource, ProcessDefinition definition,
                                             String firstActor, String firstVote, String secondActor, String secondVote) throws Exception {
        return orderedRace(dataSource, definition, firstActor, firstVote, secondActor, secondVote, ignored -> {});
    }

    private static List<Integer> orderedRace(DataSource dataSource, ProcessDefinition definition,
                                             String firstActor, String firstVote, String secondActor, String secondVote,
                                             Consumer<Request> inspectFirstResponse) throws Exception {
        var firstGate = new GateDataSource(dataSource, sql -> sql.startsWith("UPDATE arc_request SET"));
        var secondGate = new GateDataSource(dataSource, sql -> sql.startsWith("SELECT request_id,") && sql.endsWith(" FOR UPDATE"));
        secondGate.release.countDown(); // Observe its lock attempt without delaying the database lock itself.
        var executor = Executors.newFixedThreadPool(2);
        try (var first = open(firstGate, definition); var second = open(secondGate, definition)) {
            var request = first.submit("alice", "Leave", "Rest", 1, 1);
            var firstDecision = executor.submit(() -> result(() -> {
                var response = first.decide(firstActor, request.id(), "review", firstVote, "first");
                inspectFirstResponse.accept(response);
                return response;
            }));
            assertTrue(firstGate.entered.await(5, TimeUnit.SECONDS), "First transaction did not reach its locked update");
            var secondDecision = executor.submit(() -> result(() -> second.decide(secondActor, request.id(), "review", secondVote, "second")));
            assertTrue(secondGate.entered.await(5, TimeUnit.SECONDS), "Second transaction did not attempt its stale update");
            assertThrows(TimeoutException.class, () -> secondDecision.get(100, TimeUnit.MILLISECONDS));
            firstGate.release.countDown();
            return List.of(firstDecision.get(10, TimeUnit.SECONDS), secondDecision.get(10, TimeUnit.SECONDS));
        } finally {
            firstGate.release.countDown();
            executor.shutdownNow();
            assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS));
        }
    }

    static ProcessDefinition definition(String mode, String... participants) {
        var assignees = participants.length == 0 ? List.of("bob", "carol") : List.of(participants);
        return new ProcessDefinition(3, "leave-approval", 1, "Parallel leave review", List.of(
            new ProcessDefinition.ProcessNode("start", "start", "Submit", null),
            new ProcessDefinition.ProcessNode("review", "parallelApproval", "Parallel review", null, assignees, mode),
            new ProcessDefinition.ProcessNode("end", "end", "Done", null)));
    }

    private static JdbcApprovalStore store(DataSource dataSource, ProcessDefinition definition) throws IOException {
        return new JdbcApprovalStore(dataSource, MAPPER, definition);
    }
    private static ApprovalService open(DataSource dataSource, ProcessDefinition definition) throws IOException {
        return new ApprovalService(store(dataSource, definition), USERS);
    }
    private static int result(Callable<?> action) throws Exception {
        try { action.call(); return 200; }
        catch (ResponseStatusException failure) { return failure.getStatusCode().value(); }
    }
    private static void status(int expected, org.junit.jupiter.api.function.Executable action) {
        assertEquals(expected, assertThrows(ResponseStatusException.class, action).getStatusCode().value());
    }
    private static JdbcDataSource initialized() throws Exception {
        var dataSource = database("mem:" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1");
        install(dataSource);
        return dataSource;
    }
    private static JdbcDataSource database(String location) {
        var dataSource = new JdbcDataSource();
        dataSource.setURL("jdbc:h2:" + location + ";LOCK_TIMEOUT=5000");
        return dataSource;
    }
    private static void install(DataSource dataSource) throws Exception {
        try (var input = JdbcApprovalStore.class.getResourceAsStream("schema-h2.sql")) {
            assertNotNull(input);
            try (var reader = new java.io.InputStreamReader(input, StandardCharsets.UTF_8);
                 var connection = dataSource.getConnection()) { RunScript.execute(connection, reader); }
        }
    }
    private static void assertAudit(DataSource dataSource, int revision, int events) throws SQLException {
        assertEquals(revision, scalar(dataSource, "SELECT revision FROM arc_request"));
        assertEquals(events, scalar(dataSource, "SELECT COUNT(*) FROM arc_request_event"));
        assertEquals(revision, scalar(dataSource, "SELECT MAX(event_index) FROM arc_request_event"));
    }
    private static int scalar(DataSource dataSource, String sql) throws SQLException {
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement(); var rows = statement.executeQuery(sql)) {
            assertTrue(rows.next()); return rows.getInt(1);
        }
    }
    private static void sql(DataSource dataSource, String sql) throws SQLException {
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) { statement.execute(sql); }
    }
    private static void replaceJson(DataSource dataSource, String table, String column, String json) throws SQLException {
        try (var connection = dataSource.getConnection(); var statement = connection.prepareStatement("UPDATE " + table + " SET " + column + " = ?")) {
            statement.setString(1, json);
            assertEquals(1, statement.executeUpdate());
        }
    }
    private static void removeParallelFields(ObjectNode definition) {
        definition.get("nodes").forEach(node -> ((ObjectNode) node).remove(List.of("assigneeIds", "completionMode")));
    }

    /** A one-shot gate at an exact JDBC boundary, used instead of relying on thread scheduling. */
    private static final class GateDataSource implements DataSource {
        private final DataSource delegate;
        private final Predicate<String> match;
        private final AtomicBoolean gated = new AtomicBoolean();
        final CountDownLatch entered = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        GateDataSource(DataSource delegate, Predicate<String> match) { this.delegate = delegate; this.match = match; }
        @Override public Connection getConnection() throws SQLException {
            Connection connection = delegate.getConnection();
            return (Connection) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{Connection.class}, (proxy, method, args) -> {
                try {
                    Object result = method.invoke(connection, args);
                    if (method.getName().equals("prepareStatement") && args[0] instanceof String sql && match.test(sql)) {
                        PreparedStatement statement = (PreparedStatement) result;
                        return Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{PreparedStatement.class}, (p, m, a) -> {
                            try {
                                if ((m.getName().equals("executeUpdate") || m.getName().equals("executeQuery")) && gated.compareAndSet(false, true)) {
                                    entered.countDown();
                                    if (!release.await(10, TimeUnit.SECONDS)) throw new AssertionError("Timed out waiting for JDBC gate");
                                }
                                return m.invoke(statement, a);
                            } catch (InvocationTargetException failure) { throw failure.getCause(); }
                        });
                    }
                    return result;
                } catch (InvocationTargetException failure) { throw failure.getCause(); }
            });
        }
        @Override public Connection getConnection(String user, String password) throws SQLException { throw new SQLException("Not used"); }
        @Override public PrintWriter getLogWriter() throws SQLException { return delegate.getLogWriter(); }
        @Override public void setLogWriter(PrintWriter writer) throws SQLException { delegate.setLogWriter(writer); }
        @Override public void setLoginTimeout(int seconds) throws SQLException { delegate.setLoginTimeout(seconds); }
        @Override public int getLoginTimeout() throws SQLException { return delegate.getLoginTimeout(); }
        @Override public Logger getParentLogger() { return Logger.getLogger("parallel-approval-jdbc-test"); }
        @Override public <T> T unwrap(Class<T> type) throws SQLException { return delegate.unwrap(type); }
        @Override public boolean isWrapperFor(Class<?> type) throws SQLException { return delegate.isWrapperFor(type); }
    }
}
