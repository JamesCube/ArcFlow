package com.arcflow.contracts.sealuse;

import java.util.regex.Pattern;

/**
 * Local-only, immutable synthetic seal-use business intent.
 * This is deliberately independent of the runtime BusinessDocument hierarchy.
 * No stamp, signature, file upload, URL retrieval, workflow or persistence action occurs here.
 */
public record SealUseContract(
        String type,
        int documentVersion,
        String businessId,
        String title,
        String reason,
        String documentName,
        String documentRef,
        SealType sealType,
        int copyCount) {

    public static final String TYPE = "sealUse";
    public static final int DOCUMENT_VERSION = 1;
    private static final Pattern REFERENCE = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}");

    /** Synthetic choices only; they do not identify or authorize any real seal. */
    public enum SealType { OFFICIAL, CONTRACT, FINANCE }

    public SealUseContract {
        if (!TYPE.equals(type)) throw invalid("type must be sealUse");
        if (documentVersion != DOCUMENT_VERSION) throw invalid("documentVersion must be 1");
        businessId = reference(businessId, "businessId");
        title = text(title, "title", 120);
        // Future forms label this existing field as business purpose; there is no extra purpose field.
        reason = text(reason, "reason", 2000);
        documentName = text(documentName, "documentName", 160);
        documentRef = reference(documentRef, "documentRef");
        if (sealType == null) throw invalid("sealType is required");
        if (copyCount < 1 || copyCount > 100) throw invalid("copyCount must be between 1 and 100");
    }

    private static String reference(String value, String field) {
        // References are validated unchanged, never trimmed or treated as actionable URLs.
        if (value == null || !REFERENCE.matcher(value).matches()) {
            throw invalid(field + " must match the 1–128 character ASCII reference rule");
        }
        return value;
    }

    private static String text(String value, String field, int maxLength) {
        // Java String.length(), like JavaScript string.length, counts UTF-16 code units.
        // Reject overlong raw input before normalization, even when trimming would shorten it.
        if (value == null || value.length() > maxLength) {
            throw invalid(field + " is required and must not exceed " + maxLength + " UTF-16 code units");
        }
        String normalized = value.trim(); // Exactly U+0000–U+0020 at the two edges.
        if (normalized.codePoints().allMatch(SealUseContract::blankCodePoint)) {
            throw invalid(field + " must not be blank");
        }
        return normalized;
    }

    private static boolean blankCodePoint(int cp) {
        // Fixed Unicode White_Space set, plus C0 and BOM; do not use runtime-dependent isBlank().
        return cp <= 0x20 || cp == 0x85 || cp == 0xA0 || cp == 0x1680
                || (cp >= 0x2000 && cp <= 0x200A) || cp == 0x2028 || cp == 0x2029
                || cp == 0x202F || cp == 0x205F || cp == 0x3000 || cp == 0xFEFF;
    }

    private static IllegalArgumentException invalid(String message) {
        return new IllegalArgumentException(message);
    }
}
