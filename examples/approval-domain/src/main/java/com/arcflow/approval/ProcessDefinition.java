package com.arcflow.approval;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/** Executable, deliberately linear process contract. The array order is the execution order. */
public record ProcessDefinition(
    @JsonProperty(required = true) int schemaVersion,
    @JsonProperty(required = true) String id,
    @JsonProperty(required = true) int version,
    @JsonProperty(required = true) String name,
    @JsonProperty(required = true) List<ProcessNode> nodes) {
    public ProcessDefinition { if (nodes != null) nodes = List.copyOf(nodes); }

    public record ProcessNode(
        @JsonProperty(required = true) String id,
        @JsonProperty(required = true) String type,
        @JsonProperty(required = true) String name,
        @JsonProperty(required = true) String assigneeId) {}

    /** Schema 1 selected an approver per request; its one-step behavior is preserved exactly. */
    public static ProcessDefinition legacy(String assignee) {
        return new ProcessDefinition(2, "leave-approval", 1, "Leave approval", List.of(
            new ProcessNode("start", "start", "Submit leave", null),
            new ProcessNode("manager", "approval", "Designated approver", assignee),
            new ProcessNode("end", "end", "Completed", null)));
    }

    public List<ProcessNode> approvals() { return nodes.subList(1, nodes.size() - 1); }

    public static void validate(ProcessDefinition d) {
        if (d == null || d.schemaVersion != 2 || !"leave-approval".equals(d.id) || d.version < 1 ||
            !validName(d.name) || d.nodes == null || d.nodes.size() < 3 || d.nodes.size() > 10)
            throw new IllegalArgumentException("Use schema 2, the leave-approval process, a positive version, a name and 1–8 approvals");
        var ids = new java.util.HashSet<String>();
        for (int i = 0; i < d.nodes.size(); i++) {
            var n = d.nodes.get(i);
            if (n == null || n.id == null || !n.id.matches("[A-Za-z][A-Za-z0-9_-]{0,63}") ||
                !ids.add(n.id) || !validName(n.name))
                throw new IllegalArgumentException("Nodes need unique stable IDs and nonblank names of at most 120 characters");
            if (i == 0) {
                if (!"start".equals(n.id) || !"start".equals(n.type) || n.assigneeId != null)
                    throw new IllegalArgumentException("The first node must be the unassigned start node");
            } else if (i == d.nodes.size() - 1) {
                if (!"end".equals(n.id) || !"end".equals(n.type) || n.assigneeId != null)
                    throw new IllegalArgumentException("The last node must be the unassigned end node");
            } else if (!"approval".equals(n.type) || "start".equals(n.id) || "end".equals(n.id) ||
                       !validActorId(n.assigneeId)) {
                throw new IllegalArgumentException("Every middle node must be an approval assigned to a stable user ID");
            }
        }
    }

    /** Structural only: historical records remain readable after directory users are removed. */
    public static boolean validActorId(String value) {
        return value != null && !value.isBlank() && value.length() <= 128 &&
            value.codePoints().noneMatch(Character::isISOControl);
    }

    private static boolean validName(String value) {
        return value != null && !value.isBlank() && value.length() <= 120 &&
            value.codePoints().noneMatch(Character::isISOControl);
    }
}
