package com.arcflow.approval;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class JsonSchemaUpgradeTest {
    @TempDir Path directory;
    final ObjectMapper mapper = new ObjectMapper();
    final ActorDirectoryTest.Directory users = new ActorDirectoryTest.Directory();
    JsonSchemaUpgradeTest() { users.active.addAll(List.of("303", "404")); }
    Path file() { return directory.resolve("state.json"); }
    Path backup() { return directory.resolve("state.json.schema2.bak"); }
    ApprovalService open() throws IOException { return new ApprovalService(mapper, file().toString(), users, sequential()); }
    ProcessDefinition sequential() {
        return new ProcessDefinition(2, "leave-approval", 1, "Original sequence", List.of(
            new ProcessDefinition.ProcessNode("start", "start", "Start", null),
            new ProcessDefinition.ProcessNode("manager", "approval", "Manager", "202"),
            new ProcessDefinition.ProcessNode("final", "approval", "Final", "303"),
            new ProcessDefinition.ProcessNode("end", "end", "End", null)));
    }
    ApprovalService.Request pending(ApprovalService service) throws IOException {
        var request = service.submit("101", "Old leave", "Rest", 1, 1);
        return service.decide("202", request.id(), "manager", "APPROVE", "Before upgrade");
    }

    @Test void pendingSchemaTwoRequestCompletesAfterSchemaThreePublicationAndRestart() throws Exception {
        ApprovalService.Request old;
        ApprovalService.Request group;
        byte[] priorBytes;
        try (var service = open()) {
            old = pending(service); priorBytes = Files.readAllBytes(file());
            var published = service.publish("1", 1, ParallelApprovalTest.definition("ALL", false));
            assertEquals(3, published.schemaVersion()); assertEquals(2, published.version());
            group = service.submit("101", "New group", "Rest", 1, 2);
            assertEquals(old, service.list("101").get(0));
            assertArrayEquals(priorBytes, Files.readAllBytes(backup()));
        }
        try (var service = open()) {
            assertEquals(3, service.process().schemaVersion()); assertEquals(old, service.list("101").get(0));
            var complete = service.decide("303", old.id(), "final", "APPROVE", "After upgrade");
            assertEquals("APPROVED", complete.status()); assertEquals(sequential(), complete.definition());
            assertEquals(3, complete.history().size());
            assertEquals(complete, service.decide("202", old.id(), "manager", "APPROVE", "replay"));
            assertEquals(group, service.list("101").get(1));
        }
        try (var service = open()) {
            assertEquals("APPROVED", service.list("101").get(0).status());
            assertEquals(group, service.list("101").get(1));
            assertArrayEquals(priorBytes, Files.readAllBytes(backup()));
        }
    }

    @Test void existingBackupIsPreservedAndUpgradeCreatesOneByteExactPrivateBackup() throws Exception {
        byte[] retained = "Older backup must not be replaced".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        Files.write(backup(), retained);
        try (var service = open()) {
            pending(service); byte[] beforeUpgrade = Files.readAllBytes(file());
            service.publish("1", 1, ParallelApprovalTest.definition("ANY", false));
            assertArrayEquals(retained, Files.readAllBytes(backup()));
            var alternatives = migrationBackups(); assertEquals(1, alternatives.size());
            assertArrayEquals(beforeUpgrade, Files.readAllBytes(alternatives.get(0)));
            if (Files.getFileStore(alternatives.get(0)).supportsFileAttributeView("posix"))
                assertEquals(PosixFilePermissions.fromString("rw-------"), Files.getPosixFilePermissions(alternatives.get(0)));
        }
        try (var service = open()) { assertEquals(3, service.process().schemaVersion()); }
    }

    @Test void failedAtomicReplaceAfterBackupCanRetryWithoutChangingOldStateOrDuplicatingBackup() throws Exception {
        ApprovalService.Request original;
        byte[] beforeUpgrade;
        try (var service = open()) {
            original = pending(service); beforeUpgrade = Files.readAllBytes(file());
            Path saved = directory.resolve("saved.json"); Files.move(file(), saved); Files.createDirectory(file());
            try {
                assertThrows(IOException.class, () -> service.publish("1", 1, ParallelApprovalTest.definition("ALL", false)));
                assertEquals(sequential(), service.process()); assertEquals(original, service.list("101").get(0));
                assertArrayEquals(beforeUpgrade, Files.readAllBytes(backup()));
                assertArrayEquals(beforeUpgrade, Files.readAllBytes(saved));
                assertTrue(migrationBackups().isEmpty());
            } finally { Files.delete(file()); Files.move(saved, file()); }
            // Same open store retries the publication after the target path is repaired.
            service.publish("1", 1, ParallelApprovalTest.definition("ALL", false));
            assertEquals(original, service.list("101").get(0));
            assertArrayEquals(beforeUpgrade, Files.readAllBytes(backup()));
            assertTrue(migrationBackups().isEmpty());
            assertEquals(3, mapper.readTree(Files.readAllBytes(file())).path("schemaVersion").intValue());
        }
        try (var service = open()) {
            assertEquals(original, service.list("101").get(0));
            assertEquals("APPROVED", service.decide("303", original.id(), "final", "APPROVE", "Resumed").status());
            assertArrayEquals(beforeUpgrade, Files.readAllBytes(backup()));
        }
    }

    private List<Path> migrationBackups() throws IOException {
        try (var files = Files.list(directory)) {
            return files.filter(p -> p.getFileName().toString().startsWith("state.json.schema2-") && p.toString().endsWith(".bak")).toList();
        }
    }
}
