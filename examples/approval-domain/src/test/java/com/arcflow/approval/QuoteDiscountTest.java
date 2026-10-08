package com.arcflow.approval;

import com.arcflow.approval.BusinessDocument.QuoteDiscount;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
import static com.arcflow.approval.BusinessDocumentTest.status;

class QuoteDiscountTest {
    @TempDir Path directory;
    final ObjectMapper mapper = ApprovalService.strictMapper(new ObjectMapper());
    final ActorDirectoryTest.Directory actors = new ActorDirectoryTest.Directory();
    QuoteDiscountTest() { actors.active.addAll(List.of("303", "404")); }
    static QuoteDiscount quote() {
        return new QuoteDiscount("Q-DEMO-001", " Quote discount ", " Ten equipment sets ", " CUSTOMER-DEMO-A ", 1,
            " Equipment set ", 10, new BigDecimal("1000.00"), new BigDecimal("850.00"), "CNY", "2099-12-31");
    }
    Path file() { return directory.resolve("state.json"); }
    ApprovalService open() throws IOException { return new ApprovalService(mapper, file().toString(), actors, QuoteDiscountCase.definition("202", "303")); }
    ObjectNode input() { return mapper.valueToTree(quote()); }
    QuoteDiscount decode(ObjectNode n) throws Exception { return (QuoteDiscount) mapper.treeToValue(n, BusinessDocument.class); }

    @Test void exactAmountsAndDisplayOnlyThresholdUseDecimalArithmetic() {
        var q = quote(); q.validate();
        assertEquals(new BigDecimal("10000.00"), q.listTotal());
        assertEquals(new BigDecimal("8500.00"), q.requestedTotal());
        assertEquals(new BigDecimal("1500.00"), q.reductionTotal());
        assertEquals(new BigDecimal("15"), q.discountPercent()); assertTrue(q.discountAtLeast(BigDecimal.TEN));
        var small = new QuoteDiscount("Q-1", "Title", "Reason", "C-1", 1, "Item", 3, new BigDecimal("0.20"), new BigDecimal("0.10"), "CNY", "2099-12-31");
        assertEquals(new BigDecimal("0.30"), small.requestedTotal());
        var max = new QuoteDiscount("Q-2", "Title", "Reason", "C-1", Integer.MAX_VALUE, "Item", 100000,
            new BigDecimal("1000000000.00"), new BigDecimal("999999999.99"), "CNY", "2099-12-31");
        max.validate(); assertEquals("99999999999000.00", max.requestedTotal().toPlainString());
        var rounded = new QuoteDiscount("Q-3", "Title", "Reason", "C-1", 1, "Item", 1,
            new BigDecimal("1000000"), new BigDecimal("900000.01"), "CNY", "2099-12-31");
        assertEquals(0, rounded.discountPercent().compareTo(BigDecimal.TEN));
        assertFalse(rounded.discountAtLeast(BigDecimal.TEN));
    }
    @Test void everyNewFieldIsRequiredAndStrictlyTyped() throws Exception {
        for (String field : List.of("customerRef", "quoteRevision", "listUnitPrice", "requestedUnitPrice", "validUntil", "currency", "quantity", "item")) {
            var n = input(); n.remove(field); assertThrows(Exception.class, () -> decode(n), field);
            var nul = input(); nul.putNull(field); assertThrows(Exception.class, () -> { decode(nul).validate(); }, field);
        }
        for (String field : List.of("quoteRevision", "quantity", "listUnitPrice", "requestedUnitPrice")) {
            var n = input(); n.put(field, "1"); assertThrows(Exception.class, () -> decode(n), field);
            var b = input(); b.put(field, true); assertThrows(Exception.class, () -> decode(b), field);
        }
        for (String field : List.of("customerRef", "item", "currency", "validUntil")) {
            var n = input(); n.put(field, 1); assertThrows(Exception.class, () -> decode(n), field);
        }
        var fractional = input(); fractional.put("quoteRevision", 1.5); assertThrows(Exception.class, () -> decode(fractional));
        var overflow = input(); overflow.put("quoteRevision", 2147483648L); assertThrows(Exception.class, () -> decode(overflow));
        var forgedTotal = input(); forgedTotal.put("requestedTotal", 1); assertThrows(Exception.class, () -> decode(forgedTotal));
        var unknown = input(); unknown.put("type", "crm"); assertThrows(Exception.class, () -> decode(unknown));
    }
    @Test void invalidAmountsDatesAndBoundsAreRejectedBeforeStorage() throws Exception {
        try (var service = open()) {
            for (String field : List.of("listUnitPrice", "requestedUnitPrice")) for (String amount : List.of("0", "-1", "0.001", "1000000000.01")) {
                var n = input(); n.put(field, new BigDecimal(amount));
                status(400, () -> service.submitDocument("101", decode(n), 1, null));
            }
            for (String field : List.of("quoteRevision", "quantity")) { var n = input(); n.put(field, 0); status(400, () -> service.submitDocument("101", decode(n), 1, null)); }
            for (String value : List.of("2026-02-29", "2026-13-01", "2026-2-01", "2026-01-01T00:00:00Z", "")) {
                var n = input(); n.put("validUntil", value); status(400, () -> service.submitDocument("101", decode(n), 1, null));
            }
            for (String value : List.of("1000", "1001")) { var n = input(); n.put("requestedUnitPrice", new BigDecimal(value)); status(400, () -> service.submitDocument("101", decode(n), 1, null)); }
            var jpy = input(); jpy.put("currency", "JPY").put("requestedUnitPrice", new BigDecimal("1.5")); status(400, () -> service.submitDocument("101", decode(jpy), 1, null));
            var customer = input(); customer.put("customerRef", "x".repeat(129)); status(400, () -> service.submitDocument("101", decode(customer), 1, null));
            assertTrue(service.list("101").isEmpty()); assertFalse(Files.exists(file()));
        }
    }
    @Test void quoteLifecycleKeepsFixedSnapshotAndExistingDecisionAuthorization() throws Exception {
        ApprovalService.Request saved;
        try (var service = open()) {
            saved = service.submitDocument("101", quote(), 1, "quote");
            assertEquals(0, saved.days()); assertEquals("quoteDiscount", mapper.valueToTree(saved).path("business").path("type").asText());
            assertEquals(6, mapper.readTree(Files.readAllBytes(file())).path("schemaVersion").intValue());
            assertEquals(saved, mapper.readValue(mapper.writeValueAsBytes(saved), ApprovalService.Request.class));
            status(404, () -> service.decide("404", saved.id(), "salesManager", "APPROVE", ""));
            status(404, () -> service.decide("1", saved.id(), "salesManager", "APPROVE", "")); // invisible admin is 404 below
        }
    }
    @Test void twoStepApprovalReplayExpiryAndRestartDoNotRewriteBusiness() throws Exception {
        ApprovalService.Request submitted;
        try (var service = open()) {
            submitted = service.submitDocument("101", quote(), 1, "quote");
            status(409, () -> service.decide("303", submitted.id(), "finance", "APPROVE", ""));
            status(403, () -> service.decide("101", submitted.id(), "salesManager", "APPROVE", ""));
            var pending = service.decide("202", submitted.id(), "salesManager", "APPROVE", "Reviewed");
            assertEquals("PENDING", pending.status()); assertEquals("finance", pending.currentStepId());
            assertEquals(pending, service.decide("202", submitted.id(), "salesManager", "APPROVE", "Ignored retry comment"));
            status(409, () -> service.decide("202", submitted.id(), "salesManager", "REJECT", ""));
        }
        try (var service = open()) {
            var approved = service.decide("303", submitted.id(), "finance", "APPROVE", "Reviewed");
            assertEquals("APPROVED", approved.status()); assertEquals(3, approved.history().size());
            assertEquals(submitted.business(), approved.business()); assertEquals(submitted.definition(), approved.definition());
            assertEquals(approved, service.submitDocument("101", quote(), 1, "quote"));
        }
    }
    @Test void allQuoteFieldsAndCrossDocumentIntentsParticipateInKeyConflict() throws Exception {
        try (var service = open()) {
            var saved = service.submitDocument("101", quote(), 1, "key");
            for (String field : List.of("businessId", "title", "reason", "customerRef", "item", "currency", "validUntil")) {
                var changed = input(); changed.put(field, field.equals("currency") ? "USD" : field.equals("validUntil") ? "2099-12-30" : "Other");
                status(409, () -> service.submitDocument("101", decode(changed), 1, "key"));
            }
            for (String field : List.of("quoteRevision", "quantity", "listUnitPrice", "requestedUnitPrice")) {
                var changed = input(); changed.put(field, field.equals("listUnitPrice") ? 1100 : field.equals("requestedUnitPrice") ? 800 : 2);
                status(409, () -> service.submitDocument("101", decode(changed), 1, "key"));
            }
            status(409, () -> service.submitDocument("101", BusinessDocumentTest.purchase(), 1, "key"));
            status(409, () -> service.submitDocument("101", new BusinessDocument.Leave("Q-DEMO-001", "Quote discount", "Ten equipment sets", 2), 1, "key"));
            status(409, () -> service.submit("101", "Quote discount", "Ten equipment sets", 2, 1, "key"));
            var normalized = input(); normalized.put("listUnitPrice", 1000).put("requestedUnitPrice", 850).put("item", "Equipment set").put("customerRef", "CUSTOMER-DEMO-A");
            assertEquals(saved, service.submitDocument("101", decode(normalized), 1, "key"));
        }
    }
    @Test void schemaFiveUpgradesWithExactBackupAndNeverDowngrades() throws Exception {
        byte[] old;
        try (var service = open()) { service.submitDocument("101", BusinessDocumentTest.purchase(), 1, "purchase"); }
        old = Files.readAllBytes(file()); assertEquals(5, mapper.readTree(old).path("schemaVersion").intValue());
        try (var service = open()) {
            service.submitDocument("101", quote(), 1, "quote");
            service.submit("101", "Leave", "Rest", 2, 1);
        }
        assertArrayEquals(old, Files.readAllBytes(file().resolveSibling("state.json.schema5.bak")));
        assertEquals(6, mapper.readTree(Files.readAllBytes(file())).path("schemaVersion").intValue());
        try (var service = open()) { assertEquals(3, service.list("101").size()); }
        var state = (ObjectNode) mapper.readTree(Files.readAllBytes(file())); state.put("schemaVersion", 5);
        Files.writeString(file(), state.toString()); assertThrows(IOException.class, this::open);
    }
    @Test void sameSessionSchemaFiveMutationRetainsImmediateBackupBeforeSixUpgrade() throws Exception {
        try (var service = open()) { service.submitDocument("101", BusinessDocumentTest.purchase(), 1, "purchase"); }
        byte[] afterDecision;
        try (var service = open()) {
            var purchase = service.list("101").get(0);
            service.decide("202", purchase.id(), "salesManager", "APPROVE", "Reviewed");
            afterDecision = Files.readAllBytes(file());
            assertEquals(5, mapper.readTree(afterDecision).path("schemaVersion").intValue());
            service.submitDocument("101", quote(), 1, "quote");
        }
        assertArrayEquals(afterDecision, Files.readAllBytes(file().resolveSibling("state.json.schema5.bak")));
        try (var service = open()) { assertEquals(2, service.list("101").size()); }
    }
    @Test void newSessionCanCreateSchemaFiveThenSixWithoutReopening() throws Exception {
        byte[] beforeQuote;
        try (var service = open()) {
            service.submitDocument("101", BusinessDocumentTest.purchase(), 1, "purchase");
            beforeQuote = Files.readAllBytes(file());
            service.submitDocument("101", quote(), 1, "quote");
        }
        assertArrayEquals(beforeQuote, Files.readAllBytes(file().resolveSibling("state.json.schema5.bak")));
    }

    @Test void restoredSnapshotsRejectTamperedProjectionUnknownFieldsAndPrices() throws Exception {
        try (var service = open()) { service.submitDocument("101", quote(), 1, "quote"); }
        byte[] original = Files.readAllBytes(file());
        for (String field : List.of("days", "requestedUnitPrice", "requestedTotal", "quoteRevision", "validUntil")) {
            var state = (ObjectNode) mapper.readTree(original);
            var request = (ObjectNode) state.path("requests").get(0); var business = (ObjectNode) request.get("business");
            switch (field) {
                case "days" -> request.put("days", 1);
                case "validUntil" -> business.put(field, "2026-02-30");
                case "quoteRevision" -> business.put(field, 0);
                case "requestedTotal" -> business.put(field, 1);
                default -> business.put(field, 1001);
            }
            Files.writeString(file(), state.toString()); assertThrows(IOException.class, this::open, field);
        }
    }
    @Test void concurrentIdenticalQuoteRetriesHaveOneRequestAndBinding() throws Exception {
        try (var service = open()) {
            var pool = Executors.newFixedThreadPool(8); var start = new CountDownLatch(1);
            try {
                var futures = new ArrayList<Future<String>>();
                for (int i = 0; i < 16; i++) futures.add(pool.submit(() -> { start.await(); return service.submitDocument("101", quote(), 1, "quote").id(); }));
                start.countDown(); var ids = new HashSet<String>(); for (var future : futures) ids.add(future.get(15, TimeUnit.SECONDS));
                assertEquals(1, ids.size()); assertEquals(1, service.list("101").size());
                assertEquals(1, mapper.readTree(Files.readAllBytes(file())).get("submissions").size());
            } finally { pool.shutdownNow(); }
        }
    }
}
