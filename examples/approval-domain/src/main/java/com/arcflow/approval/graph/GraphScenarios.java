package com.arcflow.approval.graph;

import com.arcflow.approval.BusinessDocument;
import java.util.*;

/** Authoritative process identity binding. It applies even when a graph has no conditions. */
public final class GraphScenarios {
    private GraphScenarios() {}
    public record Scenario(String key, String processId, String businessType,
                           Class<? extends BusinessDocument> documentType, Set<String> facts) {}
    public static final Scenario PAYMENT = new Scenario("payment", "payment-graph", "paymentRequest", BusinessDocument.PaymentRequest.class, Set.of("payment.netTotal"));
    public static final Scenario TRAVEL = new Scenario("travel", "travel-graph", "travel", BusinessDocument.Travel.class, Set.of("travel.estimatedCost"));
    public static final Scenario RECEIVING = new Scenario("receiving", "receiving-graph", "receiving", BusinessDocument.Receiving.class, Set.of("receiving.hasRejectedLines"));
    public static final Scenario QUOTE = new Scenario("quote", "quote-graph", "quoteDiscount", BusinessDocument.QuoteDiscount.class, Set.of("quote.reductionTotal", "quote.discountPercent"));
    public static List<Scenario> all() { return List.of(PAYMENT, TRAVEL, RECEIVING, QUOTE); }
    public static Scenario forKey(String key) { return all().stream().filter(s -> s.key().equals(key)).findFirst().orElseThrow(() -> new IllegalArgumentException("Unknown graph scenario")); }
    /** Schema five was payment-only with caller-chosen IDs. Never reinterpret those durable identities.
     * Schema six explicitly opts into the fixed business registry; it has the same bounded graph shape. */
    public static Scenario forDefinition(GraphDefinition definition) {
        if (definition.schemaVersion()==5) return PAYMENT;
        if (definition.schemaVersion()!=6) throw new IllegalArgumentException("Unknown executable graph schema");
        return all().stream().filter(s -> s!=PAYMENT && s.processId().equals(definition.id())).findFirst()
            .orElseThrow(() -> new IllegalArgumentException("Graph schema 6 requires a registered travel, receiving or quote process ID"));
    }
    public static void validateFacts(GraphDefinition definition) {
        var scenario = forDefinition(definition);
        for (var edge : definition.edges()) if (edge.condition() != null)
            for (var atom : edge.condition().predicates()) if (!scenario.facts().contains(atom.field()))
                throw new IllegalArgumentException("Routing field " + atom.field() + " does not belong to " + scenario.businessType() + " graph " + definition.id());
    }
    public static void validateDocument(GraphDefinition definition, BusinessDocument business) {
        var scenario = forDefinition(definition);
        if (business == null || business.getClass() != scenario.documentType())
            throw new IllegalArgumentException("A " + scenario.businessType() + " business document is required for graph " + definition.id());
        business.validate();
    }
}
