package com.arcflow.demo;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

class ApprovalServiceTest {
    @TempDir Path dir;
    final ObjectMapper mapper = new ObjectMapper();
    Path file() { return dir.resolve("state.json"); }
    ApprovalService open() throws Exception { return new ApprovalService(mapper, file().toString()); }
    static ProcessDefinition definition(int version, String... assignees) {
        var nodes = new ArrayList<ProcessDefinition.ProcessNode>();
        nodes.add(new ProcessDefinition.ProcessNode("start", "start", "Submit", null));
        for (int i = 0; i < assignees.length; i++)
            nodes.add(new ProcessDefinition.ProcessNode("step" + (i + 1), "approval", "Review " + (i + 1), assignees[i]));
        nodes.add(new ProcessDefinition.ProcessNode("end", "end", "Done", null));
        return new ProcessDefinition(2, "leave-approval", version, "Leave approval", nodes);
    }
    static void status(int code, org.junit.jupiter.api.function.Executable fn) {
        assertEquals(code, assertThrows(ResponseStatusException.class, fn).getStatusCode().value());
    }
    @Test void authorizedRejectIsTerminalIdempotentAndSurvivesRestart() throws Exception {
        String id;
        ApprovalService.Request saved;
        try (var s = open()) {
            var r = s.submit("alice", " Leave ", " Family time ", 2, 1); id = r.id();
            assertEquals("Leave", r.title()); assertEquals("PENDING", r.status());
            assertEquals("manager", r.currentStepId()); assertNull(r.history().get(0).stepId());
            assertTrue(s.list("carol").isEmpty());
            assertEquals(1, s.list("alice").size()); assertEquals(1, s.list("bob").size());
            status(403, () -> s.decide("alice", r.id(), "manager", "APPROVE", ""));
            status(404, () -> s.decide("carol", r.id(), "manager", "APPROVE", ""));
            var rejected = s.decide("bob", id, "manager", "REJECT", "No coverage"); saved = rejected;
            assertEquals(rejected, s.decide("bob", id, "manager", "REJECT", "ignored retry"));
            assertEquals(2, rejected.history().size()); assertNull(rejected.currentStepId());
            assertThrows(UnsupportedOperationException.class, () -> rejected.history().clear());
            assertThrows(UnsupportedOperationException.class, () -> rejected.definition().nodes().clear());
            status(409, () -> s.decide("bob", id, "manager", "APPROVE", ""));
        }
        try (var restarted = open()) {
            var r = restarted.list("alice").get(0);
            assertEquals(saved, r); assertEquals("REJECTED", r.status());
            assertEquals(r, restarted.decide("bob", id, "manager", "REJECT", ""));
        }
    }
    @Test void executionIsOrderedAndVisibilityCoversAllSnapshottedAssignees() throws Exception {
        try (var s = open()) {
            var published = s.publish("alice", 1, definition(1, "bob", "carol"));
            assertEquals(2, published.version());
            var r = s.submit("alice", "Leave", "Rest", 2, 2);
            assertEquals(1, s.list("carol").size());
            status(409, () -> s.decide("carol", r.id(), "step2", "APPROVE", "early"));
            status(403, () -> s.decide("carol", r.id(), "step1", "APPROVE", "wrong"));
            status(403, () -> s.decide("bob", r.id(), "step2", "APPROVE", "wrong"));
            var first = s.decide("bob", r.id(), "step1", "APPROVE", " first ");
            assertEquals("PENDING", first.status()); assertEquals("step2", first.currentStepId());
            assertEquals("carol", first.approverId()); assertEquals("APPROVE", first.decision()); assertEquals("first", first.comment());
            var done = s.decide("carol", r.id(), "step2", "APPROVE", "second");
            assertEquals("APPROVED", done.status()); assertNull(done.currentStepId()); assertEquals("carol", done.approverId());
            assertEquals(List.of("SUBMIT", "APPROVE", "APPROVE"), done.history().stream().map(ApprovalService.Event::action).toList());
            assertEquals(done, s.decide("bob", r.id(), "step1", "APPROVE", "retry"));
            status(403, () -> s.decide("carol", r.id(), "step1", "APPROVE", "unauthorized replay"));
            status(409, () -> s.decide("bob", r.id(), "step1", "REJECT", "opposite"));
        }
    }
    @Test void repeatedApproverIsASeparateStepAndRetryCannotAdvanceIt() throws Exception {
        try (var s = open()) {
            s.publish("alice", 1, definition(1, "bob", "bob", "carol"));
            var r = s.submit("alice", "Leave", "Rest", 1, 2);
            status(409, () -> s.decide("bob", r.id(), "step2", "APPROVE", "future"));
            var first = s.decide("bob", r.id(), "step1", "APPROVE", "one");
            assertEquals(first, s.decide("bob", r.id(), "step1", "APPROVE", "retry"));
            assertEquals("step2", first.currentStepId()); assertEquals(2, first.history().size());
            var second = s.decide("bob", r.id(), "step2", "APPROVE", "two");
            assertEquals("step3", second.currentStepId()); assertEquals(3, second.history().size());
            assertEquals(second, s.decide("bob", r.id(), "step1", "APPROVE", "retry later"));
        }
    }
    @Test void rejectionStopsLaterStepsButRetainsEarlierStepReplay() throws Exception {
        try (var s = open()) {
            s.publish("alice", 1, definition(1, "bob", "carol", "bob"));
            var r = s.submit("alice", "Leave", "Rest", 1, 2);
            s.decide("bob", r.id(), "step1", "APPROVE", "ok");
            var rejected = s.decide("carol", r.id(), "step2", "REJECT", "no");
            assertEquals("REJECTED", rejected.status()); assertEquals(3, rejected.history().size());
            status(409, () -> s.decide("bob", r.id(), "step3", "APPROVE", ""));
            assertEquals(rejected, s.decide("bob", r.id(), "step1", "APPROVE", "retry"));
            assertEquals(rejected, s.decide("carol", r.id(), "step2", "REJECT", "retry"));
        }
    }
    @Test void runningSnapshotsDoNotChangeWhenPublishedProcessChangesAndRestartResumesOldSequence() throws Exception {
        String id;
        ProcessDefinition v2;
        ApprovalService.Request middle;
        try (var s = open()) {
            v2 = s.publish("alice", 1, definition(1, "bob", "carol", "bob"));
            var r = s.submit("alice", "Leave", "Rest", 1, 2); id = r.id();
            middle = s.decide("bob", id, "step1", "APPROVE", "saved");
            s.publish("alice", 2, definition(2, "carol"));
            assertEquals(v2, s.list("alice").get(0).definition());
            assertEquals("bob", r.approverId()); assertEquals(1, r.history().size());
            status(409, () -> s.submit("alice", "Leave", "Rest", 1, 2));
            assertEquals("carol", s.submit("alice", "New", "Rest", 1, 3).approverId());
        }
        try (var s = open()) {
            assertEquals(3, s.process().version());
            assertEquals(middle, s.list("alice").get(0));
            assertEquals(middle, s.decide("bob", id, "step1", "APPROVE", "retry"));
            var next = s.decide("carol", id, "step2", "APPROVE", "two");
            assertEquals("step3", next.currentStepId()); assertEquals(v2, next.definition());
            assertEquals("APPROVED", s.decide("bob", id, "step3", "APPROVE", "three").status());
        }
    }
    @Test void publicationAuthorizationAndVersionsAreEnforcedEvenForSameDefinition() throws Exception {
        try (var s = open()) {
            var proposed = definition(1, "bob", "carol");
            status(403, () -> s.publish("bob", 1, proposed));
            status(403, () -> s.publish("carol", 1, proposed));
            status(403, () -> s.publish("mallory", 1, proposed));
            assertEquals(1, s.process().version());
            s.publish("alice", 1, proposed);
            status(409, () -> s.publish("alice", 1, proposed));
            status(409, () -> s.publish("alice", 2, proposed));
            assertEquals(2, s.process().version());
        }
    }
    @Test void namesIdsShapesAssigneesAndApprovalLimitsAreValidated() throws Exception {
        try (var s = open()) {
            var good = definition(1, "bob");
            var invalid = new ArrayList<ProcessDefinition>();
            invalid.add(null);
            invalid.add(new ProcessDefinition(1, good.id(), 1, good.name(), good.nodes()));
            invalid.add(new ProcessDefinition(2, "wrong", 1, good.name(), good.nodes()));
            invalid.add(new ProcessDefinition(2, good.id(), 0, good.name(), good.nodes()));
            for (String name : new String[]{null, " ", "x".repeat(121), "name\nline"})
                invalid.add(new ProcessDefinition(2, good.id(), 1, name, good.nodes()));
            invalid.add(new ProcessDefinition(2, good.id(), 1, good.name(), null));
            invalid.add(definition(1));
            invalid.add(definition(1, "bob", "bob", "bob", "bob", "bob", "bob", "bob", "bob", "bob"));
            invalid.add(definition(1, "alice")); invalid.add(definition(1, "unknown")); invalid.add(definition(1, (String)null));
            for (var node : List.of(
                new ProcessDefinition.ProcessNode("step1", "gateway", "Review", "bob"),
                new ProcessDefinition.ProcessNode("bad id", "approval", "Review", "bob"),
                new ProcessDefinition.ProcessNode("1bad", "approval", "Review", "bob"),
                new ProcessDefinition.ProcessNode("x".repeat(65), "approval", "Review", "bob"),
                new ProcessDefinition.ProcessNode("step1", "approval", "", "bob"),
                new ProcessDefinition.ProcessNode("step1", "approval", "x".repeat(121), "bob"),
                new ProcessDefinition.ProcessNode("step1", "approval", "line\nname", "bob"),
                new ProcessDefinition.ProcessNode("start", "approval", "Review", "bob"))) {
                invalid.add(new ProcessDefinition(2, good.id(), 1, good.name(), List.of(good.nodes().get(0), node, good.nodes().get(2))));
            }
            var two = definition(1, "bob", "carol");
            invalid.add(new ProcessDefinition(2, good.id(), 1, good.name(), List.of(two.nodes().get(0), two.nodes().get(1), two.nodes().get(1), two.nodes().get(3))));
            invalid.add(new ProcessDefinition(2, good.id(), 1, good.name(), List.of(good.nodes().get(2), good.nodes().get(1), good.nodes().get(0))));
            invalid.add(new ProcessDefinition(2, good.id(), 1, good.name(), List.of(new ProcessDefinition.ProcessNode("start", "start", "Start", "bob"), good.nodes().get(1), good.nodes().get(2))));
            for (var d : invalid) status(400, () -> s.publish("alice", 1, d));
            assertEquals(1, s.process().version()); assertFalse(Files.exists(file()));
            var max = s.publish("alice", 1, definition(1, "bob", "carol", "bob", "carol", "bob", "carol", "bob", "carol"));
            assertEquals(10, max.nodes().size());
        }
    }
    @Test void selfApprovalInAnyStepInvalidSubmissionsAndCommentsAreRejected() throws Exception {
        try (var s = open()) {
            status(400, () -> s.submit("bob", "Leave", "Rest", 1, 1));
            status(403, () -> s.submit("mallory", "Leave", "Rest", 1, 1));
            s.publish("alice", 1, definition(1, "carol", "bob"));
            status(400, () -> s.submit("bob", "Leave", "Rest", 1, 2));
            status(400, () -> s.submit("carol", "Leave", "Rest", 1, 2));
            status(400, () -> s.submit("alice", null, "Rest", 1, 2));
            status(400, () -> s.submit("alice", "Leave", " ", 1, 2));
            status(400, () -> s.submit("alice", "x".repeat(121), "Rest", 1, 2));
            status(400, () -> s.submit("alice", "Leave", "Rest", 366, 2));
            var r = s.submit("alice", "Leave", "Rest", 1, 2);
            status(400, () -> s.decide("carol", r.id(), "step1", "OTHER", ""));
            status(400, () -> s.decide("carol", r.id(), "step1", "APPROVE", "x".repeat(2001)));
            status(409, () -> s.decide("carol", r.id(), "missing", "APPROVE", ""));
            assertEquals(1, s.list("alice").get(0).history().size());
        }
    }
    @Test void concurrentOppositeDecisionsCommitExactlyOne() throws Exception {
        try (var s = open()) {
            s.publish("alice", 1, definition(1, "bob", "bob"));
            var r = s.submit("alice", "Leave", "Rest", 1, 2);
            var pool = Executors.newFixedThreadPool(2); var gate = new CountDownLatch(1);
            try {
                Callable<Integer> approve = () -> { gate.await(); try { s.decide("bob", r.id(), "step1", "APPROVE", ""); return 200; } catch (ResponseStatusException e) { return e.getStatusCode().value(); } };
                Callable<Integer> reject = () -> { gate.await(); try { s.decide("bob", r.id(), "step1", "REJECT", ""); return 200; } catch (ResponseStatusException e) { return e.getStatusCode().value(); } };
                var a = pool.submit(approve); var b = pool.submit(reject); gate.countDown();
                assertEquals(609, a.get(5, TimeUnit.SECONDS) + b.get(5, TimeUnit.SECONDS));
                assertEquals(2, s.list("alice").get(0).history().size());
            } finally { pool.shutdownNow(); }
        }
    }
    @Test void concurrentDuplicateStepDecisionAddsOneEventAndAdvancesOnlyOnce() throws Exception {
        try (var s = open()) {
            s.publish("alice", 1, definition(1, "bob", "bob"));
            var r = s.submit("alice", "Leave", "Rest", 1, 2);
            var pool = Executors.newFixedThreadPool(12); var gate = new CountDownLatch(1);
            try {
                var futures = new ArrayList<Future<ApprovalService.Request>>();
                for (int i = 0; i < 12; i++) futures.add(pool.submit(() -> { gate.await(); return s.decide("bob", r.id(), "step1", "APPROVE", "ok"); }));
                gate.countDown();
                var expected = futures.get(0).get(5, TimeUnit.SECONDS);
                for (var f : futures) assertEquals(expected, f.get(5, TimeUnit.SECONDS));
                assertEquals(2, expected.history().size()); assertEquals("step2", expected.currentStepId());
            } finally { pool.shutdownNow(); }
        }
    }
    @Test void concurrentPublishIsOptimistic() throws Exception {
        try (var s = open()) {
            var pool = Executors.newFixedThreadPool(2); var gate = new CountDownLatch(1);
            try {
                Callable<Integer> publish = () -> { gate.await(); try { s.publish("alice", 1, definition(1, "bob", "carol")); return 200; } catch (ResponseStatusException e) { return e.getStatusCode().value(); } };
                var a = pool.submit(publish); var b = pool.submit(publish); gate.countDown();
                assertEquals(609, a.get(5, TimeUnit.SECONDS) + b.get(5, TimeUnit.SECONDS));
                assertEquals(2, s.process().version());
            } finally { pool.shutdownNow(); }
        }
    }
    @Test void concurrentPublishAndSubmitCannotMixDefinitionVersions() throws Exception {
        try (var s = open()) {
            var initial = s.process();
            var pool = Executors.newFixedThreadPool(2); var gate = new CountDownLatch(1);
            try {
                var submitted = pool.submit(() -> {
                    gate.await();
                    try { return s.submit("alice", "Leave", "Rest", 1, 1); }
                    catch (ResponseStatusException ex) { assertEquals(409, ex.getStatusCode().value()); return null; }
                });
                var published = pool.submit(() -> { gate.await(); return s.publish("alice", 1, definition(1, "carol", "bob")); });
                gate.countDown();
                var request = submitted.get(5, TimeUnit.SECONDS);
                assertEquals(2, published.get(5, TimeUnit.SECONDS).version());
                if (request != null) {
                    assertEquals(initial, request.definition()); assertEquals(1, request.processVersion());
                    assertEquals("manager", request.currentStepId()); assertEquals("bob", request.approverId());
                } else assertTrue(s.list("alice").isEmpty());
                var latest = s.submit("alice", "Later", "Rest", 1, 2);
                assertEquals(s.process(), latest.definition()); assertEquals("carol", latest.approverId());
            } finally { pool.shutdownNow(); }
        }
    }
    @Test void secondWriterCorruptUnsupportedAndDuplicateJsonFailClosed() throws Exception {
        try (var s = open()) { assertThrows(IOException.class, this::open); }
        for (String invalid : List.of("not json", "null", "{}", "{\"schemaVersion\":3,\"requests\":[]}",
            "{\"schemaVersion\":1,\"schemaVersion\":1,\"requests\":[]}", "{\"schemaVersion\":1,\"requests\":[]} true")) {
            Files.writeString(file(), invalid); assertThrows(IOException.class, this::open, invalid);
        }
    }
    @Test void malformedRestoredStateHistoryAndDefinitionAreRejectedWithoutRewrite() throws Exception {
        try (var s = open()) {
            s.publish("alice", 1, definition(1, "bob", "carol"));
            var r = s.submit("alice", "Leave", "Rest", 1, 2);
            s.decide("bob", r.id(), "step1", "APPROVE", "one");
        }
        byte[] baseline = Files.readAllBytes(file());
        List<Consumer<ObjectNode>> corruptions = List.of(
            root -> root.put("extra", true),
            root -> root.remove("definition"),
            root -> ((ObjectNode)root.path("definition")).put("version", 0),
            root -> ((ObjectNode)root.path("definition").path("nodes").get(1)).put("type", "gateway"),
            root -> ((ObjectNode)root.path("requests").get(0)).put("status", "APPROVED"),
            root -> ((ObjectNode)root.path("requests").get(0)).put("currentStepId", "step1"),
            root -> ((ObjectNode)root.path("requests").get(0)).put("approverId", "bob"),
            root -> ((ObjectNode)root.path("requests").get(0)).put("processVersion", 1),
            root -> ((ObjectNode)root.path("requests").get(0)).put("decision", "REJECT"),
            root -> ((ObjectNode)root.path("requests").get(0)).put("comment", "forged"),
            root -> ((ObjectNode)root.path("requests").get(0)).put("days", "1"),
            root -> ((ObjectNode)root.path("requests").get(0)).remove("currentStepId"),
            root -> ((ObjectNode)root.path("requests").get(0).path("history").get(0)).put("actorId", "carol"),
            root -> ((ObjectNode)root.path("requests").get(0).path("history").get(0)).put("stepId", "step1"),
            root -> ((ObjectNode)root.path("requests").get(0).path("history").get(1)).put("at", "broken"),
            root -> ((ObjectNode)root.path("requests").get(0).path("history").get(1)).put("at", "2000-01-01T00:00:00Z"),
            root -> ((ObjectNode)root.path("requests").get(0).path("history").get(1)).put("stepId", "step2"),
            root -> ((ObjectNode)root.path("requests").get(0).path("history").get(1)).put("actorId", "carol"),
            root -> ((com.fasterxml.jackson.databind.node.ArrayNode)root.path("requests")).add(root.path("requests").get(0).deepCopy())
        );
        for (var corrupt : corruptions) {
            ObjectNode root = (ObjectNode)mapper.readTree(baseline); corrupt.accept(root);
            byte[] bytes = mapper.writeValueAsBytes(root); Files.write(file(), bytes);
            assertThrows(IOException.class, this::open); assertArrayEquals(bytes, Files.readAllBytes(file()));
        }
    }
    static ObjectNode legacyRequest(ObjectMapper mapper, String id, String applicant, String approver, String status) {
        ObjectNode r = mapper.createObjectNode();
        r.put("id", id).put("title", "Leave").put("reason", "Family time").put("days", 2).put("applicantId", applicant)
            .put("approverId", approver).put("status", status).put("createdAt", "2026-09-01T10:00:00Z")
            .put("updatedAt", "2026-09-01T10:00:00Z").putNull("decision").putNull("comment").put("processId", "leave-approval").put("processVersion", 1);
        var h = r.putArray("history");
        h.addObject().put("actorId", applicant).put("action", "SUBMIT").put("comment", "").put("at", "2026-09-01T10:00:00Z");
        if (!"PENDING".equals(status)) {
            String decision = "APPROVED".equals(status) ? "APPROVE" : "REJECT";
            r.put("updatedAt", "2026-09-01T11:00:00Z").put("decision", decision).put("comment", "Original comment");
            h.addObject().put("actorId", approver).put("action", decision).put("comment", "Original comment").put("at", "2026-09-01T11:00:00Z");
        }
        return r;
    }
    @Test void legacyMigrationPreservesEveryOriginalFieldAndBytesAndWritesOnlyOnMutation() throws Exception {
        var old = mapper.createObjectNode().put("schemaVersion", 1);
        var records = old.putArray("requests");
        records.add(legacyRequest(mapper, "old-pending", "alice", "bob", "PENDING"));
        records.add(legacyRequest(mapper, "old-approved", "bob", "carol", "APPROVED"));
        records.add(legacyRequest(mapper, "old-rejected", "carol", "bob", "REJECTED"));
        byte[] original = mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(old); Files.write(file(), original);
        try (var s = open()) {
            assertArrayEquals(original, Files.readAllBytes(file()));
            var all = s.list("bob"); assertEquals(3, all.size());
            for (int i = 0; i < records.size(); i++) {
                ObjectNode migrated = mapper.valueToTree(all.get(i));
                assertEquals(records.get(i).get("approverId").asText(), all.get(i).definition().approvals().get(0).assigneeId());
                assertEquals("PENDING".equals(all.get(i).status()) ? "manager" : null, all.get(i).currentStepId());
                migrated.remove(List.of("definition", "currentStepId"));
                for (var e : migrated.withArray("history")) ((ObjectNode)e).remove("stepId");
                assertEquals(records.get(i), migrated);
            }
            assertEquals(all.get(1), s.decide("carol", "old-approved", "manager", "APPROVE", "retry"));
            assertArrayEquals(original, Files.readAllBytes(file())); // A replay is not a mutation.
            s.publish("alice", 1, definition(1, "bob", "carol"));
            assertEquals(2, mapper.readTree(file().toFile()).get("schemaVersion").asInt());
            Path backup = dir.resolve("state.json.schema1.bak");
            assertArrayEquals(original, Files.readAllBytes(backup));
            if (Files.getFileStore(backup).supportsFileAttributeView("posix"))
                assertEquals(java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"), Files.getPosixFilePermissions(backup));
        }
        try (var s = open()) {
            assertEquals(3, s.list("bob").size()); assertEquals(2, s.process().version());
            var completed = s.decide("bob", "old-pending", "manager", "APPROVE", "after upgrade");
            assertEquals("APPROVED", completed.status()); assertEquals(1, completed.processVersion());
            assertEquals(2, completed.history().size());
        }
    }
    @Test void migrationNeverOverwritesAnExistingOriginalBackup() throws Exception {
        var legacy = mapper.createObjectNode().put("schemaVersion", 1);
        legacy.putArray("requests").add(legacyRequest(mapper, "legacy", "alice", "bob", "PENDING"));
        byte[] original = mapper.writeValueAsBytes(legacy); Files.write(file(), original);
        Path existing = dir.resolve("state.json.schema1.bak"); Files.writeString(existing, "older retained backup");
        try (var s = open()) { s.publish("alice", 1, definition(1, "carol")); }
        assertEquals("older retained backup", Files.readString(existing));
        try (var files = Files.list(dir)) {
            var copies = files.filter(p -> p.getFileName().toString().startsWith("state.json.schema1-")).toList();
            assertEquals(1, copies.size()); assertArrayEquals(original, Files.readAllBytes(copies.get(0)));
        }
        try (var s = open()) { assertEquals("bob", s.list("alice").get(0).definition().approvals().get(0).assigneeId()); }
    }
    @Test void invalidLegacyHistoryAssigneesFieldsAndUnknownDataFailClosed() throws Exception {
        var valid = mapper.createObjectNode().put("schemaVersion", 1);
        valid.putArray("requests").add(legacyRequest(mapper, "old", "alice", "bob", "APPROVED"));
        for (Consumer<ObjectNode> corrupt : List.<Consumer<ObjectNode>>of(
            root -> ((ObjectNode)root.path("requests").get(0)).put("approverId", "unknown"),
            root -> ((ObjectNode)root.path("requests").get(0)).put("applicantId", "bob"),
            root -> ((ObjectNode)root.path("requests").get(0)).put("processVersion", 2),
            root -> ((ObjectNode)root.path("requests").get(0)).put("title", ""),
            root -> ((ObjectNode)root.path("requests").get(0)).put("decision", "REJECT"),
            root -> ((ObjectNode)root.path("requests").get(0)).put("unknown", true),
            root -> ((ObjectNode)root.path("requests").get(0).path("history").get(1)).put("actorId", "carol"),
            root -> ((ObjectNode)root.path("requests").get(0).path("history").get(1)).put("at", "bad-time"))) {
            ObjectNode root = valid.deepCopy(); corrupt.accept(root);
            byte[] bytes = mapper.writeValueAsBytes(root); Files.write(file(), bytes);
            assertThrows(IOException.class, this::open); assertArrayEquals(bytes, Files.readAllBytes(file()));
            assertFalse(Files.exists(dir.resolve("state.json.schema1.bak")));
        }
    }
    @Test void failedPersistenceNeverPublishesMutationInMemory() throws Exception {
        try (var s = open()) {
            var r = s.submit("alice", "Leave", "Rest", 1, 1);
            Path saved = dir.resolve("saved.json"); Files.move(file(), saved); Files.createDirectory(file());
            try {
                assertThrows(IOException.class, () -> s.decide("bob", r.id(), "manager", "APPROVE", "ok"));
                assertEquals(r, s.list("alice").get(0));
                assertThrows(IOException.class, () -> s.publish("alice", 1, definition(1, "carol")));
                assertEquals(1, s.process().version());
            } finally { Files.delete(file()); Files.move(saved, file()); }
        }
        try (var s = open()) { assertEquals("PENDING", s.list("alice").get(0).status()); }
    }
}
