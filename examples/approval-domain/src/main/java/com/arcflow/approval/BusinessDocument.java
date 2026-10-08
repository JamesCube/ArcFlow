package com.arcflow.approval;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.math.BigDecimal;

/** Immutable business data. Approval routing, participants, votes and status live elsewhere. */
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({@JsonSubTypes.Type(value = BusinessDocument.Leave.class, name = "leave"),
    @JsonSubTypes.Type(value = BusinessDocument.Procurement.class, name = "procurement")})
public sealed interface BusinessDocument permits BusinessDocument.Leave, BusinessDocument.Procurement {
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

    private static void validateCommon(BusinessDocument document) {
        if (document.businessId() == null || !document.businessId().matches("[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}") ||
            !validText(document.title(), 120) || !validText(document.reason(), 2000))
            throw new IllegalArgumentException("Invalid business document identity, title or reason");
    }
    private static boolean validText(String value, int max) { return value != null && !value.isBlank() && value.length() <= max; }
}
