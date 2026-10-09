package com.arcflow.approval.jdbc;

import com.arcflow.approval.ActorDirectory;
import com.arcflow.approval.ApprovalService;
import com.arcflow.approval.ApprovalService.Event;
import com.arcflow.approval.ApprovalService.Request;
import com.arcflow.approval.BusinessDocument;
import com.arcflow.approval.InboxQuery;
import com.arcflow.approval.InboxQuery.Bucket;
import com.arcflow.approval.ProcessDefinition;
import com.arcflow.approval.ProcessDefinition.ProcessNode;
import com.arcflow.approval.QuoteDiscountCase;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Inherited unchanged by actual H2, PostgreSQL and MySQL server suites. */
abstract class MemberInboxStoreContract extends ConditionalRoutingStoreContract {
    private JdbcApprovalStore store() throws IOException {
        return new JdbcApprovalStore(dataSource, new ObjectMapper(), ProcessDefinition.legacy("bob"));
    }
    private static InboxQuery query(String actor, Bucket bucket, int limit) {
        return new InboxQuery(actor, bucket, null, null, limit, null);
    }
    private static Request candidate(String id, String created, ProcessDefinition definition) {
        var first = definition.approvals().get(0);
        return new Request(id, "Leave", "Rest", 1, "alice", first.participants().get(0), "PENDING", created, created,
            null, null, definition.id(), definition.version(), List.of(new Event("alice", "SUBMIT", "", created, null)), definition, first.id());
    }
    private static ProcessDefinition repeatedActorDefinition() {
        return new ProcessDefinition(2, "leave-approval", 1, "Repeated participants", List.of(
            new ProcessNode("start", "start", "Start", null),
            new ProcessNode("first", "approval", "First", "bob"),
            new ProcessNode("second", "approval", "Second", "bob"),
            new ProcessNode("third", "approval", "Third", "carol"),
            new ProcessNode("end", "end", "End", null)));
    }
    private static List<String> ids(List<Request> requests) { return requests.stream().map(Request::id).toList(); }

    @Test void completeMembershipIncludesFutureActorsAndRepeatedActorCanBePendingAndHandled() throws Exception {
        try (var indexed = new JdbcApprovalStore(dataSource, new ObjectMapper(), repeatedActorDefinition());
             var service = new ApprovalService(indexed, USERS)) {
            Request request = service.submit("alice", "Leave", "Rest", 1, 1);
            assertEquals(2, count("arc_request_member"));
            assertEquals(List.of(), indexed.inbox(query("carol", Bucket.PENDING, 5)));
            assertEquals(List.of(), indexed.inbox(query("alice", Bucket.PENDING, 5)));
            request = service.decide("bob", request.id(), "first", "APPROVE", "first vote");
            assertEquals(List.of(request), indexed.inbox(query("bob", Bucket.PENDING, 5)));
            assertEquals(List.of(request), indexed.inbox(query("bob", Bucket.HANDLED, 5)));
            request = service.decide("bob", request.id(), "second", "APPROVE", "second vote");
            assertEquals(List.of(), indexed.inbox(query("bob", Bucket.PENDING, 5)));
            assertEquals(List.of(request), indexed.inbox(query("bob", Bucket.HANDLED, 5)));
            assertEquals(List.of(request), indexed.inbox(query("carol", Bucket.PENDING, 5)));
        }
    }

    @Test void allPartialVoteLeavesOnlyUnvotedActorsPendingAndVoterHandled() throws Exception {
        try (var service = openParallel("ALL"); var indexed = store()) {
            Request request = service.submit("alice", "Leave", "Rest", 1, 1);
            request = service.decide("bob", request.id(), "review", "APPROVE", "yes");
            assertEquals(List.of(), indexed.inbox(query("bob", Bucket.PENDING, 5)));
            assertEquals(List.of(request), indexed.inbox(query("bob", Bucket.HANDLED, 5)));
            assertEquals(List.of(request), indexed.inbox(query("carol", Bucket.PENDING, 5)));
            assertEquals(List.of(), indexed.inbox(query("carol", Bucket.HANDLED, 5)));
        }
    }

    @Test void anyClosingVoteNeverGivesHandledMembershipToNonvoters() throws Exception {
        try (var service = openParallel("ANY"); var indexed = store()) {
            Request request = service.submit("alice", "Leave", "Rest", 1, 1);
            request = service.decide("bob", request.id(), "review", "APPROVE", "yes");
            assertEquals(List.of(request), indexed.inbox(query("bob", Bucket.HANDLED, 5)));
            assertEquals(List.of(), indexed.inbox(query("carol", Bucket.PENDING, 5)));
            assertEquals(List.of(), indexed.inbox(query("carol", Bucket.HANDLED, 5)));
            assertEquals(2, count("arc_request_member"));
        }
    }

    @Test void concurrentAllDecisionsCommitMatchingMemberProjections() throws Exception { concurrentProjection("ALL", "APPROVE"); }
    @Test void concurrentAnyDecisionsCommitMatchingMemberProjections() throws Exception { concurrentProjection("ANY", "REJECT"); }
    private void concurrentProjection(String mode, String action) throws Exception {
        try (var first = openParallel(mode); var second = openParallel(mode); var indexed = store()) {
            Request request = first.submit("alice", "Leave", "Rest", 1, 1);
            race(List.of(() -> first.decide("bob", request.id(), "review", action, "vote"),
                () -> second.decide("carol", request.id(), "review", action, "vote")));
            assertEquals(List.of(), indexed.inbox(query("bob", Bucket.PENDING, 5)));
            assertEquals(List.of(), indexed.inbox(query("carol", Bucket.PENDING, 5)));
            Request committed = indexed.request(request.id());
            assertEquals(List.of(committed), indexed.inbox(query("bob", Bucket.HANDLED, 5)));
            assertEquals(List.of(committed), indexed.inbox(query("carol", Bucket.HANDLED, 5)));
        }
    }

    @Test void cursorOrdersInstantNumericallyAndAsciiIdsExactlyAcrossEqualTimestamps() throws Exception {
        try (var indexed = store()) {
            var definition = indexed.process();
            for (String id : List.of("a", "Z", "A-", "A_", "a0"))
                assertTrue(indexed.create(1, candidate(id, id.equals("Z") ? "2026-10-07T12:00:00.100Z" : "2026-10-07T12:00:00.1Z", definition)));
            assertTrue(indexed.create(1, candidate("older", "2026-10-07T12:00:00.099999999Z", definition)));
            assertTrue(indexed.create(1, candidate("newer", "2026-10-07T12:00:00.100000001Z", definition)));
            var first = indexed.inbox(query("bob", Bucket.PENDING, 2));
            assertEquals(List.of("newer", "a0", "a"), ids(first));
            var next = new InboxQuery("bob", Bucket.PENDING, null, null, 2, InboxQuery.position(first.get(1)));
            assertEquals(List.of("a", "Z", "A_"), ids(indexed.inbox(next)));
            var all = indexed.inbox(query("bob", Bucket.PENDING, 100));
            assertEquals(List.of("newer", "a0", "a", "Z", "A_", "A-", "older"), ids(all));
        }
    }

    @Test void optionalStatusAndVersionFiltersKeepPinnedMembershipAfterPublication() throws Exception {
        try (var service = open(); var indexed = store()) {
            Request old = service.submit("alice", "Old", "Rest", 1, 1);
            old = service.decide("bob", old.id(), "manager", "APPROVE", "yes");
            service.publish("alice", 1, ProcessDefinition.legacy("carol"));
            Request recent = service.submit("alice", "Recent", "Rest", 1, 2);
            assertEquals(List.of(old), indexed.inbox(new InboxQuery("bob", Bucket.HANDLED, "APPROVED", 1, 10, null)));
            assertEquals(List.of(), indexed.inbox(new InboxQuery("bob", Bucket.HANDLED, "APPROVED", 2, 10, null)));
            assertEquals(List.of(recent), indexed.inbox(new InboxQuery("carol", Bucket.PENDING, "PENDING", 2, 10, null)));
            assertEquals(List.of(), indexed.inbox(query("carol", Bucket.HANDLED, 10)));
        }
    }

    @Test void actorKeysPreserveCaseAccentsTrailingSpacesAndSupplementaryUnicode() throws Exception {
        List<String> actors = List.of("Bob", "bob", "bób", "bob ", "b😀b");
        var definition = new ProcessDefinition(3, "leave-approval", 1, "Exact actors", List.of(
            new ProcessNode("start", "start", "Start", null),
            new ProcessNode("review", "parallelApproval", "Review", null, actors, "ALL"),
            new ProcessNode("end", "end", "End", null)));
        ActorDirectory directory = new ActorDirectory() {
            public Optional<ApprovalService.Person> findActive(String id) {
                return id.equals("alice") || actors.contains(id) ? Optional.of(new ApprovalService.Person(id, id)) : Optional.empty();
            }
            public List<ApprovalService.Person> listActive() { return List.of(); }
            public boolean canPublish(String id) { return false; }
        };
        try (var indexed = new JdbcApprovalStore(dataSource, new ObjectMapper(), definition);
             var service = new ApprovalService(indexed, directory)) {
            Request request = service.submit("alice", "Leave", "Rest", 1, 1);
            request = service.decide("Bob", request.id(), "review", "APPROVE", "one exact vote");
            assertEquals(List.of(), indexed.inbox(query("Bob", Bucket.PENDING, 10)));
            assertEquals(List.of(request), indexed.inbox(query("Bob", Bucket.HANDLED, 10)));
            for (String actor : actors.subList(1, actors.size())) {
                assertEquals(List.of(request), indexed.inbox(query(actor, Bucket.PENDING, 10)));
                assertEquals(List.of(), indexed.inbox(query(actor, Bucket.HANDLED, 10)));
            }
            assertEquals(List.of(), indexed.inbox(query("BOB", Bucket.PENDING, 10)));
        }
    }

    @Test void batchQueriesStayConstantAndNeverDecodeUnrelatedCorruptSnapshots() throws Exception {
        try (var indexed = store()) {
            for (int i = 0; i < 12; i++) assertTrue(indexed.create(1, candidate("row" + i, "2026-10-07T12:00:00Z", indexed.process())));
            var next = new ProcessDefinition(2, "leave-approval", 2, "Other actor", ProcessDefinition.legacy("carol").nodes());
            assertTrue(indexed.publish("alice", 1, next));
            assertTrue(indexed.create(2, candidate("unrelated", "2026-10-07T13:00:00Z", next)));
        }
        sql("UPDATE arc_request SET request_json = 'not json' WHERE request_id = 'unrelated'");
        var statements = new ArrayList<String>();
        try (var indexed = new JdbcApprovalStore(countQueries(dataSource, statements), new ObjectMapper(), ProcessDefinition.legacy("bob"))) {
            statements.clear(); assertEquals(2, indexed.inbox(query("bob", Bucket.PENDING, 1)).size());
            assertEquals(6, statements.size(), statements.toString());
            statements.clear(); assertEquals(9, indexed.inbox(query("bob", Bucket.PENDING, 8)).size());
            assertEquals(6, statements.size(), statements.toString());
            assertTrue(statements.get(1).endsWith("LIMIT ?"));
            assertEquals(1, statements.stream().filter(s -> s.contains("request_json")).count());
        }
    }

    @Test void databaseLimitAlwaysCapsLookaheadAtOneHundredOneRows() throws Exception {
        try (var indexed = store()) {
            ProcessDefinition definition = indexed.process();
            for (int i = 0; i < 104; i++) assertTrue(indexed.create(1, candidate("row" + i, "2026-10-07T12:00:00Z", definition)));
            assertEquals(101, indexed.inbox(query("bob", Bucket.PENDING, 100)).size());
        }
    }

    @Test void everyReturnedProjectionFieldAndExactActorAreVerified() throws Exception {
        try (var service = open(); var indexed = store()) {
            service.submit("alice", "Leave", "Rest", 1, 1);
            for (String[] mutation : List.of(new String[]{"revision = 9", "revision = 0"},
                new String[]{"handled = TRUE", "handled = FALSE"}, new String[]{"request_status = 'APPROVED'", "request_status = 'PENDING'"},
                new String[]{"process_version = 9", "process_version = 1"}, new String[]{"created_seconds = 0", "created_seconds = %s"},
                new String[]{"created_nanos = 1", "created_nanos = %s"}, new String[]{"actor_id = 'BOB'", "actor_id = 'bob'"})) {
                Request request = indexed.requests().get(0);
                var position = InboxQuery.position(request);
                String restore = mutation[1];
                if (restore.contains("%s")) restore = restore.formatted(restore.startsWith("created_seconds") ? position.seconds() : position.nanos());
                sql("UPDATE arc_request_member SET " + mutation[0]);
                assertThrows(IOException.class, () -> indexed.inbox(query("bob", Bucket.PENDING, 10)), mutation[0]);
                sql("UPDATE arc_request_member SET " + restore);
            }
        }
    }

    @Test void missingMemberOnSelectedRequestFailsClosed() throws Exception {
        try (var service = openParallel("ALL"); var indexed = store()) {
            service.submit("alice", "Leave", "Rest", 1, 1);
            sql("DELETE FROM arc_request_member WHERE actor_id = 'carol'");
            assertThrows(IOException.class, () -> indexed.inbox(query("bob", Bucket.PENDING, 10)));
        }
    }

    @Test void changedBinaryRequestSortKeyFailsClosed() throws Exception {
        try (var service = openParallel("ALL"); var indexed = store()) {
            service.submit("alice", "Leave", "Rest", 1, 1);
            try (var connection = dataSource.getConnection(); var statement = connection.prepareStatement(
                    "UPDATE arc_request_member SET request_sort_key = ? WHERE actor_id = 'bob'")) {
                statement.setBytes(1, "wrong".getBytes(StandardCharsets.US_ASCII)); statement.executeUpdate();
            }
            assertThrows(IOException.class, () -> indexed.inbox(query("bob", Bucket.PENDING, 10)));
        }
    }

    @Test void failedMemberInsertionRollsBackRequestAuditAndSubmissionKey() throws Exception {
        try (var service = open()) {
            sql("ALTER TABLE arc_request_member ADD CONSTRAINT refuse_member CHECK (revision > 0)");
            assertThrows(IOException.class, () -> service.submit("alice", "Leave", "Rest", 1, 1, "atomic"));
            assertEquals(0, count("arc_request")); assertEquals(0, count("arc_request_event"));
            assertEquals(0, count("arc_submission_key")); assertEquals(0, count("arc_request_member"));
            dropCheck("arc_request_member", "refuse_member");
            service.submit("alice", "Leave", "Rest", 1, 1, "atomic");
            assertEquals(1, count("arc_request_member"));
        }
    }

    @Test void failedMemberUpdateRollsBackDecisionAndAudit() throws Exception {
        try (var service = open(); var indexed = store()) {
            Request request = service.submit("alice", "Leave", "Rest", 1, 1);
            sql("ALTER TABLE arc_request_member ADD CONSTRAINT refuse_vote CHECK (revision = 0)");
            assertThrows(IOException.class, () -> service.decide("bob", request.id(), "manager", "APPROVE", "yes"));
            assertEquals(request, indexed.request(request.id()));
            assertEquals(List.of(request), indexed.inbox(query("bob", Bucket.PENDING, 10)));
            assertEquals(1, count("arc_request_event"));
            dropCheck("arc_request_member", "refuse_vote");
            service.decide("bob", request.id(), "manager", "APPROVE", "yes");
        }
    }

    @Test void inboxStateAuditAndMembershipUseOneRepeatableReadSnapshotDuringDecision() throws Exception {
        try (var service = open()) {
            Request before = service.submit("alice", "Leave", "Rest", 1, 1);
            var gate = new ServerTestSupport.GateDataSource(dataSource, "SELECT request_id, process_id, process_version, revision", false);
            try (var indexed = new JdbcApprovalStore(gate, new ObjectMapper(), ProcessDefinition.legacy("bob"))) {
                gate.arm();
                var executor = Executors.newSingleThreadExecutor();
                try {
                    var read = executor.submit(() -> indexed.inbox(query("bob", Bucket.PENDING, 10)));
                    assertTrue(gate.entered.await(10, TimeUnit.SECONDS));
                    service.decide("bob", before.id(), "manager", "APPROVE", "during inbox read");
                    gate.release.countDown();
                    assertEquals(List.of(before), read.get(20, TimeUnit.SECONDS));
                    assertEquals(List.of(), indexed.inbox(query("bob", Bucket.PENDING, 10)));
                } finally { gate.release.countDown(); executor.shutdownNow(); assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS)); }
            }
        }
    }

    @Test void explicitRevisionThreeBackfillIsBoundedResumableAndPreservesAllSourceRows() throws Exception {
        var saved = new ArrayList<Request>();
        try (var service = openParallel("ALL")) {
            for (int i = 0; i < 3; i++) {
                Request request = service.submit("alice", "Leave " + i, "Rest", 1, 1, "key-" + i);
                if (i == 0) request = service.decide("bob", request.id(), "review", "APPROVE", "partial vote");
                saved.add(request);
            }
        }
        int events = count("arc_request_event");
        migrateRevisionThree();
        assertThrows(IOException.class, this::store);
        var first = JdbcApprovalStore.backfillMembers(dataSource, new ObjectMapper(), 1);
        assertEquals(1, first.processed()); assertFalse(first.ready()); assertEquals(2, count("arc_request_member"));
        assertThrows(IOException.class, this::store);
        var second = JdbcApprovalStore.backfillMembers(dataSource, new ObjectMapper(), 1);
        assertEquals(1, second.processed()); assertFalse(second.ready()); assertNotEquals(first.lastRequestId(), second.lastRequestId());
        var third = JdbcApprovalStore.backfillMembers(dataSource, new ObjectMapper(), 1);
        assertEquals(1, third.processed()); assertTrue(third.ready());
        try (var indexed = store()) {
            for (Request request : saved) assertEquals(request, indexed.request(request.id()));
            for (int i = 0; i < 3; i++) assertEquals(saved.get(i), indexed.submission("alice", "key-" + i));
            assertEquals(2, indexed.inbox(query("bob", Bucket.PENDING, 10)).size());
            assertEquals(1, indexed.inbox(query("bob", Bucket.HANDLED, 10)).size());
        }
        assertEquals(events, count("arc_request_event")); assertEquals(3, count("arc_submission_key"));
        assertEquals(0, JdbcApprovalStore.backfillMembers(dataSource, new ObjectMapper(), 1).processed());
    }

    @Test void failedBackfillChunkKeepsCheckpointAndReadinessUnchangedThenResumes() throws Exception {
        try (var service = open()) { for (int i = 0; i < 3; i++) service.submit("alice", "Leave", "Rest", 1, 1); }
        migrateRevisionThree();
        var first = JdbcApprovalStore.backfillMembers(dataSource, new ObjectMapper(), 1);
        var inserted = new AtomicBoolean();
        DataSource failing = ServerTestSupport.failAfterStatement(dataSource, "INSERT INTO arc_request_member", inserted);
        assertThrows(IOException.class, () -> JdbcApprovalStore.backfillMembers(failing, new ObjectMapper(), 2));
        assertTrue(inserted.get(), "A real insert within the second chunk must succeed before the injected failure");
        assertEquals(1, count("arc_request_member")); assertThrows(IOException.class, this::store);
        var resumed = JdbcApprovalStore.backfillMembers(dataSource, new ObjectMapper(), 2);
        assertTrue(resumed.ready()); assertEquals(2, resumed.processed()); assertEquals(3, count("arc_request_member"));
        try (var indexed = store()) { assertEquals(3, indexed.inbox(query("bob", Bucket.PENDING, 10)).size()); }
        assertThrows(IllegalArgumentException.class, () -> JdbcApprovalStore.backfillMembers(dataSource, new ObjectMapper(), 0));
        assertThrows(IllegalArgumentException.class, () -> JdbcApprovalStore.backfillMembers(dataSource, new ObjectMapper(), 101));
    }

    @Test void corruptBackfillSnapshotFailsClosedWithoutEnablingOrInitializingStore() throws Exception {
        try (var service = open()) { service.submit("alice", "Leave", "Rest", 1, 1); }
        migrateRevisionThree();
        sql("UPDATE arc_request SET request_json = 'corrupt'");
        assertThrows(IOException.class, () -> JdbcApprovalStore.backfillMembers(dataSource, new ObjectMapper(), 100));
        assertEquals(0, count("arc_request_member")); assertEquals(1, count("arc_process_version"));
        assertThrows(IOException.class, this::store);
    }

    @Test void extraMemberOnSelectedRequestFailsClosed() throws Exception {
        try (var service = open(); var indexed = store()) {
            service.submit("alice", "Leave", "Rest", 1, 1);
            try (var connection = dataSource.getConnection(); var statement = connection.prepareStatement(
                    "INSERT INTO arc_request_member (request_id, actor_id, actor_key, pending, handled, revision, request_status, "
                    + "process_version, created_seconds, created_nanos, request_sort_key, process_id) "
                    + "SELECT request_id, ?, ?, pending, handled, revision, request_status, process_version, created_seconds, "
                    + "created_nanos, request_sort_key, process_id FROM arc_request_member")) {
                statement.setString(1, "outsider"); statement.setBytes(2, "outsider".getBytes(StandardCharsets.UTF_16BE));
                assertEquals(1, statement.executeUpdate());
            }
            assertThrows(IOException.class, () -> indexed.inbox(query("bob", Bucket.PENDING, 10)));
        }
    }

    @Test void changedBinaryActorKeyOnAnotherMemberFailsClosed() throws Exception {
        try (var service = openParallel("ALL"); var indexed = store()) {
            service.submit("alice", "Leave", "Rest", 1, 1);
            try (var connection = dataSource.getConnection(); var statement = connection.prepareStatement(
                    "UPDATE arc_request_member SET actor_key = ? WHERE actor_id = 'carol'")) {
                statement.setBytes(1, "wrong".getBytes(StandardCharsets.UTF_16BE)); statement.executeUpdate();
            }
            assertThrows(IOException.class, () -> indexed.inbox(query("bob", Bucket.PENDING, 10)));
            assertThrows(IOException.class, () -> indexed.inbox(query("wrong", Bucket.PENDING, 10)),
                "A corrupted binary actor key must not expose another actor's request");
        }
    }

    @Test void batchReadValidatesAuditAndRetainedDefinitionBeforeReturningRows() throws Exception {
        try (var service = open(); var indexed = store()) {
            Request request = service.submit("alice", "Leave", "Rest", 1, 1);
            sql("UPDATE arc_request_event SET event_json = '{}' WHERE event_index = 0");
            assertThrows(IOException.class, () -> indexed.inbox(query("bob", Bucket.PENDING, 10)));
            try (var connection = dataSource.getConnection(); var statement = connection.prepareStatement(
                    "UPDATE arc_request_event SET event_json = ? WHERE event_index = 0")) {
                statement.setString(1, new ObjectMapper().writeValueAsString(request.history().get(0))); statement.executeUpdate();
            }
            assertEquals(List.of(request), indexed.inbox(query("bob", Bucket.PENDING, 10)));
            sql("UPDATE arc_process_version SET definition_json = '{}' WHERE process_version = 1");
            assertThrows(IOException.class, () -> indexed.inbox(query("bob", Bucket.PENDING, 10)));
        }
    }

    @Test void emptyUpgradeBackfillNeverInitializesProcessAndApplicationWaitsForReady() throws Exception {
        assertEquals(0, count("arc_process_version"));
        migrateRevisionThree();
        assertThrows(IOException.class, this::store);
        assertEquals(0, count("arc_process_version"));
        var progress = JdbcApprovalStore.backfillMembers(dataSource, new ObjectMapper(), 10);
        assertEquals(0, progress.processed()); assertTrue(progress.ready()); assertNull(progress.lastRequestId());
        assertEquals(0, count("arc_process_version"));
        try (var indexed = store()) { assertEquals(List.of(), indexed.inbox(query("bob", Bucket.PENDING, 10))); }
        assertEquals(1, count("arc_process_version"));
    }

    @Test void typedProcurementInboxIsProcessScopedAndPreservesAmountsAcrossPagesDecisionsAndReopen() throws Exception {
        var definition = procurementDefinition("bob");
        var saved = new ArrayList<Request>();
        Request approved;
        try (var leaves = store(); var purchases = new JdbcApprovalStore(dataSource, new ObjectMapper(), definition);
             var leaveService = new ApprovalService(leaves, USERS); var purchaseService = new ApprovalService(purchases, USERS)) {
            var leave = leaveService.submit("alice", "Leave", "Rest", 1, 1, "leave-inbox");
            for (int i = 0; i < 3; i++) {
                var document = new com.arcflow.approval.BusinessDocument.Procurement("inbox:purchase/" + i,
                    "Purchase " + i, "Exact amount", "Equipment", 3, new java.math.BigDecimal("1299.95"), "USD");
                saved.add(purchaseService.submitDocument("alice", document, 1, "purchase-inbox-" + i));
            }
            assertEquals(List.of(leave), leaves.inbox(query("bob", Bucket.PENDING, 100)));
            var seen = new ArrayList<Request>();
            String cursor = null;
            do {
                var page = purchaseService.inbox("bob", "PENDING", 1, null, 1, cursor);
                seen.addAll(page.items()); cursor = page.nextCursor();
            } while (cursor != null);
            assertEquals(saved.stream().sorted(InboxQuery.ORDER).toList(), seen);
            purchaseService.publish("alice", 1, procurementDefinition("carol"));
            approved = purchaseService.decide("bob", saved.get(0).id(), "manager", "APPROVE", "Checked");
            assertEquals(saved.get(0).business(), approved.business());
            assertEquals(saved.get(0).definition(), approved.definition());
            assertEquals(approved, purchaseService.submitDocument("alice", saved.get(0).business(), 1, "purchase-inbox-0"));
            assertEquals(List.of(approved), purchases.inbox(query("bob", Bucket.HANDLED, 10)));
            assertEquals(List.of(), leaves.inbox(query("bob", Bucket.HANDLED, 10)));
            assertEquals(List.of(), purchases.inbox(query("carol", Bucket.PENDING, 10)));
        }
        try (var purchases = new JdbcApprovalStore(dataSource, new ObjectMapper(), definition)) {
            assertEquals(List.of(approved), purchases.inbox(query("bob", Bucket.HANDLED, 10)));
            assertEquals(2, purchases.inbox(query("bob", Bucket.PENDING, 10)).size());
            assertEquals(new java.math.BigDecimal("1299.95"),
                ((com.arcflow.approval.BusinessDocument.Procurement) purchases.request(approved.id()).business()).unitPrice());
        }
    }

    @Test void explicitBackfillRestoresMixedProcessesWithEqualVersionNumbersWithoutChangingBusinessOrKeys() throws Exception {
        Request leave;
        Request purchase;
        try (var leaves = new ApprovalService(store(), USERS);
             var purchases = new ApprovalService(new JdbcApprovalStore(dataSource, new ObjectMapper(), procurementDefinition("carol")), USERS)) {
            leave = leaves.submit("alice", "Leave", "Rest", 1, 1, "mixed-leave");
            purchase = purchases.submitDocument("alice", procurement(), 1, "mixed-purchase");
            purchase = purchases.decide("carol", purchase.id(), "manager", "APPROVE", "Checked");
        }
        int events = count("arc_request_event");
        migrateRevisionThree();
        // One chunk must validate both retained definitions despite their equal version numbers.
        var progress = JdbcApprovalStore.backfillMembers(dataSource, new ObjectMapper(), 2);
        assertEquals(2, progress.processed()); assertTrue(progress.ready());
        try (var leaves = store(); var purchases = new JdbcApprovalStore(dataSource, new ObjectMapper(), procurementDefinition("carol"))) {
            assertEquals(List.of(leave), leaves.inbox(query("bob", Bucket.PENDING, 10)));
            assertEquals(List.of(purchase), purchases.inbox(query("carol", Bucket.HANDLED, 10)));
            assertEquals(List.of(), leaves.inbox(query("carol", Bucket.HANDLED, 10)));
            assertEquals(List.of(), purchases.inbox(query("bob", Bucket.PENDING, 10)));
            assertEquals(leave, leaves.submission("alice", "mixed-leave"));
            assertEquals(purchase, purchases.submission("alice", "mixed-purchase"));
        }
        assertEquals(events, count("arc_request_event"));
        assertEquals(2, count("arc_submission_key"));
        assertEquals(2, count("arc_request_member"));
    }

    @Test void forgedMemberProcessCannotExposeAnotherProcessSnapshot() throws Exception {
        try (var leaves = store(); var purchases = new JdbcApprovalStore(dataSource, new ObjectMapper(), procurementDefinition("bob"));
             var service = new ApprovalService(purchases, USERS)) {
            var purchase = service.submitDocument("alice", procurement(), 1, "scoped-projection");
            sql("UPDATE arc_request_member SET process_id = 'leave-approval'");
            assertThrows(IOException.class, () -> leaves.inbox(query("bob", Bucket.PENDING, 10)));
            assertThrows(IOException.class, () -> purchases.request(purchase.id()));
        }
    }

    @Test void unrelatedCorruptProcessCannotBreakBoundedInboxOrConsumeItsLookahead() throws Exception {
        try (var leaves = store(); var purchases = new JdbcApprovalStore(dataSource, new ObjectMapper(), procurementDefinition("bob"));
             var leaveService = new ApprovalService(leaves, USERS); var purchaseService = new ApprovalService(purchases, USERS)) {
            var leave = leaveService.submit("alice", "Leave", "Rest", 1, 1);
            for (int i = 0; i < 3; i++) purchaseService.submitDocument("alice", procurement(), 1, "other-process-" + i);
            sql("UPDATE arc_request SET request_json = 'corrupt' WHERE process_id = 'procurement-approval'");
            assertEquals(List.of(leave), leaves.inbox(query("bob", Bucket.PENDING, 1)));
        }
    }

    private static BusinessDocument.QuoteDiscount quote() {
        return new BusinessDocument.QuoteDiscount("quote:contract/001", "Quote discount", "Synthetic equipment quote",
            "CUSTOMER-DEMO-A", 7, "Equipment set", 10, new BigDecimal("1E+3"), new BigDecimal("849.95"),
            "CNY", "2099-12-31");
    }

    private JdbcApprovalStore quoteStore() throws IOException {
        return new JdbcApprovalStore(dataSource, new ObjectMapper(), QuoteDiscountCase.definition("bob", "carol"));
    }

    @Test void quoteSnapshotAndTwoStepInboxProgressionSurvivePublicationAndReopen() throws Exception {
        Request partial;
        Request approved;
        var definition = QuoteDiscountCase.definition("bob", "carol");
        try (var indexed = quoteStore(); var service = new ApprovalService(indexed, USERS)) {
            var original = service.submitDocument("alice", quote(), 1, "quote-snapshot");
            assertEquals(quote(), original.business());
            assertEquals(definition, original.definition());
            assertEquals("quote-discount", original.processId());
            assertEquals("salesManager", original.currentStepId());
            assertEquals(List.of(original), indexed.inbox(query("bob", Bucket.PENDING, 10)));
            assertEquals(List.of(), indexed.inbox(query("carol", Bucket.PENDING, 10)));
            assertEquals(List.of(), indexed.inbox(query("bob", Bucket.HANDLED, 10)));
            assertEquals(List.of(), indexed.inbox(query("carol", Bucket.HANDLED, 10)));
            assertEquals(2, count("arc_request_member"));
            // Publication must not replace the submitted quote's retained routing or business revision.
            service.publish("alice", 1, QuoteDiscountCase.definition("carol", "bob"));
            partial = service.decide("bob", original.id(), "salesManager", "APPROVE", "Sales checked");
            assertEquals("PENDING", partial.status());
            assertEquals("finance", partial.currentStepId());
            assertEquals(quote(), partial.business());
            assertEquals(definition, partial.definition());
            assertEquals(List.of(), indexed.inbox(query("bob", Bucket.PENDING, 10)));
            assertEquals(List.of(partial), indexed.inbox(query("bob", Bucket.HANDLED, 10)));
            assertEquals(List.of(partial), indexed.inbox(query("carol", Bucket.PENDING, 10)));
            assertEquals(List.of(), indexed.inbox(query("carol", Bucket.HANDLED, 10)));
        }
        try (var indexed = quoteStore(); var service = new ApprovalService(indexed, USERS)) {
            assertEquals(2, indexed.process().version());
            assertEquals(partial, indexed.request(partial.id()));
            assertEquals(List.of(partial), indexed.inbox(query("bob", Bucket.HANDLED, 10)));
            assertEquals(List.of(partial), indexed.inbox(query("carol", Bucket.PENDING, 10)));
            approved = service.decide("carol", partial.id(), "finance", "APPROVE", "Finance checked");
            assertEquals("APPROVED", approved.status());
            assertNull(approved.currentStepId());
            assertEquals(List.of("SUBMIT", "APPROVE", "APPROVE"), approved.history().stream().map(Event::action).toList());
            assertEquals(List.of("alice", "bob", "carol"), approved.history().stream().map(Event::actorId).toList());
        }
        try (var indexed = quoteStore(); var service = new ApprovalService(indexed, USERS)) {
            assertEquals(approved, indexed.request(approved.id()));
            assertEquals(quote(), indexed.request(approved.id()).business());
            assertEquals(definition, approved.definition());
            var restored = (BusinessDocument.QuoteDiscount) indexed.request(approved.id()).business();
            assertEquals(new BigDecimal("1E+3"), restored.listUnitPrice());
            assertEquals(new BigDecimal("849.95"), restored.requestedUnitPrice());
            assertEquals(0, new BigDecimal("10000").compareTo(restored.listTotal()));
            assertEquals(new BigDecimal("8499.50"), restored.requestedTotal());
            assertEquals(new BigDecimal("1500.50"), restored.reductionTotal());
            for (String actor : List.of("bob", "carol")) {
                assertEquals(List.of(), indexed.inbox(query(actor, Bucket.PENDING, 10)));
                assertEquals(List.of(approved), indexed.inbox(query(actor, Bucket.HANDLED, 10)));
            }
            assertEquals(approved, service.submitDocument("alice", quote(), 1, "quote-snapshot"));
            assertEquals(approved, service.decide("bob", approved.id(), "salesManager", "APPROVE", "Retry"));
            assertEquals(approved, service.decide("carol", approved.id(), "finance", "APPROVE", "Retry"));
            assertEquals(1, count("arc_request")); assertEquals(3, count("arc_request_event"));
            assertEquals(1, count("arc_submission_key")); assertEquals(2, count("arc_request_member"));
        }
    }

    @Test void quoteSubmissionKeysRemainApplicantGlobalAcrossIsolatedProcesses() throws Exception {
        try (var quotes = quoteStore(); var leaves = store();
             var purchases = new JdbcApprovalStore(dataSource, new ObjectMapper(), procurementDefinition("bob"));
             var quoteService = new ApprovalService(quotes, USERS); var leaveService = new ApprovalService(leaves, USERS);
             var purchaseService = new ApprovalService(purchases, USERS)) {
            var saved = quoteService.submitDocument("alice", quote(), 1, "shared-key");
            assertEquals(409, result(() -> leaveService.submit("alice", "Leave", "Rest", 1, 1, "shared-key")));
            assertEquals(409, result(() -> purchaseService.submitDocument("alice", procurement(), 1, "shared-key")));
            assertEquals(List.of(), leaves.requests()); assertEquals(List.of(), purchases.requests());
            var leave = leaveService.submit("alice", "Leave", "Rest", 1, 1, "leave-key");
            var purchase = purchaseService.submitDocument("alice", procurement(), 1, "purchase-key");
            assertEquals(409, result(() -> quoteService.submitDocument("alice", quote(), 1, "leave-key")));
            assertEquals(409, result(() -> quoteService.submitDocument("alice", quote(), 1, "purchase-key")));
            assertEquals(List.of(saved), quotes.requests());
            assertEquals(List.of(saved), quotes.inbox(query("bob", Bucket.PENDING, 10)));
            assertEquals(List.of(leave), leaves.inbox(query("bob", Bucket.PENDING, 10)));
            assertEquals(List.of(purchase), purchases.inbox(query("bob", Bucket.PENDING, 10)));
            assertNull(leaves.request(saved.id())); assertNull(purchases.request(saved.id()));
            assertNull(quotes.request(leave.id())); assertNull(quotes.request(purchase.id()));
            assertEquals(404, result(() -> leaveService.decide("bob", saved.id(), "salesManager", "APPROVE", "Foreign")));
            assertEquals(404, result(() -> purchaseService.decide("bob", saved.id(), "salesManager", "APPROVE", "Foreign")));
            assertEquals(404, result(() -> quoteService.decide("bob", leave.id(), "manager", "APPROVE", "Foreign")));
            assertEquals(404, result(() -> quoteService.decide("bob", purchase.id(), "manager", "APPROVE", "Foreign")));
            // Global means across processes for one applicant, not a key shared by all applicants.
            var otherApplicant = leaveService.submit("carol", "Leave", "Rest", 1, 1, "shared-key");
            assertNotEquals(saved.id(), otherApplicant.id());
            assertEquals(saved, quoteService.submitDocument("alice", quote(), 1, "shared-key"));
            assertEquals(otherApplicant, leaveService.submit("carol", "Leave", "Rest", 1, 1, "shared-key"));
            assertEquals(4, count("arc_request")); assertEquals(4, count("arc_request_event"));
            assertEquals(4, count("arc_submission_key")); assertEquals(5, count("arc_request_member"));
        }
    }

    @Test void concurrentQuoteRetriesAndMixedProcessBackfillPreserveSnapshotsAndMembership() throws Exception {
        Request partial;
        Request leave;
        Request purchase;
        try (var first = new ApprovalService(quoteStore(), USERS); var second = new ApprovalService(quoteStore(), USERS);
             var leaveService = open();
             var purchaseService = new ApprovalService(new JdbcApprovalStore(dataSource, new ObjectMapper(), procurementDefinition("bob")), USERS)) {
            var retries = new ArrayList<Callable<Request>>();
            for (int i = 0; i < 12; i++) {
                var service = i % 2 == 0 ? first : second;
                retries.add(() -> service.submitDocument("alice", quote(), 1, "quote-retry"));
            }
            var results = race(retries);
            var saved = results.get(0);
            for (var replay : results) assertEquals(saved, replay);
            assertEquals(quote(), saved.business());
            assertEquals(1, count("arc_request")); assertEquals(1, count("arc_request_event"));
            assertEquals(1, count("arc_submission_key")); assertEquals(2, count("arc_request_member"));
            partial = first.decide("bob", saved.id(), "salesManager", "APPROVE", "Sales checked");
            leave = leaveService.submit("alice", "Leave", "Rest", 1, 1, "mixed-leave");
            purchase = purchaseService.submitDocument("alice", procurement(), 1, "mixed-purchase");
        }
        // Stop all writers before applying the dialect's actual revision-3 migration and bounded backfill.
        migrateRevisionThree();
        assertThrows(IOException.class, this::quoteStore);
        for (int i = 0; i < 3; i++) {
            var progress = JdbcApprovalStore.backfillMembers(dataSource, new ObjectMapper(), 1);
            assertEquals(1, progress.processed());
            assertEquals(i == 2, progress.ready());
        }
        try (var quotes = quoteStore(); var leaves = store();
             var purchases = new JdbcApprovalStore(dataSource, new ObjectMapper(), procurementDefinition("bob"))) {
            assertEquals(partial, quotes.request(partial.id()));
            assertEquals(quote(), quotes.request(partial.id()).business());
            assertEquals(List.of(partial), quotes.inbox(query("bob", Bucket.HANDLED, 10)));
            assertEquals(List.of(partial), quotes.inbox(query("carol", Bucket.PENDING, 10)));
            assertEquals(List.of(), quotes.inbox(query("bob", Bucket.PENDING, 10)));
            assertEquals(List.of(), quotes.inbox(query("carol", Bucket.HANDLED, 10)));
            assertEquals(List.of(leave), leaves.inbox(query("bob", Bucket.PENDING, 10)));
            assertEquals(List.of(purchase), purchases.inbox(query("bob", Bucket.PENDING, 10)));
            assertEquals(partial, quotes.submission("alice", "quote-retry"));
            assertEquals(leave, leaves.submission("alice", "mixed-leave"));
            assertEquals(purchase, purchases.submission("alice", "mixed-purchase"));
        }
        assertEquals(3, count("arc_request")); assertEquals(4, count("arc_request_event"));
        assertEquals(3, count("arc_submission_key")); assertEquals(4, count("arc_request_member"));
        assertEquals(0, JdbcApprovalStore.backfillMembers(dataSource, new ObjectMapper(), 1).processed());
    }

    @Test void paymentAndContractBackfillPreservesTypedSnapshotsKeysAndRepeatedActorMembership() throws Exception {
        var paymentDefinition=com.arcflow.approval.ScenarioCatalog.paymentRequest("bob","carol").initialProcess();
        var contractDefinition=com.arcflow.approval.ScenarioCatalog.contractApproval("bob","carol").initialProcess();
        Request payment,contract;
        try(var payments=new ApprovalService(new JdbcApprovalStore(dataSource,new ObjectMapper(),paymentDefinition),USERS);
            var contracts=new ApprovalService(new JdbcApprovalStore(dataSource,new ObjectMapper(),contractDefinition),USERS)) {
            var p=payments.submitDocument("alice",paymentDocument(),1,"backfill-payment");
            payment=payments.decide("bob",p.id(),"payment-check","APPROVE","Partial ALL vote");
            var c=contracts.submitDocument("alice",contractDocument(),1,"backfill-contract");
            contract=contracts.decide("bob",c.id(),"commercial-review","APPROVE","First independent stage");
        }
        var originalJson=new java.util.HashMap<String,String>();
        try(var connection=dataSource.getConnection();var statement=connection.createStatement();var rows=statement.executeQuery("SELECT request_id, request_json FROM arc_request")) {
            while(rows.next())originalJson.put(rows.getString(1),rows.getString(2));
        }
        migrateRevisionThree();
        var first=JdbcApprovalStore.backfillMembers(dataSource,new ObjectMapper(),1);assertFalse(first.ready());assertEquals(1,first.processed());
        var inserted=new AtomicBoolean();var failing=ServerTestSupport.failAfterStatement(dataSource,"INSERT INTO arc_request_member",inserted);
        assertThrows(IOException.class,()->JdbcApprovalStore.backfillMembers(failing,new ObjectMapper(),1));assertTrue(inserted.get());assertEquals(2,count("arc_request_member"));
        var resumed=JdbcApprovalStore.backfillMembers(dataSource,new ObjectMapper(),1);assertTrue(resumed.ready());assertEquals(1,resumed.processed());
        try(var payments=new JdbcApprovalStore(dataSource,new ObjectMapper(),paymentDefinition);
            var contracts=new JdbcApprovalStore(dataSource,new ObjectMapper(),contractDefinition)) {
            assertEquals(payment,payments.submission("alice","backfill-payment"));assertEquals(contract,contracts.submission("alice","backfill-contract"));
            assertEquals(List.of(payment),payments.inbox(query("carol",Bucket.PENDING,10)));assertTrue(payments.inbox(query("bob",Bucket.PENDING,10)).isEmpty());
            assertEquals(List.of(payment),payments.inbox(query("bob",Bucket.HANDLED,10)));
            assertEquals(List.of(contract),contracts.inbox(query("bob",Bucket.PENDING,10)));assertEquals(List.of(contract),contracts.inbox(query("bob",Bucket.HANDLED,10)));
            assertEquals(List.of(contract),contracts.inbox(query("carol",Bucket.PENDING,10)));assertTrue(contracts.inbox(query("carol",Bucket.HANDLED,10)).isEmpty());
        }
        try(var connection=dataSource.getConnection();var statement=connection.createStatement();var rows=statement.executeQuery("SELECT request_id, request_json FROM arc_request")) {
            while(rows.next())assertEquals(originalJson.get(rows.getString(1)),rows.getString(2));
        }
        assertEquals(2,count("arc_request"));assertEquals(2,count("arc_submission_key"));assertEquals(4,count("arc_request_event"));assertEquals(4,count("arc_request_member"));
        assertEquals(0,JdbcApprovalStore.backfillMembers(dataSource,new ObjectMapper(),1).processed());
    }

    private void migrateRevisionThree() throws Exception {
        sql("DROP TABLE arc_request_member"); sql("DROP TABLE arc_member_projection_state");
        assertThrows(IOException.class, this::store);
        String dialect;
        try (var connection = dataSource.getConnection()) {
            dialect = switch (connection.getMetaData().getDatabaseProductName()) {
                case "H2" -> "h2"; case "PostgreSQL" -> "postgresql"; case "MySQL" -> "mysql";
                default -> throw new AssertionError("Unexpected database");
            };
        }
        try (var input = JdbcApprovalStore.class.getResourceAsStream("upgrade-" + dialect + "-v2-to-v3.sql")) {
            assertNotNull(input);
            String ddl = new String(input.readAllBytes(), StandardCharsets.UTF_8).replaceAll("(?m)^\\s*--.*$", "");
            for (String statement : ddl.split(";")) if (!statement.isBlank()) sql(statement);
        }
    }

    private static DataSource countQueries(DataSource delegate, List<String> statements) {
        return (DataSource) Proxy.newProxyInstance(MemberInboxStoreContract.class.getClassLoader(), new Class<?>[]{DataSource.class}, (proxy, method, args) -> {
            try {
                Object result = method.invoke(delegate, args);
                if (!method.getName().equals("getConnection")) return result;
                Connection connection = (Connection) result;
                return Proxy.newProxyInstance(MemberInboxStoreContract.class.getClassLoader(), new Class<?>[]{Connection.class}, (p, m, a) -> {
                    try {
                        Object value = m.invoke(connection, a);
                        if (!m.getName().equals("prepareStatement")) return value;
                        String sql = (String) a[0];
                        PreparedStatement statement = (PreparedStatement) value;
                        return Proxy.newProxyInstance(MemberInboxStoreContract.class.getClassLoader(), new Class<?>[]{PreparedStatement.class}, (sp, sm, sa) -> {
                            try { if (sm.getName().equals("executeQuery")) statements.add(sql); return sm.invoke(statement, sa); }
                            catch (InvocationTargetException failure) { throw failure.getCause(); }
                        });
                    } catch (InvocationTargetException failure) { throw failure.getCause(); }
                });
            } catch (InvocationTargetException failure) { throw failure.getCause(); }
        });
    }
}
