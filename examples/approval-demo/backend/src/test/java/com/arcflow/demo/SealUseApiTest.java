package com.arcflow.demo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Synthetic approval intent only. These tests never apply a seal, sign or retrieve a document. */
@SpringBootTest(properties={"APPROVAL_ALICE_PASSWORD=test-alice-password", "APPROVAL_BOB_PASSWORD=test-bob-password", "APPROVAL_CAROL_PASSWORD=test-carol-password"})
@AutoConfigureMockMvc
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class SealUseApiTest {
    private static final String BASE = "/api/scenarios/oa-seal-use";
    private static final String EXPENSE = "/api/scenarios/oa-expense";
    private static final Set<String> BUSINESS_FIELDS = Set.of("type", "documentVersion", "businessId", "title", "reason",
        "documentName", "documentRef", "sealType", "copyCount");
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @DynamicPropertySource static void data(DynamicPropertyRegistry registry) throws Exception {
        var file = Files.createTempDirectory("seal-use-api-test-").resolve("state.json");
        registry.add("approval.data-file", file::toString);
    }

    private ObjectNode input() throws Exception {
        return (ObjectNode) mapper.readTree("""
            {"business":{"type":"sealUse","documentVersion":1,"businessId":"SEAL-DEMO-001",
             "title":"Synthetic seal-use request","reason":"Review synthetic delivery documents only",
             "documentName":"Synthetic delivery statement","documentRef":"DEMO-DOC-001","sealType":"OFFICIAL","copyCount":2},"processVersion":1}
            """);
    }
    private ObjectNode expense() throws Exception {
        return (ObjectNode) mapper.readTree("""
            {"business":{"type":"expense","documentVersion":1,"businessId":"EXP-SEAL-CONTROL","title":"Expense isolation control",
             "reason":"Synthetic receipt only","costCenter":"ENGINEERING","currency":"CNY","lines":[
             {"lineId":"line-1","spentOn":"2026-10-01","category":"OFFICE","description":"Demo stationery","amount":0.10,"receiptRef":"R-DEMO-001"}]},"processVersion":1}
            """);
    }
    private ObjectNode business(ObjectNode body) { return (ObjectNode) body.get("business"); }
    private MockHttpServletRequestBuilder write(String path, String actor) {
        return post(path).with(httpBasic(actor, "test-" + actor + "-password"))
            .header("X-Arcflow-Client", "approval-demo").contentType("application/json");
    }
    private JsonNode result(ResultActions action) throws Exception {
        return mapper.readTree(action.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }
    private JsonNode read(String path, String actor) throws Exception {
        return result(mvc.perform(get(path).with(httpBasic(actor, "test-" + actor + "-password"))).andExpect(status().isOk()));
    }
    private ResultActions submit(String body, String key) throws Exception {
        return mvc.perform(write(BASE + "/documents", "alice").header("Idempotency-Key", key).content(body));
    }
    private ResultActions decide(String route, String actor, String id, String step, String decision) throws Exception {
        return mvc.perform(write(route + "/requests/" + id + "/decisions", actor)
            .content(mapper.createObjectNode().put("stepId", step).put("decision", decision)
                .put("comment", "Synthetic review only").toString()));
    }
    private ResultActions decide(String actor, String id, String step, String decision) throws Exception {
        return decide(BASE, actor, id, step, decision);
    }
    private ObjectNode publication(JsonNode definition, int expected) {
        var body = mapper.createObjectNode().put("expectedVersion", expected);
        body.set("definition", definition);
        return body;
    }
    private static Set<String> fields(JsonNode node) {
        var names = new HashSet<String>(); node.fieldNames().forEachRemaining(names::add); return names;
    }
    private static void assertSealView(JsonNode view) {
        assertEquals(Set.of("request", "total"), fields(view));
        assertTrue(view.has("total") && view.get("total").isNull(), "Non-monetary total must be explicitly null");
        var request = view.path("request"); var business = request.path("business");
        assertEquals(BUSINESS_FIELDS, fields(business));
        assertEquals("sealUse", business.path("type").asText());
        assertTrue(business.path("copyCount").isIntegralNumber());
        assertEquals("oa-seal-use", request.path("processId").asText());
        assertEquals(0, request.path("days").asInt());
        for (String field : List.of("amount", "currency", "total", "unitPrice", "lines"))
            assertFalse(request.has(field), "Unexpected financial request field: " + field);
    }

    @Test void catalogAndAuthenticatedTwoStageApprovalKeepExactNonMonetaryViews() throws Exception {
        var catalog = read("/api/scenarios", "alice");
        assertEquals(2, catalog.size());
        assertEquals("oa-expense", catalog.get(0).path("id").asText());
        assertEquals("oa-seal-use", catalog.get(1).path("id").asText());
        assertEquals(20, catalog.get(0).path("lineItems").path("maxItems").asInt());
        var template = catalog.get(1);
        assertEquals("sealUse", template.path("documentType").asText());
        assertEquals(1, template.path("documentVersion").asInt());
        assertEquals(1, template.path("formVersion").asInt());
        assertTrue(template.has("lineItems") && template.get("lineItems").isNull());
        var paths = new HashSet<String>();
        for (JsonNode section : template.path("sections")) for (JsonNode field : section.path("fields")) {
            assertTrue(paths.add(field.path("path").asText()), "Form fields must not be duplicated");
            if ("copyCount".equals(field.path("path").asText())) {
                assertEquals("integer", field.path("kind").asText()); assertEquals(16, field.path("maxLength").asInt());
            }
        }
        assertEquals(Set.of("businessId", "title", "reason", "documentName", "documentRef", "sealType", "copyCount"), paths);
        var definition = read(BASE + "/process", "alice");
        assertEquals(2, definition.path("schemaVersion").asInt());
        assertEquals("documentReview", definition.path("nodes").get(1).path("id").asText());
        assertEquals("bob", definition.path("nodes").get(1).path("assigneeId").asText());
        assertEquals("sealReview", definition.path("nodes").get(2).path("id").asText());
        assertEquals("carol", definition.path("nodes").get(2).path("assigneeId").asText());
        var created = result(submit(input().toString(), "seal-happy").andExpect(status().isCreated()));
        assertSealView(created); String id = created.path("request").path("id").asText();
        assertEquals("alice", created.path("request").path("applicantId").asText());
        assertEquals("PENDING", created.path("request").path("status").asText());
        assertEquals("documentReview", created.path("request").path("currentStepId").asText());
        assertEquals(created, result(submit(input().toString(), "seal-happy").andExpect(status().isCreated())));
        decide("alice", id, "documentReview", "APPROVE").andExpect(status().isForbidden());
        decide("carol", id, "documentReview", "APPROVE").andExpect(status().isForbidden());
        decide("carol", id, "sealReview", "APPROVE").andExpect(status().isConflict());
        decide("bob", id, "missingStep", "APPROVE").andExpect(status().isConflict());
        var intermediate = result(decide("bob", id, "documentReview", "APPROVE").andExpect(status().isOk()));
        assertSealView(intermediate);
        assertEquals("PENDING", intermediate.path("request").path("status").asText());
        assertEquals("sealReview", intermediate.path("request").path("currentStepId").asText());
        assertEquals("carol", intermediate.path("request").path("approverId").asText());
        assertEquals(intermediate, result(decide("bob", id, "documentReview", "APPROVE").andExpect(status().isOk())));
        var approved = result(decide("carol", id, "sealReview", "APPROVE").andExpect(status().isOk()));
        assertSealView(approved);
        assertEquals("APPROVED", approved.path("request").path("status").asText());
        assertTrue(approved.path("request").path("currentStepId").isNull());
        assertEquals(3, approved.path("request").path("history").size());
        assertEquals(created.path("request").path("business"), approved.path("request").path("business"));
        assertEquals(definition, approved.path("request").path("definition"));
        assertEquals(approved, result(submit(input().toString(), "seal-happy").andExpect(status().isCreated())));
        assertEquals(approved, result(decide("bob", id, "documentReview", "APPROVE").andExpect(status().isOk())));
        assertEquals(approved, result(decide("carol", id, "sealReview", "APPROVE").andExpect(status().isOk())));
        decide("carol", id, "sealReview", "REJECT").andExpect(status().isConflict());
        for (String actor : List.of("alice", "bob", "carol")) assertEquals(approved, read(BASE + "/requests", actor).get(0));
    }

    @Test void eitherReviewCanRejectAndTerminalReplayNeverAddsOrChangesVotes() throws Exception {
        for (boolean secondStage : List.of(false, true)) {
            String key = "seal-reject-" + secondStage;
            var created = result(submit(input().toString(), key).andExpect(status().isCreated()));
            String id = created.path("request").path("id").asText();
            if (secondStage) decide("bob", id, "documentReview", "APPROVE").andExpect(status().isOk());
            String actor = secondStage ? "carol" : "bob", step = secondStage ? "sealReview" : "documentReview";
            var rejected = result(decide(actor, id, step, "REJECT").andExpect(status().isOk()));
            assertSealView(rejected); assertEquals("REJECTED", rejected.path("request").path("status").asText());
            assertEquals(secondStage ? 3 : 2, rejected.path("request").path("history").size());
            assertTrue(rejected.path("request").path("currentStepId").isNull());
            assertEquals(created.path("request").path("business"), rejected.path("request").path("business"));
            assertEquals(rejected, result(submit(input().toString(), key).andExpect(status().isCreated())));
            assertEquals(rejected, result(decide(actor, id, step, "REJECT").andExpect(status().isOk())));
            decide(actor, id, step, "APPROVE").andExpect(status().isConflict());
            if (!secondStage) decide("carol", id, "sealReview", "APPROVE").andExpect(status().isConflict());
        }
        assertEquals(2, read(BASE + "/requests", "alice").size(), "Business/document references are not unique constraints");
    }

    @Test void authenticatedPrincipalKeysAndBrowserWriteBoundaryFailClosed() throws Exception {
        for (String path : List.of("/api/scenarios", BASE + "/process", BASE + "/requests")) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
            mvc.perform(get(path).with(user("mallory"))).andExpect(status().isForbidden());
        }
        mvc.perform(post(BASE + "/documents").header("X-Arcflow-Client", "approval-demo")
            .header("Idempotency-Key", "auth").contentType("application/json").content(input().toString())).andExpect(status().isUnauthorized());
        mvc.perform(post(BASE + "/documents").with(user("mallory")).header("X-Arcflow-Client", "approval-demo")
            .header("Idempotency-Key", "auth").contentType("application/json").content(input().toString())).andExpect(status().isForbidden());
        mvc.perform(post(BASE + "/documents").with(httpBasic("alice", "test-alice-password"))
            .header("Idempotency-Key", "auth").contentType("application/json").content(input().toString())).andExpect(status().isForbidden());
        mvc.perform(write(BASE + "/documents", "alice").header("Idempotency-Key", "auth")
            .header("Origin", "https://attacker.example").content(input().toString())).andExpect(status().isForbidden());
        mvc.perform(write(BASE + "/documents", "alice").header("Idempotency-Key", "auth")
            .header("Sec-Fetch-Site", "cross-site").content(input().toString())).andExpect(status().isForbidden());
        mvc.perform(write(BASE + "/documents", "alice").content(input().toString())).andExpect(status().isBadRequest());
        mvc.perform(write(BASE + "/documents", "alice").header("Idempotency-Key", "same", "same")
            .content(input().toString())).andExpect(status().isBadRequest());
        mvc.perform(write(BASE + "/documents", "alice").header("Idempotency-Key", "one", "two")
            .content(input().toString())).andExpect(status().isBadRequest());
        for (String key : List.of("", " ", "a,b", "a, a", " a", "a ", "_a", "a/b", "用印", "a".repeat(129)))
            submit(input().toString(), key).andExpect(status().isBadRequest());
        for (String actor : List.of("bob", "carol")) mvc.perform(write(BASE + "/documents", actor)
            .header("Idempotency-Key", "auth").content(input().toString())).andExpect(status().isBadRequest());
        assertEquals(0, read(BASE + "/requests", "alice").size());
        var valid = result(submit(input().toString(), "a".repeat(128)).andExpect(status().isCreated()));
        assertEquals("alice", valid.path("request").path("applicantId").asText());
    }

    @Test void everyRawIntegerTokenAndMandatoryBusinessShapeIsStrict() throws Exception {
        for (String field : List.of("copyCount", "documentVersion", "processVersion")) {
            int original = field.equals("copyCount") ? 2 : 1;
            for (String raw : List.of("1.0", "1e0", "\"1\"", "true", "false", "null", "0", "-1", "1.5", "2147483648", "{}", "[]", "\"\"")) {
                String body = input().toString().replace("\"" + field + "\":" + original, "\"" + field + "\":" + raw);
                submit(body, "invalid-integer").andExpect(status().isBadRequest());
            }
        }
        var tooMany = input(); business(tooMany).put("copyCount", 101);
        submit(tooMany.toString(), "invalid-count").andExpect(status().isBadRequest());
        var wrongVersion = input(); business(wrongVersion).put("documentVersion", 2);
        submit(wrongVersion.toString(), "invalid-version").andExpect(status().isBadRequest());
        for (String field : BUSINESS_FIELDS) {
            var missing = input(); business(missing).remove(field);
            submit(missing.toString(), "missing-field").andExpect(status().isBadRequest());
            var nil = input(); business(nil).putNull(field);
            submit(nil.toString(), "null-field").andExpect(status().isBadRequest());
        }
        for (String field : List.of("business", "processVersion")) {
            var missing = input(); missing.remove(field);
            submit(missing.toString(), "missing-envelope").andExpect(status().isBadRequest());
            var nil = input(); nil.putNull(field);
            submit(nil.toString(), "null-envelope").andExpect(status().isBadRequest());
        }
        for (String raw : List.of("[]", "true", "1", "\"sealUse\"")) {
            var body = input(); body.set("business", mapper.readTree(raw));
            submit(body.toString(), "not-object").andExpect(status().isBadRequest());
        }
        for (String raw : List.of("[]", "null", "true", input().toString() + " {}", input().toString() + " null"))
            submit(raw, "invalid-json").andExpect(status().isBadRequest());
        for (String field : List.of("type", "documentVersion", "copyCount", "documentRef")) {
            String token = "\"" + field + "\":" + business(input()).get(field);
            String duplicate = input().toString().replace(token, token + "," + token);
            submit(duplicate, "duplicate-json").andExpect(status().isBadRequest());
        }
        submit(input().toString().replace("\"processVersion\":1", "\"processVersion\":1,\"processVersion\":1"), "duplicate-json")
            .andExpect(status().isBadRequest());
        assertEquals(0, read(BASE + "/requests", "alice").size());
        for (int copies : List.of(1, 100)) {
            var body = input(); business(body).put("copyCount", copies);
            var view = result(submit(body.toString(), "boundary-" + copies).andExpect(status().isCreated()));
            assertSealView(view); assertEquals(copies, view.path("request").path("business").path("copyCount").asInt());
        }
    }

    @Test void rawSubmissionLimitCountsTheFullEnvelopeInUtf16AndRejectsMediaTypeFallback() throws Exception {
        var body = input();
        business(body).put("title", "\uD83D\uDE00".repeat(60));
        String raw = body.toString();
        assertTrue(raw.contains("\uD83D\uDE00"), "Keep raw non-BMP characters in the transport boundary fixture");
        int limit = 8_000_000;
        String atLimit = raw + " ".repeat(limit - raw.length());
        assertEquals(limit, atLimit.length());
        assertTrue(atLimit.getBytes(StandardCharsets.UTF_8).length > limit,
            "UTF-16 units, UTF-8 bytes and Unicode code points are different bounds");
        var accepted = result(submit(atLimit, "raw-limit").andExpect(status().isCreated()));
        assertSealView(accepted);
        assertEquals("\uD83D\uDE00".repeat(60), accepted.path("request").path("business").path("title").asText());
        submit(atLimit + " ", "raw-limit").andExpect(status().isBadRequest());
        assertEquals(accepted, result(submit(raw, "raw-limit").andExpect(status().isCreated())));
        for (String mediaType : List.of("application/vnd.arcflow+json", "application/problem+json", "text/plain")) {
            mvc.perform(write(BASE + "/documents", "alice").contentType(mediaType)
                .header("Idempotency-Key", "media-fallback").content(input().toString())).andExpect(status().isUnsupportedMediaType())
                .andExpect(content().contentTypeCompatibleWith("application/json"));
        }
        mvc.perform(write(BASE + "/documents", "alice").contentType("text/plain")
            .header("Idempotency-Key", "media-error-body").content(input().toString()))
            .andExpect(status().isUnsupportedMediaType()).andExpect(jsonPath("$.message").value("Unsupported Content-Type"))
            .andExpect(result -> assertNull(result.getResponse().getErrorMessage(), "Media errors must not call sendError and redispatch to /error"));
        mvc.perform(post(BASE + "/documents").header("X-Arcflow-Client", "approval-demo").contentType("text/plain")
            .content(input().toString())).andExpect(status().isUnauthorized());
        mvc.perform(post(BASE + "/documents").with(httpBasic("alice", "test-alice-password")).contentType("text/plain")
            .content(input().toString())).andExpect(status().isForbidden());
        for (String malformed : List.of("", " ", "null", "{}", "{\"business\":", "\"not-an-envelope\""))
            submit(malformed, "malformed-raw").andExpect(status().isBadRequest());
        var missingBusiness = input(); missingBusiness.putNull("business");
        submit(missingBusiness.toString(), "null-business").andExpect(status().isBadRequest());
        assertEquals(1, read(BASE + "/requests", "alice").size());
    }

    @Test void malformedUtf8CannotBeReplacedSilentlyInsideBusinessText() throws Exception {
        // StringHttpMessageConverter replacement would otherwise turn malformed bytes into accepted U+FFFD intent.
        List<byte[]> invalidSequences = List.of(new byte[]{(byte) 0xff}, new byte[]{(byte) 0x80},
            new byte[]{(byte) 0xc3, 0x28}, new byte[]{(byte) 0xc0, (byte) 0xaf},
            new byte[]{(byte) 0xed, (byte) 0xa0, (byte) 0x80},
            new byte[]{(byte) 0xf4, (byte) 0x90, (byte) 0x80, (byte) 0x80}, new byte[]{(byte) 0xc3});
        for (String field : List.of("title", "reason", "documentName")) {
            var body = input(); business(body).put(field, "UTF8_MARKER");
            String raw = body.toString(); int marker = raw.indexOf("UTF8_MARKER");
            for (byte[] invalid : invalidSequences) {
                var encoded = new ByteArrayOutputStream();
                encoded.writeBytes(raw.substring(0, marker).getBytes(StandardCharsets.UTF_8));
                encoded.writeBytes(invalid);
                encoded.writeBytes(raw.substring(marker + "UTF8_MARKER".length()).getBytes(StandardCharsets.UTF_8));
                mvc.perform(write(BASE + "/documents", "alice").header("Idempotency-Key", "invalid-utf8")
                    .content(encoded.toByteArray())).andExpect(status().isBadRequest());
            }
        }
        assertEquals(0, read(BASE + "/requests", "alice").size());
        assertSealView(result(submit(input().toString(), "invalid-utf8").andExpect(status().isCreated())));
    }

    @Test void fieldBoundsNormalizationAndSpoofedDerivedValuesFailClosed() throws Exception {
        for (String field : List.of("businessId", "documentRef")) for (String invalid : List.of("", " a", "a ", "_a", "-a", "a b", "a?b", "a#b", "a\\b", "文档", "a".repeat(129))) {
            var body = input(); business(body).put(field, invalid);
            submit(body.toString(), "invalid-reference").andExpect(status().isBadRequest());
        }
        var textBounds = Map.of("title", 120, "reason", 2000, "documentName", 160);
        for (var field : textBounds.entrySet()) {
            for (String invalid : List.of("", " \t\n", "\u0000", "\u0085", "\u00a0", "\u1680\u2000\u200a\u2028\u2029\u202f\u205f\u3000\ufeff", "x".repeat(field.getValue() + 1), "x".repeat(field.getValue()) + " ")) {
                var body = input(); business(body).put(field.getKey(), invalid);
                submit(body.toString(), "invalid-text").andExpect(status().isBadRequest());
            }
        }
        for (String field : List.of("businessId", "title", "reason", "documentName", "documentRef", "sealType")) for (String raw : List.of("1", "true", "[]", "{}")) {
            var body = input(); business(body).set(field, mapper.readTree(raw));
            submit(body.toString(), "scalar-coercion").andExpect(status().isBadRequest());
        }
        for (String invalid : List.of("", "official", " Official ", "OFFICIAL ", "PERSONAL")) {
            var body = input(); business(body).put("sealType", invalid);
            submit(body.toString(), "invalid-seal").andExpect(status().isBadRequest());
        }
        for (String field : List.of("applicantId", "approverId", "actorId", "processId", "status", "definition", "currentStepId", "total", "purpose", "currency", "amount", "unitPrice", "lines", "days", "attachment", "sealImage", "signature")) {
            var outer = input(); outer.put(field, "forged");
            submit(outer.toString(), "spoofed-envelope").andExpect(status().isBadRequest());
            var inner = input(); business(inner).put(field, "forged");
            submit(inner.toString(), "spoofed-business").andExpect(status().isBadRequest());
        }
        assertEquals(0, read(BASE + "/requests", "alice").size());
        var edge = input();
        for (var bound : textBounds.entrySet()) business(edge).put(bound.getKey(), "x".repeat(bound.getValue()));
        business(edge).put("businessId", "A" + "a".repeat(127));
        business(edge).put("documentRef", "Z" + "._:/-".repeat(25) + "xy");
        assertSealView(result(submit(edge.toString(), "valid-maxima").andExpect(status().isCreated())));
        var minimal = input();
        for (String field : List.of("businessId", "documentRef", "title", "reason", "documentName")) business(minimal).put(field, "A");
        assertSealView(result(submit(minimal.toString(), "a").andExpect(status().isCreated())));
        var supplementary = input();
        for (var bound : textBounds.entrySet()) business(supplementary).put(bound.getKey(), "\uD83D\uDE00".repeat(bound.getValue() / 2));
        assertSealView(result(submit(supplementary.toString(), "utf16-maxima").andExpect(status().isCreated())));
        for (var bound : textBounds.entrySet()) {
            var over = input(); business(over).put(bound.getKey(), "\uD83D\uDE00".repeat(bound.getValue() / 2) + "A");
            submit(over.toString(), "utf16-overflow").andExpect(status().isBadRequest());
        }
        for (String seal : List.of("OFFICIAL", "CONTRACT", "FINANCE")) {
            var body = input(); business(body).put("sealType", seal);
            business(body).put("title", "\u0000 \tSynthetic seal-use request\r\n");
            business(body).put("reason", " Review synthetic delivery documents only ");
            business(body).put("documentName", "\tSynthetic delivery statement\n");
            var view = result(submit(body.toString(), "normalize-" + seal).andExpect(status().isCreated()));
            assertEquals("Synthetic delivery statement", view.path("request").path("business").path("documentName").asText());
            var normalized = input(); business(normalized).put("sealType", seal);
            assertEquals(view, result(submit(normalized.toString(), "normalize-" + seal).andExpect(status().isCreated())));
        }
        var unicode = input(); business(unicode).put("documentName", "\u00a0Synthetic\ufeff");
        assertEquals("\u00a0Synthetic\ufeff", result(submit(unicode.toString(), "preserved-unicode").andExpect(status().isCreated()))
            .path("request").path("business").path("documentName").asText());
    }

    @Test void publicationPinsSnapshotsAndEveryChangedNormalizedIntentConflicts() throws Exception {
        var original = result(submit(input().toString(), "seal-pinned").andExpect(status().isCreated()));
        String id = original.path("request").path("id").asText();
        var definition = (ObjectNode) original.path("request").path("definition").deepCopy();
        for (String wrongId : List.of("oa-expense", "leave-approval", "quote-discount", "oa-travel")) {
            var wrong = definition.deepCopy(); wrong.put("id", wrongId);
            mvc.perform(write(BASE + "/process", "alice").content(publication(wrong, 1).toString())).andExpect(status().isBadRequest());
        }
        assertEquals(definition, read(BASE + "/process", "alice"));
        var next = definition.deepCopy(); next.put("name", "Updated synthetic seal review");
        ((ObjectNode) next.path("nodes").get(1)).put("name", "Updated document-review label");
        for (String actor : List.of("bob", "carol")) mvc.perform(write(BASE + "/process", actor)
            .content(publication(next, 1).toString())).andExpect(status().isForbidden());
        var published = result(mvc.perform(write(BASE + "/process", "alice").content(publication(next, 1).toString())).andExpect(status().isOk()));
        var expected = next.deepCopy(); expected.put("version", 2); assertEquals(expected, published);
        mvc.perform(write(BASE + "/process", "alice").content(publication(next, 1).toString())).andExpect(status().isConflict());
        submit(input().toString(), "stale-new").andExpect(status().isConflict());
        assertEquals(original, result(submit(input().toString(), "seal-pinned").andExpect(status().isCreated())));
        for (var field : Map.of("businessId", "SEAL-DEMO-002", "title", "Changed title", "reason", "Changed purpose",
                "documentName", "Changed document", "documentRef", "DEMO-DOC-002", "sealType", "CONTRACT").entrySet()) {
            var changed = input(); business(changed).put(field.getKey(), field.getValue());
            submit(changed.toString(), "seal-pinned").andExpect(status().isConflict());
        }
        var copies = input(); business(copies).put("copyCount", 3);
        submit(copies.toString(), "seal-pinned").andExpect(status().isConflict());
        var version = input(); version.put("processVersion", 2);
        submit(version.toString(), "seal-pinned").andExpect(status().isConflict());
        var newRequest = result(submit(version.toString(), "seal-version-two").andExpect(status().isCreated()));
        assertEquals(published, newRequest.path("request").path("definition"));
        decide("bob", id, "documentReview", "APPROVE").andExpect(status().isOk());
        var done = result(decide("carol", id, "sealReview", "APPROVE").andExpect(status().isOk()));
        assertEquals(definition, done.path("request").path("definition"));
        assertEquals(1, done.path("request").path("processVersion").asInt());
        assertEquals(original.path("request").path("business"), done.path("request").path("business"));
        assertEquals(done, result(submit(input().toString(), "seal-pinned").andExpect(status().isCreated())));
    }

    @Test void applicantKeyScopeAndHistoricalParticipantVisibilityUseThePrincipal() throws Exception {
        var alice = result(submit(input().toString(), "same-applicant-key").andExpect(status().isCreated()));
        var definition = (ObjectNode) read(BASE + "/process", "alice");
        ((ObjectNode) definition.path("nodes").get(1)).put("assigneeId", "carol");
        mvc.perform(write(BASE + "/process", "alice").content(publication(definition, 1).toString())).andExpect(status().isOk());
        var body = input(); body.put("processVersion", 2);
        var bob = result(mvc.perform(write(BASE + "/documents", "bob").header("Idempotency-Key", "same-applicant-key")
            .content(body.toString())).andExpect(status().isCreated()));
        assertEquals("bob", bob.path("request").path("applicantId").asText());
        assertNotEquals(alice.path("request").path("id"), bob.path("request").path("id"));
        assertEquals(1, read(BASE + "/requests", "alice").size());
        assertEquals(2, read(BASE + "/requests", "bob").size(), "Bob retains visibility as the original request's snapshotted reviewer");
        decide("alice", bob.path("request").path("id").asText(), "documentReview", "APPROVE").andExpect(status().isNotFound());
        assertEquals(alice, result(submit(input().toString(), "same-applicant-key").andExpect(status().isCreated())));
        assertEquals(bob, result(mvc.perform(write(BASE + "/documents", "bob").header("Idempotency-Key", "same-applicant-key")
            .content(body.toString())).andExpect(status().isCreated())));
    }

    @Test void typedHostsRequestIdsAndCompiledScenarioRoutesStayIsolated() throws Exception {
        var seal = result(submit(input().toString(), "shared-local-key").andExpect(status().isCreated()));
        String sealId = seal.path("request").path("id").asText();
        assertEquals(0, read(EXPENSE + "/requests", "alice").size());
        assertEquals(0, read("/api/requests", "alice").size());
        assertEquals(0, read("/api/crm/requests", "alice").size());
        assertEquals(0, read("/api/requests/inbox?box=PENDING", "bob").path("items").size());
        assertEquals(0, read("/api/requests/inbox?box=HANDLED", "carol").path("items").size());
        for (String route : List.of(EXPENSE, "/api", "/api/crm")) {
            mvc.perform(write(route + "/documents", "alice").content(input().toString())).andExpect(status().isBadRequest());
            decide(route, "bob", sealId, "documentReview", "APPROVE").andExpect(status().isNotFound());
        }
        // Include a valid key at the other scenario, so type rejection cannot be masked by the header check.
        mvc.perform(write(EXPENSE + "/documents", "alice").header("Idempotency-Key", "wrong-host")
            .content(input().toString())).andExpect(status().isBadRequest());
        submit(expense().toString(), "wrong-type").andExpect(status().isBadRequest());
        for (String type : List.of("leave", "procurement", "quoteDiscount", "travel", "sealuse", "unknown")) {
            var body = input(); business(body).put("type", type);
            submit(body.toString(), "wrong-type").andExpect(status().isBadRequest());
        }
        var expense = result(mvc.perform(write(EXPENSE + "/documents", "alice").header("Idempotency-Key", "shared-local-key")
            .content(expense().toString())).andExpect(status().isCreated()));
        assertEquals("0.10", expense.path("total").asText());
        assertEquals("expense", expense.path("request").path("business").path("type").asText());
        decide("bob", expense.path("request").path("id").asText(), "manager", "APPROVE").andExpect(status().isNotFound());
        assertEquals(1, read(BASE + "/requests", "alice").size());
        assertEquals(1, read(EXPENSE + "/requests", "alice").size());
        for (String route : List.of("oa-travel", "oa-seal", "not-registered", "state.json", "oa-seal-use.json")) {
            mvc.perform(get("/api/scenarios/" + route + "/process").with(httpBasic("alice", "test-alice-password"))).andExpect(status().isNotFound());
            mvc.perform(write("/api/scenarios/" + route + "/documents", "alice").header("Idempotency-Key", "unknown-route")
                .content(input().toString())).andExpect(status().isNotFound());
        }
        for (String path : List.of("/api/scenarios/..%2Foa-seal-use/process", "/api/scenarios/oa-seal-use%2F..%2Foa-expense/process"))
            mvc.perform(get(path).with(httpBasic("alice", "test-alice-password"))).andExpect(status().is4xxClientError());
    }
}
