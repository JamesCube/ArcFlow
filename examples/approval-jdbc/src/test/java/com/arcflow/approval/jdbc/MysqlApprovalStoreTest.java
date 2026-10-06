package com.arcflow.approval.jdbc;

import com.arcflow.approval.ActorDirectory;
import com.arcflow.approval.ApprovalService;
import com.arcflow.approval.ProcessDefinition;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import static org.junit.jupiter.api.Assertions.*;

/** Real MySQL only. Creates and removes its own UUID-named database; never use production credentials. */
@EnabledIfEnvironmentVariable(named = "ARCFLOW_MYSQL_URL", matches = ".+")
class MysqlApprovalStoreTest extends ServerApprovalStoreContract {
    private String catalog;
    private boolean created;
    private final ObjectMapper mapper = new ObjectMapper();

    private Connection connect() throws SQLException {
        return DriverManager.getConnection(System.getenv("ARCFLOW_MYSQL_URL"),
            System.getenv("ARCFLOW_MYSQL_USER"), System.getenv("ARCFLOW_MYSQL_PASSWORD"));
    }

    @BeforeEach void migrateFreshDatabase() throws Exception {
        catalog = "arcflow_test_" + UUID.randomUUID().toString().replace("-", "");
        try (var connection = connect(); var statement = connection.createStatement()) {
            assertEquals("MySQL", connection.getMetaData().getDatabaseProductName(), "Requires Oracle MySQL, not H2 or MariaDB");
            assertEquals(8, connection.getMetaData().getDatabaseMajorVersion());
            System.out.println("Real MySQL server: " + connection.getMetaData().getDatabaseProductVersion());
            statement.execute("CREATE DATABASE " + catalog + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin");
            created = true;
        }
        dataSource = new DataSource() {
            public Connection getConnection() throws SQLException {
                Connection connection = connect();
                try { ServerTestSupport.selectDisposableCatalog(connection, catalog); return connection; }
                catch (SQLException failure) {
                    try { connection.close(); } catch (SQLException close) { failure.addSuppressed(close); }
                    throw failure;
                }
            }
            public Connection getConnection(String user, String password) throws SQLException { throw new SQLException("Not used"); }
            public PrintWriter getLogWriter() { return null; }
            public void setLogWriter(PrintWriter writer) { }
            public void setLoginTimeout(int seconds) { }
            public int getLoginTimeout() { return 0; }
            public Logger getParentLogger() { return Logger.getLogger("mysql-approval-test"); }
            public <T> T unwrap(Class<T> type) throws SQLException { throw new SQLException("Not a wrapper"); }
            public boolean isWrapperFor(Class<?> type) { return false; }
        };
        assertThrows(IOException.class, this::open, "Constructor must never install missing tables");
        try (var input = JdbcApprovalStore.class.getResourceAsStream("schema-mysql.sql")) {
            assertNotNull(input);
            // No allowMultiQueries or implicit driver rewriting: execute the five explicit DDL statements.
            String ddl = new String(input.readAllBytes(), StandardCharsets.UTF_8).replaceAll("(?m)^\\s*--.*$", "");
            for (String statement : ddl.split(";")) if (!statement.isBlank()) sql(statement);
        }
    }

    @AfterEach void dropOnlyCreatedDatabase() throws Exception {
        if (created) {
            assertTrue(catalog.matches("arcflow_test_[a-f0-9]{32}"));
            try (var connection = connect(); var statement = connection.createStatement()) {
                statement.execute("DROP DATABASE " + catalog);
            }
        }
    }

    @Override protected void dropCheck(String table, String constraint) throws Exception {
        sql("ALTER TABLE " + table + " DROP CHECK " + constraint);
    }

    @Test void explicitForeignKeysAndChecksAreActuallyEnforced() throws Exception {
        try (var service = open()) {
            assertThrows(SQLException.class, () -> sql("INSERT INTO arc_request_event VALUES ('missing', 0, '{}')"));
            var request = service.submit("alice", "Leave", "Rest", 1, 1);
            assertThrows(SQLException.class, () -> sql("UPDATE arc_request SET revision = -1"));
            assertThrows(SQLException.class, () -> sql("UPDATE arc_request SET request_status = 'INVALID'"));
            assertThrows(SQLException.class, () -> sql("UPDATE arc_process_head SET active_version = 99"));
            assertThrows(SQLException.class, () -> sql("UPDATE arc_request SET process_version = 99"));
            assertEquals(request, service.list("alice").get(0));
            assertEquals(1, count("arc_request_event"));
        }
    }

    @Test void requestIdentityIsCaseSensitiveAndLookupDoesNotIgnoreTrailingSpace() throws Exception {
        try (var store = new JdbcApprovalStore(dataSource, mapper, ProcessDefinition.legacy("bob"))) {
            var upper = submission("RequestA", ProcessDefinition.legacy("bob"));
            var lower = submission("requesta", ProcessDefinition.legacy("bob"));
            assertTrue(store.create(1, upper));
            assertTrue(store.create(1, lower));
            assertEquals(upper, store.request("RequestA"));
            assertEquals(lower, store.request("requesta"));
            assertNull(store.request("REQUESTA"));
            assertNull(store.request("RequestA "));
            assertThrows(IOException.class, () -> store.create(1, upper));
            assertEquals(2, store.requests().size());
            assertEquals(2, count("arc_request_event"));
        }
    }

    @Test void actorIdentityPreservesCaseAccentTrailingSpacesAndSupplementaryUnicode() throws Exception {
        var actors = List.of("bob", "Bob", "bób", "bob ", "审阅🚀");
        var people = new ArrayList<ApprovalService.Person>();
        people.add(new ApprovalService.Person("alice", "Alice"));
        for (String actor : actors) people.add(new ApprovalService.Person(actor, actor));
        var directory = directory(people);
        var definition = ParallelJdbcApprovalStoreTest.definition("ALL", actors.toArray(String[]::new));
        try (var service = new ApprovalService(new JdbcApprovalStore(dataSource, mapper, definition), directory)) {
            var request = service.submit("alice", "Unicode 🚀", "审批理由", 1, 1);
            for (String actor : actors) service.decide(actor, request.id(), "review", "APPROVE", "批准 🚀");
            var committed = service.list("alice").get(0);
            assertEquals("APPROVED", committed.status());
            assertEquals(actors, committed.history().subList(1, 6).stream().map(ApprovalService.Event::actorId).toList());
            try (var connection = dataSource.getConnection(); var statement = connection.prepareStatement(
                    "SELECT COUNT(*) FROM arc_request WHERE approver_id = ?")) {
                statement.setString(1, "审阅🚀");
                try (var rows = statement.executeQuery()) { assertTrue(rows.next()); assertEquals(1, rows.getInt(1)); }
            }
        }
        // Exercise SQL comparison semantics on an actual actor-ID column, not just Java's replay equality.
        sql("UPDATE arc_request SET approver_id = 'bob '");
        try (var connection = dataSource.getConnection(); var statement = connection.prepareStatement(
                "SELECT COUNT(*) FROM arc_request WHERE approver_id = ?")) {
            for (String different : List.of("bob", "Bob", "bób")) {
                statement.setString(1, different);
                try (var rows = statement.executeQuery()) { assertTrue(rows.next()); assertEquals(0, rows.getInt(1)); }
            }
        }
    }

    @Test void accumulatedUnicodeHistoryBeyondTextLimitReopensWithoutTruncation() throws Exception {
        var people = new ArrayList<ApprovalService.Person>();
        people.add(new ApprovalService.Person("alice", "Alice"));
        var actors = new ArrayList<String>();
        for (int i = 0; i < 16; i++) { String id = "reviewer-" + i; actors.add(id); people.add(new ApprovalService.Person(id, id)); }
        var directory = directory(people);
        var definition = ParallelJdbcApprovalStoreTest.definition("ALL", actors.toArray(String[]::new));
        ApprovalService.Request committed;
        String comment = "漢".repeat(1990) + "🚀";
        try (var service = new ApprovalService(new JdbcApprovalStore(dataSource, mapper, definition), directory)) {
            var request = service.submit("alice", "Large audit 🚀", "Complete history", 1, 1);
            for (String actor : actors) service.decide(actor, request.id(), "review", "APPROVE", comment);
            committed = service.list("alice").get(0);
            assertEquals("APPROVED", committed.status());
            assertTrue(mapper.writeValueAsBytes(committed).length > 65535);
            assertEquals(17, count("arc_request_event"));
        }
        try (var reopened = new ApprovalService(new JdbcApprovalStore(dataSource, mapper, ProcessDefinition.legacy("bob")), directory)) {
            assertEquals(committed, reopened.list("alice").get(0));
            assertEquals(committed, reopened.decide(actors.get(0), committed.id(), "review", "APPROVE", "ignored retry"));
            assertEquals(17, count("arc_request_event"));
        }
    }

    @Test void wrongColumnCollationAndShortTextAreRejectedBeforeInitialization() throws Exception {
        sql("ALTER TABLE arc_request MODIFY applicant_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL");
        assertThrows(IOException.class, this::open);
        assertEquals(0, count("arc_process_version"));
        sql("ALTER TABLE arc_request MODIFY applicant_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL");
        sql("ALTER TABLE arc_submission_key MODIFY submission_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL");
        assertThrows(IOException.class, this::open);
        assertEquals(0, count("arc_process_version"));
        sql("ALTER TABLE arc_submission_key MODIFY submission_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL");
        sql("ALTER TABLE arc_request MODIFY request_json TEXT NOT NULL");
        assertThrows(IOException.class, this::open);
        assertEquals(0, count("arc_process_version"));
    }

    @Test void auditInsertLockTimeoutRollsBackAnAlreadyWrittenDecision() throws Exception {
        // MySQL normally rolls back only the timed-out statement, so the adapter must roll back the earlier UPDATE.
        var timed = ServerTestSupport.withSessionStatement(dataSource, "SET SESSION innodb_lock_wait_timeout = 1");
        var gate = new ServerTestSupport.GateDataSource(timed, "INSERT INTO arc_request_event", false);
        var executor = Executors.newSingleThreadExecutor();
        try (var observer = open();
             var writer = new ApprovalService(new JdbcApprovalStore(gate, mapper, ProcessDefinition.legacy("bob")), USERS)) {
            var original = observer.submit("alice", "Leave", "Rest", 1, 1);
            gate.arm();
            try (var blocker = dataSource.getConnection()) {
                try (var statement = blocker.createStatement(); var rows = statement.executeQuery("SELECT @@GLOBAL.innodb_rollback_on_timeout")) {
                    assertTrue(rows.next());
                    assertEquals(0, rows.getInt(1), "Requires statement-only timeout rollback to test full-operation rollback");
                }
                blocker.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
                blocker.setAutoCommit(false);
                try {
                    // Lock the gap for event 1; plain snapshot reads of event 0 remain possible.
                    try (var statement = blocker.prepareStatement("SELECT event_index FROM arc_request_event WHERE request_id = ? AND event_index >= 1 FOR UPDATE")) {
                        statement.setString(1, original.id());
                        try (var rows = statement.executeQuery()) { assertFalse(rows.next()); }
                    }
                    var decision = executor.submit(() -> writer.decide("bob", original.id(), "manager", "APPROVE", "must roll back"));
                    // This boundary is reached only after the request state/revision UPDATE completed.
                    assertTrue(gate.entered.await(5, TimeUnit.SECONDS));
                    gate.release.countDown();
                    var failure = assertThrows(ExecutionException.class, () -> decision.get(10, TimeUnit.SECONDS));
                    var io = assertInstanceOf(IOException.class, failure.getCause());
                    assertEquals(1205, assertInstanceOf(SQLException.class, io.getCause()).getErrorCode());
                    assertEquals(original, observer.list("alice").get(0));
                    assertEquals(0, requestRevision());
                    assertEquals(1, count("arc_request_event"));
                } finally { blocker.rollback(); }
            }
            assertEquals("APPROVED", writer.decide("bob", original.id(), "manager", "APPROVE", "retry after timeout").status());
            assertEquals(1, requestRevision());
            assertEquals(2, count("arc_request_event"));
        } finally {
            gate.release.countDown();
            executor.shutdownNow();
            assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS));
        }
    }

    private static ActorDirectory directory(List<ApprovalService.Person> people) {
        return new ActorDirectory() {
            public Optional<ApprovalService.Person> findActive(String id) { return people.stream().filter(person -> person.id().equals(id)).findFirst(); }
            public List<ApprovalService.Person> listActive() { return List.copyOf(people); }
            public boolean canPublish(String id) { return "alice".equals(id); }
        };
    }

    private static ApprovalService.Request submission(String id, ProcessDefinition definition) {
        String now = "2026-10-04T12:00:00Z";
        return new ApprovalService.Request(id, "Leave", "Rest", 1, "alice", "bob", "PENDING", now, now,
            null, null, definition.id(), definition.version(),
            List.of(new ApprovalService.Event("alice", "SUBMIT", "", now, null)), definition, "manager");
    }
}
