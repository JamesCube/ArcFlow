package com.arcflow.approval;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.*;

/** Finite, typed, submit-time selection of extra manual reviews. Never executes user code. */
public final class ConditionalRouting {
    private ConditionalRouting() {}
    public static final int SNAPSHOT_SCHEMA = 13;
    private static final Set<String> CURRENCIES = Set.of("CNY", "USD", "EUR", "GBP", "JPY");
    private static final Set<String> MONEY_OPERATORS = Set.of("EQ", "GT", "GTE", "LT", "LTE");
    private static final Set<String> TERMS = Set.of("STANDARD", "NONSTANDARD");

    public record Rule(String mode, List<Predicate> predicates) {
        public Rule { if (predicates != null) predicates = List.copyOf(predicates); }
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        public static Rule fromJson(JsonNode node) {
            exact(node, "mode", "predicates");
            if (!node.get("predicates").isArray() || node.get("predicates").isEmpty() || node.get("predicates").size() > 8)
                throw invalid("Rule predicates must contain 1–8 atoms");
            var atoms = new ArrayList<Predicate>();
            for (JsonNode atom : node.get("predicates")) atoms.add(Predicate.fromJson(atom));
            var rule = new Rule(text(node, "mode"), atoms); validate(rule); return rule;
        }
    }

    /** Each field has one exact wire shape; unused fields are absent, never null. */
    public record Predicate(String field, String operator,
        @JsonInclude(JsonInclude.Include.NON_NULL) String currency,
        @JsonInclude(JsonInclude.Include.NON_NULL) BigDecimal threshold,
        @JsonInclude(JsonInclude.Include.NON_NULL) Boolean expected,
        @JsonInclude(JsonInclude.Include.NON_NULL) List<String> values) {
        public Predicate {
            if (threshold != null) {
                if (threshold.scale() > 2) throw invalid("A monetary threshold permits at most two decimals");
                threshold = threshold.stripTrailingZeros();
            }
            if (values != null) values = List.copyOf(values);
        }
        public static Predicate money(String operator, String currency, BigDecimal threshold) {
            return new Predicate("payment.netTotal", operator, currency, threshold, null, null);
        }
        public static Predicate flag(boolean expected) {
            return new Predicate("receiving.hasRejectedLines", "EQ", null, null, expected, null);
        }
        public static Predicate terms(String operator, String... values) {
            return new Predicate("contract.termsKind", operator, null, null, null, List.of(values));
        }
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        public static Predicate fromJson(JsonNode node) {
            String field = text(node, "field"), operator = text(node, "operator");
            Predicate atom;
            switch (field) {
                case "payment.netTotal" -> {
                    exact(node, "field", "operator", "currency", "threshold");
                    if (!node.get("threshold").isNumber()) throw invalid("A monetary threshold must be a JSON number");
                    atom = money(operator, text(node, "currency"), node.get("threshold").decimalValue());
                }
                case "receiving.hasRejectedLines" -> {
                    exact(node, "field", "operator", "expected");
                    if (!node.get("expected").isBoolean()) throw invalid("A receipt condition needs a boolean");
                    atom = new Predicate(field, operator, null, null, node.get("expected").booleanValue(), null);
                }
                case "contract.termsKind" -> {
                    exact(node, "field", "operator", "values");
                    if (!node.get("values").isArray() || node.get("values").isEmpty() || node.get("values").size() > 2)
                        throw invalid("Contract terms values must contain 1–2 entries");
                    var values = new ArrayList<String>();
                    for (JsonNode value : node.get("values")) {
                        if (!value.isTextual()) throw invalid("Contract terms values must be strings");
                        values.add(value.textValue());
                    }
                    atom = new Predicate(field, operator, null, null, null, values);
                }
                default -> throw invalid("Unknown routing field");
            }
            validate(atom); return atom;
        }
    }
    public record Fact(String field, String actualValue, boolean result) {}
    public record Evaluation(String stepId, boolean result, List<Fact> predicates) {
        public Evaluation { if (predicates != null) predicates = List.copyOf(predicates); }
    }
    public record FrozenRoute(int schemaVersion, List<String> stepIds, List<Evaluation> evaluations) {
        public FrozenRoute {
            if (stepIds != null) stepIds = List.copyOf(stepIds);
            if (evaluations != null) evaluations = List.copyOf(evaluations);
        }
    }

    public static void validate(Rule rule) {
        if (rule == null || !("ALL".equals(rule.mode()) || "ANY".equals(rule.mode())) ||
            rule.predicates() == null || rule.predicates().isEmpty() || rule.predicates().size() > 8)
            throw invalid("A condition needs ALL or ANY and 1–8 typed predicates");
        for (Predicate predicate : rule.predicates()) validate(predicate);
    }
    private static void validate(Predicate atom) {
        if (atom == null || atom.field() == null || atom.operator() == null) throw invalid("Invalid routing predicate");
        switch (atom.field()) {
            case "payment.netTotal" -> {
                if (!MONEY_OPERATORS.contains(atom.operator()) || atom.currency() == null || !CURRENCIES.contains(atom.currency()) ||
                    atom.threshold() == null || atom.threshold().signum() < 0 || atom.threshold().scale() > 2 ||
                    atom.threshold().compareTo(new BigDecimal("20000000000")) > 0 ||
                    ("JPY".equals(atom.currency()) && atom.threshold().stripTrailingZeros().scale() > 0) || atom.expected() != null || atom.values() != null)
                    throw invalid("Invalid exact monetary routing threshold or currency");
            }
            case "receiving.hasRejectedLines" -> {
                if (!"EQ".equals(atom.operator()) || atom.expected() == null || atom.currency() != null || atom.threshold() != null || atom.values() != null)
                    throw invalid("A receipt condition compares a boolean using EQ");
            }
            case "contract.termsKind" -> {
                if (!("EQ".equals(atom.operator()) || "IN".equals(atom.operator())) || atom.values() == null ||
                    atom.values().isEmpty() || atom.values().size() > 2 || ("EQ".equals(atom.operator()) && atom.values().size() != 1) ||
                    !TERMS.containsAll(atom.values()) || new HashSet<>(atom.values()).size() != atom.values().size() ||
                    atom.currency() != null || atom.threshold() != null || atom.expected() != null)
                    throw invalid("A contract condition compares explicit STANDARD/NONSTANDARD terms");
            }
            default -> throw invalid("Unknown routing field");
        }
    }
    static void validateDefinition(ProcessDefinition definition) {
        int count = 0; Class<? extends BusinessDocument> family = null;
        for (var node : definition.approvals()) if (node.runIf() != null) {
            if (definition.schemaVersion() != 4) throw invalid("Conditions require definition schema 4");
            validate(node.runIf()); count += node.runIf().predicates().size();
            for (Predicate atom : node.runIf().predicates()) {
                Class<? extends BusinessDocument> next = documentClass(atom.field());
                if (family != null && family != next) throw invalid("All conditions must target one document type");
                family = next;
            }
        }
        if (count > 8) throw invalid("A definition permits at most eight routing predicates");
        if (definition.approvals().stream().noneMatch(node -> node.runIf() == null))
            throw invalid("At least one unconditional manual approval is required");
        // A single payment request has one currency, so contradictory currency rules are unusable.
        var currencies = new HashSet<String>();
        definition.approvals().stream().filter(node -> node.runIf() != null).flatMap(node -> node.runIf().predicates().stream())
            .filter(atom -> atom.currency() != null).forEach(atom -> currencies.add(atom.currency()));
        if (currencies.size() > 1) throw invalid("All payment routing predicates must use the same currency");
    }
    public static void validateForDocument(ProcessDefinition definition, Class<? extends BusinessDocument> type) {
        ProcessDefinition.validate(definition);
        if (definition.schemaVersion() != 4) return;
        if (type != BusinessDocument.PaymentRequest.class && type != BusinessDocument.Receiving.class && type != BusinessDocument.ContractApproval.class)
            throw invalid("Conditional routing is available only for payment, receiving and contract scenarios");
        for (var node : definition.approvals()) if (node.runIf() != null)
            for (Predicate atom : node.runIf().predicates())
                if (documentClass(atom.field()) != type) throw invalid("Routing fields do not belong to this scenario document type");
    }
    public static FrozenRoute freeze(ProcessDefinition definition, BusinessDocument business) {
        ProcessDefinition.validate(definition);
        if (definition.schemaVersion() != 4) return null;
        if (business == null) throw invalid("Conditional routing requires a typed business document");
        business.validate(); validateForDocument(definition, business.getClass());
        var selected = new ArrayList<String>(); var evaluations = new ArrayList<Evaluation>();
        for (var node : definition.approvals()) {
            boolean result = true;
            if (node.runIf() != null) {
                // Evaluate every atom: currency/type errors may never hide behind short-circuiting.
                var facts = node.runIf().predicates().stream().map(atom -> evaluate(atom, business)).toList();
                result = "ALL".equals(node.runIf().mode()) ? facts.stream().allMatch(Fact::result) : facts.stream().anyMatch(Fact::result);
                evaluations.add(new Evaluation(node.id(), result, facts));
            }
            if (result) selected.add(node.id());
        }
        if (selected.isEmpty()) throw invalid("The execution route must contain a manual approval");
        return new FrozenRoute(1, selected, evaluations);
    }
    public static List<ProcessDefinition.ProcessNode> effectiveApprovals(ApprovalService.Request request) {
        FrozenRoute expected = freeze(request.definition(), request.business());
        if (!Objects.equals(expected, request.routing())) throw invalid("Frozen routing does not match the original definition and business snapshot");
        return expected == null ? request.definition().approvals() : request.definition().approvals().stream()
            .filter(node -> expected.stepIds().contains(node.id())).toList();
    }
    public static int minimumSnapshotSchema(ProcessDefinition definition) {
        return definition.schemaVersion() == 4 ? SNAPSHOT_SCHEMA : definition.schemaVersion();
    }
    private static Fact evaluate(Predicate atom, BusinessDocument business) {
        if (documentClass(atom.field()) != business.getClass()) throw invalid("Routing predicate document type mismatch");
        if (business instanceof BusinessDocument.PaymentRequest payment) {
            if (!payment.currency().equals(atom.currency()))
                throw invalid("Payment currency must match routing currency " + atom.currency() + "; no automatic conversion is supported");
            BigDecimal value = payment.netTotal(); int comparison = value.compareTo(atom.threshold());
            boolean matches = switch (atom.operator()) {
                case "EQ" -> comparison == 0; case "GT" -> comparison > 0; case "GTE" -> comparison >= 0;
                case "LT" -> comparison < 0; case "LTE" -> comparison <= 0; default -> throw invalid("Unknown money operator");
            };
            return new Fact(atom.field(), payment.currency() + " " + value.stripTrailingZeros().toPlainString(), matches);
        }
        if (business instanceof BusinessDocument.Receiving receiving) {
            boolean value = receiving.lines().stream().anyMatch(line -> line.rejected() > 0);
            return new Fact(atom.field(), Boolean.toString(value), value == atom.expected());
        }
        var contract = (BusinessDocument.ContractApproval) business;
        return new Fact(atom.field(), contract.termsKind(), atom.values().contains(contract.termsKind()));
    }
    private static Class<? extends BusinessDocument> documentClass(String field) {
        return switch (field) {
            case "payment.netTotal" -> BusinessDocument.PaymentRequest.class;
            case "receiving.hasRejectedLines" -> BusinessDocument.Receiving.class;
            case "contract.termsKind" -> BusinessDocument.ContractApproval.class;
            default -> throw invalid("Unknown routing field");
        };
    }
    private static String text(JsonNode node, String field) {
        if (node == null || !node.isObject() || !node.path(field).isTextual()) throw invalid("Missing or non-string routing field: " + field);
        return node.get(field).textValue();
    }
    private static void exact(JsonNode node, String... fields) {
        if (node == null || !node.isObject()) throw invalid("Invalid routing object");
        var actual = new HashSet<String>(); node.fieldNames().forEachRemaining(actual::add);
        if (!actual.equals(Set.of(fields))) throw invalid("Missing or unknown routing fields");
    }
    private static IllegalArgumentException invalid(String message) { return new IllegalArgumentException(message); }
}
