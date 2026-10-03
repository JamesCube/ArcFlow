package com.arcflow.approval.jdbc;

import com.arcflow.approval.ApprovalService;
import com.arcflow.approval.ApprovalService.Event;
import com.arcflow.approval.ApprovalService.Request;
import com.arcflow.approval.ApprovalStore;
import com.arcflow.approval.ProcessDefinition;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
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
    private static final String PROCESS_ID = "leave-approval";
    private static final String REQUEST_COLUMNS = "request_id, process_id, process_version, revision, "
        + "applicant_id, approver_id, request_status, current_step_id, created_at, updated_at, request_json";
    private final DataSource dataSource;
    private final ObjectMapper mapper;
    private final AtomicBoolean closed = new AtomicBoolean();

    /** First successful initializer wins; subsequent instances use the persisted definition. */
    public JdbcApprovalStore(DataSource dataSource, ObjectMapper mapper, ProcessDefinition initialDefinition) throws IOException {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource");
        ProcessDefinition.validate(initialDefinition);
        this.mapper = ApprovalService.strictMapper(Objects.requireNonNull(mapper, "mapper").copy())
            .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
            .setSerializationInclusion(JsonInclude.Include.ALWAYS);
        initialize(initialDefinition);
    }

    @Override public ProcessDefinition process() throws IOException {
        return transaction(true, connection -> requireProcess(connection, false));
    }

    @Override public List<Request> requests() throws IOException {
        return transaction(true, connection -> {
            // Read state, audit and retained definitions from one repeatable-read snapshot.
            var result = new ArrayList<Request>();
            var ids = new ArrayList<String>();
            try (var statement = connection.prepareStatement("SELECT request_id FROM arc_request ORDER BY created_at, request_id");
                 var rows = statement.executeQuery()) {
                while (rows.next()) ids.add(rows.getString(1));
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
                statement.setString(2, PROCESS_ID);
                statement.setInt(3, expectedVersion);
                if (statement.executeUpdate() != 1) throw new IOException("Locked process head changed unexpectedly");
            }
            return true;
        });
    }

    @Override public boolean create(int expectedProcessVersion, Request request) throws IOException {
        ApprovalService.validateRequest(request);
        if (request.history().size() != 1 || request.processVersion() != expectedProcessVersion)
            throw new IllegalArgumentException("A new request must have only its submission event and the expected process version");
        return transaction(false, connection -> {
            // Publication takes this same lock, so checking the active version and inserting are atomic.
            ProcessDefinition current = requireProcess(connection, true);
            if (current.version() != expectedProcessVersion) return false;
            if (!current.equals(request.definition()))
                throw new IllegalArgumentException("Request definition differs from the published version");
            try (var statement = connection.prepareStatement("INSERT INTO arc_request (" + REQUEST_COLUMNS
                    + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")) {
                bindRequest(statement, request);
                statement.executeUpdate();
            }
            insertEvent(connection, request.id(), 0, request.history().get(0));
            return true;
        });
    }

    @Override public boolean update(int expectedRevision, Request next) throws IOException {
        ApprovalService.validateRequest(next);
        if (expectedRevision < 0 || next.history().size() - 2 != expectedRevision)
            throw new IllegalArgumentException("An update must append exactly one event to the expected revision");
        return transaction(false, connection -> {
            Request previous = readRequest(connection, next.id(), true);
            if (previous == null || previous.history().size() - 1 != expectedRevision) return false;
            ApprovalService.validateTransition(previous, next);
            try (var statement = connection.prepareStatement("UPDATE arc_request SET revision = ?, approver_id = ?, "
                    + "request_status = ?, current_step_id = ?, updated_at = ?, request_json = ? "
                    + "WHERE request_id = ? AND revision = ?")) {
                statement.setInt(1, expectedRevision + 1);
                statement.setString(2, next.approverId());
                statement.setString(3, next.status());
                statement.setString(4, next.currentStepId());
                statement.setString(5, next.updatedAt());
                statement.setString(6, mapper.writeValueAsString(next));
                statement.setString(7, next.id());
                statement.setInt(8, expectedRevision);
                if (statement.executeUpdate() != 1) throw new IOException("Locked request revision changed unexpectedly");
            }
            insertEvent(connection, next.id(), expectedRevision + 1, next.history().get(expectedRevision + 1));
            return true;
        });
    }

    private void initialize(ProcessDefinition initial) throws IOException {
        try {
            transaction(false, connection -> {
                if (readProcess(connection, true) != null) return null;
                insertVersion(connection, initial, "bootstrap");
                try (var statement = connection.prepareStatement("INSERT INTO arc_process_head (process_id, active_version) VALUES (?, ?)")) {
                    statement.setString(1, PROCESS_ID);
                    statement.setInt(2, initial.version());
                    statement.executeUpdate();
                }
                return null;
            });
        } catch (IOException failure) {
            // The only accepted initialization race is a duplicate key from another initializer.
            // Rollback already happened; verify a complete committed head in a fresh transaction.
            // Do not retry an insert, a connection failure, serialization failure, or other SQL error.
            if (!duplicateKey(failure)) throw failure;
            try { transaction(true, connection -> requireProcess(connection, false)); }
            catch (IOException verification) { failure.addSuppressed(verification); throw failure; }
        }
    }

    private static boolean duplicateKey(IOException failure) {
        return failure.getCause() instanceof SQLException sql && "23505".equals(sql.getSQLState());
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
            statement.setString(1, PROCESS_ID);
            try (var rows = statement.executeQuery()) { if (rows.next()) version = rows.getInt(1); }
        }
        return version == null ? null : readVersion(connection, PROCESS_ID, version);
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
        Request request;
        try (var statement = connection.prepareStatement("SELECT " + REQUEST_COLUMNS
                + " FROM arc_request WHERE request_id = ?" + (lock ? " FOR UPDATE" : ""))) {
            statement.setString(1, id);
            try (var rows = statement.executeQuery()) {
                if (!rows.next()) return null;
                try {
                    request = mapper.readValue(rows.getString("request_json"), Request.class);
                    ApprovalService.validateRequest(request);
                    verifyColumns(rows, request);
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
                connection.setTransactionIsolation(snapshotRead ? Connection.TRANSACTION_REPEATABLE_READ : Connection.TRANSACTION_READ_COMMITTED);
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
