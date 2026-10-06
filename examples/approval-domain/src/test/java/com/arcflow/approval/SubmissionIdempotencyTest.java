package com.arcflow.approval;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

class SubmissionIdempotencyTest {
    @TempDir Path dir;
    final ObjectMapper mapper = new ObjectMapper();
    final ActorDirectoryTest.Directory users = new ActorDirectoryTest.Directory();
    Path file() { return dir.resolve("state.json"); }
    JsonApprovalStore store() throws IOException { return new JsonApprovalStore(mapper, file().toString(), ProcessDefinition.legacy("202")); }
    ApprovalService open() throws IOException { return new ApprovalService(store(), users); }
    static ApprovalService.Request submit(ApprovalService s, String key) throws IOException {
        return s.submit("101", "Leave", "Rest", 2, 1, key);
    }
    static void status(int code, org.junit.jupiter.api.function.Executable action) {
        assertEquals(code, assertThrows(ResponseStatusException.class, action).getStatusCode().value());
    }
    @Test void normalizedIntentReplaysDurablyWithCurrentStateAndFrozenDefinition() throws Exception {
        ApprovalService.Request done;
        try (var s = open()) {
            var first = s.submit("101", " Leave ", " Rest ", 2, 1, "key-1");
            assertEquals(first, submit(s, "key-1"));
            done = s.decide("202", first.id(), "manager", "APPROVE", "saved");
            s.publish("1", 1, ProcessDefinition.legacy("101")); // New definition would self-assign.
            users.active.remove("202");
            assertEquals(done, submit(s, "key-1"));
            assertEquals(1, s.list("101").size());
        }
        try (var s = open()) {
            assertEquals(done, submit(s, "key-1"));
            assertEquals(1, done.processVersion());
            assertEquals(2, s.process().version());
        }
    }
    @Test void everyImmutableFieldConflictsWithoutChangingTheSavedRequest() throws Exception {
        try (var s = open()) {
            var first = submit(s, "key");
            status(409, () -> s.submit("101", "Changed", "Rest", 2, 1, "key"));
            status(409, () -> s.submit("101", "Leave", "Changed", 2, 1, "key"));
            status(409, () -> s.submit("101", "Leave", "Rest", 3, 1, "key"));
            status(409, () -> s.submit("101", "Leave", "Rest", 2, 2, "key"));
            assertEquals(List.of(first), s.list("101"));
        }
    }
    @Test void applicantScopeCaseAndLegacyOptOutAreIndependent() throws Exception {
        try (var s = open()) {
            var first = submit(s, "Key");
            var other = s.submit("1", "Other", "Reason", 1, 1, "Key");
            assertNotEquals(first.id(), other.id());
            assertEquals("1", other.applicantId());
            assertNotEquals(first.id(), submit(s, "key").id());
            assertNotEquals(submit(s, null).id(), submit(s, null).id());
            assertEquals(4, s.list("101").size());
            assertEquals(List.of(other), s.list("1"));
        }
    }
    @Test void invalidKeysNeverDowngradeAndRawValidationStillAppliesToReplay() throws Exception {
        try (var s = open()) {
            for (String key : List.of("", " ", "bad key", "a,b", "é", "_first", "a\n", "a".repeat(129)))
                status(400, () -> submit(s, key));
            assertTrue(s.list("101").isEmpty());
            submit(s, "a._:-09");
            submit(s, "a".repeat(128));
            status(400, () -> s.submit("101", " ", "Rest", 2, 1, "a._:-09"));
            status(400, () -> s.submit("101", "Leave", "Rest", 2, 0, "unused"));
            users.active.remove("101");
            status(403, () -> submit(s, "a._:-09"));
        }
    }
    @Test void concurrentSameIntentCreatesOneRequestAndOneSubmissionEvent() throws Exception {
        try (var s = open()) {
            var pool = Executors.newFixedThreadPool(12);
            try {
                var ready = new CountDownLatch(12); var start = new CountDownLatch(1);
                var futures = new ArrayList<Future<ApprovalService.Request>>();
                for (int i = 0; i < 12; i++) futures.add(pool.submit(() -> { ready.countDown(); start.await(); return submit(s, "shared"); }));
                assertTrue(ready.await(5, TimeUnit.SECONDS)); start.countDown();
                var ids = new HashSet<String>();
                for (var future : futures) { var r = future.get(10, TimeUnit.SECONDS); ids.add(r.id()); assertEquals(1, r.history().size()); }
                assertEquals(1, ids.size()); assertEquals(1, s.list("101").size());
            } finally { pool.shutdownNow(); }
        }
        try (var s = open()) { assertEquals(1, s.list("101").size()); assertEquals(s.list("101").get(0), submit(s, "shared")); }
    }
    @Test void concurrentDifferentIntentHasOneWinnerAndOneConflict() throws Exception {
        try (var s = open()) {
            var pool = Executors.newFixedThreadPool(2); var start = new CountDownLatch(1);
            try {
                var results = new ArrayList<Future<Object>>();
                for (String title : List.of("One", "Two")) results.add(pool.submit(() -> {
                    start.await();
                    try { return s.submit("101", title, "Rest", 2, 1, "shared"); }
                    catch (ResponseStatusException e) { return e.getStatusCode().value(); }
                }));
                start.countDown(); var outcomes = new ArrayList<Object>();
                for (var result : results) outcomes.add(result.get(10, TimeUnit.SECONDS));
                assertEquals(1, outcomes.stream().filter(x -> x instanceof ApprovalService.Request).count());
                assertEquals(1, outcomes.stream().filter(x -> Integer.valueOf(409).equals(x)).count());
                assertEquals(1, s.list("101").size());
            } finally { pool.shutdownNow(); }
        }
    }
    @Test void winnerThenPublicationBeforeAtomicCreateReturnsWinner() throws Exception {
        try (var wrapper = new Interleaving(store()); var s = new ApprovalService(wrapper, users)) {
            wrapper.beforeCreate = () -> { submit(s, "shared"); s.publish("1", 1, s.process()); };
            var replay = submit(s, "shared");
            assertEquals(1, replay.processVersion()); assertEquals(2, s.process().version()); assertEquals(1, s.list("101").size());
        }
    }
    @Test void winnerThenPublicationBeforeProcessReadReturnsWinner() throws Exception {
        try (var wrapper = new Interleaving(store()); var s = new ApprovalService(wrapper, users)) {
            wrapper.afterLookup = () -> { submit(s, "shared"); s.publish("1", 1, ProcessDefinition.legacy("101")); };
            var replay = submit(s, "shared");
            assertEquals(1, replay.processVersion()); assertEquals(2, s.process().version()); assertEquals(1, s.list("101").size());
        }
    }
    @Test void winnerThenDirectoryChangeBeforeValidationStillReplays() throws Exception {
        try (var wrapper = new Interleaving(store()); var s = new ApprovalService(wrapper, users)) {
            wrapper.afterLookup = () -> { submit(s, "shared"); users.active.remove("202"); };
            assertEquals("PENDING", submit(s, "shared").status());
            assertEquals(1, s.list("101").size());
        }
    }
    @Test void concurrentWinnerDecisionReplaysCurrentState() throws Exception {
        try (var wrapper = new Interleaving(store()); var s = new ApprovalService(wrapper, users)) {
            wrapper.beforeCreate = () -> { var winner = submit(s, "shared"); s.decide("202", winner.id(), "manager", "APPROVE", "ok"); };
            var replay = submit(s, "shared"); assertEquals("APPROVED", replay.status()); assertEquals(2, replay.history().size());
        }
    }
    @Test void racingReplayRechecksApplicantAuthorization() throws Exception {
        try (var wrapper = new Interleaving(store()); var s = new ApprovalService(wrapper, users)) {
            wrapper.beforeCreate = () -> { submit(s, "shared"); users.active.remove("101"); };
            status(403, () -> submit(s, "shared")); assertEquals(1, wrapper.requests().size());
        }
    }
    @Test void committedButLostAcknowledgementRecoversAfterRestart() throws Exception {
        try (var wrapper = new Interleaving(store()); var s = new ApprovalService(wrapper, users)) {
            wrapper.loseAcknowledgement = true;
            assertThrows(IOException.class, () -> submit(s, "shared")); assertEquals(1, wrapper.requests().size());
        }
        try (var s = open()) { assertEquals(s.list("101").get(0), submit(s, "shared")); assertEquals(1, s.list("101").size()); }
    }
    @Test void staleUnboundAttemptDoesNotBurnKey() throws Exception {
        try (var s = open()) {
            s.publish("1", 1, s.process()); status(409, () -> submit(s, "shared"));
            assertTrue(s.list("101").isEmpty());
            assertNotNull(s.submit("101", "Leave", "Rest", 2, 2, "shared"));
        }
    }
    @Test void atomicReplacementFailureLeavesNoRequestOrBindingAndAllowsRetry() throws Exception {
        try (var s = open()) {
            Files.createDirectory(file()); Files.writeString(file().resolve("block"), "synthetic");
            assertThrows(IOException.class, () -> submit(s, "shared")); assertTrue(s.list("101").isEmpty());
            Files.delete(file().resolve("block")); Files.delete(file());
            assertNotNull(submit(s, "shared")); assertEquals(1, s.list("101").size());
        }
        try (var s = open()) { assertEquals(s.list("101").get(0), submit(s, "shared")); }
    }
    @Test void schemaThreeMigratesOnlyOnKeyedWriteWithByteExactBackup() throws Exception {
        byte[] original;
        try (var s = open()) {
            var nodes = List.of(new ProcessDefinition.ProcessNode("start", "start", "Start", null),
                new ProcessDefinition.ProcessNode("group", "parallelApproval", "Group", null, List.of("202", "1"), "ALL"),
                new ProcessDefinition.ProcessNode("end", "end", "End", null));
            s.publish("1", 1, new ProcessDefinition(3, "leave-approval", 1, "Groups", nodes));
            s.submit("101", "Legacy", "Reason", 1, 2);
        }
        original = Files.readAllBytes(file()); assertEquals(3, mapper.readTree(original).get("schemaVersion").intValue());
        try (var s = open()) { assertArrayEquals(original, Files.readAllBytes(file())); s.submit("101", "Leave", "Rest", 2, 2, "shared"); }
        assertArrayEquals(original, Files.readAllBytes(dir.resolve("state.json.schema3.bak")));
        assertEquals(4, mapper.readTree(file().toFile()).get("schemaVersion").intValue());
        try (var s = open()) { s.submit("101", "No key", "Still schema4", 1, 2); }
        assertEquals(4, mapper.readTree(file().toFile()).get("schemaVersion").intValue());
    }
    @Test void schemaTwoMigratesAndPreservesExistingBackup() throws Exception {
        try (var s = open()) { submit(s, null); }
        byte[] original = Files.readAllBytes(file()); Files.writeString(dir.resolve("state.json.schema2.bak"), "keep");
        try (var s = open()) { submit(s, "shared"); }
        assertEquals("keep", Files.readString(dir.resolve("state.json.schema2.bak")));
        try (var paths = Files.list(dir)) {
            Path backup = paths.filter(p -> p.getFileName().toString().startsWith("state.json.schema2-")).findFirst().orElseThrow();
            assertArrayEquals(original, Files.readAllBytes(backup));
        }
    }
    @Test void corruptBindingsFailClosedAndReleaseTheFileLock() throws Exception {
        try (var s = open()) { submit(s, "shared"); }
        byte[] original = Files.readAllBytes(file());
        for (String corruption : List.of("duplicate", "dangling", "owner", "alias", "badkey", "unknown", "null")) {
            ObjectNode root = (ObjectNode) mapper.readTree(original);
            var bindings = root.withArray("submissions"); var binding = (ObjectNode) bindings.get(0);
            switch (corruption) {
                case "duplicate" -> bindings.add(binding.deepCopy());
                case "dangling" -> binding.put("requestId", "missing");
                case "owner" -> binding.put("applicantId", "1");
                case "alias" -> { var copy = binding.deepCopy(); copy.put("key", "alias"); bindings.add(copy); }
                case "badkey" -> binding.put("key", "bad key");
                case "unknown" -> binding.put("extra", true);
                case "null" -> bindings.addNull();
            }
            mapper.writeValue(file().toFile(), root); assertThrows(IOException.class, this::open, corruption);
            Files.write(file(), original); try (var s = open()) { assertEquals(1, s.list("101").size()); }
        }
    }
    @Test void thirdPartyStoreWithoutKeySupportFailsExplicitlyButLegacyWorks() throws Exception {
        try (var delegate = store(); var legacy = new ApprovalStore() {
            public ProcessDefinition process() throws IOException { return delegate.process(); }
            public List<ApprovalService.Request> requests() throws IOException { return delegate.requests(); }
            public ApprovalService.Request request(String id) throws IOException { return delegate.request(id); }
            public boolean publish(String a, int v, ProcessDefinition d) throws IOException { return delegate.publish(a, v, d); }
            public boolean create(int v, ApprovalService.Request r) throws IOException { return delegate.create(v, r); }
            public boolean update(int v, ApprovalService.Request r) throws IOException { return delegate.update(v, r); }
            public void close() {}
        }; var s = new ApprovalService(legacy, users)) {
            assertThrows(IOException.class, () -> submit(s, "shared")); assertTrue(s.list("101").isEmpty()); assertNotNull(submit(s, null));
        }
    }
    @FunctionalInterface interface Action { void run() throws IOException; }
    static final class Interleaving implements ApprovalStore {
        final ApprovalStore delegate;
        Action beforeCreate, afterLookup; boolean loseAcknowledgement;
        Interleaving(ApprovalStore delegate) { this.delegate = delegate; }
        public ProcessDefinition process() throws IOException { return delegate.process(); }
        public List<ApprovalService.Request> requests() throws IOException { return delegate.requests(); }
        public ApprovalService.Request request(String id) throws IOException { return delegate.request(id); }
        public ApprovalService.Request submission(String actor, String key) throws IOException {
            var saved = delegate.submission(actor, key); var action = afterLookup; afterLookup = null; if (action != null) action.run(); return saved;
        }
        public ApprovalService.Request create(int v, ApprovalService.Request r, String key) throws IOException {
            var action = beforeCreate; beforeCreate = null; if (action != null) action.run();
            var saved = delegate.create(v, r, key);
            if (loseAcknowledgement) { loseAcknowledgement = false; throw new IOException("Lost committed acknowledgement"); }
            return saved;
        }
        public boolean create(int v, ApprovalService.Request r) throws IOException { return delegate.create(v, r); }
        public boolean publish(String a, int v, ProcessDefinition d) throws IOException { return delegate.publish(a, v, d); }
        public boolean update(int v, ApprovalService.Request r) throws IOException { return delegate.update(v, r); }
        public void close() throws IOException { delegate.close(); }
    }
}
