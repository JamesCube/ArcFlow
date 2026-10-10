package com.arcflow.approval.jdbc;

import com.arcflow.approval.ApprovalService;
import com.arcflow.approval.BusinessDocument;
import com.arcflow.approval.ConditionalRouting;
import com.arcflow.approval.InboxQuery;
import com.arcflow.approval.ProcessDefinition;
import com.arcflow.approval.ProcessDefinition.ProcessNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.Types;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Identical expense routing, retained-data and exact member contract on all three SQL families. */
abstract class ExpenseConditionalRoutingStoreContract extends ConditionalRoutingStoreContract {
    private static final ObjectMapper JSON = ApprovalService.strictMapper(new ObjectMapper());
    private static final Map<String,List<String>> PENDING = Map.of("box", List.of("PENDING"));
    private static final Map<String,List<String>> HANDLED = Map.of("box", List.of("HANDLED"));

    private static ProcessDefinition expenseRoute(int version, String threshold) {
        return expenseRoute(version, "ALL", ConditionalRouting.Predicate.expenseMoney("GTE", "CNY", new BigDecimal(threshold)));
    }

    private static ProcessDefinition expenseRoute(int version, String completion, ConditionalRouting.Predicate predicate) {
        return new ProcessDefinition(4, "oa-expense", version, "Conditional expense review", List.of(
            new ProcessNode("start", "start", "Submit expense", null),
            new ProcessNode("base", "approval", "Mandatory review", "bob"),
            new ProcessNode("risk", "parallelApproval", "Additional expense review", null, List.of("bob", "carol"), completion,
                new ConditionalRouting.Rule("ALL", List.of(predicate))),
            new ProcessNode("final", "approval", "Final review", "bob"),
            new ProcessNode("end", "end", "Review complete", null)));
    }

    private ApprovalService routedExpenses() throws IOException { return routedExpenses("0.31"); }
    private ApprovalService routedExpenses(String threshold) throws IOException {
        return new ApprovalService(new JdbcApprovalStore(dataSource, JSON, expenseRoute(1, threshold)), USERS);
    }

    private static BusinessDocument.Expense expenseCurrency(String currency) {
        var document = expenseDocument();
        return new BusinessDocument.Expense(document.documentVersion(), document.businessId(), document.title(), document.reason(),
            document.costCenter(), currency, document.lines());
    }

    private String payload(String id) throws Exception {
        try (var connection = dataSource.getConnection(); var statement = connection.prepareStatement(
                "SELECT request_json FROM arc_request WHERE request_id = ?")) {
            statement.setString(1, id);
            try (var rows = statement.executeQuery()) { assertTrue(rows.next()); return rows.getString(1); }
        }
    }

    private void payload(String id, String json) throws Exception {
        try (var connection = dataSource.getConnection(); var statement = connection.prepareStatement(
                "UPDATE arc_request SET request_json = ? WHERE request_id = ?")) {
            statement.setString(1, json); statement.setString(2, id); assertEquals(1, statement.executeUpdate());
        }
    }

    private String retained(int version) throws Exception {
        try (var connection = dataSource.getConnection(); var statement = connection.prepareStatement(
                "SELECT definition_json FROM arc_process_version WHERE process_id = 'oa-expense' AND process_version = ?")) {
            statement.setInt(1, version);
            try (var rows = statement.executeQuery()) { assertTrue(rows.next()); return rows.getString(1); }
        }
    }

    private void retained(int version, String json) throws Exception {
        try (var connection = dataSource.getConnection(); var statement = connection.prepareStatement(
                "UPDATE arc_process_version SET definition_json = ? WHERE process_id = 'oa-expense' AND process_version = ?")) {
            statement.setString(1, json); statement.setInt(2, version); assertEquals(1, statement.executeUpdate());
        }
    }

    private record Member(String actor, boolean pending, boolean handled) { }

    /** Check every persisted column, including binary identities, rather than only row counts. */
    private void members(ApprovalService.Request request, Member... expected) throws Exception {
        var actual = new ArrayList<Member>();
        var position = InboxQuery.position(request);
        try (var connection = dataSource.getConnection(); var statement = connection.prepareStatement(
                "SELECT * FROM arc_request_member WHERE request_id = ? ORDER BY actor_id")) {
            statement.setString(1, request.id());
            try (var rows = statement.executeQuery()) {
                while (rows.next()) {
                    String actor = rows.getString("actor_id");
                    actual.add(new Member(actor, rows.getBoolean("pending"), rows.getBoolean("handled")));
                    assertEquals(request.id(), rows.getString("request_id"));
                    assertEquals(request.processId(), rows.getString("process_id"));
                    assertArrayEquals(actor.getBytes(StandardCharsets.UTF_16BE), rows.getBytes("actor_key"));
                    assertArrayEquals(request.id().getBytes(StandardCharsets.US_ASCII), rows.getBytes("request_sort_key"));
                    assertEquals(request.history().size() - 1, rows.getInt("revision"));
                    assertEquals(request.status(), rows.getString("request_status"));
                    assertEquals(request.processVersion(), rows.getInt("process_version"));
                    assertEquals(position.seconds(), rows.getLong("created_seconds"));
                    assertEquals(position.nanos(), rows.getInt("created_nanos"));
                }
            }
        }
        assertEquals(List.of(expected), actual);
    }

    /** Captures the corrupt state itself so fail-closed checks also prove that no table was repaired. */
    private Map<String,List<List<String>>> databaseSnapshot() throws Exception {
        var snapshot = new LinkedHashMap<String,List<List<String>>>();
        var tables = new LinkedHashMap<String,String>();
        tables.put("arc_process_version", "process_id, process_version");
        tables.put("arc_process_head", "process_id");
        tables.put("arc_request", "request_id");
        tables.put("arc_request_event", "request_id, event_index");
        tables.put("arc_submission_key", "applicant_id, submission_key");
        tables.put("arc_request_member", "request_id, actor_id");
        tables.put("arc_member_projection_state", "singleton_id");
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) {
            for (var table : tables.entrySet()) {
                var values = new ArrayList<List<String>>();
                try (var rows = statement.executeQuery("SELECT * FROM " + table.getKey() + " ORDER BY " + table.getValue())) {
                    var metadata = rows.getMetaData();
                    while (rows.next()) {
                        var row = new ArrayList<String>();
                        for (int column = 1; column <= metadata.getColumnCount(); column++) {
                            int type = metadata.getColumnType(column);
                            if (type == Types.BINARY || type == Types.VARBINARY || type == Types.LONGVARBINARY) {
                                byte[] bytes = rows.getBytes(column);
                                row.add(bytes == null ? null : Base64.getEncoder().encodeToString(bytes));
                            } else row.add(rows.getString(column));
                        }
                        values.add(row);
                    }
                }
                snapshot.put(table.getKey(), values);
            }
        }
        return snapshot;
    }

    private void rejectsWithoutRepair(ApprovalService service, ApprovalService.Request request, String key) throws Exception {
        var before = databaseSnapshot();
        assertThrows(UncheckedIOException.class, () -> service.list("alice"));
        assertThrows(IOException.class, () -> service.inbox("bob", PENDING));
        assertThrows(IOException.class, () -> service.submitDocument("alice", expenseDocument(), request.processVersion(), key));
        assertThrows(IOException.class, () -> service.decide("bob", request.id(), "base", "APPROVE", "Must not write"));
        assertEquals(before, databaseSnapshot());
    }

    @Test void expenseRouteExactDecimalBoundarySelectsAllVotesAndIndependentFinalReview() throws Exception {
        ApprovalService.Request approved;
        try (var service = routedExpenses("0.30")) {
            var created = service.submitDocument("alice", expenseDocument(), 1, "expense-exact");
            assertEquals("0.3", ((BusinessDocument.Expense) created.business()).total().toPlainString());
            assertEquals(new ConditionalRouting.FrozenRoute(1, List.of("base", "risk", "final"), List.of(
                new ConditionalRouting.Evaluation("risk", true, List.of(new ConditionalRouting.Fact("expense.totalAmount", "CNY 0.3", true))))), created.routing());
            assertEquals(List.of(created), service.list("carol"));
            assertEquals(List.of(created), service.inbox("bob", PENDING).items());
            assertTrue(service.inbox("carol", PENDING).items().isEmpty());
            assertEquals(409, result(() -> service.decide("carol", created.id(), "risk", "APPROVE", "Future step")));
            members(created, new Member("bob", true, false), new Member("carol", false, false));

            var risk = service.decide("bob", created.id(), "base", "APPROVE", "Mandatory review");
            assertEquals("risk", risk.currentStepId());
            members(risk, new Member("bob", true, true), new Member("carol", true, false));
            assertEquals(List.of(risk), service.inbox("bob", HANDLED).items());
            assertEquals(List.of(risk), service.inbox("carol", PENDING).items());
            var partial = service.decide("bob", created.id(), "risk", "APPROVE", "Independent group vote");
            assertEquals("risk", partial.currentStepId());
            assertEquals(List.of("carol"), ApprovalService.pendingApproverIds(partial));
            assertTrue(service.inbox("bob", PENDING).items().isEmpty());
            members(partial, new Member("bob", false, true), new Member("carol", true, false));
            assertEquals(partial, service.decide("bob", created.id(), "risk", "APPROVE", "Retry keeps original comment"));
            var last = service.decide("carol", created.id(), "risk", "APPROVE", "All reviewers approved");
            assertEquals("final", last.currentStepId());
            members(last, new Member("bob", true, true), new Member("carol", false, true));
            assertEquals(List.of(last), service.inbox("carol", HANDLED).items());
            approved = service.decide("bob", created.id(), "final", "APPROVE", "Separate final vote");
            assertEquals("APPROVED", approved.status()); assertEquals(5, approved.history().size());
            assertEquals(created.routing(), approved.routing()); assertEquals(created.business(), approved.business());
            members(approved, new Member("bob", false, true), new Member("carol", false, true));
            assertTrue(service.inbox("carol", PENDING).items().isEmpty());
        }
        try (var service = routedExpenses()) {
            assertEquals(approved, service.submitDocument("alice", expenseDocument(), 1, "expense-exact"));
            assertEquals(List.of(approved), service.inbox("carol", HANDLED).items());
            assertEquals(5, count("arc_request_event"));
        }
    }

    @Test void expenseRouteSkippedActorHasNoReadVoteInboxOrMemberRights() throws Exception {
        ApprovalService.Request approved;
        try (var service = routedExpenses()) {
            var created = service.submitDocument("alice", expenseDocument(), 1, "expense-skip");
            assertEquals(List.of("base", "final"), created.routing().stepIds());
            assertFalse(created.routing().evaluations().get(0).result());
            members(created, new Member("bob", true, false));
            assertTrue(service.list("carol").isEmpty());
            assertTrue(service.inbox("carol", PENDING).items().isEmpty());
            assertTrue(service.inbox("carol", HANDLED).items().isEmpty());
            assertEquals(404, result(() -> service.decide("carol", created.id(), "risk", "APPROVE", "Skipped")));
            var last = service.decide("bob", created.id(), "base", "APPROVE", "First review");
            assertEquals("final", last.currentStepId());
            members(last, new Member("bob", true, true));
            assertEquals(409, result(() -> service.decide("bob", created.id(), "risk", "APPROVE", "Skipped step")));
            approved = service.decide("bob", created.id(), "final", "APPROVE", "Final review");
            assertEquals("APPROVED", approved.status()); assertEquals(3, approved.history().size());
            members(approved, new Member("bob", false, true));
            assertEquals(created.routing(), approved.routing());
            assertTrue(service.list("carol").isEmpty());
            assertTrue(service.inbox("carol", HANDLED).items().isEmpty());
        }
        try (var service = routedExpenses()) {
            assertEquals(approved, service.submitDocument("alice", expenseDocument(), 1, "expense-skip"));
            assertTrue(service.list("carol").isEmpty());
            members(approved, new Member("bob", false, true));
        }
    }

    @Test void expenseRouteAllRejectionIsTerminalAndDoesNotInventSkippedVotes() throws Exception {
        ApprovalService.Request rejected;
        try (var service = routedExpenses("0.30")) {
            var created = service.submitDocument("alice", expenseDocument(), 1, "expense-reject");
            service.decide("bob", created.id(), "base", "APPROVE", "Mandatory review");
            rejected = service.decide("carol", created.id(), "risk", "REJECT", "Expense needs correction");
            assertEquals("REJECTED", rejected.status()); assertEquals(3, rejected.history().size());
            assertEquals(created.routing(), rejected.routing());
            members(rejected, new Member("bob", false, true), new Member("carol", false, true));
            assertTrue(service.inbox("bob", PENDING).items().isEmpty());
            assertTrue(service.inbox("carol", PENDING).items().isEmpty());
            assertEquals(409, result(() -> service.decide("bob", created.id(), "risk", "APPROVE", "Closed")));
            assertEquals(409, result(() -> service.decide("bob", created.id(), "final", "APPROVE", "Never reached")));
        }
        try (var service = routedExpenses()) {
            assertEquals(rejected, service.submitDocument("alice", expenseDocument(), 1, "expense-reject"));
            assertEquals(rejected, service.decide("carol", rejected.id(), "risk", "REJECT", "Retry"));
            assertEquals(3, count("arc_request_event"));
        }
    }

    @Test void expenseRoutePublicationWithoutRequestsRetainsEveryDefinitionAcrossReopen() throws Exception {
        ProcessDefinition published;
        String savedSecond;
        try (var service = expenseService()) {
            var second = service.publishForDocument("alice", 1, expenseRoute(1, "0.31"), BusinessDocument.Expense.class);
            savedSecond = retained(2);
            assertEquals(second, JSON.readValue(savedSecond, ProcessDefinition.class));
            assertEquals(2, count("arc_process_version"));
            for (String table : List.of("arc_request", "arc_request_event", "arc_request_member", "arc_submission_key")) assertEquals(0, count(table));
        }
        try (var service = routedExpenses()) {
            assertEquals(2, service.process().version()); assertEquals(4, service.process().schemaVersion());
            published = service.publishForDocument("alice", 2, expenseRoute(2, "0.30"), BusinessDocument.Expense.class);
            assertEquals(savedSecond, retained(2));
            for (String table : List.of("arc_request", "arc_request_event", "arc_request_member", "arc_submission_key")) assertEquals(0, count(table));
        }
        try (var service = routedExpenses()) {
            assertEquals(published, service.process()); assertEquals(3, count("arc_process_version"));
            assertEquals(savedSecond, retained(2));
            var before = databaseSnapshot();
            assertEquals(409, result(() -> service.submitDocument("alice", expenseDocument(), 2, "stale-expense")));
            assertEquals(before, databaseSnapshot());
            var created = service.submitDocument("alice", expenseDocument(), 3, "published-expense");
            assertEquals(published, created.definition()); assertEquals(List.of("base", "risk", "final"), created.routing().stepIds());
        }
    }

    @Test void expenseRouteRepublishAndKeyReplayKeepOriginalPathVersionAndPayload() throws Exception {
        ApprovalService.Request old;
        String original;
        try (var service = routedExpenses()) {
            old = service.submitDocument("alice", expenseDocument(), 1, "expense-original"); original = payload(old.id());
            service.publishForDocument("alice", 1, expenseRoute(1, "0.30"), BusinessDocument.Expense.class);
            var newer = service.submitDocument("alice", expenseDocument(), 2, "expense-new");
            assertEquals(List.of("base", "final"), old.routing().stepIds());
            assertEquals(List.of("base", "risk", "final"), newer.routing().stepIds());
            assertEquals(original, payload(old.id())); assertEquals(old, service.submitDocument("alice", expenseDocument(), 1, "expense-original"));
            members(old, new Member("bob", true, false));
            members(newer, new Member("bob", true, false), new Member("carol", false, false));
            var before = databaseSnapshot();
            assertEquals(409, result(() -> service.submitDocument("alice", expenseDocument(), 2, "expense-original")));
            assertEquals(before, databaseSnapshot());
        }
        try (var service = routedExpenses()) {
            assertEquals(original, payload(old.id()));
            assertEquals(old, service.submitDocument("alice", expenseDocument(), 1, "expense-original"));
            assertEquals("final", service.decide("bob", old.id(), "base", "APPROVE", "Original path").currentStepId());
            var approved = service.decide("bob", old.id(), "final", "APPROVE", "Original final");
            assertEquals("APPROVED", approved.status()); assertEquals(old.routing(), approved.routing());
            assertEquals(old.definition(), approved.definition()); assertEquals(1, approved.processVersion());
        }
    }

    @Test void expenseRouteWrongCurrencyAndCrossFamilyAreRejectedBeforeAnyWrite() throws Exception {
        try (var service = routedExpenses()) {
            var before = databaseSnapshot();
            assertEquals(400, result(() -> service.submitDocument("alice", expenseCurrency("USD"), 1, "expense-wrong-currency")));
            assertEquals(400, result(() -> service.submitDocument("alice", paymentDocument(), 1, "expense-wrong-family")));
            assertEquals(400, result(() -> service.publishForDocument("alice", 1,
                expenseRoute(1, "ALL", ConditionalRouting.Predicate.money("GTE", "CNY", new BigDecimal("0.30"))), BusinessDocument.Expense.class)));
            assertEquals(400, result(() -> service.publishForDocument("alice", 1, expenseRoute(1, "0.30"), BusinessDocument.PaymentRequest.class)));
            assertEquals(400, result(() -> service.publish("alice", 1, expenseRoute(1, "0.30"))));
            assertEquals(before, databaseSnapshot());
            assertEquals(List.of("base", "final"), service.submitDocument("alice", expenseDocument(), 1, "expense-wrong-currency").routing().stepIds());
        }
    }

    @Test void expenseRouteTamperedBusinessRouteAndEmbeddedDefinitionRejectWithoutRepair() throws Exception {
        try (var service = routedExpenses()) {
            var created = service.submitDocument("alice", expenseDocument(), 1, "expense-tamper");
            String original = payload(created.id());
            service.publishForDocument("alice", 1, expenseRoute(1, "0.30"), BusinessDocument.Expense.class);
            var variants = new ArrayList<ObjectNode>();
            var forgedRoute = (ObjectNode) JSON.readTree(original);
            ((ObjectNode) forgedRoute.path("routing")).putArray("stepIds").add("base").add("risk").add("final"); variants.add(forgedRoute);
            var forgedFact = (ObjectNode) JSON.readTree(original);
            ((ObjectNode) forgedFact.path("routing").path("evaluations").get(0).path("predicates").get(0)).put("actualValue", "CNY 0.30"); variants.add(forgedFact);
            var forgedBusiness = (ObjectNode) JSON.readTree(original);
            ((ObjectNode) forgedBusiness.path("business").path("lines").get(0)).put("amount", new BigDecimal("0.2")); variants.add(forgedBusiness);
            var forgedCurrency = (ObjectNode) JSON.readTree(original);
            ((ObjectNode) forgedCurrency.path("business")).put("currency", "USD"); variants.add(forgedCurrency);
            var forgedDefinition = (ObjectNode) JSON.readTree(original);
            var definition = (ObjectNode) forgedDefinition.path("definition");
            ((ObjectNode) definition.path("nodes").get(2).path("runIf").path("predicates").get(0)).put("threshold", new BigDecimal("0.20"));
            forgedDefinition.set("routing", JSON.valueToTree(ConditionalRouting.freeze(JSON.treeToValue(definition, ProcessDefinition.class), created.business())));
            variants.add(forgedDefinition);
            for (var variant : variants) {
                payload(created.id(), variant.toString()); rejectsWithoutRepair(service, created, "expense-tamper");
                try (var reopened = routedExpenses()) { rejectsWithoutRepair(reopened, created, "expense-tamper"); }
                payload(created.id(), original);
            }
            assertEquals(created, service.submitDocument("alice", expenseDocument(), 1, "expense-tamper"));
        }
    }

    @Test void expenseRouteTamperedRetainedDefinitionRejectsSavedRequestsWithoutRepair() throws Exception {
        try (var service = routedExpenses()) {
            var created = service.submitDocument("alice", expenseDocument(), 1, "expense-retained");
            String original = retained(1);
            service.publishForDocument("alice", 1, expenseRoute(1, "0.30"), BusinessDocument.Expense.class);
            var forged = (ObjectNode) JSON.readTree(original);
            ((ObjectNode) forged.path("nodes").get(2).path("runIf").path("predicates").get(0)).put("threshold", new BigDecimal("0.30"));
            retained(1, forged.toString());
            rejectsWithoutRepair(service, created, "expense-retained");
            try (var reopened = routedExpenses()) { rejectsWithoutRepair(reopened, created, "expense-retained"); }
            retained(1, original);
            assertEquals(created, service.submitDocument("alice", expenseDocument(), 1, "expense-retained"));
        }
    }

    @Test void expenseRouteMissingOrAlteredSelectedMemberFailsClosedWithoutRepair() throws Exception {
        try (var service = routedExpenses("0.30")) {
            var created = service.submitDocument("alice", expenseDocument(), 1, "expense-members");
            sql("UPDATE arc_request_member SET handled = TRUE WHERE actor_id = 'carol'");
            rejectsWithoutRepair(service, created, "expense-members");
            sql("UPDATE arc_request_member SET handled = FALSE WHERE actor_id = 'carol'");
            members(created, new Member("bob", true, false), new Member("carol", false, false));
            sql("DELETE FROM arc_request_member WHERE actor_id = 'carol'");
            rejectsWithoutRepair(service, created, "expense-members");
            try (var reopened = routedExpenses()) { rejectsWithoutRepair(reopened, created, "expense-members"); }
        }
    }

    @Test void expenseRouteAddingSkippedMemberDoesNotGrantReadOrVoteRightsOrRepairData() throws Exception {
        try (var service = routedExpenses()) {
            var created = service.submitDocument("alice", expenseDocument(), 1, "expense-extra-member");
            try (var connection = dataSource.getConnection(); var statement = connection.prepareStatement(
                    "INSERT INTO arc_request_member (request_id, actor_id, actor_key, pending, handled, revision, request_status, "
                    + "process_version, created_seconds, created_nanos, request_sort_key, process_id) "
                    + "SELECT request_id, ?, ?, pending, handled, revision, request_status, process_version, created_seconds, "
                    + "created_nanos, request_sort_key, process_id FROM arc_request_member WHERE request_id = ?")) {
                statement.setString(1, "carol"); statement.setBytes(2, "carol".getBytes(StandardCharsets.UTF_16BE));
                statement.setString(3, created.id()); assertEquals(1, statement.executeUpdate());
            }
            var before = databaseSnapshot();
            rejectsWithoutRepair(service, created, "expense-extra-member");
            assertThrows(UncheckedIOException.class, () -> service.list("carol"));
            assertThrows(IOException.class, () -> service.inbox("carol", PENDING));
            assertThrows(IOException.class, () -> service.decide("carol", created.id(), "risk", "APPROVE", "Forged member"));
            assertEquals(before, databaseSnapshot());
        }
    }

    @Test void expenseRouteSchemaTwoAndThreeRequestsAndReadyProjectionRemainByteIdentical() throws Exception {
        ApprovalService.Request sequential;
        ApprovalService.Request grouped;
        String firstPayload;
        String secondPayload;
        try (var service = expenseService()) {
            sequential = service.submitDocument("alice", expenseDocument(), 1, "expense-schema-two");
            firstPayload = payload(sequential.id()); assertNull(sequential.routing());
            var group = new ProcessDefinition(3, "oa-expense", 1, "Legacy expense group", List.of(
                new ProcessNode("start", "start", "Submit expense", null),
                new ProcessNode("review", "parallelApproval", "Expense review", null, List.of("bob", "carol"), "ALL"),
                new ProcessNode("end", "end", "Review complete", null)));
            service.publishForDocument("alice", 1, group, BusinessDocument.Expense.class);
            grouped = service.submitDocument("alice", expenseDocument(), 2, "expense-schema-three");
            secondPayload = payload(grouped.id()); assertNull(grouped.routing());
            var oldRows = databaseSnapshot().get("arc_request_member");
            service.publishForDocument("alice", 2, expenseRoute(2, "0.31"), BusinessDocument.Expense.class);
            assertEquals(oldRows, databaseSnapshot().get("arc_request_member"));
            assertEquals(firstPayload, payload(sequential.id())); assertEquals(secondPayload, payload(grouped.id()));
            var newer = service.submitDocument("alice", expenseDocument(), 3, "expense-schema-four");
            members(newer, new Member("bob", true, false));
        }
        try (var service = routedExpenses()) {
            assertEquals(firstPayload, payload(sequential.id())); assertEquals(secondPayload, payload(grouped.id()));
            assertEquals(sequential, service.submitDocument("alice", expenseDocument(), 1, "expense-schema-two"));
            assertEquals(grouped, service.submitDocument("alice", expenseDocument(), 2, "expense-schema-three"));
            members(sequential, new Member("bob", true, false), new Member("carol", false, false));
            members(grouped, new Member("bob", true, false), new Member("carol", true, false));
            assertEquals(3, count("arc_process_version")); assertEquals(3, count("arc_request_event"));
        }
    }

    @Test void expenseRouteConcurrentKeyRetryAndSelectedMemberVotesStayAtomic() throws Exception {
        try (var first = routedExpenses("0.30"); var second = routedExpenses()) {
            var commands = new ArrayList<Callable<ApprovalService.Request>>();
            for (int i = 0; i < 8; i++) {
                var service = i % 2 == 0 ? first : second;
                commands.add(() -> service.submitDocument("alice", expenseDocument(), 1, "expense-route-race"));
            }
            var results = race(commands); var created = results.get(0);
            assertTrue(results.stream().allMatch(created::equals));
            assertEquals(1, count("arc_request")); assertEquals(1, count("arc_submission_key")); assertEquals(1, count("arc_request_event"));
            members(created, new Member("bob", true, false), new Member("carol", false, false));
            first.decide("bob", created.id(), "base", "APPROVE", "Base");
            race(List.of(() -> first.decide("bob", created.id(), "risk", "APPROVE", "Bob"),
                () -> second.decide("carol", created.id(), "risk", "APPROVE", "Carol")));
            var current = first.submitDocument("alice", expenseDocument(), 1, "expense-route-race");
            assertEquals("final", current.currentStepId()); assertEquals(4, current.history().size());
            assertEquals(created.routing(), current.routing()); assertEquals(4, count("arc_request_event"));
            members(current, new Member("bob", true, true), new Member("carol", false, true));
        }
    }

    @Test void expenseRouteAuditFailureRollsBackRequestKeyAndMembers() throws Exception {
        var failed = new AtomicBoolean();
        var source = ServerTestSupport.failAfterStatement(dataSource, "INSERT INTO arc_request_event", failed);
        try (var service = new ApprovalService(new JdbcApprovalStore(source, JSON, expenseRoute(1, "0.30")), USERS)) {
            var before = databaseSnapshot();
            assertThrows(IOException.class, () -> service.submitDocument("alice", expenseDocument(), 1, "expense-route-rollback"));
            assertTrue(failed.get()); assertEquals(before, databaseSnapshot());
        }
        try (var service = routedExpenses()) {
            var created = service.submitDocument("alice", expenseDocument(), 1, "expense-route-rollback");
            assertEquals(List.of("base", "risk", "final"), created.routing().stepIds());
            members(created, new Member("bob", true, false), new Member("carol", false, false));
            assertEquals(1, count("arc_request_event")); assertEquals(1, count("arc_submission_key"));
        }
    }

    @Test void expenseRouteLostCommitAcknowledgementReplaysFrozenPathAfterPublication() throws Exception {
        var lost = new AtomicBoolean(); var source = ServerTestSupport.loseKeyedCommitAcknowledgement(dataSource, lost);
        try (var service = new ApprovalService(new JdbcApprovalStore(source, JSON, expenseRoute(1, "0.31")), USERS)) {
            assertThrows(IOException.class, () -> service.submitDocument("alice", expenseDocument(), 1, "expense-route-lost-ack"));
            assertTrue(lost.get());
        }
        try (var service = routedExpenses()) {
            service.publishForDocument("alice", 1, expenseRoute(1, "0.30"), BusinessDocument.Expense.class);
            var saved = service.submitDocument("alice", expenseDocument(), 1, "expense-route-lost-ack");
            assertEquals(1, saved.processVersion()); assertEquals(List.of("base", "final"), saved.routing().stepIds());
            members(saved, new Member("bob", true, false));
            assertEquals(saved, service.submitDocument("alice", expenseDocument(), 1, "expense-route-lost-ack"));
            assertEquals(1, count("arc_request")); assertEquals(1, count("arc_request_event")); assertEquals(1, count("arc_submission_key"));
        }
    }
}
