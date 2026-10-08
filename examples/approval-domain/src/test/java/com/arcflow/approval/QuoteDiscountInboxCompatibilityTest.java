package com.arcflow.approval;

import com.arcflow.approval.BusinessDocument.QuoteDiscount;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
import static com.arcflow.approval.BusinessDocumentTest.status;

/** Combined-tree contract: quote payloads must not weaken bounded member inbox semantics. */
class QuoteDiscountInboxCompatibilityTest {
    @TempDir Path directory;
    final ObjectMapper mapper = ApprovalService.strictMapper(new ObjectMapper());
    final ActorDirectoryTest.Directory actors = new ActorDirectoryTest.Directory();
    QuoteDiscountInboxCompatibilityTest() { actors.active.addAll(List.of("303", "404")); }
    ApprovalService open() throws Exception { return new ApprovalService(mapper, directory.resolve("state.json").toString(), actors, QuoteDiscountCase.definition("202", "303")); }
    ApprovalService.InboxPage page(ApprovalService s, String actor, String box) throws Exception { return s.inbox(actor, box, 25, null, null, null); }
    QuoteDiscount quote(String id) { var q = QuoteDiscountTest.quote(); return new QuoteDiscount(id,q.title(),q.reason(),q.customerRef(),q.quoteRevision(),q.item(),q.quantity(),q.listUnitPrice(),q.requestedUnitPrice(),q.currency(),q.validUntil()); }

    @Test void quoteFutureAssigneeActualHandledVoteAndRestartMatchFrozenSnapshot() throws Exception {
        ApprovalService.Request original;
        try (var s = open()) {
            original = s.submitDocument("101", quote("Q-1"), 1, "quote");
            assertEquals(List.of(original), page(s,"202","PENDING").items());
            for (String actor : List.of("101","303","404","1")) assertTrue(page(s,actor,"PENDING").items().isEmpty());
            assertEquals(2,InboxQuery.members(original).size());
            var waiting=s.decide("202",original.id(),"salesManager","APPROVE","Reviewed");
            assertTrue(page(s,"202","PENDING").items().isEmpty());
            assertEquals(List.of(waiting),page(s,"202","HANDLED").items());
            assertEquals(List.of(waiting),page(s,"303","PENDING").items());
            assertTrue(page(s,"303","HANDLED").items().isEmpty());
            assertEquals(original.business(),waiting.business());
        }
        try (var s=open()) {
            var done=s.decide("303",original.id(),"finance","APPROVE","Reviewed");
            for (String actor:List.of("202","303")) {
                assertTrue(page(s,actor,"PENDING").items().isEmpty());
                assertEquals(List.of(done),s.inbox(actor,"HANDLED",25,"APPROVED",1,null).items());
            }
            assertEquals(done,s.submitDocument("101",quote("Q-1"),1,"quote"));
            actors.active.remove("202"); status(403,()->page(s,"202","HANDLED"));
        }
    }
    @Test void schemaFiveToSixUpgradeRetainsAllDocumentTypesAndNoDuplicateInboxRows() throws Exception {
        Path file=directory.resolve("state.json");
        try(var s=open()) {
            var legacy=s.submit("101","Leave","Rest",2,1,"leave");
            var purchase=s.submitDocument("101",BusinessDocumentTest.purchase(),1,"purchase");
            byte[] before=Files.readAllBytes(file); assertEquals(5,mapper.readTree(before).path("schemaVersion").intValue());
            var q=s.submitDocument("101",quote("Q-1"),1,"quote");
            assertArrayEquals(before,Files.readAllBytes(directory.resolve("state.json.schema5.bak")));
            assertEquals(6,mapper.readTree(Files.readAllBytes(file)).path("schemaVersion").intValue());
            assertEquals(Set.of(legacy.id(),purchase.id(),q.id()),new HashSet<>(page(s,"202","PENDING").items().stream().map(ApprovalService.Request::id).toList()));
            status(409,()->s.submitDocument("101",quote("Q-2"),1,"purchase"));
            assertEquals(q,s.submitDocument("101",quote("Q-1"),1,"quote"));
            assertEquals(3,page(s,"202","PENDING").items().size());
        }
        try(var s=open()) { assertEquals(3,page(s,"202","PENDING").items().size()); }
    }
    @Test void failedSchemaSixWriteDoesNotPublishQuoteKeyOrMemberWorkItem() throws Exception {
        Path file=directory.resolve("state.json"), saved=directory.resolve("saved.json");
        try(var s=open()) {
            var purchase=s.submitDocument("101",BusinessDocumentTest.purchase(),1,"purchase");
            byte[] before=Files.readAllBytes(file);
            Files.move(file,saved); Files.createDirectory(file);
            try {
                assertThrows(java.io.IOException.class,()->s.submitDocument("101",quote("Q-1"),1,"quote"));
                assertEquals(List.of(purchase),page(s,"202","PENDING").items());
                assertArrayEquals(before,Files.readAllBytes(directory.resolve("state.json.schema5.bak")));
            } finally { Files.delete(file); Files.move(saved,file); }
            var q=s.submitDocument("101",quote("Q-1"),1,"quote");
            assertEquals(q,s.submitDocument("101",quote("Q-1"),1,"quote"));
            assertEquals(2,page(s,"202","PENDING").items().size());
            assertArrayEquals(before,Files.readAllBytes(directory.resolve("state.json.schema5.bak")));
        }
        try(var s=open()) {assertEquals(2,page(s,"202","PENDING").items().size());}
    }
    @Test void paginatedQuoteRequestsKeepExactAmountsAndCursorScope() throws Exception {
        try(var s=open()) {
            for(int i=0;i<7;i++) s.submitDocument("101",quote("Q-"+i),1,"quote-"+i);
            var first=s.inbox("202","PENDING",2,null,null,null);
            assertEquals(2,first.items().size()); assertNotNull(first.nextCursor());
            status(400,()->s.inbox("303","PENDING",2,null,null,first.nextCursor()));
            status(400,()->s.inbox("202","HANDLED",2,null,null,first.nextCursor()));
            var ids=new HashSet<String>(); String cursor=null;
            do {
                var page=s.inbox("202","PENDING",2,null,null,cursor);
                for(var request:page.items()) {
                    assertTrue(ids.add(request.id())); var q=(QuoteDiscount)request.business();
                    assertEquals("8500",q.requestedTotal().toPlainString()); assertEquals(0,request.days());
                }
                cursor=page.nextCursor();
            } while(cursor!=null);
            assertEquals(7,ids.size());
        }
    }
    @Test void concurrentQuoteReplayCreatesOneMemberWorkItem() throws Exception {
        try(var s=open()) {
            var pool=Executors.newFixedThreadPool(8); var start=new CountDownLatch(1);
            try {
                var futures=new ArrayList<Future<String>>();
                for(int i=0;i<16;i++) futures.add(pool.submit(()->{start.await();return s.submitDocument("101",quote("Q-1"),1,"same").id();}));
                start.countDown(); var ids=new HashSet<String>(); for(var result:futures) ids.add(result.get(15,TimeUnit.SECONDS));
                assertEquals(1,ids.size()); assertEquals(1,page(s,"202","PENDING").items().size());
                assertEquals(2,InboxQuery.members(page(s,"202","PENDING").items().get(0)).size());
            } finally { pool.shutdownNow(); }
        }
    }
    @Test void quoteRejectionDoesNotInventHandledVoteForFutureFinanceReviewer() throws Exception {
        try(var s=open()) {
            var q=s.submitDocument("101",quote("Q-1"),1,"quote");
            var rejected=s.decide("202",q.id(),"salesManager","REJECT","Rejected");
            assertEquals(List.of(rejected),page(s,"202","HANDLED").items());
            assertTrue(page(s,"303","PENDING").items().isEmpty()); assertTrue(page(s,"303","HANDLED").items().isEmpty());
            assertEquals(List.of(rejected),s.list("303"));
        }
    }
}
