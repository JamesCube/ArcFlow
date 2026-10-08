package com.arcflow.approval.jdbc;

import com.arcflow.approval.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;
import org.h2.jdbcx.JdbcDataSource;
import org.h2.tools.RunScript;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

/** SQL revision3 quote projection, recovery and cross-process compatibility. */
class QuoteDiscountMemberProjectionTest {
    @TempDir Path directory;
    final ObjectMapper mapper = new ObjectMapper();
    BusinessDocument.QuoteDiscount quote(String id) { return new BusinessDocument.QuoteDiscount(id,"Quote","Synthetic","C-1",1,"Equipment",10,new BigDecimal("1E+3"),new BigDecimal("8.5E+2"),"CNY","2099-12-31"); }
    JdbcDataSource database() throws Exception {
        var db=new JdbcDataSource(); db.setURL("jdbc:h2:file:"+directory.resolve("state")+";LOCK_TIMEOUT=5000");
        try(var input=getClass().getResourceAsStream("/com/arcflow/approval/jdbc/schema-h2.sql");var reader=new java.io.InputStreamReader(input,StandardCharsets.UTF_8);var c=db.getConnection()){RunScript.execute(c,reader);} return db;
    }
    ApprovalService service(JdbcDataSource db,ProcessDefinition definition) throws Exception {return new ApprovalService(new JdbcApprovalStore(db,mapper,definition),ServerApprovalStoreContract.USERS);}
    ApprovalService quotes(JdbcDataSource db) throws Exception {return service(db,QuoteDiscountCase.definition("bob","carol"));}
    List<ApprovalService.Request> page(ApprovalService s,String actor,String box) throws Exception {return s.inbox(actor,box,25,null,null,null).items();}
    void sql(JdbcDataSource db,String sql) throws Exception {try(var c=db.getConnection();var s=c.createStatement()){s.execute(sql);}}
    int count(JdbcDataSource db,String table) throws Exception {try(var c=db.getConnection();var s=c.createStatement();var rows=s.executeQuery("SELECT COUNT(*) FROM "+table)){rows.next();return rows.getInt(1);}}

    @Test void quoteProjectionIsProcessScopedAndTracksOnlyActualVotesAcrossReopen() throws Exception {
        var db=database(); ApprovalService.Request done;
        try(var q=quotes(db);var leave=service(db,ProcessDefinition.legacy("bob"));var purchase=service(db,ServerApprovalStoreContract.procurementDefinition("bob"))) {
            var qr=q.submitDocument("alice",quote("Q-1"),1,"quote-key");
            var lr=leave.submit("alice","Leave","Rest",2,1,"leave-key");
            var pr=purchase.submitDocument("alice",ServerApprovalStoreContract.procurement(),1,"purchase-key");
            assertEquals(List.of(qr),page(q,"bob","PENDING")); assertEquals(List.of(lr),page(leave,"bob","PENDING")); assertEquals(List.of(pr),page(purchase,"bob","PENDING"));
            assertTrue(page(q,"carol","PENDING").isEmpty());
            assertEquals(409,ServerApprovalStoreContract.result(()->leave.submit("alice","Leave","Rest",2,1,"quote-key")));
            assertEquals(409,ServerApprovalStoreContract.result(()->purchase.submitDocument("alice",ServerApprovalStoreContract.procurement(),1,"quote-key")));
            var partial=q.decide("bob",qr.id(),"salesManager","APPROVE","Reviewed");
            assertEquals(List.of(partial),page(q,"bob","HANDLED")); assertEquals(List.of(partial),page(q,"carol","PENDING"));
            assertEquals(4,count(db,"arc_request_member"));
            done=q.decide("carol",qr.id(),"finance","APPROVE","Reviewed");
        }
        try(var q=quotes(db)) {
            assertEquals(List.of(done),page(q,"bob","HANDLED")); assertEquals(List.of(done),page(q,"carol","HANDLED"));
            assertTrue(page(q,"bob","PENDING").isEmpty()); assertTrue(page(q,"carol","PENDING").isEmpty());
            assertEquals(done,q.submitDocument("alice",quote("Q-1"),1,"quote-key"));
        }
        assertEquals(3,count(db,"arc_request")); assertEquals(3,count(db,"arc_submission_key"));
    }
    @Test void revisionThreeBackfillRestoresMixedQuoteLeaveAndProcurementProjection() throws Exception {
        var db=database(); String quoteId;
        try(var q=quotes(db);var leave=service(db,ProcessDefinition.legacy("bob"));var purchase=service(db,ServerApprovalStoreContract.procurementDefinition("bob"))) {
            quoteId=q.submitDocument("alice",quote("Q-1"),1,"quote").id();
            q.decide("bob",quoteId,"salesManager","APPROVE","Reviewed");
            leave.submit("alice","Leave","Rest",2,1,"leave"); purchase.submitDocument("alice",ServerApprovalStoreContract.procurement(),1,"purchase");
        }
        // All writers are stopped for the explicit revision3 backfill.
        sql(db,"DELETE FROM arc_request_member"); sql(db,"UPDATE arc_member_projection_state SET ready=FALSE,last_request_id=NULL");
        assertThrows(IOException.class,()->{try(var ignored=quotes(db)) {}});
        int processed=0; boolean ready=false;
        for(int i=0;i<4&&!ready;i++) {var progress=JdbcApprovalStore.backfillMembers(db,mapper,1); processed+=progress.processed();ready=progress.ready();}
        assertTrue(ready); assertEquals(3,processed); assertEquals(4,count(db,"arc_request_member"));
        try(var q=quotes(db);var leave=service(db,ProcessDefinition.legacy("bob"));var purchase=service(db,ServerApprovalStoreContract.procurementDefinition("bob"))) {
            assertEquals(quoteId,page(q,"bob","HANDLED").get(0).id()); assertEquals(quoteId,page(q,"carol","PENDING").get(0).id());
            assertEquals(1,page(leave,"bob","PENDING").size()); assertEquals(1,page(purchase,"bob","PENDING").size());
            assertEquals("quoteDiscount",mapper.valueToTree(page(q,"carol","PENDING").get(0)).path("business").path("type").asText());
        }
    }
    @Test void independentServiceConcurrentQuoteReplayKeepsOneRequestAndTwoMembers() throws Exception {
        var db=database();
        try(var first=quotes(db);var second=quotes(db)) {
            var pool=Executors.newFixedThreadPool(8);var start=new CountDownLatch(1);
            try {
                var tasks=new ArrayList<Future<String>>(); for(int i=0;i<16;i++){var s=i%2==0?first:second;tasks.add(pool.submit(()->{start.await();return s.submitDocument("alice",quote("Q-1"),1,"same").id();}));}
                start.countDown();var ids=new HashSet<String>();for(var task:tasks)ids.add(task.get(30,TimeUnit.SECONDS));
                assertEquals(1,ids.size());assertEquals(1,count(db,"arc_request"));assertEquals(1,count(db,"arc_submission_key"));assertEquals(2,count(db,"arc_request_member"));
                assertEquals(1,page(first,"bob","PENDING").size());assertTrue(page(second,"carol","PENDING").isEmpty());
            }finally{pool.shutdownNow();}
        }
    }
    @Test void corruptedQuoteProjectionFailsClosedRatherThanReturningApprovalButtons() throws Exception {
        var db=database();
        try(var q=quotes(db);var leave=service(db,ProcessDefinition.legacy("bob"))) {
            q.submitDocument("alice",quote("Q-1"),1,"quote");
            sql(db,"UPDATE arc_request_member SET process_id='leave-approval' WHERE actor_id='bob'");
            // The scoped quote index no longer selects this row; it must not expose an action.
            assertTrue(q.inbox("bob","PENDING",25,null,null,null).items().isEmpty());
            // A corrupted member row selected by the other process must fail verification.
            assertThrows(IOException.class,()->leave.inbox("bob","PENDING",25,null,null,null));
        }
    }
    @Test void invalidPersistedQuoteAmountCannotPassMemberInboxSnapshotVerification() throws Exception {
        var db=database();
        try(var q=quotes(db)) {
            var request=q.submitDocument("alice",quote("Q-1"),1,"quote");
            try(var c=db.getConnection();var select=c.prepareStatement("SELECT request_json FROM arc_request WHERE request_id=?")) {
                select.setString(1,request.id());
                try(var rows=select.executeQuery()) {
                    assertTrue(rows.next());var json=(com.fasterxml.jackson.databind.node.ObjectNode)mapper.readTree(rows.getString(1));
                    ((com.fasterxml.jackson.databind.node.ObjectNode)json.get("business")).put("requestedUnitPrice",1001);
                    try(var update=c.prepareStatement("UPDATE arc_request SET request_json=? WHERE request_id=?")) {
                        update.setString(1,json.toString());update.setString(2,request.id());assertEquals(1,update.executeUpdate());
                    }
                }
            }
            assertThrows(IOException.class,()->q.inbox("bob","PENDING",25,null,null,null));
        }
    }

}
