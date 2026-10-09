package com.arcflow.contracts.sealuse;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/** Shared fixture vectors can be consumed by the independent JavaScript prototype. */
class SealUseVectorsTest {
    @TestFactory Stream<DynamicTest> crossLanguageVectors() throws IOException {
        List<DynamicTest> tests = new ArrayList<>();
        try (var input = getClass().getResourceAsStream("/seal-use-vectors.json")) {
            assertNotNull(input, "Fixture resource must exist");
            try (JsonParser parser = new JsonFactory().createParser(input)) {
                assertEquals(JsonToken.START_OBJECT, parser.nextToken());
                while (parser.nextToken() != JsonToken.END_OBJECT) {
                    String group = parser.currentName();
                    assertTrue(group.equals("valid") || group.equals("invalid"));
                    assertEquals(JsonToken.START_ARRAY, parser.nextToken());
                    while (parser.nextToken() != JsonToken.END_ARRAY) {
                        assertEquals(JsonToken.START_OBJECT, parser.currentToken());
                        Map<String, String> vector = new LinkedHashMap<>();
                        while (parser.nextToken() != JsonToken.END_OBJECT) {
                            String name = parser.currentName();
                            assertEquals(JsonToken.VALUE_STRING, parser.nextToken());
                            assertNull(vector.put(name, parser.getText()));
                        }
                        tests.add(DynamicTest.dynamicTest(group + ": " + vector.get("name"), () -> {
                            if (group.equals("valid")) {
                                SealUseContract value = SealUseCodec.decode(vector.get("raw"));
                                assertEquals(vector.get("canonical"), SealUseCodec.encode(value));
                                assertEquals(vector.get("fingerprint"), SealUseCodec.intentFingerprint(value));
                                assertEquals(value, SealUseCodec.decode(vector.get("canonical")));
                            } else {
                                assertThrows(IllegalArgumentException.class, () -> SealUseCodec.decode(vector.get("raw")));
                            }
                        }));
                    }
                }
                assertNull(parser.nextToken());
            }
        }
        return tests.stream();
    }
}
