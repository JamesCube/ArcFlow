package com.arcflow.approval.jdbc;

import com.arcflow.approval.ApprovalService;
import com.arcflow.approval.ApprovalService.Event;
import com.arcflow.approval.ApprovalService.Request;
import com.arcflow.approval.ApprovalStore;
import com.arcflow.approval.InboxQuery;
import com.arcflow.approval.ProcessDefinition;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.sql.DataSource;

/**
 * Optional, standalone JDBC persistence. The host installs the schema and owns the DataSource.
 * Each operation borrows its own auto-commit connection and owns its transaction; this adapter
 * deliberately does not participate in a host/Spring transaction. No schema DDL is executed here.
 */
public final class JdbcApprovalStore implements ApprovalStore {
    private static final String REQUEST_COLUMNS = "request_id, process_id, process_version, revision, "
        + "applicant_id, approver_id, request_status, current_step_id, created_at, updated_at, request_json";
    private static final String MEMBER_COLUMNS = "request_id, actor_id, actor_key, pending, handled, revision, "
        + "request_status, process_version, created_seconds, created_nanos, request_sort_key, process_id";
    private final DataSource dataSource;
    private final String processId;
    private final ObjectMapper mapper;
    private final JdbcDialect dialect;
    private final AtomicBoolean closed = new AtomicBoolean();

    /** First successful initializer wins per process; subsequent instances use its persisted definition. */
    public JdbcApprovalStore(DataSource dataSource, ObjectMapper mapper, ProcessDefinition initialDefinition) throws IOException {
        this(dataSource, mapper, validatedProcessId(initialDefinition));
        transaction(true, connection -> { requireMembersReady(connection); return null; });
        initialize(initialDefinition);
    }

    private static String validatedProcessId(ProcessDefinition definition) {
        ProcessDefinition.validate(definition);
        return definition.id();
    }

    // A null process scope is used only by explicit, database-wide migration, never an application store.
    private JdbcApprovalStore(DataSource dataSource, ObjectMapper mapper, String processId) throws IOException {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource");
        this.processId = processId;
        this.mapper = ApprovalService.strictMapper(Objects.requireNonNull(mapper, "mapper").copy())
            .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
            .setSerializationInclusion(JsonInclude.Include.ALWAYS);
        try (var connection = dataSource.getConnection()) {
            if (!connection.getAutoCommit())
                throw new IOException("JdbcApprovalStore requires independently owned auto-commit connections; ambient transactions are unsupported");
            dialect = JdbcDialect.inspect(connection);
            // An old installation must be explicitly migrated before any initializer can write.
            try (var statement = connection.prepareStatement(
                    "SELECT applicant_id, submission_key, request_id FROM arc_submission_key WHERE 1 = 0");
                 var ignored = statement.executeQuery()) { /* schema probe only; never DDL */ }
        } catch (SQLException failure) { throw new IOException("Could not inspect approval JDBC dialect/schema", failure); }
        // Probe every required revision-3 column even if there are no member rows yet.
        try (var connection = dataSource.getConnection();
             var statement = connection.prepareStatement("SELECT " + MEMBER_COLUMNS + " FROM arc_request_member WHERE 1 = 0");
             var ignored = statement.executeQuery()) { /* host migration only */ }
        catch (SQLException failure) { throw new IOException("Missing approval SQL revision 3 member projection", failure); }
    }

    @Override public ProcessDefinition process() throws IOException {
        return transaction(true, connection -> requireProcess(connection, false));
    }

    @Override public List<Request> requests() throws IOException {
        return transaction(true, connection -> {
            // Read state, audit and retained definitions from one repeatable-read snapshot.
            var result = new ArrayList<Request>();
            var ids = new ArrayList<String>();
            try (var statement = connection.prepareStatement("SELECT request_id FROM arc_request WHERE process_id = ? ORDER BY created_at, request_id")) {
                statement.setString(1, processId);
                try (var rows = statement.executeQuery()) {
                    while (rows.next()) ids.add(rows.getString(1));
                }
            }
            for (String id : ids) {
                Request request = readRequest(connection, id, false);
                if (request == null) throw new IOException("Request disappeared inside its read snapshot");
                result.add(request);
            }
            return List.copyOf(result);
        });
    }

    @Override public Request request(String id) throws IOException {
        Objects.requireNonNull(id, "id");
        return transaction(true, connection -> readRequest(connection, id, false));
    }

    @Override public boolean publish(String actor, int expectedVersion, ProcessDefinition next) throws IOException {
        ProcessDefinition.validate(next);
        if (!processId.equals(next.id())) throw new IllegalArgumentException("Publication cannot change the configured process ID");
        if (!ProcessDefinition.validActorId(actor) || expectedVersion < 1 || expectedVersion == Integer.MAX_VALUE ||
            next.version() != expectedVersion + 1)
            throw new IllegalArgumentException("Publication requires an actor and the next consecutive version");
        return transaction(false, connection -> {
            ProcessDefinition current = requireProcess(connection, true);
            if (current.version() != expectedVersion) return false;
            insertVersion(connection, next, actor);
            try (var statement = connection.prepareStatement(
                    "UPDATE arc_process_head SET active_version = ? WHERE process_id = ? AND active_version = ?")) {
                statement.setInt(1, next.version());
                statement.setString(2, processId);
                statement.setInt(3, expectedVersion);
                if (statement.executeUpdate() != 1) throw new IOException("Locked process head changed unexpectedly");
            }
            return true;
        });
    }

    @Override public Request submission(String actor, String key) throws IOException {
        validateSubmissionKey(actor, key);
        // Resolve the mapping and all request/audit/definition rows in one consistent snapshot.
        return transaction(true, connection -> readSubmission(connection, actor, key, false));
    }

    @Override public boolean create(int expectedProcessVersion, Request request) throws IOException {
        return create(expectedProcessVersion, request, null) != null;
    }

    @Override public Request create(int expectedProcessVersion, Request request, String key) throws IOException {
        ApprovalService.validateRequest(request);
        requireBoundProcess(request);
        if (key != null) validateSubmissionKey(request.applicantId(), key);
        if (request.history().size() != 1 || request.processVersion() != expectedProcessVersion)
            throw new IllegalArgumentException("A new request must have only its submission event and the expected process version");
        try {
            return transaction(false, connection -> {
                // Creators and publishers for this process share a lock across application instances.
                ProcessDefinition current = requireProcess(connection, true);
                if (key != null) {
                    // Lookup precedes the active-version check: publication cannot invalidate a retry.
                    // Lock the request so a concurrent decision cannot split its state/audit reads.
                    Request existing = readSubmission(connection, request.applicantId(), key, true);
                    if (existing != null) return existing;
                }
                if (current.version() != expectedProcessVersion) return null;
                if (!current.equals(request.definition()))
                    throw new IllegalArgumentException("Request definition differs from the published version");
                try (var statement = connection.prepareStatement("INSERT INTO arc_request (" + REQUEST_COLUMNS
                        + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")) {
                    bindRequest(statement, request);
                    statement.executeUpdate();
                }
                insertEvent(connection, request.id(), 0, request.history().get(0));
                insertMembers(connection, request);
                if (key != null) {
                    try (var statement = connection.prepareStatement("INSERT INTO arc_submission_key "
                            + "(applicant_id, submission_key, request_id) VALUES (?, ?, ?)")) {
                        statement.setString(1, request.applicantId());
                        statement.setString(2, key);
                        statement.setString(3, request.id());
                        try { statement.executeUpdate(); }
                        catch (SQLException failure) { throw new SubmissionKeyFailure(failure); }
                    }
                }
                return request;
            });
        } catch (IOException failure) {
            // Other processes have independent head locks but share the legacy applicant/key scope.
            // Reconcile only a duplicate from the key INSERT after a clean rollback and cleanup.
            // A duplicate request ID, unrelated constraint or uncertain transaction is still an error.
            if (!(failure instanceof SubmissionKeyFailure) || !dialect.cleanDuplicate(failure)) throw failure;
            Request winner;
            try { winner = transaction(true, connection -> readSubmission(connection, request.applicantId(), key, false)); }
            catch (IOException verification) { failure.addSuppressed(verification); throw failure; }
            if (winner == null) throw failure;
            return winner; // The service checks process identity and business intent before replaying.
        }
    }

    private static final class SubmissionKeyFailure extends IOException {
        private SubmissionKeyFailure(SQLException cause) { super("Could not bind submission key", cause); }
    }

    private void requireBoundProcess(Request request) {
        if (!processId.equals(request.processId()))
            throw new IllegalArgumentException("Request does not belong to the configured process");
    }

    private static void validateSubmissionKey(String actor, String key) {
        if (!ProcessDefinition.validActorId(actor) || !ApprovalService.validSubmissionKey(key))
            throw new IllegalArgumentException("Submission lookup requires an actor and a valid exact submission key");
    }

    private Request readSubmission(Connection connection, String actor, String key, boolean lock) throws SQLException, IOException {
        String id;
        try (var statement = connection.prepareStatement("SELECT applicant_id, submission_key, request_id "
                + "FROM arc_submission_key WHERE applicant_id = ? AND submission_key = ?")) {
            statement.setString(1, actor);
            statement.setString(2, key);
            try (var rows = statement.executeQuery()) {
                if (!rows.next()) return null;
                if (!actor.equals(rows.getString(1)) || !key.equals(rows.getString(2)))
                    throw new IOException("Submission key identity differs from its exact lookup");
                id = rows.getString(3);
                if (rows.next()) throw new IOException("Ambiguous persisted submission key");
            }
        }
        Request result = readRequest(connection, id, lock, false);
        if (result == null || !actor.equals(result.applicantId()))
            throw new IOException("Submission key does not belong to its referenced request applicant");
        return result;
    }

    @Override public boolean update(int expectedRevision, Request next) throws IOException {
        ApprovalService.validateRequest(next);
        requireBoundProcess(next);
        if (expectedRevision < 0 || next.history().size() - 2 != expectedRevision)
            throw new IllegalArgumentException("An update must append exactly one event to the expected revision");
        return transaction(false, connection -> {
            Request previous = readRequest(connection, next.id(), true);
            if (previous == null || previous.history().size() - 1 != expectedRevision) return false;
            ApprovalService.validateTransition(previous, next);
            try (var statement = connection.prepareStatement("UPDATE arc_request SET revision = ?, approver_id = ?, "
                    + "request_status = ?, current_step_id = ?, updated_at = ?, request_json = ? "
                    + "WHERE request_id = ? AND revision = ? AND process_id = ?")) {
                statement.setInt(1, expectedRevision + 1);
                statement.setString(2, next.approverId());
                statement.setString(3, next.status());
                statement.setString(4, next.currentStepId());
                statement.setString(5, next.updatedAt());
                statement.setString(6, mapper.writeValueAsString(next));
                statement.setString(7, next.id());
                statement.setInt(8, expectedRevision);
                statement.setString(9, processId);
                if (statement.executeUpdate() != 1) throw new IOException("Locked request revision changed unexpectedly");
            }
            insertEvent(connection, next.id(), expectedRevision + 1, next.history().get(expectedRevision + 1));
            updateMembers(connection, next);
            return true;
        });
    }

    private void initialize(ProcessDefinition initial) throws IOException {
        try {
            transaction(false, connection -> {
                if (readProcess(connection, true) != null) return null;
                insertVersion(connection, initial, "bootstrap");
                try (var statement = connection.prepareStatement("INSERT INTO arc_process_head (process_id, active_version) VALUES (?, ?)")) {
                    statement.setString(1, processId);
                    statement.setInt(2, initial.version());
                    statement.executeUpdate();
                }
                return null;
            });
        } catch (IOException failure) {
            // The only accepted initialization race is a duplicate key from another initializer.
            // Rollback already happened; verify a complete committed head in a fresh transaction.
            // Do not retry an insert, a connection failure, serialization failure, or other SQL error.
            if (!dialect.cleanDuplicate(failure)) throw failure;
            try { transaction(true, connection -> requireProcess(connection, false)); }
            catch (IOException verification) { failure.addSuppressed(verification); throw failure; }
        }
    }

    private ProcessDefinition requireProcess(Connection connection, boolean lock) throws SQLException, IOException {
        ProcessDefinition result = readProcess(connection, lock);
        if (result == null) throw new IOException("Missing active approval process");
        return result;
    }

    private ProcessDefinition readProcess(Connection connection, boolean lock) throws SQLException, IOException {
        // Lock only the head (not immutable version rows); publication and submission share it.
        Integer version = null;
        try (var statement = connection.prepareStatement(
                "SELECT active_version FROM arc_process_head WHERE process_id = ?" + (lock ? " FOR UPDATE" : ""))) {
            statement.setString(1, processId);
            try (var rows = statement.executeQuery()) { if (rows.next()) version = rows.getInt(1); }
        }
        return version == null ? null : readVersion(connection, processId, version);
    }

    private ProcessDefinition readVersion(Connection connection, String processId, int version) throws SQLException, IOException {
        try (var statement = connection.prepareStatement("SELECT definition_json, published_by, published_at "
                + "FROM arc_process_version WHERE process_id = ? AND process_version = ?")) {
            statement.setString(1, processId);
            statement.setInt(2, version);
            try (var rows = statement.executeQuery()) {
                if (!rows.next()) throw new IOException("Missing retained process definition");
                try {
                    ProcessDefinition definition = mapper.readValue(rows.getString(1), ProcessDefinition.class);
                    ProcessDefinition.validate(definition);
                    if (!processId.equals(definition.id()) || version != definition.version() ||
                        !ProcessDefinition.validActorId(rows.getString(2)))
                        throw new IllegalArgumentException("Process version metadata differs from definition");
                    Instant.parse(rows.getString(3));
                    return definition;
                } catch (RuntimeException failure) { throw new IOException("Invalid retained process definition", failure); }
            }
        }
    }

    private void insertVersion(Connection connection, ProcessDefinition definition, String actor) throws SQLException, IOException {
        try (var statement = connection.prepareStatement("INSERT INTO arc_process_version "
                + "(process_id, process_version, definition_json, published_by, published_at) VALUES (?, ?, ?, ?, ?)")) {
            statement.setString(1, definition.id());
            statement.setInt(2, definition.version());
            statement.setString(3, mapper.writeValueAsString(definition));
            statement.setString(4, actor);
            statement.setString(5, Instant.now().toString());
            statement.executeUpdate();
        }
    }

    private void bindRequest(PreparedStatement statement, Request request) throws SQLException, IOException {
        statement.setString(1, request.id());
        statement.setString(2, request.processId());
        statement.setInt(3, request.processVersion());
        statement.setInt(4, request.history().size() - 1);
        statement.setString(5, request.applicantId());
        statement.setString(6, request.approverId());
        statement.setString(7, request.status());
        statement.setString(8, request.currentStepId());
        statement.setString(9, request.createdAt());
        statement.setString(10, request.updatedAt());
        statement.setString(11, mapper.writeValueAsString(request));
    }

    private Request readRequest(Connection connection, String id, boolean lock) throws SQLException, IOException {
        return readRequest(connection, id, lock, true);
    }

    private Request readRequest(Connection connection, String id, boolean lock, boolean scoped) throws SQLException, IOException {
        Request request;
        try (var statement = connection.prepareStatement("SELECT " + REQUEST_COLUMNS
                + " FROM arc_request WHERE request_id = ?" + (scoped ? " AND process_id = ?" : "") + (lock ? " FOR UPDATE" : ""))) {
            statement.setString(1, id);
            if (scoped) statement.setString(2, processId);
            try (var rows = statement.executeQuery()) {
                if (!rows.next()) return null;
                try {
                    request = mapper.readValue(rows.getString("request_json"), Request.class);
                    ApprovalService.validateRequest(request);
                    if (scoped) requireBoundProcess(request);
                    verifyColumns(rows, request);
                    if (!id.equals(request.id())) throw new IOException("Request identity differs from its exact lookup");
                } catch (RuntimeException failure) { throw new IOException("Invalid persisted request", failure); }
            }
        }
        if (!request.definition().equals(readVersion(connection, request.processId(), request.processVersion())))
            throw new IOException("Request snapshot differs from its retained process version");
        try (var statement = connection.prepareStatement(
                "SELECT event_index, event_json FROM arc_request_event WHERE request_id = ? ORDER BY event_index")) {
            statement.setString(1, id);
            try (var rows = statement.executeQuery()) {
                int index = 0;
                while (rows.next()) {
                    Event event = mapper.readValue(rows.getString(2), Event.class);
                    if (rows.getInt(1) != index || index >= request.history().size() || !request.history().get(index).equals(event))
                        throw new IOException("Audit event differs from request history");
                    index++;
                }
                if (index != request.history().size()) throw new IOException("Missing audit event");
            }
        }
        verifyMembers(connection, Map.of(request.id(), request));
        return request;
    }

    private static void verifyColumns(ResultSet rows, Request request) throws SQLException, IOException {
        if (!request.id().equals(rows.getString("request_id")) ||
            !request.processId().equals(rows.getString("process_id")) || request.processVersion() != rows.getInt("process_version") ||
            request.history().size() - 1 != rows.getInt("revision") ||
            !request.applicantId().equals(rows.getString("applicant_id")) || !request.approverId().equals(rows.getString("approver_id")) ||
            !request.status().equals(rows.getString("request_status")) ||
            !Objects.equals(request.currentStepId(), rows.getString("current_step_id")) ||
            !request.createdAt().equals(rows.getString("created_at")) || !request.updatedAt().equals(rows.getString("updated_at")))
            throw new IOException("Indexed request columns differ from its snapshot");
    }

    private void insertEvent(Connection connection, String id, int index, Event event) throws SQLException, IOException {
        try (var statement = connection.prepareStatement(
                "INSERT INTO arc_request_event (request_id, event_index, event_json) VALUES (?, ?, ?)")) {
            statement.setString(1, id);
            statement.setInt(2, index);
            statement.setString(3, mapper.writeValueAsString(event));
            statement.executeUpdate();
        }
    }

    /** Indexed, bounded live worklist; every returned snapshot is verified in this one transaction. */
    @Override public List<Request> inbox(InboxQuery query) throws IOException {
        Objects.requireNonNull(query, "query");
        return transaction(true, connection -> {
            requireMembersReady(connection);
            String bucket = query.bucket() == InboxQuery.Bucket.PENDING ? "pending" : "handled";
            StringBuilder sql = new StringBuilder("SELECT request_id, actor_id FROM arc_request_member WHERE actor_key = ? AND process_id = ? AND ")
                .append(bucket).append(" = ?");
            if (query.status() != null) sql.append(" AND request_status = ?");
            if (query.processVersion() != null) sql.append(" AND process_version = ?");
            if (query.after() != null) sql.append(" AND (created_seconds < ? OR (created_seconds = ? AND created_nanos < ?)"
                + " OR (created_seconds = ? AND created_nanos = ? AND request_sort_key < ?))");
            sql.append(" ORDER BY created_seconds DESC, created_nanos DESC, request_sort_key DESC LIMIT ?");
            var ids = new ArrayList<String>();
            try (var statement = connection.prepareStatement(sql.toString())) {
                int parameter = 1;
                statement.setBytes(parameter++, actorKey(query.actor()));
                statement.setString(parameter++, processId);
                statement.setBoolean(parameter++, true);
                if (query.status() != null) statement.setString(parameter++, query.status());
                if (query.processVersion() != null) statement.setInt(parameter++, query.processVersion());
                if (query.after() != null) {
                    var after = query.after();
                    statement.setLong(parameter++, after.seconds());
                    statement.setLong(parameter++, after.seconds());
                    statement.setInt(parameter++, after.nanos());
                    statement.setLong(parameter++, after.seconds());
                    statement.setInt(parameter++, after.nanos());
                    statement.setBytes(parameter++, requestKey(after.requestId()));
                }
                statement.setInt(parameter, query.limit() + 1);
                try (var rows = statement.executeQuery()) {
                    var unique = new HashSet<String>();
                    while (rows.next()) {
                        String id = rows.getString(1);
                        if (!query.actor().equals(rows.getString(2)) || !unique.add(id) || ids.size() >= query.limit() + 1)
                            throw new IOException("Inbox member identity or result bound differs from its exact lookup");
                        ids.add(id);
                    }
                }
            }
            Map<String, Request> snapshots = readBatch(connection, ids, true);
            var result = new ArrayList<Request>();
            Request previous = null;
            for (String id : ids) {
                Request request = snapshots.get(id);
                if (!processId.equals(request.processId()))
                    throw new IOException("Inbox member belongs to a different configured process");
                if (!query.matches(request) || previous != null && InboxQuery.ORDER.compare(previous, request) >= 0)
                    throw new IOException("Inbox projection differs from verified request order or membership");
                result.add(request);
                previous = request;
            }
            return List.copyOf(result);
        });
    }

    private static byte[] actorKey(String actor) {
        // Encode UTF-16 code units explicitly: preserves exact Java IDs, including non-BMP characters.
        byte[] bytes = new byte[actor.length() * 2];
        for (int i = 0; i < actor.length(); i++) {
            bytes[2 * i] = (byte) (actor.charAt(i) >>> 8);
            bytes[2 * i + 1] = (byte) actor.charAt(i);
        }
        return bytes;
    }

    private static byte[] requestKey(String id) { return id.getBytes(StandardCharsets.US_ASCII); }
    private static String placeholders(int size) { return String.join(", ", java.util.Collections.nCopies(size, "?")); }
    private static void bindIds(PreparedStatement statement, List<String> ids) throws SQLException {
        for (int i = 0; i < ids.size(); i++) statement.setString(i + 1, ids.get(i));
    }

    /** Fixed query count, independent of page size: JSON, versions, events, then full member rows. */
    private Map<String, Request> readBatch(Connection connection, List<String> ids, boolean members) throws SQLException, IOException {
        var result = new LinkedHashMap<String, Request>();
        if (ids.isEmpty()) return result;
        if (ids.size() > InboxQuery.MAX_LIMIT + 1) throw new IOException("Request batch exceeds its bounded limit");
        Set<String> expected = new HashSet<>(ids);
        try (var statement = connection.prepareStatement("SELECT " + REQUEST_COLUMNS
                + " FROM arc_request WHERE request_id IN (" + placeholders(ids.size()) + ")")) {
            bindIds(statement, ids);
            try (var rows = statement.executeQuery()) {
                while (rows.next()) {
                    try {
                        Request request = mapper.readValue(rows.getString("request_json"), Request.class);
                        ApprovalService.validateRequest(request);
                        verifyColumns(rows, request);
                        if (!expected.contains(request.id()) || result.putIfAbsent(request.id(), request) != null)
                            throw new IOException("Request identity differs from its exact batch lookup");
                    } catch (RuntimeException failure) { throw new IOException("Invalid persisted request", failure); }
                }
            }
        }
        if (!result.keySet().equals(expected)) throw new IOException("Missing request in member projection");
        // Backfill may span multiple configured processes with the same version number.
        // Fetch exact (process ID, version) pairs in one bounded query, never key by version alone.
        record VersionKey(String processId, int version) {}
        var versions = result.values().stream()
            .map(request -> new VersionKey(request.processId(), request.processVersion())).distinct().toList();
        var definitions = new HashMap<VersionKey, ProcessDefinition>();
        String versionPredicates = String.join(" OR ", java.util.Collections.nCopies(versions.size(),
            "(process_id = ? AND process_version = ?)"));
        try (var statement = connection.prepareStatement("SELECT process_id, process_version, definition_json, published_by, published_at "
                + "FROM arc_process_version WHERE " + versionPredicates)) {
            int parameter = 1;
            for (var version : versions) {
                statement.setString(parameter++, version.processId());
                statement.setInt(parameter++, version.version());
            }
            try (var rows = statement.executeQuery()) {
                while (rows.next()) {
                    try {
                        ProcessDefinition definition = mapper.readValue(rows.getString("definition_json"), ProcessDefinition.class);
                        ProcessDefinition.validate(definition);
                        var version = new VersionKey(rows.getString("process_id"), rows.getInt("process_version"));
                        if (!version.processId().equals(definition.id()) || definition.version() != version.version() ||
                            !versions.contains(version) || !ProcessDefinition.validActorId(rows.getString("published_by")) ||
                            definitions.putIfAbsent(version, definition) != null)
                            throw new IOException("Process version metadata differs from definition");
                        Instant.parse(rows.getString("published_at"));
                    } catch (RuntimeException failure) { throw new IOException("Invalid retained process definition", failure); }
                }
            }
        }
        for (Request request : result.values())
            if (!request.definition().equals(definitions.get(new VersionKey(request.processId(), request.processVersion()))))
                throw new IOException("Request snapshot differs from its retained process version");
        var eventCounts = new HashMap<String, Integer>();
        try (var statement = connection.prepareStatement("SELECT request_id, event_index, event_json FROM arc_request_event "
                + "WHERE request_id IN (" + placeholders(ids.size()) + ") ORDER BY request_id, event_index")) {
            bindIds(statement, ids);
            try (var rows = statement.executeQuery()) {
                while (rows.next()) {
                    String id = rows.getString("request_id");
                    Request request = result.get(id);
                    int index = eventCounts.getOrDefault(id, 0);
                    Event event = mapper.readValue(rows.getString("event_json"), Event.class);
                    if (request == null || rows.getInt("event_index") != index || index >= request.history().size() ||
                        !request.history().get(index).equals(event)) throw new IOException("Audit event differs from request history");
                    eventCounts.put(id, index + 1);
                }
            }
        }
        for (Request request : result.values())
            if (eventCounts.getOrDefault(request.id(), 0) != request.history().size()) throw new IOException("Missing audit event");
        if (members) verifyMembers(connection, result);
        return result;
    }

    private void verifyMembers(Connection connection, Map<String, Request> requests) throws SQLException, IOException {
        if (requests.isEmpty()) return;
        var seen = new HashMap<String, Set<String>>();
        var expected = new HashMap<String, Map<String, InboxQuery.Member>>();
        for (Request request : requests.values()) {
            var map = new HashMap<String, InboxQuery.Member>();
            for (var member : InboxQuery.members(request)) map.put(member.actorId(), member);
            expected.put(request.id(), map);
            seen.put(request.id(), new HashSet<>());
        }
        List<String> ids = List.copyOf(requests.keySet());
        try (var statement = connection.prepareStatement("SELECT " + MEMBER_COLUMNS
                + " FROM arc_request_member WHERE request_id IN (" + placeholders(ids.size()) + ")")) {
            bindIds(statement, ids);
            try (var rows = statement.executeQuery()) {
                while (rows.next()) {
                    String id = rows.getString("request_id");
                    String actor = rows.getString("actor_id");
                    Request request = requests.get(id);
                    var member = expected.containsKey(id) ? expected.get(id).get(actor) : null;
                    if (request == null || member == null || !seen.get(id).add(actor))
                        throw new IOException("Unexpected or duplicate request member projection");
                    var position = InboxQuery.position(request);
                    if (!Arrays.equals(actorKey(actor), rows.getBytes("actor_key")) ||
                        !Arrays.equals(requestKey(id), rows.getBytes("request_sort_key")) ||
                        member.pending() != rows.getBoolean("pending") || member.handled() != rows.getBoolean("handled") ||
                        request.history().size() - 1 != rows.getInt("revision") ||
                        !request.status().equals(rows.getString("request_status")) || request.processVersion() != rows.getInt("process_version") ||
                        !request.processId().equals(rows.getString("process_id")) ||
                        position.seconds() != rows.getLong("created_seconds") || position.nanos() != rows.getInt("created_nanos"))
                        throw new IOException("Member projection differs from verified request snapshot");
                }
            }
        }
        for (String id : ids)
            if (!seen.get(id).equals(expected.get(id).keySet())) throw new IOException("Missing request member projection");
    }

    private void insertMembers(Connection connection, Request request) throws SQLException {
        var position = InboxQuery.position(request);
        try (var statement = connection.prepareStatement("INSERT INTO arc_request_member (" + MEMBER_COLUMNS
                + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")) {
            for (var member : InboxQuery.members(request)) {
                statement.setString(1, request.id());
                statement.setString(2, member.actorId());
                statement.setBytes(3, actorKey(member.actorId()));
                statement.setBoolean(4, member.pending());
                statement.setBoolean(5, member.handled());
                statement.setInt(6, request.history().size() - 1);
                statement.setString(7, request.status());
                statement.setInt(8, request.processVersion());
                statement.setLong(9, position.seconds());
                statement.setInt(10, position.nanos());
                statement.setBytes(11, requestKey(request.id()));
                statement.setString(12, request.processId());
                statement.addBatch();
            }
            statement.executeBatch();
        }
    }

    private void updateMembers(Connection connection, Request request) throws SQLException, IOException {
        try (var statement = connection.prepareStatement("UPDATE arc_request_member SET pending = ?, handled = ?, "
                + "revision = ?, request_status = ? WHERE request_id = ? AND actor_key = ?")) {
            for (var member : InboxQuery.members(request)) {
                statement.setBoolean(1, member.pending());
                statement.setBoolean(2, member.handled());
                statement.setInt(3, request.history().size() - 1);
                statement.setString(4, request.status());
                statement.setString(5, request.id());
                statement.setBytes(6, actorKey(member.actorId()));
                if (statement.executeUpdate() != 1) throw new IOException("Locked request member changed unexpectedly");
            }
        }
    }

    private static void requireMembersReady(Connection connection) throws SQLException, IOException {
        try (var statement = connection.prepareStatement("SELECT ready FROM arc_member_projection_state WHERE singleton_id = 1");
             var rows = statement.executeQuery()) {
            if (!rows.next() || !rows.getBoolean(1) || rows.next())
                throw new IOException("Approval member projection is not ready; run explicit revision-3 backfill with all writers stopped");
        }
    }

    public record BackfillProgress(int processed, boolean ready, String lastRequestId) {}

    /**
     * Explicit, resumable revision-3 migration: processes at most batchSize requests (1..100).
     * Stop/drain ALL application writers until it reports ready. Each chunk and checkpoint commit
     * together. This method never executes DDL, initializes a process, or loops over unbounded data.
     */
    public static BackfillProgress backfillMembers(DataSource dataSource, ObjectMapper mapper, int batchSize) throws IOException {
        if (batchSize < 1 || batchSize > InboxQuery.MAX_LIMIT) throw new IllegalArgumentException("Backfill batch size must be 1..100");
        try (var migration = new JdbcApprovalStore(dataSource, mapper, (String) null)) {
            return migration.transaction(false, connection -> {
                boolean ready;
                String after;
                try (var statement = connection.prepareStatement("SELECT ready, last_request_id FROM arc_member_projection_state "
                        + "WHERE singleton_id = 1 FOR UPDATE"); var rows = statement.executeQuery()) {
                    if (!rows.next()) throw new IOException("Missing revision-3 backfill state");
                    ready = rows.getBoolean(1); after = rows.getString(2);
                    if (rows.next()) throw new IOException("Ambiguous revision-3 backfill state");
                }
                if (ready) return new BackfillProgress(0, true, after);
                var ids = new ArrayList<String>();
                try (var statement = connection.prepareStatement("SELECT request_id FROM arc_request"
                        + (after == null ? "" : " WHERE request_id > ?") + " ORDER BY request_id LIMIT ?")) {
                    int parameter = 1;
                    if (after != null) statement.setString(parameter++, after);
                    statement.setInt(parameter, batchSize + 1);
                    try (var rows = statement.executeQuery()) { while (rows.next()) ids.add(rows.getString(1)); }
                }
                boolean complete = ids.size() <= batchSize;
                List<String> chunk = List.copyOf(ids.subList(0, Math.min(ids.size(), batchSize)));
                Map<String, Request> snapshots = migration.readBatch(connection, chunk, false);
                for (String id : chunk) migration.insertMembers(connection, snapshots.get(id));
                migration.verifyMembers(connection, snapshots);
                String last = chunk.isEmpty() ? after : chunk.get(chunk.size() - 1);
                if (complete) {
                    // Reject requests with no member rows; earlier chunks rely on their verified checkpoints.
                    try (var statement = connection.prepareStatement("SELECT r.request_id FROM arc_request r WHERE NOT EXISTS "
                            + "(SELECT 1 FROM arc_request_member m WHERE m.request_id = r.request_id) LIMIT 1");
                         var rows = statement.executeQuery()) {
                        if (rows.next()) throw new IOException("Incomplete member backfill coverage; do not enable application traffic");
                    }
                }
                try (var statement = connection.prepareStatement("UPDATE arc_member_projection_state SET ready = ?, last_request_id = ? "
                        + "WHERE singleton_id = 1")) {
                    statement.setBoolean(1, complete); statement.setString(2, last);
                    if (statement.executeUpdate() != 1) throw new IOException("Backfill checkpoint changed unexpectedly");
                }
                return new BackfillProgress(chunk.size(), complete, last);
            });
        }
    }

    @FunctionalInterface private interface Work<T> { T run(Connection connection) throws SQLException, IOException; }

    private <T> T transaction(boolean snapshotRead, Work<T> work) throws IOException {
        if (closed.get()) throw new IOException("Approval store is closed");
        try (Connection connection = dataSource.getConnection()) {
            if (!connection.getAutoCommit())
                throw new IOException("JdbcApprovalStore requires independently owned auto-commit connections; ambient transactions are unsupported");
            int originalIsolation = connection.getTransactionIsolation();
            boolean transactionStarted = false;
            Throwable failure = null;
            try {
                // H2 REPEATABLE_READ permits predicate phantoms and can expose different table snapshots.
                // Its JDBC SERIALIZABLE level supplies the snapshot required for these read-only operations.
                // PostgreSQL and MySQL supply that same read snapshot at REPEATABLE_READ.
                connection.setTransactionIsolation(snapshotRead ?
                    (dialect == JdbcDialect.H2 ? Connection.TRANSACTION_SERIALIZABLE : Connection.TRANSACTION_REPEATABLE_READ)
                    : Connection.TRANSACTION_READ_COMMITTED);
                connection.setAutoCommit(false);
                transactionStarted = true;
                T result = work.run(connection);
                connection.commit();
                transactionStarted = false;
                return result;
            } catch (SQLException | IOException | RuntimeException | Error error) {
                failure = error;
                if (transactionStarted) {
                    try { connection.rollback(); transactionStarted = false; }
                    catch (SQLException rollback) { error.addSuppressed(rollback); }
                }
                throw error;
            } finally {
                // Never enable auto-commit after a failed rollback: doing so could commit partial data.
                if (!transactionStarted) {
                    try {
                        connection.setAutoCommit(true);
                        connection.setTransactionIsolation(originalIsolation);
                    } catch (SQLException reset) {
                        if (failure != null) failure.addSuppressed(reset);
                        else throw new IOException("JDBC transaction committed but connection cleanup failed; inspect state before retrying", reset);
                    }
                }
            }
        } catch (SQLException failure) { throw new IOException("Approval JDBC operation failed; inspect state before retrying", failure); }
    }

    /** Prevents new operations. Does not close the externally owned DataSource or cancel in-flight work. */
    @Override public void close() { closed.set(true); }
}
