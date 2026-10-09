package com.arcflow.contracts.sealuse;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.core.StreamReadFeature;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Set;

/** Strict raw JSON boundary for the isolated contract; never use coercing bean binding instead. */
public final class SealUseCodec {
    /** Raw source bound shared with the standalone JavaScript parser, measured before parsing. */
    public static final int MAX_RAW_JSON_UTF16_UNITS = 8_000_000;
    private static final JsonFactory JSON = JsonFactory.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build();
    private static final Set<String> FIELDS = Set.of("type", "documentVersion", "businessId", "title",
            "reason", "documentName", "documentRef", "sealType", "copyCount");
    private static final byte[] FINGERPRINT_DOMAIN =
            "arcflow.sealUse.intent.v1\0".getBytes(StandardCharsets.US_ASCII);

    private SealUseCodec() { }

    /**
     * Accept one JSON object with exactly the required fields. Duplicate keys (including escaped
     * aliases), trailing values, coercions and non-integer numeric lexemes are rejected before
     * constructing the validated immutable value. Field order in input is irrelevant.
     */
    public static SealUseContract decode(String rawJson) {
        if (rawJson == null) throw invalid("JSON is required");
        if (rawJson.length() > MAX_RAW_JSON_UTF16_UNITS) {
            throw invalid("JSON source must not exceed 8000000 UTF-16 code units");
        }
        try (JsonParser parser = JSON.createParser(rawJson)) {
            if (parser.nextToken() != JsonToken.START_OBJECT) throw invalid("Expected one JSON object");
            Set<String> seen = new HashSet<>();
            String type = null, businessId = null, title = null, reason = null, documentName = null, documentRef = null;
            SealUseContract.SealType sealType = null;
            int version = 0, count = 0;
            JsonToken token;
            while ((token = parser.nextToken()) != JsonToken.END_OBJECT) {
                if (token != JsonToken.FIELD_NAME) throw invalid("Expected a business field");
                String field = parser.currentName();
                if (!FIELDS.contains(field)) throw invalid("Unknown business field");
                if (!seen.add(field)) throw invalid("Duplicate business field");
                if (parser.nextToken() == null) throw invalid("Missing field value");
                switch (field) {
                    case "type" -> type = string(parser, field);
                    case "documentVersion" -> {
                        if (parser.currentToken() != JsonToken.VALUE_NUMBER_INT || !"1".equals(parser.getText())) {
                            throw invalid("documentVersion must use the integer JSON lexeme 1");
                        }
                        version = 1;
                    }
                    case "businessId" -> businessId = string(parser, field);
                    case "title" -> title = string(parser, field);
                    case "reason" -> reason = string(parser, field);
                    case "documentName" -> documentName = string(parser, field);
                    case "documentRef" -> documentRef = string(parser, field);
                    case "sealType" -> {
                        String name = string(parser, field);
                        try { sealType = SealUseContract.SealType.valueOf(name); }
                        catch (IllegalArgumentException ex) { throw invalid("Unknown synthetic sealType"); }
                    }
                    case "copyCount" -> count = count(parser);
                    default -> throw new AssertionError("Known field has no decoder");
                }
            }
            if (!seen.equals(FIELDS)) throw invalid("All nine business fields are required");
            if (parser.nextToken() != null) throw invalid("Trailing JSON content is forbidden");
            return new SealUseContract(type, version, businessId, title, reason, documentName, documentRef, sealType, count);
        } catch (IOException ex) {
            throw new IllegalArgumentException("Malformed or duplicate-key JSON", ex);
        }
    }

    /** Serialize only the nine business keys in a stable order; adds no derived or host data. */
    public static String encode(SealUseContract contract) {
        if (contract == null) throw invalid("Contract is required");
        // Fixed schema plus explicit escaping makes canonical bytes agree with JSON.stringify,
        // including lowercase control escapes and escaped lone UTF-16 surrogates.
        return "{\"type\":" + quote(contract.type())
                + ",\"documentVersion\":" + contract.documentVersion()
                + ",\"businessId\":" + quote(contract.businessId())
                + ",\"title\":" + quote(contract.title())
                + ",\"reason\":" + quote(contract.reason())
                + ",\"documentName\":" + quote(contract.documentName())
                + ",\"documentRef\":" + quote(contract.documentRef())
                + ",\"sealType\":" + quote(contract.sealType().name())
                + ",\"copyCount\":" + contract.copyCount() + "}";
    }

    private static String quote(String value) {
        StringBuilder out = new StringBuilder(value.length() + 2).append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (Character.isHighSurrogate(c) && i + 1 < value.length()
                            && Character.isLowSurrogate(value.charAt(i + 1))) {
                        out.append(c).append(value.charAt(++i));
                    } else if (c < 0x20 || Character.isSurrogate(c)) {
                        out.append("\\u");
                        for (int shift = 12; shift >= 0; shift -= 4) {
                            out.append(Character.forDigit((c >> shift) & 0xF, 16));
                        }
                    } else out.append(c);
                }
            }
        }
        return out.append('"').toString();
    }

    /**
     * Local comparison aid, not durable idempotency or authorization. SHA-256 over the ASCII domain
     * prefix followed by each canonical field value (numbers as decimal strings), in encode order.
     * Every value is framed by its unsigned 32-bit big-endian UTF-16 code-unit length and unsigned
     * 16-bit big-endian code units. No separator ambiguity or lossy surrogate conversion is possible.
     * A host would separately need actor/process/tenant/version scoping, storage and concurrency.
     */
    public static String intentFingerprint(SealUseContract contract) {
        if (contract == null) throw invalid("Contract is required");
        String[] values = {contract.type(), Integer.toString(contract.documentVersion()), contract.businessId(),
                contract.title(), contract.reason(), contract.documentName(), contract.documentRef(),
                contract.sealType().name(), Integer.toString(contract.copyCount())};
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (DataOutputStream framed = new DataOutputStream(bytes)) {
                framed.write(FINGERPRINT_DOMAIN);
                for (String value : values) {
                    framed.writeInt(value.length());
                    for (int i = 0; i < value.length(); i++) framed.writeChar(value.charAt(i));
                }
            }
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes.toByteArray()));
        } catch (IOException | NoSuchAlgorithmException ex) {
            throw new IllegalStateException("Could not fingerprint in-memory contract", ex);
        }
    }

    private static String string(JsonParser parser, String field) throws IOException {
        if (parser.currentToken() != JsonToken.VALUE_STRING) throw invalid(field + " must be a JSON string");
        return parser.getText();
    }

    private static int count(JsonParser parser) throws IOException {
        if (parser.currentToken() != JsonToken.VALUE_NUMBER_INT) {
            throw invalid("copyCount must be an integer JSON lexeme between 1 and 100");
        }
        String lexeme = parser.getText();
        // Bound the lexeme before parsing so no overflow, rounding or coercion can occur.
        if (!lexeme.matches("[1-9][0-9]{0,2}")) throw invalid("copyCount must be between 1 and 100");
        int value = Integer.parseInt(lexeme);
        if (value > 100) throw invalid("copyCount must be between 1 and 100");
        return value;
    }

    private static IllegalArgumentException invalid(String message) {
        return new IllegalArgumentException(message);
    }
}
