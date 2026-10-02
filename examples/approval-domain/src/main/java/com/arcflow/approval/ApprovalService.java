package com.arcflow.approval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.cfg.CoercionAction;
import com.fasterxml.jackson.databind.cfg.CoercionInputShape;
import com.fasterxml.jackson.databind.type.LogicalType;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Instant;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Local demonstration store. One process holds an exclusive lock; every mutation is serialized. */
public class ApprovalService implements AutoCloseable {
    public record Person(String id, String displayName) {}
    public record Event(String actorId, String action, String comment, String at, String stepId) {}
    public record Request(String id, String title, String reason, int days, String applicantId, String approverId,
                          String status, String createdAt, String updatedAt, String decision, String comment,
                          String processId, int processVersion, List<Event> history,
                          ProcessDefinition definition, String currentStepId) {
        public Request { if (history != null) history = List.copyOf(history); }
    }
    public record Snapshot(int schemaVersion, ProcessDefinition definition, List<Request> requests) {}
    private record LegacyEvent(String actorId, String action, String comment, String at) {}
    private record LegacyRequest(String id, String title, String reason, int days, String applicantId, String approverId,
                                 String status, String createdAt, String updatedAt, String decision, String comment,
                                 String processId, int processVersion, List<LegacyEvent> history) {}
    private record LegacySnapshot(int schemaVersion, List<LegacyRequest> requests) {}
    private final ActorDirectory actors;
    private final ObjectMapper mapper;
    private final Path file;
    private final FileChannel lockChannel;
    private final FileLock lock;
    private Map<String, Request> requests = new LinkedHashMap<>();
    private ProcessDefinition definition;
    private byte[] legacyOriginal;
    private Path legacyBackup;
    private boolean closed;

    public ApprovalService(ObjectMapper mapper, String filename, ActorDirectory actors, ProcessDefinition initialDefinition) throws IOException {
        this.actors = Objects.requireNonNull(actors, "actors");
        ProcessDefinition.validate(initialDefinition);
        this.definition = initialDefinition;
        this.mapper = strictMapper(mapper.copy());
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

    /** Keep file and HTTP decoding strict, including scalar types and duplicate JSON keys. */
    public static ObjectMapper strictMapper(ObjectMapper mapper) {
        mapper.enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES,
            DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
        mapper.disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT);
        mapper.enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION.mappedFeature());
        for (var shape : List.of(CoercionInputShape.Integer, CoercionInputShape.Float, CoercionInputShape.Boolean))
            mapper.coercionConfigFor(LogicalType.Textual).setCoercion(shape, CoercionAction.Fail);
        for (var shape : List.of(CoercionInputShape.String, CoercionInputShape.Boolean, CoercionInputShape.EmptyString))
            mapper.coercionConfigFor(LogicalType.Integer).setCoercion(shape, CoercionAction.Fail);
        return mapper;
    }

    public synchronized ProcessDefinition process() { return definition; }

    public synchronized ProcessDefinition publish(String actor, int expectedVersion, ProcessDefinition proposed) throws IOException {
        requirePerson(actor);
        if (!actors.canPublish(actor)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Process publication is not permitted");
        try { ProcessDefinition.validate(proposed); }
        catch (IllegalArgumentException ex) { throw badRequest(ex.getMessage()); }
        requireActiveAssignees(proposed);
        if (expectedVersion != definition.version() || proposed.version() != expectedVersion)
            throw conflict("The published process changed; reload before publishing");
        if (definition.version() == Integer.MAX_VALUE) throw conflict("Process version limit reached");
        var next = new ProcessDefinition(2, definition.id(), definition.version() + 1, proposed.name(), proposed.nodes());
        commit(next, requests);
        return next;
    }

    public synchronized List<Request> list(String actor) {
        requirePerson(actor);
        return requests.values().stream().filter(r -> visibleTo(r, actor)).toList();
    }

    public synchronized Request submit(String actor, String title, String reason, int days, int processVersion) throws IOException {
        requirePerson(actor);
        if (processVersion != definition.version()) throw conflict("The published process changed; reload before submitting");
        requireActiveAssignees(definition);
        if (definition.approvals().stream().anyMatch(n -> actor.equals(n.assigneeId())))
            throw badRequest("You cannot submit to a process that assigns you any approval step");
        if (!validText(title, 120) || !validText(reason, 2000) || days < 1 || days > 365)
            throw badRequest("Invalid leave submission");
        // The real, unchanged ArcFlow core still performs the validate → normalize DAG.
        var normalized = SubmissionWorkflow.execute(title, reason, days);
        String now = Instant.now().toString();
        var first = definition.approvals().get(0);
        Request r = new Request(UUID.randomUUID().toString(), normalized.get("title"), normalized.get("reason"), days, actor, first.assigneeId(),
            "PENDING", now, now, null, null, definition.id(), definition.version(),
            List.of(new Event(actor, "SUBMIT", "", now, null)), definition, first.id());
        commitRequest(r);
        return r;
    }

    public synchronized Request decide(String actor, String id, String stepId, String decision, String comment) throws IOException {
        requirePerson(actor);
        Request old = requests.get(id);
        // Conceal existence from unrelated users, then authorize this exact snapshotted step before replay lookup.
        if (old == null || !visibleTo(old, actor))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Request not found");
        var steps = old.definition().approvals();
        var step = steps.stream().filter(n -> n.id().equals(stepId)).findFirst()
            .orElseThrow(() -> conflict("Step does not belong to this request"));
        if (!step.assigneeId().equals(actor))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only this step's assigned approver may decide");
        if (!("APPROVE".equals(decision) || "REJECT".equals(decision))) throw badRequest("Invalid decision");
        if (comment != null && comment.length() > 2000) throw badRequest("Comment must be at most 2000 characters");
        var prior = old.history().stream().filter(e -> stepId.equals(e.stepId())).findFirst();
        if (prior.isPresent()) {
            if (decision.equals(prior.get().action())) return old;
            throw conflict("This step already has a different decision");
        }
        if (!"PENDING".equals(old.status())) throw conflict("Request is already terminal");
        if (!stepId.equals(old.currentStepId())) throw conflict("This approval step is not current");
        Instant timestamp = Instant.now();
        if (timestamp.isBefore(Instant.parse(old.updatedAt()))) timestamp = Instant.parse(old.updatedAt());
        String now = timestamp.toString();
        String cleanComment = comment == null ? "" : comment.trim();
        var history = new ArrayList<>(old.history());
        history.add(new Event(actor, decision, cleanComment, now, stepId));
        int nextIndex = steps.indexOf(step) + 1;
        boolean pending = "APPROVE".equals(decision) && nextIndex < steps.size();
        String status = pending ? "PENDING" : "APPROVE".equals(decision) ? "APPROVED" : "REJECTED";
        var nextStep = pending ? steps.get(nextIndex) : null;
        Request next = new Request(old.id(), old.title(), old.reason(), old.days(), old.applicantId(),
            pending ? nextStep.assigneeId() : actor, status, old.createdAt(), now, decision, cleanComment,
            old.processId(), old.processVersion(), history, old.definition(), pending ? nextStep.id() : null);
        commitRequest(next);
        return next;
    }

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
                validateRequest(r);
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

    /** Replays the complete linear history and checks every derived field instead of trusting saved state. */
    private static void validateRequest(Request r) {
        if (r == null || r.id() == null || !r.id().matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}") ||
            !validText(r.title(), 120) || !validText(r.reason(), 2000) || r.days() < 1 || r.days() > 365 || !ProcessDefinition.validActorId(r.applicantId()))
            throw new IllegalArgumentException("Invalid request fields");
        ProcessDefinition.validate(r.definition());
        if (!r.definition().id().equals(r.processId()) || r.definition().version() != r.processVersion() ||
            r.definition().approvals().stream().anyMatch(n -> r.applicantId().equals(n.assigneeId())) ||
            r.history() == null || r.history().isEmpty()) throw new IllegalArgumentException("Invalid request process");
        var approvals = r.definition().approvals();
        Event first = r.history().get(0);
        Instant priorTime = Instant.parse(r.createdAt());
        if (first == null || !"SUBMIT".equals(first.action()) || !r.applicantId().equals(first.actorId()) ||
            !r.createdAt().equals(first.at()) || !"".equals(first.comment()) || first.stepId() != null)
            throw new IllegalArgumentException("Invalid submission event");
        int completed = 0;
        boolean rejected = false;
        for (int i = 1; i < r.history().size(); i++) {
            Event e = r.history().get(i);
            if (e == null || rejected || completed >= approvals.size()) throw new IllegalArgumentException("Extra decision event");
            var step = approvals.get(completed);
            if (!step.id().equals(e.stepId()) || !step.assigneeId().equals(e.actorId()) ||
                !("APPROVE".equals(e.action()) || "REJECT".equals(e.action())) || e.comment() == null || e.comment().length() > 2000)
                throw new IllegalArgumentException("Invalid decision event");
            Instant at = Instant.parse(e.at());
            if (at.isBefore(priorTime)) throw new IllegalArgumentException("Out-of-order event time");
            priorTime = at;
            rejected = "REJECT".equals(e.action());
            completed++;
        }
        Event last = r.history().get(r.history().size() - 1);
        String status = rejected ? "REJECTED" : completed == approvals.size() ? "APPROVED" : "PENDING";
        boolean pending = "PENDING".equals(status);
        String currentStep = pending ? approvals.get(completed).id() : null;
        String approver = pending ? approvals.get(completed).assigneeId() : last.actorId();
        if (!status.equals(r.status()) || !Objects.equals(currentStep, r.currentStepId()) || !approver.equals(r.approverId()) ||
            !last.at().equals(r.updatedAt()) || !Objects.equals(completed == 0 ? null : last.action(), r.decision()) ||
            !Objects.equals(completed == 0 ? null : last.comment(), r.comment()))
            throw new IllegalArgumentException("Saved state does not match its history");
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
    private static boolean visibleTo(Request r, String actor) {
        return r.applicantId().equals(actor) || r.definition().approvals().stream().anyMatch(n -> n.assigneeId().equals(actor));
    }
    private static boolean validText(String value, int max) { return value != null && !value.isBlank() && value.length() <= max; }
    private void requirePerson(String actor) {
        if (!ProcessDefinition.validActorId(actor) || actors.findActive(actor).filter(p -> actor.equals(p.id())).isEmpty())
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Unknown or inactive user");
    }
    private void requireActiveAssignees(ProcessDefinition proposed) {
        for (var step : proposed.approvals()) {
            String id = step.assigneeId();
            if (actors.findActive(id).filter(p -> id.equals(p.id())).isEmpty() || !actors.canAssignApproval(id))
                throw badRequest("Every approval must be assigned to an active eligible user");
        }
    }
    private static ResponseStatusException badRequest(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
    private static ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }
    @Override public synchronized void close() throws IOException {
        closed = true;
        if (lock.isValid()) lock.release();
        lockChannel.close();
    }
}
