package com.arcflow.approval;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Path;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

class InboxQueryTest {
    @TempDir Path directory;
    final ObjectMapper mapper = new ObjectMapper();
    final ActorDirectoryTest.Directory users = new ActorDirectoryTest.Directory();
    InboxQueryTest() { users.active.addAll(List.of("303", "404", "505", "Bob", "bob", "bob ", "bób")); }
    ApprovalService open(ProcessDefinition definition) throws IOException {
        return new ApprovalService(mapper, directory.resolve("state.json").toString(), users, definition);
    }
    ApprovalService.InboxPage page(ApprovalService service, String actor, String box) throws IOException {
        return service.inbox(actor, box, null, null, null, null);
    }
    static void status(int code, org.junit.jupiter.api.function.Executable action) {
        assertEquals(code, assertThrows(ResponseStatusException.class, action).getStatusCode().value());
    }

    @Test void fullAllMembershipActualVotesAndRepeatedActorCanBePendingAndHandled() throws Exception {
        try (var service = open(ParallelApprovalTest.definition("ALL", true))) {
            var request = service.submit("101", "Leave", "Rest", 1, 1);
            for (String actor : List.of("202", "303", "404")) assertEquals(List.of(request), page(service, actor, "PENDING").items());
            for (String actor : List.of("101", "505", "1")) assertTrue(page(service, actor, "PENDING").items().isEmpty());
            assertEquals(List.of(request), service.list("101")); // applicant visibility remains legacy-only
            var partial = service.decide("303", request.id(), "review", "APPROVE", "done");
            assertTrue(page(service, "303", "PENDING").items().isEmpty());
            assertEquals(List.of(partial), page(service, "303", "HANDLED").items());
            assertEquals("PENDING", page(service, "303", "HANDLED").items().get(0).status());
            service.decide("404", request.id(), "review", "APPROVE", "done");
            var advanced = service.decide("202", request.id(), "review", "APPROVE", "done");
            assertEquals("final", advanced.currentStepId());
            for (String box : List.of("PENDING", "HANDLED")) assertEquals(List.of(advanced), page(service, "202", box).items());
            assertEquals(3, InboxQuery.members(advanced).size());
            var terminal = service.decide("202", request.id(), "final", "APPROVE", "done");
            assertTrue(page(service, "202", "PENDING").items().isEmpty());
            assertEquals(List.of(terminal), service.inbox("202", "HANDLED", 1, "APPROVED", 1, null).items());
            assertTrue(service.inbox("202", "HANDLED", 1, "REJECTED", 1, null).items().isEmpty());
            assertTrue(service.inbox("202", "HANDLED", 1, null, 2, null).items().isEmpty());
        }
        try (var reopened = open(ProcessDefinition.legacy("505"))) {
            assertEquals(1, page(reopened, "202", "HANDLED").items().size());
            assertTrue(page(reopened, "202", "PENDING").items().isEmpty());
        }
    }

    @Test void anyApprovalAndAllRejectionNeverInventHandledVotesForRemainingMembers() throws Exception {
        for (String mode : List.of("ANY", "ALL")) {
            try (var service = new ApprovalService(mapper, directory.resolve(mode + ".json").toString(), users,
                    ParallelApprovalTest.definition(mode, false))) {
                var request = service.submit("101", "Leave", "Rest", 1, 1);
                if (mode.equals("ANY")) {
                    service.decide("202", request.id(), "review", "REJECT", "no");
                    assertEquals(1, page(service, "303", "PENDING").items().size());
                    assertEquals(1, page(service, "202", "HANDLED").items().size());
                }
                service.decide("303", request.id(), "review", mode.equals("ANY") ? "APPROVE" : "REJECT", "close");
                assertTrue(page(service, "404", "PENDING").items().isEmpty());
                assertTrue(page(service, "404", "HANDLED").items().isEmpty());
                assertEquals(1, service.list("404").size()); // unvoted participant remains legacy-visible
            }
        }
    }

    @Test void futureAssigneeAndExactCaseAccentAndTrailingSpaceIdentitiesStaySeparate() throws Exception {
        var definition = new ProcessDefinition(3, "leave-approval", 1, "Exact identities", List.of(
            new ProcessDefinition.ProcessNode("start", "start", "Start", null),
            new ProcessDefinition.ProcessNode("review", "parallelApproval", "Review", null, List.of("Bob", "bob ", "bób"), "ALL"),
            new ProcessDefinition.ProcessNode("later", "approval", "Later", "bob"),
            new ProcessDefinition.ProcessNode("end", "end", "End", null)));
        try (var service = open(definition)) {
            var request = service.submit("101", "Leave", "Rest", 1, 1);
            assertTrue(page(service, "bob", "PENDING").items().isEmpty());
            for (String actor : List.of("Bob", "bob ", "bób")) assertEquals(List.of(request), page(service, actor, "PENDING").items());
            service.decide("Bob", request.id(), "review", "APPROVE", "yes");
            assertTrue(page(service, "bob", "HANDLED").items().isEmpty());
            assertTrue(page(service, "bob ", "HANDLED").items().isEmpty());
            users.active.remove("Bob");
            status(403, () -> page(service, "Bob", "HANDLED"));
            status(403, () -> page(service, "absent", "PENDING"));
        }
    }

    static ApprovalService.Request request(String id, String at, ProcessDefinition definition) {
        return new ApprovalService.Request(id, "Leave " + id, "Rest", 1, "101", "202", "PENDING", at, at,
            null, null, definition.id(), definition.version(), List.of(new ApprovalService.Event("101", "SUBMIT", "", at, null)),
            definition, "manager");
    }

    @Test void keysetOrderUsesInstantThenAsciiIdAndSurvivesMutationInsertionAndReopen() throws Exception {
        var definition = ProcessDefinition.legacy("202");
        List<String> expected = List.of("newer", "z", "a0", "a-", "a", "Z", "A", "older");
        try (var store = new JsonApprovalStore(mapper, directory.resolve("state.json").toString(), definition);
             var service = new ApprovalService(store, users)) {
            for (String id : List.of("A", "z", "Z", "a", "a-", "a0"))
                assertTrue(store.create(1, request(id, id.equals("z") ? "2026-01-01T00:00:00Z" : "2026-01-01T00:00:00.000Z", definition)));
            store.create(1, request("older", "2025-12-31T23:59:59.999999999Z", definition));
            store.create(1, request("newer", "2026-01-01T00:00:00.000000001Z", definition));
            var seen = new ArrayList<String>();
            var first = service.inbox("202", "PENDING", 2, null, null, null);
            seen.addAll(first.items().stream().map(ApprovalService.Request::id).toList());
            service.decide("202", "newer", "manager", "APPROVE", "does not move older rows");
            store.create(1, request("inserted", "2026-01-02T00:00:00Z", definition));
            String cursor = first.nextCursor();
            while (cursor != null) {
                var next = service.inbox("202", "PENDING", 2, null, null, cursor);
                seen.addAll(next.items().stream().map(ApprovalService.Request::id).toList()); cursor = next.nextCursor();
            }
            assertEquals(expected, seen);
            assertEquals(expected.size(), new HashSet<>(seen).size());
        }
        try (var reopened = open(definition)) {
            assertEquals("inserted", page(reopened, "202", "PENDING").items().get(0).id());
            assertEquals("newer", page(reopened, "202", "HANDLED").items().get(0).id());
        }
    }

    @Test void cursorAndQueryValidationRejectsMalformedOrForeignScopeAndAllowsPageSizeChange() throws Exception {
        try (var service = open(ParallelApprovalTest.definition("ALL", false))) {
            service.submit("101", "First", "Rest", 1, 1); service.submit("101", "Second", "Rest", 1, 1);
            String cursor = service.inbox("202", "PENDING", 1, null, null, null).nextCursor();
            assertNotNull(cursor);
            assertEquals(1, service.inbox("202", "PENDING", 100, null, null, cursor).items().size());
            status(400, () -> service.inbox("303", "PENDING", 1, null, null, cursor));
            status(400, () -> service.inbox("202", "HANDLED", 1, null, null, cursor));
            status(400, () -> service.inbox("202", "PENDING", 1, "PENDING", null, cursor));
            status(400, () -> service.inbox("202", "PENDING", 1, null, 1, cursor));
            for (String bad : List.of("", "a", "!", "A".repeat(1025), cursor + "=", cursor + "AAAA"))
                status(400, () -> service.inbox("202", "PENDING", 1, null, null, bad));
            for (int bad : List.of(-1, 0, 101, Integer.MAX_VALUE))
                status(400, () -> service.inbox("202", "PENDING", bad, null, null, null));
            for (String bad : List.of("", "pending", "ALL", "VISIBLE"))
                status(400, () -> service.inbox("202", bad, 1, null, null, null));
            status(400, () -> service.inbox("202", null, 1, "ANY", null, null));
            status(400, () -> service.inbox("202", null, 1, null, 0, null));
            for (var bad : List.of(Map.of("actor", List.of("303")), Map.of("limit", List.of("1", "2")),
                    Map.of("limit", List.of(" 1")), Map.of("limit", List.of("1.0")), Map.of("limit", List.of("9999999999"))))
                status(400, () -> service.inbox("202", bad));
        }
    }

    @Test void serviceFailsClosedOnForeignDuplicateUnsortedOrOversizedStorePagesWithoutCallingLegacyList() throws Exception {
        var definition = ProcessDefinition.legacy("202");
        var first = request("new", "2026-01-02T00:00:00Z", definition);
        var second = request("old", "2026-01-01T00:00:00Z", definition);
        try (var store = new JsonApprovalStore(mapper, directory.resolve("state.json").toString(), definition)) {
            var wrapper = new TestStore(store) {
                @Override public List<ApprovalService.Request> requests() { throw new AssertionError("Legacy full list must not be used"); }
                @Override public List<ApprovalService.Request> inbox(InboxQuery query) { return List.of(first, second); }
            };
            var service = new ApprovalService(wrapper, users);
            assertEquals(List.of(first), service.inbox("202", "PENDING", 1, null, null, null).items());
            assertThrows(IOException.class, () -> service.inbox("505", "PENDING", 1, null, null, null));
            assertThrows(IOException.class, () -> service.inbox("202", "HANDLED", 1, null, null, null));
            for (var rows : List.of(List.of(first, first), List.of(second, first), List.of(first, second, second),
                    List.of(first, request("new", "2026-01-01T00:00:00Z", definition)))) {
                var invalid = new ApprovalService(new TestStore(store) {
                    @Override public List<ApprovalService.Request> inbox(InboxQuery query) { return rows; }
                }, users);
                assertThrows(IOException.class, () -> invalid.inbox("202", "PENDING", 1, null, null, null));
            }
            var revoked = new ApprovalService(new TestStore(store) {
                @Override public List<ApprovalService.Request> inbox(InboxQuery query) { users.active.remove("202"); return List.of(first); }
            }, users);
            status(403, () -> revoked.inbox("202", "PENDING", 1, null, null, null));
        }
    }

    @Test void typedBusinessIndexesRemainExactAndDurableAfterKeyReplayPublicationAndDecision() throws Exception {
        var definition = new ProcessDefinition(2, "procurement-approval", 1, "Purchases", ProcessDefinition.legacy("202").nodes());
        var document = new BusinessDocument.Procurement("PO:inbox", "Equipment", "New laptop", "Laptop", 3,
            new java.math.BigDecimal("1299.95"), "USD");
        ApprovalService.Request approved;
        try (var service = open(definition)) {
            var request = service.submitDocument("101", document, 1, "typed-inbox");
            assertEquals(List.of(request), page(service, "202", "PENDING").items());
            service.publish("1", 1, new ProcessDefinition(2, definition.id(), 1, "Purchases",
                ProcessDefinition.legacy("303").nodes()));
            approved = service.decide("202", request.id(), "manager", "APPROVE", "Checked");
            assertEquals(approved, service.submitDocument("101", document, 1, "typed-inbox"));
            assertEquals(document, approved.business());
            assertTrue(page(service, "303", "PENDING").items().isEmpty());
            assertTrue(page(service, "202", "PENDING").items().isEmpty());
            assertEquals(List.of(approved), page(service, "202", "HANDLED").items());
        }
        try (var service = open(definition)) {
            assertEquals(List.of(approved), page(service, "202", "HANDLED").items());
            assertEquals(approved, service.submitDocument("101", document, 1, "typed-inbox"));
        }
    }

    static class TestStore implements ApprovalStore {
        final ApprovalStore delegate;
        TestStore(ApprovalStore delegate) { this.delegate = delegate; }
        public ProcessDefinition process() throws IOException { return delegate.process(); }
        public List<ApprovalService.Request> requests() throws IOException { return delegate.requests(); }
        public ApprovalService.Request request(String id) throws IOException { return delegate.request(id); }
        public boolean publish(String actor, int expected, ProcessDefinition next) throws IOException { return delegate.publish(actor, expected, next); }
        public boolean create(int expected, ApprovalService.Request request) throws IOException { return delegate.create(expected, request); }
        public boolean update(int expected, ApprovalService.Request next) throws IOException { return delegate.update(expected, next); }
        public void close() throws IOException { delegate.close(); }
    }

    @Test void unsupportedAndClosedStoresDoNotReturnFalseEmptySuccess() throws Exception {
        var store = new JsonApprovalStore(mapper, directory.resolve("state.json").toString(), ProcessDefinition.legacy("202"));
        var unsupported = new ApprovalService(new TestStore(store), users);
        assertThrows(IOException.class, () -> page(unsupported, "202", "PENDING"));
        var service = new ApprovalService(store, users);
        store.close();
        assertThrows(IOException.class, () -> page(service, "202", "PENDING"));
    }
}
