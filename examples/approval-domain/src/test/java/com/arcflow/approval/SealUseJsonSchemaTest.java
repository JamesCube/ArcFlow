package com.arcflow.approval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
import static com.arcflow.approval.SealUseDocumentTest.seal;

class SealUseJsonSchemaTest {
    @TempDir Path dir;
    final ObjectMapper mapper = ApprovalService.strictMapper(new ObjectMapper());
    final ActorDirectoryTest.Directory actors = new ActorDirectoryTest.Directory();
    SealUseJsonSchemaTest() { actors.active.addAll(List.of("303", "404")); }
    ProcessDefinition initial(int schema) { return schema == 3 ? ParallelApprovalTest.definition("ALL", false) : ProcessDefinition.legacy("202"); }
    ApprovalService open(Path path, ProcessDefinition process) throws IOException { return new ApprovalService(mapper, path.toString(), actors, process); }
    Path backup(Path path, int schema) { return path.resolveSibling(path.getFileName() + ".schema" + schema + ".bak"); }

    byte[] seed(Path path, int schema) throws IOException {
        try (var service = open(path, initial(schema))) {
            if (schema <= 4) service.submit("101", "Legacy", "Rest", 2, 1, schema == 4 ? "old-key" : null);
            else if (schema == 5) service.submitDocument("101", new BusinessDocument.Leave("L-1", "Leave", "Rest", 2), 1, "old-key");
            else if (schema == 6) service.submitDocument("101", new BusinessDocument.QuoteDiscount("Q-1", "Quote", "Reason", "C-1", 1,
                "Item", 1, new BigDecimal("1.00"), new BigDecimal("0.50"), "CNY", "2099-01-01"), 1, "old-key");
            else if (schema == 7) service.submitDocument("101", ExpenseScenarioTest.expense(), 1, "old-key");
            else throw new AssertionError("Seed expects compatible old schema");
        }
        ObjectNode root = (ObjectNode) mapper.readTree(Files.readAllBytes(path));
        if (schema == 1) {
            root.put("schemaVersion", 1); root.remove("definition");
            for (JsonNode row : root.get("requests")) {
                ((ObjectNode) row).remove(List.of("definition", "currentStepId"));
                for (JsonNode event : row.get("history")) ((ObjectNode) event).remove("stepId");
            }
        }
        // The source file is deliberately noncanonical so only exact byte preservation passes.
        byte[] bytes = (" \r\n" + mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root).replace("\n", "\r\n") + "\r\n\t")
            .getBytes(StandardCharsets.UTF_8);
        Files.write(path, bytes);
        assertEquals(schema, mapper.readTree(bytes).get("schemaVersion").intValue());
        return bytes;
    }

    @TestFactory Stream<DynamicTest> allCompatibleSchemasReadWithoutRewritingAndUpgradeWithExactBackup() {
        var tests = new ArrayList<DynamicTest>();
        for (int schema = 1; schema <= 7; schema++) {
            int oldSchema = schema;
            tests.add(DynamicTest.dynamicTest("schema " + schema + " to schema 9", () -> {
                Path path = dir.resolve("schema-" + oldSchema + ".json");
                byte[] bytes = seed(path, oldSchema); ApprovalService.Request old;
                try (var service = open(path, initial(oldSchema))) {
                    old = service.list("101").get(0);
                    assertArrayEquals(bytes, Files.readAllBytes(path)); assertFalse(Files.exists(backup(path, oldSchema)));
                    var created = service.submitDocument("101", seal(), 1, "seal-key");
                    assertInstanceOf(BusinessDocument.SealUse.class, created.business());
                    assertEquals(9, mapper.readTree(Files.readAllBytes(path)).get("schemaVersion").intValue());
                    assertArrayEquals(bytes, Files.readAllBytes(backup(path, oldSchema)));
                    assertEquals(old, service.list("101").get(0));
                }
                try (var service = open(path, initial(oldSchema))) {
                    assertEquals(2, service.list("101").size()); assertEquals(old, service.list("101").get(0));
                    var replay = service.submitDocument("101", seal(), 1, "seal-key");
                    assertEquals("PENDING", replay.status()); assertEquals(2, service.list("101").size());
                    service.submit("101", "Later legacy", "Rest", 1, 1, "later-key");
                    service.submitDocument("101", ExpenseScenarioTest.expense(), 1, "expense-key");
                    service.publish("1", 1, service.process());
                    assertEquals(9, mapper.readTree(Files.readAllBytes(path)).get("schemaVersion").intValue());
                    assertArrayEquals(bytes, Files.readAllBytes(backup(path, oldSchema)));
                }
                try (var service = open(path, initial(oldSchema))) {
                    assertEquals(4, service.list("101").size()); assertEquals(2, service.process().version());
                }
            }));
        }
        return tests.stream();
    }

    @Test void schemaSevenBackupCapturesImmediatePreupgradeBytesAfterInterveningDecision() throws Exception {
        Path path = dir.resolve("immediate.json"); byte[] initialBytes = seed(path, 7);
        byte[] immediate;
        try (var service = open(path, initial(7))) {
            var expense = service.list("101").get(0);
            service.decide("202", expense.id(), "manager", "APPROVE", "Before Seal schema upgrade");
            immediate = Files.readAllBytes(path); assertFalse(java.util.Arrays.equals(initialBytes, immediate));
            assertEquals(7, mapper.readTree(immediate).get("schemaVersion").intValue());
            service.submitDocument("101", seal(), 1, "seal-key");
            assertArrayEquals(immediate, Files.readAllBytes(backup(path, 7)));
        }
        try (var service = open(path, initial(7))) { assertEquals("APPROVED", service.list("101").get(0).status()); }
        assertArrayEquals(immediate, Files.readAllBytes(backup(path, 7)));
    }

    @Test void schemaEightReadsEmptyAndLegacyPayloadWithoutWritesButRejectsMalformedOrTooNewBusiness() throws Exception {
        for (String kind : List.of("empty", "expense", "travel", "sealUse")) {
            Path path = dir.resolve("reserved-" + kind + ".json");
            seed(path, 7); ObjectNode root = (ObjectNode) mapper.readTree(Files.readAllBytes(path)); root.put("schemaVersion", 8);
            if (kind.equals("empty")) { ((com.fasterxml.jackson.databind.node.ArrayNode) root.get("requests")).removeAll(); ((com.fasterxml.jackson.databind.node.ArrayNode) root.get("submissions")).removeAll(); }
            else if (kind.equals("sealUse")) ((ObjectNode) root.get("requests").get(0)).set("business", mapper.valueToTree(seal().withText(seal().title().trim(), seal().reason().trim())));
            else if (kind.equals("travel")) ((ObjectNode) root.get("requests").get(0).get("business")).put("type", "travel");
            byte[] bytes = mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(root); Files.write(path, bytes);
            Files.writeString(backup(path, 8), "Historical reserved schema backup, do not overwrite");
            Files.writeString(backup(path, 7), "Other historical backup");
            Map<Path, byte[]> before = backupContents();
            if (kind.equals("empty") || kind.equals("expense")) {
                try (var service = open(path, initial(7))) { assertEquals(kind.equals("empty") ? 0 : 1, service.list("101").size()); }
            } else assertThrows(IOException.class, () -> open(path, initial(7)));
            assertArrayEquals(bytes, Files.readAllBytes(path)); assertBackupsEqual(before);
        }
    }

    @Test void schemaNumbersRejectOverflowCoercionsFutureAndUnsupportedVersionsWithoutWrites() throws Exception {
        Path path = dir.resolve("version-boundaries.json"); byte[] valid = seed(path, 7);
        for (String schema : List.of("0", "-1", "11", "2147483647", "2147483648", "4294967297", "4294967303", "4294967304",
            "4294967305", "-4294967287", "999999999999999999999999999999", "9.0", "9e0", "\"9\"", "true", "null", "{}", "[]")) {
            String raw = new String(valid, StandardCharsets.UTF_8).replace("\"schemaVersion\" : 7", "\"schemaVersion\" : " + schema);
            assertNotEquals(new String(valid, StandardCharsets.UTF_8), raw);
            byte[] bytes = raw.getBytes(StandardCharsets.UTF_8); Files.write(path, bytes);
            Map<Path, byte[]> before = backupContents();
            assertThrows(IOException.class, () -> open(path, initial(7)), schema);
            assertArrayEquals(bytes, Files.readAllBytes(path)); assertBackupsEqual(before);
        }
    }

    @Test void sealRequiresNineAndUnknownOrMalformedTravelKindsRemainFailClosedEvenAtNine() throws Exception {
        Path path = dir.resolve("type-boundaries.json");
        try (var service = open(path, initial(2))) { service.submitDocument("101", seal(), 1, "seal-key"); }
        ObjectNode valid = (ObjectNode) mapper.readTree(Files.readAllBytes(path));
        for (int schema = 1; schema <= 8; schema++) {
            ObjectNode root = valid.deepCopy().put("schemaVersion", schema);
            byte[] bytes = mapper.writeValueAsBytes(root); Files.write(path, bytes);
            assertThrows(IOException.class, () -> open(path, initial(2)));
            assertArrayEquals(bytes, Files.readAllBytes(path)); assertTrue(backupContents().isEmpty());
        }
        for (String kind : List.of("travel", "unknown", "SealUse", "")) {
            ObjectNode root = valid.deepCopy(); ((ObjectNode) root.get("requests").get(0).get("business")).put("type", kind);
            byte[] bytes = mapper.writeValueAsBytes(root); Files.write(path, bytes);
            assertThrows(IOException.class, () -> open(path, initial(2)));
            assertArrayEquals(bytes, Files.readAllBytes(path)); assertTrue(backupContents().isEmpty());
        }
        Files.write(path, mapper.writeValueAsBytes(valid));
        try (var service = open(path, initial(2))) { assertEquals(1, service.list("101").size()); }
    }

    @Test void schemaNineWithoutSealStillNeverDowngrades() throws Exception {
        Path path = dir.resolve("empty-nine.json"); seed(path, 7);
        ObjectNode root = (ObjectNode) mapper.readTree(Files.readAllBytes(path)); root.put("schemaVersion", 9);
        byte[] nine = mapper.writeValueAsBytes(root); Files.write(path, nine);
        try (var service = open(path, initial(2))) {
            assertArrayEquals(nine, Files.readAllBytes(path));
            service.submit("101", "Legacy", "Rest", 1, 1, "legacy");
            service.submitDocument("101", ExpenseScenarioTest.expense(), 1, "expense");
            service.publish("1", 1, service.process());
            assertEquals(9, mapper.readTree(Files.readAllBytes(path)).get("schemaVersion").intValue());
            assertTrue(backupContents().isEmpty());
        }
    }

    @Test void existingBackupCollisionAndAtomicFailurePublishNeitherRequestNorKeyAndRetryPreservesBackup() throws Exception {
        for (boolean collision : List.of(false, true)) {
            Path path = dir.resolve("atomic-" + collision + ".json"); byte[] bytes = seed(path, 7);
            if (collision) Files.writeString(backup(path, 7), "Historical collision backup");
            Map<Path, byte[]> olderBackups = backupContents();
            var store = new JsonApprovalStore(mapper, path.toString(), initial(7));
            try (var service = new ApprovalService(store, actors)) {
                var original = service.list("101").get(0); var process = service.process();
                Path saved = path.resolveSibling(path.getFileName() + ".saved"); Files.move(path, saved); Files.createDirectory(path);
                Files.writeString(path.resolve("block"), "Force atomic replacement failure");
                Map<Path, byte[]> afterFailure;
                try {
                    assertThrows(IOException.class, () -> service.submitDocument("101", seal(), 1, "failed-key"));
                    assertEquals(List.of(original), service.list("101")); assertEquals(process, service.process());
                    assertNull(store.submission("101", "failed-key"));
                    assertTrue(service.inbox("202", "PENDING", 100, null, null, null).items().stream().allMatch(r -> r.id().equals(original.id())));
                    assertArrayEquals(bytes, Files.readAllBytes(saved));
                    afterFailure = backupContents(); assertEquals(olderBackups.size() + 1, afterFailure.size());
                    for (var entry : olderBackups.entrySet()) assertArrayEquals(entry.getValue(), afterFailure.get(entry.getKey()));
                    Path newBackup = afterFailure.keySet().stream().filter(p -> !olderBackups.containsKey(p)).findFirst().orElseThrow();
                    assertArrayEquals(bytes, afterFailure.get(newBackup));
                    if (Files.getFileStore(newBackup).supportsFileAttributeView("posix"))
                        assertEquals(PosixFilePermissions.fromString("rw-------"), Files.getPosixFilePermissions(newBackup));
                    try (var files = Files.list(dir)) { assertTrue(files.noneMatch(p -> p.getFileName().toString().startsWith("approval-") && p.toString().endsWith(".tmp"))); }
                } finally { Files.delete(path.resolve("block")); Files.delete(path); Files.move(saved, path); }
                // Different valid intent with the failed key proves no failed binding escaped.
                var changed = new BusinessDocument.SealUse(1, seal().businessId(), seal().title(), seal().reason(), seal().documentName(), seal().documentRef(), "CONTRACT", 3);
                var created = service.submitDocument("101", changed, 1, "failed-key");
                assertEquals(3, ((BusinessDocument.SealUse) created.business()).copyCount()); assertEquals(2, service.list("101").size());
                assertEquals(created, store.submission("101", "failed-key")); assertBackupsEqual(afterFailure);
                assertEquals(9, mapper.readTree(Files.readAllBytes(path)).get("schemaVersion").intValue());
            }
            try (var service = open(path, initial(7))) { assertEquals(2, service.list("101").size()); }
        }
    }

    @Test void restartAfterFailedUpgradeRetainsHistoricalBackupAndAllowsUnboundKey() throws Exception {
        Path path = dir.resolve("restart-failure.json"); byte[] bytes = seed(path, 7);
        try (var service = open(path, initial(7))) {
            Files.delete(path); Files.createDirectory(path);
            try { assertThrows(IOException.class, () -> service.submitDocument("101", seal(), 1, "retry")); }
            finally { Files.delete(path); Files.write(path, bytes); }
            assertArrayEquals(bytes, Files.readAllBytes(backup(path, 7)));
        }
        try (var service = open(path, initial(7))) {
            assertEquals(1, service.list("101").size());
            service.submitDocument("101", seal(), 1, "retry");
            assertEquals(2, service.list("101").size()); assertArrayEquals(bytes, Files.readAllBytes(backup(path, 7)));
            assertEquals(2, backupContents().size());
            for (byte[] backup : backupContents().values()) assertArrayEquals(bytes, backup);
        }
    }

    @Test void nonNormalizedOrTamperedStoredSealAndBindingsFailClosedWithoutRewriting() throws Exception {
        Path path = dir.resolve("tamper.json");
        try (var service = open(path, initial(2))) { service.submitDocument("101", seal(), 1, "key"); }
        ObjectNode original = (ObjectNode) mapper.readTree(Files.readAllBytes(path));
        List<ObjectNode> cases = new ArrayList<>();
        for (String field : List.of("businessId", "title", "reason", "documentName", "documentRef", "sealType", "documentVersion", "copyCount")) {
            var root = original.deepCopy(); ((ObjectNode) root.get("requests").get(0).get("business")).remove(field); cases.add(root);
            root = original.deepCopy(); ((ObjectNode) root.get("requests").get(0).get("business")).putNull(field); cases.add(root);
        }
        var unnormalized = original.deepCopy(); ((ObjectNode) unnormalized.get("requests").get(0).get("business")).put("documentName", " Name "); cases.add(unnormalized);
        var countFloat = original.deepCopy(); ((ObjectNode) countFloat.get("requests").get(0).get("business")).put("copyCount", 2.0); cases.add(countFloat);
        var wrongActor = original.deepCopy(); ((ObjectNode) wrongActor.get("submissions").get(0)).put("applicantId", "404"); cases.add(wrongActor);
        var unknownField = original.deepCopy(); ((ObjectNode) unknownField.get("requests").get(0).get("business")).putNull("total"); cases.add(unknownField);
        for (ObjectNode root : cases) {
            byte[] bytes = mapper.writeValueAsBytes(root); Files.write(path, bytes);
            assertThrows(IOException.class, () -> open(path, initial(2)));
            assertArrayEquals(bytes, Files.readAllBytes(path)); assertTrue(backupContents().isEmpty());
        }
    }

    private Map<Path, byte[]> backupContents() throws IOException {
        var backups = new HashMap<Path, byte[]>();
        try (var files = Files.list(dir)) {
            for (Path path : files.filter(p -> p.toString().endsWith(".bak")).toList()) backups.put(path, Files.readAllBytes(path));
        }
        return backups;
    }
    private void assertBackupsEqual(Map<Path, byte[]> expected) throws IOException {
        var actual = backupContents(); assertEquals(expected.keySet(), actual.keySet());
        for (var entry : expected.entrySet()) assertArrayEquals(entry.getValue(), actual.get(entry.getKey()));
    }
}
