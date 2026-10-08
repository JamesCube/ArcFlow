package com.arcflow.approval.jdbc;

import com.arcflow.approval.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import org.h2.jdbcx.JdbcDataSource;
import org.h2.tools.RunScript;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class QuoteDiscountJdbcTest {
    @TempDir Path directory;
    final ObjectMapper mapper = new ObjectMapper();
    BusinessDocument.QuoteDiscount quote() {
        return new BusinessDocument.QuoteDiscount("Q-DEMO-001", "Quote discount", "Ten equipment sets", "CUSTOMER-DEMO-A", 1,
            "Equipment set", 10, new BigDecimal("1E+3"), new BigDecimal("8.5E+2"), "CNY", "2026-10-08");
    }
    JdbcDataSource database() {
        var source = new JdbcDataSource(); source.setURL("jdbc:h2:file:" + directory.resolve("quotes") + ";LOCK_TIMEOUT=5000"); return source;
    }
    void install(JdbcDataSource source) throws Exception {
        try (var input = getClass().getResourceAsStream("/com/arcflow/approval/jdbc/schema-h2.sql");
             var reader = new java.io.InputStreamReader(input, StandardCharsets.UTF_8); var connection = source.getConnection()) { RunScript.execute(connection, reader); }
    }
    ApprovalService open(JdbcDataSource source, ProcessDefinition definition) throws Exception {
        return new ApprovalService(new JdbcApprovalStore(source, mapper, definition), ServerApprovalStoreContract.USERS);
    }
    @Test void quotePayloadRestoresAndSharesGlobalKeyIsolationWithLeaveAndProcurement() throws Exception {
        var source = database(); install(source); ApprovalService.Request approved;
        var definition = QuoteDiscountCase.definition("bob", "carol");
        try (var quotes = open(source, definition); var leave = open(source, ProcessDefinition.legacy("bob"));
             var procurement = open(source, ServerApprovalStoreContract.procurementDefinition("bob"))) {
            var request = quotes.submitDocument("alice", quote(), 1, "shared-key");
            assertEquals(409, ServerApprovalStoreContract.result(() -> leave.submit("alice", "Leave", "Rest", 2, 1, "shared-key")));
            assertEquals(409, ServerApprovalStoreContract.result(() -> procurement.submitDocument("alice", ServerApprovalStoreContract.procurement(), 1, "shared-key")));
            assertTrue(leave.list("alice").isEmpty()); assertTrue(procurement.list("alice").isEmpty());
            assertEquals(404, ServerApprovalStoreContract.result(() -> leave.decide("bob", request.id(), "salesManager", "APPROVE", "")));
            quotes.decide("bob", request.id(), "salesManager", "APPROVE", "Reviewed");
            approved = quotes.decide("carol", request.id(), "finance", "APPROVE", "Reviewed");
        }
        try (var reopened = open(database(), definition)) {
            assertEquals(List.of(approved), reopened.list("alice")); assertEquals(quote(), approved.business());
            assertEquals(approved, reopened.submitDocument("alice", quote(), 1, "shared-key"));
        }
    }
}
