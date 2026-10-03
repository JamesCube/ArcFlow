package com.arcflow.approval.jdbc;

import com.arcflow.approval.ApprovalService;
import com.arcflow.approval.ApprovalService.Event;
import com.arcflow.approval.ApprovalService.Request;
import com.arcflow.approval.ProcessDefinition;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.logging.Logger;
import javax.sql.DataSource;
import org.h2.jdbcx.JdbcDataSource;
import org.h2.tools.RunScript;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class JdbcApprovalStoreTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private static final ProcessDefinition INITIAL = ProcessDefinition.legacy("bob");
    private static final String CREATED = "2026-10-03T12:00:00Z";
    private static final String DECIDED = "2026-10-03T12:01:00Z";
    @TempDir Path temp;

    @Test void schemaInstallationIsExplicit() throws Exception {
        JdbcDataSource dataSource = database("mem:" + UUID.randomUUID());
        assertThrows(IOException.class, () -> store(dataSource));
        assertEquals(0, scalar(dataSource, "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'ARC_%'"));
    }

    @Test void restartRetainsRequestAuditAndPublishedSnapshots() throws Exception {
        String location = "file:" + temp.resolve("approvals");
        JdbcDataSource firstDataSource = database(location);
        install(firstDataSource);
        Request original = submission("restart", INITIAL);
        try (var first = store(firstDataSource)) {
            assertTrue(first.create(1, original));
            assertTrue(first.publish("publisher", 1, definition(2, "carol")));
            assertTrue(first.update(0, decision(original, "APPROVE")));
        }
        // Every connection closed, including the file-backed database; use another DataSource.
        try (var restarted = store(database(location))) {
            Request restored = restarted.request("restart");
            assertEquals("APPROVED", restored.status());
            assertEquals(2, restored.history().size());
            assertEquals(INITIAL, restored.definition());
            assertEquals(definition(2, "carol"), restarted.process());
            assertEquals(List.of(restored), restarted.requests());
        }
        assertEquals(2, scalar(firstDataSource, "SELECT COUNT(*) FROM arc_process_version"));
        assertEquals("publisher", string(firstDataSource, "SELECT published_by FROM arc_process_version WHERE process_version = 2"));
        assertNotNull(string(firstDataSource, "SELECT published_at FROM arc_process_version WHERE process_version = 2"));
    }

    @Test void independentInstancesReadFreshDatabaseState() throws Exception {
        JdbcDataSource dataSource = initialized();
        try (var first = store(dataSource); var second = store(dataSource)) {
            Request original = submission("shared", INITIAL);
            assertTrue(first.create(1, original));
            assertEquals(original, second.request(original.id()));
            assertEquals(List.of(original), second.requests());
            assertTrue(second.update(0, decision(original, "REJECT")));
            assertEquals("REJECTED", first.request(original.id()).status());
            assertTrue(first.publish("publisher", 1, definition(2, "carol")));
            assertEquals(2, second.process().version());
            assertFalse(second.create(1, submission("stale", INITIAL)));
            assertNull(first.request("stale"));
        }
    }

    @Test void racingDecisionsCommitExactlyOneStateAndEvent() throws Exception {
        JdbcDataSource dataSource = initialized();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (var first = store(dataSource); var second = store(dataSource)) {
            Request original = submission("race", INITIAL);
            assertTrue(first.create(1, original));
            CountDownLatch start = new CountDownLatch(1);
            var approve = pool.submit(() -> { await(start); return first.update(0, decision(original, "APPROVE")); });
            var reject = pool.submit(() -> { await(start); return second.update(0, decision(original, "REJECT")); });
            start.countDown();
            assertNotEquals(approve.get(10, TimeUnit.SECONDS), reject.get(10, TimeUnit.SECONDS));
            Request result = first.request(original.id());
            assertEquals(2, result.history().size());
            assertEquals(2, scalar(dataSource, "SELECT COUNT(*) FROM arc_request_event"));
            assertEquals(1, scalar(dataSource, "SELECT revision FROM arc_request"));
            assertEquals(result, second.request(original.id()));
            assertFalse(first.update(0, decision(original, "APPROVE")));
        } finally { pool.shutdownNow(); }
    }

    @Test void racingPublicationsRetainOnlyTheWinningVersion() throws Exception {
        JdbcDataSource dataSource = initialized();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (var first = store(dataSource); var second = store(dataSource)) {
            CountDownLatch start = new CountDownLatch(1);
            var one = pool.submit(() -> { await(start); return first.publish("publisher-one", 1, definition(2, "carol")); });
            var two = pool.submit(() -> { await(start); return second.publish("publisher-two", 1, definition(2, "dave")); });
            start.countDown();
            boolean firstWon = one.get(10, TimeUnit.SECONDS);
            assertNotEquals(firstWon, two.get(10, TimeUnit.SECONDS));
            assertEquals(firstWon ? definition(2, "carol") : definition(2, "dave"), second.process());
            assertEquals(2, scalar(dataSource, "SELECT COUNT(*) FROM arc_process_version"));
            assertEquals(firstWon ? "publisher-one" : "publisher-two",
                string(dataSource, "SELECT published_by FROM arc_process_version WHERE process_version = 2"));
        } finally { pool.shutdownNow(); }
    }

    @Test void concurrentFirstInitializersConvergeOnOneCommittedDefinition() throws Exception {
        JdbcDataSource dataSource = initialized();
        ExecutorService pool = Executors.newFixedThreadPool(6);
        try {
            CountDownLatch start = new CountDownLatch(1);
            var futures = new ArrayList<java.util.concurrent.Future<ProcessDefinition>>();
            for (int index = 0; index < 6; index++) {
                ProcessDefinition initial = definition(1, "approver-" + index);
                futures.add(pool.submit(() -> {
                    await(start);
                    try (var store = new JdbcApprovalStore(dataSource, mapper, initial)) { return store.process(); }
                }));
            }
            start.countDown();
            ProcessDefinition winner = futures.get(0).get(10, TimeUnit.SECONDS);
            for (var future : futures) assertEquals(winner, future.get(10, TimeUnit.SECONDS));
            assertEquals(1, scalar(dataSource, "SELECT COUNT(*) FROM arc_process_version"));
            assertEquals(1, scalar(dataSource, "SELECT COUNT(*) FROM arc_process_head"));
        } finally { pool.shutdownNow(); }
    }

    @Test void submissionAuditFailureRollsBackInsertedRequest() throws Exception {
        JdbcDataSource dataSource = initialized();
        try (var store = store(dataSource)) {
            sql(dataSource, "ALTER TABLE arc_request_event ADD CONSTRAINT refuse_submission CHECK (event_index > 0)");
            assertThrows(IOException.class, () -> store.create(1, submission("failed", INITIAL)));
            assertNull(store.request("failed"));
            assertEquals(0, scalar(dataSource, "SELECT COUNT(*) FROM arc_request"));
            assertEquals(0, scalar(dataSource, "SELECT COUNT(*) FROM arc_request_event"));
        }
    }

    @Test void decisionAuditFailureRollsBackStateRevisionAndEvent() throws Exception {
        JdbcDataSource dataSource = initialized();
        try (var store = store(dataSource)) {
            Request original = submission("failed", INITIAL);
            assertTrue(store.create(1, original));
            sql(dataSource, "ALTER TABLE arc_request_event ADD CONSTRAINT refuse_decision CHECK (event_index = 0)");
            assertThrows(IOException.class, () -> store.update(0, decision(original, "APPROVE")));
            assertEquals(original, store.request(original.id()));
            assertEquals(0, scalar(dataSource, "SELECT revision FROM arc_request"));
            assertEquals(1, scalar(dataSource, "SELECT COUNT(*) FROM arc_request_event"));
            sql(dataSource, "ALTER TABLE arc_request_event DROP CONSTRAINT refuse_decision");
            assertTrue(store.update(0, decision(original, "APPROVE")));
        }
    }

    @Test void failedHeadUpdateRollsBackPublicationSnapshot() throws Exception {
        JdbcDataSource dataSource = initialized();
        try (var store = store(dataSource)) {
            sql(dataSource, "ALTER TABLE arc_process_head ADD CONSTRAINT refuse_publication CHECK (active_version = 1)");
            assertThrows(IOException.class, () -> store.publish("publisher", 1, definition(2, "carol")));
            assertEquals(INITIAL, store.process());
            assertEquals(1, scalar(dataSource, "SELECT COUNT(*) FROM arc_process_version"));
        }
    }

    @Test void missingOrRewrittenAuditFailsClosedOnReadAndUpdate() throws Exception {
        for (String mutation : List.of("DELETE FROM arc_request_event", "UPDATE arc_request_event SET event_json = '{}'",
                "INSERT INTO arc_request_event SELECT request_id, 1, event_json FROM arc_request_event",
                "UPDATE arc_request_event SET event_index = 2")) {
            JdbcDataSource dataSource = initialized();
            try (var store = store(dataSource)) {
                Request original = submission("tampered", INITIAL);
                assertTrue(store.create(1, original));
                sql(dataSource, mutation);
                assertThrows(IOException.class, () -> store.request(original.id()));
                assertThrows(IOException.class, store::requests);
                assertThrows(IOException.class, () -> store.update(0, decision(original, "APPROVE")));
                assertEquals(0, scalar(dataSource, "SELECT revision FROM arc_request"));
            }
        }
    }

    @Test void snapshotIndexedStateAndRetainedDefinitionTamperingFailClosed() throws Exception {
        for (String mutation : List.of("UPDATE arc_request SET revision = 7", "UPDATE arc_request SET request_status = 'REJECTED'",
                "UPDATE arc_request SET request_json = '{}'", "UPDATE arc_process_version SET definition_json = '{}'",
                "UPDATE arc_process_version SET published_at = 'yesterday'")) {
            JdbcDataSource dataSource = initialized();
            try (var store = store(dataSource)) {
                Request original = submission("tampered", INITIAL);
                assertTrue(store.create(1, original));
                sql(dataSource, mutation);
                assertThrows(IOException.class, () -> store.request(original.id()));
                assertThrows(IOException.class, () -> store.update(0, decision(original, "APPROVE")));
            }
        }
    }

    @Test void appendMustPreserveRequestIdentityDefinitionAndHistory() throws Exception {
        JdbcDataSource dataSource = initialized();
        try (var store = store(dataSource)) {
            Request original = submission("immutable", INITIAL);
            assertTrue(store.create(1, original));
            Request approved = decision(original, "APPROVE");
            var tree = mapper.valueToTree(approved);
            ((com.fasterxml.jackson.databind.node.ObjectNode) tree).put("title", "Changed title");
            Request changedTitle = mapper.treeToValue(tree, Request.class);
            assertThrows(IllegalArgumentException.class, () -> store.update(0, changedTitle));

            Request otherDefinition = decision(submission(original.id(), definition(1, "carol")), "APPROVE");
            assertThrows(IllegalArgumentException.class, () -> store.update(0, otherDefinition));
            assertThrows(IllegalArgumentException.class, () -> store.create(1, submission("forged", definition(1, "carol"))));
            assertEquals(original, store.request(original.id()));
            assertEquals(1, scalar(dataSource, "SELECT COUNT(*) FROM arc_request_event"));
        }
    }

    @Test void multiStepProgressSurvivesReopenAndCannotRewriteEarlierDecisions() throws Exception {
        var nodes = new ArrayList<>(INITIAL.nodes());
        nodes.add(2, new ProcessDefinition.ProcessNode("final-review", "approval", "Final review", "carol"));
        var twoSteps = new ProcessDefinition(2, INITIAL.id(), 1, "Two approvals", nodes);
        JdbcDataSource dataSource = initialized();
        Request pending;
        try (var store = new JdbcApprovalStore(dataSource, mapper, twoSteps)) {
            Request original = submission("two-steps", twoSteps);
            assertTrue(store.create(1, original));
            pending = decision(original, "APPROVE");
            assertEquals("PENDING", pending.status());
            assertEquals("carol", pending.approverId());
            assertThrows(IllegalArgumentException.class, () -> store.update(0, decision(pending, "APPROVE")));
            assertTrue(store.update(0, pending));
        }
        try (var reopened = store(dataSource)) {
            assertEquals(pending, reopened.request(pending.id()));
            Request completed = decision(pending, "APPROVE");
            var tree = mapper.valueToTree(completed);
            ((com.fasterxml.jackson.databind.node.ObjectNode) tree.get("history").get(1)).put("comment", "Rewritten old decision");
            Request rewritten = mapper.treeToValue(tree, Request.class);
            ApprovalService.validateRequest(rewritten); // Still a valid replay, but no longer the persisted prefix.
            assertThrows(IllegalArgumentException.class, () -> reopened.update(1, rewritten));
            assertEquals(pending, reopened.request(pending.id()));
            assertTrue(reopened.update(1, completed));
            assertEquals("APPROVED", reopened.request(pending.id()).status());
            assertEquals(3, scalar(dataSource, "SELECT COUNT(*) FROM arc_request_event"));
        }
    }

    @Test void publicationWaitsForAnAlreadyValidatedSubmission() throws Exception {
        JdbcDataSource dataSource = initialized();
        GateDataSource gate = new GateDataSource(dataSource, "INSERT INTO arc_request (");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (var submitting = store(gate); var publishing = store(dataSource)) {
            Request original = submission("before-publish", INITIAL);
            var create = pool.submit(() -> submitting.create(1, original));
            assertTrue(gate.entered.await(5, TimeUnit.SECONDS));
            var publish = pool.submit(() -> publishing.publish("publisher", 1, definition(2, "carol")));
            assertThrows(TimeoutException.class, () -> publish.get(200, TimeUnit.MILLISECONDS));
            gate.release.countDown();
            assertTrue(create.get(10, TimeUnit.SECONDS));
            assertTrue(publish.get(10, TimeUnit.SECONDS));
            assertEquals(INITIAL, publishing.request(original.id()).definition());
            assertEquals(2, publishing.process().version());
        } finally { gate.release.countDown(); pool.shutdownNow(); }
    }

    @Test void submissionWaitsForPublicationThenRejectsStaleVersion() throws Exception {
        JdbcDataSource dataSource = initialized();
        GateDataSource gate = new GateDataSource(dataSource, "UPDATE arc_process_head");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (var publishing = store(gate); var submitting = store(dataSource)) {
            var publish = pool.submit(() -> publishing.publish("publisher", 1, definition(2, "carol")));
            assertTrue(gate.entered.await(5, TimeUnit.SECONDS));
            var create = pool.submit(() -> submitting.create(1, submission("after-publish", INITIAL)));
            assertThrows(TimeoutException.class, () -> create.get(200, TimeUnit.MILLISECONDS));
            gate.release.countDown();
            assertTrue(publish.get(10, TimeUnit.SECONDS));
            assertFalse(create.get(10, TimeUnit.SECONDS));
            assertNull(submitting.request("after-publish"));
            assertEquals(0, scalar(dataSource, "SELECT COUNT(*) FROM arc_request_event"));
        } finally { gate.release.countDown(); pool.shutdownNow(); }
    }

    @Test void closingStoreDoesNotCloseDataSourceOrOtherInstances() throws Exception {
        JdbcDataSource dataSource = initialized();
        var first = store(dataSource);
        try (var second = store(dataSource)) {
            first.close();
            first.close();
            assertThrows(IOException.class, first::process);
            assertThrows(IOException.class, first::requests);
            assertEquals(INITIAL, second.process());
            try (var connection = dataSource.getConnection()) { assertTrue(connection.isValid(1)); }
        }
    }

    @Test void readingAuditAfterAConcurrentDecisionUsesOneConsistentSnapshot() throws Exception {
        JdbcDataSource dataSource = initialized();
        GateDataSource gate = new GateDataSource(dataSource, "SELECT event_index, event_json FROM arc_request_event");
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (var reader = store(gate); var writer = store(dataSource)) {
            Request original = submission("snapshot-race", INITIAL);
            assertTrue(writer.create(1, original));
            var reading = pool.submit(() -> reader.request(original.id()));
            // Reader has loaded request JSON and retained version but has not queried audit rows.
            assertTrue(gate.entered.await(5, TimeUnit.SECONDS));
            assertTrue(writer.update(0, decision(original, "APPROVE")));
            gate.release.countDown();
            assertEquals(original, reading.get(10, TimeUnit.SECONDS));
            assertEquals("APPROVED", writer.request(original.id()).status());
        } finally { gate.release.countDown(); pool.shutdownNow(); }
    }

    private JdbcApprovalStore store(DataSource dataSource) throws IOException { return new JdbcApprovalStore(dataSource, mapper, INITIAL); }

    private static ProcessDefinition definition(int version, String actor) {
        var base = ProcessDefinition.legacy(actor);
        return new ProcessDefinition(2, base.id(), version, base.name(), base.nodes());
    }

    private static Request submission(String id, ProcessDefinition definition) {
        var first = definition.approvals().get(0);
        return new Request(id, "Synthetic leave", "Synthetic test", 1, "alice", first.assigneeId(), "PENDING",
            CREATED, CREATED, null, null, definition.id(), definition.version(),
            List.of(new Event("alice", "SUBMIT", "", CREATED, null)), definition, first.id());
    }

    private static Request decision(Request original, String decision) {
        var history = new ArrayList<>(original.history());
        history.add(new Event(original.approverId(), decision, "Checked", DECIDED, original.currentStepId()));
        var steps = original.definition().approvals();
        int nextIndex = original.history().size();
        boolean pending = "APPROVE".equals(decision) && nextIndex < steps.size();
        return new Request(original.id(), original.title(), original.reason(), original.days(), original.applicantId(),
            pending ? steps.get(nextIndex).assigneeId() : original.approverId(),
            pending ? "PENDING" : "APPROVE".equals(decision) ? "APPROVED" : "REJECTED", original.createdAt(), DECIDED, decision, "Checked",
            original.processId(), original.processVersion(), history, original.definition(), pending ? steps.get(nextIndex).id() : null);
    }

    private static JdbcDataSource initialized() throws Exception {
        JdbcDataSource dataSource = database("mem:" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1");
        install(dataSource);
        return dataSource;
    }

    private static JdbcDataSource database(String location) {
        var dataSource = new JdbcDataSource();
        dataSource.setURL("jdbc:h2:" + location + ";LOCK_TIMEOUT=5000");
        return dataSource;
    }

    private static void install(DataSource dataSource) throws Exception {
        try (var input = JdbcApprovalStoreTest.class.getResourceAsStream("/com/arcflow/approval/jdbc/schema-h2.sql")) {
            assertNotNull(input);
            try (var reader = new java.io.InputStreamReader(input, StandardCharsets.UTF_8);
                 var connection = dataSource.getConnection()) { RunScript.execute(connection, reader); }
        }
    }

    private static void sql(DataSource dataSource, String sql) throws SQLException {
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) { statement.execute(sql); }
    }

    private static int scalar(DataSource dataSource, String sql) throws SQLException {
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement(); var rows = statement.executeQuery(sql)) {
            assertTrue(rows.next()); return rows.getInt(1);
        }
    }

    private static String string(DataSource dataSource, String sql) throws SQLException {
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement(); var rows = statement.executeQuery(sql)) {
            assertTrue(rows.next()); return rows.getString(1);
        }
    }

    private static void await(CountDownLatch latch) throws InterruptedException {
        if (!latch.await(10, TimeUnit.SECONDS)) throw new AssertionError("Timed out waiting for test gate");
    }

    /** Blocks an exact JDBC statement so races can be reproduced at a known transaction boundary. */
    private static final class GateDataSource implements DataSource {
        private final DataSource delegate;
        private final String prefix;
        private final CountDownLatch entered = new CountDownLatch(1);
        private final CountDownLatch release = new CountDownLatch(1);
        GateDataSource(DataSource delegate, String prefix) { this.delegate = delegate; this.prefix = prefix; }
        @Override public Connection getConnection() throws SQLException {
            Connection connection = delegate.getConnection();
            return (Connection) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{Connection.class}, (proxy, method, args) -> {
                try {
                    Object result = method.invoke(connection, args);
                    if (method.getName().equals("prepareStatement") && args[0] instanceof String sql && sql.startsWith(prefix)) {
                        PreparedStatement statement = (PreparedStatement) result;
                        return Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{PreparedStatement.class}, (p, m, a) -> {
                            try {
                                if (m.getName().equals("executeUpdate") || m.getName().equals("executeQuery")) {
                                    entered.countDown(); await(release);
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
        @Override public Logger getParentLogger() { return Logger.getLogger("approval-jdbc-test"); }
        @Override public <T> T unwrap(Class<T> type) throws SQLException { return delegate.unwrap(type); }
        @Override public boolean isWrapperFor(Class<?> type) throws SQLException { return delegate.isWrapperFor(type); }
    }
}
