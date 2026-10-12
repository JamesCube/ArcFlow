package com.arcflow.approval.jdbc;

import java.io.IOException;
import java.util.UUID;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import static org.junit.jupiter.api.Assertions.*;

/** Graph contract on its own disposable H2 database; no legacy schema is installed. */
class H2GraphApprovalStoreTest extends GraphStoreContract {
    private JdbcDataSource database;

    @BeforeEach void installFreshGraphSchema() throws Exception {
        database = new JdbcDataSource();
        database.setURL("jdbc:h2:mem:arc_graph_test_" + UUID.randomUUID().toString().replace("-", "")
            + ";DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000");
        database.setUser("sa");
        dataSource = database;
        assertThrows(IOException.class, this::open, "Opening a graph store must not install missing tables");
        install("h2");
    }

    @AfterEach void closeOnlyOwnedDatabase() throws Exception {
        if (database != null) {
            try (var connection = database.getConnection(); var statement = connection.createStatement()) {
                statement.execute("SHUTDOWN");
            }
        }
    }
}
