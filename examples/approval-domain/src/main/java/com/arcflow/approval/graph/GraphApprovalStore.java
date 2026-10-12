package com.arcflow.approval.graph;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.io.IOException;
import java.util.List;

/** Isolated graph format. No legacy request/store is converted or overwritten. */
public interface GraphApprovalStore extends AutoCloseable {
    int STORAGE_SCHEMA_VERSION = 14;
    record Draft(@JsonProperty(required = true) long revision,@JsonProperty(required = true) int baseVersion,@JsonProperty(required = true) GraphDefinition definition) {}
    record Snapshot(@JsonProperty(required = true) int storageSchemaVersion,@JsonProperty(required = true) GraphDefinition definition,@JsonProperty(required = true) Draft draft,@JsonProperty(required = true) List<GraphInstance> requests) {
        public Snapshot { requests=List.copyOf(requests); }
    }
    Snapshot snapshot() throws IOException;
    boolean saveDraft(long expectedRevision,Draft next) throws IOException;
    boolean publish(int expectedVersion,long expectedDraftRevision,GraphDefinition next) throws IOException;
    boolean create(int expectedVersion,GraphInstance instance) throws IOException;
    boolean replace(String id,long expectedRevision,GraphInstance next) throws IOException;
    @Override void close() throws IOException;
}
