package com.arcflow.approval;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

/** Expense rules consume only the validated, immutable line sum, never a client total. */
class ExpenseConditionalRoutingTest {
    @TempDir Path dir;
    final ObjectMapper mapper = ApprovalService.strictMapper(new ObjectMapper());
    final ActorDirectoryTest.Directory actors = new ActorDirectoryTest.Directory();
    ExpenseConditionalRoutingTest() { actors.active.addAll(List.of("303", "404", "505")); }
    static ConditionalRouting.Rule money(String operator, String threshold) { return money(operator, "CNY", threshold); }
    static ConditionalRouting.Rule money(String operator, String currency, String threshold) {
        return new ConditionalRouting.Rule("ALL", List.of(ConditionalRouting.Predicate.expenseMoney(operator, currency, new BigDecimal(threshold))));
    }
    static ProcessDefinition definition(ConditionalRouting.Rule rule) {
        var template = ConditionalRoutingTest.definition(rule);
        return new ProcessDefinition(4, "oa-expense", 1, "Conditional expense", template.nodes());
    }
    static BusinessDocument.Expense expense(String currency, String... amounts) {
        var lines = new ArrayList<BusinessDocument.ExpenseLine>();
        for (int i = 0; i < amounts.length; i++) lines.add(new BusinessDocument.ExpenseLine("L" + i, "2026-10-01", "OFFICE", "Synthetic expense", new BigDecimal(amounts[i]), "RECEIPT-" + i));
        return new BusinessDocument.Expense(1, "EXP-ROUTE", "Expense", "Synthetic routing test", "ENGINEERING", currency, lines);
    }
    Path file() { return dir.resolve("expenses.json"); }
    ApprovalService open(ProcessDefinition definition) throws IOException { return new ApprovalService(mapper, file().toString(), actors, definition); }
    ApprovalService.Request submit(ApprovalService service, String amount, String key) throws IOException {
        return service.submitDocument("101", expense("CNY", amount), 1, key);
    }

    @Test void exactMultiLineThresholdBelowEqualAndAboveIsFrozenAndRestored() throws Exception {
        var definition = definition(money("GTE", "0.30"));
        try (var service = open(definition)) {
            var below = service.submitDocument("101", expense("CNY", "0.10", "0.19"), 1, "below");
            var equal = service.submitDocument("101", expense("CNY", "0.10", "0.20"), 1, "equal");
            var above = service.submitDocument("101", expense("CNY", "0.10", "0.21"), 1, "above");
            assertEquals(List.of("base", "final"), below.routing().stepIds());
            assertEquals(List.of("base", "risk", "final"), equal.routing().stepIds());
            assertEquals(equal.routing().stepIds(), above.routing().stepIds());
            assertEquals(new ConditionalRouting.Fact("expense.totalAmount", "CNY 0.3", true), equal.routing().evaluations().get(0).predicates().get(0));
            assertEquals(new BigDecimal("0.3"), ((BusinessDocument.Expense) equal.business()).total());
            assertEquals(definition, below.definition()); assertEquals(1, equal.routing().schemaVersion());
            assertEquals(13, mapper.readTree(Files.readAllBytes(file())).path("schemaVersion").asInt());
        }
        try (var service = open(definition)) {
            assertEquals(List.of("base", "risk", "final"), service.submitDocument("101", expense("CNY", "0.10", "0.20"), 1, "equal").routing().stepIds());
        }
    }

    @Test void everyMoneyOperatorEveryCurrencyAndAllAnyCompareExactSums() {
        for (String currency : List.of("CNY", "USD", "EUR", "GBP", "JPY")) {
            var values = "JPY".equals(currency) ? List.of("29", "30", "31") : List.of("0.29", "0.30", "0.31");
            String threshold = values.get(1);
            for (String operator : List.of("EQ", "GT", "GTE", "LT", "LTE")) for (String value : values) {
                int comparison = new BigDecimal(value).compareTo(new BigDecimal(threshold));
                boolean expected = switch (operator) { case "EQ" -> comparison == 0; case "GT" -> comparison > 0; case "GTE" -> comparison >= 0; case "LT" -> comparison < 0; default -> comparison <= 0; };
                var route = ConditionalRouting.freeze(definition(money(operator, currency, threshold)), expense(currency, value));
                assertEquals(expected, route.stepIds().contains("risk"), currency + " " + value + " " + operator);
                assertEquals(currency + " " + new BigDecimal(value).stripTrailingZeros().toPlainString(), route.evaluations().get(0).predicates().get(0).actualValue());
            }
        }
        var atoms = List.of(ConditionalRouting.Predicate.expenseMoney("GT", "CNY", new BigDecimal("0.30")), ConditionalRouting.Predicate.expenseMoney("EQ", "CNY", new BigDecimal("0.30")));
        for (String mode : List.of("ALL", "ANY")) {
            var route = ConditionalRouting.freeze(definition(new ConditionalRouting.Rule(mode, atoms)), expense("CNY", "0.10", "0.20"));
            assertEquals("ANY".equals(mode), route.stepIds().contains("risk"));
            assertEquals(List.of(false, true), route.evaluations().get(0).predicates().stream().map(ConditionalRouting.Fact::result).toList());
        }
    }

    @Test void maximumTwentyLineTotalAndZeroThresholdAreExactWithoutOverflow() throws Exception {
        String[] maximum = new String[20]; Arrays.fill(maximum, "1000000000.00");
        var document = expense("CNY", maximum);
        assertEquals(0, new BigDecimal("20000000000").compareTo(document.total()));
        assertTrue(ConditionalRouting.freeze(definition(money("EQ", "20000000000")), document).stepIds().contains("risk"));
        assertTrue(ConditionalRouting.freeze(definition(money("GT", "0")), expense("CNY", "0.01")).stepIds().contains("risk"));
        assertTrue(ConditionalRouting.freeze(definition(money("EQ", "JPY", "30.00")), expense("JPY", "10.00", "20")).stepIds().contains("risk"));
        try (var service = open(definition(money("LTE", "20000000000")))) {
            var created = service.submitDocument("101", document, 1, "maximum");
            assertEquals("CNY 20000000000", created.routing().evaluations().get(0).predicates().get(0).actualValue());
        }
    }

    @Test void strictPredicateShapesRejectMissingUnknownNullAndCoercedFields() throws Exception {
        String valid = "{\"field\":\"expense.totalAmount\",\"operator\":\"GTE\",\"currency\":\"CNY\",\"threshold\":0.30}";
        var baseline = (ObjectNode) mapper.readTree(valid);
        var parsed = mapper.readValue(valid, ConditionalRouting.Predicate.class);
        assertEquals(ConditionalRouting.Predicate.expenseMoney("GTE", "CNY", new BigDecimal("0.30")), parsed);
        assertEquals(Set.of("field", "operator", "currency", "threshold"), fields(mapper.valueToTree(parsed)));
        assertEquals("payment.netTotal", ConditionalRouting.Predicate.money("GTE", "CNY", BigDecimal.ONE).field());
        var variants = new ArrayList<ObjectNode>();
        for (String field : List.of("field", "operator", "currency", "threshold")) {
            var missing = baseline.deepCopy(); missing.remove(field); variants.add(missing);
            var nil = baseline.deepCopy(); nil.putNull(field); variants.add(nil);
        }
        for (String field : List.of("expected", "values", "amount", "total", "script", "expression", "documentPath")) { var unknown = baseline.deepCopy(); unknown.put(field, "true"); variants.add(unknown); }
        for (JsonNode threshold : List.of(TextNode.valueOf("0.30"), BooleanNode.TRUE, mapper.createArrayNode(), mapper.createObjectNode())) { var variant = baseline.deepCopy(); variant.set("threshold", threshold); variants.add(variant); }
        for (String field : List.of("field", "operator", "currency")) { var number = baseline.deepCopy(); number.put(field, 1); variants.add(number); }
        for (String field : List.of("expense.total", "expense.lines.amount", "expense.totalAmount ", "payment.amount", "EXPENSE.totalAmount")) { var unknown = baseline.deepCopy(); unknown.put("field", field); variants.add(unknown); }
        for (String operator : List.of("IN", "NE", "BETWEEN", "gte", "", "GT ")) { var bad = baseline.deepCopy(); bad.put("operator", operator); variants.add(bad); }
        for (String currency : List.of("BTC", "cny", "CNY ", "")) { var bad = baseline.deepCopy(); bad.put("currency", currency); variants.add(bad); }
        for (String threshold : List.of("-0.01", "0.001", "20000000000.01", "1e100")) { var bad = baseline.deepCopy(); bad.put("threshold", new BigDecimal(threshold)); variants.add(bad); }
        var fractionalYen = baseline.deepCopy().put("currency", "JPY"); variants.add(fractionalYen);
        for (var variant : variants) assertThrows(Exception.class, () -> mapper.treeToValue(variant, ConditionalRouting.Predicate.class), variant.toString());
        assertThrows(IOException.class, () -> mapper.readValue(valid.replace("\"threshold\":0.30", "\"threshold\":0.30,\"threshold\":0.31"), ConditionalRouting.Predicate.class));
        assertThrows(IOException.class, () -> mapper.readValue(valid + " {}", ConditionalRouting.Predicate.class));
        for (String amount : List.of("0.001", "0.300", "1.000")) assertThrows(IllegalArgumentException.class, () -> ConditionalRouting.Predicate.expenseMoney("EQ", "CNY", new BigDecimal(amount)));
    }
    private Set<String> fields(JsonNode node) { var result = new HashSet<String>(); node.fieldNames().forEachRemaining(result::add); return result; }

    @Test void finiteDefinitionLimitsAndMandatoryStagesStillApplyToExpenseRules() throws Exception {
        var baseline = (ObjectNode) mapper.valueToTree(definition(money("GTE", "1")));
        var variants = new ArrayList<ObjectNode>();
        for (int schema : List.of(2, 3, 5)) variants.add(baseline.deepCopy().put("schemaVersion", schema));
        for (int index : List.of(0, 4)) {
            var boundary = baseline.deepCopy(); ((ObjectNode) boundary.path("nodes").get(index)).set("runIf", boundary.path("nodes").get(2).get("runIf")); variants.add(boundary);
        }
        var all = baseline.deepCopy();
        for (int index : List.of(1, 3)) ((ObjectNode) all.path("nodes").get(index)).set("runIf", all.path("nodes").get(2).get("runIf"));
        variants.add(all);
        for (String mode : List.of("NONE", "all", "", "ANY ")) {
            var bad = baseline.deepCopy(); ((ObjectNode) bad.path("nodes").get(2).get("runIf")).put("mode", mode); variants.add(bad);
        }
        for (var variant : variants) assertThrows(Exception.class, () -> ProcessDefinition.validate(mapper.treeToValue(variant, ProcessDefinition.class)));
        var eight = new ConditionalRouting.Rule("ALL", Collections.nCopies(8, ConditionalRouting.Predicate.expenseMoney("GT", "CNY", BigDecimal.ZERO)));
        ProcessDefinition.validate(definition(eight));
        var nodes = new ArrayList<>(definition(eight).nodes());
        nodes.set(3, new ProcessDefinition.ProcessNode("final", "approval", "Extra", "202", null, null, money("GT", "0")));
        assertThrows(IllegalArgumentException.class, () -> ProcessDefinition.validate(new ProcessDefinition(4, "oa-expense", 1, "Nine atoms", nodes)));
        assertThrows(IllegalArgumentException.class, () -> ProcessDefinition.validate(definition(new ConditionalRouting.Rule("ALL", List.of()))));
        var fixed = new ArrayList<>(definition(money("GTE", "1")).nodes()); var conditional = fixed.get(2);
        fixed.set(2, new ProcessDefinition.ProcessNode(conditional.id(), conditional.type(), conditional.name(), conditional.assigneeId(), conditional.assigneeIds(), conditional.completionMode()));
        var noConditions = new ProcessDefinition(4, "oa-expense", 1, "All manual", fixed);
        var route = ConditionalRouting.freeze(noConditions, expense("CNY", "0.01"));
        assertEquals(List.of("base", "risk", "final"), route.stepIds()); assertTrue(route.evaluations().isEmpty());
    }

    @Test void invalidLineDataAndForeignCurrenciesFailBeforeAnyWrite() throws Exception {
        try (var service = open(definition(money("GTE", "0.30")))) {
            for (var document : List.of(expense("USD", "0.30"), expense("CNY"), expense("CNY", "0"), expense("CNY", "-0.01"), expense("CNY", "0.001"), expense("CNY", "0.300"), expense("CNY", "1000000000.01"), expense("JPY", "0.30"))) {
                ActorDirectoryTest.status(400, () -> service.submitDocument("101", document, 1, "invalid"));
                assertFalse(Files.exists(file())); assertTrue(service.list("101").isEmpty());
            }
            String[] tooMany = new String[21]; Arrays.fill(tooMany, "1");
            ActorDirectoryTest.status(400, () -> service.submitDocument("101", expense("CNY", tooMany), 1, "invalid"));
            assertFalse(Files.exists(file()));
        }
    }

    @Test void scenarioPublicationAndSubmissionCannotCrossFieldFamilies() throws Exception {
        var expenseRule = ConditionalRouting.Predicate.expenseMoney("GTE", "CNY", BigDecimal.ZERO);
        for (var foreign : List.of(ConditionalRouting.Predicate.money("GTE", "CNY", BigDecimal.ZERO), ConditionalRouting.Predicate.flag(true), ConditionalRouting.Predicate.terms("EQ", "STANDARD"))) {
            var mixed = new ConditionalRouting.Rule("ANY", List.of(expenseRule, foreign));
            assertThrows(IllegalArgumentException.class, () -> ProcessDefinition.validate(definition(mixed)));
            var foreignDefinition = definition(new ConditionalRouting.Rule("ALL", List.of(foreign)));
            assertThrows(IllegalArgumentException.class, () -> ConditionalRouting.validateForDocument(foreignDefinition, BusinessDocument.Expense.class));
        }
        for (var type : List.of(BusinessDocument.PaymentRequest.class, BusinessDocument.Receiving.class, BusinessDocument.ContractApproval.class, BusinessDocument.Leave.class, BusinessDocument.Procurement.class, BusinessDocument.QuoteDiscount.class, BusinessDocument.Travel.class, BusinessDocument.SealUse.class))
            assertThrows(IllegalArgumentException.class, () -> ConditionalRouting.validateForDocument(definition(money("GTE", "1")), type));
        var mixedCurrency = new ConditionalRouting.Rule("ANY", List.of(expenseRule, ConditionalRouting.Predicate.expenseMoney("GTE", "USD", BigDecimal.ZERO)));
        assertThrows(IllegalArgumentException.class, () -> ProcessDefinition.validate(definition(mixedCurrency)));
        try (var service = open(definition(money("GTE", "1")))) {
            ActorDirectoryTest.status(400, () -> service.publish("1", 1, definition(money("GTE", "1"))));
            ActorDirectoryTest.status(400, () -> service.publishForDocument("1", 1, definition(ConditionalRoutingTest.money("GTE", "1")), BusinessDocument.Expense.class));
            for (BusinessDocument document : List.of(PaymentContractDocumentTest.payment(), PaymentContractDocumentTest.contract(), ReceivingScenarioTest.receipt()))
                ActorDirectoryTest.status(400, () -> service.submitDocument("101", document, 1, "foreign"));
            assertFalse(Files.exists(file()));
        }
    }

    @Test void skippedActorsCannotReadVoteOrAppearInPendingHandledAndSelectedAllRejects() throws Exception {
        try (var service = open(definition(money("GTE", "0.30")))) {
            var low = submit(service, "0.29", "low");
            for (String actor : List.of("303", "404")) {
                assertTrue(service.list(actor).isEmpty());
                ActorDirectoryTest.status(404, () -> service.decide(actor, low.id(), "risk", "APPROVE", "Skipped"));
                for (String box : List.of("PENDING", "HANDLED")) assertTrue(service.inbox(actor, Map.of("box", List.of(box))).items().isEmpty());
            }
            assertEquals(List.of("202", "505"), InboxQuery.members(low).stream().map(InboxQuery.Member::actorId).toList());
            assertEquals("final", service.decide("202", low.id(), "base", "APPROVE", "").currentStepId());
            assertEquals("PENDING", service.decide("202", low.id(), "final", "REJECT", "ANY permits another vote").status());
            var approved = service.decide("505", low.id(), "final", "APPROVE", "");
            assertEquals("APPROVED", approved.status()); assertEquals(4, approved.history().size()); assertEquals(low.routing(), approved.routing());
            assertEquals(approved, service.decide("202", low.id(), "base", "APPROVE", "Retry"));
            var high = submit(service, "0.30", "high");
            ActorDirectoryTest.status(409, () -> service.decide("303", high.id(), "risk", "APPROVE", "Early"));
            service.decide("202", high.id(), "base", "APPROVE", "");
            assertEquals(List.of(high.id()), service.inbox("303", Map.of()).items().stream().map(ApprovalService.Request::id).toList());
            var partial = service.decide("303", high.id(), "risk", "APPROVE", "");
            assertEquals("risk", partial.currentStepId()); assertEquals(List.of("404"), ApprovalService.pendingApproverIds(partial));
            var rejected = service.decide("404", high.id(), "risk", "REJECT", "");
            assertEquals("REJECTED", rejected.status()); assertEquals(4, rejected.history().size()); assertEquals(high.routing(), rejected.routing());
        }
    }

    @Test void publicationCannotRerouteOldKeysAndSkippedSelfAssignmentStillRejects() throws Exception {
        try (var service = open(definition(money("GTE", "10000")))) {
            var old = submit(service, "6500", "old");
            service.publishForDocument("1", 1, definition(money("GTE", "100")), BusinessDocument.Expense.class);
            var newer = service.submitDocument("101", expense("CNY", "6500"), 2, "new");
            assertEquals(List.of("base", "risk", "final"), newer.routing().stepIds()); assertEquals(old, submit(service, "6500", "old"));
            ActorDirectoryTest.status(409, () -> service.submitDocument("101", expense("CNY", "6500"), 2, "old"));
            assertEquals("final", service.decide("202", old.id(), "base", "APPROVE", "").currentStepId());
        }
        try (var service = open(definition(money("GTE", "10000")))) { assertEquals(List.of("base", "final"), submit(service, "6500", "old").routing().stepIds()); }
        var nodes = new ArrayList<>(definition(money("GTE", "10000")).nodes());
        nodes.set(2, new ProcessDefinition.ProcessNode("risk", "approval", "Skipped self", "101", null, null, money("GTE", "10000")));
        Path self = dir.resolve("self.json");
        try (var service = new ApprovalService(mapper, self.toString(), actors, new ProcessDefinition(4, "oa-expense", 1, "Self", nodes))) {
            ActorDirectoryTest.status(400, () -> submit(service, "1", "self")); assertFalse(Files.exists(self));
        }
    }

    @Test void concurrentKeyAndSelectedVotesRetainOneRouteAndExactEvents() throws Exception {
        try (var service = open(definition(money("GTE", "0.30")))) {
            var executor = Executors.newFixedThreadPool(8);
            try {
                var gate = new CountDownLatch(1); var futures = new ArrayList<Future<ApprovalService.Request>>();
                for (int i = 0; i < 16; i++) futures.add(executor.submit(() -> { gate.await(); return service.submitDocument("101", expense("CNY", "0.10", "0.20"), 1, "same"); }));
                gate.countDown(); var created = futures.get(0).get(); for (var future : futures) assertEquals(created, future.get());
                assertEquals(1, service.list("101").size()); service.decide("202", created.id(), "base", "APPROVE", "");
                var a = executor.submit(() -> service.decide("303", created.id(), "risk", "APPROVE", "A"));
                var b = executor.submit(() -> service.decide("404", created.id(), "risk", "APPROVE", "B")); a.get(); b.get();
                var current = service.submitDocument("101", expense("CNY", "0.10", "0.20"), 1, "same");
                assertEquals("final", current.currentStepId()); assertEquals(4, current.history().size()); assertEquals(created.routing(), current.routing());
            } finally { executor.shutdownNow(); }
        }
    }
}
