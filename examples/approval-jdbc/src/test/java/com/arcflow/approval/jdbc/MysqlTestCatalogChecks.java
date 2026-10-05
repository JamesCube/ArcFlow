package com.arcflow.approval.jdbc;

import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/** Targeted no-database regression for disposable-catalog selection. Also invoked by JUnit. */
public final class MysqlTestCatalogChecks {
    private static final String CATALOG = "arcflow_test_0123456789abcdef0123456789abcdef";

    public static void main(String[] args) throws Exception {
        int checks = 0;
        for (String selected : new String[]{"original_database", null, "ARCFLOW_TEST_0123456789abcdef0123456789abcdef"}) {
            var calls = new ArrayList<String>();
            try {
                ServerTestSupport.selectDisposableCatalog(connection(selected, true, calls), CATALOG);
                throw new AssertionError("Catalog mismatch must fail before migration");
            } catch (SQLException expected) {
                if (!calls.equals(List.of("setCatalog", "SELECT DATABASE()"))) throw new AssertionError(calls);
                checks++;
            }
        }
        var missing = new ArrayList<String>();
        try {
            ServerTestSupport.selectDisposableCatalog(connection(CATALOG, false, missing), CATALOG);
            throw new AssertionError("Missing server result must fail");
        } catch (SQLException expected) { checks++; }
        for (String invalid : new String[]{"production", "arcflow_test_unsafe;DROP DATABASE x", null}) {
            var calls = new ArrayList<String>();
            try {
                ServerTestSupport.selectDisposableCatalog(connection(CATALOG, true, calls), invalid);
                throw new AssertionError("Invalid generated name must fail");
            } catch (SQLException expected) {
                if (!calls.isEmpty()) throw new AssertionError("Invalid name touched connection: " + calls);
                checks++;
            }
        }
        var success = new ArrayList<String>();
        ServerTestSupport.selectDisposableCatalog(connection(CATALOG, true, success), CATALOG);
        if (!success.equals(List.of("setCatalog", "SELECT DATABASE()"))) throw new AssertionError(success);
        checks++;
        System.out.println("PASS " + checks + " catalog fail-closed regression cases (simulated connection; no database DDL)");
    }

    private static Connection connection(String selected, boolean hasRow, List<String> calls) {
        return proxy(Connection.class, (method, args) -> switch (method) {
            // Deliberately no-op, modeling Connector/J databaseTerm=SCHEMA.
            case "setCatalog" -> { calls.add("setCatalog"); yield null; }
            case "createStatement" -> proxy(Statement.class, (m, a) -> switch (m) {
                case "executeQuery" -> {
                    if (!"SELECT DATABASE()".equals(a[0])) throw new AssertionError("Unexpected SQL before isolation: " + a[0]);
                    calls.add((String) a[0]);
                    yield proxy(ResultSet.class, (r, b) -> switch (r) {
                        case "next" -> hasRow;
                        case "getString" -> selected;
                        case "close" -> null;
                        default -> throw new AssertionError(r);
                    });
                }
                case "close" -> null;
                default -> throw new AssertionError(m);
            });
            default -> throw new AssertionError(method);
        });
    }
    @FunctionalInterface private interface Call { Object invoke(String method, Object[] args) throws Throwable; }
    @SuppressWarnings("unchecked") private static <T> T proxy(Class<T> type, Call call) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, (p, m, a) -> call.invoke(m.getName(), a));
    }
}
