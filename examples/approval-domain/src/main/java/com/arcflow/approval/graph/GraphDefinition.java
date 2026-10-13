package com.arcflow.approval.graph;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.arcflow.approval.ConditionalRouting;
import com.arcflow.approval.ProcessDefinition;
import java.util.*;

/** Version-five payment and version-six business executable structured graph. Edge order is explicit FIRST_MATCH priority. */
public record GraphDefinition(@JsonProperty(required = true) int schemaVersion, @JsonProperty(required = true) String id, @JsonProperty(required = true) int version, @JsonProperty(required = true) String name, @JsonProperty(required = true) List<Node> nodes, @JsonProperty(required = true) List<Edge> edges) {
    public static final int MAX_NODES = 32, MAX_EDGES = 48, MAX_DEPTH = 2, MAX_BRANCHES = 4;
    public static final Set<String> TYPES = Set.of("start", "end", "approval", "parallelApproval", "exclusiveGateway", "exclusiveMerge", "parallelFork", "parallelJoin");
    public GraphDefinition { if (nodes != null) nodes = List.copyOf(nodes); if (edges != null) edges = List.copyOf(edges); }
    public record Node(@JsonProperty(required = true) String id, @JsonProperty(required = true) String type, @JsonProperty(required = true) String name, @JsonProperty(required = true) List<String> assigneeIds, @JsonProperty(required = true) String completionMode, @JsonProperty(required = true) String pairId) {
        public Node { if (assigneeIds != null) assigneeIds = List.copyOf(assigneeIds); }
        public boolean human() { return "approval".equals(type) || "parallelApproval".equals(type); }
        public boolean split() { return "exclusiveGateway".equals(type) || "parallelFork".equals(type); }
        public boolean merge() { return "exclusiveMerge".equals(type) || "parallelJoin".equals(type); }
    }
    public record Edge(@JsonProperty(required = true) String id, @JsonProperty(required = true) String source, @JsonProperty(required = true) String target, @JsonProperty(required = true) String label, @JsonProperty(required = true) ConditionalRouting.Rule condition, @JsonProperty(required = true) boolean defaultBranch) {}
    public record Diagnostic(@JsonProperty(required = true) String code, @JsonProperty(required = true) String message, @JsonProperty(required = true) String nodeId, @JsonProperty(required = true) String edgeId) {}
    public GraphDefinition withVersion(int next) { return new GraphDefinition(schemaVersion, id, next, name, nodes, edges); }
    public Node node(String id) { return nodes.stream().filter(n -> n.id().equals(id)).findFirst().orElseThrow(() -> new IllegalArgumentException("Unknown graph node: " + id)); }
    public List<Edge> outgoing(String id) { return edges.stream().filter(e -> e.source().equals(id)).toList(); }
    public static boolean validId(String id) { return id != null && id.matches("[A-Za-z][A-Za-z0-9_-]{0,63}"); }
    public static void validateDraft(GraphDefinition d) {
        if (d == null || (d.schemaVersion != 5 && d.schemaVersion != 6) || !ProcessDefinition.validProcessId(d.id) || d.version < 1 || !name(d.name) ||
            d.nodes == null || d.edges == null || d.nodes.size() > MAX_NODES || d.edges.size() > MAX_EDGES)
            throw new IllegalArgumentException("Graph schema 5/6 requires a process ID, positive publication version, name, at most 32 nodes and 48 edges");
        Set<String> ids = new HashSet<>();
        for (Node n : d.nodes) {
            if (n == null || !validId(n.id) || !ids.add(n.id) || n.type == null || !TYPES.contains(n.type) || !name(n.name) || n.assigneeIds == null)
                throw new IllegalArgumentException("Invalid or duplicate graph node");
            if (n.assigneeIds.size() > 16 || !n.assigneeIds.stream().allMatch(ProcessDefinition::validActorId) || new HashSet<>(n.assigneeIds).size() != n.assigneeIds.size())
                throw new IllegalArgumentException("Node participants must be distinct stable actor IDs (maximum 16)");
            if (n.human()) {
                if (!("ALL".equals(n.completionMode) || "ANY".equals(n.completionMode)) || n.pairId != null)
                    throw new IllegalArgumentException("Approval nodes need ALL or ANY voting and no region pair");
            } else if (!n.assigneeIds.isEmpty() || n.completionMode != null || ((!n.split() && !n.merge()) && n.pairId != null))
                throw new IllegalArgumentException("Structural nodes cannot contain assignment or voting settings");
            if (n.pairId != null && !validId(n.pairId)) throw new IllegalArgumentException("Invalid paired region ID");
        }
        int predicates = 0; // Node and edge identifiers share one stable graph namespace.
        for (Edge e : d.edges) {
            if (e == null || !validId(e.id) || !ids.add(e.id) || !validId(e.source) || !validId(e.target) || !name(e.label))
                throw new IllegalArgumentException("Invalid or duplicate graph edge");
            if (e.condition != null) { ConditionalRouting.validate(e.condition); predicates += e.condition.predicates().size(); }
        }
        GraphScenarios.validateFacts(d);
        if (predicates > 32) throw new IllegalArgumentException("A graph permits at most 32 condition predicates");
    }
    private static boolean name(String value) { return value != null && !value.isBlank() && value.length() <= 120 && value.codePoints().noneMatch(Character::isISOControl); }
    public static void validate(GraphDefinition d) {
        List<Diagnostic> errors = diagnostics(d);
        if (!errors.isEmpty()) { Diagnostic e = errors.get(0); throw new IllegalArgumentException(e.code + " [" + (e.nodeId == null ? e.edgeId : e.nodeId) + "]: " + e.message); }
    }
    public static List<Diagnostic> diagnostics(GraphDefinition d) {
        List<Diagnostic> errors = new ArrayList<>();
        try { validateDraft(d); } catch (IllegalArgumentException e) { return List.of(new Diagnostic("GRAPH_SHAPE", e.getMessage(), null, null)); }
        Map<String,Node> byId = new LinkedHashMap<>(); d.nodes.forEach(n -> byId.put(n.id,n));
        Map<String,List<Edge>> out = new HashMap<>(), in = new HashMap<>();
        d.nodes.forEach(n -> { out.put(n.id,new ArrayList<>()); in.put(n.id,new ArrayList<>()); });
        Set<String> currency = new HashSet<>();
        for (Edge e : d.edges) {
            if (!byId.containsKey(e.source) || !byId.containsKey(e.target)) { errors.add(new Diagnostic("DANGLING_EDGE", "Both endpoints must exist", null,e.id)); continue; }
            out.get(e.source).add(e); in.get(e.target).add(e);
            if (e.source.equals(e.target)) errors.add(new Diagnostic("CYCLE", "A node cannot connect to itself",e.source,e.id));
            if (e.condition != null) for (var p : e.condition.predicates()) {
                if (!GraphScenarios.forDefinition(d).facts().contains(p.field())) errors.add(new Diagnostic("FACT_FAMILY", "Routing fields do not belong to this graph scenario",e.source,e.id));
                if (p.currency() != null) currency.add(p.currency());
            }
            if (!"exclusiveGateway".equals(byId.get(e.source).type) && (e.condition != null || e.defaultBranch))
                errors.add(new Diagnostic("EDGE_RULE", "Only exclusive gateway outgoing branches may have conditions or default",e.source,e.id));
        }
        if (currency.size() > 1) errors.add(new Diagnostic("CURRENCY", "All monetary conditions must use one currency",null,null));
        long starts = d.nodes.stream().filter(n -> "start".equals(n.type)).count(), ends = d.nodes.stream().filter(n -> "end".equals(n.type)).count();
        if (starts != 1 || ends != 1) errors.add(new Diagnostic("BOUNDARIES", "Exactly one start and one end are required",null,null));
        if (d.nodes.stream().filter(Node::human).count() > 16) errors.add(new Diagnostic("HUMAN_LIMIT", "At most 16 approval nodes are supported",null,null));
        for (Node n : d.nodes) {
            int ic = in.get(n.id).size(), oc = out.get(n.id).size();
            boolean validDegree = switch(n.type) {
                case "start" -> ic == 0 && oc == 1;
                case "end" -> ic == 1 && oc == 0;
                case "exclusiveGateway", "parallelFork" -> ic == 1 && oc >= 2 && oc <= MAX_BRANCHES;
                case "exclusiveMerge", "parallelJoin" -> ic >= 2 && ic <= MAX_BRANCHES && oc == 1;
                default -> ic == 1 && oc == 1;
            };
            if (!validDegree) errors.add(new Diagnostic("NODE_DEGREE", "Invalid incoming/outgoing connections for " + n.type,n.id,null));
            if (n.human() && (("approval".equals(n.type) && (n.assigneeIds.size()!=1 || !"ALL".equals(n.completionMode))) ||
                    ("parallelApproval".equals(n.type) && n.assigneeIds.size()<2)))
                errors.add(new Diagnostic("ASSIGNMENT", "Single approval requires one participant; group approval requires 2–16",n.id,null));
            if (n.split() || n.merge()) {
                Node pair = byId.get(n.pairId);
                String expected = switch(n.type) { case "exclusiveGateway" -> "exclusiveMerge"; case "exclusiveMerge" -> "exclusiveGateway"; case "parallelFork" -> "parallelJoin"; default -> "parallelFork"; };
                if (pair == null || !expected.equals(pair.type) || !n.id.equals(pair.pairId)) errors.add(new Diagnostic("PAIR", "Region must have a reciprocal pair of the matching type",n.id,null));
            }
            if ("exclusiveGateway".equals(n.type)) {
                List<Edge> branches = out.get(n.id); long defaults = branches.stream().filter(Edge::defaultBranch).count();
                if (defaults != 1 || branches.isEmpty() || !branches.get(branches.size()-1).defaultBranch)
                    errors.add(new Diagnostic("DEFAULT_BRANCH", "Exactly one default branch must be last (FIRST_MATCH)",n.id,null));
                for (Edge e : branches) if (e.defaultBranch == (e.condition != null)) errors.add(new Diagnostic("BRANCH_CONDITION", "Each conditional branch needs a rule; default has no rule",n.id,e.id));
            }
        }
        if (!errors.isEmpty()) return List.copyOf(errors);
        Node start = d.nodes.stream().filter(n -> "start".equals(n.type)).findFirst().orElseThrow();
        Node end = d.nodes.stream().filter(n -> "end".equals(n.type)).findFirst().orElseThrow();
        Set<String> visited = new HashSet<>();
        try {
            int minimum = walk(start.id,end.id,0,byId,out,visited);
            if (!visited.add(end.id)) throw new GraphError("CYCLE", "End reached more than once",end.id);
            if (minimum == 0) errors.add(new Diagnostic("EMPTY_APPROVAL_PATH", "Every successful execution path must include human approval",end.id,null));
            for (Node n : d.nodes) if (!visited.contains(n.id)) errors.add(new Diagnostic("UNREACHABLE", "Node is detached from the structured flow",n.id,null));
        } catch (GraphError e) { errors.add(new Diagnostic(e.code,e.getMessage(),e.node,null)); }
        return List.copyOf(errors);
    }
    private static int walk(String current,String stop,int depth,Map<String,Node> nodes,Map<String,List<Edge>> out,Set<String> visited) {
        int minimum = 0;
        while (!current.equals(stop)) {
            Node n = nodes.get(current);
            if (!visited.add(current)) throw new GraphError("CROSS_REGION_OR_CYCLE", "Nodes cannot be shared across branches or revisited",current);
            if (n.merge() || "end".equals(n.type)) throw new GraphError("REGION_ESCAPE", "A branch must return to its own paired merge/join",current);
            if (n.human()) minimum++;
            if (n.split()) {
                if (depth >= MAX_DEPTH) throw new GraphError("DEPTH_LIMIT", "At most two nested conditional/parallel regions are supported",current);
                int branchMinimum = "parallelFork".equals(n.type) ? 0 : Integer.MAX_VALUE;
                for (Edge edge : out.get(current)) {
                    int count = walk(edge.target,n.pairId,depth+1,nodes,out,visited);
                    branchMinimum = "parallelFork".equals(n.type) ? branchMinimum + count : Math.min(branchMinimum,count);
                }
                if (!visited.add(n.pairId)) throw new GraphError("PAIR_REUSE", "A merge/join belongs to exactly one region",n.pairId);
                minimum += branchMinimum; current = out.get(n.pairId).get(0).target;
            } else current = out.get(current).get(0).target;
        }
        return minimum;
    }
    private static final class GraphError extends IllegalArgumentException {
        final String code,node; GraphError(String code,String message,String node) { super(message); this.code=code; this.node=node; }
    }
}
