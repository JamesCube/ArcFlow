package com.arcflow.approval;

import java.util.List;

/** Explicit wire-type/class/schema contract. Decoding support does not enable a scenario endpoint. */
public final class BusinessDocumentSchema {
    private BusinessDocumentSchema() {}
    public static final int MAX_SNAPSHOT_SCHEMA = 13;
    public record Entry(String wireType, Class<? extends BusinessDocument> documentClass, int minimumSnapshotSchema) {}
    public static final List<Entry> ENTRIES = List.of(
        new Entry("leave", BusinessDocument.Leave.class, 5),
        new Entry("procurement", BusinessDocument.Procurement.class, 5),
        new Entry("quoteDiscount", BusinessDocument.QuoteDiscount.class, 6),
        new Entry("expense", BusinessDocument.Expense.class, 7),
        new Entry("travel", BusinessDocument.Travel.class, 8),
        new Entry("sealUse", BusinessDocument.SealUse.class, 9),
        new Entry("receiving", BusinessDocument.Receiving.class, 10),
        new Entry("paymentRequest", BusinessDocument.PaymentRequest.class, 11),
        new Entry("contractApproval", BusinessDocument.ContractApproval.class, 12));

    public static Entry forType(String wireType) {
        return ENTRIES.stream().filter(entry -> entry.wireType().equals(wireType)).findFirst().orElse(null);
    }

    public static Entry forDocument(BusinessDocument document) {
        if (document == null) throw new IllegalArgumentException("Business document must not be null");
        return ENTRIES.stream().filter(entry -> entry.documentClass().equals(document.getClass())).findFirst()
            .orElseThrow(() -> new IllegalArgumentException("Unregistered business document class"));
    }
}
