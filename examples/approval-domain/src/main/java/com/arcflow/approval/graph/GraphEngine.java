package com.arcflow.approval.graph;

import com.arcflow.approval.BusinessDocument;
import com.arcflow.approval.ConditionalRouting;
import com.arcflow.approval.ProcessDefinition;
import java.time.Instant;
import java.util.*;
import static com.arcflow.approval.graph.GraphInstance.*;

/** Pure deterministic run-to-quiescence interpreter; human waiting is durable, never a thread. */
public final class GraphEngine {
    private GraphEngine() {}
    public static GraphInstance start(String id,String key,String applicant,GraphDefinition definition,BusinessDocument business,String at) {
        GraphDefinition.validate(definition);
        if (id == null || id.isBlank() || id.length()>128 || !validKey(key) || !ProcessDefinition.validActorId(applicant)) throw invalid("Invalid graph instance identity");
        timestamp(at);
        GraphScenarios.validateDocument(definition,business);
        List<Route> routes = new ArrayList<>();
        for (var node : definition.nodes()) if ("exclusiveGateway".equals(node.type())) {
            String selected = null; List<Evaluation> evaluations = new ArrayList<>();
            for (var edge : definition.outgoing(node.id())) {
                List<ConditionalRouting.Fact> facts = edge.condition() == null ? List.of() : edge.condition().predicates().stream().map(p -> ConditionalRouting.evaluate(p,business)).toList();
                boolean match = edge.defaultBranch() ? selected == null : "ALL".equals(edge.condition().mode()) ? facts.stream().allMatch(ConditionalRouting.Fact::result) : facts.stream().anyMatch(ConditionalRouting.Fact::result);
                evaluations.add(new Evaluation(edge.id(),match,facts));
                if (selected == null && match) selected = edge.id();
            }
            if (selected == null) throw invalid("Gateway did not select a branch");
            routes.add(new Route(node.id(),selected,evaluations));
        }
        GraphInstance initial = new GraphInstance(id,key,applicant,"PENDING",at,at,0,definition,business,List.of(),List.of(),routes,List.of(),List.of());
        State state = new State(initial,at); state.event("SUBMITTED",null,null,"Graph version " + definition.version());
        state.queue.add(new Token(definition.nodes().stream().filter(n -> "start".equals(n.type())).findFirst().orElseThrow().id(),List.of()));
        state.drain(); return state.build();
    }
    public static boolean validKey(String key) { return key != null && key.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}"); }
    /** Used after authorization; exact command replay is handled by service before active-task checks. */
    public static GraphInstance decide(GraphInstance before,String taskId,String actor,String decision,String comment,String commandId,String at) {
        if (!validKey(commandId) || !ProcessDefinition.validActorId(actor) || !("APPROVE".equals(decision) || "REJECT".equals(decision)) || comment == null || comment.length()>2000 || comment.codePoints().anyMatch(c -> Character.isISOControl(c) && c!='\n' && c!='\t')) throw invalid("Invalid graph decision command");
        Instant time = timestamp(at);
        if (time.isBefore(timestamp(before.updatedAt()))) throw invalid("Decision time precedes durable state");
        if (before.commandRevision()==Long.MAX_VALUE) throw invalid("Graph command limit reached");
        Task task = before.tasks().stream().filter(t -> t.id().equals(taskId)).findFirst().orElseThrow(() -> invalid("Unknown graph task"));
        if (!task.participants().contains(actor)) throw invalid("Actor is not assigned to this task");
        if (before.commands().stream().anyMatch(c -> c.id().equals(commandId))) throw invalid("Command ID already exists");
        Vote previous = task.votes().stream().filter(v -> v.actorId().equals(actor)).findFirst().orElse(null);
        if (previous != null && !previous.decision().equals(decision)) throw invalid("A different vote is already recorded");
        if (previous != null && replayReceiptCount(before)>=768) throw invalid("Replay receipt limit reached; retry an already accepted command key");
        if (previous == null && (!"PENDING".equals(before.status()) || !"ACTIVE".equals(task.status()))) throw invalid("Actor has no pending vote on this task");
        State state = new State(before,at); state.revision++;
        state.commands.add(new Command(commandId,taskId,actor,decision,comment,at));
        if (previous != null) {
            // A successful fresh-key retry must bind that key too; never allow it to be reused for another payload.
            state.event("COMMAND_REPLAYED",task.nodeId(),task.id(),"Original vote retained: " + previous.commandId());
            return state.build();
        }
        List<Vote> votes = new ArrayList<>(task.votes()); votes.add(new Vote(actor,decision,comment,at,commandId));
        state.event("TASK_VOTED",task.nodeId(),task.id(),actor + ":" + decision);
        boolean approved = "ALL".equals(task.completionMode()) ? votes.size()==task.participants().size() && votes.stream().allMatch(v -> "APPROVE".equals(v.decision())) : votes.stream().anyMatch(v -> "APPROVE".equals(v.decision()));
        boolean rejected = "ALL".equals(task.completionMode()) ? votes.stream().anyMatch(v -> "REJECT".equals(v.decision())) : votes.size()==task.participants().size() && votes.stream().allMatch(v -> "REJECT".equals(v.decision()));
        state.tasks.put(task.id(),new Task(task.id(),task.nodeInstanceId(),task.nodeId(),approved?"COMPLETED":rejected?"REJECTED":"ACTIVE",task.participants(),task.completionMode(),votes,task.lineage()));
        if (rejected) {
            state.event("TASK_REJECTED",task.nodeId(),task.id(),"Voting rule rejected"); state.status="REJECTED";
            for (Task pending : new ArrayList<>(state.tasks.values())) if ("ACTIVE".equals(pending.status())) {
                state.tasks.put(pending.id(),new Task(pending.id(),pending.nodeInstanceId(),pending.nodeId(),"CANCELLED",pending.participants(),pending.completionMode(),pending.votes(),pending.lineage()));
                state.event("TASK_CANCELLED",pending.nodeId(),pending.id(),"Cancelled by terminal rejection");
            }
            state.event("REJECTED",task.nodeId(),task.id(),"Other active work cancelled atomically");
        } else if (approved) {
            state.event("TASK_COMPLETED",task.nodeId(),task.id(),"Voting rule satisfied"); state.advance(task.nodeId(),task.lineage()); state.drain();
        }
        return state.build();
    }
    /** Selected future participants retain read access; unselected branches never gain it. */
    public static Set<String> selectedNodeIds(GraphInstance instance) {
        Map<String,String> selected = new HashMap<>(); instance.routes().forEach(r -> selected.put(r.gatewayId(),r.selectedEdgeId()));
        Set<String> reached = new LinkedHashSet<>(); ArrayDeque<String> queue = new ArrayDeque<>();
        instance.definition().nodes().stream().filter(n -> "start".equals(n.type())).forEach(n -> queue.add(n.id()));
        while (!queue.isEmpty()) {
            String id = queue.remove(); if (!reached.add(id)) continue;
            for (var edge : instance.definition().outgoing(id)) if (!selected.containsKey(id) || selected.get(id).equals(edge.id())) queue.add(edge.target());
        }
        return Collections.unmodifiableSet(reached);
    }
    public static Set<String> selectedParticipants(GraphInstance instance) {
        Set<String> nodes = selectedNodeIds(instance), people = new LinkedHashSet<>();
        for (var node : instance.definition().nodes()) if (nodes.contains(node.id()) && node.human()) people.addAll(node.assigneeIds());
        return Collections.unmodifiableSet(people);
    }
    /** 768 replay aliases are separate from the reserved capacity for 16 × 16 real participant votes. */
    public static long replayReceiptCount(GraphInstance instance) {
        return instance.commands().size()-instance.tasks().stream().mapToLong(t -> t.votes().size()).sum();
    }
    public static void validateInstance(GraphInstance instance) {
        if (instance == null || instance.commandRevision()<0 || instance.commands().size()>1024 || instance.events().size()>2048 || instance.tasks().size()>16 || instance.forks().size()>16 || instance.routes().size()>16) throw invalid("Invalid or excessive graph snapshot state");
        GraphInstance replay = start(instance.id(),instance.submissionKey(),instance.applicantId(),instance.definition(),instance.business(),instance.createdAt());
        for (Command command : instance.commands()) {
            if (command == null) throw invalid("Null graph command");
            replay = decide(replay,command.taskId(),command.actorId(),command.decision(),command.comment(),command.id(),command.at());
        }
        if (!replay.equals(instance)) throw invalid("Graph snapshot does not match deterministic command replay");
    }
    public static void validateTransition(GraphInstance before,GraphInstance next) {
        validateInstance(before); validateInstance(next);
        if (next.commandRevision()!=before.commandRevision()+1 || next.commands().size()!=before.commands().size()+1 ||
            !next.commands().subList(0,before.commands().size()).equals(before.commands())) throw invalid("A store transition must append exactly one human command");
        Command command=next.commands().get(next.commands().size()-1);
        GraphInstance expected=decide(before,command.taskId(),command.actorId(),command.decision(),command.comment(),command.id(),command.at());
        if (!expected.equals(next)) throw invalid("Graph transition changed frozen identity or unrelated state");
    }
    private record Token(String nodeId,List<Frame> lineage) {}
    private static final class State {
        final GraphInstance original; final String at; String status; long revision;
        final LinkedHashMap<String,Task> tasks=new LinkedHashMap<>(); final LinkedHashMap<String,Fork> forks=new LinkedHashMap<>();
        final List<Event> events=new ArrayList<>(); final List<Command> commands=new ArrayList<>(); final ArrayDeque<Token> queue=new ArrayDeque<>();
        State(GraphInstance original,String at) { this.original=original; this.at=at; status=original.status(); revision=original.commandRevision(); original.tasks().forEach(t -> tasks.put(t.id(),t)); original.forks().forEach(f -> forks.put(f.id(),f)); events.addAll(original.events()); commands.addAll(original.commands()); }
        void event(String type,String node,String task,String detail) { events.add(new Event(events.size()+1L,type,node,task,detail,at)); }
        void advance(String node,List<Frame> lineage) { var edges=original.definition().outgoing(node); if (edges.size()!=1) throw invalid("Expected one successor"); queue.add(new Token(edges.get(0).target(),lineage)); }
        void drain() {
            int transitions=0;
            while (!queue.isEmpty()) {
                if (++transitions>128) throw invalid("Automatic transition bound exceeded");
                Token token=queue.remove(); var node=original.definition().node(token.nodeId());
                switch(node.type()) {
                    case "approval", "parallelApproval" -> {
                        String id=original.id()+":"+node.id(); if (tasks.containsKey(id)) throw invalid("Task activated twice");
                        tasks.put(id,new Task(id,id,node.id(),"ACTIVE",node.assigneeIds(),node.completionMode(),List.of(),token.lineage())); event("TASK_ACTIVATED",node.id(),id,node.name());
                    }
                    case "exclusiveGateway" -> {
                        Route route=original.routes().stream().filter(r -> r.gatewayId().equals(node.id())).findFirst().orElseThrow();
                        var edge=original.definition().outgoing(node.id()).stream().filter(e -> e.id().equals(route.selectedEdgeId())).findFirst().orElseThrow();
                        event("ROUTE_SELECTED",node.id(),null,edge.id()); queue.add(new Token(edge.target(),token.lineage()));
                    }
                    case "parallelFork" -> {
                        String id=original.id()+":"+node.id(); if (forks.containsKey(id)) throw invalid("Fork activated twice");
                        var branches=original.definition().outgoing(node.id());
                        forks.put(id,new Fork(id,node.id(),node.pairId(),branches.stream().map(GraphDefinition.Edge::id).toList(),List.of(),false,token.lineage())); event("FORK_ACTIVATED",node.id(),null,id);
                        for (var branch : branches) { List<Frame> lineage=new ArrayList<>(token.lineage()); lineage.add(new Frame(id,branch.id())); queue.add(new Token(branch.target(),List.copyOf(lineage))); }
                    }
                    case "parallelJoin" -> {
                        if (token.lineage().isEmpty()) throw invalid("Join token has no fork lineage");
                        Frame frame=token.lineage().get(token.lineage().size()-1); Fork fork=forks.get(frame.forkActivationId());
                        if (fork==null || fork.fired() || !fork.joinId().equals(node.id()) || !fork.expectedBranchIds().contains(frame.branchId()) || fork.arrivedBranchIds().contains(frame.branchId()) || !fork.lineage().equals(token.lineage().subList(0,token.lineage().size()-1))) throw invalid("Invalid or repeated join arrival");
                        List<String> arrived=new ArrayList<>(fork.arrivedBranchIds()); arrived.add(frame.branchId()); boolean fired=arrived.size()==fork.expectedBranchIds().size();
                        forks.put(fork.id(),new Fork(fork.id(),fork.forkId(),fork.joinId(),fork.expectedBranchIds(),arrived,fired,fork.lineage())); event("BRANCH_ARRIVED",node.id(),null,frame.branchId());
                        if (fired) { event("JOIN_FIRED",node.id(),null,fork.id()); advance(node.id(),fork.lineage()); }
                    }
                    case "end" -> {
                        if (!token.lineage().isEmpty() || tasks.values().stream().anyMatch(t -> "ACTIVE".equals(t.status())) || forks.values().stream().anyMatch(f -> !f.fired()) || !queue.isEmpty()) throw invalid("End reached while work remains");
                        if (!"PENDING".equals(status)) throw invalid("End reached twice"); status="APPROVED"; event("COMPLETED",node.id(),null,"All selected work completed");
                    }
                    default -> { event("NODE_PASSED",node.id(),null,node.type()); advance(node.id(),token.lineage()); }
                }
            }
            if ("PENDING".equals(status) && tasks.values().stream().noneMatch(t -> "ACTIVE".equals(t.status()))) throw invalid("Graph stalled without a human task");
        }
        GraphInstance build() { return new GraphInstance(original.id(),original.submissionKey(),original.applicantId(),status,original.createdAt(),at,revision,original.definition(),original.business(),new ArrayList<>(tasks.values()),new ArrayList<>(forks.values()),original.routes(),events,commands); }
    }
    private static Instant timestamp(String value) {
        try { return Instant.parse(value); } catch (RuntimeException invalid) { throw new IllegalArgumentException("Invalid graph timestamp",invalid); }
    }
    private static IllegalArgumentException invalid(String message) { return new IllegalArgumentException(message); }
}
