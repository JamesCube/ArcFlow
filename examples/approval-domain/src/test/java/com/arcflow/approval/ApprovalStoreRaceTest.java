package com.arcflow.approval;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

/** Deterministic stale-read schedules, independent of database timing and thread scheduling. */
class ApprovalStoreRaceTest {
    @TempDir Path directory;
    private final ActorDirectoryTest.Directory users = new ActorDirectoryTest.Directory();

    private InterleavingStore store() throws IOException {
        return new InterleavingStore(new JsonApprovalStore(new ObjectMapper(), directory.resolve("state.json").toString(), ProcessDefinition.legacy("202")));
    }
    @FunctionalInterface interface Action { void run() throws IOException; }
    static final class InterleavingStore implements ApprovalStore {
        final ApprovalStore delegate;
        Action beforeCreate, beforePublish, beforeUpdate;
        InterleavingStore(ApprovalStore delegate) { this.delegate = delegate; }
        public ProcessDefinition process() throws IOException { return delegate.process(); }
        public List<ApprovalService.Request> requests() throws IOException { return delegate.requests(); }
        public ApprovalService.Request request(String id) throws IOException { return delegate.request(id); }
        public boolean create(int expected, ApprovalService.Request request) throws IOException {
            var action = beforeCreate; beforeCreate = null;
            if (action != null) action.run();
            return delegate.create(expected, request);
        }
        public boolean publish(String actor, int expected, ProcessDefinition next) throws IOException {
            var action = beforePublish; beforePublish = null;
            if (action != null) action.run();
            return delegate.publish(actor, expected, next);
        }
        public boolean update(int expected, ApprovalService.Request next) throws IOException {
            var action = beforeUpdate; beforeUpdate = null;
            if (action != null) action.run();
            return delegate.update(expected, next);
        }
        public void close() throws IOException { delegate.close(); }
    }
    private static void status(int expected, org.junit.jupiter.api.function.Executable action) {
        assertEquals(expected, assertThrows(ResponseStatusException.class, action).getStatusCode().value());
    }
    @Test void processPublicationBetweenSubmitReadAndWriteRejectsStaleSubmission() throws Exception {
        try (var store = store(); var service = new ApprovalService(store, users)) {
            store.beforeCreate = () -> service.publish("1", 1, service.process());
            status(409, () -> service.submit("101", "Leave", "Rest", 1, 1));
            assertEquals(2, service.process().version());
            assertTrue(service.list("101").isEmpty());
        }
    }
    @Test void publicationRaceCannotOverwriteTheWinningVersion() throws Exception {
        try (var store = store(); var service = new ApprovalService(store, users)) {
            store.beforePublish = () -> service.publish("1", 1, service.process());
            status(409, () -> service.publish("1", 1, service.process()));
            assertEquals(2, service.process().version());
        }
    }
    @Test void decisionRaceReloadsDurableResultWithoutDuplicatingHistoryOrReplacingComment() throws Exception {
        try (var store = store(); var service = new ApprovalService(store, users)) {
            var request = service.submit("101", "Leave", "Rest", 1, 1);
            store.beforeUpdate = () -> service.decide("202", request.id(), "manager", "APPROVE", "winner");
            var result = service.decide("202", request.id(), "manager", "APPROVE", "loser");
            assertEquals("APPROVED", result.status());
            assertEquals("winner", result.comment());
            assertEquals(2, result.history().size());
        }
    }
    @Test void conflictingDecisionRaceReturnsConflictAndKeepsWinner() throws Exception {
        try (var store = store(); var service = new ApprovalService(store, users)) {
            var request = service.submit("101", "Leave", "Rest", 1, 1);
            store.beforeUpdate = () -> service.decide("202", request.id(), "manager", "REJECT", "winner");
            status(409, () -> service.decide("202", request.id(), "manager", "APPROVE", "loser"));
            assertEquals("REJECTED", service.list("101").get(0).status());
            assertEquals(2, service.list("101").get(0).history().size());
        }
    }
    @Test void compareAndSetRetryRechecksLiveAuthorizationBeforeReturningIdempotentResult() throws Exception {
        try (var store = store(); var service = new ApprovalService(store, users)) {
            var request = service.submit("101", "Leave", "Rest", 1, 1);
            store.beforeUpdate = () -> {
                service.decide("202", request.id(), "manager", "APPROVE", "winner");
                users.active.remove("202");
            };
            status(403, () -> service.decide("202", request.id(), "manager", "APPROVE", "retry"));
            assertEquals("APPROVED", service.list("101").get(0).status());
        }
    }
    @Test void invalidDirectoryDoesNotLeakFileLock() throws Exception {
        String file = directory.resolve("state.json").toString();
        assertThrows(NullPointerException.class, () -> new ApprovalService(new ObjectMapper(), file, null, ProcessDefinition.legacy("202")));
        try (var service = new ApprovalService(new ObjectMapper(), file, users, ProcessDefinition.legacy("202"))) {
            assertEquals(1, service.process().version());
        }
    }
}
