package com.arcflow.approval;

import com.arcflow.approval.BusinessDocument.QuoteDiscount;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.nio.file.Path;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
import static com.arcflow.approval.BusinessDocumentTest.status;

class QuoteDiscountCaseTest {
    @TempDir Path directory;
    final ActorDirectoryTest.Directory actors = new ActorDirectoryTest.Directory();
    final Map<Integer, QuoteDiscountCase.QuoteVersion> versions = new HashMap<>();
    int currentRevision = 1;
    Clock clock = Clock.fixed(Instant.parse("2026-10-08T12:00:00Z"), ZoneOffset.UTC);
    QuoteDiscountCaseTest() { actors.active.addAll(List.of("303", "404")); versions.put(1, source(1, "2026-10-08", Set.of("101", "202", "303"))); }
    static QuoteDiscountCase.QuoteVersion source(int revision, String date, Set<String> readers) {
        return new QuoteDiscountCase.QuoteVersion("Q-DEMO-001", revision, "CUSTOMER-DEMO-A", "101", readers,
            "Equipment set", 10, new BigDecimal("1000.00"), "CNY", date);
    }
    QuoteDiscount quote(int revision, String price) {
        var q = versions.get(revision);
        return new QuoteDiscount(q.businessId(), "Quote discount", "Ten equipment sets", q.customerRef(), q.revision(), q.item(),
            q.quantity(), q.listUnitPrice(), new BigDecimal(price), q.currency(), q.validUntil());
    }
    QuoteDiscountCase open() throws Exception {
        var source = new QuoteDiscountCase.QuoteSource() {
            public Optional<QuoteDiscountCase.QuoteVersion> find(String id, int revision) { return "Q-DEMO-001".equals(id) ? Optional.ofNullable(versions.get(revision)) : Optional.empty(); }
            public int currentRevision(String id) { return "Q-DEMO-001".equals(id) ? currentRevision : 0; }
            public List<QuoteDiscountCase.QuoteVersion> available() { return List.copyOf(versions.values()); }
        };
        var service = new ApprovalService(new ObjectMapper(), directory.resolve("state.json").toString(), actors, QuoteDiscountCase.definition("202", "303"));
        return new QuoteDiscountCase(service, actors, source, clock);
    }
    @Test void authoritativeSourceRejectsTamperingAndOwnershipBypass() throws Exception {
        try (var host = open()) {
            var q = quote(1, "850");
            status(403, () -> host.submit("202", q, 1));
            status(404, () -> host.submit("404", q, 1));
            for (String field : List.of("customerRef", "listUnitPrice", "item", "quantity", "currency", "validUntil", "quoteRevision")) {
                var mapper = ApprovalService.strictMapper(new ObjectMapper());
                var n = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.valueToTree(q);
                switch (field) {
                    case "listUnitPrice" -> n.put(field, 1100);
                    case "quantity" -> n.put(field, 2);
                    case "quoteRevision" -> n.put(field, 2);
                    case "currency" -> n.put(field, "USD");
                    case "validUntil" -> n.put(field, "2099-12-31");
                    default -> n.put(field, "Other");
                }
                var tampered = (QuoteDiscount) mapper.treeToValue(n, BusinessDocument.class);
                status(field.equals("quoteRevision") ? 404 : 409, () -> host.submit("101", tampered, 1));
            }
            assertTrue(host.list("101").isEmpty()); assertTrue(host.quotes("404").isEmpty());
        }
    }
    @Test void revisionBindingSurvivesRestartAndConflictsOnChangedDiscount() throws Exception {
        String id;
        try (var host = open()) {
            var view = host.submit("101", quote(1, "850.00"), 1); id = view.request().id();
            assertEquals("8500.00", view.requestedTotal()); assertEquals("1500.00", view.reductionTotal()); assertEquals("15", view.discountPercent());
            assertEquals(id, host.submit("101", quote(1, "850"), 1).request().id());
            status(409, () -> host.submit("101", quote(1, "800"), 1));
            assertEquals(1, host.list("101").size());
        }
        clock = Clock.fixed(Instant.parse("2026-10-09T00:00:00Z"), ZoneOffset.UTC);
        try (var host = open()) {
            var replay = host.submit("101", quote(1, "850"), 1);
            assertEquals(id, replay.request().id()); assertTrue(replay.expired()); assertEquals("PENDING", replay.request().status());
            host.decide("202", id, "salesManager", "APPROVE", "Read expired quote");
            var done = host.decide("303", id, "finance", "APPROVE", "Reviewed");
            assertTrue(done.expired()); assertEquals("APPROVED", done.request().status());
        }
    }
    @Test void oldApprovalCannotMutateOrBePresentedAsCurrentQuoteRevision() throws Exception {
        try (var host = open()) {
            var old = host.submit("101", quote(1, "850"), 1);
            versions.put(2, source(2, "2026-10-09", Set.of("101", "202", "303"))); currentRevision = 2;
            var updated = host.list("101").get(0); assertTrue(updated.quoteUpdated());
            assertEquals(1, ((QuoteDiscount) updated.request().business()).quoteRevision());
            host.decide("202", old.request().id(), "salesManager", "APPROVE", "Old quote");
            var approved = host.decide("303", old.request().id(), "finance", "APPROVE", "Old quote");
            assertTrue(approved.quoteUpdated()); assertEquals("APPROVED", approved.request().status());
            assertEquals(new BigDecimal("1E+3"), versions.get(2).listUnitPrice()); // no source writeback API exists
            assertEquals(2, host.quotes("101").get(0).revision());
            assertEquals(old.request().id(), host.submit("101", quote(1, "850"), 1).request().id());
            assertNotEquals(old.request().id(), host.submit("101", quote(2, "800"), 1).request().id());
        }
    }
    @Test void pastDatesAndNonCurrentRevisionCannotCreateNewRequests() throws Exception {
        clock = Clock.fixed(Instant.parse("2026-10-09T00:00:00Z"), ZoneOffset.UTC);
        try (var host = open()) { status(400, () -> host.submit("101", quote(1, "850"), 1)); }
        clock = Clock.fixed(Instant.parse("2026-10-08T12:00:00Z"), ZoneOffset.UTC);
        currentRevision = 2;
        try (var host = open()) { status(409, () -> host.submit("101", quote(1, "850"), 1)); }
    }
    @Test void businessReadPermissionAndLiveAccountEligibilityApplyToAllOperations() throws Exception {
        try (var host = open()) {
            var saved = host.submit("101", quote(1, "850"), 1); String id = saved.request().id();
            status(404, () -> host.decide("404", id, "salesManager", "APPROVE", ""));
            status(403, () -> host.decide("101", id, "salesManager", "APPROVE", ""));
            status(409, () -> host.decide("303", id, "finance", "APPROVE", ""));
            versions.put(1, source(1, "2026-10-08", Set.of("101", "303")));
            assertTrue(host.list("202").isEmpty()); status(404, () -> host.decide("202", id, "salesManager", "APPROVE", ""));
            actors.active.remove("101"); status(403, () -> host.submit("101", quote(1, "850"), 1)); status(403, () -> host.list("101"));
        }
    }
    @Test void inaccessibleAssignedReviewerBlocksSubmission() throws Exception {
        versions.put(1, source(1, "2026-10-08", Set.of("101", "202")));
        try (var host = open()) { status(403, () -> host.submit("101", quote(1, "850"), 1)); }
    }
    @Test void sameRevisionConcurrentHostSubmissionsUseOneDurableBinding() throws Exception {
        try (var host = open()) {
            var pool = Executors.newFixedThreadPool(8); var start = new CountDownLatch(1);
            try {
                var futures = new ArrayList<Future<String>>();
                for (int i = 0; i < 16; i++) futures.add(pool.submit(() -> { start.await(); return host.submit("101", quote(1, "850"), 1).request().id(); }));
                start.countDown(); var ids = new HashSet<String>(); for (var future : futures) ids.add(future.get(15, TimeUnit.SECONDS));
                assertEquals(1, ids.size()); assertEquals(1, host.list("101").size());
            } finally { pool.shutdownNow(); }
        }
    }
    @Test void everyDiscountUsesBothHumanStepsAndNoRuleChangesTheRoute() throws Exception {
        try (var host = open()) {
            var low = host.submit("101", quote(1, "990"), 1); assertFalse(low.thresholdReached());
            assertEquals(2, low.request().definition().approvals().size());
            var rejected = host.decide("202", low.request().id(), "salesManager", "REJECT", "Not approved");
            assertEquals("REJECTED", rejected.request().status()); assertEquals(2, rejected.request().history().size());
            assertEquals(rejected.request(), host.submit("101", quote(1, "990"), 1).request());
        }
    }
}
