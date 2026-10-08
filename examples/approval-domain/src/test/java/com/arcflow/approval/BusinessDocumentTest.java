package com.arcflow.approval;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

class BusinessDocumentTest {
    @TempDir Path directory;
    final ObjectMapper mapper = ApprovalService.strictMapper(new ObjectMapper());
    final ActorDirectoryTest.Directory actors = new ActorDirectoryTest.Directory();
    BusinessDocumentTest() { actors.active.addAll(List.of("303", "404")); }
    Path file() { return directory.resolve("state.json"); }
    ApprovalService open() throws IOException { return new ApprovalService(mapper, file().toString(), actors, ProcessDefinition.legacy("202")); }
    static BusinessDocument.Procurement purchase() {
        return new BusinessDocument.Procurement("PO-123", " Office chairs ", " Team expansion ", " Ergonomic chair ", 3, new BigDecimal("199.50"), "CNY");
    }
    static void status(int code, org.junit.jupiter.api.function.Executable action) {
        assertEquals(code, assertThrows(ResponseStatusException.class, action).getStatusCode().value());
    }
    @Test void exactDecimalSnapshotsSurviveScientificNotationAndRestart() throws Exception {
        for (String amount : List.of("10", "100", "1000000000", "0.10", "199.50")) {
            Path state = directory.resolve("amount-" + amount + ".json");
            var p = new BusinessDocument.Procurement("PO-1", "Title", "Reason", "Item", 1, new BigDecimal(amount), "CNY");
            ApprovalService.Request original;
            try (var service = new ApprovalService(mapper, state.toString(), actors, ProcessDefinition.legacy("202"))) {
                original = service.submitDocument("101", p, 1, "price");
                var decoded = mapper.readValue(mapper.writeValueAsBytes(original), ApprovalService.Request.class);
                assertEquals(original, decoded, amount); ApprovalService.validateRequest(decoded);
            }
            try (var service = new ApprovalService(mapper, state.toString(), actors, ProcessDefinition.legacy("202"))) {
                assertEquals(original, service.submitDocument("101", p, 1, "price"));
                assertEquals("APPROVED", service.decide("202", original.id(), "manager", "APPROVE", "ok").status());
            }
        }
    }

    @Test void procurementSharesLifecycleAndFrozenRoutingAcrossRestart() throws Exception {
        ApprovalService.Request request;
        try (var service = open()) {
            request = service.submitDocument("101", purchase(), 1, "purchase");
            assertEquals("Office chairs", request.title()); assertEquals(0, request.days());
            assertEquals("Ergonomic chair", ((BusinessDocument.Procurement) request.business()).item());
            service.publish("1", 1, ProcessDefinition.legacy("303"));
            status(403, () -> service.decide("101", request.id(), "manager", "APPROVE", ""));
            status(404, () -> service.decide("303", request.id(), "manager", "APPROVE", ""));
            assertEquals(request, service.submitDocument("101", purchase(), 1, "purchase"));
        }
        try (var service = open()) {
            assertEquals(request, service.list("101").get(0));
            var done = service.decide("202", request.id(), "manager", "APPROVE", "budget verified");
            assertEquals("APPROVED", done.status()); assertEquals(request.business(), done.business());
            assertEquals(request.definition(), done.definition());
            assertEquals(done, service.submitDocument("101", purchase(), 1, "purchase"));
            actors.active.remove("101"); status(403, () -> service.submitDocument("101", purchase(), 1, "purchase"));
        }
    }
    @Test void procurementUsesAllAndAnyWithoutBusinessSpecificVotingCode() throws Exception {
        for (String mode : List.of("ALL", "ANY")) {
            Path state = directory.resolve(mode + ".json");
            try (var service = new ApprovalService(mapper, state.toString(), actors, ParallelApprovalTest.definition(mode, false))) {
                var request = service.submitDocument("101", purchase(), 1, "purchase");
                var first = service.decide("202", request.id(), "review", "REJECT", "no");
                if (mode.equals("ALL")) assertEquals("REJECTED", first.status());
                else {
                    assertEquals("PENDING", first.status());
                    assertEquals("APPROVED", service.decide("303", request.id(), "review", "APPROVE", "yes").status());
                }
            }
        }
    }
    @Test void allDocumentFieldsAndBusinessTypeParticipateInIdempotency() throws Exception {
        try (var service = open()) {
            var original = service.submitDocument("101", purchase(), 1, "same");
            var p = (BusinessDocument.Procurement) original.business();
            var changes = List.of(
                new BusinessDocument.Procurement("PO-124", p.title(), p.reason(), p.item(), p.quantity(), p.unitPrice(), p.currency()),
                new BusinessDocument.Procurement(p.businessId(), "Other", p.reason(), p.item(), p.quantity(), p.unitPrice(), p.currency()),
                new BusinessDocument.Procurement(p.businessId(), p.title(), "Other", p.item(), p.quantity(), p.unitPrice(), p.currency()),
                new BusinessDocument.Procurement(p.businessId(), p.title(), p.reason(), "Desk", p.quantity(), p.unitPrice(), p.currency()),
                new BusinessDocument.Procurement(p.businessId(), p.title(), p.reason(), p.item(), 4, p.unitPrice(), p.currency()),
                new BusinessDocument.Procurement(p.businessId(), p.title(), p.reason(), p.item(), p.quantity(), new BigDecimal("200"), p.currency()),
                new BusinessDocument.Procurement(p.businessId(), p.title(), p.reason(), p.item(), p.quantity(), p.unitPrice(), "USD"));
            for (var changed : changes) status(409, () -> service.submitDocument("101", changed, 1, "same"));
            status(409, () -> service.submitDocument("101", new BusinessDocument.Leave("PO-123", p.title(), p.reason(), 1), 1, "same"));
            status(409, () -> service.submit("101", p.title(), p.reason(), 1, 1, "same"));
            status(409, () -> service.submitDocument("101", p, 2, "same"));
            assertEquals(original, service.submitDocument("101", p, 1, "same"));
            assertEquals(List.of(original), service.list("101"));
        }
    }
    @Test void typedLeaveDoesNotWeakenLegacyValidationOrWireShape() throws Exception {
        try (var service = open()) {
            var legacy = service.submit("101", "Leave", "Rest", 2, 1, "legacy");
            assertFalse(mapper.valueToTree(legacy).has("business"));
            assertEquals(16, mapper.valueToTree(legacy).size());
            assertEquals(legacy, mapper.readValue(mapper.writeValueAsString(legacy), ApprovalService.Request.class));
            var typed = service.submitDocument("101", new BusinessDocument.Leave("HR-123", "Leave", "Rest", 2), 1, "typed");
            assertEquals(2, typed.days()); assertEquals("leave", mapper.valueToTree(typed).path("business").path("type").asText());
            for (int days : new int[]{0, -1, 366}) {
                status(400, () -> service.submit("101", "Leave", "Rest", days, 1));
                status(400, () -> service.submitDocument("101", new BusinessDocument.Leave("HR-123", "Leave", "Rest", days), 1, "typed"));
            }
        }
    }
    @Test void businessValidationRejectsInvalidValuesBeforeStorage() throws Exception {
        try (var service = open()) {
            for (var invalid : List.of(
                new BusinessDocument.Procurement("bad id", "Title", "Reason", "Item", 1, BigDecimal.ONE, "CNY"),
                new BusinessDocument.Procurement("PO-1", " ", "Reason", "Item", 1, BigDecimal.ONE, "CNY"),
                new BusinessDocument.Procurement("PO-1", "Title", "Reason", " ", 1, BigDecimal.ONE, "CNY"),
                new BusinessDocument.Procurement("PO-1", "Title", "Reason", "Item", 0, BigDecimal.ONE, "CNY"),
                new BusinessDocument.Procurement("PO-1", "Title", "Reason", "Item", 100001, BigDecimal.ONE, "CNY"),
                new BusinessDocument.Procurement("PO-1", "Title", "Reason", "Item", 1, BigDecimal.ZERO, "CNY"),
                new BusinessDocument.Procurement("PO-1", "Title", "Reason", "Item", 1, new BigDecimal("1.001"), "CNY"),
                new BusinessDocument.Procurement("PO-1", "Title", "Reason", "Item", 1, new BigDecimal("1000000000.01"), "CNY"),
                new BusinessDocument.Procurement("PO-1", "Title", "Reason", "Item", 1, BigDecimal.ONE, "XYZ"),
                new BusinessDocument.Procurement("PO-1", "Title", "Reason", "Item", 1, new BigDecimal("1.5"), "JPY")))
                status(400, () -> service.submitDocument("101", invalid, 1, "invalid"));
            status(400, () -> service.submitDocument("101", null, 1, null));
            assertTrue(service.list("101").isEmpty()); assertFalse(Files.exists(file()));
        }
    }
    @Test void strictBusinessDecodingRejectsUnknownTypesFieldsCoercionAndOverflow() throws Exception {
        var valid = (ObjectNode) mapper.valueToTree(purchase());
        for (String field : List.of("type", "businessId", "title", "reason", "item", "quantity", "unitPrice", "currency")) {
            var missing = valid.deepCopy(); missing.remove(field);
            assertThrows(IOException.class, () -> mapper.treeToValue(missing, BusinessDocument.class), field);
        }
        for (String entry : List.of("\"quantity\":\"3\"", "\"quantity\":1.5", "\"quantity\":2147483648", "\"quantity\":null",
                "\"unitPrice\":\"199.50\"", "\"unitPrice\":true", "\"title\":1", "\"type\":\"expense\"")) {
            String key = entry.substring(1, entry.indexOf('"',1));
            var bad = valid.deepCopy(); bad.set(key, mapper.readTree("{" + entry + "}").get(key));
            assertThrows(IOException.class, () -> mapper.treeToValue(bad, BusinessDocument.class), entry);
        }
        var unknown = valid.deepCopy().put("approved", true);
        assertThrows(IOException.class, () -> mapper.treeToValue(unknown, BusinessDocument.class));
        assertThrows(IOException.class, () -> mapper.readValue(valid.toString().replace("\"quantity\":3", "\"quantity\":3,\"quantity\":4"), BusinessDocument.class));
    }
    @Test void schemaTwoThreeAndFourUpgradeOnlyOnDocumentWriteWithExactBackup() throws Exception {
        for (int schema : List.of(2,3,4)) {
            Path state = directory.resolve("schema" + schema + ".json");
            var initial = schema == 3 ? ParallelApprovalTest.definition("ALL", false) : ProcessDefinition.legacy("202");
            byte[] bytes; ApprovalService.Request old;
            try (var service = new ApprovalService(mapper, state.toString(), actors, initial)) {
                old = service.submit("101", "Legacy", "Rest", 2, 1, schema == 4 ? "old" : null);
                bytes = Files.readAllBytes(state); assertEquals(schema, mapper.readTree(bytes).path("schemaVersion").asInt());
            }
            try (var service = new ApprovalService(mapper, state.toString(), actors, initial)) {
                assertArrayEquals(bytes, Files.readAllBytes(state));
                assertEquals(old, service.list("101").get(0));
                service.submitDocument("101", purchase(), 1, null);
                assertEquals(5, mapper.readTree(Files.readAllBytes(state)).path("schemaVersion").asInt());
                assertArrayEquals(bytes, Files.readAllBytes(state.resolveSibling(state.getFileName() + ".schema" + schema + ".bak")));
                service.submit("101", "Later legacy", "Rest", 2, 1, "later");
                assertEquals(5, mapper.readTree(Files.readAllBytes(state)).path("schemaVersion").asInt());
            }
            try (var service = new ApprovalService(mapper, state.toString(), actors, initial)) { assertEquals(3, service.list("101").size()); }
        }
    }
    @Test void failedSchemaFourUpgradeCanRetryWithoutPublishingPartialState() throws Exception {
        try (var service = open()) {
            var original = service.submit("101", "Legacy", "Rest", 2, 1, "legacy");
            byte[] before = Files.readAllBytes(file()); Path saved = directory.resolve("saved.json");
            Files.move(file(), saved); Files.createDirectory(file());
            try {
                assertThrows(IOException.class, () -> service.submitDocument("101", purchase(), 1, "purchase"));
                assertEquals(List.of(original), service.list("101"));
                assertArrayEquals(before, Files.readAllBytes(directory.resolve("state.json.schema4.bak")));
            } finally { Files.delete(file()); Files.move(saved, file()); }
            service.submitDocument("101", purchase(), 1, "purchase");
            assertEquals(2, service.list("101").size());
            assertArrayEquals(before, Files.readAllBytes(directory.resolve("state.json.schema4.bak")));
        }
        try (var service = open()) { assertEquals(2, service.list("101").size()); }
    }
    @Test void corruptProjectionDocumentShapesAndMixedProcessSnapshotsFailClosed() throws Exception {
        try (var service = open()) { service.submitDocument("101", purchase(), 1, "purchase"); }
        var good = (ObjectNode) mapper.readTree(Files.readAllBytes(file()));
        for (String kind : List.of("projection", "null", "unknown", "missing", "overflow", "process", "downgrade", "precision")) {
            var bad = good.deepCopy(); var request = (ObjectNode) bad.path("requests").get(0);
            switch (kind) {
                case "projection" -> request.put("days", 1);
                case "null" -> request.putNull("business");
                case "unknown" -> ((ObjectNode)request.get("business")).put("approved", true);
                case "missing" -> request.remove("status");
                case "overflow" -> request.put("processVersion", 4294967297L);
                case "process" -> { request.put("processId", "other"); ((ObjectNode)request.get("definition")).put("id", "other"); }
                case "downgrade" -> bad.put("schemaVersion", 4);
                case "precision" -> ((ObjectNode)request.get("business")).set("unitPrice", mapper.readTree("1.00000000000000001"));
            }
            byte[] corrupt = mapper.writeValueAsBytes(bad); Files.write(file(), corrupt);
            assertThrows(IOException.class, this::open, kind); assertArrayEquals(corrupt, Files.readAllBytes(file()));
        }
        Files.write(file(), mapper.writeValueAsBytes(good));
        try (var service = open()) { assertEquals(1, service.list("101").size()); }
    }
    @Test void storageRejectsBusinessMutationDuringDecision() throws Exception {
        try (var store = new JsonApprovalStore(mapper, file().toString(), ProcessDefinition.legacy("202")); var service = new ApprovalService(store, actors)) {
            var original = service.submitDocument("101", purchase(), 1, null);
            var decided = service.decide("202", original.id(), "manager", "APPROVE", "ok");
            var node = (ObjectNode) mapper.valueToTree(decided); ((ObjectNode)node.get("business")).put("businessId", "FORGED");
            var forged = mapper.treeToValue(node, ApprovalService.Request.class);
            assertThrows(IllegalArgumentException.class, () -> ApprovalService.validateTransition(original, forged));
            assertEquals(decided, service.list("101").get(0));
        }
    }
    @Test void genericProcessIdentityIsStableAndJsonCannotOpenAnotherProcess() throws Exception {
        var initial = new ProcessDefinition(2, "procurement-approval", 1, "Purchase approval", ProcessDefinition.legacy("202").nodes());
        try (var service = new ApprovalService(mapper, file().toString(), actors, initial)) {
            var request = service.submitDocument("101", purchase(), 1, null);
            assertEquals(initial.id(), request.processId());
            status(400, () -> service.publish("1", 1, ProcessDefinition.legacy("202")));
            assertEquals(2, service.publish("1", 1, initial).version());
        }
        assertThrows(IOException.class, this::open);
        try (var service = new ApprovalService(mapper, file().toString(), actors, initial)) { assertEquals(1, service.list("101").size()); }
    }
    @Test void concurrentBusinessRetryCommitsOneSnapshotAndOneBinding() throws Exception {
        try (var service = open()) {
            var pool = Executors.newFixedThreadPool(8); var start = new CountDownLatch(1);
            try {
                var results = new ArrayList<Future<ApprovalService.Request>>();
                for (int i=0;i<8;i++) results.add(pool.submit(() -> { start.await(); return service.submitDocument("101", purchase(), 1, "purchase"); }));
                start.countDown(); var ids = new HashSet<String>();
                for (var result : results) ids.add(result.get(10, TimeUnit.SECONDS).id());
                assertEquals(1, ids.size()); assertEquals(1, service.list("101").size());
                var state = mapper.readTree(Files.readAllBytes(file()));
                assertEquals(1, state.get("submissions").size()); assertEquals(1, state.get("requests").get(0).get("history").size());
            } finally { pool.shutdownNow(); }
        }
    }
}
