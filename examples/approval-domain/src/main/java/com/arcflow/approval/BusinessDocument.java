package com.arcflow.approval;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;

/** Immutable business data. Approval routing, participants, votes and status live elsewhere. */
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({@JsonSubTypes.Type(value = BusinessDocument.Leave.class, name = "leave"),
    @JsonSubTypes.Type(value = BusinessDocument.Procurement.class, name = "procurement"),
    @JsonSubTypes.Type(value = BusinessDocument.QuoteDiscount.class, name = "quoteDiscount"),
    @JsonSubTypes.Type(value = BusinessDocument.Expense.class, name = "expense")})
public sealed interface BusinessDocument permits BusinessDocument.Leave, BusinessDocument.Procurement, BusinessDocument.QuoteDiscount, BusinessDocument.Expense {
    String businessId();
    String title();
    String reason();
    void validate();
    BusinessDocument withText(String title, String reason);

    record Leave(@JsonProperty(required = true) String businessId, @JsonProperty(required = true) String title,
                 @JsonProperty(required = true) String reason, @JsonProperty(required = true) int days) implements BusinessDocument {
        @Override public void validate() {
            validateCommon(this);
            if (days < 1 || days > 365) throw new IllegalArgumentException("Leave days must be between 1 and 365");
        }
        @Override public Leave withText(String title, String reason) { return new Leave(businessId, title, reason, days); }
    }

    record Procurement(@JsonProperty(required = true) String businessId, @JsonProperty(required = true) String title,
                       @JsonProperty(required = true) String reason, @JsonProperty(required = true) String item,
                       @JsonProperty(required = true) int quantity, @JsonProperty(required = true) BigDecimal unitPrice,
                       @JsonProperty(required = true) String currency) implements BusinessDocument {
        @Override public void validate() {
            validateCommon(this);
            if (!validText(item, 240) || quantity < 1 || quantity > 100000 || unitPrice == null ||
                unitPrice.signum() <= 0 || unitPrice.scale() > 2 || unitPrice.compareTo(new BigDecimal("1000000000.00")) > 0 ||
                currency == null || !java.util.Set.of("CNY", "USD", "EUR", "GBP", "JPY").contains(currency))
                throw new IllegalArgumentException("Invalid procurement item, quantity, unit price or supported currency");
            if ("JPY".equals(currency) && unitPrice.stripTrailingZeros().scale() > 0)
                throw new IllegalArgumentException("JPY unit price must be a whole amount");
        }
        @Override public Procurement withText(String title, String reason) {
            return new Procurement(businessId, title, reason, item.trim(), quantity, unitPrice.stripTrailingZeros(), currency);
        }
    }

    /** Frozen, single-line quote revision. Derived amounts are never accepted as input. */
    record QuoteDiscount(@JsonProperty(required = true) String businessId, @JsonProperty(required = true) String title,
                         @JsonProperty(required = true) String reason, @JsonProperty(required = true) String customerRef,
                         @JsonProperty(required = true) int quoteRevision, @JsonProperty(required = true) String item,
                         @JsonProperty(required = true) int quantity, @JsonProperty(required = true) BigDecimal listUnitPrice,
                         @JsonProperty(required = true) BigDecimal requestedUnitPrice, @JsonProperty(required = true) String currency,
                         @JsonProperty(required = true) String validUntil) implements BusinessDocument {
        @Override public void validate() {
            validateCommon(this);
            if (!validText(customerRef, 128) || quoteRevision < 1)
                throw new IllegalArgumentException("A customer reference and positive quote revision are required");
            // Keep exactly the procurement amount/quantity/currency bounds, including JPY precision.
            new Procurement(businessId, title, reason, item, quantity, listUnitPrice, currency).validate();
            new Procurement(businessId, title, reason, item, quantity, requestedUnitPrice, currency).validate();
            if (requestedUnitPrice.compareTo(listUnitPrice) >= 0)
                throw new IllegalArgumentException("Requested unit price must be below list unit price");
            validUntilDate(); // Historical snapshots remain readable after expiry; submission checks use the host clock.
        }
        public LocalDate validUntilDate() {
            if (validUntil == null || !validUntil.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))
                throw new IllegalArgumentException("Valid until must be a calendar date in YYYY-MM-DD format");
            try { return LocalDate.parse(validUntil); }
            catch (DateTimeParseException invalid) { throw new IllegalArgumentException("Valid until must be a real calendar date", invalid); }
        }
        @Override public QuoteDiscount withText(String title, String reason) {
            return new QuoteDiscount(businessId, title, reason, customerRef.trim(), quoteRevision, item.trim(), quantity,
                listUnitPrice.stripTrailingZeros(), requestedUnitPrice.stripTrailingZeros(), currency, validUntil);
        }
        public BigDecimal listTotal() { return listUnitPrice.multiply(BigDecimal.valueOf(quantity)); }
        public BigDecimal requestedTotal() { return requestedUnitPrice.multiply(BigDecimal.valueOf(quantity)); }
        public BigDecimal reductionTotal() { return listTotal().subtract(requestedTotal()); }
        /** Display only. Never use this rounded percentage to choose approvers or change state. */
        public BigDecimal discountPercent() {
            return listUnitPrice.subtract(requestedUnitPrice).multiply(BigDecimal.valueOf(100))
                .divide(listUnitPrice, 4, RoundingMode.HALF_UP).stripTrailingZeros();
        }
        /** Exact cross multiplication for an informational threshold, independent of routing. */
        public boolean discountAtLeast(BigDecimal percent) {
            if (percent == null || percent.signum() < 0 || percent.compareTo(BigDecimal.valueOf(100)) > 0)
                throw new IllegalArgumentException("Percent must be between zero and 100");
            return listUnitPrice.subtract(requestedUnitPrice).multiply(BigDecimal.valueOf(100))
                .compareTo(listUnitPrice.multiply(percent)) >= 0;
        }
    }

    /** Versioned expense data, not a payment instruction or proof that a receipt exists. */
    record Expense(@JsonProperty(required = true) int documentVersion,
                   @JsonProperty(required = true) String businessId, @JsonProperty(required = true) String title,
                   @JsonProperty(required = true) String reason, @JsonProperty(required = true) String costCenter,
                   @JsonProperty(required = true) String currency, @JsonProperty(required = true) java.util.List<ExpenseLine> lines) implements BusinessDocument {
        public Expense { if (lines != null) lines = java.util.List.copyOf(lines); }
        @Override public void validate() {
            validateCommon(this);
            if (documentVersion != 1 || !java.util.Set.of("SALES", "ENGINEERING", "OPERATIONS").contains(costCenter == null ? "" : costCenter) ||
                !java.util.Set.of("CNY", "USD", "EUR", "GBP", "JPY").contains(currency == null ? "" : currency) ||
                lines == null || lines.isEmpty() || lines.size() > 20)
                throw new IllegalArgumentException("Expense requires document version 1, a supported cost center/currency and 1–20 lines");
            var lineIds = new java.util.HashSet<String>(); var receipts = new java.util.HashSet<String>();
            for (ExpenseLine line : lines) {
                line.validate(currency);
                if (!lineIds.add(line.lineId()) || !receipts.add(line.receiptRef()))
                    throw new IllegalArgumentException("Expense line IDs and receipt references must each be distinct");
            }
        }
        @Override public Expense withText(String title, String reason) {
            return new Expense(documentVersion, businessId, title, reason, costCenter, currency,
                lines.stream().map(line -> new ExpenseLine(line.lineId(), line.spentOn(), line.category(),
                    line.description().trim(), line.amount().stripTrailingZeros(), line.receiptRef())).toList());
        }
        public BigDecimal total() { return lines.stream().map(ExpenseLine::amount).reduce(BigDecimal.ZERO, BigDecimal::add); }
    }

    record ExpenseLine(@JsonProperty(required = true) String lineId, @JsonProperty(required = true) String spentOn,
                       @JsonProperty(required = true) String category, @JsonProperty(required = true) String description,
                       @JsonProperty(required = true) BigDecimal amount, @JsonProperty(required = true) String receiptRef) {
        public void validate(String currency) {
            if (!validReference(lineId) || !validReference(receiptRef) || !validText(description, 240) || description.trim().isBlank() ||
                !java.util.Set.of("TRAVEL", "MEALS", "OFFICE", "OTHER").contains(category == null ? "" : category) ||
                amount == null || amount.signum() <= 0 || amount.scale() > 2 || amount.compareTo(new BigDecimal("1000000000")) > 0 ||
                ("JPY".equals(currency) && amount.stripTrailingZeros().scale() > 0))
                throw new IllegalArgumentException("Invalid expense line reference, category, description or exact amount");
            if (spentOn == null || !spentOn.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))
                throw new IllegalArgumentException("Expense date must use YYYY-MM-DD");
            try { if (LocalDate.parse(spentOn).getYear() < 1) throw new IllegalArgumentException("Expense date year must be positive"); }
            catch (DateTimeParseException invalid) { throw new IllegalArgumentException("Expense date must be a real calendar date", invalid); }
        }
    }

    private static boolean validReference(String value) { return value != null && value.matches("[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}"); }
    private static void validateCommon(BusinessDocument document) {
        if (document.businessId() == null || !document.businessId().matches("[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}") ||
            !validText(document.title(), 120) || !validText(document.reason(), 2000))
            throw new IllegalArgumentException("Invalid business document identity, title or reason");
    }
    private static boolean validText(String value, int max) { return value != null && !value.isBlank() && value.length() <= max; }
}
