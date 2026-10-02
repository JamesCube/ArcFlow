package com.arcflow;

/** Handler failure. External side effects of earlier handlers are not rolled back. */
public final class WorkflowExecutionException extends RuntimeException {
    private static final long serialVersionUID = 1L;
    private final String nodeId;

    public WorkflowExecutionException(String nodeId, Throwable cause) {
        super("Node failed: " + nodeId, cause);
        this.nodeId = nodeId;
    }

    public String nodeId() { return nodeId; }
}
