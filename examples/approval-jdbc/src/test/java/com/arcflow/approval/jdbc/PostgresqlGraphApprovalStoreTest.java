package com.arcflow.approval.jdbc;

import java.io.IOException;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.postgresql.ds.PGSimpleDataSource;
import static org.junit.jupiter.api.Assertions.*;

/** Real PostgreSQL only; each test owns a freshly created, UUID-named graph schema. */
@EnabledIfEnvironmentVariable(named = "ARCFLOW_PG_URL", matches = ".+")
class PostgresqlGraphApprovalStoreTest extends GraphStoreContract {
    private PGSimpleDataSource database;
    private String schema;
    private boolean created;

    private PGSimpleDataSource source() {
        var source = new PGSimpleDataSource();
        source.setURL(System.getenv("ARCFLOW_PG_URL"));
        source.setUser(System.getenv("ARCFLOW_PG_USER"));
        source.setPassword(System.getenv("ARCFLOW_PG_PASSWORD"));
        return source;
    }

    @BeforeEach void installFreshGraphSchema() throws Exception {
        database = source();
        schema = "arc_graph_test_" + UUID.randomUUID().toString().replace("-", "");
        try (var connection = database.getConnection(); var statement = connection.createStatement()) {
            assertEquals("PostgreSQL", connection.getMetaData().getDatabaseProductName(),
                "Requires real PostgreSQL, not an H2 compatibility mode");
            System.out.println("Real graph PostgreSQL server: " + connection.getMetaData().getDatabaseProductVersion());
            statement.execute("CREATE SCHEMA " + schema);
            created = true;
        }
        var schemaSource = source();
        schemaSource.setCurrentSchema(schema);
        dataSource = schemaSource;
        assertThrows(IOException.class, this::open, "Opening a graph store must not install missing tables");
        install("postgresql");
    }

    @AfterEach void dropOnlyCreatedGraphSchema() throws Exception {
        if (created) {
            assertTrue(schema.matches("arc_graph_test_[a-f0-9]{32}"));
            try (var connection = database.getConnection(); var statement = connection.createStatement()) {
                statement.execute("DROP SCHEMA " + schema + " CASCADE");
            }
        }
    }
}
