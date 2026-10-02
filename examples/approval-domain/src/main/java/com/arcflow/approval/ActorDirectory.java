package com.arcflow.approval;

import java.util.List;
import java.util.Optional;

/** Host-owned identity adapter. Each lookup must reflect current active/non-deleted users. */
public interface ActorDirectory {
    Optional<ApprovalService.Person> findActive(String id);
    List<ApprovalService.Person> listActive();
    boolean canPublish(String id);
    default boolean canAssignApproval(String id) { return findActive(id).isPresent(); }
}
