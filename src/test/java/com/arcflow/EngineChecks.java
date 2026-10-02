package com.arcflow;

import com.arcflow.spi.EventListener;
import com.arcflow.spi.NodeHandler;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/** Shared regression checks: run by JUnit/Maven and by the offline script. */
public final class EngineChecks {
    private static int checks;
    private EngineChecks() { }

    public static void main(String[] args) {
        checks = 0;
        var events = new ArrayList<ExecutionEvent>();
        var workflow = new Workflow("diamond", List.of(
                new Node("join", "join", List.of("left", "right")),
                new Node("root", "root", List.of()),
                new Node("left", "left", List.of("root")),
                new Node("right", "right", List.of("root"))));
        var engine = new ArcFlowEngine(Map.of(
                "root", (NodeHandler) (node, vars) -> Map.of("seed", "new"),
                "left", (NodeHandler) (node, vars) -> Map.of("left", vars.get("seed")),
                "right", (NodeHandler) (node, vars) -> Map.of("right", vars.get("seed")),
                "join", (NodeHandler) (node, vars) -> Map.of("joined", vars.get("left") + vars.get("right"))),
                List.of(events::add));
        var result = engine.execute(workflow, Map.of("seed", "old"));
        check(result.completedNodes().equals(List.of("root", "left", "right", "join")), "topological order");
        check(result.variables().get("joined").equals("newnew"), "variable propagation and overwrite");
        check(events.size() == 8 && events.get(0).type() == ExecutionEvent.Type.STARTED
                && events.get(7).type() == ExecutionEvent.Type.COMPLETED, "event order");
        expect(UnsupportedOperationException.class, () -> result.variables().put("x", "x"));
        expect(UnsupportedOperationException.class, () -> result.completedNodes().clear());
        expect(IllegalArgumentException.class, () -> new Workflow("empty", List.of()));
        expect(IllegalArgumentException.class, () -> new Node(" ", "h", List.of()));
        expect(IllegalArgumentException.class, () -> new Node("a", "h", List.of("b", "b")));
        expect(IllegalArgumentException.class, () -> new Workflow("dup", List.of(node("a"), node("a"))));
        expect(IllegalArgumentException.class, () -> new Workflow("missing", List.of(new Node("a", "h", List.of("b")))));
        expect(IllegalArgumentException.class, () -> new Workflow("cycle", List.of(
                new Node("a", "h", List.of("b")), new Node("b", "h", List.of("a")))));
        expect(IllegalArgumentException.class, () -> new Workflow("self", List.of(new Node("a", "h", List.of("a")))));
        var count = new AtomicInteger();
        var missing = new ArcFlowEngine(Map.of("h", (node, vars) -> { count.incrementAndGet(); return Map.of(); }));
        expect(IllegalArgumentException.class, () -> missing.execute(new Workflow("preflight", List.of(
                node("a"), new Node("b", "unknown", List.of("a")))), Map.of()));
        check(count.get() == 0, "preflight before side effects");
        var failureEvents = new ArrayList<ExecutionEvent>();
        var failed = new ArcFlowEngine(Map.of("h", (node, vars) -> { throw new IllegalStateException("boom"); }), List.of(failureEvents::add));
        var exception = expect(WorkflowExecutionException.class, () -> failed.execute(new Workflow("failure", List.of(node("a"), node("b"))), Map.of()));
        check(exception.nodeId().equals("a") && exception.getCause() instanceof IllegalStateException, "failure context");
        check(failureEvents.stream().map(ExecutionEvent::type).toList().equals(List.of(ExecutionEvent.Type.STARTED, ExecutionEvent.Type.FAILED)), "fail fast");
        expect(WorkflowExecutionException.class, () -> new ArcFlowEngine(Map.of("h", (node, vars) -> { vars.put("bad", "bad"); return Map.of(); })).execute(single(), Map.of()));
        expect(WorkflowExecutionException.class, () -> new ArcFlowEngine(Map.of("h", (node, vars) -> null)).execute(single(), Map.of()));
        var mutable = new ArrayList<>(List.of(node("a")));
        var frozen = new Workflow("snapshot", mutable);
        mutable.clear();
        check(frozen.executionOrder().size() == 1, "definition snapshot");
        var interrupts = new ArcFlowEngine(Map.of("h", (node, vars) -> { throw new InterruptedException(); }));
        expect(WorkflowExecutionException.class, () -> interrupts.execute(single(), Map.of()));
        check(Thread.interrupted(), "interrupt flag preserved and cleared by test");
        EventListener badListener = event -> { if (event.type() == ExecutionEvent.Type.FAILED) throw new IllegalStateException("observer"); };
        var diagnostic = new ArcFlowEngine(Map.of("h", (node, vars) -> { throw new Exception("handler"); }), List.of(badListener));
        var diagnosticFailure = expect(WorkflowExecutionException.class, () -> diagnostic.execute(single(), Map.of()));
        check(diagnosticFailure.getCause().getMessage().equals("handler") && diagnosticFailure.getSuppressed().length == 1, "preserve original failure");
        System.out.println("PASS: " + checks + " regression checks");
    }

    private static Node node(String id) { return new Node(id, "h", List.of()); }
    private static Workflow single() { return new Workflow("single", List.of(node("a"))); }
    private static void check(boolean condition, String message) {
        checks++;
        if (!condition) throw new AssertionError(message);
    }
    private static <T extends Throwable> T expect(Class<T> type, Runnable action) {
        checks++;
        try { action.run(); }
        catch (Throwable failure) {
            if (type.isInstance(failure)) return type.cast(failure);
            throw new AssertionError("Expected " + type.getName() + ", got " + failure, failure);
        }
        throw new AssertionError("Expected " + type.getName());
    }
}
