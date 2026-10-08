package com.arcflow.approval;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.junit.jupiter.api.Assertions.*;
import static com.arcflow.approval.BusinessDocumentTest.status;

/** Deterministic deactivation after the store has read data, before it returns to the service. */
class IdentityReadBoundaryTest {
    @TempDir Path directory;

    @Test void legacyListDoesNotReleaseDataWhenIdentityWasRevokedDuringTheRead() throws Exception {
        var users = new ActorDirectoryTest.Directory();
        try (var store = open()) {
            var service = new ApprovalService(store, users);
            service.submit("101", "Leave", "Synthetic request", 1, 1);
            store.afterList = () -> users.active.remove("101");
            status(403, () -> service.list("101"));
            assertEquals(1, store.listReads);
            assertEquals(1, store.delegate.requests().size());
        }
    }

    @ParameterizedTest @ValueSource(strings = {"APPROVE", "REJECT"})
    void decisionDoesNotWriteWhenIdentityWasRevokedDuringTheRequestRead(String decision) throws Exception {
        var users = new ActorDirectoryTest.Directory();
        String id;
        try (var store = open()) {
            var service = new ApprovalService(store, users);
            var original = service.submit("101", "Leave", "Synthetic request", 1, 1);
            id = original.id();
            store.afterRequest = () -> users.active.remove("202");
            status(403, () -> service.decide("202", id, "manager", decision, "must not be saved"));
            assertEquals(1, store.requestReads);
            assertEquals(0, store.updates);
            assertEquals(original, store.delegate.request(id));
        }
        try (var store = open()) {
            assertEquals("PENDING", store.delegate.request(id).status());
            assertEquals(1, store.delegate.request(id).history().size());
        }
    }

    @ParameterizedTest @ValueSource(strings = {"APPROVE", "REJECT"})
    void committedDecisionReplayDoesNotReleaseDataAfterRevocationDuringRead(String decision) throws Exception {
        var users = new ActorDirectoryTest.Directory();
        try (var store = open()) {
            var service = new ApprovalService(store, users);
            var request = service.submit("101", "Leave", "Synthetic request", 1, 1);
            var committed = service.decide("202", request.id(), "manager", decision, "original comment");
            store.afterRequest = () -> users.active.remove("202");
            status(403, () -> service.decide("202", request.id(), "manager", decision, "ignored retry"));
            assertEquals(1, store.updates);
            assertEquals(committed, store.delegate.request(request.id()));
        }
    }

    @Test void activeIdentityKeepsListDecisionAndReplayBehavior() throws Exception {
        var users = new ActorDirectoryTest.Directory();
        try (var store = open()) {
            var service = new ApprovalService(store, users);
            var original = service.submit("101", "Leave", "Synthetic request", 1, 1);
            assertEquals(List.of(original), service.list("101"));
            var decided = service.decide("202", original.id(), "manager", "APPROVE", "original comment");
            assertEquals("APPROVED", decided.status());
            assertEquals(decided, service.decide("202", original.id(), "manager", "APPROVE", "ignored"));
            status(409, () -> service.decide("202", original.id(), "manager", "REJECT", "opposite"));
            assertEquals(1, store.updates);
            assertEquals(2, store.delegate.request(original.id()).history().size());
        }
    }

    @ParameterizedTest @ValueSource(strings = {"ALL", "ANY"})
    void finalCasObservationRechecksRevocationInsideTheLastRead(String mode) throws Exception {
        var fixture = new ApprovalRetryBoundaryTest.Fixture(mode);
        String vote = "ALL".equals(mode) ? "APPROVE" : "REJECT";
        fixture.interfere(vote, false);
        var store = new ReadHookStore(fixture.store);
        store.afterRequest = () -> {
            if (fixture.store.outerReads == 17) fixture.users.active.remove("member15");
        };
        var service = new ApprovalService(store, fixture.users);
        status(403, () -> service.decide("member15", fixture.request.id(), "group", vote, "loser"));
        assertEquals(17, fixture.store.outerReads);
        assertEquals(16, fixture.store.outerAttempts);
        assertEquals(0, fixture.store.outerWrites);
        assertEquals(17, fixture.store.saved.history().size());
        assertEquals("winner15", fixture.store.saved.comment());
    }

    @Test void alreadyInactiveIdentityDoesNotStartStorageReads() throws Exception {
        var users = new ActorDirectoryTest.Directory();
        try (var store = open()) {
            var service = new ApprovalService(store, users);
            var original = service.submit("101", "Leave", "Synthetic request", 1, 1);
            users.active.removeAll(List.of("101", "202"));
            status(403, () -> service.list("101"));
            status(403, () -> service.decide("202", original.id(), "manager", "APPROVE", ""));
            assertEquals(0, store.listReads);
            assertEquals(0, store.requestReads);
            assertEquals(0, store.updates);
        }
    }

    @Test void storageFailureIsNotConvertedIntoSuccessOrEmptyData() throws Exception {
        var users = new ActorDirectoryTest.Directory();
        var store = open();
        var service = new ApprovalService(store, users);
        var original = service.submit("101", "Leave", "Synthetic request", 1, 1);
        store.close();
        assertThrows(UncheckedIOException.class, () -> service.list("101"));
        assertThrows(IOException.class, () -> service.decide("202", original.id(), "manager", "APPROVE", ""));
        assertEquals(0, store.updates);
    }

    private ReadHookStore open() throws IOException {
        return new ReadHookStore(new JsonApprovalStore(new ObjectMapper(), directory.resolve("state.json").toString(),
            ProcessDefinition.legacy("202")));
    }

    static final class ReadHookStore implements ApprovalStore {
        final ApprovalStore delegate;
        Runnable afterList = () -> {}, afterRequest = () -> {};
        int listReads, requestReads, updates;
        ReadHookStore(ApprovalStore delegate) { this.delegate = delegate; }
        public ProcessDefinition process() throws IOException { return delegate.process(); }
        public List<ApprovalService.Request> requests() throws IOException {
            listReads++;
            var result = delegate.requests();
            afterList.run();
            return result;
        }
        public ApprovalService.Request request(String id) throws IOException {
            requestReads++;
            var result = delegate.request(id);
            afterRequest.run();
            return result;
        }
        public boolean publish(String actor, int expected, ProcessDefinition next) throws IOException {
            return delegate.publish(actor, expected, next);
        }
        public boolean create(int expected, ApprovalService.Request request) throws IOException {
            return delegate.create(expected, request);
        }
        public boolean update(int expected, ApprovalService.Request next) throws IOException {
            updates++;
            return delegate.update(expected, next);
        }
        public void close() throws IOException { delegate.close(); }
    }
}
