package com.arcflow.approval;

import java.io.IOException;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

/** File-free deterministic schedules at the exact last permitted compare-and-set attempt. */
class ApprovalRetryBoundaryTest {
    @ParameterizedTest @ValueSource(strings = {"ALL", "ANY"})
    void finalCasMissReloadsTheCallersDurableDuplicateForBothCompletionModes(String mode) throws Exception {
        var fixture = new Fixture(mode);
        String vote = "ALL".equals(mode) ? "APPROVE" : "REJECT";
        fixture.interfere(vote, false);
        var result = fixture.service.decide("member15", fixture.request.id(), "group", vote, "loser");
        assertEquals("ALL".equals(mode) ? "APPROVED" : "REJECTED", result.status());
        assertEquals(17, result.history().size());
        assertEquals("winner15", result.history().get(16).comment());
        assertEquals(fixture.store.saved, result);
        assertEquals(16, fixture.store.outerAttempts);
        assertEquals(16, fixture.store.competingWrites);
        assertEquals(17, fixture.store.outerReads);
        assertEquals(0, fixture.store.outerWrites);
    }

    @ParameterizedTest @ValueSource(strings = {"ALL", "ANY"})
    void finalReadRechecksLiveAuthorizationBeforeReturningACommittedDuplicate(String mode) throws Exception {
        var fixture = new Fixture(mode);
        fixture.interfere("ALL".equals(mode) ? "APPROVE" : "REJECT", true);
        var error = assertThrows(ResponseStatusException.class, () -> fixture.service.decide(
            "member15", fixture.request.id(), "group", "ALL".equals(mode) ? "APPROVE" : "REJECT", "loser"));
        assertEquals(403, error.getStatusCode().value());
        assertEquals(17, fixture.store.saved.history().size());
        assertEquals(16, fixture.store.outerAttempts);
        assertEquals(0, fixture.store.outerWrites);
    }

    @ParameterizedTest @ValueSource(strings = {"ALL", "ANY"})
    void finalReadPreservesOppositeDecisionConflictAndOriginalComment(String mode) throws Exception {
        var fixture = new Fixture(mode);
        fixture.interfere("ALL".equals(mode) ? "REJECT" : "APPROVE", false);
        var error = assertThrows(ResponseStatusException.class, () -> fixture.service.decide(
            "member15", fixture.request.id(), "group", "ALL".equals(mode) ? "APPROVE" : "REJECT", "loser"));
        assertEquals(409, error.getStatusCode().value());
        assertEquals("This step already has a different decision", error.getReason());
        assertEquals("ALL".equals(mode) ? "REJECTED" : "APPROVED", fixture.store.saved.status());
        assertEquals("winner15", fixture.store.saved.comment());
        assertEquals(17, fixture.store.saved.history().size());
        assertEquals(16, fixture.store.outerAttempts);
        assertEquals(0, fixture.store.outerWrites);
    }

    @Test void finalReplayCannotAdvanceARepeatedActorInTheFollowingStage() throws Exception {
        var fixture = new Fixture("ALL", true);
        fixture.interfere("APPROVE", false);
        var result = fixture.service.decide("member15", fixture.request.id(), "group", "APPROVE", "ignored");
        assertEquals("PENDING", result.status()); assertEquals("final", result.currentStepId());
        assertEquals(List.of("member15"), ApprovalService.pendingApproverIds(result));
        assertEquals(17, result.history().size()); assertEquals(17, fixture.store.outerReads);
        assertEquals(16, fixture.store.outerAttempts); assertEquals(0, fixture.store.outerWrites);
        assertEquals(fixture.store.saved.history().get(16).at(), result.updatedAt());
        assertEquals("winner15", result.comment());
    }

    @Test void finalReadFailureIsNotConvertedIntoAConflictOrSuccess() throws Exception {
        var fixture = new Fixture("ALL");
        fixture.interfere("APPROVE", false);
        fixture.store.failFinalRead = true;
        assertEquals("Final read unavailable", assertThrows(IOException.class, () -> fixture.service.decide(
            "member15", fixture.request.id(), "group", "APPROVE", "ignored")).getMessage());
        assertEquals("APPROVED", fixture.store.saved.status());
        assertEquals(16, fixture.store.outerAttempts); assertEquals(0, fixture.store.outerWrites);
    }

    @Test void exhaustedBudgetNeverPerformsASeventeenthWriteWhenStoreKeepsReportingConflict() throws Exception {
        var fixture = new Fixture("ALL"); fixture.store.alwaysConflict = true;
        assertEquals(409, assertThrows(ResponseStatusException.class, () -> fixture.service.decide(
            "member15", fixture.request.id(), "group", "APPROVE", "ignored")).getStatusCode().value());
        assertEquals(16, fixture.store.outerAttempts); assertEquals(17, fixture.store.outerReads);
        assertEquals(1, fixture.store.saved.history().size()); assertEquals(0, fixture.store.outerWrites);
    }

    static final class Fixture {
        final ActorDirectoryTest.Directory users = new ActorDirectoryTest.Directory();
        final ContendedStore store;
        final ApprovalService service;
        final ApprovalService.Request request;
        final String mode;
        Fixture(String mode) throws IOException { this(mode, false); }
        Fixture(String mode, boolean subsequent) throws IOException {
            this.mode = mode;
            var members = java.util.stream.IntStream.range(0, 16).mapToObj(i -> "member" + i).toList();
            users.active.addAll(members);
            var nodes = new ArrayList<ProcessDefinition.ProcessNode>();
            nodes.add(new ProcessDefinition.ProcessNode("start", "start", "Start", null));
            nodes.add(new ProcessDefinition.ProcessNode("group", "parallelApproval", "Group", null, members, mode));
            if (subsequent) nodes.add(new ProcessDefinition.ProcessNode("final", "approval", "Final", "member15"));
            nodes.add(new ProcessDefinition.ProcessNode("end", "end", "End", null));
            var definition = new ProcessDefinition(3, "leave-approval", 1, "Boundary", nodes);
            store = new ContendedStore(definition);
            service = new ApprovalService(store, users);
            request = service.submit("101", "Leave", "Rest", 1, 1);
        }
        void interfere(String lastVote, boolean deactivate) {
            store.beforeOuterUpdate = attempt -> {
                String vote = attempt < 15 ? ("ALL".equals(mode) ? "APPROVE" : "REJECT") : lastVote;
                service.decide("member" + attempt, request.id(), "group", vote, "winner" + attempt);
                if (attempt == 15 && deactivate) users.active.remove("member15");
            };
        }
    }

    @FunctionalInterface interface BeforeUpdate { void run(int attempt) throws IOException; }
    static final class ContendedStore implements ApprovalStore {
        final ProcessDefinition definition;
        ApprovalService.Request saved;
        BeforeUpdate beforeOuterUpdate;
        int outerAttempts, competingWrites, outerWrites, outerReads;
        boolean failFinalRead, alwaysConflict;
        boolean insideCompetingCommand;
        ContendedStore(ProcessDefinition definition) { this.definition = definition; }
        public ProcessDefinition process() { return definition; }
        public List<ApprovalService.Request> requests() { return saved == null ? List.of() : List.of(saved); }
        public ApprovalService.Request request(String id) throws IOException {
            if (!insideCompetingCommand && ++outerReads == 17 && failFinalRead) throw new IOException("Final read unavailable");
            return saved != null && saved.id().equals(id) ? saved : null;
        }
        public boolean publish(String actor, int expected, ProcessDefinition next) { throw new UnsupportedOperationException(); }
        public boolean create(int expected, ApprovalService.Request next) {
            ApprovalService.validateRequest(next);
            assertEquals(definition.version(), expected); assertNull(saved); saved = next; return true;
        }
        public boolean update(int expected, ApprovalService.Request next) throws IOException {
            if (!insideCompetingCommand) {
                int attempt = outerAttempts++;
                if (beforeOuterUpdate != null && attempt < 16) {
                    insideCompetingCommand = true;
                    try { beforeOuterUpdate.run(attempt); }
                    finally { insideCompetingCommand = false; }
                }
            }
            if (alwaysConflict || saved.history().size() - 1 != expected) return false;
            ApprovalService.validateTransition(saved, next);
            saved = next;
            if (insideCompetingCommand) competingWrites++; else outerWrites++;
            return true;
        }
        public void close() {}
    }
}
