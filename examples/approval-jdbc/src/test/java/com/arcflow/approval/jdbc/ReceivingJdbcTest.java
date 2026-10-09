package com.arcflow.approval.jdbc;

import com.arcflow.approval.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import org.h2.jdbcx.JdbcDataSource;
import org.h2.tools.RunScript;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class ReceivingJdbcTest {
    @TempDir Path directory;
    final ObjectMapper mapper=new ObjectMapper();
    BusinessDocument.Receiving receipt(){return new BusinessDocument.Receiving(1,"GR-DEMO-1","Receiving","Synthetic manual PO","PO-DEMO-1","EAST","2026-10-09",List.of(
        new BusinessDocument.ReceivingLine("line-1","PO-L1","Demo sensors","PCS",20,10,8,2,"Damaged casing"),
        new BusinessDocument.ReceivingLine("line-2","PO-L2","Demo cables","BOX",10,5,5,0,"")));}
    JdbcDataSource database(){var source=new JdbcDataSource();source.setURL("jdbc:h2:file:"+directory.resolve("receiving")+";LOCK_TIMEOUT=5000");return source;}
    void install(JdbcDataSource source)throws Exception{try(var input=getClass().getResourceAsStream("/com/arcflow/approval/jdbc/schema-h2.sql");var reader=new java.io.InputStreamReader(input,StandardCharsets.UTF_8);var connection=source.getConnection()){RunScript.execute(connection,reader);}}
    ApprovalService open(JdbcDataSource source,ProcessDefinition definition)throws Exception{return new ApprovalService(new JdbcApprovalStore(source,mapper,definition),ServerApprovalStoreContract.USERS);}
    @Test void receivingAllVotesAndNextStageSurviveJdbcReopenWithScopedKeys()throws Exception{
        var source=database();install(source);var definition=ScenarioCatalog.receiving("bob","carol","bob").initialProcess();ApprovalService.Request done;
        try(var receiving=open(source,definition);var leave=open(source,ProcessDefinition.legacy("bob"))){
            var created=receiving.submitDocument("alice",receipt(),1,"shared-key");assertEquals(409,ServerApprovalStoreContract.result(()->leave.submit("alice","Leave","Rest",1,1,"shared-key")));
            var first=receiving.decide("bob",created.id(),"receiving-inspection","APPROVE","Warehouse");assertEquals("receiving-inspection",first.currentStepId());assertEquals(first,receiving.decide("bob",created.id(),"receiving-inspection","APPROVE","Retry"));
            receiving.decide("carol",created.id(),"receiving-inspection","APPROVE","Quality");done=receiving.decide("bob",created.id(),"procurement-review","APPROVE","Procurement");assertEquals("APPROVED",done.status());assertEquals(receipt(),done.business());
        }
        try(var reopened=open(database(),definition)){assertEquals(List.of(done),reopened.list("alice"));assertEquals(done,reopened.submitDocument("alice",receipt(),1,"shared-key"));}
    }
    @Test void receivingPayloadTamperingCannotBecomeReadableState()throws Exception{
        var source=database();install(source);var definition=ScenarioCatalog.receiving("bob","carol","bob").initialProcess();String id;
        try(var receiving=open(source,definition)){id=receiving.submitDocument("alice",receipt(),1,"tamper").id();}
        try(var connection=source.getConnection();var query=connection.prepareStatement("SELECT request_json FROM arc_request WHERE request_id = ?")){
            query.setString(1,id);try(var rows=query.executeQuery()){assertTrue(rows.next());String bad=rows.getString(1).replace("\"accepted\":8","\"accepted\":9");
                try(var update=connection.prepareStatement("UPDATE arc_request SET request_json = ? WHERE request_id = ?")){update.setString(1,bad);update.setString(2,id);assertEquals(1,update.executeUpdate());}}
        }
        try(var reopened=open(source,definition)){assertThrows(java.io.UncheckedIOException.class,()->reopened.list("alice"));}
    }
    @Test void negativeZeroInRawJdbcPayloadIsRejectedBeforeRequestTreeNormalization()throws Exception{
        var source=database();install(source);var definition=ScenarioCatalog.receiving("bob","carol","bob").initialProcess();String id;
        try(var receiving=open(source,definition)){id=receiving.submitDocument("alice",receipt(),1,"negative-zero").id();}
        try(var connection=source.getConnection();var query=connection.prepareStatement("SELECT request_json FROM arc_request WHERE request_id = ?")){
            query.setString(1,id);try(var rows=query.executeQuery()){assertTrue(rows.next());String original=rows.getString(1),bad=original.replace("\"rejected\":0","\"rejected\":-0");assertNotEquals(original,bad);
                try(var update=connection.prepareStatement("UPDATE arc_request SET request_json = ? WHERE request_id = ?")){update.setString(1,bad);update.setString(2,id);assertEquals(1,update.executeUpdate());}}
        }
        try(var reopened=open(source,definition)){assertThrows(java.io.UncheckedIOException.class,()->reopened.list("alice"));}
    }

}
