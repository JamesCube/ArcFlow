package com.arcflow.approval.jdbc;

import java.io.PrintWriter;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;
import javax.sql.DataSource;

final class ServerTestSupport {
    static DataSource withSessionStatement(DataSource delegate, String sql) {
        return (DataSource) Proxy.newProxyInstance(ServerTestSupport.class.getClassLoader(), new Class<?>[]{DataSource.class}, (proxy, method, args) -> {
            try {
                Object result = method.invoke(delegate, args);
                if (method.getName().equals("getConnection")) {
                    Connection connection = (Connection) result;
                    try (var statement = connection.createStatement()) { statement.execute(sql); }
                    catch (SQLException failure) {
                        try { connection.close(); } catch (SQLException close) { failure.addSuppressed(close); }
                        throw failure;
                    }
                }
                return result;
            } catch (InvocationTargetException failure) { throw failure.getCause(); }
        });
    }

    /** Connector/J can make setCatalog a no-op (databaseTerm=SCHEMA); verify the server before any DDL. */
    static void selectDisposableCatalog(Connection connection, String catalog) throws SQLException {
        if (catalog == null || !catalog.matches("arcflow_test_[a-f0-9]{32}"))
            throw new SQLException("Invalid disposable MySQL catalog name");
        connection.setCatalog(catalog);
        try (var statement = connection.createStatement(); var rows = statement.executeQuery("SELECT DATABASE()")) {
            if (!rows.next() || !catalog.equals(rows.getString(1)))
                throw new SQLException("MySQL test connection did not select its disposable catalog; check databaseTerm in the JDBC URL");
        }
    }

    /** Blocks an exact JDBC statement so races can be reproduced at a known transaction boundary. */
    static final class GateDataSource implements DataSource {
        private final DataSource delegate;
        private final String prefix;
        private volatile boolean armed;
        final CountDownLatch entered = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        GateDataSource(DataSource delegate, String prefix) { this(delegate, prefix, true); }
        GateDataSource(DataSource delegate, String prefix, boolean armed) {
            this.delegate = delegate; this.prefix = prefix; this.armed = armed;
        }
        void arm() { armed = true; }
        @Override public Connection getConnection() throws SQLException {
            Connection connection = delegate.getConnection();
            return (Connection) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{Connection.class}, (proxy, method, args) -> {
                try {
                    Object result = method.invoke(connection, args);
                    if (method.getName().equals("prepareStatement") && args[0] instanceof String sql && sql.startsWith(prefix)) {
                        PreparedStatement statement = (PreparedStatement) result;
                        return Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{PreparedStatement.class}, (p, m, a) -> {
                            try {
                                if (armed && (m.getName().equals("executeUpdate") || m.getName().equals("executeQuery"))) {
                                    entered.countDown();
                                    if (!release.await(10, TimeUnit.SECONDS)) throw new AssertionError("Timed out waiting for JDBC gate");
                                }
                                return m.invoke(statement, a);
                            } catch (InvocationTargetException failure) { throw failure.getCause(); }
                        });
                    }
                    return result;
                } catch (InvocationTargetException failure) { throw failure.getCause(); }
            });
        }
        @Override public Connection getConnection(String user, String password) throws SQLException { throw new SQLException("Not used"); }
        @Override public PrintWriter getLogWriter() throws SQLException { return delegate.getLogWriter(); }
        @Override public void setLogWriter(PrintWriter writer) throws SQLException { delegate.setLogWriter(writer); }
        @Override public void setLoginTimeout(int seconds) throws SQLException { delegate.setLoginTimeout(seconds); }
        @Override public int getLoginTimeout() throws SQLException { return delegate.getLoginTimeout(); }
        @Override public Logger getParentLogger() { return Logger.getLogger("approval-jdbc-test"); }
        @Override public <T> T unwrap(Class<T> type) throws SQLException { return delegate.unwrap(type); }
        @Override public boolean isWrapperFor(Class<?> type) throws SQLException { return delegate.isWrapperFor(type); }
    }
}
