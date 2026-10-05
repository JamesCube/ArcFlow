package com.arcflow.approval;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;

/** Ordered approval stages. Schema 2 is sequential; schema 3 also permits parallel groups. */
public record ProcessDefinition(
    @JsonProperty(required = true) int schemaVersion,
    @JsonProperty(required = true) String id,
    @JsonProperty(required = true) int version,
    @JsonProperty(required = true) String name,
    @JsonProperty(required = true) List<ProcessNode> nodes) {
    public ProcessDefinition { if (nodes != null) nodes = List.copyOf(nodes); }

    public record ProcessNode(String id, String type, String name, String assigneeId,
        @JsonInclude(JsonInclude.Include.NON_NULL) List<String> assigneeIds,
        @JsonInclude(JsonInclude.Include.NON_NULL) String completionMode) {
        public ProcessNode { if (assigneeIds != null) assigneeIds = List.copyOf(assigneeIds); }
        /** Retains the source and wire contract of existing sequential definitions. */
        public ProcessNode(String id, String type, String name, String assigneeId) {
            this(id, type, name, assigneeId, null, null);
        }
        public List<String> participants() { return "parallelApproval".equals(type) ? assigneeIds : assigneeId == null ? List.of() : List.of(assigneeId); }
        public String mode() { return "parallelApproval".equals(type) ? completionMode : "ALL"; }

        /** Explicit versioned shapes retain strict JDBC missing-field checks for old records. */
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        public static ProcessNode fromJson(JsonNode node) {
            if (node == null || !node.isObject()) throw new IllegalArgumentException("Invalid process node");
            String type = string(node, "type");
            var expected = "parallelApproval".equals(type)
                ? Set.of("id", "type", "name", "assigneeId", "assigneeIds", "completionMode")
                : Set.of("id", "type", "name", "assigneeId");
            var actual = new HashSet<String>(); node.fieldNames().forEachRemaining(actual::add);
            if (!actual.equals(expected)) throw new IllegalArgumentException("Missing or unknown process node fields");
            List<String> participants = null;
            if ("parallelApproval".equals(type)) {
                if (!node.get("assigneeIds").isArray()) throw new IllegalArgumentException("Invalid group participants");
                participants = new ArrayList<>();
                for (JsonNode member : node.get("assigneeIds")) {
                    if (!member.isTextual()) throw new IllegalArgumentException("Participant IDs must be strings");
                    participants.add(member.textValue());
                }
            }
            return new ProcessNode(string(node, "id"), type, string(node, "name"), string(node, "assigneeId"),
                participants, participants == null ? null : string(node, "completionMode"));
        }
        private static String string(JsonNode node, String field) {
            JsonNode value = node.get(field);
            if (value == null || !(value.isTextual() || value.isNull()))
                throw new IllegalArgumentException("Missing or non-string node field: " + field);
            return value.isNull() ? null : value.textValue();
        }
    }

    /** Schema 1 selected an approver per request; its one-step behavior is preserved exactly. */
    public static ProcessDefinition legacy(String assignee) {
        return new ProcessDefinition(2, "leave-approval", 1, "Leave approval", List.of(
            new ProcessNode("start", "start", "Submit leave", null),
            new ProcessNode("manager", "approval", "Designated approver", assignee),
            new ProcessNode("end", "end", "Completed", null)));
    }

    public List<ProcessNode> approvals() { return nodes.subList(1, nodes.size() - 1); }

    public static void validate(ProcessDefinition d) {
        if (d == null || (d.schemaVersion != 2 && d.schemaVersion != 3) || !"leave-approval".equals(d.id) || d.version < 1 ||
            !validName(d.name) || d.nodes == null || d.nodes.size() < 3 || d.nodes.size() > 10)
            throw new IllegalArgumentException("Use schema 2 or 3, the leave-approval process, a positive version, a name and 1–8 approval stages");
        var ids = new HashSet<String>();
        for (int i = 0; i < d.nodes.size(); i++) {
            var n = d.nodes.get(i);
            if (n == null || n.id == null || !n.id.matches("[A-Za-z][A-Za-z0-9_-]{0,63}") ||
                !ids.add(n.id) || !validName(n.name))
                throw new IllegalArgumentException("Nodes need unique stable IDs and nonblank names of at most 120 characters");
            if (i == 0 || i == d.nodes.size() - 1) {
                String boundary = i == 0 ? "start" : "end";
                if (!boundary.equals(n.id) || !boundary.equals(n.type) || n.assigneeId != null || n.assigneeIds != null || n.completionMode != null)
                    throw new IllegalArgumentException("The first and last nodes must be unassigned start and end nodes");
            } else {
                if ("start".equals(n.id) || "end".equals(n.id)) throw new IllegalArgumentException("Reserved boundary node ID");
                if ("approval".equals(n.type)) {
                    if (!validActorId(n.assigneeId) || n.assigneeIds != null || n.completionMode != null)
                        throw new IllegalArgumentException("A sequential approval needs one stable user ID and no group fields");
                } else if ("parallelApproval".equals(n.type) && d.schemaVersion == 3) {
                    if (n.assigneeId != null || n.assigneeIds == null || n.assigneeIds.size() < 2 || n.assigneeIds.size() > 16 ||
                        !n.assigneeIds.stream().allMatch(ProcessDefinition::validActorId) ||
                        new HashSet<>(n.assigneeIds).size() != n.assigneeIds.size() ||
                        !("ALL".equals(n.completionMode) || "ANY".equals(n.completionMode)))
                        throw new IllegalArgumentException("A parallel approval needs 2–16 distinct participants, null assigneeId and ALL or ANY completionMode");
                } else throw new IllegalArgumentException("Unsupported approval type for this schema");
            }
        }
    }

    /** Structural only: historical records remain readable after directory users are removed. */
    public static boolean validActorId(String value) {
        return value != null && !value.isBlank() && value.length() <= 128 && value.codePoints().noneMatch(Character::isISOControl);
    }
    private static boolean validName(String value) {
        return value != null && !value.isBlank() && value.length() <= 120 && value.codePoints().noneMatch(Character::isISOControl);
    }
}
