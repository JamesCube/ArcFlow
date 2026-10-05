package com.arcflow.approval;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.cfg.CoercionAction;
import com.fasterxml.jackson.databind.cfg.CoercionInputShape;
import com.fasterxml.jackson.databind.type.LogicalType;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Instant;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Human approval policy, sequential stages and parallel groups; persistence is supplied through ApprovalStore. */
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
    private final ActorDirectory actors;
    private final ApprovalStore store;

    /** Backward-compatible, single-process JSON demonstration persistence. */
    public ApprovalService(ObjectMapper mapper, String filename, ActorDirectory actors, ProcessDefinition initialDefinition) throws IOException {
        this.actors = Objects.requireNonNull(actors, "actors");
        this.store = new JsonApprovalStore(mapper, filename, initialDefinition);
    }

    /** The service owns the store lifecycle; the host supplies authenticated actor identities. */
    public ApprovalService(ApprovalStore store, ActorDirectory actors) {
        this.store = Objects.requireNonNull(store, "store");
        this.actors = Objects.requireNonNull(actors, "actors");
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

    public ProcessDefinition process() {
        try { return store.process(); }
        catch (IOException e) { throw new UncheckedIOException("Cannot read approval process", e); }
    }

    public ProcessDefinition publish(String actor, int expectedVersion, ProcessDefinition proposed) throws IOException {
        requirePerson(actor);
        if (!actors.canPublish(actor)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Process publication is not permitted");
        try { ProcessDefinition.validate(proposed); }
        catch (IllegalArgumentException ex) { throw badRequest(ex.getMessage()); }
        requireActiveAssignees(proposed);
        var definition = store.process();
        if (expectedVersion != definition.version() || proposed.version() != expectedVersion)
            throw conflict("The published process changed; reload before publishing");
        if (definition.version() == Integer.MAX_VALUE) throw conflict("Process version limit reached");
        var next = new ProcessDefinition(proposed.schemaVersion(), definition.id(), definition.version() + 1, proposed.name(), proposed.nodes());
        if (!store.publish(actor, expectedVersion, next))
            throw conflict("The published process changed; reload before publishing");
        return next;
    }

    public List<Request> list(String actor) {
        requirePerson(actor);
        try { return store.requests().stream().filter(r -> visibleTo(r, actor)).toList(); }
        catch (IOException e) { throw new UncheckedIOException("Cannot read approval requests", e); }
    }

    public Request submit(String actor, String title, String reason, int days, int processVersion) throws IOException {
        requirePerson(actor);
        var definition = store.process();
        if (processVersion != definition.version()) throw conflict("The published process changed; reload before submitting");
        requireActiveAssignees(definition);
        if (definition.approvals().stream().anyMatch(n -> n.participants().contains(actor)))
            throw badRequest("You cannot submit to a process that assigns you any approval step");
        if (!validText(title, 120) || !validText(reason, 2000) || days < 1 || days > 365)
            throw badRequest("Invalid leave submission");
        // The real, unchanged ArcFlow core still performs the validate → normalize DAG.
        var normalized = SubmissionWorkflow.execute(title, reason, days);
        String now = Instant.now().toString();
        var first = definition.approvals().get(0);
        Request r = new Request(UUID.randomUUID().toString(), normalized.get("title"), normalized.get("reason"), days, actor, first.participants().get(0),
            "PENDING", now, now, null, null, definition.id(), definition.version(),
            List.of(new Event(actor, "SUBMIT", "", now, null)), definition, first.id());
        if (!store.create(processVersion, r))
            throw conflict("The published process changed; reload before submitting");
        return r;
    }

    public Request decide(String actor, String id, String stepId, String decision, String comment) throws IOException {
        // Keep writes bounded. A competing copy of this actor's command can win the last CAS,
        // so the final iteration must still reauthorize and observe durable replay, without writing.
        final int maxWriteAttempts = 16;
        for (int attempt = 0; attempt <= maxWriteAttempts; attempt++) {
            requirePerson(actor);
            Request old = id == null ? null : store.request(id);
            // Conceal existence from unrelated users, then authorize this exact snapshotted step before replay lookup.
            if (old == null || !visibleTo(old, actor))
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Request not found");
            var steps = old.definition().approvals();
            var step = steps.stream().filter(n -> n.id().equals(stepId)).findFirst()
                .orElseThrow(() -> conflict("Step does not belong to this request"));
            if (!step.participants().contains(actor))
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only this step's assigned participants may decide");
            if (!("APPROVE".equals(decision) || "REJECT".equals(decision))) throw badRequest("Invalid decision");
            if (comment != null && comment.length() > 2000) throw badRequest("Comment must be at most 2000 characters");
            var prior = old.history().stream().filter(e -> stepId.equals(e.stepId()) && actor.equals(e.actorId())).findFirst();
            if (prior.isPresent()) {
                if (decision.equals(prior.get().action())) return old;
                throw conflict("This step already has a different decision");
            }
            if (!"PENDING".equals(old.status())) throw conflict("Request is already terminal");
            if (!stepId.equals(old.currentStepId())) throw conflict("This approval step is not current");
            if (attempt == maxWriteAttempts) break; // Final observation only; never a seventeenth write.
            Instant timestamp = Instant.now();
            if (timestamp.isBefore(Instant.parse(old.updatedAt()))) timestamp = Instant.parse(old.updatedAt());
            String now = timestamp.toString();
            String cleanComment = comment == null ? "" : comment.trim();
            var history = new ArrayList<>(old.history());
            history.add(new Event(actor, decision, cleanComment, now, stepId));
            Progress progress = replay(old.definition(), history);
            boolean pending = "PENDING".equals(progress.status);
            Request next = new Request(old.id(), old.title(), old.reason(), old.days(), old.applicantId(),
                pending ? progress.pendingActors().get(0) : actor, progress.status, old.createdAt(), now, decision, cleanComment,
                old.processId(), old.processVersion(), history, old.definition(), progress.currentStepId());
            if (store.update(old.history().size() - 1, next)) return next;
        }
        throw conflict("The request changed concurrently; retry the decision");
    }

    /** Replays every participant vote and checks derived state instead of trusting saved fields. */
    public static void validateRequest(Request r) {
        if (r == null || r.id() == null || !r.id().matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}") ||
            !validText(r.title(), 120) || !validText(r.reason(), 2000) || r.days() < 1 || r.days() > 365 || !ProcessDefinition.validActorId(r.applicantId()))
            throw new IllegalArgumentException("Invalid request fields");
        ProcessDefinition.validate(r.definition());
        if (!r.definition().id().equals(r.processId()) || r.definition().version() != r.processVersion() ||
            r.definition().approvals().stream().anyMatch(n -> n.participants().contains(r.applicantId())) ||
            r.history() == null || r.history().isEmpty()) throw new IllegalArgumentException("Invalid request process");
        Event first = r.history().get(0);
        Instant priorTime = Instant.parse(r.createdAt());
        if (first == null || !"SUBMIT".equals(first.action()) || !r.applicantId().equals(first.actorId()) ||
            !r.createdAt().equals(first.at()) || !"".equals(first.comment()) || first.stepId() != null)
            throw new IllegalArgumentException("Invalid submission event");
        Progress progress = new Progress(r.definition());
        for (int i = 1; i < r.history().size(); i++) {
            Event e = r.history().get(i);
            progress.apply(e);
            Instant at = Instant.parse(e.at());
            if (at.isBefore(priorTime)) throw new IllegalArgumentException("Out-of-order event time");
            priorTime = at;
        }
        Event last = r.history().get(r.history().size() - 1);
        String approver = "PENDING".equals(progress.status) ? progress.pendingActors().get(0) : last.actorId();
        boolean noDecisions = r.history().size() == 1;
        if (!progress.status.equals(r.status()) || !Objects.equals(progress.currentStepId(), r.currentStepId()) || !approver.equals(r.approverId()) ||
            !last.at().equals(r.updatedAt()) || !Objects.equals(noDecisions ? null : last.action(), r.decision()) ||
            !Objects.equals(noDecisions ? null : last.comment(), r.comment()))
            throw new IllegalArgumentException("Saved state does not match its history");
    }

    /** Full current worklist; approverId is only the first pending participant for compatibility. */
    public static List<String> pendingApproverIds(Request request) {
        validateRequest(request);
        return replay(request.definition(), request.history()).pendingActors();
    }

    private static Progress replay(ProcessDefinition definition, List<Event> history) {
        Progress progress = new Progress(definition);
        for (int i = 1; i < history.size(); i++) progress.apply(history.get(i));
        return progress;
    }

    /** One deterministic reducer shared by live transitions and all storage validation. */
    private static final class Progress {
        private final List<ProcessDefinition.ProcessNode> steps;
        private final Set<String> voted = new HashSet<>();
        private int index;
        private String status = "PENDING";
        Progress(ProcessDefinition definition) { steps = definition.approvals(); }
        String currentStepId() { return "PENDING".equals(status) ? steps.get(index).id() : null; }
        List<String> pendingActors() {
            return "PENDING".equals(status)
                ? steps.get(index).participants().stream().filter(id -> !voted.contains(id)).toList() : List.of();
        }
        void apply(Event event) {
            if (event == null || !"PENDING".equals(status)) throw new IllegalArgumentException("Extra decision event");
            var step = steps.get(index);
            if (!step.id().equals(event.stepId()) || !step.participants().contains(event.actorId()) ||
                !("APPROVE".equals(event.action()) || "REJECT".equals(event.action())) ||
                event.comment() == null || event.comment().length() > 2000 || !voted.add(event.actorId()))
                throw new IllegalArgumentException("Invalid or repeated participant decision");
            boolean approve = "APPROVE".equals(event.action());
            boolean all = "ALL".equals(step.mode());
            boolean everyoneVoted = voted.size() == step.participants().size();
            if ((all && !approve) || (!all && !approve && everyoneVoted)) status = "REJECTED";
            else if ((!all && approve) || (all && everyoneVoted)) {
                index++;
                voted.clear();
                if (index == steps.size()) status = "APPROVED";
            }
        }
    }

    /** A persistence adapter must accept only one append-only transition from the expected revision. */
    public static void validateTransition(Request old, Request next) {
        validateRequest(old);
        validateRequest(next);
        if (!Objects.equals(old.id(), next.id()) || !Objects.equals(old.title(), next.title()) ||
            !Objects.equals(old.reason(), next.reason()) || old.days() != next.days() ||
            !Objects.equals(old.applicantId(), next.applicantId()) || !Objects.equals(old.createdAt(), next.createdAt()) ||
            !Objects.equals(old.definition(), next.definition()) || !"PENDING".equals(old.status()) ||
            next.history().size() != old.history().size() + 1 ||
            !next.history().subList(0, old.history().size()).equals(old.history()))
            throw new IllegalArgumentException("Request updates must append exactly one decision without rewriting prior state");
    }

    private static boolean visibleTo(Request r, String actor) {
        return r.applicantId().equals(actor) || r.definition().approvals().stream().anyMatch(n -> n.participants().contains(actor));
    }
    private static boolean validText(String value, int max) { return value != null && !value.isBlank() && value.length() <= max; }
    private void requirePerson(String actor) {
        if (!ProcessDefinition.validActorId(actor) || actors.findActive(actor).filter(p -> actor.equals(p.id())).isEmpty())
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Unknown or inactive user");
    }
    private void requireActiveAssignees(ProcessDefinition proposed) {
        for (var step : proposed.approvals()) {
            for (String id : step.participants()) {
                if (actors.findActive(id).filter(p -> id.equals(p.id())).isEmpty() || !actors.canAssignApproval(id))
                    throw badRequest("Every approval participant must be an active eligible user");
            }
        }
    }
    private static ResponseStatusException badRequest(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
    private static ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }
    @Override public void close() throws IOException { store.close(); }
}
