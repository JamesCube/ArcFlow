package com.arcflow.contracts.sealuse;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

class SealUseCodecTest {
    private static final Map<String, String> BASE = base();
    private static final String RAW = json(BASE);
    private static final List<String> TEXT_FIELDS = List.of("title", "reason", "documentName");
    private static final List<String> STRING_FIELDS = List.of("type", "businessId", "title", "reason", "documentName", "documentRef", "sealType");

    @Test void canonicalRoundTripHasExactlyNineBusinessFields() {
        SealUseContract decoded = SealUseCodec.decode(RAW);
        assertEquals(RAW, SealUseCodec.encode(decoded));
        assertEquals(decoded, SealUseCodec.decode(SealUseCodec.encode(decoded)));
        assertEquals(1, decoded.documentVersion());
        assertEquals(SealUseContract.SealType.OFFICIAL, decoded.sealType());
    }

    @Test void inputKeyOrderAndJsonWhitespaceAreIrrelevant() {
        LinkedHashMap<String, String> reversed = new LinkedHashMap<>();
        var keys = new ArrayList<>(BASE.keySet());
        java.util.Collections.reverse(keys);
        keys.forEach(k -> reversed.put(k, BASE.get(k)));
        assertEquals(SealUseCodec.decode(RAW), SealUseCodec.decode(" \r\n\t" + json(reversed) + " \r\n\t"));
        assertEquals(RAW, SealUseCodec.encode(SealUseCodec.decode(json(reversed))));
    }

    @ParameterizedTest @MethodSource("allFields")
    void everyFieldIsRequired(String field) {
        var fields = new LinkedHashMap<>(BASE);
        fields.remove(field);
        reject(json(fields));
    }

    @ParameterizedTest @MethodSource("allFields")
    void everyNullIsRejected(String field) { reject(with(field, "null")); }

    @ParameterizedTest @MethodSource("wrongStringTypes")
    void stringsAreNeverCoerced(String raw) { reject(raw); }

    static Stream<String> wrongStringTypes() {
        return STRING_FIELDS.stream().flatMap(field -> Stream.of("true", "false", "1", "1.2", "[]", "{}")
                .map(value -> with(field, value)));
    }

    @ParameterizedTest @ValueSource(strings = {"", " ", "null", "true", "false", "1", "\"value\"", "[]", "[{}]", "{}", "{", "}"})
    void rejectsMissingOrNonObjectRoots(String raw) { reject(raw); }

    @Test void nullRawIsRejected() { reject(null); }

    @ParameterizedTest @ValueSource(strings = {"0", "-1", "2", "1.0", "1.00", "1e0", "1E+0", "\"1\"", "true", "false", "[]", "{}", "2147483648", "18446744073709551616", "+1", "01", "NaN", "Infinity"})
    void versionIsStrictIntegerOne(String value) { reject(with("documentVersion", value)); }

    @ParameterizedTest @ValueSource(strings = {"0", "-0", "-1", "101", "999", "1000", "2147483647", "2147483648", "9223372036854775807", "18446744073709551616", "1.0", "2.5", "1e0", "1E+0", "1e2", "100e-0", "1e999999", "\"1\"", "true", "false", "[]", "{}", "NaN", "Infinity", "-Infinity", "+1", "01", "1.", ".1"})
    void countRejectsNonIntegerLexemesAndOutOfRangeValues(String value) { reject(with("copyCount", value)); }

    @ParameterizedTest @ValueSource(ints = {1, 2, 99, 100})
    void countAcceptsBoundaryIntegers(int value) {
        assertEquals(value, SealUseCodec.decode(with("copyCount", Integer.toString(value))).copyCount());
    }

    @ParameterizedTest @ValueSource(strings = {"OFFICIAL", "CONTRACT", "FINANCE"})
    void acceptsOnlySyntheticEnumValues(String value) {
        assertEquals(value, SealUseCodec.decode(with("sealType", quote(value))).sealType().name());
    }

    @ParameterizedTest @ValueSource(strings = {"", "official", "Official", " OFFICIAL", "OFFICIAL ", "PERSONAL", "REAL_STAMP", "公章"})
    void rejectsOtherOrPaddedEnums(String value) { reject(with("sealType", quote(value))); }

    @ParameterizedTest @ValueSource(strings = {"", "sealuse", "SealUse", "sealUse ", " sealUse", "expense", "travel"})
    void typeIsExact(String value) { reject(with("type", quote(value))); }

    @ParameterizedTest @ValueSource(strings = {"summary", "total", "amount", "currency", "purpose", "signature", "signatureUrl", "stamp", "stampUrl", "sealId", "upload", "attachment", "attachmentUrl", "documentUrl", "callbackUrl", "action", "applicant", "applicantId", "applicantName", "actorId", "processId", "processVersion", "processDefinition", "nodeId", "status", "requestId", "idempotencyKey", "intentFingerprint", "__proto__", "constructor", "toJSON"})
    void rejectsAllUnknownDerivedActionAndHostFields(String name) {
        var fields = new LinkedHashMap<>(BASE);
        fields.put(name, "null");
        reject(json(fields));
    }

    @ParameterizedTest @MethodSource("allFields")
    void duplicateFieldsRejectEvenWhenTheirValuesMatch(String field) {
        reject(RAW.substring(0, RAW.length() - 1) + "," + quote(field) + ":" + BASE.get(field) + "}");
    }

    @Test void escapedKeyAliasesCannotBypassDuplicateDetection() {
        reject(RAW.substring(0, RAW.length() - 1) + ",\"business\\u0049d\":\"SEAL-DEMO-001\"}");
        reject(RAW.replace("\"title\":", "\"t\\u0069tle\":\"first\",\"title\":"));
    }

    @Test void escapedUniqueKeysAreCanonicalizedAsOrdinaryJsonNames() {
        assertEquals(SealUseCodec.decode(RAW), SealUseCodec.decode(RAW.replace("\"title\":", "\"t\\u0069tle\":")));
    }

    @ParameterizedTest @ValueSource(strings = {"{}", "[]", "null", "true", "1", "\"x\"", "garbage", ",", "/* comment */", "// comment", "\u00A0", "\uFEFF"})
    void rejectsTrailingTokensAndNonJsonWhitespace(String suffix) { reject(RAW + " " + suffix); }

    @Test void nonstandardJsonSyntaxIsRejected() {
        reject(RAW.replace("\"title\":", "title:"));
        reject(RAW.replace("\"title\"", "'title'"));
        reject(RAW.replace("\"type\":", "/*x*/\"type\":"));
        reject(RAW.substring(0, RAW.length() - 1) + ",}");
        reject(with("title", "\"line\nbreak\""));
        reject(with("title", "\"bad\\x20escape\""));
        reject("\uFEFF" + RAW);
    }

    @ParameterizedTest @ValueSource(strings = {"businessId", "documentRef"})
    void referenceBoundsAndAsciiAlphabet(String field) {
        for (String value : List.of("a", "0", "A._:/-9", "a".repeat(128), "https://example.invalid/ref")) {
            assertEquals(value, fieldValue(SealUseCodec.decode(with(field, quote(value))), field));
        }
        for (String value : List.of("", "a".repeat(129), " a", "a ", "a\n", "a\u0000", "_a", ".a", "/a", ":a", "-a", "a b", "a?x=1", "a#fragment", "a%20", "中文", "é", "a\\b", "a@b", "a\u00A0", "a\uFEFF")) {
            reject(with(field, quote(value)));
        }
    }

    @ParameterizedTest @ValueSource(strings = {"title", "reason", "documentName"})
    void rawLengthCheckedBeforeTrimWithUtf16Boundaries(String field) {
        int max = limit(field);
        assertEquals("x".repeat(max), fieldValue(SealUseCodec.decode(with(field, quote("x".repeat(max)))), field));
        reject(with(field, quote("x".repeat(max + 1))));
        reject(with(field, quote(" " + "x".repeat(max))));
        reject(with(field, quote("x".repeat(max) + "\u0000")));
        String emoji = "\uD83D\uDD8B".repeat(max / 2);
        assertEquals(max, emoji.length());
        assertEquals(emoji, fieldValue(SealUseCodec.decode(with(field, quote(emoji))), field));
        reject(with(field, quote(emoji + "x")));
    }

    @ParameterizedTest @ValueSource(strings = {"title", "reason", "documentName"})
    void trimsExactlyJavaC0EdgesAndPreservesInterior(String field) {
        for (int cp = 0; cp <= 0x20; cp++) {
            String edge = Character.toString(cp);
            assertEquals("text", fieldValue(SealUseCodec.decode(with(field, quote(edge + "text" + edge))), field));
            assertEquals("a" + edge + "b", fieldValue(SealUseCodec.decode(with(field, quote("a" + edge + "b"))), field));
        }
    }

    @ParameterizedTest @MethodSource("blankTextCases")
    void everyC0UnicodeWhitespaceAndBomOnlyTextIsRejected(String raw) { reject(raw); }

    static Stream<String> blankTextCases() {
        List<String> blank = new ArrayList<>();
        blank.add("");
        for (int cp = 0; cp <= 0x20; cp++) blank.add(Character.toString(cp));
        for (int cp : new int[] {0x85, 0xA0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
                0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF}) {
            blank.add(Character.toString(cp));
        }
        blank.add("\u0000\u00A0\uFEFF\u0085\u202F\u3000\t");
        return TEXT_FIELDS.stream().flatMap(field -> blank.stream().map(value -> with(field, quote(value))));
    }

    @ParameterizedTest @ValueSource(strings = {"title", "reason", "documentName"})
    void preservesOtherContentRatherThanBroadUnicodeTrimming(String field) {
        for (String value : List.of("\u00A0text\u00A0", "\uFEFFtext\uFEFF", "\u2003text\u2003", "\u200B", "\u180E", "\u007F", "\uD800", "\uDC00", "e\u0301", "\u00E9", "合同副本")) {
            SealUseContract valueObject = SealUseCodec.decode(with(field, quote(value)));
            assertEquals(value, fieldValue(valueObject, field));
            assertEquals(valueObject, SealUseCodec.decode(SealUseCodec.encode(valueObject)));
        }
    }

    @Test void canonicalEncoderRoundTripsEveryUtf16CodeUnitWithoutLoss() {
        for (int unit = 0; unit <= 0xFFFF; unit++) {
            // Interior placement preserves all C0 units under the specified edge-only trim policy.
            String title = "a" + (char) unit + "b";
            SealUseContract original = contract("sealUse", 1, "id", title, "r", "n", "ref",
                    SealUseContract.SealType.OFFICIAL, 1);
            String canonical = SealUseCodec.encode(original);
            assertEquals(original, SealUseCodec.decode(canonical), "UTF-16 code unit " + unit);
            if (Character.isSurrogate((char) unit)) {
                assertTrue(canonical.contains(String.format("\\u%04x", unit)), "Lone surrogate must be escaped");
            }
        }
    }

    @Test void normalizedEquivalentIntentHasSameEqualityAndFingerprint() {
        var original = SealUseCodec.decode(RAW);
        var fields = new LinkedHashMap<>(BASE);
        for (String field : TEXT_FIELDS) fields.put(field, quote("\u0000 \t" + fieldValue(original, field) + "\r\n "));
        var normalized = SealUseCodec.decode(json(fields));
        assertEquals(original, normalized);
        assertEquals(original.hashCode(), normalized.hashCode());
        assertEquals(SealUseCodec.intentFingerprint(original), SealUseCodec.intentFingerprint(normalized));
        assertTrue(SealUseCodec.intentFingerprint(original).matches("[0-9a-f]{64}"));
        assertEquals(original, SealUseCodec.decode(RAW.replace("Synthetic", "\\u0053ynthetic")));
    }

    @Test void changesToEveryVariableIntentFieldChangeEqualityAndFingerprint() {
        SealUseContract original = SealUseCodec.decode(RAW);
        Map<String, String> changes = Map.of("businessId", quote("SEAL-DEMO-002"), "title", quote("Changed title"),
                "reason", quote("Changed purpose"), "documentName", quote("Changed document"),
                "documentRef", quote("SYNTHETIC:doc/002"), "sealType", quote("CONTRACT"), "copyCount", "2");
        changes.forEach((field, value) -> {
            SealUseContract changed = SealUseCodec.decode(with(field, value));
            assertNotEquals(original, changed, field);
            assertNotEquals(SealUseCodec.intentFingerprint(original), SealUseCodec.intentFingerprint(changed), field);
        });
    }

    @Test void framingPreservesSurrogatesAndFieldBoundariesWithoutUnicodeFolding() {
        SealUseContract high = SealUseCodec.decode(with("title", quote("\uD800")));
        SealUseContract replacement = SealUseCodec.decode(with("title", quote("\uFFFD")));
        assertNotEquals(SealUseCodec.intentFingerprint(high), SealUseCodec.intentFingerprint(replacement));
        assertNotEquals(SealUseCodec.intentFingerprint(SealUseCodec.decode(with("title", quote("e\u0301")))),
                SealUseCodec.intentFingerprint(SealUseCodec.decode(with("title", quote("\u00E9")))));
        var left = new LinkedHashMap<>(BASE); left.put("title", quote("ab")); left.put("reason", quote("c"));
        var right = new LinkedHashMap<>(BASE); right.put("title", quote("a")); right.put("reason", quote("bc"));
        assertNotEquals(SealUseCodec.intentFingerprint(SealUseCodec.decode(json(left))),
                SealUseCodec.intentFingerprint(SealUseCodec.decode(json(right))));
    }

    @Test void constructorsCannotBypassValidationAndNormalization() {
        assertEquals("text", contract("sealUse", 1, "id", " text ", "r", "n", "ref", SealUseContract.SealType.OFFICIAL, 1).title());
        assertThrows(IllegalArgumentException.class, () -> contract(null, 1, "id", "t", "r", "n", "ref", SealUseContract.SealType.OFFICIAL, 1));
        assertThrows(IllegalArgumentException.class, () -> contract("other", 1, "id", "t", "r", "n", "ref", SealUseContract.SealType.OFFICIAL, 1));
        assertThrows(IllegalArgumentException.class, () -> contract("sealUse", 0, "id", "t", "r", "n", "ref", SealUseContract.SealType.OFFICIAL, 1));
        assertThrows(IllegalArgumentException.class, () -> contract("sealUse", 1, null, "t", "r", "n", "ref", SealUseContract.SealType.OFFICIAL, 1));
        assertThrows(IllegalArgumentException.class, () -> contract("sealUse", 1, "id", null, "r", "n", "ref", SealUseContract.SealType.OFFICIAL, 1));
        assertThrows(IllegalArgumentException.class, () -> contract("sealUse", 1, "id", "t", null, "n", "ref", SealUseContract.SealType.OFFICIAL, 1));
        assertThrows(IllegalArgumentException.class, () -> contract("sealUse", 1, "id", "t", "r", null, "ref", SealUseContract.SealType.OFFICIAL, 1));
        assertThrows(IllegalArgumentException.class, () -> contract("sealUse", 1, "id", "t", "r", "n", null, SealUseContract.SealType.OFFICIAL, 1));
        assertThrows(IllegalArgumentException.class, () -> contract("sealUse", 1, "id", "t", "r", "n", "ref", null, 1));
        assertThrows(IllegalArgumentException.class, () -> contract("sealUse", 1, "id", "t", "r", "n", "ref", SealUseContract.SealType.OFFICIAL, 0));
        assertThrows(IllegalArgumentException.class, () -> contract("sealUse", 1, "id", "t", "r", "n", "ref", SealUseContract.SealType.OFFICIAL, 101));
        assertThrows(IllegalArgumentException.class, () -> contract("sealUse", 1, "id", "t".repeat(121), "r", "n", "ref", SealUseContract.SealType.OFFICIAL, 1));
        assertThrows(IllegalArgumentException.class, () -> contract("sealUse", 1, "id", "t", "\uFEFF", "n", "ref", SealUseContract.SealType.OFFICIAL, 1));
        assertThrows(IllegalArgumentException.class, () -> contract("sealUse", 1, "id", "t", "r", "\u00A0", "ref", SealUseContract.SealType.OFFICIAL, 1));
    }

    @Test void recordContainsOnlyImmutableBusinessComponentsAndNoRuntimeInterface() {
        assertTrue(SealUseContract.class.isRecord());
        assertTrue(Modifier.isFinal(SealUseContract.class.getModifiers()));
        assertEquals(0, SealUseContract.class.getInterfaces().length);
        assertEquals(BASE.keySet(), Arrays.stream(SealUseContract.class.getRecordComponents()).map(c -> c.getName()).collect(java.util.stream.Collectors.toSet()));
        Arrays.stream(SealUseContract.class.getDeclaredFields()).filter(f -> !Modifier.isStatic(f.getModifiers())).forEach(f -> {
            assertTrue(Modifier.isFinal(f.getModifiers()));
            assertTrue(f.getType() == String.class || f.getType() == int.class || f.getType() == SealUseContract.SealType.class);
        });
    }

    @Test void nullEncodeAndFingerprintInputsAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> SealUseCodec.encode(null));
        assertThrows(IllegalArgumentException.class, () -> SealUseCodec.intentFingerprint(null));
    }

    private static SealUseContract contract(String type, int version, String id, String title, String reason,
            String name, String ref, SealUseContract.SealType seal, int count) {
        return new SealUseContract(type, version, id, title, reason, name, ref, seal, count);
    }
    private static Stream<String> allFields() { return BASE.keySet().stream(); }
    private static int limit(String field) { return switch (field) { case "title" -> 120; case "reason" -> 2000; default -> 160; }; }
    private static String fieldValue(SealUseContract value, String field) {
        return switch (field) {
            case "businessId" -> value.businessId(); case "title" -> value.title(); case "reason" -> value.reason();
            case "documentName" -> value.documentName(); case "documentRef" -> value.documentRef(); default -> throw new AssertionError(field);
        };
    }
    private static void reject(String raw) { assertThrows(IllegalArgumentException.class, () -> SealUseCodec.decode(raw)); }
    private static String with(String key, String value) { var values = new LinkedHashMap<>(BASE); values.put(key, value); return json(values); }
    private static String json(Map<String, String> values) {
        return "{" + values.entrySet().stream().map(e -> quote(e.getKey()) + ":" + e.getValue()).collect(java.util.stream.Collectors.joining(",")) + "}";
    }
    private static String quote(String value) {
        StringBuilder quoted = new StringBuilder("\"");
        for (char c : value.toCharArray()) {
            if (c == '\\' || c == '"') quoted.append('\\').append(c);
            else if (c < 0x20 || Character.isSurrogate(c)) quoted.append(String.format("\\u%04x", (int) c));
            else quoted.append(c);
        }
        return quoted.append('"').toString();
    }
    private static Map<String, String> base() {
        var values = new LinkedHashMap<String, String>();
        values.put("type", quote("sealUse")); values.put("documentVersion", "1"); values.put("businessId", quote("SEAL-DEMO-001"));
        values.put("title", quote("Synthetic seal request")); values.put("reason", quote("Synthetic business purpose"));
        values.put("documentName", quote("Synthetic agreement copy")); values.put("documentRef", quote("SYNTHETIC:doc/001"));
        values.put("sealType", quote("OFFICIAL")); values.put("copyCount", "1");
        return values;
    }
}
