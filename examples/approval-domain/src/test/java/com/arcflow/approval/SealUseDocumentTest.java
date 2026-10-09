package com.arcflow.approval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import static org.junit.jupiter.api.Assertions.*;

class SealUseDocumentTest {
    final ObjectMapper mapper = ApprovalService.strictMapper(new ObjectMapper());
    static BusinessDocument.SealUse seal() {
        return new BusinessDocument.SealUse(1, "SEAL-1", " Synthetic seal request ", " Synthetic business purpose ",
            " Synthetic agreement ", "SYNTHETIC:doc/001", "OFFICIAL", 2);
    }
    BusinessDocument.SealUse normalized(String raw) throws IOException {
        BusinessDocument document = mapper.readValue(raw, BusinessDocument.class);
        if (!(document instanceof BusinessDocument.SealUse seal)) throw new IllegalArgumentException("Seal-use document required");
        seal.validate();
        return seal.withText(seal.title().trim(), seal.reason().trim());
    }
    ObjectNode node() { return mapper.valueToTree(seal()); }

    // Copied data-only fixtures retain reviewed contract provenance without a cross-layer dependency.
    @TestFactory Stream<DynamicTest> allReviewedContractVectorsUseRuntimeStrictMapperAndNormalization() throws IOException {
        var tests = new ArrayList<DynamicTest>();
        try (var stream = getClass().getResourceAsStream("/seal-use-vectors.json")) {
            assertNotNull(stream);
            JsonNode vectors = mapper.readTree(stream);
            for (String group : List.of("valid", "invalid")) for (JsonNode vector : vectors.get(group)) {
                tests.add(DynamicTest.dynamicTest(group + ": " + vector.get("name").textValue(), () -> {
                    String raw = vector.get("raw").textValue();
                    if (group.equals("invalid")) assertInvalid(() -> normalized(raw));
                    else {
                        var value = normalized(raw);
                        assertEquals(mapper.readTree(vector.get("canonical").textValue()), mapper.valueToTree(value));
                        assertEquals(value, normalized(mapper.writeValueAsString(value)));
                    }
                }));
            }
        }
        assertEquals(65, tests.size());
        return tests.stream();
    }

    @TestFactory Stream<DynamicTest> everyRequiredFieldRejectsMissingNullAndUnexpectedScalarKinds() {
        var tests = new ArrayList<DynamicTest>();
        for (String field : List.of("documentVersion", "businessId", "title", "reason", "documentName", "documentRef", "sealType", "copyCount")) {
            for (String invalid : List.of("missing", "null", "true", "{}", "[]")) {
                tests.add(DynamicTest.dynamicTest(field + ": " + invalid, () -> {
                    var bad = node();
                    if (invalid.equals("missing")) bad.remove(field); else bad.set(field, mapper.readTree(invalid));
                    assertInvalid(() -> normalized(bad.toString()));
                }));
            }
        }
        for (String field : List.of("businessId", "title", "reason", "documentName", "documentRef", "sealType")) {
            for (String invalid : List.of("1", "1.0")) tests.add(DynamicTest.dynamicTest(field + ": " + invalid, () -> {
                var bad = node(); bad.set(field, mapper.readTree(invalid));
                assertThrows(IOException.class, () -> mapper.readValue(bad.toString(), BusinessDocument.class));
            }));
        }
        for (String field : List.of("documentVersion", "copyCount")) {
            for (String invalid : List.of("1.0", "1e0", "1E+2", "\"1\"", "\"\"", "0", "-1", "2147483648", "999999999999999999999999999"))
                tests.add(DynamicTest.dynamicTest(field + ": " + invalid, () -> {
                    String raw = node().toString().replace("\"" + field + "\":" + (field.equals("copyCount") ? "2" : "1"), "\"" + field + "\":" + invalid);
                    assertInvalid(() -> normalized(raw));
                }));
        }
        return tests.stream();
    }

    @TestFactory Stream<DynamicTest> textBoundsAndFixedWhitespaceRulesDoNotDriftFromContract() {
        var tests = new ArrayList<DynamicTest>();
        List<Integer> blanks = new ArrayList<>();
        for (int cp = 0; cp <= 0x20; cp++) blanks.add(cp);
        blanks.addAll(List.of(0x85, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF));
        for (int cp = 0x2000; cp <= 0x200A; cp++) blanks.add(cp);
        for (var field : Map.of("title", 120, "reason", 2000, "documentName", 160).entrySet()) {
            String key = field.getKey(); int max = field.getValue();
            tests.add(DynamicTest.dynamicTest(key + ": raw UTF-16 limit and preserved unicode edges", () -> {
                var good = node().put(key, "🙂".repeat(max / 2));
                assertEquals(good.get(key), mapper.valueToTree(normalized(good.toString())).get(key));
                for (String value : List.of("x".repeat(max + 1), " " + "x".repeat(max), "🙂".repeat(max / 2) + "x", ""))
                    assertThrows(IllegalArgumentException.class, () -> normalized(node().put(key, value).toString()));
                assertEquals("Text", mapper.valueToTree(normalized(node().put(key, "\u0000\t Text \r\u001f").toString())).get(key).textValue());
                String unchanged = "\u00a0\ufeffText\u3000";
                assertEquals(unchanged, mapper.valueToTree(normalized(node().put(key, unchanged).toString())).get(key).textValue());
                String zeroWidthContent = "\u200b"; // Outside the specified fixed whitespace set.
                assertEquals(zeroWidthContent, mapper.valueToTree(normalized(node().put(key, zeroWidthContent).toString())).get(key).textValue());
            }));
            for (int cp : blanks) tests.add(DynamicTest.dynamicTest(key + ": blank U+" + Integer.toHexString(cp), () -> {
                String value = " \u0000" + Character.toString(cp) + "\ufeff\u00a0 ";
                assertThrows(IllegalArgumentException.class, () -> normalized(node().put(key, value).toString()));
            }));
        }
        return tests.stream();
    }

    private static void assertInvalid(org.junit.jupiter.api.function.Executable action) {
        Exception failure = assertThrows(Exception.class, action);
        assertTrue(failure instanceof IOException || failure instanceof IllegalArgumentException, failure.toString());
    }

    @Test void referencesAndSyntheticChoicesAreExactAndAllCountsAreBounded() throws Exception {
        for (String field : List.of("businessId", "documentRef")) {
            for (String value : List.of("a", "0", "A:._/-9", "a".repeat(128)))
                assertEquals(value, mapper.valueToTree(normalized(node().put(field, value).toString())).get(field).textValue());
            for (String value : List.of("", " a", "a ", "a".repeat(129), "/a", "_a", ".a", ":a", "-a", "中文", "a?b", "a#b", "a@b", "a\\b", "a\nb"))
                assertThrows(IllegalArgumentException.class, () -> normalized(node().put(field, value).toString()), value);
        }
        for (String value : List.of("OFFICIAL", "CONTRACT", "FINANCE"))
            assertEquals(value, normalized(node().put("sealType", value).toString()).sealType());
        for (String value : List.of("official", "Official", " OFFICIAL", "OFFICIAL ", "", "REAL_STAMP"))
            assertThrows(IllegalArgumentException.class, () -> normalized(node().put("sealType", value).toString()));
        for (int count = 1; count <= 100; count++) assertEquals(count, normalized(node().put("copyCount", count).toString()).copyCount());
        for (int count : new int[]{Integer.MIN_VALUE, -1, 0, 101, Integer.MAX_VALUE})
            assertThrows(IllegalArgumentException.class, () -> normalized(node().put("copyCount", count).toString()));
        for (int version : new int[]{Integer.MIN_VALUE, -1, 0, 2, Integer.MAX_VALUE})
            assertThrows(IllegalArgumentException.class, () -> normalized(node().put("documentVersion", version).toString()));
    }

    @Test void objectsCannotSupplyDerivedFieldsOrDuplicateKeysOrExtraValues() throws Exception {
        for (String field : List.of("total", "amount", "currency", "lines", "purpose", "summary", "applicantId", "status", "processId", "processVersion", "documentUrl", "signatureUrl", "intentFingerprint"))
            assertThrows(IOException.class, () -> normalized(node().putNull(field).toString()), field);
        String raw = node().toString();
        for (String duplicate : List.of("\"type\":\"sealUse\"", "\"copyCount\":2", "\"documentVersion\":1", "\"documentRef\":\"OTHER\"", "\"t\\u0069tle\":\"Other\""))
            assertThrows(IOException.class, () -> normalized(raw.substring(0, raw.length() - 1) + "," + duplicate + "}"));
        for (String trailing : List.of("{}", "[]", "null", "true", "1", "\"x\""))
            assertThrows(IOException.class, () -> normalized(raw + " " + trailing));
        for (String invalid : List.of("null", "[]", "true", "1", "\"x\"")) assertInvalid(() -> normalized(invalid));
    }
}
