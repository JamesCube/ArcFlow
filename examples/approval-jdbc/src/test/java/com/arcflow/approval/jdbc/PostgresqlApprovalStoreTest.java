package com.arcflow.approval.jdbc;

import com.arcflow.approval.ActorDirectory;
import com.arcflow.approval.ApprovalService;
import com.arcflow.approval.ProcessDefinition;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.postgresql.ds.PGSimpleDataSource;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

/** Runs on a real disposable PostgreSQL database in CI; never substitutes H2 compatibility mode. */
@EnabledIfEnvironmentVariable(named = "ARCFLOW_PG_URL", matches = ".+")
class PostgresqlApprovalStoreTest {
    private PGSimpleDataSource database;
    private PGSimpleDataSource dataSource;
    private String schema;
    private static final ActorDirectory USERS = new ActorDirectory() {
        private final Map<String, ApprovalService.Person> people = Map.of(
            "alice", new ApprovalService.Person("alice", "Alice"),
            "bob", new ApprovalService.Person("bob", "Bob"),
            "carol", new ApprovalService.Person("carol", "Carol"));
        public Optional<ApprovalService.Person> findActive(String id) { return Optional.ofNullable(people.get(id)); }
        public List<ApprovalService.Person> listActive() { return List.copyOf(people.values()); }
        public boolean canPublish(String id) { return "alice".equals(id); }
    };

    private PGSimpleDataSource source() {
        var source = new PGSimpleDataSource();
        source.setURL(System.getenv("ARCFLOW_PG_URL"));
        source.setUser(System.getenv("ARCFLOW_PG_USER"));
        source.setPassword(System.getenv("ARCFLOW_PG_PASSWORD"));
        return source;
    }
    @BeforeEach void migrateFreshSchema() throws Exception {
        database = source();
        schema = "arcflow_test_" + UUID.randomUUID().toString().replace("-", "");
        try (var connection = database.getConnection(); var statement = connection.createStatement()) {
            statement.execute("CREATE SCHEMA " + schema);
        }
        dataSource = source();
        dataSource.setCurrentSchema(schema);
        try (var input = JdbcApprovalStore.class.getResourceAsStream("schema-postgresql.sql")) {
            assertNotNull(input);
            String sql = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) {
                statement.execute(sql);
            }
        }
    }
    @AfterEach void dropDisposableSchema() throws Exception {
        if (database != null && schema != null) {
            try (var connection = database.getConnection(); var statement = connection.createStatement()) {
                statement.execute("DROP SCHEMA " + schema + " CASCADE");
            }
        }
    }
    private ApprovalService open() throws IOException {
        return new ApprovalService(new JdbcApprovalStore(dataSource, new ObjectMapper(), ProcessDefinition.legacy("bob")), USERS);
    }
    private void sql(String sql) throws Exception {
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) { statement.execute(sql); }
    }
    private int count(String table) throws Exception {
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement();
             var result = statement.executeQuery("SELECT COUNT(*) FROM " + table)) {
            assertTrue(result.next()); return result.getInt(1);
        }
    }
    private static int result(Callable<?> action) throws Exception {
        try { action.call(); return 200; }
        catch (ResponseStatusException e) { return e.getStatusCode().value(); }
    }
    private static <T> List<T> race(List<Callable<T>> actions) throws Exception {
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
            sql("ALTER TABLE arc_request_event DROP CONSTRAINT fail_submission");
            var request = service.submit("alice", "Leave", "Rest", 1, 1);
            sql("ALTER TABLE arc_request_event ADD CONSTRAINT fail_decision CHECK (event_index = 0)");
            assertThrows(IOException.class, () -> service.decide("bob", request.id(), "manager", "APPROVE", "first try"));
            assertEquals(request, service.list("alice").get(0));
            assertEquals(1, count("arc_request_event"));
            sql("ALTER TABLE arc_request_event DROP CONSTRAINT fail_decision");
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
}
