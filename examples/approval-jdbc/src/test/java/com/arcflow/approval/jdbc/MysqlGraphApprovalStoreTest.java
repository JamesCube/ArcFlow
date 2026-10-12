package com.arcflow.approval.jdbc;

import java.io.IOException;
import java.io.PrintWriter;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.UUID;
import java.util.logging.Logger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import static org.junit.jupiter.api.Assertions.*;

/** Real MySQL 8 only; each test owns a fresh catalog and installs only graph tables. */
@EnabledIfEnvironmentVariable(named = "ARCFLOW_MYSQL_URL", matches = ".+")
class MysqlGraphApprovalStoreTest extends GraphStoreContract {
    private String catalog;
    private boolean created;

    private Connection connect() throws SQLException {
        return DriverManager.getConnection(System.getenv("ARCFLOW_MYSQL_URL"),
            System.getenv("ARCFLOW_MYSQL_USER"), System.getenv("ARCFLOW_MYSQL_PASSWORD"));
    }

    @BeforeEach void installFreshGraphSchema() throws Exception {
        catalog = "arcflow_test_" + UUID.randomUUID().toString().replace("-", "");
        try (var connection = connect(); var statement = connection.createStatement()) {
            assertEquals("MySQL", connection.getMetaData().getDatabaseProductName(),
                "Requires Oracle MySQL, not H2 or MariaDB");
            assertEquals(8, connection.getMetaData().getDatabaseMajorVersion());
            System.out.println("Real graph MySQL server: " + connection.getMetaData().getDatabaseProductVersion());
            statement.execute("CREATE DATABASE " + catalog + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin");
            created = true;
        }
        dataSource = new DataSource() {
            @Override public Connection getConnection() throws SQLException {
                Connection connection = connect();
                try {
                    ServerTestSupport.selectDisposableCatalog(connection, catalog);
                    return connection;
                } catch (SQLException failure) {
                    try { connection.close(); } catch (SQLException close) { failure.addSuppressed(close); }
                    throw failure;
                }
            }
            @Override public Connection getConnection(String user, String password) throws SQLException { throw new SQLException("Not used"); }
            @Override public PrintWriter getLogWriter() { return null; }
            @Override public void setLogWriter(PrintWriter writer) { }
            @Override public void setLoginTimeout(int seconds) { }
            @Override public int getLoginTimeout() { return 0; }
            @Override public Logger getParentLogger() { return Logger.getLogger("mysql-graph-approval-test"); }
            @Override public <T> T unwrap(Class<T> type) throws SQLException { throw new SQLException("Not a wrapper"); }
            @Override public boolean isWrapperFor(Class<?> type) { return false; }
        };
        assertThrows(IOException.class, this::open, "Opening a graph store must not install missing tables");
        install("mysql");
    }

    @AfterEach void dropOnlyCreatedGraphDatabase() throws Exception {
        if (created) {
            assertTrue(catalog.matches("arcflow_test_[a-f0-9]{32}"));
            try (var connection = connect(); var statement = connection.createStatement()) {
                statement.execute("DROP DATABASE " + catalog);
            }
        }
    }
}
