package com.arcflow.demo;

import com.arcflow.approval.ApprovalService;
import com.arcflow.approval.ProcessDefinition;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"APPROVAL_ALICE_PASSWORD=test-alice-password", "APPROVAL_BOB_PASSWORD=test-bob-password", "APPROVAL_CAROL_PASSWORD=test-carol-password"})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class ApprovalApiTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @DynamicPropertySource static void data(DynamicPropertyRegistry registry) throws Exception {
        var file = Files.createTempDirectory("approval-api-test-").resolve("state.json");
        registry.add("approval.data-file", file::toString);
    }

    @Test void authenticationAndBrowserBoundariesApplyToEveryApi() throws Exception {
        for (String path : List.of("/api/me", "/api/people", "/api/process", "/api/requests")) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.message").isString()).andExpect(header().doesNotExist("WWW-Authenticate"))
                .andExpect(header().doesNotExist("Set-Cookie"));
        }
        mvc.perform(get("/api/me").with(httpBasic("alice", "wrong"))).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/me").with(httpBasic("unknown", "test-alice-password"))).andExpect(status().isUnauthorized());
        for (String user : List.of("alice", "bob", "carol")) {
            mvc.perform(authenticated(get("/api/me"), user)).andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(user)).andExpect(header().doesNotExist("Set-Cookie"));
        }
        mvc.perform(get("/api/me")).andExpect(status().isUnauthorized()); // Basic authentication is not a session.
        mvc.perform(authenticated(get("/not-an-api"), "alice")).andExpect(status().isForbidden());
        mvc.perform(authenticated(get("/api/me"), "alice").header("Origin", "https://evil.example"))
            .andExpect(status().isForbidden());
        mvc.perform(authenticated(get("/api/process"), "alice").header("Sec-Fetch-Site", "cross-site"))
            .andExpect(status().isForbidden());

        for (String path : List.of("/api/process", "/api/requests", "/api/requests/missing/decisions")) {
            mvc.perform(post(path).header("X-Arcflow-Client", "approval-demo").contentType("application/json").content("{}"))
                .andExpect(status().isUnauthorized());
            mvc.perform(authenticated(post(path), "alice").contentType("application/json").content("{}"))
                .andExpect(status().isForbidden());
            mvc.perform(authenticated(post(path), "alice").header("X-Arcflow-Client", "wrong").contentType("application/json").content("{}"))
                .andExpect(status().isForbidden());
            mvc.perform(write(path, "alice").header("Origin", "https://evil.example").content("{}"))
                .andExpect(status().isForbidden());
            mvc.perform(write(path, "alice").header("Origin", "null").content("{}"))
                .andExpect(status().isForbidden());
            mvc.perform(write(path, "alice").header("Origin", "http://localhost:5173").header("Sec-Fetch-Site", "cross-site").content("{}"))
                .andExpect(status().isForbidden());
        }
        mvc.perform(authenticated(post("/api/requests"), "alice").header("X-Arcflow-Client", "approval-demo")
                .contentType("text/plain").content(submission(1).toString())).andExpect(status().isUnsupportedMediaType());
        assertEquals(0, getJson("/api/requests", "alice").size());
        mvc.perform(write("/api/requests", "alice").header("Origin", "http://localhost:5173")
                .header("Sec-Fetch-Site", "same-origin").content(submission(1).toString()))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.applicantId").value("alice"));
    }

    @Test void initialContractHasOrderedFixedEndpointsAndKnownPeople() throws Exception {
        JsonNode process = getJson("/api/process", "alice");
        assertEquals(definition(1, "bob"), process);
        assertEquals(2, process.path("schemaVersion").intValue());
        assertEquals(List.of("start", "manager", "end"), nodeIds(process));
        assertEquals(5, process.size());
        JsonNode people = getJson("/api/people", "alice");
        assertEquals(3, people.size());
        assertEquals(List.of("alice", "bob", "carol"),
            mapper.convertValue(people.findValues("id"), mapper.getTypeFactory().constructCollectionType(List.class, String.class)));
        for (JsonNode person : people) assertEquals(2, person.size());
    }

    @Test void onlyAliceCanPublishAndPublishingUsesOptimisticVersions() throws Exception {
        ObjectNode proposal = definition(1, "carol", "bob");
        proposal.put("name", "Two stage leave approval");
        for (String user : List.of("bob", "carol")) {
            postJson("/api/process", user, publication(1, proposal)).andExpect(status().isForbidden());
            mvc.perform(write("/api/process", user).content("{")).andExpect(status().isForbidden());
            mvc.perform(write("/api/process", user).content("{}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.message").value("Forbidden"));
        }
        assertEquals(definition(1, "bob"), getJson("/api/process", "alice"));
        JsonNode published = response(postJson("/api/process", "alice", publication(1, proposal))
            .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(2)));
        assertEquals(proposal.path("nodes"), published.path("nodes"));
        assertEquals("Two stage leave approval", published.path("name").textValue());
        postJson("/api/process", "alice", publication(1, proposal)).andExpect(status().isConflict());
        postJson("/api/process", "alice", publication(2, definition(1, "bob"))).andExpect(status().isConflict());
        postJson("/api/process", "alice", publication(2, definition(3, "bob"))).andExpect(status().isConflict());
        assertEquals(published, getJson("/api/process", "bob"));
        JsonNode next = response(postJson("/api/process", "alice", publication(2, definition(2, "bob")))
            .andExpect(status().isOk()));
        assertEquals(3, next.path("version").intValue());
    }

    @Test void processPublicationRejectsUnknownFieldsScalarCoercionAndIncompleteJson() throws Exception {
        List<InvalidBody> invalid = new ArrayList<>();
        ObjectNode valid = publication(1, definition(1, "bob"));
        for (String field : List.of("expectedVersion", "definition"))
            invalid.add(changed("missing " + field, valid, n -> n.remove(field)));
        for (String value : List.of("null", "0", "-1", "1.5", "\"1\"", "true", "[]", "{}"))
            invalid.add(changed("expectedVersion " + value, valid, n -> n.set("expectedVersion", json(value))));
        invalid.add(changed("unknown publication field", valid, n -> n.put("actorId", "alice")));
        for (String value : List.of("null", "1", "\"definition\"", "true", "[]"))
            invalid.add(changed("definition " + value, valid, n -> n.set("definition", json(value))));
        for (String field : List.of("schemaVersion", "id", "version", "name", "nodes"))
            invalid.add(changed("missing definition " + field, valid, n -> object(n, "definition").remove(field)));
        invalid.add(changed("unknown definition field", valid, n -> object(n, "definition").put("layout", "forged")));
        for (String field : List.of("schemaVersion", "version")) {
            for (String value : List.of("null", "1.5", "\"2\"", "true"))
                invalid.add(changed(field + " scalar " + value, valid, n -> object(n, "definition").set(field, json(value))));
        }
        for (String field : List.of("id", "name")) {
            for (String value : List.of("42", "1.5", "true", "[]", "{}"))
                invalid.add(changed(field + " scalar " + value, valid, n -> object(n, "definition").set(field, json(value))));
        }
        for (String value : List.of("null", "{}", "\"nodes\"", "1", "true", "[null]"))
            invalid.add(changed("nodes shape " + value, valid, n -> object(n, "definition").set("nodes", json(value))));
        for (String field : List.of("id", "type", "name", "assigneeId")) {
            invalid.add(changed("missing approval " + field, valid, n -> node(object(n, "definition"), 1).remove(field)));
            for (String value : List.of("42", "1.5", "true", "[]", "{}"))
                invalid.add(changed("node " + field + " scalar " + value, valid,
                    n -> node(object(n, "definition"), 1).set(field, json(value))));
        }
        invalid.add(changed("missing nullable start assignee", valid, n -> node(object(n, "definition"), 0).remove("assigneeId")));
        invalid.add(changed("unknown node field", valid, n -> node(object(n, "definition"), 1).put("condition", "always")));
        invalid.add(new InvalidBody("duplicate expectedVersion", valid.toString().replace("\"expectedVersion\":1", "\"expectedVersion\":1,\"expectedVersion\":1")));
        invalid.add(new InvalidBody("duplicate nested name", valid.toString().replace("\"name\":\"Leave approval\"", "\"name\":\"Leave approval\",\"name\":\"Forged\"")));
        invalid.add(new InvalidBody("trailing object", valid + " {}"));
        for (String body : List.of("null", "[]", "1", "true", "\"publication\"", "{"))
            invalid.add(new InvalidBody("top-level " + body, body));
        assertInvalidBodies("/api/process", "alice", invalid);
        assertEquals(definition(1, "bob"), getJson("/api/process", "alice"));
    }

    @Test void processPublicationValidatesLinearShapeNamesIdsAndAssignees() throws Exception {
        List<InvalidBody> invalid = new ArrayList<>();
        ObjectNode valid = definition(1, "bob");
        for (int schema : List.of(0, 1, 3)) invalid.add(invalidDefinition("schema " + schema, valid, n -> n.put("schemaVersion", schema)));
        invalid.add(invalidDefinition("wrong process id", valid, n -> n.put("id", "other-process")));
        invalid.add(invalidDefinition("zero version", valid, n -> n.put("version", 0)));
        for (String name : List.of("", "  ", "x".repeat(121), "bad\nname", "bad\u0000name")) {
            invalid.add(invalidDefinition("invalid process name", valid, n -> n.put("name", name)));
            invalid.add(invalidDefinition("invalid node name", valid, n -> node(n, 1).put("name", name)));
        }
        invalid.add(invalidDefinition("null process name", valid, n -> n.putNull("name")));
        invalid.add(invalidDefinition("null node name", valid, n -> node(n, 1).putNull("name")));
        for (String id : List.of("", "  ", "1bad", "bad id", "bad/id", "x".repeat(65), "start", "end"))
            invalid.add(invalidDefinition("invalid approval id " + id, valid, n -> node(n, 1).put("id", id)));
        invalid.add(invalidDefinition("duplicate id", definition(1, "bob", "carol"), n -> node(n, 2).put("id", "manager")));
        invalid.add(invalidDefinition("null node id", valid, n -> node(n, 1).putNull("id")));
        for (int index : List.of(0, 2)) {
            invalid.add(invalidDefinition("renamed endpoint id", valid, n -> node(n, index).put("id", "other")));
            invalid.add(invalidDefinition("changed endpoint type", valid, n -> node(n, index).put("type", "approval")));
            invalid.add(invalidDefinition("assigned endpoint", valid, n -> node(n, index).put("assigneeId", "bob")));
        }
        for (String type : List.of("start", "end", "gateway", "parallel", "", "APPROVAL"))
            invalid.add(invalidDefinition("unsupported middle type " + type, valid, n -> node(n, 1).put("type", type)));
        for (String assignee : List.of("alice", "unknown", "", "Bob", " bob "))
            invalid.add(invalidDefinition("invalid assignee " + assignee, valid, n -> node(n, 1).put("assigneeId", assignee)));
        invalid.add(invalidDefinition("unassigned approval", valid, n -> node(n, 1).putNull("assigneeId")));
        invalid.add(invalidDefinition("no approvals", valid, n -> ((ArrayNode) n.get("nodes")).remove(1)));
        invalid.add(invalidDefinition("empty nodes", valid, n -> n.putArray("nodes")));
        invalid.add(invalidDefinition("nine approvals", definition(1, "bob", "bob", "bob", "bob", "bob", "bob", "bob", "bob", "bob"), n -> {}));
        invalid.add(invalidDefinition("reordered endpoints", valid, n -> {
            ArrayNode nodes = (ArrayNode) n.get("nodes");
            JsonNode first = nodes.get(0); nodes.set(0, nodes.get(2)); nodes.set(2, first);
        }));
        assertInvalidBodies("/api/process", "alice", invalid);
        assertEquals(definition(1, "bob"), getJson("/api/process", "alice"));
        ObjectNode maximum = definition(1, "bob", "carol", "bob", "carol", "bob", "carol", "bob", "carol");
        maximum.put("name", "x".repeat(120));
        node(maximum, 1).put("name", "y".repeat(120));
        node(maximum, 1).put("id", "a".repeat(64));
        postJson("/api/process", "alice", publication(1, maximum)).andExpect(status().isOk())
            .andExpect(jsonPath("$.nodes.length()").value(10));
    }

    @Test void submissionFieldsAreStrictAndCallerCannotChooseActorOrApprovers() throws Exception {
        List<InvalidBody> invalid = new ArrayList<>();
        ObjectNode valid = submission(1);
        for (String field : List.of("title", "reason", "days", "processVersion"))
            invalid.add(changed("missing " + field, valid, n -> n.remove(field)));
        for (String field : List.of("title", "reason")) {
            for (String value : List.of("null", "\"\"", "\"  \"", "42", "true", "[]", "{}"))
                invalid.add(changed(field + " " + value, valid, n -> n.set(field, json(value))));
            invalid.add(changed("too long " + field, valid, n -> n.put(field, "x".repeat(field.equals("title") ? 121 : 2001))));
        }
        for (String field : List.of("days", "processVersion")) {
            for (String value : List.of("null", "0", "-1", "1.9", "\"1\"", "true", "[]", "{}"))
                invalid.add(changed(field + " " + value, valid, n -> n.set(field, json(value))));
        }
        invalid.add(changed("too many days", valid, n -> n.put("days", 366)));
        for (String field : List.of("applicantId", "actorId", "approverId", "definition", "currentStepId", "status", "history", "processId"))
            invalid.add(changed("forged " + field, valid, n -> n.put(field, "bob")));
        invalid.add(new InvalidBody("duplicate days", valid.toString().replace("\"days\":2", "\"days\":2,\"days\":3")));
        invalid.add(new InvalidBody("trailing value", valid + " true"));
        for (String body : List.of("null", "[]", "1", "true", "\"submission\"", "{"))
            invalid.add(new InvalidBody("top-level " + body, body));
        assertInvalidBodies("/api/requests", "alice", invalid);
        assertEquals(0, getJson("/api/requests", "alice").size());
        ObjectNode maximum = submission(1).put("title", "x".repeat(120)).put("reason", "y".repeat(2000)).put("days", 365);
        postJson("/api/requests", "alice", maximum).andExpect(status().isCreated());
        JsonNode created = response(postJson("/api/requests", "alice", submission(1).put("title", " Leave ").put("reason", " Rest ").put("days", 1))
            .andExpect(status().isCreated()));
        assertEquals("Leave", created.path("title").textValue());
        assertEquals("Rest", created.path("reason").textValue());
        assertEquals("alice", created.path("applicantId").textValue());
        assertEquals("bob", created.path("approverId").textValue());
        assertEquals("manager", created.path("currentStepId").textValue());
        assertEquals(definition(1, "bob"), created.get("definition"));
        assertEquals(1, created.path("history").size());
        assertTrue(created.path("history").get(0).path("stepId").isNull());
    }

    @Test void staleSubmissionsAndSelfApprovalAtAnyPositionAreRejected() throws Exception {
        postJson("/api/requests", "bob", submission(1)).andExpect(status().isBadRequest());
        postJson("/api/requests", "alice", submission(2)).andExpect(status().isConflict());
        postJson("/api/process", "alice", publication(1, definition(1, "bob", "carol"))).andExpect(status().isOk());
        postJson("/api/requests", "alice", submission(1)).andExpect(status().isConflict());
        postJson("/api/requests", "bob", submission(2)).andExpect(status().isBadRequest());
        postJson("/api/requests", "carol", submission(2)).andExpect(status().isBadRequest());
        assertEquals(0, getJson("/api/requests", "alice").size());
        submit("alice", 2);
        postJson("/api/process", "alice", publication(2, definition(2, "carol", "bob"))).andExpect(status().isOk());
        postJson("/api/requests", "bob", submission(3)).andExpect(status().isBadRequest());
        postJson("/api/requests", "carol", submission(3)).andExpect(status().isBadRequest());
        assertEquals(1, getJson("/api/requests", "alice").size());
    }

    @Test void requestVisibilityIncludesOnlyApplicantAndSnapshottedApprovers() throws Exception {
        JsonNode aliceRequest = submit("alice", 1);
        assertEquals(0, getJson("/api/requests", "carol").size());
        decide("carol", aliceRequest, "manager", "APPROVE", "").andExpect(status().isNotFound());
        decide("alice", aliceRequest, "manager", "APPROVE", "").andExpect(status().isForbidden());
        postJson("/api/requests/missing/decisions", "bob", decision("manager", "APPROVE", ""))
            .andExpect(status().isNotFound());
        JsonNode carolRequest = submit("carol", 1);
        assertEquals(1, getJson("/api/requests", "alice").size());
        assertEquals(carolRequest, getJson("/api/requests", "carol").get(0));
        assertEquals(2, getJson("/api/requests", "bob").size());
        decide("alice", carolRequest, "manager", "APPROVE", "").andExpect(status().isNotFound());
        postJson("/api/process", "alice", publication(1, definition(1, "bob", "carol"))).andExpect(status().isOk());
        JsonNode multi = submit("alice", 2);
        assertTrue(getJson("/api/requests", "bob").toString().contains(multi.path("id").textValue()));
        assertTrue(getJson("/api/requests", "carol").toString().contains(multi.path("id").textValue()));
        assertFalse(getJson("/api/requests", "carol").toString().contains(aliceRequest.path("id").textValue()));
    }

    @Test void sequentialDecisionsAuthorizeExactStepAndReplayWithoutChangingHistory() throws Exception {
        postJson("/api/process", "alice", publication(1, definition(1, "bob", "carol", "bob"))).andExpect(status().isOk());
        JsonNode initial = submit("alice", 2);
        decide("carol", initial, "step2", "APPROVE", "early").andExpect(status().isConflict());
        decide("bob", initial, "step2", "APPROVE", "forged").andExpect(status().isForbidden());
        decide("alice", initial, "manager", "APPROVE", "self").andExpect(status().isForbidden());
        decide("carol", initial, "manager", "APPROVE", "forged").andExpect(status().isForbidden());
        decide("bob", initial, "does-not-exist", "APPROVE", "").andExpect(status().isConflict());
        JsonNode first = response(decide("bob", initial, "manager", "APPROVE", "  first review  ").andExpect(status().isOk()));
        assertStep(first, "PENDING", "step2", "carol", 2);
        assertEquals("first review", first.path("history").get(1).path("comment").textValue());
        assertEquals(initial.path("history").get(0), first.path("history").get(0));
        assertEquals(first, response(decide("bob", initial, "manager", "APPROVE", "changed replay comment").andExpect(status().isOk())));
        decide("bob", initial, "manager", "REJECT", "opposite").andExpect(status().isConflict());
        decide("carol", initial, "manager", "APPROVE", "replay attack").andExpect(status().isForbidden());
        decide("bob", initial, "step3", "APPROVE", "too early").andExpect(status().isConflict());
        JsonNode second = response(decide("carol", initial, "step2", "APPROVE", null).andExpect(status().isOk()));
        assertStep(second, "PENDING", "step3", "bob", 3);
        assertEquals("", second.path("history").get(2).path("comment").textValue());
        assertEquals(first.path("history").get(1), second.path("history").get(1));
        assertEquals(second, response(decide("bob", initial, "manager", "APPROVE", "old step replay").andExpect(status().isOk())));
        JsonNode terminal = response(decide("bob", initial, "step3", "APPROVE", "done").andExpect(status().isOk()));
        assertStep(terminal, "APPROVED", null, "bob", 4);
        assertEquals(List.of("SUBMIT", "APPROVE", "APPROVE", "APPROVE"), eventValues(terminal, "action"));
        assertEquals(List.of("alice", "bob", "carol", "bob"), eventValues(terminal, "actorId"));
        assertEquals("manager", terminal.path("history").get(1).path("stepId").textValue());
        assertEquals("step2", terminal.path("history").get(2).path("stepId").textValue());
        assertEquals("step3", terminal.path("history").get(3).path("stepId").textValue());
        for (String step : List.of("manager", "step3"))
            assertEquals(terminal, response(decide("bob", initial, step, "APPROVE", "changed").andExpect(status().isOk())));
        assertEquals(terminal, response(decide("carol", initial, "step2", "APPROVE", "changed").andExpect(status().isOk())));
        decide("bob", initial, "step3", "REJECT", "opposite").andExpect(status().isConflict());
        decide("bob", initial, "step2", "APPROVE", "wrong actor replay").andExpect(status().isForbidden());
        assertEquals(terminal, getJson("/api/requests", "alice").get(0));
    }

    @Test void rejectionIsTerminalAndCannotBeBypassedByLaterSteps() throws Exception {
        postJson("/api/process", "alice", publication(1, definition(1, "bob", "carol"))).andExpect(status().isOk());
        JsonNode initial = submit("alice", 2);
        JsonNode rejected = response(decide("bob", initial, "manager", "REJECT", "not available").andExpect(status().isOk()));
        assertStep(rejected, "REJECTED", null, "bob", 2);
        assertEquals(rejected, response(decide("bob", initial, "manager", "REJECT", "different").andExpect(status().isOk())));
        decide("bob", initial, "manager", "APPROVE", "opposite").andExpect(status().isConflict());
        decide("carol", initial, "step2", "APPROVE", "bypass").andExpect(status().isConflict());
        decide("carol", initial, "step2", "REJECT", "extra").andExpect(status().isConflict());
        decide("carol", initial, "manager", "REJECT", "replay").andExpect(status().isForbidden());
        assertEquals(rejected, getJson("/api/requests", "alice").get(0));
    }

    @Test void publishingNeverChangesExistingRequestsOrTheirAuthorization() throws Exception {
        JsonNode old = submit("alice", 1);
        ObjectNode replacement = definition(1, "carol");
        node(replacement, 1).put("id", "replacement").put("name", "New reviewer");
        postJson("/api/process", "alice", publication(1, replacement)).andExpect(status().isOk());
        assertEquals(old, getJson("/api/requests", "alice").get(0));
        assertEquals(0, getJson("/api/requests", "carol").size());
        decide("carol", old, "manager", "APPROVE", "new editor assignment").andExpect(status().isNotFound());
        decide("bob", old, "replacement", "APPROVE", "new step").andExpect(status().isConflict());
        JsonNode completedOld = response(decide("bob", old, "manager", "APPROVE", "original process").andExpect(status().isOk()));
        assertEquals(old.path("definition"), completedOld.path("definition"));
        assertEquals(1, completedOld.path("processVersion").intValue());
        JsonNode newer = submit("alice", 2);
        assertEquals("replacement", newer.path("currentStepId").textValue());
        assertEquals("carol", newer.path("approverId").textValue());
        assertEquals(2, newer.path("definition").path("version").intValue());
        postJson("/api/process", "alice", publication(2, definition(2, "bob", "bob"))).andExpect(status().isOk());
        decide("bob", newer, "replacement", "APPROVE", "current global assignee").andExpect(status().isNotFound());
        JsonNode completedNewer = response(decide("carol", newer, "replacement", "APPROVE", "snapshotted assignment").andExpect(status().isOk()));
        assertEquals(newer.path("definition"), completedNewer.path("definition"));
        assertEquals(2, completedNewer.path("processVersion").intValue());
        assertEquals(completedOld, getJson("/api/requests", "bob").get(0));
        assertEquals(1, getJson("/api/requests", "bob").size());
    }

    @Test void decisionsRejectMissingFieldsForgedIdentityAndScalarCoercion() throws Exception {
        JsonNode initial = submit("alice", 1);
        String path = "/api/requests/" + initial.path("id").textValue() + "/decisions";
        ObjectNode valid = decision("manager", "APPROVE", "fine");
        List<InvalidBody> invalid = new ArrayList<>();
        for (String field : List.of("stepId", "decision")) {
            invalid.add(changed("missing " + field, valid, n -> n.remove(field)));
            for (String value : List.of("null", "\"\"", "\"  \"", "1", "true", "[]", "{}"))
                invalid.add(changed(field + " " + value, valid, n -> n.set(field, json(value))));
        }
        invalid.add(changed("long stepId", valid, n -> n.put("stepId", "x".repeat(65))));
        for (String value : List.of("approve", "PENDING", "APPROVED", "APPROVE "))
            invalid.add(changed("invalid decision " + value, valid, n -> n.put("decision", value)));
        for (String value : List.of("1", "1.5", "true", "[]", "{}"))
            invalid.add(changed("comment " + value, valid, n -> n.set("comment", json(value))));
        invalid.add(changed("long comment", valid, n -> n.put("comment", "x".repeat(2001))));
        for (String field : List.of("actorId", "applicantId", "approverId", "processVersion", "currentStepId", "history", "status"))
            invalid.add(changed("forged " + field, valid, n -> n.put(field, "alice")));
        invalid.add(new InvalidBody("duplicate stepId", valid.toString().replace("\"stepId\":\"manager\"", "\"stepId\":\"manager\",\"stepId\":\"manager\"")));
        invalid.add(new InvalidBody("trailing decision", valid + " {}"));
        for (String body : List.of("null", "[]", "1", "true", "\"decision\"", "{"))
            invalid.add(new InvalidBody("top-level " + body, body));
        assertInvalidBodies(path, "bob", invalid);
        assertEquals(initial, getJson("/api/requests", "alice").get(0));
        JsonNode maximum = response(postJson(path, "bob", decision("manager", "APPROVE", "x".repeat(2000))).andExpect(status().isOk()));
        assertEquals(2000, maximum.path("comment").textValue().length());
        JsonNode another = submit("alice", 1);
        ObjectNode noComment = decision("manager", "REJECT", "discarded");
        noComment.remove("comment");
        postJson("/api/requests/" + another.path("id").textValue() + "/decisions", "bob", noComment)
            .andExpect(status().isOk()).andExpect(jsonPath("$.comment").value(""));
    }

    private MockHttpServletRequestBuilder authenticated(MockHttpServletRequestBuilder request, String user) {
        return request.with(httpBasic(user, "test-" + user + "-password"));
    }
    private MockHttpServletRequestBuilder write(String path, String user) {
        return authenticated(post(path), user).header("X-Arcflow-Client", "approval-demo").contentType("application/json");
    }
    private ResultActions postJson(String path, String user, JsonNode body) throws Exception {
        return mvc.perform(write(path, user).content(body.toString()));
    }
    private JsonNode getJson(String path, String user) throws Exception {
        return response(mvc.perform(authenticated(get(path), user)).andExpect(status().isOk()));
    }
    private JsonNode response(ResultActions result) throws Exception {
        return mapper.readTree(result.andReturn().getResponse().getContentAsString());
    }
    private ObjectNode submission(int version) {
        return mapper.createObjectNode().put("title", "Leave").put("reason", "Rest").put("days", 2).put("processVersion", version);
    }
    private ObjectNode decision(String step, String action, String comment) {
        return mapper.createObjectNode().put("stepId", step).put("decision", action).put("comment", comment);
    }
    private ObjectNode publication(int expectedVersion, ObjectNode definition) {
        ObjectNode body = mapper.createObjectNode().put("expectedVersion", expectedVersion);
        body.set("definition", definition); return body;
    }
    private ObjectNode definition(int version, String... assignees) {
        ObjectNode process = mapper.createObjectNode().put("schemaVersion", 2).put("id", "leave-approval")
            .put("version", version).put("name", "Leave approval");
        ArrayNode nodes = process.putArray("nodes");
        nodes.addObject().put("id", "start").put("type", "start").put("name", "Submit leave").putNull("assigneeId");
        for (int i = 0; i < assignees.length; i++)
            nodes.addObject().put("id", i == 0 ? "manager" : "step" + (i + 1)).put("type", "approval")
                .put("name", i == 0 ? "Designated approver" : "Review " + (i + 1)).put("assigneeId", assignees[i]);
        nodes.addObject().put("id", "end").put("type", "end").put("name", "Completed").putNull("assigneeId");
        return process;
    }
    private JsonNode submit(String user, int version) throws Exception {
        return response(postJson("/api/requests", user, submission(version)).andExpect(status().isCreated()));
    }
    private ResultActions decide(String user, JsonNode request, String step, String action, String comment) throws Exception {
        return postJson("/api/requests/" + request.path("id").textValue() + "/decisions", user, decision(step, action, comment));
    }
    private static ObjectNode object(ObjectNode parent, String field) { return (ObjectNode) parent.get(field); }
    private static ObjectNode node(ObjectNode definition, int index) { return (ObjectNode) definition.get("nodes").get(index); }
    private JsonNode json(String raw) {
        try { return mapper.readTree(raw); }
        catch (Exception ex) { throw new IllegalArgumentException("Invalid test fixture", ex); }
    }
    private record InvalidBody(String description, String body) {}
    private InvalidBody changed(String description, ObjectNode original, Consumer<ObjectNode> change) {
        ObjectNode copy = original.deepCopy(); change.accept(copy); return new InvalidBody(description, copy.toString());
    }
    private InvalidBody invalidDefinition(String description, ObjectNode original, Consumer<ObjectNode> change) {
        ObjectNode copy = original.deepCopy(); change.accept(copy);
        return new InvalidBody(description, publication(1, copy).toString());
    }
    private void assertInvalidBodies(String path, String user, List<InvalidBody> cases) throws Exception {
        for (InvalidBody invalid : cases) {
            var result = mvc.perform(write(path, user).content(invalid.body())).andReturn();
            assertEquals(400, result.getResponse().getStatus(), invalid.description() + ": " + result.getResponse().getContentAsString());
            assertTrue(mapper.readTree(result.getResponse().getContentAsString()).path("message").isTextual(), invalid.description());
        }
    }
    private List<String> nodeIds(JsonNode process) {
        List<String> ids = new ArrayList<>(); process.path("nodes").forEach(n -> ids.add(n.path("id").textValue())); return ids;
    }
    private List<String> eventValues(JsonNode request, String field) {
        List<String> values = new ArrayList<>(); request.path("history").forEach(e -> values.add(e.path(field).textValue())); return values;
    }
    private void assertStep(JsonNode request, String status, String step, String approver, int historySize) {
        assertEquals(status, request.path("status").textValue());
        assertEquals(step, request.path("currentStepId").textValue());
        assertEquals(approver, request.path("approverId").textValue());
        assertEquals(historySize, request.path("history").size());
    }
}
