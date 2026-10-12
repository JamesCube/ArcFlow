package com.arcflow.approval.graph;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.arcflow.approval.BusinessDocument;
import com.arcflow.approval.ConditionalRouting;
import java.util.List;

/** Immutable durable graph state: a command and every automatic transition commit together. */
public record GraphInstance(@JsonProperty(required = true) String id, @JsonProperty(required = true) String submissionKey, @JsonProperty(required = true) String applicantId, @JsonProperty(required = true) String status, @JsonProperty(required = true) String createdAt, @JsonProperty(required = true) String updatedAt,
    @JsonProperty(required = true) long commandRevision, @JsonProperty(required = true) GraphDefinition definition, @JsonProperty(required = true) BusinessDocument business, @JsonProperty(required = true) List<Task> tasks, @JsonProperty(required = true) List<Fork> forks,
    @JsonProperty(required = true) List<Route> routes, @JsonProperty(required = true) List<Event> events, @JsonProperty(required = true) List<Command> commands) {
    public GraphInstance { tasks=List.copyOf(tasks); forks=List.copyOf(forks); routes=List.copyOf(routes); events=List.copyOf(events); commands=List.copyOf(commands); }
    public record Task(@JsonProperty(required = true) String id,@JsonProperty(required = true) String nodeInstanceId,@JsonProperty(required = true) String nodeId,@JsonProperty(required = true) String status,@JsonProperty(required = true) List<String> participants,@JsonProperty(required = true) String completionMode,@JsonProperty(required = true) List<Vote> votes,@JsonProperty(required = true) List<Frame> lineage) {
        public Task { participants=List.copyOf(participants); votes=List.copyOf(votes); lineage=List.copyOf(lineage); }
    }
    public record Vote(@JsonProperty(required = true) String actorId,@JsonProperty(required = true) String decision,@JsonProperty(required = true) String comment,@JsonProperty(required = true) String at,@JsonProperty(required = true) String commandId) {}
    public record Frame(@JsonProperty(required = true) String forkActivationId,@JsonProperty(required = true) String branchId) {}
    public record Fork(@JsonProperty(required = true) String id,@JsonProperty(required = true) String forkId,@JsonProperty(required = true) String joinId,@JsonProperty(required = true) List<String> expectedBranchIds,@JsonProperty(required = true) List<String> arrivedBranchIds,@JsonProperty(required = true) boolean fired,@JsonProperty(required = true) List<Frame> lineage) {
        public Fork { expectedBranchIds=List.copyOf(expectedBranchIds); arrivedBranchIds=List.copyOf(arrivedBranchIds); lineage=List.copyOf(lineage); }
    }
    public record Route(@JsonProperty(required = true) String gatewayId,@JsonProperty(required = true) String selectedEdgeId,@JsonProperty(required = true) List<Evaluation> evaluations) { public Route { evaluations=List.copyOf(evaluations); } }
    public record Evaluation(@JsonProperty(required = true) String edgeId,@JsonProperty(required = true) boolean result,@JsonProperty(required = true) List<ConditionalRouting.Fact> facts) { public Evaluation { facts=List.copyOf(facts); } }
    public record Event(@JsonProperty(required = true) long sequence,@JsonProperty(required = true) String type,@JsonProperty(required = true) String nodeId,@JsonProperty(required = true) String taskId,@JsonProperty(required = true) String detail,@JsonProperty(required = true) String at) {}
    public record Command(@JsonProperty(required = true) String id,@JsonProperty(required = true) String taskId,@JsonProperty(required = true) String actorId,@JsonProperty(required = true) String decision,@JsonProperty(required = true) String comment,@JsonProperty(required = true) String at) {}
}
