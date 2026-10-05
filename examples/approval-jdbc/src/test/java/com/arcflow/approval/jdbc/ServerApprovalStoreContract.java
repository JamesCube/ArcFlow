package com.arcflow.approval.jdbc;

import com.arcflow.approval.ActorDirectory;
import com.arcflow.approval.ApprovalService;
import com.arcflow.approval.ProcessDefinition;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
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

}
