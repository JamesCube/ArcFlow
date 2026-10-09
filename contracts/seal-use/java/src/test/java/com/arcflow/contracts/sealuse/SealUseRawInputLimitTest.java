package com.arcflow.contracts.sealuse;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/** Shared, small policy fixture; large JSON padding is constructed only in test memory. */
class SealUseRawInputLimitTest {
    @TestFactory Stream<DynamicTest> rawSourceSizeBoundaryMatchesSharedPolicy() throws IOException {
        List<DynamicTest> tests = new ArrayList<>();
        SealUseContract baseline = new SealUseContract("sealUse", 1, "SEAL-DEMO-001", "Synthetic seal request",
                "Synthetic business purpose", "Synthetic agreement copy", "SYNTHETIC:doc/001",
                SealUseContract.SealType.OFFICIAL, 1);
        String json = SealUseCodec.encode(baseline);
        try (var input = getClass().getResourceAsStream("/seal-use-raw-input-policy.json")) {
            assertNotNull(input);
            try (JsonParser parser = new JsonFactory().createParser(input)) {
                assertEquals(JsonToken.START_OBJECT, parser.nextToken());
                assertEquals(JsonToken.FIELD_NAME, parser.nextToken());
                assertEquals("maxUtf16CodeUnits", parser.currentName());
                assertEquals(JsonToken.VALUE_NUMBER_INT, parser.nextToken());
                int limit = parser.getIntValue();
                assertEquals(SealUseCodec.MAX_RAW_JSON_UTF16_UNITS, limit);
                int groups = 0;
                while (parser.nextToken() != JsonToken.END_OBJECT) {
                    String group = parser.currentName();
                    assertTrue(group.equals("acceptedLengthOffsets") || group.equals("rejectedLengthOffsets"));
                    boolean accepted = group.equals("acceptedLengthOffsets");
                    groups++;
                    assertEquals(JsonToken.START_ARRAY, parser.nextToken());
                    while (parser.nextToken() != JsonToken.END_ARRAY) {
                        assertEquals(JsonToken.VALUE_NUMBER_INT, parser.currentToken());
                        int length = Math.addExact(limit, parser.getIntValue());
                        tests.add(DynamicTest.dynamicTest("raw source length " + length + ", accepted=" + accepted, () -> {
                            String padded = json + " ".repeat(length - json.length());
                            assertEquals(length, padded.length());
                            if (accepted) assertEquals(baseline, SealUseCodec.decode(padded));
                            else {
                                IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                                        () -> SealUseCodec.decode(padded));
                                assertEquals("JSON source must not exceed 8000000 UTF-16 code units", error.getMessage());
                            }
                        }));
                    }
                }
                assertEquals(2, groups);
                assertEquals(3, tests.size());
                assertNull(parser.nextToken());
            }
        }
        return tests.stream();
    }

    @Test void nullIsRejectedBeforeSourceLengthIsRead() {
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> SealUseCodec.decode(null));
        assertEquals("JSON is required", error.getMessage());
    }

    @Test void sizeCapCountsUtf16CodeUnitsRatherThanUnicodeCodePoints() {
        // The source is intentionally invalid JSON: the cap must reject it before JSON parsing.
        String oversized = "\uD83D\uDD8B".repeat(SealUseCodec.MAX_RAW_JSON_UTF16_UNITS / 2) + " ";
        assertEquals(4_000_001, oversized.codePointCount(0, oversized.length()));
        assertEquals(8_000_001, oversized.length());
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> SealUseCodec.decode(oversized));
        assertEquals("JSON source must not exceed 8000000 UTF-16 code units", error.getMessage());
    }
}
