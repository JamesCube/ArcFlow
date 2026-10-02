package com.arcflow.demo;

import com.arcflow.ArcFlowEngine;
import com.arcflow.Node;
import com.arcflow.Workflow;
import java.util.List;
import java.util.Map;

/** Real synchronous ArcFlow integration; human waiting is deliberately outside the DAG runner. */
final class SubmissionWorkflow {
    private static final Workflow WORKFLOW = new Workflow("leave-submission-v1", List.of(
        new Node("validate", "validate", List.of()), new Node("normalize", "normalize", List.of("validate"))));
    private static final ArcFlowEngine ENGINE = new ArcFlowEngine(Map.of(
        "validate", (node, vars) -> {
            if (vars.get("title").isBlank() || vars.get("title").length() > 120 || vars.get("reason").isBlank() ||
                vars.get("reason").length() > 2000 || Integer.parseInt(vars.get("days")) < 1 || Integer.parseInt(vars.get("days")) > 365)
                throw new IllegalArgumentException("Invalid leave submission");
            return Map.of();
        },
        "normalize", (node, vars) -> Map.of("title", vars.get("title").trim(), "reason", vars.get("reason").trim())
    ));
    static Map<String,String> execute(String title, String reason, int days) {
        return ENGINE.execute(WORKFLOW, Map.of("title", title, "reason", reason, "days", Integer.toString(days))).variables();
    }
    private SubmissionWorkflow() {}
}
