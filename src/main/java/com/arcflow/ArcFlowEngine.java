package com.arcflow;

import com.arcflow.spi.EventListener;
import com.arcflow.spi.NodeHandler;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Stateless synchronous DAG runner. Concurrency safety depends on supplied SPIs. */
public final class ArcFlowEngine {
    private final Map<String, NodeHandler> handlers;
    private final List<EventListener> listeners;

    public ArcFlowEngine(Map<String, NodeHandler> handlers) {
        this(handlers, List.of());
    }

    public ArcFlowEngine(Map<String, NodeHandler> handlers, List<EventListener> listeners) {
        this.handlers = Map.copyOf(handlers);
        this.listeners = List.copyOf(listeners);
    }

    public ExecutionResult execute(Workflow workflow, Map<String, String> initialVariables) {
        Objects.requireNonNull(workflow, "workflow");
        var variables = new LinkedHashMap<>(Map.copyOf(initialVariables));
        // Validate all bindings before allowing any handler side effects.
        for (var node : workflow.executionOrder()) {
            if (!handlers.containsKey(node.handler())) {
                throw new IllegalArgumentException("No handler registered: " + node.handler());
            }
        }
        var completed = new ArrayList<String>();
        for (var node : workflow.executionOrder()) {
            emit(workflow, node, ExecutionEvent.Type.STARTED);
            Map<String, String> updates;
            try {
                updates = Map.copyOf(handlers.get(node.handler()).execute(node, Map.copyOf(variables)));
            } catch (Exception cause) {
                if (cause instanceof InterruptedException) Thread.currentThread().interrupt();
                var failure = new WorkflowExecutionException(node.id(), cause);
                try { emit(workflow, node, ExecutionEvent.Type.FAILED); }
                catch (RuntimeException observerFailure) { failure.addSuppressed(observerFailure); }
                throw failure;
            }
            variables.putAll(updates);
            completed.add(node.id());
            emit(workflow, node, ExecutionEvent.Type.COMPLETED);
        }
        return new ExecutionResult(workflow.id(), completed, variables);
    }

    private void emit(Workflow workflow, Node node, ExecutionEvent.Type type) {
        var event = new ExecutionEvent(workflow.id(), node.id(), type);
        listeners.forEach(listener -> listener.onEvent(event));
    }
}
