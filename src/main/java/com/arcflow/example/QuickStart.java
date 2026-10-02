package com.arcflow.example;

import com.arcflow.ArcFlowEngine;
import com.arcflow.Node;
import com.arcflow.Workflow;
import java.util.List;
import java.util.Map;

public final class QuickStart {
    private QuickStart() { }

    public static void main(String[] args) {
        var workflow = new Workflow("order-demo", List.of(
                new Node("validate", "validate", List.of()),
                new Node("price", "price", List.of("validate")),
                new Node("summary", "summary", List.of("price"))));
        var engine = new ArcFlowEngine(Map.of(
                "validate", (node, vars) -> Map.of("validated", "true"),
                "price", (node, vars) -> Map.of("total", "120"),
                "summary", (node, vars) -> Map.of("summary", "Order " + vars.get("orderId") + ": " + vars.get("total"))));
        var result = engine.execute(workflow, Map.of("orderId", "DEMO-001"));
        System.out.println(result.completedNodes());
        System.out.println(result.variables().get("summary"));
    }
}
