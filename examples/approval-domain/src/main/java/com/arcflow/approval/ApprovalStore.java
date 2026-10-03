package com.arcflow.approval;

import java.io.IOException;
import java.util.List;

/**
 * Persistence boundary for the approval domain. Each mutation is atomic and becomes visible only
 * after durable commit. Implementations must be safe for the deployment's concurrency model.
 * Request revision is the number of decisions (history size minus one); events are append-only.
 */
public interface ApprovalStore extends AutoCloseable {
    ProcessDefinition process() throws IOException;
    List<ApprovalService.Request> requests() throws IOException;
    ApprovalService.Request request(String id) throws IOException;

    /** Publish only if the active version still equals expectedVersion. */
    boolean publish(String actor, int expectedVersion, ProcessDefinition next) throws IOException;

    /** Insert the request and submission event only if the active process version still matches. */
    boolean create(int expectedProcessVersion, ApprovalService.Request request) throws IOException;

    /** Append one decision and update its request atomically, or return false on a revision race. */
    boolean update(int expectedRevision, ApprovalService.Request next) throws IOException;

    @Override void close() throws IOException;
}
