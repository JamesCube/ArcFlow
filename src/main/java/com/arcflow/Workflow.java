package com.arcflow;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Objects;

/** Immutable, validated DAG. Order among eligible nodes follows declaration order. */
public final class Workflow {
    private final String id;
    private final List<Node> executionOrder;

    public Workflow(String id, List<Node> nodes) {
        Node.requireName(id, "workflow id");
        this.id = id;
        Objects.requireNonNull(nodes, "nodes");
        if (nodes.isEmpty()) throw new IllegalArgumentException("Workflow must contain a node");
        var remaining = new LinkedHashMap<String, Node>();
        for (var node : List.copyOf(nodes)) {
            if (remaining.putIfAbsent(node.id(), node) != null) {
                throw new IllegalArgumentException("Duplicate node: " + node.id());
            }
        }
        for (var node : remaining.values()) {
            for (var dependency : node.dependsOn()) {
                if (!remaining.containsKey(dependency)) {
                    throw new IllegalArgumentException("Unknown dependency: " + dependency);
                }
            }
        }
        var ordered = new ArrayList<Node>();
        var completed = new HashSet<String>();
        while (!remaining.isEmpty()) {
            Node next = remaining.values().stream()
                    .filter(node -> completed.containsAll(node.dependsOn())).findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("Workflow contains a cycle"));
            ordered.add(next);
            completed.add(next.id());
            remaining.remove(next.id());
        }
        this.executionOrder = List.copyOf(ordered);
    }

    public String id() { return id; }
    public List<Node> executionOrder() { return executionOrder; }
}
