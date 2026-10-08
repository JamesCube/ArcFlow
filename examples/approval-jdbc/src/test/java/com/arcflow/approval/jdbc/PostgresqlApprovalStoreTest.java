package com.arcflow.approval.jdbc;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.postgresql.ds.PGSimpleDataSource;
import static org.junit.jupiter.api.Assertions.*;

/** Runs on a real disposable PostgreSQL database in CI; never substitutes H2 compatibility mode. */
@EnabledIfEnvironmentVariable(named = "ARCFLOW_PG_URL", matches = ".+")
class PostgresqlApprovalStoreTest extends MemberInboxStoreContract {
    private PGSimpleDataSource database;
    private String schema;
    private PGSimpleDataSource source() {
        var source = new PGSimpleDataSource();
        source.setURL(System.getenv("ARCFLOW_PG_URL"));
        source.setUser(System.getenv("ARCFLOW_PG_USER"));
        source.setPassword(System.getenv("ARCFLOW_PG_PASSWORD"));
        return source;
    }
    @BeforeEach void migrateFreshSchema() throws Exception {
        database = source();
        schema = "arcflow_test_" + UUID.randomUUID().toString().replace("-", "");
        try (var connection = database.getConnection(); var statement = connection.createStatement()) {
            statement.execute("CREATE SCHEMA " + schema);
        }
        var schemaSource = source();
        schemaSource.setCurrentSchema(schema);
        dataSource = schemaSource;
        try (var input = JdbcApprovalStore.class.getResourceAsStream("schema-postgresql.sql")) {
            assertNotNull(input);
            String sql = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) {
                statement.execute(sql);
            }
        }
    }
    @AfterEach void dropDisposableSchema() throws Exception {
        if (database != null && schema != null) {
            try (var connection = database.getConnection(); var statement = connection.createStatement()) {
                statement.execute("DROP SCHEMA " + schema + " CASCADE");
            }
        }
    }
}
