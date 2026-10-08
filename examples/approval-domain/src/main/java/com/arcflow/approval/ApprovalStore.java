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

    /**
     * Actor-scoped request inbox, newest immutable creation position first. Return at most
     * query.limit()+1 matching requests from one consistent snapshot; the extra row is lookahead.
     * Implementations must not silently replace this bounded query with requests() full replay.
     */
    default List<ApprovalService.Request> inbox(InboxQuery query) throws IOException {
        throw new IOException("This approval store does not support bounded member inbox queries");
    }

    /** Publish only if the active version still equals expectedVersion. */
    boolean publish(String actor, int expectedVersion, ProcessDefinition next) throws IOException;

    /** Insert the request and submission event only if the active process version still matches. */
    boolean create(int expectedProcessVersion, ApprovalService.Request request) throws IOException;

    /** Read a durable binding in the applicant's exact key scope. Never fall back to an in-memory cache. */
    default ApprovalService.Request submission(String applicantId, String key) throws IOException {
        throw new IOException("This approval store does not support durable submission keys");
    }

    /**
     * Resolve an existing applicant/key binding BEFORE checking the active version, or atomically
     * insert request, submission event and binding. Return null only for a process-version race.
     * Existing bindings return the current request; the service checks the immutable intent.
     */
    default ApprovalService.Request create(int expectedProcessVersion, ApprovalService.Request request, String key) throws IOException {
        throw new IOException("This approval store does not support durable submission keys");
    }

    /** Append one decision and update its request atomically, or return false on a revision race. */
    boolean update(int expectedRevision, ApprovalService.Request next) throws IOException;

    @Override void close() throws IOException;
}
