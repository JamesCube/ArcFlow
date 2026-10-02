package com.arcflow;

import java.util.List;
import java.util.Map;

public record ExecutionResult(String workflowId, List<String> completedNodes, Map<String, String> variables) {
    public ExecutionResult {
        completedNodes = List.copyOf(completedNodes);
        variables = Map.copyOf(variables);
    }
}
