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
@com.fasterxml.jackson.databind.annotation.JsonTypeResolver(StrictBusinessTypeResolver.class)
@JsonSubTypes({@JsonSubTypes.Type(value = BusinessDocument.Leave.class, name = "leave"),
    @JsonSubTypes.Type(value = BusinessDocument.Procurement.class, name = "procurement"),
    @JsonSubTypes.Type(value = BusinessDocument.QuoteDiscount.class, name = "quoteDiscount"),
    @JsonSubTypes.Type(value = BusinessDocument.Expense.class, name = "expense"),
    @JsonSubTypes.Type(value = BusinessDocument.Travel.class, name = "travel"),
    @JsonSubTypes.Type(value = BusinessDocument.SealUse.class, name = "sealUse"),
    @JsonSubTypes.Type(value = BusinessDocument.Receiving.class, name = "receiving")})
public sealed interface BusinessDocument permits BusinessDocument.Leave, BusinessDocument.Procurement, BusinessDocument.QuoteDiscount, BusinessDocument.Expense, BusinessDocument.Travel, BusinessDocument.SealUse, BusinessDocument.Receiving {
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

    /** Synthetic, manually entered PO line snapshot. Not an inventory or cross-request balance ledger. */
    record Receiving(@JsonProperty(required = true) int documentVersion,
                     @JsonProperty(required = true) String businessId, @JsonProperty(required = true) String title,
                     @JsonProperty(required = true) String reason, @JsonProperty(required = true) String purchaseOrderRef,
                     @JsonProperty(required = true) String warehouse, @JsonProperty(required = true) String receivedOn,
                     @JsonProperty(required = true) java.util.List<ReceivingLine> lines) implements BusinessDocument {
        public Receiving { if (lines != null) lines = java.util.List.copyOf(lines); }
        @Override public void validate() {
            if (documentVersion != 1 || !validReference(businessId) || !validReference(purchaseOrderRef) ||
                !receivingText(title, 120) || !receivingText(reason, 2000) ||
                !java.util.Set.of("EAST", "WEST").contains(warehouse == null ? "" : warehouse) ||
                lines == null || lines.isEmpty() || lines.size() > 20)
                throw new IllegalArgumentException("Receiving requires version 1, valid references, text, warehouse and 1–20 lines");
            if (receivedOn == null || !receivedOn.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))
                throw new IllegalArgumentException("Receiving date must use YYYY-MM-DD");
            try { if (LocalDate.parse(receivedOn).getYear() < 1) throw new IllegalArgumentException("Receiving year must be positive"); }
            catch (DateTimeParseException invalid) { throw new IllegalArgumentException("Receiving date must be a real calendar date", invalid); }
            var lineIds = new java.util.HashSet<String>(); var sourceLines = new java.util.HashSet<String>();
            boolean hasDelivery = false;
            for (ReceivingLine line : lines) {
                line.validate();
                if (!lineIds.add(line.lineId()) || !sourceLines.add(line.orderLineRef()))
                    throw new IllegalArgumentException("Receiving line IDs and PO line references must each be distinct within this document");
                hasDelivery |= line.received() > 0;
            }
            if (!hasDelivery) throw new IllegalArgumentException("At least one line must have a positive received quantity");
        }
        @Override public Receiving withText(String title, String reason) {
            return new Receiving(documentVersion, businessId, title, reason, purchaseOrderRef, warehouse, receivedOn,
                lines.stream().map(line -> new ReceivingLine(line.lineId(), line.orderLineRef(), line.description().trim(),
                    line.unit(), line.ordered(), line.received(), line.accepted(), line.rejected(), line.exceptionReason().trim())).toList());
        }
        public ReceivingSummary summary() {
            var quantities = new java.util.ArrayList<ReceivingQuantities>();
            for (String unit : java.util.List.of("PCS", "BOX")) {
                var matching = lines.stream().filter(line -> unit.equals(line.unit())).toList();
                if (!matching.isEmpty()) quantities.add(new ReceivingQuantities(unit,
                    matching.stream().mapToInt(ReceivingLine::received).sum(), matching.stream().mapToInt(ReceivingLine::accepted).sum(),
                    matching.stream().mapToInt(ReceivingLine::rejected).sum()));
            }
            return new ReceivingSummary("receiving", lines.size(), (int)lines.stream().filter(line -> line.rejected() > 0).count(), quantities);
        }
    }
    record ReceivingLine(@JsonProperty(required = true) String lineId, @JsonProperty(required = true) String orderLineRef,
                         @JsonProperty(required = true) String description, @JsonProperty(required = true) String unit,
                         @com.fasterxml.jackson.databind.annotation.JsonDeserialize(using = ReceivingInteger.class) @JsonProperty(required = true) int ordered, @com.fasterxml.jackson.databind.annotation.JsonDeserialize(using = ReceivingInteger.class) @JsonProperty(required = true) int received,
                         @com.fasterxml.jackson.databind.annotation.JsonDeserialize(using = ReceivingInteger.class) @JsonProperty(required = true) int accepted, @com.fasterxml.jackson.databind.annotation.JsonDeserialize(using = ReceivingInteger.class) @JsonProperty(required = true) int rejected,
                         @JsonProperty(required = true) String exceptionReason) {
        public void validate() {
            if (!validReference(lineId) || !validReference(orderLineRef) || !receivingText(description, 240) ||
                !java.util.Set.of("PCS", "BOX").contains(unit == null ? "" : unit) || ordered < 1 || ordered > 100000 ||
                received < 0 || received > ordered || accepted < 0 || accepted > 100000 || rejected < 0 || rejected > 100000 ||
                accepted + rejected != received || exceptionReason == null || exceptionReason.length() > 1000 ||
                (rejected > 0 && !receivingText(exceptionReason, 1000)))
                throw new IllegalArgumentException("Invalid receiving line: exact counts, reconciliation and exception reason are required");
        }
    }
    /** Keep negative zero and non-integer numeric lexemes out of the receiving wire contract. */
    final class ReceivingInteger extends com.fasterxml.jackson.databind.JsonDeserializer<Integer> {
        @Override public Integer deserialize(com.fasterxml.jackson.core.JsonParser parser, com.fasterxml.jackson.databind.DeserializationContext context) throws java.io.IOException {
            if (parser.currentToken() != com.fasterxml.jackson.core.JsonToken.VALUE_NUMBER_INT || "-0".equals(parser.getText()))
                return (Integer) context.handleUnexpectedToken(Integer.class, parser);
            return parser.getIntValue();
        }
        @Override public Integer getNullValue(com.fasterxml.jackson.databind.DeserializationContext context) throws com.fasterxml.jackson.databind.JsonMappingException {
            return context.reportInputMismatch(Integer.class, "Receiving quantities cannot be null");
        }
    }
    record ReceivingQuantities(String unit, int received, int accepted, int rejected) {}
    record ReceivingSummary(String kind, int lineCount, int exceptionLineCount, java.util.List<ReceivingQuantities> quantities) {
        public ReceivingSummary { quantities = java.util.List.copyOf(quantities); }
    }
    private static boolean receivingText(String value, int max) {
        return value != null && value.length() <= max && value.codePoints().anyMatch(cp -> !(cp <= 0x20 || cp == 0x85 || cp == 0xA0 || cp == 0x1680 ||
            (cp >= 0x2000 && cp <= 0x200A) || cp == 0x2028 || cp == 0x2029 || cp == 0x202F || cp == 0x205F || cp == 0x3000 || cp == 0xFEFF));
    }

    /** Synthetic review intent only: no seal application, signature or document retrieval. */
    record SealUse(@JsonProperty(required = true) int documentVersion,
                   @JsonProperty(required = true) String businessId, @JsonProperty(required = true) String title,
                   @JsonProperty(required = true) String reason, @JsonProperty(required = true) String documentName,
                   @JsonProperty(required = true) String documentRef, @JsonProperty(required = true) String sealType,
                   @JsonProperty(required = true) int copyCount) implements BusinessDocument {
        @Override public void validate() {
            // Keep these versioned text rules independent of the older document contracts.
            // Bounds apply to raw UTF-16 input before trim, exactly like the registered form.
            if (documentVersion != 1 || !validReference(businessId) || !validReference(documentRef) ||
                !validSealText(title, 120) || !validSealText(reason, 2000) || !validSealText(documentName, 160) ||
                !java.util.Set.of("OFFICIAL", "CONTRACT", "FINANCE").contains(sealType == null ? "" : sealType) ||
                copyCount < 1 || copyCount > 100)
                throw new IllegalArgumentException("Seal use requires document version 1, valid references and text, a supported synthetic seal type and 1–100 copies");
        }
        @Override public SealUse withText(String title, String reason) {
            return new SealUse(documentVersion, businessId, title, reason, documentName.trim(), documentRef, sealType, copyCount);
        }
        private static boolean validSealText(String value, int max) {
            return value != null && value.length() <= max && value.codePoints().anyMatch(cp -> !blankCodePoint(cp));
        }
        private static boolean blankCodePoint(int cp) {
            // Fixed Unicode White_Space plus C0 and BOM. Java isBlank() has different semantics.
            return cp <= 0x20 || cp == 0x85 || cp == 0xA0 || cp == 0x1680 ||
                (cp >= 0x2000 && cp <= 0x200A) || cp == 0x2028 || cp == 0x2029 ||
                cp == 0x202F || cp == 0x205F || cp == 0x3000 || cp == 0xFEFF;
        }
    }

    /** A synthetic itinerary and budget request. Approval never books, reimburses or pays. */
    record Travel(@JsonProperty(required = true) int documentVersion,
                  @JsonProperty(required = true) String businessId, @JsonProperty(required = true) String title,
                  @JsonProperty(required = true) String reason, @JsonProperty(required = true) String destination,
                  @JsonProperty(required = true) String startDate, @JsonProperty(required = true) String endDate,
                  @JsonProperty(required = true) String purpose, @JsonProperty(required = true) BigDecimal estimatedCost,
                  @JsonProperty(required = true) String currency, @JsonProperty(required = true) String costCenter) implements BusinessDocument {
        @Override public void validate() {
            validateCommon(this);
            if (documentVersion != 1 || !validText(destination,160) || destination.trim().isBlank() ||
                title.trim().isBlank() || reason.trim().isBlank() ||
                !java.util.Set.of("ENGINEERING","SALES","OPERATIONS").contains(costCenter == null ? "" : costCenter) ||
                !java.util.Set.of("CUSTOMER_VISIT","PROJECT_DELIVERY","TRAINING","CONFERENCE","OTHER").contains(purpose == null ? "" : purpose))
                throw new IllegalArgumentException("请填写有效的出差信息、目的地、用途和成本中心 / Travel requires version 1, valid text, destination, purpose and cost center");
            if (!java.util.Set.of("CNY","USD","EUR","GBP","JPY").contains(currency == null ? "" : currency))
                throw new IllegalArgumentException("请选择支持的币种 / Choose a supported currency: CNY, USD, EUR, GBP or JPY");
            if (estimatedCost == null || estimatedCost.signum() <= 0 || estimatedCost.scale() > 2 || estimatedCost.compareTo(new BigDecimal("1000000000")) > 0)
                throw new IllegalArgumentException("预计费用须大于 0、不超过 1,000,000,000，最多两位小数 / Estimated cost must be positive, at most 1,000,000,000 and have at most two decimal places");
            if ("JPY".equals(currency) && estimatedCost.stripTrailingZeros().scale() > 0)
                throw new IllegalArgumentException("日元预计费用须为整数 / Estimated cost in JPY must be a whole amount");
            long days = durationDays();
            if (days < 1 || days > 90)
                throw new IllegalArgumentException("结束日期不能早于开始日期，含首尾最多 90 天 / End date must not precede start date; the trip may span at most 90 days inclusive");
        }
        public long durationDays() { return java.time.temporal.ChronoUnit.DAYS.between(travelDate(startDate),travelDate(endDate)) + 1; }
        private static LocalDate travelDate(String value) {
            if (value == null || !value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))
                throw new IllegalArgumentException("日期须为 YYYY-MM-DD 格式 / Dates must use YYYY-MM-DD");
            try {
                LocalDate date=LocalDate.parse(value);
                if (date.getYear() < 1) throw new DateTimeParseException("Year must be positive",value,0);
                return date;
            } catch (DateTimeParseException invalid) {
                throw new IllegalArgumentException("请输入 0001–9999 年的有效日历日期 / Enter a real calendar date in years 0001–9999",invalid);
            }
        }
        @Override public Travel withText(String title,String reason) {
            return new Travel(documentVersion,businessId,title,reason,destination.trim(),startDate,endDate,purpose,
                estimatedCost.stripTrailingZeros(),currency,costCenter);
        }
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
