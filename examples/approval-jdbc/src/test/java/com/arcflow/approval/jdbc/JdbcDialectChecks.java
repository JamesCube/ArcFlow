package com.arcflow.approval.jdbc;

import java.io.IOException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/** Plain-JDK unit checks, also invoked from JUnit. Simulated JDBC metadata is NOT real-server evidence. */
public final class JdbcDialectChecks {
    private static int checks;
    public static void main(String[] args) throws Exception {
        checks = 0;
        for (String version : List.of("8.0.17", "8.0.44", "8.0.44-0ubuntu1", "8.4.0", "8.4.8"))
            check(JdbcDialect.inspect(connection("MySQL", version, "InnoDB", "utf8mb4_0900_bin", "longtext", false)) == JdbcDialect.MYSQL8);
        for (String version : List.of("5.7.44", "8.0.15", "8.0.16", "9.0.0", "10.6.0-MariaDB", "unknown"))
            fails(() -> JdbcDialect.inspect(connection("MySQL", version, "InnoDB", "utf8mb4_0900_bin", "longtext", false)));
        check(JdbcDialect.inspect(connection("H2", "2.3", null, null, null, false)) == JdbcDialect.H2);
        check(JdbcDialect.inspect(connection("PostgreSQL", "17.6", null, null, null, false)) == JdbcDialect.POSTGRESQL);
        fails(() -> JdbcDialect.inspect(connection("MariaDB", "11.4", "InnoDB", "utf8mb4_bin", "longtext", false)));
        fails(() -> JdbcDialect.inspect(connection("SQLite", "3.0", null, null, null, false)));
        fails(() -> JdbcDialect.inspect(connection("MySQL", "8.0.44", "MyISAM", "utf8mb4_0900_bin", "longtext", false)));
        for (String collation : List.of("utf8mb4_0900_ai_ci", "utf8mb4_bin"))
            fails(() -> JdbcDialect.inspect(connection("MySQL", "8.0.44", "InnoDB", collation, "longtext", false)));
        fails(() -> JdbcDialect.inspect(connection("MySQL", "8.0.44", "InnoDB", "utf8mb4_0900_bin", "text", false)));
        fails(() -> JdbcDialect.inspect(connection("MySQL", "8.0.44", "InnoDB", "utf8mb4_0900_bin", "longtext", true)));
        fails(() -> JdbcDialect.inspect(connection("MySQL", "8.0.44", "InnoDB", "utf8mb4_0900_bin", "longtext", false, "utf8mb4_0900_ai_ci")));
        check(JdbcDialect.MYSQL8.duplicateKey(new SQLException("duplicate", "23000", 1062)));
        for (var error : List.of(new SQLException("FK", "23000", 1452), new SQLException("CHECK", "HY000", 3819),
                new SQLException("deadlock", "40001", 1213), new SQLException("lock timeout", "HY000", 1205),
                new SQLException("lost connection", "08S01", 2013), new SQLException("wrong state", "23505", 1062),
                new SQLException("null state", null, 1062))) check(!JdbcDialect.MYSQL8.duplicateKey(error));
        check(JdbcDialect.H2.duplicateKey(new SQLException("duplicate", "23505")));
        check(JdbcDialect.POSTGRESQL.duplicateKey(new SQLException("duplicate", "23505")));
        check(!JdbcDialect.POSTGRESQL.duplicateKey(new SQLException("mysql", "23000", 1062)));
        var duplicate = new SQLException("duplicate", "23000", 1062);
        check(JdbcDialect.MYSQL8.cleanDuplicate(new IOException("operation", duplicate)));
        duplicate.addSuppressed(new SQLException("rollback failed", "08S01"));
        check(!JdbcDialect.MYSQL8.cleanDuplicate(new IOException("operation", duplicate)));
        for (String cleanup : List.of("reset", "close")) {
            var failure = new IOException("operation", new SQLException("duplicate", "23000", 1062));
            failure.addSuppressed(new SQLException(cleanup + " failed"));
            check(!JdbcDialect.MYSQL8.cleanDuplicate(failure));
        }
        check(!JdbcDialect.MYSQL8.cleanDuplicate(new IOException("nested", new IOException("wrapper", duplicate))));
        var chained = new SQLException("duplicate", "23000", 1062);
        chained.setNextException(new SQLException("connection failure", "08006"));
        check(!JdbcDialect.MYSQL8.cleanDuplicate(new IOException("operation", chained)));
        System.out.println("PASS " + checks + " plain-JDK dialect/schema/error checks (simulated metadata, not database integration)");
    }

    private static Connection connection(String product, String version, String engine, String collation, String jsonType, boolean missingTable) {
        return connection(product, version, engine, collation, jsonType, missingTable, collation);
    }
    private static Connection connection(String product, String version, String engine, String collation, String jsonType, boolean missingTable, String columnCollation) {
        var metadata = proxy(DatabaseMetaData.class, (method, args) -> switch (method) {
            case "getDatabaseProductName" -> product;
            case "getDatabaseProductVersion" -> version;
            default -> throw new AssertionError("Unexpected metadata operation: " + method);
        });
        var tables = new ArrayList<String[]>();
        for (String name : List.of("arc_process_version", "arc_process_head", "arc_request", "arc_request_event", "arc_submission_key"))
            if (!missingTable || !name.equals("arc_request")) tables.add(new String[]{name, engine, collation});
        var columns = List.of(new String[]{"arc_process_version", "definition_json", jsonType, columnCollation},
            new String[]{"arc_request", "request_json", jsonType, columnCollation},
            new String[]{"arc_request_event", "event_json", jsonType, columnCollation},
            new String[]{"arc_request", "applicant_id", "varchar", columnCollation},
            new String[]{"arc_submission_key", "submission_key", "varchar", columnCollation});
        return proxy(Connection.class, (method, args) -> switch (method) {
            case "getMetaData" -> metadata;
            case "createStatement" -> proxy(Statement.class, (m, a) -> switch (m) {
                case "executeQuery" -> rows(((String) a[0]).contains("information_schema.tables") ? tables : columns);
                case "close" -> null;
                default -> throw new AssertionError("Unexpected statement operation: " + m);
            });
            default -> throw new AssertionError("Unexpected connection operation: " + method);
        });
    }
    private static ResultSet rows(List<String[]> data) {
        int[] index = {-1};
        return proxy(ResultSet.class, (method, args) -> switch (method) {
            case "next" -> ++index[0] < data.size();
            case "getString" -> data.get(index[0])[(Integer) args[0] - 1];
            case "close" -> null;
            default -> throw new AssertionError("Unexpected result operation: " + method);
        });
    }
    @FunctionalInterface private interface Call { Object invoke(String method, Object[] args) throws Throwable; }
    @SuppressWarnings("unchecked") private static <T> T proxy(Class<T> type, Call call) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, (p, m, a) -> call.invoke(m.getName(), a));
    }
    @FunctionalInterface private interface Checked { void run() throws Exception; }
    private static void fails(Checked action) throws Exception {
        try { action.run(); throw new AssertionError("Expected dialect/schema rejection"); }
        catch (IOException expected) { checks++; }
    }
    private static void check(boolean success) { if (!success) throw new AssertionError("Check " + checks + " failed"); checks++; }
}
