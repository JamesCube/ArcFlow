package com.arcflow.approval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.*;

import com.arcflow.approval.ApprovalService.Request;
import com.arcflow.approval.ApprovalService.Event;
import com.arcflow.approval.ApprovalService.Snapshot;

/** Single-process demonstration store retaining schema migration and atomic file replacement. */
public final class JsonApprovalStore implements ApprovalStore {
    private record LegacyEvent(String actorId, String action, String comment, String at) {}
    private record LegacyRequest(String id, String title, String reason, int days, String applicantId, String approverId,
                                 String status, String createdAt, String updatedAt, String decision, String comment,
                                 String processId, int processVersion, List<LegacyEvent> history) {}
    private record LegacySnapshot(int schemaVersion, List<LegacyRequest> requests) {}
    private final ObjectMapper mapper;
    private final Path file;
    private final FileChannel lockChannel;
    private final FileLock lock;
    private Map<String, Request> requests = new LinkedHashMap<>();
    private ProcessDefinition definition;
    private byte[] legacyOriginal;
    private Path legacyBackup;
    private boolean closed;

    public JsonApprovalStore(ObjectMapper mapper, String filename, ProcessDefinition initialDefinition) throws IOException {
        ProcessDefinition.validate(initialDefinition);
        this.definition = initialDefinition;
        this.mapper = ApprovalService.strictMapper(mapper.copy());
        this.file = Path.of(filename).toAbsolutePath();
        Files.createDirectories(file.getParent());
        lockChannel = FileChannel.open(file.resolveSibling(file.getFileName() + ".lock"), StandardOpenOption.CREATE, StandardOpenOption.WRITE);
        FileLock acquired = null;
        try {
            acquired = lockChannel.tryLock();
            if (acquired == null) throw new IOException("Another process owns the approval data file");
            if (Files.exists(file)) restore(Files.readAllBytes(file));
        } catch (Exception e) {
            if (acquired != null) acquired.release();
            lockChannel.close();
            if (e instanceof IOException io) throw io;
            throw new IOException("Cannot open approval data file", e);
        }
        lock = acquired;
    }

    @Override public synchronized ProcessDefinition process() throws IOException { ensureOpen(); return definition; }
    @Override public synchronized List<Request> requests() throws IOException { ensureOpen(); return List.copyOf(requests.values()); }
    @Override public synchronized Request request(String id) throws IOException { ensureOpen(); return requests.get(id); }

    @Override public synchronized boolean publish(String actor, int expectedVersion, ProcessDefinition next) throws IOException {
        ensureOpen();
        if (definition.version() != expectedVersion) return false;
        ProcessDefinition.validate(next);
        if (!definition.id().equals(next.id()) || expectedVersion == Integer.MAX_VALUE || next.version() != expectedVersion + 1)
            throw new IllegalArgumentException("Invalid process version transition");
        commit(next, requests);
        return true;
    }

    @Override public synchronized boolean create(int expectedProcessVersion, Request request) throws IOException {
        ensureOpen();
        if (definition.version() != expectedProcessVersion) return false;
        ApprovalService.validateRequest(request);
        if (request.history().size() != 1 || !definition.equals(request.definition()) || requests.containsKey(request.id()))
            throw new IllegalArgumentException("Invalid new request");
        commitRequest(request);
        return true;
    }

    @Override public synchronized boolean update(int expectedRevision, Request next) throws IOException {
        ensureOpen();
        Request old = requests.get(next.id());
        if (old == null || old.history().size() - 1 != expectedRevision) return false;
        ApprovalService.validateTransition(old, next);
        commitRequest(next);
        return true;
    }

    private void ensureOpen() throws IOException { if (closed) throw new IOException("Approval store is closed"); }

    private void restore(byte[] bytes) throws IOException {
        try {
            JsonNode root = mapper.readTree(bytes);
            if (root == null || !root.isObject() || !root.path("schemaVersion").isIntegralNumber())
                throw new IOException("Invalid snapshot schema");
            int schema = root.get("schemaVersion").intValue();
            List<Request> restored;
            if (schema == 1) {
                exactFields(root, "schemaVersion", "requests");
                validateStoredShapes(root, false);
                LegacySnapshot legacy = mapper.treeToValue(root, LegacySnapshot.class);
                var migrated = new ArrayList<Request>();
                for (LegacyRequest r : legacy.requests()) {
                    var steps = new ArrayList<Event>();
                    for (LegacyEvent e : r.history()) steps.add(new Event(e.actorId(), e.action(), e.comment(), e.at(),
                        "SUBMIT".equals(e.action()) ? null : "manager"));
                    migrated.add(new Request(r.id(), r.title(), r.reason(), r.days(), r.applicantId(), r.approverId(),
                        r.status(), r.createdAt(), r.updatedAt(), r.decision(), r.comment(), r.processId(), r.processVersion(), steps,
                        ProcessDefinition.legacy(r.approverId()), "PENDING".equals(r.status()) ? "manager" : null));
                }
                restored = migrated;
                legacyOriginal = bytes.clone(); // No rewrite until a successful mutation is requested.
            } else if (schema == 2) {
                exactFields(root, "schemaVersion", "definition", "requests");
                validateStoredShapes(root, true);
                Snapshot snapshot = mapper.treeToValue(root, Snapshot.class);
                definition = snapshot.definition();
                ProcessDefinition.validate(definition);
                restored = snapshot.requests();
            } else throw new IOException("Unsupported snapshot schema");
            for (Request r : restored) {
                ApprovalService.validateRequest(r);
                if (r.processVersion() > definition.version() || requests.putIfAbsent(r.id(), r) != null)
                    throw new IllegalArgumentException("Duplicate request or future process version");
            }
        } catch (RuntimeException e) { throw new IOException("Invalid snapshot entry", e); }
    }

    private static void validateStoredShapes(JsonNode root, boolean current) throws IOException {
        JsonNode records = root.get("requests");
        if (records == null || !records.isArray()) throw new IOException("Invalid request collection");
        if (current) validateDefinitionShape(root.get("definition"));
        for (JsonNode r : records) {
            var fields = new ArrayList<>(List.of("id", "title", "reason", "days", "applicantId", "approverId", "status", "createdAt",
                "updatedAt", "decision", "comment", "processId", "processVersion", "history"));
            if (current) { fields.add("definition"); fields.add("currentStepId"); validateDefinitionShape(r.get("definition")); }
            exactFields(r, fields.toArray(String[]::new));
            if (!r.path("history").isArray()) throw new IOException("Invalid history collection");
            for (JsonNode e : r.get("history")) {
                if (current) exactFields(e, "actorId", "action", "comment", "at", "stepId");
                else exactFields(e, "actorId", "action", "comment", "at");
            }
        }
    }

    private static void validateDefinitionShape(JsonNode d) throws IOException {
        exactFields(d, "schemaVersion", "id", "version", "name", "nodes");
        if (!d.path("nodes").isArray()) throw new IOException("Invalid process nodes");
        for (JsonNode n : d.get("nodes")) exactFields(n, "id", "type", "name", "assigneeId");
    }

    private static void exactFields(JsonNode value, String... names) throws IOException {
        if (value == null || !value.isObject()) throw new IOException("Invalid snapshot object");
        var actual = new HashSet<String>(); value.fieldNames().forEachRemaining(actual::add);
        if (!actual.equals(Set.of(names))) throw new IOException("Missing or unknown snapshot fields");
    }

    private void commitRequest(Request next) throws IOException {
        var updated = new LinkedHashMap<>(requests); updated.put(next.id(), next);
        commit(definition, updated);
    }

    private void commit(ProcessDefinition nextDefinition, Map<String, Request> updated) throws IOException {
        if (closed) throw new IOException("Approval store is closed");
        byte[] json = mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(new Snapshot(2, nextDefinition, List.copyOf(updated.values())));
        if (legacyOriginal != null && legacyBackup == null) {
            // Preserve the byte-exact original separately; never delete an existing migration backup.
            Path backup = file.resolveSibling(file.getFileName() + ".schema1.bak");
            if (Files.exists(backup)) backup = Files.createTempFile(file.getParent(), file.getFileName() + ".schema1-", ".bak");
            else if (Files.getFileStore(file.getParent()).supportsFileAttributeView("posix"))
                Files.createFile(backup, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
            else Files.createFile(backup);
            writeForced(backup, legacyOriginal);
            legacyBackup = backup;
        }
        Path temp = Files.createTempFile(file.getParent(), "approval-", ".tmp");
        try {
            writeForced(temp, json);
            // No non-atomic fallback: fail closed on unsupported file systems.
            Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            definition = nextDefinition;
            requests = new LinkedHashMap<>(updated); // Publish only after persistence succeeds.
            legacyOriginal = null;
        } finally { Files.deleteIfExists(temp); }
    }

    private static void writeForced(Path path, byte[] data) throws IOException {
        try (var channel = FileChannel.open(path, StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING)) {
            var buffer = ByteBuffer.wrap(data); while (buffer.hasRemaining()) channel.write(buffer); channel.force(true);
        }
    }
    @Override public synchronized void close() throws IOException {
        closed = true;
        if (lock.isValid()) lock.release();
        lockChannel.close();
    }
}
