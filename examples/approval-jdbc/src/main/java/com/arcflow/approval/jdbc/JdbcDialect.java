package com.arcflow.approval.jdbc;

import java.io.IOException;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

/** Small, explicit portability boundary; never uses H2 compatibility mode as server evidence. */
enum JdbcDialect {
    H2, POSTGRESQL, MYSQL8;

    private static final Set<String> TABLES = Set.of(
        "arc_process_version", "arc_process_head", "arc_request", "arc_request_event");
    private static final Pattern MYSQL_VERSION = Pattern.compile("^(\\d+)\\.(\\d+)\\.(\\d+)(?:[-+].*)?$");
    private static final String TABLE_FILTER = "table_schema = DATABASE() AND table_name IN "
        + "('arc_process_version', 'arc_process_head', 'arc_request', 'arc_request_event')";

    static JdbcDialect inspect(Connection connection) throws SQLException, IOException {
        var metadata = connection.getMetaData();
        String product = metadata.getDatabaseProductName();
        if ("H2".equals(product)) return H2;
        if ("PostgreSQL".equals(product)) return POSTGRESQL;
        if (!"MySQL".equals(product)) throw new IOException("Unsupported approval database: " + product);
        String version = metadata.getDatabaseProductVersion();
        var match = MYSQL_VERSION.matcher(version);
        if (!match.matches() || !"8".equals(match.group(1)) ||
            ("0".equals(match.group(2)) && Integer.parseInt(match.group(3)) < 17))
            throw new IOException("Approval MySQL dialect requires Oracle MySQL 8.0.17+ within the 8.x series; found " + version);
        // Existing tables with nontransactional engines or folded IDs would break atomicity/identity.
        var found = new HashSet<String>();
        try (var statement = connection.createStatement();
             var rows = statement.executeQuery("SELECT table_name, engine, table_collation FROM information_schema.tables WHERE " + TABLE_FILTER)) {
            while (rows.next()) {
                found.add(rows.getString(1));
                if (!"InnoDB".equalsIgnoreCase(rows.getString(2)) || !"utf8mb4_0900_bin".equals(rows.getString(3)))
                    throw new IOException("MySQL approval tables require InnoDB and utf8mb4_0900_bin; apply the supplied schema");
            }
        }
        if (!TABLES.equals(found)) throw new IOException("Missing MySQL approval tables; install schema-mysql.sql explicitly");
        var jsonColumns = new HashSet<String>();
        try (var statement = connection.createStatement();
             var rows = statement.executeQuery("SELECT table_name, column_name, data_type, collation_name FROM information_schema.columns WHERE " + TABLE_FILTER)) {
            while (rows.next()) {
                String column = rows.getString(2);
                String collation = rows.getString(4);
                if (collation != null && !"utf8mb4_0900_bin".equals(collation))
                    throw new IOException("MySQL approval text columns require utf8mb4_0900_bin: " + rows.getString(1) + "." + column);
                if (column.endsWith("_json")) {
                    if (!"longtext".equalsIgnoreCase(rows.getString(3)))
                        throw new IOException("MySQL approval JSON columns require LONGTEXT: " + column);
                    jsonColumns.add(rows.getString(1) + "." + column);
                }
            }
        }
        if (!jsonColumns.equals(Set.of("arc_process_version.definition_json", "arc_request.request_json", "arc_request_event.event_json")))
            throw new IOException("Missing MySQL approval JSON columns; apply the supplied schema");
        return MYSQL8;
    }

    boolean duplicateKey(SQLException error) {
        // 23000 also includes foreign-key / other integrity failures. Never swallow that whole class.
        return this == MYSQL8 ? "23000".equals(error.getSQLState()) && error.getErrorCode() == 1062
            : "23505".equals(error.getSQLState());
    }

    boolean cleanInitializationDuplicate(IOException failure) {
        // A duplicate alone is reconcilable, but rollback/reset/close errors leave the outcome uncertain.
        return failure.getSuppressed().length == 0 && failure.getCause() instanceof SQLException sql
            && sql.getSuppressed().length == 0 && duplicateKey(sql);
    }
}
