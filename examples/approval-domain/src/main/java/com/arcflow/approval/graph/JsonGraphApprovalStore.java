package com.arcflow.approval.graph;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/** Isolated graph snapshot store. One owning process, synchronized CAS, atomic replacement only. */
public final class JsonGraphApprovalStore implements GraphApprovalStore {
    private final ObjectMapper mapper;
    private final Path file;
    private final FileChannel lockChannel;
    private final FileLock lock;
    private Snapshot state;
    private boolean closed;

    /** The supplied filename must be the dedicated .graph.json file, never the legacy snapshot. */
    public JsonGraphApprovalStore(ObjectMapper mapper, String filename, GraphDefinition initial) throws IOException {
        GraphDefinition.validate(initial);
        this.mapper = GraphApprovalService.strictMapper(Objects.requireNonNull(mapper).copy());
        this.file = Path.of(filename).toAbsolutePath().normalize();
        if (!file.getFileName().toString().endsWith(".graph.json"))
            throw new IllegalArgumentException("Graph storage requires an isolated .graph.json filename");
        Files.createDirectories(file.getParent());
        lockChannel = FileChannel.open(file.resolveSibling(file.getFileName() + ".lock"),
            StandardOpenOption.CREATE, StandardOpenOption.WRITE);
        FileLock acquired = null;
        try {
            acquired = lockChannel.tryLock();
            if (acquired == null) throw new IOException("Another process owns the graph data file");
            if (Files.exists(file)) {
                state = decode(Files.readAllBytes(file));
                if (!state.definition().id().equals(initial.id()) || state.definition().schemaVersion()!=initial.schemaVersion())
                    throw new IOException("Graph snapshot belongs to another process or executable schema");
            } else {
                commit(new Snapshot(14, initial, new Draft(0, initial.version(), initial), List.of()));
            }
        } catch (Exception failure) {
            if (acquired != null) try { acquired.release(); } catch (IOException cleanup) { failure.addSuppressed(cleanup); }
            try { lockChannel.close(); } catch (IOException cleanup) { failure.addSuppressed(cleanup); }
            if (failure instanceof IOException io) throw io;
            throw new IOException("Cannot open graph snapshot", failure);
        }
        lock = acquired;
    }

    private Snapshot decode(byte[] bytes) throws IOException {
        try {
            JsonNode root = mapper.readTree(bytes);
            if (root == null || !root.isObject() || !root.path("storageSchemaVersion").isIntegralNumber()
                    || !root.path("storageSchemaVersion").canConvertToInt() || root.get("storageSchemaVersion").intValue() != 14)
                throw new IOException("Unsupported graph storage schema; expected isolated wrapper 14");
            // Decode original tokens after the metadata probe so BigDecimal scale is preserved.
            Snapshot restored = mapper.readValue(bytes, Snapshot.class);
            GraphApprovalService.validateSnapshot(restored);
            return restored;
        } catch (IllegalArgumentException failure) { throw new IOException("Corrupt graph snapshot", failure); }
    }

    @Override public synchronized Snapshot snapshot() throws IOException { ensureOpen(); return state; }

    @Override public synchronized boolean saveDraft(long expectedRevision, Draft next) throws IOException {
        ensureOpen();
        if (state.draft().revision() != expectedRevision) return false;
        if (expectedRevision == Long.MAX_VALUE || next.revision() != expectedRevision + 1
                || next.baseVersion() != state.definition().version())
            throw new IllegalArgumentException("Invalid graph draft revision transition");
        commit(new Snapshot(14, state.definition(), next, state.requests()));
        return true;
    }

    @Override public synchronized boolean publish(int expectedVersion, long expectedDraftRevision, GraphDefinition next) throws IOException {
        ensureOpen();
        if (state.definition().version() != expectedVersion || state.draft().revision() != expectedDraftRevision) return false;
        GraphDefinition.validate(next);
        requirePublication(state, expectedVersion, expectedDraftRevision, next);
        commit(new Snapshot(14, next, new Draft(expectedDraftRevision + 1, next.version(), next), state.requests()));
        return true;
    }

    /** Shared by adapters: a publication is precisely the saved draft at a consecutive version. */
    public static void requirePublication(Snapshot before, int expectedVersion, long expectedDraftRevision, GraphDefinition next) {
        GraphDefinition draft = before.draft().definition();
        if (expectedVersion == Integer.MAX_VALUE || expectedDraftRevision == Long.MAX_VALUE
                || next.version() != expectedVersion + 1 || !next.id().equals(before.definition().id())
                || !next.equals(new GraphDefinition(draft.schemaVersion(), draft.id(), next.version(), draft.name(), draft.nodes(), draft.edges())))
            throw new IllegalArgumentException("Publication must promote the exact saved graph draft");
    }

    @Override public synchronized boolean create(int expectedVersion, GraphInstance instance) throws IOException {
        ensureOpen();
        if (state.definition().version() != expectedVersion) return false;
        GraphEngine.validateInstance(instance);
        if (state.requests().stream().anyMatch(row -> row.id().equals(instance.id())
                || (row.applicantId().equals(instance.applicantId()) && row.submissionKey().equals(instance.submissionKey())))) return false;
        if (instance.commandRevision() != 0 || !instance.commands().isEmpty() || !instance.definition().equals(state.definition()))
            throw new IllegalArgumentException("New graph request must use the published definition and no commands");
        var requests = new ArrayList<>(state.requests()); requests.add(instance);
        commit(new Snapshot(14, state.definition(), state.draft(), List.copyOf(requests)));
        return true;
    }

    @Override public synchronized boolean replace(String id, long expectedRevision, GraphInstance next) throws IOException {
        ensureOpen();
        var requests = new ArrayList<>(state.requests());
        for (int i = 0; i < requests.size(); i++) {
            GraphInstance before = requests.get(i);
            if (!before.id().equals(id)) continue;
            if (before.commandRevision() != expectedRevision) return false;
            if (!id.equals(next.id())) throw new IllegalArgumentException("Graph request identity cannot change");
            GraphEngine.validateInstance(next);
            GraphEngine.validateTransition(before, next);
            requests.set(i, next);
            commit(new Snapshot(14, state.definition(), state.draft(), List.copyOf(requests)));
            return true;
        }
        return false;
    }

    private void commit(Snapshot next) throws IOException {
        GraphApprovalService.validateSnapshot(next);
        byte[] bytes = mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(next);
        Path temporary = Files.createTempFile(file.getParent(), file.getFileName().toString(), ".tmp");
        try {
            try { Files.setPosixFilePermissions(temporary, PosixFilePermissions.fromString("rw-------")); }
            catch (UnsupportedOperationException ignored) { /* Non-POSIX systems retain their host permissions. */ }
            try (FileChannel output = FileChannel.open(temporary, StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING)) {
                ByteBuffer buffer = ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) output.write(buffer);
                output.force(true);
            }
            // No non-atomic fallback: failure leaves the previous valid snapshot untouched.
            Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            state = next;
            // The rename is already visible. A failed directory flush is an uncertain acknowledgement;
            // callers must reread before retrying, while the in-process state remains the committed one.
            try (FileChannel directory = FileChannel.open(file.getParent(), StandardOpenOption.READ)) { directory.force(true); }
        } finally { Files.deleteIfExists(temporary); }
    }

    private void ensureOpen() throws IOException { if (closed) throw new IOException("Graph store is closed"); }

    @Override public synchronized void close() throws IOException {
        if (closed) return;
        closed = true;
        try { lock.release(); } finally { lockChannel.close(); }
    }
}
