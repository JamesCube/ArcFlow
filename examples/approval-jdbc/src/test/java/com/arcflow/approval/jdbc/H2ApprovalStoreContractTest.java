package com.arcflow.approval.jdbc;

import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.h2.jdbcx.JdbcDataSource;
import org.h2.tools.RunScript;
import org.junit.jupiter.api.BeforeEach;
import static org.junit.jupiter.api.Assertions.*;

/** Real H2 execution of the same inherited contract as PostgreSQL and MySQL. */
class H2ApprovalStoreContractTest extends MemberInboxStoreContract {
    @BeforeEach void migrateFreshDatabase() throws Exception {
        var source = new JdbcDataSource();
        source.setURL("jdbc:h2:mem:" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000");
        dataSource = source;
        try (var input = JdbcApprovalStore.class.getResourceAsStream("schema-h2.sql")) {
            assertNotNull(input);
            try (var reader = new InputStreamReader(input, StandardCharsets.UTF_8);
                 var connection = dataSource.getConnection()) { RunScript.execute(connection, reader); }
        }
    }
}
