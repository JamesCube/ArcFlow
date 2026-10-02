package com.arcflow;

/** In-process diagnostic event, not a durable audit record. */
public record ExecutionEvent(String workflowId, String nodeId, Type type) {
    public enum Type { STARTED, COMPLETED, FAILED }
}
