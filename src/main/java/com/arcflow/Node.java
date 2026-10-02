package com.arcflow;

import java.util.List;
import java.util.Objects;

/** A task and its prerequisite node IDs. All prerequisites must succeed. */
public record Node(String id, String handler, List<String> dependsOn) {
    public Node {
        requireName(id, "id");
        requireName(handler, "handler");
        dependsOn = List.copyOf(Objects.requireNonNull(dependsOn, "dependsOn"));
        dependsOn.forEach(dependency -> requireName(dependency, "dependency"));
        if (dependsOn.stream().distinct().count() != dependsOn.size()) {
            throw new IllegalArgumentException("Duplicate dependencies for " + id);
        }
    }

    static void requireName(String value, String label) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(label + " must not be blank");
    }
}
