package com.arcflow.approval;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

class ParallelApprovalTest {
    @TempDir Path directory;
    final ObjectMapper mapper = ApprovalService.strictMapper(new ObjectMapper());
    final ActorDirectoryTest.Directory users = new ActorDirectoryTest.Directory();
    ParallelApprovalTest() { users.active.addAll(List.of("303", "404", "505")); }
    Path file() { return directory.resolve("state.json"); }
    ApprovalService open(ProcessDefinition definition) throws IOException {
        return new ApprovalService(mapper, file().toString(), users, definition);
    }
    static ProcessDefinition definition(String mode, boolean subsequent) {
        var nodes = new ArrayList<ProcessDefinition.ProcessNode>();
        nodes.add(new ProcessDefinition.ProcessNode("start", "start", "Submit", null));
        nodes.add(new ProcessDefinition.ProcessNode("review", "parallelApproval", "Review", null, List.of("202", "303", "404"), mode));
        if (subsequent) nodes.add(new ProcessDefinition.ProcessNode("final", "approval", "Final", "202"));
        nodes.add(new ProcessDefinition.ProcessNode("end", "end", "End", null));
        return new ProcessDefinition(3, "leave-approval", 1, "Parallel leave", nodes);
    }
    static void status(int code, org.junit.jupiter.api.function.Executable action) {
        assertEquals(code, assertThrows(ResponseStatusException.class, action).getStatusCode().value());
    }
    ApprovalService.Request submit(ApprovalService service) throws IOException { return service.submit("101", "Leave", "Rest", 1, 1); }

    @Test void allRequiresEveryParticipantThenAdvancesExactlyOnceToSequentialStep() throws Exception {
        try (var service = open(definition("ALL", true))) {
            var r = submit(service);
            assertEquals(List.of("202", "303", "404"), ApprovalService.pendingApproverIds(r));
            var partial = service.decide("303", r.id(), "review", "APPROVE", " first ");
            assertEquals("PENDING", partial.status()); assertEquals("review", partial.currentStepId());
            assertEquals("202", partial.approverId()); assertEquals(List.of("202", "404"), ApprovalService.pendingApproverIds(partial));
            assertEquals("first", partial.comment());
            status(409, () -> service.decide("202", r.id(), "final", "APPROVE", "too early"));
            assertEquals(partial, service.decide("303", r.id(), "review", "APPROVE", "ignored"));
            status(409, () -> service.decide("303", r.id(), "review", "REJECT", "opposite"));
            service.decide("404", r.id(), "review", "APPROVE", "second");
            var advanced = service.decide("202", r.id(), "review", "APPROVE", "third");
            assertEquals("final", advanced.currentStepId()); assertEquals(4, advanced.history().size());
            assertEquals(advanced, service.decide("202", r.id(), "review", "APPROVE", "cannot vote final via retry"));
            var done = service.decide("202", r.id(), "final", "APPROVE", "fourth");
            assertEquals("APPROVED", done.status()); assertEquals(5, done.history().size());
            assertTrue(ApprovalService.pendingApproverIds(done).isEmpty());
        }
    }

    @Test void allFirstRejectionClosesWithoutInventingVotesForUnvotedParticipants() throws Exception {
        try (var service = open(definition("ALL", true))) {
            var r = submit(service);
            service.decide("202", r.id(), "review", "APPROVE", "yes");
            var rejected = service.decide("303", r.id(), "review", "REJECT", "no");
            assertEquals("REJECTED", rejected.status()); assertNull(rejected.currentStepId());
            assertEquals(3, rejected.history().size());
            status(409, () -> service.decide("404", r.id(), "review", "APPROVE", "late"));
            status(409, () -> service.decide("202", r.id(), "final", "APPROVE", "late"));
            assertEquals(rejected, service.decide("202", r.id(), "review", "APPROVE", "replay"));
        }
    }

    @Test void anyRejectIsAnIndividualVoteUntilAllReject() throws Exception {
        try (var service = open(definition("ANY", false))) {
            var r = submit(service);
            var partial = service.decide("202", r.id(), "review", "REJECT", "no");
            assertEquals("PENDING", partial.status()); assertEquals("REJECT", partial.decision());
            assertEquals(List.of("303", "404"), ApprovalService.pendingApproverIds(partial));
            assertEquals("303", partial.approverId());
            assertEquals("PENDING", service.decide("404", r.id(), "review", "REJECT", "no").status());
            var rejected = service.decide("303", r.id(), "review", "REJECT", "no");
            assertEquals("REJECTED", rejected.status()); assertEquals(4, rejected.history().size());
        }
    }

    @Test void anyFirstApprovalClosesAndUnvotedParticipantsCannotReplayAnotherActorsVote() throws Exception {
        try (var service = open(definition("ANY", false))) {
            var r = submit(service);
            service.decide("202", r.id(), "review", "REJECT", "no");
            var done = service.decide("404", r.id(), "review", "APPROVE", "yes");
            assertEquals("APPROVED", done.status()); assertEquals(3, done.history().size());
            status(409, () -> service.decide("303", r.id(), "review", "APPROVE", "not a replay"));
            assertEquals(done, service.decide("202", r.id(), "review", "REJECT", "replay"));
            status(409, () -> service.decide("202", r.id(), "review", "APPROVE", "opposite"));
        }
    }

    @Test void identityVisibilityAssignmentAndSelfApprovalApplyToEveryGroupMember() throws Exception {
        try (var service = open(definition("ALL", false))) {
            var r = submit(service);
            for (String actor : List.of("101", "202", "303", "404")) assertEquals(1, service.list(actor).size());
            assertTrue(service.list("505").isEmpty());
            status(404, () -> service.decide("505", r.id(), "review", "APPROVE", "outsider"));
            status(403, () -> service.decide("101", r.id(), "review", "APPROVE", "applicant"));
            for (String actor : List.of("202", "303", "404")) status(400, () -> service.submit(actor, "Leave", "Rest", 1, 1));
            users.active.remove("404");
            status(400, () -> submit(service));
            status(400, () -> service.publish("1", 1, definition("ANY", false)));
            status(403, () -> service.decide("404", r.id(), "review", "APPROVE", "inactive"));
        }
    }

    @Test void staleReadReloadRetainsDifferentParticipantVotesAndRechecksActorActivity() throws Exception {
        try (var store = new ApprovalStoreRaceTest.InterleavingStore(new JsonApprovalStore(mapper, file().toString(), definition("ALL", false)));
             var service = new ApprovalService(store, users)) {
            var r = submit(service);
            store.beforeUpdate = () -> service.decide("303", r.id(), "review", "APPROVE", "winner");
            var next = service.decide("202", r.id(), "review", "APPROVE", "second");
            assertEquals(List.of("101", "303", "202"), next.history().stream().map(ApprovalService.Event::actorId).toList());
            assertEquals(List.of("404"), ApprovalService.pendingApproverIds(next));
            store.beforeUpdate = () -> { service.decide("404", r.id(), "review", "APPROVE", "winner"); users.active.remove("404"); };
            status(403, () -> service.decide("404", r.id(), "review", "APPROVE", "retry"));
            assertEquals("APPROVED", service.list("101").get(0).status());
        }
    }

    @Test void anyConcurrentApproveAndRejectAlwaysYieldsApprovalAcrossBothCommitOrders() throws Exception {
        for (boolean approveFirst : List.of(true, false)) {
            Path path = directory.resolve("race-" + approveFirst + ".json");
            try (var store = new ApprovalStoreRaceTest.InterleavingStore(new JsonApprovalStore(mapper, path.toString(), definition("ANY", false)));
                 var service = new ApprovalService(store, users)) {
                var r = submit(service);
                store.beforeUpdate = () -> service.decide("303", r.id(), "review", approveFirst ? "APPROVE" : "REJECT", "first");
                if (approveFirst) status(409, () -> service.decide("202", r.id(), "review", "REJECT", "late"));
                else assertEquals("APPROVED", service.decide("202", r.id(), "review", "APPROVE", "second").status());
                assertEquals("APPROVED", service.list("101").get(0).status());
            }
        }
    }

    @Test void allAndAnyOutcomesMatchBooleanPolicyForEveryVoteCombinationAndOrder() throws Exception {
        var orders = List.of(List.of("202", "303", "404"), List.of("202", "404", "303"),
            List.of("303", "202", "404"), List.of("303", "404", "202"),
            List.of("404", "202", "303"), List.of("404", "303", "202"));
        for (String mode : List.of("ALL", "ANY")) for (int mask = 0; mask < 8; mask++) for (int order = 0; order < orders.size(); order++) {
            var decisions = Map.of("202", (mask & 1) != 0 ? "APPROVE" : "REJECT",
                "303", (mask & 2) != 0 ? "APPROVE" : "REJECT", "404", (mask & 4) != 0 ? "APPROVE" : "REJECT");
            Path path = directory.resolve(mode + "-" + mask + "-" + order + ".json");
            try (var service = new ApprovalService(mapper, path.toString(), users, definition(mode, false))) {
                var request = submit(service);
                for (String actor : orders.get(order)) {
                    var previous = request;
                    if ("PENDING".equals(request.status())) request = service.decide(actor, request.id(), "review", decisions.get(actor), "vote");
                    else status(409, () -> service.decide(actor, previous.id(), "review", decisions.get(actor), "closed"));
                }
                boolean accepted = "ALL".equals(mode) ? mask == 7 : mask != 0;
                assertEquals(accepted ? "APPROVED" : "REJECTED", request.status());
                ApprovalService.validateRequest(request);
            }
        }
    }

    @Test void maximumEightGroupsSixteenParticipantsReplayAll128Votes() throws Exception {
        var participants = java.util.stream.IntStream.range(0, 16).mapToObj(i -> "member" + i).toList();
        users.active.addAll(participants);
        var nodes = new ArrayList<ProcessDefinition.ProcessNode>();
        nodes.add(new ProcessDefinition.ProcessNode("start", "start", "Start", null));
        for (int stage = 0; stage < 8; stage++)
            nodes.add(new ProcessDefinition.ProcessNode("group" + stage, "parallelApproval", "Review", null, participants, "ALL"));
        nodes.add(new ProcessDefinition.ProcessNode("end", "end", "End", null));
        var definition = new ProcessDefinition(3, "leave-approval", 1, "Maximum", nodes);
        ApprovalService.Request request;
        try (var service = open(definition)) {
            request = submit(service);
            for (int stage = 0; stage < 8; stage++) for (String actor : participants)
                request = service.decide(actor, request.id(), "group" + stage, "APPROVE", "yes");
            assertEquals(129, request.history().size()); assertEquals("APPROVED", request.status());
        }
        try (var restarted = open(definition)) { assertEquals(request, restarted.list("101").get(0)); }
    }

    @Test void pendingGroupSurvivesRestartAndPublicationDoesNotRewriteItsDefinition() throws Exception {
        ApprovalService.Request partial;
        try (var service = open(definition("ANY", true))) {
            var r = submit(service);
            partial = service.decide("404", r.id(), "review", "REJECT", "saved");
            service.publish("1", 1, ProcessDefinition.legacy("303"));
        }
        users.active.remove("404");
        try (var service = open(ProcessDefinition.legacy("202"))) {
            assertEquals(2, service.process().schemaVersion());
            assertEquals(partial, service.list("101").get(0));
            assertEquals(List.of("202", "303"), ApprovalService.pendingApproverIds(partial));
            status(403, () -> service.decide("404", partial.id(), "review", "REJECT", "replay"));
            assertEquals("final", service.decide("303", partial.id(), "review", "APPROVE", "yes").currentStepId());
            assertEquals(3, mapper.readTree(Files.readAllBytes(file())).path("schemaVersion").intValue());
        }
    }

    @Test void upgradeBacksUpLatestSchema2BytesAndRetainsSequentialShapes() throws Exception {
        byte[] beforeUpgrade;
        try (var service = open(ProcessDefinition.legacy("202"))) { submit(service); }
        try (var service = open(ProcessDefinition.legacy("202"))) {
            var r = service.list("101").get(0);
            service.decide("202", r.id(), "manager", "APPROVE", "latest schema2 write");
            beforeUpgrade = Files.readAllBytes(file());
            ObjectNode old = (ObjectNode) mapper.readTree(beforeUpgrade);
            assertEquals(2, old.path("schemaVersion").intValue());
            for (var node : old.path("definition").path("nodes")) assertEquals(4, node.size());
            service.publish("1", 1, definition("ALL", false));
            assertArrayEquals(beforeUpgrade, Files.readAllBytes(file().resolveSibling("state.json.schema2.bak")));
            assertEquals(3, mapper.readTree(Files.readAllBytes(file())).path("schemaVersion").intValue());
            assertEquals("APPROVED", service.list("101").get(0).status());
        }
    }

    @Test void groupDefinitionsRejectInvalidMembersModesAndSchemaDowngrades() throws Exception {
        var good = definition("ALL", false);
        var invalid = new ArrayList<ProcessDefinition>();
        invalid.add(new ProcessDefinition(2, good.id(), 1, good.name(), good.nodes()));
        for (List<String> members : List.of(List.<String>of(), List.of("202"), List.of("202", "202"), List.of("202", " "),
                java.util.stream.IntStream.range(0,17).mapToObj(Integer::toString).toList()))
            invalid.add(withGroup(good, new ProcessDefinition.ProcessNode("review", "parallelApproval", "Review", null, members, "ALL")));
        for (String mode : Arrays.asList(null, "all", "FIRST", ""))
            invalid.add(withGroup(good, new ProcessDefinition.ProcessNode("review", "parallelApproval", "Review", null, List.of("202", "303"), mode)));
        invalid.add(withGroup(good, new ProcessDefinition.ProcessNode("review", "parallelApproval", "Review", "202", List.of("202", "303"), "ANY")));
        invalid.add(withGroup(good, new ProcessDefinition.ProcessNode("review", "approval", "Review", "202", List.of("202", "303"), "ANY")));
        for (var value : invalid) assertThrows(IllegalArgumentException.class, () -> ProcessDefinition.validate(value));
        assertThrows(UnsupportedOperationException.class, () -> good.approvals().get(0).assigneeIds().clear());
    }
    static ProcessDefinition withGroup(ProcessDefinition definition, ProcessDefinition.ProcessNode group) {
        return new ProcessDefinition(3, definition.id(), 1, definition.name(), List.of(definition.nodes().get(0), group, definition.nodes().get(2)));
    }

    @Test void strictNodeDecoderRejectsMissingExtraCoercibleAndNullParticipantFields() throws Exception {
        ObjectNode good = mapper.valueToTree(definition("ALL", false).approvals().get(0));
        var invalid = new ArrayList<ObjectNode>();
        for (String field : List.of("id", "type", "name", "assigneeId", "assigneeIds", "completionMode")) {
            var node = good.deepCopy(); node.remove(field); invalid.add(node);
        }
        var extra = good.deepCopy(); extra.put("unknown", "x"); invalid.add(extra);
        var numeric = good.deepCopy(); numeric.putArray("assigneeIds").add(202).add("303"); invalid.add(numeric);
        var nullMember = good.deepCopy(); nullMember.putArray("assigneeIds").addNull().add("303"); invalid.add(nullMember);
        var numericName = good.deepCopy(); numericName.put("name", 123); invalid.add(numericName);
        for (var node : invalid) assertThrows(IOException.class, () -> mapper.readValue(node.toString(), ProcessDefinition.ProcessNode.class));
        assertEquals(definition("ALL", false).approvals().get(0), mapper.readValue(good.toString(), ProcessDefinition.ProcessNode.class));
    }

    @Test void replayRejectsForgedVotesAndDerivedFields() throws Exception {
        ApprovalService.Request partial;
        try (var service = open(definition("ANY", true))) {
            var r = submit(service); partial = service.decide("303", r.id(), "review", "REJECT", "no");
        }
        ObjectNode saved = mapper.valueToTree(partial);
        List<Consumer<ObjectNode>> mutations = List.of(
            n -> n.put("status", "REJECTED"), n -> n.put("currentStepId", "final"), n -> n.put("approverId", "303"),
            n -> n.withArray("history").add(n.withArray("history").get(1).deepCopy()),
            n -> ((ObjectNode)n.withArray("history").get(1)).put("actorId", "505"),
            n -> ((ObjectNode)n.withArray("history").get(1)).put("stepId", "final"),
            n -> ((ObjectNode)n.withArray("history").get(1)).put("at", "2000-01-01T00:00:00Z"),
            n -> n.put("decision", "APPROVE"));
        for (var change : mutations) {
            var changed = saved.deepCopy(); change.accept(changed);
            var request = mapper.treeToValue(changed, ApprovalService.Request.class);
            assertThrows(IllegalArgumentException.class, () -> ApprovalService.validateRequest(request));
        }
        // A claimed schema2 container cannot smuggle a schema3 active or request definition.
        ObjectNode snapshot = (ObjectNode) mapper.readTree(Files.readAllBytes(file())); snapshot.put("schemaVersion", 2);
        Files.writeString(file(), snapshot.toString());
        assertThrows(IOException.class, () -> open(ProcessDefinition.legacy("202")));
    }
}
