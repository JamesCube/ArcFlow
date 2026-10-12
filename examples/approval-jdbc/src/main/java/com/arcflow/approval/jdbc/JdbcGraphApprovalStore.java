package com.arcflow.approval.jdbc;

import com.arcflow.approval.graph.GraphApprovalService;
import com.arcflow.approval.graph.GraphApprovalStore;
import com.arcflow.approval.graph.GraphDefinition;
import com.arcflow.approval.graph.GraphEngine;
import com.arcflow.approval.graph.GraphInstance;
import com.arcflow.approval.graph.JsonGraphApprovalStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.sql.DataSource;

/**
 * Isolated schema-1 graph adapter. Hosts explicitly install graph-schema-*.sql and own the pool.
 * No DDL, legacy reads/writes, or automatic migrations. Every operation owns its transaction.
 */
public final class JdbcGraphApprovalStore implements GraphApprovalStore {
    private static final Set<String> TABLES = Set.of("arc_graph_schema", "arc_graph_version", "arc_graph_head",
        "arc_graph_request", "arc_graph_event", "arc_graph_command", "arc_graph_task", "arc_graph_task_member", "arc_graph_request_member");
    private static final String REQUEST_COLUMNS = "request_id, process_id, process_version, command_revision, applicant_id, submission_key, request_status, created_at, updated_at, request_json";
    private final DataSource dataSource;
    private final ObjectMapper mapper;
    private final String processId;
    private final String dialect;
    private final AtomicBoolean closed = new AtomicBoolean();
    private record Flags(boolean pending, boolean handled) {
        Flags or(Flags other) { return new Flags(pending || other.pending, handled || other.handled); }
    }
    private record TaskMember(String taskId, String actorId) {}

    public JdbcGraphApprovalStore(DataSource source, ObjectMapper mapper, GraphDefinition initial) throws IOException {
        GraphDefinition.validate(initial);
        this.dataSource = Objects.requireNonNull(source);
        this.mapper = GraphApprovalService.strictMapper(Objects.requireNonNull(mapper).copy());
        this.processId = initial.id();
        try (var connection = source.getConnection()) {
            requireOwned(connection);
            dialect = inspect(connection);
            requireSchema(connection);
        } catch (SQLException failure) { throw new IOException("Install the explicit graph schema before opening the graph store", failure); }
        initialize(initial);
        snapshot(); // Fail closed on corrupt audit/projections before accepting traffic.
    }

    private static String inspect(Connection connection) throws SQLException, IOException {
        var metadata = connection.getMetaData();
        String product = metadata.getDatabaseProductName();
        if ("H2".equals(product) || "PostgreSQL".equals(product)) return product;
        if (!"MySQL".equals(product) || metadata.getDatabaseMajorVersion() != 8
                || !metadata.getDatabaseProductVersion().matches("8\\.(?:[1-9][0-9]*\\.[0-9]+|0\\.(?:1[7-9]|[2-9][0-9]|[1-9][0-9]{2,}))(?:[-+].*)?"))
            throw new IOException("Graph SQL supports H2, PostgreSQL and Oracle MySQL 8.0.17+ in the 8.x series");
        Set<String> found = new HashSet<>();
        try (var statement = connection.createStatement(); var rows = statement.executeQuery(
                "SELECT table_name, engine, table_collation FROM information_schema.tables WHERE table_schema = DATABASE()")) {
            while (rows.next()) if (TABLES.contains(rows.getString(1))) {
                found.add(rows.getString(1));
                if (!"InnoDB".equalsIgnoreCase(rows.getString(2)) || !"utf8mb4_0900_bin".equals(rows.getString(3)))
                    throw new IOException("Graph MySQL tables require InnoDB and utf8mb4_0900_bin");
            }
        }
        if (!found.equals(TABLES)) throw new IOException("Missing graph tables; explicitly install graph-schema-mysql.sql");
        try (var statement = connection.createStatement(); var rows = statement.executeQuery(
                "SELECT table_name, column_name, data_type, collation_name FROM information_schema.columns WHERE table_schema = DATABASE()")) {
            while (rows.next()) if (TABLES.contains(rows.getString(1))) {
                if (rows.getString(4) != null && !"utf8mb4_0900_bin".equals(rows.getString(4)))
                    throw new IOException("Graph MySQL text columns require exact binary collation");
                if (rows.getString(2).endsWith("_json") && !"longtext".equalsIgnoreCase(rows.getString(3)))
                    throw new IOException("Graph MySQL JSON columns require LONGTEXT");
            }
        }
        return product;
    }

    private static void requireSchema(Connection c) throws SQLException, IOException {
        try (var statement = c.createStatement(); var rows = statement.executeQuery("SELECT singleton, schema_version FROM arc_graph_schema")) {
            if (!rows.next() || rows.getInt(1) != 1 || rows.getInt(2) != 1 || rows.next())
                throw new IOException("Unsupported graph SQL schema; expected exactly version 1");
        }
        // Empty installations must expose every required column before the first write.
        for (String probe : List.of("SELECT process_id, process_version, definition_json FROM arc_graph_version",
                "SELECT process_id, active_version, draft_revision, draft_base_version, draft_json FROM arc_graph_head",
                "SELECT " + REQUEST_COLUMNS + " FROM arc_graph_request",
                "SELECT request_id, event_sequence, event_json FROM arc_graph_event",
                "SELECT request_id, command_id, command_revision, command_json FROM arc_graph_command",
                "SELECT request_id, task_id, node_id, task_status, task_json FROM arc_graph_task",
                "SELECT request_id, task_id, actor_id, pending, handled FROM arc_graph_task_member",
                "SELECT request_id, actor_id, pending, handled FROM arc_graph_request_member")) {
            try (var statement = c.createStatement(); var ignored = statement.executeQuery(probe + " WHERE 1 = 0")) { }
        }
    }

    private void initialize(GraphDefinition initial) throws IOException {
        try {
            transaction(false, c -> {
                if (head(c, true) != null) return null;
                insertVersion(c, initial);
                try (var s = c.prepareStatement("INSERT INTO arc_graph_head (process_id, active_version, draft_revision, draft_base_version, draft_json) VALUES (?, ?, ?, ?, ?)")) {
                    s.setString(1, processId); s.setInt(2, initial.version()); s.setLong(3, 0);
                    s.setInt(4, initial.version()); s.setString(5, json(new Draft(0, initial.version(), initial))); s.executeUpdate();
                }
                return null;
            });
        } catch (IOException failure) {
            if (!cleanDuplicate(failure)) throw failure;
            try { transaction(true, c -> { if (head(c, false) == null) throw new IOException("Incomplete graph initialization"); return null; }); }
            catch (IOException verification) { failure.addSuppressed(verification); throw failure; }
        }
    }

    @Override public Snapshot snapshot() throws IOException {
        return transaction(true, c -> {
            Snapshot head = requireHead(c, false);
            var requests = new ArrayList<GraphInstance>();
            var ids = new ArrayList<String>();
            try (var s = c.prepareStatement("SELECT request_id FROM arc_graph_request WHERE process_id = ? ORDER BY created_at, request_id")) {
                s.setString(1, processId); try (var rows = s.executeQuery()) { while (rows.next()) ids.add(rows.getString(1)); }
            }
            for (String id : ids) {
                GraphInstance request = readRequest(c, id, false);
                if (request == null) throw new IOException("Graph request disappeared from read snapshot");
                requests.add(request);
            }
            Snapshot result = new Snapshot(14, head.definition(), head.draft(), List.copyOf(requests));
            validateSnapshot(result);
            return result;
        });
    }

    @Override public boolean saveDraft(long expectedRevision, Draft next) throws IOException {
        return transaction(false, c -> {
            Snapshot before = requireHead(c, true);
            if (before.draft().revision() != expectedRevision) return false;
            if (expectedRevision == Long.MAX_VALUE || next.revision() != expectedRevision + 1
                    || next.baseVersion() != before.definition().version()) throw new IllegalArgumentException("Invalid graph draft transition");
            GraphApprovalService.validateSnapshot(new Snapshot(14, before.definition(), next, List.of()));
            try (var s = c.prepareStatement("UPDATE arc_graph_head SET draft_revision = ?, draft_base_version = ?, draft_json = ? WHERE process_id = ? AND draft_revision = ?")) {
                s.setLong(1, next.revision()); s.setInt(2, next.baseVersion()); s.setString(3, json(next));
                s.setString(4, processId); s.setLong(5, expectedRevision);
                if (s.executeUpdate() != 1) throw new IOException("Locked graph draft changed unexpectedly");
            }
            return true;
        });
    }

    @Override public boolean publish(int expectedVersion, long expectedDraftRevision, GraphDefinition next) throws IOException {
        GraphDefinition.validate(next);
        return transaction(false, c -> {
            Snapshot before = requireHead(c, true);
            if (before.definition().version() != expectedVersion || before.draft().revision() != expectedDraftRevision) return false;
            JsonGraphApprovalStore.requirePublication(before, expectedVersion, expectedDraftRevision, next);
            insertVersion(c, next);
            Draft draft = new Draft(expectedDraftRevision + 1, next.version(), next);
            try (var s = c.prepareStatement("UPDATE arc_graph_head SET active_version = ?, draft_revision = ?, draft_base_version = ?, draft_json = ? WHERE process_id = ? AND active_version = ? AND draft_revision = ?")) {
                s.setInt(1, next.version()); s.setLong(2, draft.revision()); s.setInt(3, next.version()); s.setString(4, json(draft));
                s.setString(5, processId); s.setInt(6, expectedVersion); s.setLong(7, expectedDraftRevision);
                if (s.executeUpdate() != 1) throw new IOException("Locked graph publication changed unexpectedly");
            }
            return true;
        });
    }

    @Override public boolean create(int expectedVersion, GraphInstance instance) throws IOException {
        GraphEngine.validateInstance(instance);
        if (!processId.equals(instance.definition().id()) || instance.commandRevision() != 0 || !instance.commands().isEmpty())
            throw new IllegalArgumentException("Invalid new graph request");
        try {
            return transaction(false, c -> {
                Snapshot before = requireHead(c, true); // Shared publisher/creator lock across instances.
                if (before.definition().version() != expectedVersion) return false;
                if (!instance.definition().equals(before.definition())) throw new IllegalArgumentException("New request must freeze current publication");
                try (var s = c.prepareStatement("SELECT request_id FROM arc_graph_request WHERE request_id = ? OR (process_id = ? AND applicant_id = ? AND submission_key = ?)")) {
                    s.setString(1, instance.id()); s.setString(2, processId); s.setString(3, instance.applicantId()); s.setString(4, instance.submissionKey());
                    try (var rows = s.executeQuery()) { if (rows.next()) return false; }
                }
                try (var s = c.prepareStatement("INSERT INTO arc_graph_request (" + REQUEST_COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")) {
                    s.setString(1, instance.id()); s.setString(2, processId); s.setInt(3, instance.definition().version());
                    s.setLong(4, instance.commandRevision()); s.setString(5, instance.applicantId()); s.setString(6, instance.submissionKey());
                    s.setString(7, instance.status()); s.setString(8, instance.createdAt()); s.setString(9, instance.updatedAt()); s.setString(10, json(instance)); s.executeUpdate();
                }
                appendAudit(c, instance, 0, 0);
                writeProjections(c, instance);
                return true;
            });
        } catch (IOException failure) {
            // Only duplicate request/key races from another process scope may be ordinary conflicts.
            if (!cleanDuplicate(failure)) throw failure;
            return transaction(true, c -> {
                try (var s = c.prepareStatement("SELECT request_id FROM arc_graph_request WHERE request_id = ? OR (process_id = ? AND applicant_id = ? AND submission_key = ?)")) {
                    s.setString(1, instance.id()); s.setString(2, processId); s.setString(3, instance.applicantId()); s.setString(4, instance.submissionKey());
                    try (var rows = s.executeQuery()) { if (rows.next()) return false; }
                }
                throw failure;
            });
        }
    }

    @Override public boolean replace(String id, long expectedRevision, GraphInstance next) throws IOException {
        if (!id.equals(next.id()) || !processId.equals(next.definition().id())) throw new IllegalArgumentException("Graph request identity cannot change");
        GraphEngine.validateInstance(next);
        return transaction(false, c -> {
            GraphInstance before = readRequest(c, id, true);
            if (before == null || before.commandRevision() != expectedRevision) return false;
            GraphEngine.validateTransition(before, next);
            try (var s = c.prepareStatement("UPDATE arc_graph_request SET command_revision = ?, request_status = ?, updated_at = ?, request_json = ? WHERE request_id = ? AND process_id = ? AND command_revision = ?")) {
                s.setLong(1, next.commandRevision()); s.setString(2, next.status()); s.setString(3, next.updatedAt()); s.setString(4, json(next));
                s.setString(5, id); s.setString(6, processId); s.setLong(7, expectedRevision);
                if (s.executeUpdate() != 1) return false;
            }
            appendAudit(c, next, before.events().size(), before.commands().size());
            writeProjections(c, next);
            return true;
        });
    }

    private Snapshot head(Connection c, boolean lock) throws SQLException, IOException {
        try (var s = c.prepareStatement("SELECT active_version, draft_revision, draft_base_version, draft_json FROM arc_graph_head WHERE process_id = ?" + (lock ? " FOR UPDATE" : ""))) {
            s.setString(1, processId); try (var rows = s.executeQuery()) {
                if (!rows.next()) return null;
                int version = rows.getInt(1); long revision = rows.getLong(2); int base = rows.getInt(3);
                Draft draft = decode(rows.getString(4), Draft.class);
                if (draft.revision() != revision || draft.baseVersion() != base || rows.next()) throw new IOException("Corrupt graph draft projection");
                Snapshot result = new Snapshot(14, version(c, version), draft, List.of()); validateSnapshot(result); return result;
            }
        }
    }
    private Snapshot requireHead(Connection c, boolean lock) throws SQLException, IOException {
        Snapshot result = head(c, lock); if (result == null) throw new IOException("Missing graph process head"); return result;
    }
    private GraphDefinition version(Connection c, int number) throws SQLException, IOException {
        try (var s = c.prepareStatement("SELECT definition_json FROM arc_graph_version WHERE process_id = ? AND process_version = ?")) {
            s.setString(1, processId); s.setInt(2, number); try (var rows = s.executeQuery()) {
                if (!rows.next()) throw new IOException("Missing frozen graph version");
                GraphDefinition definition = decode(rows.getString(1), GraphDefinition.class);
                if (definition.version() != number || !processId.equals(definition.id()) || rows.next()) throw new IOException("Corrupt graph version identity");
                try { GraphDefinition.validate(definition); } catch (RuntimeException failure) { throw new IOException("Corrupt published graph", failure); }
                return definition;
            }
        }
    }
    private void insertVersion(Connection c, GraphDefinition definition) throws SQLException, IOException {
        try (var s = c.prepareStatement("INSERT INTO arc_graph_version (process_id, process_version, definition_json) VALUES (?, ?, ?)")) {
            s.setString(1, processId); s.setInt(2, definition.version()); s.setString(3, json(definition)); s.executeUpdate();
        }
    }

    private GraphInstance readRequest(Connection c, String id, boolean lock) throws SQLException, IOException {
        GraphInstance request;
        try (var s = c.prepareStatement("SELECT " + REQUEST_COLUMNS + " FROM arc_graph_request WHERE request_id = ? AND process_id = ?" + (lock ? " FOR UPDATE" : ""))) {
            s.setString(1, id); s.setString(2, processId); try (var rows = s.executeQuery()) {
                if (!rows.next()) return null;
                request = decode(rows.getString(10), GraphInstance.class);
                if (!id.equals(request.id()) || !processId.equals(rows.getString(2)) || request.definition().version() != rows.getInt(3)
                        || request.commandRevision() != rows.getLong(4) || !request.applicantId().equals(rows.getString(5))
                        || !request.submissionKey().equals(rows.getString(6)) || !request.status().equals(rows.getString(7))
                        || !request.createdAt().equals(rows.getString(8)) || !request.updatedAt().equals(rows.getString(9)) || rows.next())
                    throw new IOException("Corrupt graph request projection");
            }
        }
        try { GraphEngine.validateInstance(request); } catch (RuntimeException failure) { throw new IOException("Corrupt graph replay", failure); }
        if (!version(c, request.definition().version()).equals(request.definition())) throw new IOException("Frozen graph definition differs from published version");
        verifyAudit(c, request); verifyProjections(c, request);
        return request;
    }

    private void appendAudit(Connection c, GraphInstance request, int eventsBefore, int commandsBefore) throws SQLException, IOException {
        for (int i = eventsBefore; i < request.events().size(); i++) {
            var event = request.events().get(i);
            try (var s = c.prepareStatement("INSERT INTO arc_graph_event (request_id, event_sequence, event_json) VALUES (?, ?, ?)")) {
                s.setString(1, request.id()); s.setLong(2, event.sequence()); s.setString(3, json(event)); s.executeUpdate();
            }
        }
        for (int i = commandsBefore; i < request.commands().size(); i++) {
            var command = request.commands().get(i);
            try (var s = c.prepareStatement("INSERT INTO arc_graph_command (request_id, command_id, command_revision, command_json) VALUES (?, ?, ?, ?)")) {
                s.setString(1, request.id()); s.setString(2, command.id()); s.setLong(3, i + 1L); s.setString(4, json(command)); s.executeUpdate();
            }
        }
    }
    private void verifyAudit(Connection c, GraphInstance request) throws SQLException, IOException {
        var events = new ArrayList<GraphInstance.Event>();
        try (var s = c.prepareStatement("SELECT event_sequence, event_json FROM arc_graph_event WHERE request_id = ? ORDER BY event_sequence")) {
            s.setString(1, request.id()); try (var rows = s.executeQuery()) { while (rows.next()) {
                var event = decode(rows.getString(2), GraphInstance.Event.class);
                if (event.sequence() != rows.getLong(1)) throw new IOException("Corrupt graph event sequence"); events.add(event);
            } }
        }
        var commands = new ArrayList<GraphInstance.Command>();
        try (var s = c.prepareStatement("SELECT command_id, command_revision, command_json FROM arc_graph_command WHERE request_id = ? ORDER BY command_revision")) {
            s.setString(1, request.id()); try (var rows = s.executeQuery()) { while (rows.next()) {
                var command = decode(rows.getString(3), GraphInstance.Command.class);
                if (!command.id().equals(rows.getString(1)) || rows.getLong(2) != commands.size() + 1L) throw new IOException("Corrupt graph command projection"); commands.add(command);
            } }
        }
        if (!events.equals(request.events()) || !commands.equals(request.commands())) throw new IOException("Graph audit does not match durable request");
    }

    private Map<TaskMember, Flags> taskMembers(GraphInstance request) {
        Map<TaskMember, Flags> result = new LinkedHashMap<>();
        for (var task : request.tasks()) for (String actor : task.participants()) {
            boolean voted = task.votes().stream().anyMatch(vote -> vote.actorId().equals(actor));
            result.put(new TaskMember(task.id(), actor), new Flags("ACTIVE".equals(task.status()) && !voted, voted));
        }
        return result;
    }
    private Map<String, Flags> requestMembers(GraphInstance request) {
        Map<String, Flags> result = new LinkedHashMap<>(); result.put(request.applicantId(), new Flags(false, false));
        Map<String, String> routes = new HashMap<>(); request.routes().forEach(route -> routes.put(route.gatewayId(), route.selectedEdgeId()));
        Set<String> seen = new HashSet<>(); var pending = new ArrayList<String>();
        request.definition().nodes().stream().filter(n -> "start".equals(n.type())).forEach(n -> pending.add(n.id()));
        while (!pending.isEmpty()) {
            String id = pending.remove(pending.size() - 1); if (!seen.add(id)) continue;
            var node = request.definition().node(id); node.assigneeIds().forEach(actor -> result.putIfAbsent(actor, new Flags(false, false)));
            for (var edge : request.definition().outgoing(id)) if (!"exclusiveGateway".equals(node.type()) || edge.id().equals(routes.get(id))) pending.add(edge.target());
        }
        taskMembers(request).forEach((member, flags) -> result.merge(member.actorId(), flags, Flags::or));
        return result;
    }
    private void writeProjections(Connection c, GraphInstance request) throws SQLException, IOException {
        for (String table : List.of("arc_graph_task_member", "arc_graph_task", "arc_graph_request_member")) {
            try (var s = c.prepareStatement("DELETE FROM " + table + " WHERE request_id = ?")) { s.setString(1, request.id()); s.executeUpdate(); }
        }
        for (var task : request.tasks()) try (var s = c.prepareStatement("INSERT INTO arc_graph_task (request_id, task_id, node_id, task_status, task_json) VALUES (?, ?, ?, ?, ?)")) {
            s.setString(1, request.id()); s.setString(2, task.id()); s.setString(3, task.nodeId()); s.setString(4, task.status()); s.setString(5, json(task)); s.executeUpdate();
        }
        for (var entry : taskMembers(request).entrySet()) try (var s = c.prepareStatement("INSERT INTO arc_graph_task_member (request_id, task_id, actor_id, pending, handled) VALUES (?, ?, ?, ?, ?)")) {
            s.setString(1, request.id()); s.setString(2, entry.getKey().taskId()); s.setString(3, entry.getKey().actorId());
            s.setBoolean(4, entry.getValue().pending()); s.setBoolean(5, entry.getValue().handled()); s.executeUpdate();
        }
        for (var entry : requestMembers(request).entrySet()) try (var s = c.prepareStatement("INSERT INTO arc_graph_request_member (request_id, actor_id, pending, handled) VALUES (?, ?, ?, ?)")) {
            s.setString(1, request.id()); s.setString(2, entry.getKey()); s.setBoolean(3, entry.getValue().pending()); s.setBoolean(4, entry.getValue().handled()); s.executeUpdate();
        }
    }
    private void verifyProjections(Connection c, GraphInstance request) throws SQLException, IOException {
        Map<String, GraphInstance.Task> tasks = new HashMap<>();
        try (var s = c.prepareStatement("SELECT task_id, node_id, task_status, task_json FROM arc_graph_task WHERE request_id = ?")) {
            s.setString(1, request.id()); try (var rows = s.executeQuery()) { while (rows.next()) {
                var task = decode(rows.getString(4), GraphInstance.Task.class);
                if (!task.id().equals(rows.getString(1)) || !task.nodeId().equals(rows.getString(2)) || !task.status().equals(rows.getString(3)) || tasks.put(task.id(), task) != null)
                    throw new IOException("Corrupt graph task projection");
            } }
        }
        Map<String, GraphInstance.Task> expected = new HashMap<>(); request.tasks().forEach(task -> expected.put(task.id(), task));
        if (!tasks.equals(expected)) throw new IOException("Graph task projection does not match request");
        Map<TaskMember, Flags> taskMembers = new HashMap<>();
        try (var s = c.prepareStatement("SELECT task_id, actor_id, pending, handled FROM arc_graph_task_member WHERE request_id = ?")) {
            s.setString(1, request.id()); try (var rows = s.executeQuery()) { while (rows.next())
                if (taskMembers.put(new TaskMember(rows.getString(1), rows.getString(2)), new Flags(rows.getBoolean(3), rows.getBoolean(4))) != null)
                    throw new IOException("Duplicate task member projection"); }
        }
        Map<String, Flags> members = new HashMap<>();
        try (var s = c.prepareStatement("SELECT actor_id, pending, handled FROM arc_graph_request_member WHERE request_id = ?")) {
            s.setString(1, request.id()); try (var rows = s.executeQuery()) { while (rows.next())
                if (members.put(rows.getString(1), new Flags(rows.getBoolean(2), rows.getBoolean(3))) != null) throw new IOException("Duplicate request member projection"); }
        }
        if (!taskMembers.equals(taskMembers(request)) || !members.equals(requestMembers(request))) throw new IOException("Graph membership projections do not match request");
    }

    private String json(Object value) throws IOException { return mapper.writeValueAsString(value); }
    private <T> T decode(String value, Class<T> type) throws IOException {
        try { return mapper.readValue(value, type); }
        catch (RuntimeException failure) { throw new IOException("Corrupt graph JSON", failure); }
    }
    private static void validateSnapshot(Snapshot snapshot) throws IOException {
        try { GraphApprovalService.validateSnapshot(snapshot); }
        catch (RuntimeException failure) { throw new IOException("Corrupt graph snapshot", failure); }
    }
    private boolean cleanDuplicate(IOException failure) {
        return failure.getSuppressed().length == 0 && failure.getCause() instanceof SQLException sql
            && sql.getSuppressed().length == 0 && sql.getNextException() == null
            && ("MySQL".equals(dialect) ? "23000".equals(sql.getSQLState()) && sql.getErrorCode() == 1062 : "23505".equals(sql.getSQLState()));
    }
    private static void requireOwned(Connection c) throws SQLException, IOException {
        if (!c.getAutoCommit()) throw new IOException("Graph store requires independently owned auto-commit connections; ambient transactions are unsupported");
    }
    @FunctionalInterface private interface Work<T> { T run(Connection c) throws SQLException, IOException; }
    private <T> T transaction(boolean read, Work<T> work) throws IOException {
        if (closed.get()) throw new IOException("Graph store is closed");
        try (Connection c = dataSource.getConnection()) {
            requireOwned(c); int isolation = c.getTransactionIsolation(); boolean active = false; Throwable failed = null;
            try {
                c.setTransactionIsolation(read ? ("H2".equals(dialect) ? Connection.TRANSACTION_SERIALIZABLE : Connection.TRANSACTION_REPEATABLE_READ) : Connection.TRANSACTION_READ_COMMITTED);
                c.setAutoCommit(false); active = true;
                // Metadata is checked on every operation; an incompatible deployment cannot continue writing.
                try (var s = c.createStatement(); var rows = s.executeQuery("SELECT singleton, schema_version FROM arc_graph_schema")) {
                    if (!rows.next() || rows.getInt(1) != 1 || rows.getInt(2) != 1 || rows.next()) throw new IOException("Unsupported graph SQL schema");
                }
                T result = work.run(c); c.commit(); active = false; return result;
            } catch (SQLException | IOException | RuntimeException | Error failure) {
                failed = failure;
                if (active) try { c.rollback(); active = false; } catch (SQLException rollback) { failure.addSuppressed(rollback); }
                throw failure;
            } finally {
                if (!active) try { c.setAutoCommit(true); c.setTransactionIsolation(isolation); }
                catch (SQLException reset) { if (failed != null) failed.addSuppressed(reset); else throw new IOException("Graph commit completed but connection cleanup failed; reread before retry", reset); }
            }
        } catch (SQLException failure) { throw new IOException("Graph JDBC operation failed; reread before retry", failure); }
    }
    @Override public void close() { closed.set(true); }
}
