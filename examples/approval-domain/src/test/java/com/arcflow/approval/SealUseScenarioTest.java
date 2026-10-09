package com.arcflow.approval;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
import static com.arcflow.approval.ActorDirectoryTest.status;
import static com.arcflow.approval.SealUseDocumentTest.seal;

class SealUseScenarioTest {
    @TempDir Path dir;
    final ObjectMapper mapper = ApprovalService.strictMapper(new ObjectMapper());
    final ActorDirectoryTest.Directory actors = new ActorDirectoryTest.Directory();
    SealUseScenarioTest() { actors.active.addAll(List.of("303", "404", "505")); }
    Path file() { return dir.resolve("seal.json"); }
    ScenarioCatalog.Entry entry() { return ScenarioCatalog.sealUse("202", "303"); }
    ApprovalService service() throws IOException { return new ApprovalService(mapper, file().toString(), actors, entry().initialProcess()); }
    ScenarioCase host() throws IOException { return new ScenarioCase(entry(), service(), actors); }

    @TestFactory java.util.stream.Stream<DynamicTest> everyValidContractVectorSurvivesActualUtf8PersistenceAndRestart() throws Exception {
        var tests = new ArrayList<DynamicTest>();
        try (var stream = getClass().getResourceAsStream("/seal-use-vectors.json")) {
            assertNotNull(stream); int index = 0;
            for (var vector : mapper.readTree(stream).get("valid")) {
                Path path = dir.resolve("valid-vector-" + index++ + ".json");
                tests.add(DynamicTest.dynamicTest(vector.get("name").textValue(), () -> {
                    var input = mapper.readValue(vector.get("raw").textValue(), BusinessDocument.class);
                    ScenarioCase.View saved;
                    try (var host = new ScenarioCase(entry(), new ApprovalService(mapper, path.toString(), actors, entry().initialProcess()), actors)) {
                        saved = host.submit("101", input, 1, "vector-key");
                        assertEquals(mapper.readTree(vector.get("canonical").textValue()), mapper.valueToTree(saved.request().business()));
                    }
                    try (var host = new ScenarioCase(entry(), new ApprovalService(mapper, path.toString(), actors, entry().initialProcess()), actors)) {
                        assertEquals(saved, host.submit("101", input, 1, "vector-key"));
                        assertEquals(saved, host.list("101").get(0));
                        host.decide("202", saved.request().id(), "documentReview", "APPROVE", "Reviewed");
                        var approved = host.decide("303", saved.request().id(), "sealReview", "APPROVE", "Reviewed");
                        assertEquals(saved.request().business(), approved.request().business());
                    }
                    try (var host = new ScenarioCase(entry(), new ApprovalService(mapper, path.toString(), actors, entry().initialProcess()), actors)) {
                        var replay = host.submit("101", input, 1, "vector-key");
                        assertEquals("APPROVED", replay.request().status());
                        assertEquals(saved.request().business(), replay.request().business());
                    }
                }));
            }
        }
        return tests.stream();
    }

    @Test void compiledMetadataRetainsExistingDtoAndNonMonetaryEnvelope() throws Exception {
        var template = entry().template();
        assertEquals("oa-seal-use", template.id()); assertEquals("OA", template.domain());
        assertEquals("sealUse", template.documentType()); assertEquals(1, template.documentVersion()); assertEquals(1, template.formVersion());
        assertNull(template.lineItems()); assertEquals(BusinessDocument.SealUse.class, entry().documentClass());
        assertEquals(List.of("documentReview", "sealReview"), entry().initialProcess().approvals().stream().map(ProcessDefinition.ProcessNode::id).toList());
        var fields = template.sections().stream().flatMap(section -> section.fields().stream()).toList();
        assertEquals(7, fields.size()); assertEquals(7, fields.stream().map(ScenarioCatalog.Field::path).distinct().count());
        assertEquals(Map.of("businessId", 128, "title", 120, "reason", 2000, "documentName", 160, "documentRef", 128, "sealType", 0, "copyCount", 16),
            fields.stream().collect(java.util.stream.Collectors.toMap(ScenarioCatalog.Field::path, ScenarioCatalog.Field::maxLength)));
        for (var field : fields) {
            assertTrue(field.required()); assertFalse(field.label().zh().isBlank()); assertFalse(field.label().en().isBlank());
            assertEquals(List.of("path", "kind", "label", "required", "maxLength", "options"), fieldNames(mapper.valueToTree(field)));
            if (field.path().equals("copyCount")) assertEquals("integer", field.kind());
            if (field.path().equals("reason")) assertEquals("Business purpose", field.label().en());
            if (field.path().equals("sealType")) {
                assertEquals(List.of("OFFICIAL", "CONTRACT", "FINANCE"), field.options().stream().map(ScenarioCatalog.Option::value).toList());
                for (var option : field.options()) {
                    assertTrue(option.label().en().contains("synthetic")); assertTrue(option.label().zh().contains("合成"));
                }
            } else assertTrue(field.options().isEmpty());
        }
        assertThrows(UnsupportedOperationException.class, () -> template.sections().clear());
        assertThrows(UnsupportedOperationException.class, () -> template.sections().get(0).fields().clear());
        try (var host = host()) {
            var view = host.submit("101", seal(), 1, "metadata"); assertNull(view.total());
            var json = mapper.valueToTree(view);
            assertEquals(List.of("request", "total"), fieldNames(json)); assertTrue(json.get("total").isNull());
            assertEquals(0, view.request().days()); assertFalse(json.path("request").path("business").has("currency"));
            assertFalse(json.path("request").path("business").has("amount"));
        }
    }

    @Test void normalizedBusinessAndRoutingSnapshotsSurvivePublicationApprovalAndRestart() throws Exception {
        ScenarioCase.View original;
        var input = seal();
        try (var host = host()) {
            original = host.submit("101", input, 1, "approved");
            assertEquals(" Synthetic agreement ", input.documentName());
            assertEquals("Synthetic agreement", ((BusinessDocument.SealUse) original.request().business()).documentName());
            assertEquals("Synthetic seal request", original.request().title());
            assertEquals("Synthetic business purpose", original.request().reason());
            assertEquals("documentReview", original.request().currentStepId());
            assertEquals(List.of("202"), ApprovalService.pendingApproverIds(original.request()));
            assertThrows(UnsupportedOperationException.class, () -> original.request().history().clear());
            assertThrows(UnsupportedOperationException.class, () -> original.request().definition().nodes().clear());
            var updated = ScenarioCatalog.sealUse("404", "505").initialProcess();
            assertEquals(2, host.publish("1", 1, updated).version());
            assertEquals(original, host.submit("101", seal(), 1, "approved"));
            status(404, () -> host.decide("404", original.request().id(), "documentReview", "APPROVE", ""));
        }
        ScenarioCase.View approved;
        try (var host = host()) {
            assertEquals(2, host.process("101").version()); assertEquals(List.of(original), host.list("101"));
            var reviewed = host.decide("202", original.request().id(), "documentReview", "APPROVE", " Document checked ");
            assertEquals("PENDING", reviewed.request().status()); assertEquals("sealReview", reviewed.request().currentStepId());
            assertEquals(List.of("303"), ApprovalService.pendingApproverIds(reviewed.request()));
            approved = host.decide("303", original.request().id(), "sealReview", "APPROVE", "Synthetic review complete");
            assertEquals("APPROVED", approved.request().status()); assertNull(approved.total());
            assertEquals(original.request().business(), approved.request().business());
            assertEquals(original.request().definition(), approved.request().definition());
            assertEquals(approved, host.decide("202", original.request().id(), "documentReview", "APPROVE", "retry"));
        }
        try (var host = host()) {
            assertEquals(approved, host.submit("101", seal(), 1, "approved"));
            assertEquals(3, approved.request().history().size()); assertNull(approved.request().currentStepId());
            assertTrue(ApprovalService.pendingApproverIds(approved.request()).isEmpty());
        }
    }

    @Test void rejectedRequestAndDurableCurrentReplayRemainReviewOnly() throws Exception {
        ScenarioCase.View rejected;
        try (var host = host()) {
            var saved = host.submit("101", seal(), 1, "rejected");
            rejected = host.decide("202", saved.request().id(), "documentReview", "REJECT", "Need clearer purpose");
            assertEquals("REJECTED", rejected.request().status()); assertNull(rejected.total());
            assertEquals(saved.request().business(), rejected.request().business());
            status(409, () -> host.decide("303", saved.request().id(), "sealReview", "APPROVE", "too late"));
        }
        try (var host = host()) {
            assertEquals(rejected, host.submit("101", seal(), 1, "rejected"));
            assertEquals(rejected, host.decide("202", rejected.request().id(), "documentReview", "REJECT", "retry"));
            status(409, () -> host.decide("202", rejected.request().id(), "documentReview", "APPROVE", "changed decision"));
        }
    }

    @Test void everyNormalizedFieldAndProcessVersionParticipatesInDurableApplicantScopedIntent() throws Exception {
        ScenarioCase.View original;
        try (var host = host()) {
            original = host.submit("101", seal(), 1, "intent");
            host.publish("1", 1, host.process("1"));
        }
        try (var host = host()) {
            ObjectNode node = mapper.valueToTree(seal());
            for (var change : Map.of("businessId", "SEAL-OTHER", "title", "Other title", "reason", "Other purpose",
                "documentName", "Other document", "documentRef", "OTHER:DOC/2", "sealType", "FINANCE").entrySet()) {
                var changed = mapper.treeToValue(node.deepCopy().put(change.getKey(), change.getValue()), BusinessDocument.class);
                status(409, () -> host.submit("101", changed, 1, "intent"));
            }
            var changedCount = mapper.treeToValue(node.deepCopy().put("copyCount", 3), BusinessDocument.class);
            status(409, () -> host.submit("101", changedCount, 1, "intent"));
            var changedDocumentVersion = mapper.treeToValue(node.deepCopy().put("documentVersion", 2), BusinessDocument.class);
            status(400, () -> host.submit("101", changedDocumentVersion, 1, "intent"));
            status(409, () -> host.submit("101", seal(), 2, "intent"));
            status(409, () -> host.submit("101", seal(), 1, "new-key"));
            assertEquals(original, host.submit("101", seal(), 1, "intent"));
            var normalized = (BusinessDocument.SealUse) original.request().business();
            var equivalent = new BusinessDocument.SealUse(1, normalized.businessId(), "\u0000 " + normalized.title() + "\u001f",
                "\t" + normalized.reason() + "\n", "\u0001" + normalized.documentName() + " ", normalized.documentRef(), normalized.sealType(), normalized.copyCount());
            assertEquals(original, host.submit("101", equivalent, 1, "intent"));
            var changedKey = host.submit("101", seal(), 2, "other-key");
            var otherApplicant = host.submit("404", seal(), 2, "intent");
            assertNotEquals(original.request().id(), changedKey.request().id());
            assertNotEquals(original.request().id(), otherApplicant.request().id());
            assertEquals(2, host.list("101").size()); assertEquals(List.of(otherApplicant), host.list("404"));
        }
        try (var host = host()) {
            assertEquals(2, host.list("101").size());
            assertEquals(original, host.submit("101", seal(), 1, "intent"));
            assertEquals(1, host.list("404").size());
        }
    }

    @Test void keysAreRequiredBoundedAndDoNotBecomeBusinessReferenceUniquenessConstraints() throws Exception {
        try (var host = host()) {
            for (String key : new String[]{null, "", " key", "key ", "_key", "key/1", "k".repeat(129)})
                status(400, () -> host.submit("101", seal(), 1, key));
            assertTrue(host.list("101").isEmpty()); assertFalse(Files.exists(file()));
            var first = host.submit("101", seal(), 1, "K".repeat(128));
            var second = host.submit("101", seal(), 1, "another");
            assertNotEquals(first.request().id(), second.request().id());
            assertEquals(first.request().business(), second.request().business());
        }
    }

    @Test void authorizationPublicationSelfReviewAndInactiveHistoricalReplayRemainStrict() throws Exception {
        try (var host = host()) {
            status(403, () -> host.template("missing")); status(403, () -> host.process("missing"));
            status(403, () -> host.list("missing")); status(403, () -> host.submit("missing", seal(), 1, "key"));
            status(403, () -> host.publish("101", 1, host.process("101")));
            status(400, () -> host.submit("202", seal(), 1, "self"));
            status(400, () -> host.submit("303", seal(), 1, "self"));
            var saved = host.submit("101", seal(), 1, "key");
            status(403, () -> host.decide("101", saved.request().id(), "documentReview", "APPROVE", ""));
            status(404, () -> host.decide("1", saved.request().id(), "documentReview", "APPROVE", ""));
            status(404, () -> host.decide("404", saved.request().id(), "documentReview", "APPROVE", ""));
            status(403, () -> host.decide("303", saved.request().id(), "documentReview", "APPROVE", ""));
            status(409, () -> host.decide("303", saved.request().id(), "sealReview", "APPROVE", "early"));
            actors.active.remove("202");
            status(403, () -> host.decide("202", saved.request().id(), "documentReview", "APPROVE", ""));
            status(400, () -> host.submit("101", seal(), 1, "new"));
            status(400, () -> host.publish("1", 1, host.process("1")));
            assertEquals(saved, host.submit("101", seal(), 1, "key"));
            actors.active.remove("101"); status(403, () -> host.submit("101", seal(), 1, "key"));
            status(403, () -> host.list("101"));
        }
        try (var host = host()) {
            assertEquals(1, host.list("303").size()); // Historical restore never depends on live membership.
            actors.active.addAll(List.of("101", "202"));
            assertEquals(1, host.list("101").size());
        }
    }

    @Test void processAndDocumentTypesAreIsolatedBetweenExpenseAndSealHosts() throws Exception {
        Path expenseFile = dir.resolve("expense.json");
        var expenseEntry = ScenarioCatalog.expense("202", "303");
        try (var sealHost = host(); var expenseService = new ApprovalService(mapper, expenseFile.toString(), actors, expenseEntry.initialProcess());
             var expenseHost = new ScenarioCase(expenseEntry, expenseService, actors)) {
            status(400, () -> sealHost.submit("101", ExpenseScenarioTest.expense(), 1, "wrong"));
            status(400, () -> sealHost.submit("101", new BusinessDocument.Leave("L-1", "Leave", "Rest", 1), 1, "wrong"));
            status(400, () -> expenseHost.submit("101", seal(), 1, "wrong"));
            status(400, () -> sealHost.publish("1", 1, expenseEntry.initialProcess()));
            status(400, () -> expenseHost.publish("1", 1, entry().initialProcess()));
            var seal = sealHost.submit("101", seal(), 1, "same-key");
            var expense = expenseHost.submit("101", ExpenseScenarioTest.expense(), 1, "same-key");
            assertNotEquals(seal.request().id(), expense.request().id()); assertNull(seal.total()); assertEquals("0.30", expense.total());
            status(404, () -> sealHost.decide("202", expense.request().id(), "manager", "APPROVE", ""));
            status(404, () -> expenseHost.decide("202", seal.request().id(), "documentReview", "APPROVE", ""));
            assertThrows(IllegalArgumentException.class, () -> new ScenarioCase(entry(), expenseService, actors));
        }
        byte[] before = Files.readAllBytes(file());
        assertThrows(IOException.class, () -> new ApprovalService(mapper, file().toString(), actors, expenseEntry.initialProcess()));
        assertArrayEquals(before, Files.readAllBytes(file()));
    }

    @Test void concurrentSubmissionRetriesSaveOneRequestAndOneDurableBinding() throws Exception {
        String savedId;
        try (var host = host()) {
            var pool = Executors.newFixedThreadPool(8); var gate = new CountDownLatch(1);
            try {
                var futures = new ArrayList<Future<ScenarioCase.View>>();
                for (int i = 0; i < 8; i++) futures.add(pool.submit(() -> { gate.await(); return host.submit("101", seal(), 1, "race"); }));
                gate.countDown(); var ids = new HashSet<String>();
                for (var future : futures) ids.add(future.get(10, TimeUnit.SECONDS).request().id());
                assertEquals(1, ids.size()); assertEquals(1, host.list("101").size()); savedId = ids.iterator().next();
                assertEquals(1, mapper.readTree(Files.readAllBytes(file())).get("submissions").size());
            } finally { pool.shutdownNow(); }
        }
        try (var host = host()) { assertEquals(savedId, host.submit("101", seal(), 1, "race").request().id()); }
    }

    @Test void allAnyAndOneToEightSequentialStagesExecuteUsingFrozenSealSnapshots() throws Exception {
        for (String mode : List.of("ALL", "ANY")) {
            var prototype = ParallelApprovalTest.definition(mode, false);
            var process = new ProcessDefinition(3, "oa-seal-use", 1, "Synthetic seal group review", prototype.nodes());
            Path path = dir.resolve(mode + ".json");
            try (var service = new ApprovalService(mapper, path.toString(), actors, process)) {
                var request = service.submitDocument("101", seal(), 1, "group");
                var first = service.decide("202", request.id(), "review", "REJECT", "");
                assertEquals(mode.equals("ALL") ? "REJECTED" : "PENDING", first.status());
                if (mode.equals("ANY")) assertEquals("APPROVED", service.decide("303", request.id(), "review", "APPROVE", "").status());
                assertEquals(request.business(), service.list("101").get(0).business());
            }
            try (var service = new ApprovalService(mapper, path.toString(), actors, process)) {
                assertEquals(mode.equals("ALL") ? "REJECTED" : "APPROVED", service.submitDocument("101", seal(), 1, "group").status());
            }
        }
        for (int count = 1; count <= 8; count++) {
            var nodes = new ArrayList<ProcessDefinition.ProcessNode>();
            nodes.add(new ProcessDefinition.ProcessNode("start", "start", "Submit", null));
            for (int step = 0; step < count; step++) nodes.add(new ProcessDefinition.ProcessNode("step" + step, "approval", "Review " + step, "202"));
            nodes.add(new ProcessDefinition.ProcessNode("end", "end", "Review complete", null));
            var process = new ProcessDefinition(2, "oa-seal-use", 1, "Synthetic sequential review", nodes);
            try (var service = new ApprovalService(mapper, dir.resolve("steps-" + count + ".json").toString(), actors, process)) {
                var request = service.submitDocument("101", seal(), 1, "steps"); var current = request;
                for (int step = 0; step < count; step++) current = service.decide("202", request.id(), "step" + step, "APPROVE", "");
                assertEquals("APPROVED", current.status()); assertEquals(count + 1, current.history().size());
                assertEquals(request.business(), current.business()); assertEquals(request.definition(), current.definition());
            }
        }
    }

    private static List<String> fieldNames(com.fasterxml.jackson.databind.JsonNode node) {
        var names = new ArrayList<String>(); node.fieldNames().forEachRemaining(names::add); return names;
    }
}
