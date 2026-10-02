package com.arcflow.demo;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

class ApprovalServiceTest {
    @TempDir Path dir;
    ApprovalService open() throws Exception { return new ApprovalService(new ObjectMapper(), dir.resolve("state.json").toString()); }
    @Test void authorizedRejectIsTerminalIdempotentAndSurvivesRestart() throws Exception {
        String id;
        try (var s = open()) {
            var r = s.submit("alice", " Leave ", " Family time ", 2, "bob"); id = r.id();
            assertEquals("Leave", r.title()); assertEquals("PENDING", r.status());
            assertTrue(s.list("carol").isEmpty());
            assertEquals(1, s.list("alice").size()); assertEquals(1, s.list("bob").size());
            assertEquals(403, assertThrows(ResponseStatusException.class, () -> s.decide("alice", r.id(), "APPROVE", "")).getStatusCode().value());
            assertEquals(404, assertThrows(ResponseStatusException.class, () -> s.decide("carol", r.id(), "APPROVE", "")).getStatusCode().value());
            var rejected = s.decide("bob", id, "REJECT", "No coverage");
            assertEquals(rejected, s.decide("bob", id, "REJECT", "ignored retry"));
            assertEquals(2, rejected.history().size());
            assertThrows(UnsupportedOperationException.class, () -> rejected.history().clear());
            assertEquals(409, assertThrows(ResponseStatusException.class, () -> s.decide("bob", r.id(), "APPROVE", "")).getStatusCode().value());
        }
        try (var restarted = open()) {
            var r = restarted.list("alice").get(0);
            assertEquals(id, r.id()); assertEquals("REJECTED", r.status()); assertEquals(2, r.history().size());
            assertEquals(r, restarted.decide("bob", id, "REJECT", ""));
        }
    }
    @Test void concurrentOppositeDecisionsCommitExactlyOne() throws Exception {
        try (var s = open()) {
            var r = s.submit("alice", "Leave", "Rest", 1, "bob");
            var pool = Executors.newFixedThreadPool(2);
            var gate = new CountDownLatch(1);
            try {
                Callable<Integer> approve = () -> { gate.await(); try { s.decide("bob", r.id(), "APPROVE", ""); return 200; } catch (ResponseStatusException e) { return e.getStatusCode().value(); } };
                Callable<Integer> reject = () -> { gate.await(); try { s.decide("bob", r.id(), "REJECT", ""); return 200; } catch (ResponseStatusException e) { return e.getStatusCode().value(); } };
                var a = pool.submit(approve); var b = pool.submit(reject); gate.countDown();
                assertEquals(609, a.get(5, TimeUnit.SECONDS) + b.get(5, TimeUnit.SECONDS));
                assertEquals(2, s.list("alice").get(0).history().size());
            } finally { pool.shutdownNow(); }
        }
    }
    @Test void concurrentDuplicateDecisionAddsOneEvent() throws Exception {
        try (var s = open()) {
            var r = s.submit("alice", "Leave", "Rest", 1, "bob");
            var pool = Executors.newFixedThreadPool(2);
            try {
                var a = pool.submit(() -> s.decide("bob", r.id(), "APPROVE", "ok"));
                var b = pool.submit(() -> s.decide("bob", r.id(), "APPROVE", "ok"));
                assertEquals(a.get(), b.get()); assertEquals(2, s.list("alice").get(0).history().size());
            } finally { pool.shutdownNow(); }
        }
    }
    @Test void secondWriterAndCorruptSnapshotFailClosed() throws Exception {
        try (var s = open()) { assertThrows(java.io.IOException.class, this::open); }
        java.nio.file.Files.writeString(dir.resolve("state.json"), "not json");
        assertThrows(java.io.IOException.class, this::open);
    }
    @Test void forgedRestoredHistoryFailsClosed() throws Exception {
        try (var s = open()) { s.submit("alice", "Leave", "Rest", 1, "bob"); }
        Path file = dir.resolve("state.json");
        String json = java.nio.file.Files.readString(file);
        java.nio.file.Files.writeString(file, json.replace("\"actorId\" : \"alice\"", "\"actorId\" : \"carol\""));
        assertThrows(java.io.IOException.class, this::open);
    }
    @Test void selfOrUnknownApproverRejected() throws Exception {
        try (var s = open()) {
            assertThrows(ResponseStatusException.class, () -> s.submit("bob", "Leave", "Rest", 1, "bob"));
            assertThrows(ResponseStatusException.class, () -> s.submit("alice", "Leave", "Rest", 1, "mallory"));
        }
    }
}
