package com.arcflow.approval.graph;

import com.arcflow.approval.BusinessDocument;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Bounded independent oracle: no production reducer/validator is used to compute expectations. */
class GraphReferenceModelTest {
    private static final String AT = "2026-11-03T00:00:00Z";
    private static final List<String> NODES = List.of("left", "right", "final");
    private static final List<List<String>> ACTORS = List.of(List.of("bob", "carol"), List.of("dave", "erin"), List.of("frank"));
    private long states, decisions, terminalStates, illegalDecisions;

    /**
     * Separate mathematical specification for two voting groups and a barrier.
     * A vote is -1 (absent), 0 (reject), or 1 (approve). A group's approval
     * threshold is its population for ALL and one for ANY. Rejection is forced
     * when the remaining voters cannot possibly reach that threshold.
     */
    private record Model(int[][] votes, int[] threshold, int depth) {
        Model vote(int node, int actor, int decision) {
            int[][] next = Arrays.stream(votes).map(int[]::clone).toArray(int[][]::new);
            next[node][actor] = decision;
            return new Model(next, threshold, depth + 1);
        }
        String outcome(int node) {
            long yes = Arrays.stream(votes[node]).filter(v -> v == 1).count();
            long remaining = Arrays.stream(votes[node]).filter(v -> v == -1).count();
            return yes >= threshold[node] ? "COMPLETED" : yes + remaining < threshold[node] ? "REJECTED" : "ACTIVE";
        }
        boolean joined() { return outcome(0).equals("COMPLETED") && outcome(1).equals("COMPLETED"); }
        String status() {
            for (int n = 0; n < 3; n++) if (outcome(n).equals("REJECTED")) return "REJECTED";
            return outcome(2).equals("COMPLETED") ? "APPROVED" : "PENDING";
        }
        boolean exists(int node) { return node < 2 || joined(); }
        String taskStatus(int node) {
            String own = outcome(node);
            return status().equals("REJECTED") && own.equals("ACTIVE") ? "CANCELLED" : own;
        }
        boolean allowed(int node, int actor) {
            return status().equals("PENDING") && exists(node) && outcome(node).equals("ACTIVE") && votes[node][actor] == -1;
        }
    }

    @Test void exhaustivelyChecksEveryDecisionOrderingAgainstIndependentThresholdModel() {
        for (String left : List.of("ALL", "ANY")) for (String right : List.of("ALL", "ANY")) {
            var model = new Model(new int[][]{{-1,-1},{-1,-1},{-1}}, new int[]{left.equals("ALL") ? 2 : 1, right.equals("ALL") ? 2 : 1, 1}, 0);
            var actual = GraphEngine.start("request", "submission", "alice", definition(left,right), document(), AT);
            walk(model, actual, left + "/" + right);
        }
        assertEquals(916, states, "Every reachable prefix must be visited");
        assertEquals(912, decisions, "Every legal edge must be explored");
        assertEquals(560, terminalStates, "Every terminal path must be checked");
        assertEquals(1816, illegalDecisions, "Every forbidden first vote must be rejected");
        System.out.printf("REFERENCE_MODEL states=%d decisions=%d terminal=%d illegal=%d%n", states, decisions, terminalStates, illegalDecisions);
    }

    private void walk(Model model, GraphInstance actual, String path) {
        states++;
        assertProjection(model, actual, path);
        if (!model.status().equals("PENDING")) terminalStates++;
        for (int node = 0; node < 3; node++) for (int actor = 0; actor < ACTORS.get(node).size(); actor++) {
            // Test forbidden first votes even after terminal rejection and before the join.
            if (model.votes[node][actor] != -1) continue;
            for (int decision = 0; decision <= 1; decision++) {
                String task = "request:" + NODES.get(node), person = ACTORS.get(node).get(actor);
                String verdict = decision == 1 ? "APPROVE" : "REJECT";
                String key = "command-" + model.depth;
                String nextPath = path + "/" + NODES.get(node) + ":" + person + ":" + verdict;
                if (model.allowed(node, actor)) {
                    decisions++;
                    var next = GraphEngine.decide(actual, task, person, verdict, "", key, AT);
                    walk(model.vote(node, actor, decision), next, nextPath);
                } else {
                    illegalDecisions++;
                    assertThrows(IllegalArgumentException.class,
                        () -> GraphEngine.decide(actual, task, person, verdict, "", key, AT), nextPath);
                }
            }
        }
    }

    private void assertProjection(Model model, GraphInstance actual, String path) {
        assertEquals(model.status(), actual.status(), path + " request status");
        assertEquals(model.depth, actual.commandRevision(), path + " revision");
        assertEquals(model.depth, actual.commands().size(), path + " command count");
        assertEquals(model.joined() ? 3 : 2, actual.tasks().size(), path + " no premature or duplicate task");
        for (int node = 0; node < 3; node++) {
            final String nodeId = NODES.get(node);
            var matches = actual.tasks().stream().filter(t -> t.nodeId().equals(nodeId)).toList();
            assertEquals(model.exists(node) ? 1 : 0, matches.size(), path + " existence " + nodeId);
            if (!model.exists(node)) continue;
            var task = matches.get(0);
            assertEquals(model.taskStatus(node), task.status(), path + " task status " + nodeId);
            Map<String,String> expectedVotes = new TreeMap<>();
            for (int actor = 0; actor < ACTORS.get(node).size(); actor++) if (model.votes[node][actor] != -1)
                expectedVotes.put(ACTORS.get(node).get(actor), model.votes[node][actor] == 1 ? "APPROVE" : "REJECT");
            Map<String,String> savedVotes = new TreeMap<>();
            task.votes().forEach(v -> assertNull(savedVotes.put(v.actorId(), v.decision()), path + " duplicate voter"));
            assertEquals(expectedVotes, savedVotes, path + " votes " + nodeId);
        }
        assertEquals(1, actual.forks().size(), path + " fork count");
        var fork = actual.forks().get(0);
        assertEquals(model.joined(), fork.fired(), path + " barrier");
        Set<String> expectedArrivals = new TreeSet<>();
        for (int n = 0; n < 2; n++) if (model.outcome(n).equals("COMPLETED")) expectedArrivals.add(n == 0 ? "fork-left" : "fork-right");
        assertEquals(expectedArrivals, new TreeSet<>(fork.arrivedBranchIds()), path + " arrivals");
        assertEquals(expectedArrivals.size(), fork.arrivedBranchIds().size(), path + " unique arrivals");
        assertEquals(model.joined() ? 1 : 0, actual.events().stream().filter(e -> e.type().equals("JOIN_FIRED")).count(), path + " exactly one join");
        assertEquals(model.status().equals("APPROVED") ? 1 : 0, actual.events().stream().filter(e -> e.type().equals("COMPLETED")).count(), path + " final completion");
    }

    private static GraphDefinition definition(String left, String right) {
        var nodes = List.of(
            node("start", "start", List.of(), null, null), node("fork", "parallelFork", List.of(), null, "join"),
            node("left", "parallelApproval", ACTORS.get(0), left, null), node("right", "parallelApproval", ACTORS.get(1), right, null),
            node("join", "parallelJoin", List.of(), null, "fork"), node("final", "approval", ACTORS.get(2), "ALL", null),
            node("end", "end", List.of(), null, null));
        return new GraphDefinition(5, "reference-model", 1, "Independent voting/barrier model", nodes,
            List.of(edge("start-fork","start","fork"), edge("fork-left","fork","left"), edge("fork-right","fork","right"),
                edge("left-join","left","join"), edge("right-join","right","join"), edge("join-final","join","final"), edge("final-end","final","end")));
    }
    private static GraphDefinition.Node node(String id, String type, List<String> people, String mode, String pair) {
        return new GraphDefinition.Node(id,type,id,people,mode,pair);
    }
    private static GraphDefinition.Edge edge(String id, String from, String to) { return new GraphDefinition.Edge(id,from,to,id,null,false); }
    private static BusinessDocument.PaymentRequest document() {
        return new BusinessDocument.PaymentRequest(1,"MODEL-1","Model fixture","Synthetic only","SUP-1","CNY","2026-11-03",
            List.of(new BusinessDocument.PaymentLine("L1","INV-1","Item",new BigDecimal("100"),BigDecimal.ZERO,new BigDecimal("100"),BigDecimal.ZERO,"")));
    }
}
