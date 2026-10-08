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
    private record SubmissionScope(String applicantId, String key) {}
    private record SubmissionBinding(String applicantId, String key, String requestId) {}
    private record KeyedSnapshot(int schemaVersion, ProcessDefinition definition, List<Request> requests,
                                 List<SubmissionBinding> submissions) {}
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
    private final Map<String, NavigableMap<InboxQuery.Position, Request>> pendingInbox = new HashMap<>();
    private final Map<String, NavigableMap<InboxQuery.Position, Request>> handledInbox = new HashMap<>();
    private Map<SubmissionScope, String> submissions = new LinkedHashMap<>();
    private ProcessDefinition definition;
    private byte[] previousSchemaOriginal;
    private int snapshotSchema = 2;
    private Path migrationBackup;
    private boolean closed;

    public JsonApprovalStore(ObjectMapper mapper, String filename, ProcessDefinition initialDefinition) throws IOException {
        ProcessDefinition.validate(initialDefinition);
        this.definition = initialDefinition;
        this.snapshotSchema = initialDefinition.schemaVersion();
        this.mapper = ApprovalService.strictMapper(mapper.copy());
        this.file = Path.of(filename).toAbsolutePath();
        Files.createDirectories(file.getParent());
        lockChannel = FileChannel.open(file.resolveSibling(file.getFileName() + ".lock"), StandardOpenOption.CREATE, StandardOpenOption.WRITE);
        FileLock acquired = null;
        try {
            acquired = lockChannel.tryLock();
            if (acquired == null) throw new IOException("Another process owns the approval data file");
            if (Files.exists(file)) {
                restore(Files.readAllBytes(file));
                if (!definition.id().equals(initialDefinition.id())) throw new IOException("Snapshot belongs to a different process");
            }
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

    @Override public synchronized List<Request> inbox(InboxQuery query) throws IOException {
        ensureOpen(); Objects.requireNonNull(query, "query");
        var index = (query.bucket() == InboxQuery.Bucket.PENDING ? pendingInbox : handledInbox).get(query.actor());
        if (index == null) return List.of();
        var candidates = query.after() == null ? index : index.tailMap(query.after(), false);
        var rows = new ArrayList<Request>();
        for (Request request : candidates.values()) {
            if (query.acceptsFilters(request)) rows.add(request);
            if (rows.size() == query.limit() + 1) break;
        }
        return List.copyOf(rows);
    }

    @Override public synchronized Request submission(String applicantId, String key) throws IOException {
        ensureOpen();
        validateScope(applicantId, key);
        String id = submissions.get(new SubmissionScope(applicantId, key));
        return id == null ? null : requests.get(id);
    }

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

    @Override public synchronized Request create(int expectedProcessVersion, Request request, String key) throws IOException {
        ensureOpen();
        validateScope(request.applicantId(), key);
        Request prior = submission(request.applicantId(), key);
        if (prior != null) return prior;
        if (definition.version() != expectedProcessVersion) return null;
        ApprovalService.validateRequest(request);
        if (request.history().size() != 1 || !definition.equals(request.definition()) || requests.containsKey(request.id()))
            throw new IllegalArgumentException("Invalid new request");
        var nextRequests = new LinkedHashMap<>(requests); nextRequests.put(request.id(), request);
        var nextSubmissions = new LinkedHashMap<>(submissions);
        nextSubmissions.put(new SubmissionScope(request.applicantId(), key), request.id());
        commit(definition, nextRequests, nextSubmissions);
        return request;
    }

    private static void validateScope(String applicantId, String key) {
        if (!ProcessDefinition.validActorId(applicantId) || !ApprovalService.validSubmissionKey(key))
            throw new IllegalArgumentException("Invalid submission key scope");
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
            List<SubmissionBinding> bindings = List.of();
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
                // No rewrite until a successful mutation is requested.
            } else if (schema >= 2 && schema <= 7) {
                if (schema >= 4) exactFields(root, "schemaVersion", "definition", "requests", "submissions");
                else exactFields(root, "schemaVersion", "definition", "requests");
                validateStoredShapes(root, true);
                if (schema >= 4) {
                    if (!root.path("submissions").isArray()) throw new IOException("Invalid submission binding collection");
                    for (JsonNode binding : root.get("submissions")) exactFields(binding, "applicantId", "key", "requestId");
                    KeyedSnapshot snapshot = mapper.treeToValue(root, KeyedSnapshot.class);
                    definition = snapshot.definition(); restored = snapshot.requests(); bindings = snapshot.submissions();
                } else {
                    Snapshot snapshot = mapper.treeToValue(root, Snapshot.class);
                    definition = snapshot.definition(); restored = snapshot.requests();
                }
                ProcessDefinition.validate(definition);
                if (definition.schemaVersion() > schema || restored.stream().anyMatch(r -> r.definition().schemaVersion() > schema))
                    throw new IOException("Definition exceeds snapshot schema");
            } else throw new IOException("Unsupported snapshot schema");
            snapshotSchema = schema;
            if (schema < 7) previousSchemaOriginal = bytes.clone();
            for (Request r : restored) {
                ApprovalService.validateRequest(r);
                if (!r.processId().equals(definition.id()) || r.processVersion() > definition.version() || requests.putIfAbsent(r.id(), r) != null)
                    throw new IllegalArgumentException("Duplicate request or future process version");
                indexRequest(r, true);
            }
            var boundRequests = new HashSet<String>();
            for (SubmissionBinding binding : bindings) {
                validateScope(binding.applicantId(), binding.key());
                Request request = requests.get(binding.requestId());
                if (request == null || !binding.applicantId().equals(request.applicantId()) ||
                    !boundRequests.add(binding.requestId()) ||
                    submissions.putIfAbsent(new SubmissionScope(binding.applicantId(), binding.key()), binding.requestId()) != null)
                    throw new IllegalArgumentException("Invalid or duplicate submission binding");
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
            if (root.path("schemaVersion").intValue() >= 5 && r.has("business")) {
                if (!r.get("business").isObject()) throw new IOException("Invalid business document");
                if (root.path("schemaVersion").intValue() < 6 && "quoteDiscount".equals(r.get("business").path("type").asText()))
                    throw new IOException("Quote discounts require snapshot schema 6");
                if (root.path("schemaVersion").intValue() < 7 && "expense".equals(r.get("business").path("type").asText()))
                    throw new IOException("Expense documents require snapshot schema 7");
                fields.add("business");
            }
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
        for (JsonNode n : d.get("nodes")) {
            if ("parallelApproval".equals(n.path("type").asText()))
                exactFields(n, "id", "type", "name", "assigneeId", "assigneeIds", "completionMode");
            else exactFields(n, "id", "type", "name", "assigneeId");
        }
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
        commit(nextDefinition, updated, submissions);
    }

    private void commit(ProcessDefinition nextDefinition, Map<String, Request> updated, Map<SubmissionScope, String> nextSubmissions) throws IOException {
        if (closed) throw new IOException("Approval store is closed");
        int nextSchema = Math.max(2, Math.max(snapshotSchema, nextDefinition.schemaVersion()));
        if (updated.values().stream().anyMatch(r -> r.definition().schemaVersion() == 3)) nextSchema = Math.max(3, nextSchema);
        if (!nextSubmissions.isEmpty()) nextSchema = Math.max(4, nextSchema);
        if (updated.values().stream().anyMatch(r -> r.business() != null)) nextSchema = Math.max(5, nextSchema);
        if (updated.values().stream().anyMatch(r -> r.business() instanceof BusinessDocument.QuoteDiscount)) nextSchema = Math.max(6, nextSchema);
        if (updated.values().stream().anyMatch(r -> r.business() instanceof BusinessDocument.Expense)) nextSchema = Math.max(7, nextSchema);
        Object snapshot = nextSchema >= 4
            ? new KeyedSnapshot(nextSchema, nextDefinition, List.copyOf(updated.values()), nextSubmissions.entrySet().stream()
                .map(e -> new SubmissionBinding(e.getKey().applicantId(), e.getKey().key(), e.getValue())).toList())
            : new Snapshot(nextSchema, nextDefinition, List.copyOf(updated.values()));
        byte[] json = mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(snapshot);
        if (previousSchemaOriginal != null && snapshotSchema < nextSchema && migrationBackup == null) {
            // Preserve the byte-exact original separately; never delete an existing migration backup.
            Path backup = file.resolveSibling(file.getFileName() + ".schema" + snapshotSchema + ".bak");
            if (Files.exists(backup)) backup = Files.createTempFile(file.getParent(), file.getFileName() + ".schema" + snapshotSchema + "-", ".bak");
            else if (Files.getFileStore(file.getParent()).supportsFileAttributeView("posix"))
                Files.createFile(backup, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
            else Files.createFile(backup);
            writeForced(backup, previousSchemaOriginal);
            migrationBackup = backup;
        }
        Path temp = Files.createTempFile(file.getParent(), "approval-", ".tmp");
        try {
            writeForced(temp, json);
            // No non-atomic fallback: fail closed on unsupported file systems.
            Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            definition = nextDefinition;
            // Publish derived indexes only after the same durable state publication succeeds.
            for (Request next : updated.values()) {
                Request previous = requests.get(next.id());
                if (previous == next) continue;
                if (previous != null) indexRequest(previous, false);
                indexRequest(next, true);
            }
            requests = new LinkedHashMap<>(updated); // Publish only after persistence succeeds.
            submissions = new LinkedHashMap<>(nextSubmissions);
            snapshotSchema = nextSchema;
            previousSchemaOriginal = nextSchema < 7 ? json.clone() : null;
            migrationBackup = null;
        } finally { Files.deleteIfExists(temp); }
    }

    private void indexRequest(Request request, boolean add) {
        InboxQuery.Position position = InboxQuery.position(request);
        for (InboxQuery.Member member : InboxQuery.members(request)) {
            if (member.pending()) indexMember(pendingInbox, member.actorId(), position, request, add);
            if (member.handled()) indexMember(handledInbox, member.actorId(), position, request, add);
        }
    }

    private static void indexMember(Map<String, NavigableMap<InboxQuery.Position, Request>> index,
                                    String actor, InboxQuery.Position position, Request request, boolean add) {
        if (add) index.computeIfAbsent(actor, ignored -> new TreeMap<>((a, b) -> InboxQuery.comparePositions(b, a)))
            .put(position, request);
        else {
            var entries = index.get(actor);
            if (entries != null) { entries.remove(position); if (entries.isEmpty()) index.remove(actor); }
        }
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
