package com.arcflow.approval.graph;

import com.arcflow.approval.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import java.io.*;
import java.time.Instant;
import java.time.Clock;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Authenticated application policy around the isolated pure graph interpreter and durable CAS. */
public final class GraphApprovalService implements AutoCloseable {
    private final GraphApprovalStore store; private final ActorDirectory actors;
    private final String processId; private final int processSchema; private final GraphScenarios.Scenario scenario; private final Clock clock; private final GraphQuotePolicy quotePolicy;
    public GraphApprovalService(GraphApprovalStore store,ActorDirectory actors) { this(store,actors,Clock.systemUTC(),null); }
    public GraphApprovalService(GraphApprovalStore store,ActorDirectory actors,Clock clock,QuoteDiscountCase.QuoteSource source) {
        this.store=Objects.requireNonNull(store); this.actors=Objects.requireNonNull(actors); this.clock=Objects.requireNonNull(clock);
        var configured=read().definition(); this.processId=configured.id(); this.processSchema=configured.schemaVersion(); this.scenario=GraphScenarios.forDefinition(configured);
        if (scenario==GraphScenarios.QUOTE && source==null) throw new IllegalArgumentException("Quote graph service requires a host quote source");
        this.quotePolicy=scenario==GraphScenarios.QUOTE ? new GraphQuotePolicy(source,clock) : null;
    }
    public GraphScenarios.Scenario scenario() { return scenario; }
    public int schemaVersion() { return processSchema; }
    public boolean canSubmit(String actor) {
        person(actor); return quotePolicy==null || quotePolicy.quotes(actor).stream().anyMatch(q -> actor.equals(q.ownerId()));
    }
    public List<QuoteDiscountCase.QuoteVersion> quotes(String actor) {
        person(actor); if (quotePolicy==null) throw bad("This scenario has no quote source");
        var result=quotePolicy.quotes(actor); person(actor); return result;
    }
    public static ObjectMapper strictMapper(ObjectMapper mapper) { return ApprovalService.strictMapper(mapper).enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES).setSerializationInclusion(com.fasterxml.jackson.annotation.JsonInclude.Include.ALWAYS); }
    public static void validateSnapshot(GraphApprovalStore.Snapshot snapshot) {
        if (snapshot == null || snapshot.storageSchemaVersion()!=GraphApprovalStore.STORAGE_SCHEMA_VERSION || snapshot.draft()==null || snapshot.requests()==null) throw new IllegalArgumentException("Unknown or invalid graph storage schema (expected 14)");
        GraphDefinition.validate(snapshot.definition()); GraphDefinition.validateDraft(snapshot.draft().definition());
        if(snapshot.definition().schemaVersion()!=snapshot.draft().definition().schemaVersion()) throw new IllegalArgumentException("A graph store cannot change its executable schema/family");
        if (snapshot.draft().revision()<0 || snapshot.draft().baseVersion()!=snapshot.definition().version() || snapshot.draft().definition().version()!=snapshot.draft().baseVersion() || !snapshot.definition().id().equals(snapshot.draft().definition().id())) throw new IllegalArgumentException("Draft base/revision differs from published graph");
        Set<String> ids=new HashSet<>(), keys=new HashSet<>();
        Map<Integer,GraphDefinition> versions=new HashMap<>(); versions.put(snapshot.definition().version(),snapshot.definition());
        for (GraphInstance request : snapshot.requests()) {
            validateStoredInstance(request);
            if(request.definition().schemaVersion()!=snapshot.definition().schemaVersion()) throw new IllegalArgumentException("Historical graph versions cannot change the executable schema/family");
            GraphDefinition retained=versions.putIfAbsent(request.definition().version(),request.definition());
            if (retained!=null&&!retained.equals(request.definition())) throw new IllegalArgumentException("One publication version cannot contain different graph definitions");
            if (!ids.add(request.id()) || !keys.add(request.applicantId()+"\0"+request.submissionKey()) || !request.definition().id().equals(snapshot.definition().id()) || request.definition().version()>snapshot.definition().version()) throw new IllegalArgumentException("Graph snapshot contains duplicate or incompatible instances");
        }
    }
    /** Durable adapters enforce host-independent revision identity before any write, unlike ephemeral previews. */
    public static void validateStoredInstance(GraphInstance request) {
        GraphEngine.validateInstance(request);
        if (request.business() instanceof BusinessDocument.QuoteDiscount quote &&
            !request.submissionKey().equals(GraphQuotePolicy.revisionKey(quote.businessId(),quote.quoteRevision())))
            throw new IllegalArgumentException("Quote graph submission key must bind the original quote revision");
    }
    public GraphApprovalStore.Snapshot workspace(String actor) {
        publisher(actor); var snapshot=read(); publisher(actor);
        return new GraphApprovalStore.Snapshot(snapshot.storageSchemaVersion(),snapshot.definition(),snapshot.draft(),List.of());
    }
    public GraphDefinition process(String actor) { person(actor); var definition=read().definition(); person(actor); return definition; }
    public List<ApprovalService.Person> users(String actor) {
        person(actor); var users=actors.listActive().stream().filter(p -> actors.canAssignApproval(p.id())).toList(); person(actor); return users;
    }
    public List<GraphDefinition.Diagnostic> validate(String actor,GraphDefinition definition) {
        publisher(actor); if (definition==null || definition.schemaVersion()!=processSchema || !processId.equals(definition.id())) return List.of(new GraphDefinition.Diagnostic("PROCESS_ID","The configured process ID cannot change",null,null));
        return GraphDefinition.diagnostics(definition);
    }
    public GraphApprovalStore.Draft saveDraft(String actor,long expectedRevision,GraphDefinition definition) throws IOException {
        publisher(actor); try { requireProcess(definition); GraphDefinition.validateDraft(definition); } catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
        var current=store.snapshot(); publisher(actor);
        if (expectedRevision!=current.draft().revision() || expectedRevision==Long.MAX_VALUE || definition.version()!=current.definition().version()) throw conflict("The draft or publication changed; reload before saving");
        if (!current.definition().id().equals(definition.id())) throw bad("The configured process ID cannot change");
        var next=new GraphApprovalStore.Draft(expectedRevision+1,current.definition().version(),definition);
        if (!store.saveDraft(expectedRevision,next)) throw conflict("The draft changed; your local edits were not overwritten");
        return next;
    }
    public GraphDefinition publish(String actor,int expectedVersion,long expectedDraftRevision) throws IOException {
        publisher(actor); var snapshot=store.snapshot(); publisher(actor);
        if (snapshot.definition().version()!=expectedVersion || snapshot.draft().revision()!=expectedDraftRevision || expectedVersion==Integer.MAX_VALUE || expectedDraftRevision==Long.MAX_VALUE) throw conflict("The graph draft or publication changed; reload before publishing");
        GraphDefinition proposed=snapshot.draft().definition();
        try { requireProcess(proposed); GraphDefinition.validate(proposed); } catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
        requireAssignees(proposed.nodes().stream().filter(GraphDefinition.Node::human).flatMap(n -> n.assigneeIds().stream()).toList()); publisher(actor);
        GraphDefinition next=proposed.withVersion(expectedVersion+1);
        if (!store.publish(expectedVersion,expectedDraftRevision,next)) throw conflict("The graph draft or publication changed; reload before publishing");
        return next;
    }
    public GraphInstance preview(String actor,GraphDefinition definition,BusinessDocument business) {
        publisher(actor);
        try {
            requireProcess(definition);
            BusinessDocument normalized=normalize(business);
            if (quotePolicy!=null) quotePolicy.requireRead(actor,(BusinessDocument.QuoteDiscount)normalized);
            GraphInstance preview=GraphEngine.start("preview","preview",actor,definition,normalized,clock.instant().toString());
            if (quotePolicy!=null) quotePolicy.requirePreview(actor,(BusinessDocument.QuoteDiscount)normalized,preview);
            requireAssignees(GraphEngine.selectedParticipants(preview)); publisher(actor);
            if (quotePolicy!=null) quotePolicy.requirePreview(actor,(BusinessDocument.QuoteDiscount)normalized,preview);
            return preview;
        } catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
    }
    public GraphInstance submit(String actor,int expectedVersion,BusinessDocument business,String submissionKey) throws IOException {
        person(actor); if (!GraphEngine.validKey(submissionKey)) throw bad("Idempotency-Key must contain 1–128 safe characters");
        BusinessDocument normalized; try { normalized=normalize(business); } catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
        if (quotePolicy!=null) quotePolicy.requireSubmission(actor,(BusinessDocument.QuoteDiscount)normalized);
        final String durableKey=quotePolicy==null ? submissionKey : GraphQuotePolicy.revisionKey(normalized.businessId(),((BusinessDocument.QuoteDiscount)normalized).quoteRevision());
        if (!submissionKey.equals(durableKey)) throw bad("Idempotency-Key must be the canonical quote revision key");
        String id=UUID.randomUUID().toString(),at=clock.instant().toString();
        for (int attempt=0;attempt<32;attempt++) {
            var snapshot=store.snapshot(); person(actor);
            GraphInstance previous=snapshot.requests().stream().filter(r -> r.applicantId().equals(actor) && r.submissionKey().equals(durableKey)).findFirst().orElse(null);
            if (previous!=null) {
                if (previous.definition().version()!=expectedVersion || !previous.business().equals(normalized)) throw conflict("The submission key belongs to another original payload");
                quoteAccess(previous,actor); return previous;
            }
            if (snapshot.definition().version()!=expectedVersion) throw conflict("The published graph changed; review the current version before submitting");
            GraphInstance next;
            try { next=GraphEngine.start(id,durableKey,actor,snapshot.definition(),normalized,at); } catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
            if (quotePolicy!=null) quotePolicy.requireFresh(actor,(BusinessDocument.QuoteDiscount)normalized,next);
            requireAssignees(GraphEngine.selectedParticipants(next)); person(actor);
            if (quotePolicy!=null) quotePolicy.requireFresh(actor,(BusinessDocument.QuoteDiscount)normalized,next);
            if (store.create(expectedVersion,next)) return next;
        }
        var snapshot=store.snapshot(); person(actor);
        for (var previous:snapshot.requests()) if (previous.applicantId().equals(actor)&&previous.submissionKey().equals(durableKey)) {
            if (previous.definition().version()==expectedVersion&&previous.business().equals(normalized)) { quoteAccess(previous,actor); return previous; }
            throw conflict("The submission key belongs to another original payload");
        }
        throw conflict("The graph changed repeatedly; retry with the same submission key");
    }
    public List<GraphInstance> list(String actor) { person(actor); var rows=read().requests(); person(actor); return rows.stream().filter(r -> visible(r,actor)).filter(r -> quotePolicy==null || quotePolicy.canRead(actor,(BusinessDocument.QuoteDiscount)r.business())).toList(); }
    public GraphInstance get(String actor,String id) { person(actor); var instance=find(read(),id); person(actor); access(instance,actor); quoteAccess(instance,actor); return instance; }
    public GraphInstance decide(String actor,String id,String taskId,String decision,String comment,String commandId) throws IOException {
        person(actor);
        if (!GraphEngine.validKey(commandId) || !("APPROVE".equals(decision)||"REJECT".equals(decision)) || comment==null || comment.length()>2000) throw bad("Invalid graph decision or Idempotency-Key");
        for (int attempt=0;attempt<32;attempt++) {
            GraphInstance current=find(store.snapshot(),id); person(actor); access(current,actor); quoteAccess(current,actor);
            GraphInstance replay=replay(current,taskId,actor,decision,comment,commandId); if (replay!=null) return replay;
            var task=current.tasks().stream().filter(t -> t.id().equals(taskId)).findFirst().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,"Task not found"));
            if (!task.participants().contains(actor)) throw forbidden("You are not assigned to this task");
            boolean alreadyVoted=task.votes().stream().anyMatch(v -> v.actorId().equals(actor));
            if (alreadyVoted && GraphEngine.replayReceiptCount(current)>=768) throw conflict("Replay receipt limit reached; retry an already accepted command key");
            if (!alreadyVoted && (!"PENDING".equals(current.status()) || !"ACTIVE".equals(task.status()))) throw conflict("The task is no longer active");
            GraphInstance next;
            try { next=GraphEngine.decide(current,taskId,actor,decision,comment,commandId,latestTime(current.updatedAt())); } catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
            person(actor); quoteAccess(current,actor);
            if (store.replace(id,current.commandRevision(),next)) return next;
        }
        GraphInstance current=find(store.snapshot(),id); person(actor); access(current,actor); quoteAccess(current,actor);
        GraphInstance replay=replay(current,taskId,actor,decision,comment,commandId); if (replay!=null) return replay;
        throw conflict("Concurrent decisions changed this request; retry the same task and key");
    }
    private GraphInstance replay(GraphInstance current,String taskId,String actor,String decision,String comment,String commandId) {
        for (var command:current.commands()) if (command.id().equals(commandId)) {
            if (!command.actorId().equals(actor)||!command.taskId().equals(taskId)||!command.decision().equals(decision)||!command.comment().equals(comment)) throw conflict("The command key belongs to another original payload");
            return current;
        }
        for (var task:current.tasks()) if (task.id().equals(taskId)) for (var vote:task.votes()) if (vote.actorId().equals(actor)) {
            if (!vote.decision().equals(decision)) throw conflict("A different decision has already been recorded for this task");
            // The same vote with a new key is persisted as a replay receipt by the reducer/CAS.
            return null;
        }
        return null;
    }
    private String latestTime(String prior) { Instant now=clock.instant(), previous=Instant.parse(prior); return (now.isBefore(previous)?previous:now).toString(); }
    private BusinessDocument normalize(BusinessDocument business) {
        if (business==null || business.getClass()!=scenario().documentType()) throw new IllegalArgumentException("A " + scenario().businessType() + " business document is required");
        business.validate(); BusinessDocument normalized=business.withText(business.title().trim(),business.reason().trim()); normalized.validate(); return normalized;
    }
    private void requireProcess(GraphDefinition definition) { if (definition==null || definition.schemaVersion()!=processSchema || !processId.equals(definition.id())) throw new IllegalArgumentException("The configured graph schema and process ID cannot change"); }
    private void quoteAccess(GraphInstance instance,String actor) { if (quotePolicy!=null) quotePolicy.requireRead(actor,(BusinessDocument.QuoteDiscount)instance.business()); }
    private void requireAssignees(Collection<String> people) { for (String actor:people) if (actors.findActive(actor).isEmpty()||!actors.canAssignApproval(actor)) throw bad("An assigned reviewer is unavailable: "+actor); }
    private GraphApprovalStore.Snapshot read() { try { return store.snapshot(); } catch(IOException e) { throw new UncheckedIOException("Cannot read graph store",e); } }
    private static GraphInstance find(GraphApprovalStore.Snapshot snapshot,String id) { return snapshot.requests().stream().filter(r -> r.id().equals(id)).findFirst().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,"Graph request not found")); }
    private static boolean visible(GraphInstance request,String actor) { return request.applicantId().equals(actor)||GraphEngine.selectedParticipants(request).contains(actor); }
    private static void access(GraphInstance request,String actor) { if (!visible(request,actor)) throw forbidden("You cannot read this graph request"); }
    private void person(String actor) { if (actor==null||actors.findActive(actor).isEmpty()) throw forbidden("The authenticated user is not active"); }
    private void publisher(String actor) { person(actor); if (!actors.canPublish(actor)) throw forbidden("Graph publication is not permitted"); }
    private static ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST,message); }
    private static ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT,message); }
    private static ResponseStatusException forbidden(String message) { return new ResponseStatusException(HttpStatus.FORBIDDEN,message); }
    @Override public void close() throws IOException { store.close(); }
}
