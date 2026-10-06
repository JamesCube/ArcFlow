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
