package com.arcflow.approval.graph;

import com.arcflow.approval.BusinessDocument;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class JsonGraphApprovalStoreTest {
    @TempDir Path directory;
    final ObjectMapper mapper = new ObjectMapper();
    Path file() { return directory.resolve("approval.graph.json"); }
    JsonGraphApprovalStore open() throws IOException { return new JsonGraphApprovalStore(mapper, file().toString(), definition()); }
    static final String AT = "2026-10-11T07:00:00Z";
    static GraphDefinition definition() {
        return new GraphDefinition(5, "graph-payment", 1, "Parallel payment", List.of(
            node("start", "start", List.of(), null), node("fork", "parallelFork", List.of(), "join"),
            node("left", "approval", List.of("bob"), null), node("right", "approval", List.of("bob"), null),
            node("join", "parallelJoin", List.of(), "fork"), node("final", "approval", List.of("carol"), null), node("end", "end", List.of(), null)),
            List.of(edge("s", "start", "fork"), edge("l", "fork", "left"), edge("r", "fork", "right"),
                edge("lj", "left", "join"), edge("rj", "right", "join"), edge("jf", "join", "final"), edge("fe", "final", "end")));
    }
    static GraphDefinition.Node node(String id, String type, List<String> actors, String pair) {
        return new GraphDefinition.Node(id, type, id, actors, actors.isEmpty() ? null : "ALL", pair);
    }
    static GraphDefinition.Edge edge(String id, String source, String target) { return new GraphDefinition.Edge(id, source, target, id, null, false); }
    static BusinessDocument.PaymentRequest payment() {
        return new BusinessDocument.PaymentRequest(1,"PAY-GRAPH-TEST","Payment review","Synthetic fixture","SUPPLIER-TEST","CNY","2099-01-15",List.of(
            new BusinessDocument.PaymentLine("line-1","INV-TEST-01","Components",new BigDecimal("10000.00"),BigDecimal.ZERO,new BigDecimal("9000.00"),BigDecimal.ZERO,"")));
    }
    static GraphInstance initial() { return GraphEngine.start("request-1", "submit-1", "alice", definition(), payment(), AT); }
    static GraphInstance vote(GraphInstance before, String node, String actor, String decision, String command) {
        return GraphEngine.decide(before, before.id() + ":" + node, actor, decision, "", command, AT);
    }
    @Test void restartPreservesDraftPublicationFrozenInstanceAuditAndJoin() throws Exception {
        GraphInstance one, two;
        try (var store = open()) {
            assertEquals(14, store.snapshot().storageSchemaVersion());
            assertTrue(store.create(1, initial()));
            one = vote(initial(), "left", "bob", "APPROVE", "command-left");
            assertTrue(store.replace(one.id(), 0, one));
            assertEquals(List.of("l"), one.forks().get(0).arrivedBranchIds());
            assertFalse(one.tasks().stream().anyMatch(t -> t.nodeId().equals("final")));
            var draft = new GraphDefinition(5, definition().id(), 1, "Version two", definition().nodes(), definition().edges());
            assertTrue(store.saveDraft(0, new GraphApprovalStore.Draft(1, 1, draft)));
            assertTrue(store.publish(1, 1, draft.withVersion(2)));
        }
        try (var reopened = open()) {
            assertEquals(one, reopened.snapshot().requests().get(0));
            assertEquals(2, reopened.snapshot().definition().version());
            assertEquals(2, reopened.snapshot().draft().revision());
            assertEquals(1, one.definition().version());
            two = vote(one, "right", "bob", "APPROVE", "command-right");
            assertTrue(reopened.replace(two.id(), 1, two));
            assertEquals(1, two.events().stream().filter(e -> e.type().equals("JOIN_FIRED")).count());
            var done = vote(two, "final", "carol", "APPROVE", "command-final");
            assertTrue(reopened.replace(done.id(), 2, done));
        }
        try (var reopened = open()) { assertEquals("APPROVED", reopened.snapshot().requests().get(0).status()); }
    }
    @Test void isolatedFilenameOwnershipAndClosedOperationsAreEnforced() throws Exception {
        Path old = directory.resolve("approval.json"); Files.writeString(old, "legacy untouched");
        assertThrows(IllegalArgumentException.class, () -> new JsonGraphApprovalStore(mapper, old.toString(), definition()));
        try (var store = open()) { assertThrows(IOException.class, this::open); assertEquals("legacy untouched", Files.readString(old)); }
        var reopened = open(); reopened.close(); reopened.close(); assertThrows(IOException.class, reopened::snapshot);
    }
    @Test void draftMayBeIncompleteButPublicationCasAndExactContentAreRequired() throws Exception {
        try (var store = open()) {
            var partial = new GraphDefinition(5, definition().id(), 1, "Editing", List.of(), List.of());
            assertTrue(store.saveDraft(0, new GraphApprovalStore.Draft(1, 1, partial)));
            assertFalse(store.saveDraft(0, new GraphApprovalStore.Draft(1, 1, definition())));
            assertThrows(IllegalArgumentException.class, () -> store.publish(1, 1, partial.withVersion(2)));
            assertThrows(IllegalArgumentException.class, () -> store.publish(1, 1, definition().withVersion(2)));
            assertTrue(store.saveDraft(1, new GraphApprovalStore.Draft(2, 1, definition())));
            assertFalse(store.publish(1, 1, definition().withVersion(2)));
            assertTrue(store.publish(1, 2, definition().withVersion(2)));
            assertFalse(store.create(1, initial()));
        }
    }
    @Test void duplicateIdentityKeyAndStaleCasNeverAppendExtraCommands() throws Exception {
        try (var store = open()) {
            assertTrue(store.create(1, initial())); assertFalse(store.create(1, initial()));
            var sameKey = GraphEngine.start("request-2", "submit-1", "alice", definition(), payment(), AT);
            assertFalse(store.create(1, sameKey));
            var otherActor = GraphEngine.start("request-3", "submit-1", "dave", definition(), payment(), AT);
            assertTrue(store.create(1, otherActor));
            var next = vote(initial(), "left", "bob", "APPROVE", "command-1"); assertTrue(store.replace(next.id(), 0, next));
            assertFalse(store.replace(next.id(), 0, next));
            var opposite = vote(initial(), "left", "bob", "REJECT", "command-2"); assertFalse(store.replace(opposite.id(), 0, opposite));
            assertEquals(next, store.snapshot().requests().get(0));
        }
    }
    @Test void concurrentBranchCompletionRereadsRequestWideCasAndFiresJoinOnce() throws Exception {
        try (var store = open()) {
            store.create(1, initial()); var gate = new CountDownLatch(1); var pool = Executors.newFixedThreadPool(2);
            try {
                var left = pool.submit(() -> { gate.await(); decideRetry(store, "left"); return null; });
                var right = pool.submit(() -> { gate.await(); decideRetry(store, "right"); return null; });
                gate.countDown(); left.get(10, TimeUnit.SECONDS); right.get(10, TimeUnit.SECONDS);
            } finally { pool.shutdownNow(); }
            var result = store.snapshot().requests().get(0);
            assertEquals(2, result.commandRevision()); assertEquals(1, result.events().stream().filter(e -> e.type().equals("JOIN_FIRED")).count());
            assertEquals(1, result.tasks().stream().filter(t -> t.nodeId().equals("final")).count());
        }
    }
    static void decideRetry(GraphApprovalStore store, String branch) throws IOException {
        while (true) { var before = store.snapshot().requests().get(0); var next = vote(before, branch, "bob", "APPROVE", "cmd-" + branch); if (store.replace(before.id(), before.commandRevision(), next)) return; }
    }
    @Test void rejectionCancelsAllOtherActiveTasksAcrossRestart() throws Exception {
        try (var store = open()) { store.create(1, initial()); var next = vote(initial(), "left", "bob", "REJECT", "reject"); store.replace(next.id(), 0, next); }
        try (var store = open()) {
            var result = store.snapshot().requests().get(0); assertEquals("REJECTED", result.status());
            assertTrue(result.tasks().stream().noneMatch(t -> t.status().equals("ACTIVE")));
            assertEquals("CANCELLED", result.tasks().stream().filter(t -> t.nodeId().equals("right")).findFirst().orElseThrow().status());
        }
    }
    @Test void unknownLegacyMalformedOrReplayCorruptSnapshotFailsWithoutRewriting() throws Exception {
        try (var store = open()) { store.create(1, initial()); }
        String good = Files.readString(file());
        var mutations = new ArrayList<String>();
        for (int version : List.of(1, 13, 15, 999)) mutations.add(good.replace("\"storageSchemaVersion\" : 14", "\"storageSchemaVersion\" : " + version));
        mutations.add(good.replace("\"storageSchemaVersion\" : 14", "\"storageSchemaVersion\" : 14.0"));
        mutations.add(good.replace("\"storageSchemaVersion\" : 14", "\"schemaVersion\" : 14"));
        mutations.add(good + " {}"); mutations.add(good.substring(0, good.length() / 2));
        ObjectNode unknown = (ObjectNode)mapper.readTree(good); unknown.put("extra", 1); mutations.add(unknown.toString());
        ObjectNode missing = (ObjectNode)mapper.readTree(good); ((ObjectNode)missing.path("definition").path("nodes").get(0)).remove("pairId"); mutations.add(missing.toString());
        ObjectNode corrupt = (ObjectNode)mapper.readTree(good); ((ObjectNode)corrupt.path("requests").get(0).path("tasks").get(0)).put("status", "COMPLETED"); mutations.add(corrupt.toString());
        for (String bad : mutations) { Files.writeString(file(), bad); assertThrows(IOException.class, this::open); assertEquals(bad, Files.readString(file())); }
        Files.writeString(file(), good); try (var store = open()) { assertEquals(initial(), store.snapshot().requests().get(0)); }
    }
    @Test void replayableInstanceCannotClaimAConflictingPublishedDefinition() throws Exception {
        try (var store = open()) { store.create(1, initial()); }
        var alteredNodes = definition().nodes().stream().map(n -> n.id().equals("left")
            ? new GraphDefinition.Node(n.id(), n.type(), n.name(), List.of("dave"), n.completionMode(), n.pairId()) : n).toList();
        var altered = new GraphDefinition(5, definition().id(), 1, definition().name(), alteredNodes, definition().edges());
        var internallyValid = GraphEngine.start("request-1", "submit-1", "alice", altered, payment(), AT);
        GraphEngine.validateInstance(internallyValid);
        ObjectNode snapshot = (ObjectNode)mapper.readTree(Files.readString(file()));
        ((com.fasterxml.jackson.databind.node.ArrayNode)snapshot.path("requests")).set(0, mapper.valueToTree(internallyValid));
        String corrupt = snapshot.toString(); Files.writeString(file(), corrupt);
        assertThrows(IOException.class, this::open); assertEquals(corrupt, Files.readString(file()));
    }
    @Test void legacyReaderRejectsWrapper14WithoutTouchingTheGraphFile() throws Exception {
        try (var store = open()) { store.create(1, initial()); }
        String original = Files.readString(file());
        assertThrows(IOException.class, () -> new com.arcflow.approval.JsonApprovalStore(mapper, file().toString(), com.arcflow.approval.ProcessDefinition.legacy("bob")));
        assertEquals(original, Files.readString(file()));
        try (var store = open()) { assertEquals(initial(), store.snapshot().requests().get(0)); }
    }
    @Test void configuredNonNullMapperStillWritesRequiredNullableProperties() throws Exception {
        var customized = new ObjectMapper().setSerializationInclusion(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL);
        try (var store = new JsonGraphApprovalStore(customized, file().toString(), definition())) { store.create(1, initial()); }
        var root = mapper.readTree(Files.readString(file()));
        assertTrue(root.path("definition").path("nodes").get(0).has("pairId"));
        try (var store = open()) { assertEquals(initial(), store.snapshot().requests().get(0)); }
    }
    @Test void invalidWriteKeepsDurableBytesAndMemoryUnchanged() throws Exception {
        try (var store = open()) {
            store.create(1, initial()); String bytes = Files.readString(file()); var before = store.snapshot();
            var valid = vote(initial(), "left", "bob", "APPROVE", "c");
            var corrupt = new GraphInstance(valid.id(), valid.submissionKey(), valid.applicantId(), "APPROVED", valid.createdAt(), valid.updatedAt(), valid.commandRevision(), valid.definition(), valid.business(), valid.tasks(), valid.forks(), valid.routes(), valid.events(), valid.commands());
            assertThrows(IllegalArgumentException.class, () -> store.replace(valid.id(), 0, corrupt));
            assertEquals(bytes, Files.readString(file())); assertEquals(before, store.snapshot());
        }
    }
}
