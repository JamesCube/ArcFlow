package com.arcflow.approval;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
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
    @com.fasterxml.jackson.databind.annotation.JsonDeserialize(using = RequestDecoder.class)
    public record Request(String id, String title, String reason, int days, String applicantId, String approverId,
                          String status, String createdAt, String updatedAt, String decision, String comment,
                          String processId, int processVersion, List<Event> history,
                          ProcessDefinition definition, String currentStepId,
                          @JsonInclude(JsonInclude.Include.NON_NULL) BusinessDocument business,
                          @JsonInclude(JsonInclude.Include.NON_NULL) ConditionalRouting.FrozenRoute routing) {
        public Request { if (history != null) history = List.copyOf(history); }
        /** Preserve the existing source API and byte shape for legacy leave requests. */
        public Request(String id, String title, String reason, int days, String applicantId, String approverId,
                       String status, String createdAt, String updatedAt, String decision, String comment,
                       String processId, int processVersion, List<Event> history, ProcessDefinition definition, String currentStepId) {
            this(id, title, reason, days, applicantId, approverId, status, createdAt, updatedAt, decision, comment,
                processId, processVersion, history, definition, currentStepId, null, null);
        }
        public Request(String id, String title, String reason, int days, String applicantId, String approverId,
                       String status, String createdAt, String updatedAt, String decision, String comment,
                       String processId, int processVersion, List<Event> history, ProcessDefinition definition, String currentStepId,
                       BusinessDocument business) {
            this(id, title, reason, days, applicantId, approverId, status, createdAt, updatedAt, decision, comment,
                processId, processVersion, history, definition, currentStepId, business, null);
        }
        private static final ObjectMapper DECODER = strictMapper(new ObjectMapper())
            .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES);
        /** Shape-only tree adapter. Raw transports first enter RequestDecoder to preserve token checks. */
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        public static Request fromJson(JsonNode node) throws IOException {
            var expected = new HashSet<>(List.of("id", "title", "reason", "days", "applicantId", "approverId", "status",
                "createdAt", "updatedAt", "decision", "comment", "processId", "processVersion", "history", "definition", "currentStepId"));
            if (node == null || !node.isObject()) throw new IOException("Invalid request object");
            if (node.has("business")) expected.add("business");
            if (node.has("routing")) expected.add("routing");
            var actual = new HashSet<String>(); node.fieldNames().forEachRemaining(actual::add);
            if (!expected.equals(actual)) throw new IOException("Missing or unknown request fields");
            ObjectMapper decoder = DECODER;
            if (!node.get("history").isArray()) throw new IOException("Invalid request history");
            var events = new ArrayList<Event>();
            for (JsonNode event : node.get("history")) events.add(decoder.treeToValue(event, Event.class));
            BusinessDocument business = null;
            if (node.has("business")) {
                if (node.get("business").isNull()) throw new IOException("Business document must not be null when present");
                business = decoder.treeToValue(node.get("business"), BusinessDocument.class);
            }
            return new Request(string(node,"id"), string(node,"title"), string(node,"reason"), integer(node,"days"),
                string(node,"applicantId"), string(node,"approverId"), string(node,"status"), string(node,"createdAt"),
                string(node,"updatedAt"), string(node,"decision"), string(node,"comment"), string(node,"processId"),
                integer(node,"processVersion"), events, decoder.treeToValue(node.get("definition"), ProcessDefinition.class),
                string(node,"currentStepId"), business, node.has("routing") ? decodeRouting(node.get("routing")) : null);
        }
        private static ConditionalRouting.FrozenRoute decodeRouting(JsonNode node) throws IOException {
            if (!node.isObject()) throw new IOException("Routing must be an object when present");
            return DECODER.treeToValue(node, ConditionalRouting.FrozenRoute.class);
        }
        private static String string(JsonNode node, String key) throws IOException {
            JsonNode value = node.get(key);
            if (!(value.isTextual() || value.isNull())) throw new IOException("Invalid request string: " + key);
            return value.isNull() ? null : value.textValue();
        }
        private static int integer(JsonNode node, String key) throws IOException {
            JsonNode value = node.get(key);
            if (!value.isIntegralNumber() || !value.canConvertToInt()) throw new IOException("Invalid request integer: " + key);
            return value.intValue();
        }
    }
    /** Inspect raw integer tokens before a JsonNode can normalize negative zero to zero. */
    public static final class RequestDecoder extends com.fasterxml.jackson.databind.JsonDeserializer<Request> {
        @Override public Request deserialize(com.fasterxml.jackson.core.JsonParser parser, com.fasterxml.jackson.databind.DeserializationContext context) throws IOException {
            return Request.fromJson(context.readTree(receivingTokenGuard(parser)));
        }
    }
    static com.fasterxml.jackson.core.JsonParser receivingTokenGuard(com.fasterxml.jackson.core.JsonParser parser) {
        return new com.fasterxml.jackson.core.util.JsonParserDelegate(parser) {
            @Override public com.fasterxml.jackson.core.JsonToken nextToken() throws IOException {
                var token = super.nextToken();
                // These fields belong only to receiving; all other registered shapes reject them as unknown.
                if (token == com.fasterxml.jackson.core.JsonToken.VALUE_NUMBER_INT && "-0".equals(getText()) &&
                    currentName() != null && Set.of("ordered", "received", "accepted", "rejected").contains(currentName()))
                    throw com.fasterxml.jackson.databind.JsonMappingException.from(this, "Receiving quantities cannot use negative zero");
                return token;
            }
            @Override public com.fasterxml.jackson.core.JsonToken nextValue() throws IOException {
                var token = nextToken();
                return token == com.fasterxml.jackson.core.JsonToken.FIELD_NAME ? nextToken() : token;
            }
        };
    }
    public record Snapshot(int schemaVersion, ProcessDefinition definition, List<Request> requests) {}
    public record InboxPage(List<Request> items, String nextCursor) {
        public InboxPage { items = List.copyOf(items); }
    }
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
            DeserializationFeature.FAIL_ON_TRAILING_TOKENS, DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
        mapper.disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT);
        for (var shape : List.of(CoercionInputShape.String, CoercionInputShape.Integer, CoercionInputShape.Float, CoercionInputShape.EmptyString))
            mapper.coercionConfigFor(LogicalType.Boolean).setCoercion(shape, CoercionAction.Fail);
        mapper.enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION.mappedFeature());
        for (var shape : List.of(CoercionInputShape.Integer, CoercionInputShape.Float, CoercionInputShape.Boolean))
            mapper.coercionConfigFor(LogicalType.Textual).setCoercion(shape, CoercionAction.Fail);
        for (var shape : List.of(CoercionInputShape.String, CoercionInputShape.Boolean, CoercionInputShape.EmptyString))
            mapper.coercionConfigFor(LogicalType.Integer).setCoercion(shape, CoercionAction.Fail);
        for (var shape : List.of(CoercionInputShape.String, CoercionInputShape.Boolean, CoercionInputShape.EmptyString))
            mapper.coercionConfigFor(LogicalType.Float).setCoercion(shape, CoercionAction.Fail);
        return mapper;
    }

    public ProcessDefinition process() {
        try { return store.process(); }
        catch (IOException e) { throw new UncheckedIOException("Cannot read approval process", e); }
    }

    public ProcessDefinition publish(String actor, int expectedVersion, ProcessDefinition proposed) throws IOException {
        return publish(actor, expectedVersion, proposed, null);
    }

    /** Typed hosts explicitly opt into the restricted condition field family. */
    public ProcessDefinition publishForDocument(String actor, int expectedVersion, ProcessDefinition proposed,
                                                Class<? extends BusinessDocument> type) throws IOException {
        return publish(actor, expectedVersion, proposed, Objects.requireNonNull(type));
    }
    private ProcessDefinition publish(String actor, int expectedVersion, ProcessDefinition proposed,
                                      Class<? extends BusinessDocument> type) throws IOException {
        requirePerson(actor);
        if (!actors.canPublish(actor)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Process publication is not permitted");
        try {
            ProcessDefinition.validate(proposed);
            if (proposed.schemaVersion() == 4 && type == null)
                throw new IllegalArgumentException("Conditional definitions require a dedicated typed scenario host");
            if (type != null) ConditionalRouting.validateForDocument(proposed, type);
        }
        catch (IllegalArgumentException ex) { throw badRequest(ex.getMessage()); }
        requireActiveAssignees(proposed);
        var definition = store.process();
        if (!definition.id().equals(proposed.id())) throw badRequest("Publication must retain the configured process ID");
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
        try {
            var requests = store.requests();
            requirePerson(actor); // A directory revocation during I/O must not release request data.
            return requests.stream().filter(r -> visibleTo(r, actor)).toList();
        }
        catch (IOException e) { throw new UncheckedIOException("Cannot read approval requests", e); }
    }

    /** Fail closed when an isolated scenario is opened over records of another business type. */
    void requireDocumentType(Class<? extends BusinessDocument> expected) {
        Objects.requireNonNull(expected);
        try {
            for (Request request : store.requests())
                if (request.business() == null || !expected.equals(request.business().getClass()))
                    throw new IllegalStateException("Unexpected business type in isolated scenario store");
        } catch (IOException failure) { throw new UncheckedIOException("Cannot validate isolated scenario store", failure); }
    }

    /** Additive bounded inbox; legacy list() retains its full applicant/all-participant visibility. */
    public InboxPage inbox(String actor, String box, Integer limit, String status, Integer processVersion, String cursor) throws IOException {
        requirePerson(actor);
        InboxQuery query;
        try { query = InboxQuery.parse(actor, box, limit, status, processVersion, cursor); }
        catch (IllegalArgumentException ex) { throw badRequest(ex.getMessage()); }
        List<Request> rows = store.inbox(query);
        requirePerson(actor); // A directory revocation during I/O must not release a page.
        if (rows == null || rows.size() > query.limit() + 1) throw new IOException("Invalid inbox page size from store");
        try {
            Request previous = null;
            Set<String> seenIds = new HashSet<>();
            for (Request row : rows) {
                if (row == null || !query.matches(row) || !seenIds.add(row.id()) ||
                        (previous != null && InboxQuery.ORDER.compare(previous, row) >= 0))
                    throw new IOException("Inbox page does not match its authenticated query or ordering");
                previous = row;
            }
        } catch (RuntimeException invalid) { throw new IOException("Invalid inbox request from store", invalid); }
        boolean more = rows.size() > query.limit();
        List<Request> items = rows.subList(0, Math.min(query.limit(), rows.size()));
        return new InboxPage(items, more ? query.cursorFor(items.get(items.size() - 1)) : null);
    }

    /** Strict adapter for GET query parameters; no client-supplied actor or ambiguous repeated fields. */
    public InboxPage inbox(String actor, Map<String, List<String>> parameters) throws IOException {
        requirePerson(actor);
        var allowed = Set.of("box", "limit", "status", "processVersion", "cursor");
        if (parameters == null || parameters.entrySet().stream().anyMatch(entry -> !allowed.contains(entry.getKey()) ||
                entry.getValue() == null || entry.getValue().size() != 1 || entry.getValue().get(0) == null))
            throw badRequest("Unknown or repeated inbox query parameter");
        return inbox(actor, parameter(parameters, "box"), integerParameter(parameters, "limit"),
            parameter(parameters, "status"), integerParameter(parameters, "processVersion"), parameter(parameters, "cursor"));
    }

    private static String parameter(Map<String, List<String>> parameters, String name) {
        var values = parameters.get(name); return values == null ? null : values.get(0);
    }
    private static Integer integerParameter(Map<String, List<String>> parameters, String name) {
        String value = parameter(parameters, name);
        if (value == null) return null;
        if (!value.matches("[0-9]{1,10}")) throw badRequest("Invalid inbox integer parameter");
        try { return Integer.valueOf(value); }
        catch (NumberFormatException invalid) { throw badRequest("Invalid inbox integer parameter"); }
    }

    public Request submit(String actor, String title, String reason, int days, int processVersion) throws IOException {
        return submit(actor, title, reason, days, processVersion, null);
    }

    /** Optional, durable applicant-scoped submission key. Replays return the current saved request. */
    public Request submit(String actor, String title, String reason, int days, int processVersion, String idempotencyKey) throws IOException {
        return submit(actor, title, reason, days, processVersion, idempotencyKey, null);
    }

    /** A typed business document enters the same approval lifecycle as the legacy leave API. */
    public Request submitDocument(String actor, BusinessDocument document, int processVersion, String idempotencyKey) throws IOException {
        requirePerson(actor);
        try {
            if (document == null) throw new IllegalArgumentException("Business document is required");
            document.validate();
        } catch (IllegalArgumentException invalid) { throw badRequest(invalid.getMessage()); }
        return submit(actor, document.title(), document.reason(), document instanceof BusinessDocument.Leave leave ? leave.days() : 0,
            processVersion, idempotencyKey, document);
    }

    private Request submit(String actor, String title, String reason, int days, int processVersion,
                           String idempotencyKey, BusinessDocument document) throws IOException {
        requirePerson(actor);
        if (idempotencyKey != null && !validSubmissionKey(idempotencyKey))
            throw badRequest("Idempotency-Key must be 1-128 ASCII letters, digits, dots, underscores, colons or hyphens, starting with a letter or digit");
        if (!validText(title, 120) || !validText(reason, 2000) || (document == null && (days < 1 || days > 365)) || processVersion < 1)
            throw badRequest("Invalid leave submission");
        // The real, unchanged ArcFlow core performs the validate → normalize DAG on every command.
        var normalized = SubmissionWorkflow.execute(title, reason);
        BusinessDocument business = document == null ? null : document.withText(normalized.get("title"), normalized.get("reason"));
        var definition = store.process();
        if (idempotencyKey != null) {
            Request prior = store.submission(actor, idempotencyKey);
            if (prior != null) return submissionReplay(actor, normalized, days, definition.id(), processVersion, business, prior);
        }
        try {
            if (processVersion != definition.version()) throw conflict("The published process changed; reload before submitting");
            requireActiveAssignees(definition);
            if (definition.approvals().stream().anyMatch(n -> n.participants().contains(actor)))
                throw badRequest("You cannot submit to a process that assigns you any approval step");
        } catch (ResponseStatusException changed) {
            // A winner can commit after our optimistic lookup and before a new publication or
            // directory change. Historical replay must not depend on current routing eligibility.
            if (idempotencyKey != null) {
                Request winner = store.submission(actor, idempotencyKey);
                if (winner != null) return submissionReplay(actor, normalized, days, definition.id(), processVersion, business, winner);
            }
            throw changed;
        }
        ConditionalRouting.FrozenRoute routing;
        try { routing = ConditionalRouting.freeze(definition, business); }
        catch (IllegalArgumentException invalid) { throw badRequest(invalid.getMessage()); }
        String now = Instant.now().toString();
        var first = definition.approvals().stream().filter(node -> routing == null || routing.stepIds().contains(node.id())).findFirst().orElseThrow();
        Request r = new Request(UUID.randomUUID().toString(), normalized.get("title"), normalized.get("reason"), days, actor, first.participants().get(0),
            "PENDING", now, now, null, null, definition.id(), definition.version(),
            List.of(new Event(actor, "SUBMIT", "", now, null)), definition, first.id(), business, routing);
        if (idempotencyKey != null) {
            Request saved = store.create(processVersion, r, idempotencyKey);
            if (saved != null) return submissionReplay(actor, normalized, days, definition.id(), processVersion, business, saved);
        } else if (store.create(processVersion, r)) return r;
        // A competing keyed submit may have committed before the process was republished.
        // The store must resolve its binding before rejecting an outdated process version.
        throw conflict("The published process changed; reload before submitting");
    }

    /** Exact and case-sensitive; bounded for portable database indexes and HTTP transports. */
    public static boolean validSubmissionKey(String key) {
        return key != null && key.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}");
    }

    private Request submissionReplay(String actor, Map<String,String> normalized, int days, String processId, int processVersion, BusinessDocument business, Request saved) throws IOException {
        requirePerson(actor); // Recheck live authorization after storage/racing commands.
        if (!actor.equals(saved.applicantId())) throw new IOException("Submission binding has an invalid owner");
        if (!normalized.get("title").equals(saved.title()) || !normalized.get("reason").equals(saved.reason()) ||
            days != saved.days() || !processId.equals(saved.processId()) || processVersion != saved.processVersion() || !Objects.equals(business, saved.business()))
            throw conflict("Idempotency-Key was already used for a different submission");
        return saved;
    }

    public Request decide(String actor, String id, String stepId, String decision, String comment) throws IOException {
        return decide(actor, id, stepId, decision, comment, null);
    }
    Request decideForDocument(String actor, String id, String stepId, String decision, String comment,
                              Class<? extends BusinessDocument> expected) throws IOException {
        return decide(actor, id, stepId, decision, comment, Objects.requireNonNull(expected));
    }
    private Request decide(String actor, String id, String stepId, String decision, String comment,
                           Class<? extends BusinessDocument> expected) throws IOException {
        // Keep writes bounded. A competing copy of this actor's command can win the last CAS,
        // so the final iteration must still reauthorize and observe durable replay, without writing.
        final int maxWriteAttempts = 16;
        for (int attempt = 0; attempt <= maxWriteAttempts; attempt++) {
            requirePerson(actor);
            Request old = id == null ? null : store.request(id);
            requirePerson(actor); // Reauthorize after I/O before returning a replay or attempting a write.
            // Conceal existence from unrelated users, then authorize this exact snapshotted step before replay lookup.
            if (old == null || !visibleTo(old, actor))
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Request not found");
            // Recheck the exact stored request on every CAS attempt, before replay or mutation.
            if (expected != null && (old.business() == null || !expected.equals(old.business().getClass())))
                throw new IOException("Unexpected business type in isolated scenario decision");
            var steps = effectiveApprovals(old);
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
            Progress progress = replay(effectiveApprovals(old), history);
            boolean pending = "PENDING".equals(progress.status);
            Request next = new Request(old.id(), old.title(), old.reason(), old.days(), old.applicantId(),
                pending ? progress.pendingActors().get(0) : actor, progress.status, old.createdAt(), now, decision, cleanComment,
                old.processId(), old.processVersion(), history, old.definition(), progress.currentStepId(), old.business(), old.routing());
            if (store.update(old.history().size() - 1, next)) return next;
        }
        throw conflict("The request changed concurrently; retry the decision");
    }

    /** Replays every participant vote and checks derived state instead of trusting saved fields. */
    public static void validateRequest(Request r) {
        if (r == null || r.id() == null || !r.id().matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}") ||
            !validText(r.title(), 120) || !validText(r.reason(), 2000) || !ProcessDefinition.validActorId(r.applicantId()))
            throw new IllegalArgumentException("Invalid request fields");
        if (r.business() == null) {
            if (r.days() < 1 || r.days() > 365) throw new IllegalArgumentException("Invalid legacy leave days");
        } else {
            r.business().validate();
            int days = r.business() instanceof BusinessDocument.Leave leave ? leave.days() : 0;
            if (!r.title().equals(r.business().title()) || !r.reason().equals(r.business().reason()) || r.days() != days ||
                !r.business().equals(r.business().withText(r.title().trim(), r.reason().trim())))
                throw new IllegalArgumentException("Business document differs from its normalized compatibility fields");
        }
        ProcessDefinition.validate(r.definition());
        if (!r.definition().id().equals(r.processId()) || r.definition().version() != r.processVersion() ||
            r.definition().approvals().stream().anyMatch(n -> n.participants().contains(r.applicantId())) ||
            r.history() == null || r.history().isEmpty()) throw new IllegalArgumentException("Invalid request process");
        Event first = r.history().get(0);
        Instant priorTime = Instant.parse(r.createdAt());
        if (first == null || !"SUBMIT".equals(first.action()) || !r.applicantId().equals(first.actorId()) ||
            !r.createdAt().equals(first.at()) || !"".equals(first.comment()) || first.stepId() != null)
            throw new IllegalArgumentException("Invalid submission event");
        Progress progress = new Progress(effectiveApprovals(r));
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
        return replay(effectiveApprovals(request), request.history()).pendingActors();
    }

    public static List<ProcessDefinition.ProcessNode> effectiveApprovals(Request request) {
        return ConditionalRouting.effectiveApprovals(request);
    }

    private static Progress replay(List<ProcessDefinition.ProcessNode> steps, List<Event> history) {
        Progress progress = new Progress(steps);
        for (int i = 1; i < history.size(); i++) progress.apply(history.get(i));
        return progress;
    }

    /** One deterministic reducer shared by live transitions and all storage validation. */
    private static final class Progress {
        private final List<ProcessDefinition.ProcessNode> steps;
        private final Set<String> voted = new HashSet<>();
        private int index;
        private String status = "PENDING";
        Progress(List<ProcessDefinition.ProcessNode> steps) { this.steps = steps; }
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
            !Objects.equals(old.reason(), next.reason()) || old.days() != next.days() || !Objects.equals(old.business(), next.business()) ||
            !Objects.equals(old.applicantId(), next.applicantId()) || !Objects.equals(old.createdAt(), next.createdAt()) ||
            !Objects.equals(old.definition(), next.definition()) || !Objects.equals(old.routing(), next.routing()) || !"PENDING".equals(old.status()) ||
            next.history().size() != old.history().size() + 1 ||
            !next.history().subList(0, old.history().size()).equals(old.history()))
            throw new IllegalArgumentException("Request updates must append exactly one decision without rewriting prior state");
    }

    private static boolean visibleTo(Request r, String actor) {
        return r.applicantId().equals(actor) || effectiveApprovals(r).stream().anyMatch(n -> n.participants().contains(actor));
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
