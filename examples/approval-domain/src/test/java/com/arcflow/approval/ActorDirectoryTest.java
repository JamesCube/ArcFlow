package com.arcflow.approval;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

class ActorDirectoryTest {
    @TempDir Path dir;
    static class Directory implements ActorDirectory {
        final Set<String> active = new HashSet<>(List.of("1", "101", "202"));
        public Optional<ApprovalService.Person> findActive(String id) {
            return active.contains(id) ? Optional.of(new ApprovalService.Person(id, "User " + id)) : Optional.empty();
        }
        public List<ApprovalService.Person> listActive() { return active.stream().map(id -> findActive(id).orElseThrow()).toList(); }
        public boolean canPublish(String id) { return "1".equals(id); }
    }
    ApprovalService open(Directory users) throws Exception {
        return new ApprovalService(new ObjectMapper(), dir.resolve("store.json").toString(), users, ProcessDefinition.legacy("202"));
    }
    static void status(int code, org.junit.jupiter.api.function.Executable action) {
        assertEquals(code, assertThrows(ResponseStatusException.class, action).getStatusCode().value());
    }
    @Test void directoryPolicyAndNumericHostIdentitiesReplaceDemoUsers() throws Exception {
        var users = new Directory();
        try (var service = open(users)) {
            status(403, () -> service.publish("101", 1, service.process()));
            service.publish("1", 1, service.process());
            var request = service.submit("1", "Leave", "Family", 1, 2);
            status(403, () -> service.decide("1", request.id(), "manager", "APPROVE", "admin cannot bypass assignment"));
            status(404, () -> service.decide("101", request.id(), "manager", "APPROVE", ""));
            assertEquals("APPROVED", service.decide("202", request.id(), "manager", "APPROVE", "").status());
        }
    }
    @Test void deletedApplicantsAndApproversRemainRestorableButCannotAct() throws Exception {
        var users = new Directory();
        ApprovalService.Request stored;
        try (var service = open(users)) {
            stored = service.submit("101", "Leave", "Rest", 2, 1);
            service.decide("202", stored.id(), "manager", "APPROVE", "ok");
        }
        users.active.removeAll(List.of("101", "202"));
        try (var service = open(users)) {
            assertEquals("202", service.process().approvals().get(0).assigneeId());
            status(403, () -> service.decide("202", stored.id(), "manager", "APPROVE", "retry"));
            status(403, () -> service.submit("101", "Leave", "Rest", 1, 1));
            status(400, () -> service.submit("1", "Leave", "Rest", 1, 1));
            status(400, () -> service.publish("1", 1, service.process()));
            // A directory deletion must not brick the store; an active publisher can repair future routing.
            service.publish("1", 1, ProcessDefinition.legacy("1"));
        }
        users.active.add("101");
        try (var service = open(users)) {
            assertEquals("APPROVED", service.list("101").get(0).status());
            assertEquals("202", service.list("101").get(0).history().get(1).actorId());
        }
    }
    @Test void disabledPublisherIsRejectedEvenWhenPolicySaysTheyCanPublish() throws Exception {
        var users = new Directory();
        try (var service = open(users)) {
            users.active.remove("1");
            status(403, () -> service.publish("1", 1, service.process()));
        }
    }
    @Test void assigneesAreRecheckedOnEachSubmissionAndPublication() throws Exception {
        var users = new Directory();
        try (var service = open(users)) {
            service.publish("1", 1, service.process());
            users.active.remove("202");
            status(400, () -> service.submit("101", "Leave", "Rest", 1, 2));
            status(400, () -> service.publish("1", 2, service.process()));
            users.active.add("202");
            var request = service.submit("101", "Leave", "Rest", 1, 2);
            users.active.remove("202");
            status(403, () -> service.decide("202", request.id(), "manager", "APPROVE", ""));
        }
    }
}
