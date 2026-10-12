package com.arcflow.approval.graph;

import com.arcflow.approval.*;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;
import static com.arcflow.approval.graph.GraphEngineTest.*;

class GraphApprovalServiceTest {
    static final class Directory implements ActorDirectory {
        final Set<String> active=ConcurrentHashMap.newKeySet(); boolean publisher=true;
        Directory() { active.addAll(List.of("alice","bob","carol","dana")); }
        public Optional<ApprovalService.Person> findActive(String id) { return active.contains(id)?Optional.of(new ApprovalService.Person(id,id)):Optional.empty(); }
        public List<ApprovalService.Person> listActive() { return active.stream().sorted().map(id->new ApprovalService.Person(id,id)).toList(); }
        public boolean canPublish(String id) { return publisher&&"alice".equals(id); }
    }
    static final class Memory implements GraphApprovalStore {
        Snapshot value=new Snapshot(14,GraphSamples.payment(),new Draft(0,1,GraphSamples.payment()),List.of());
        Runnable afterRead=()->{}; boolean lostAck, fail; int forceConflicts; CyclicBarrier barrier; final AtomicInteger attempts=new AtomicInteger();
        public Snapshot snapshot() { Snapshot result; synchronized(this) { result=value; } afterRead.run(); return result; }
        public synchronized boolean saveDraft(long expected,Draft next) { if(value.draft().revision()!=expected)return false; value=new Snapshot(14,value.definition(),next,value.requests()); GraphApprovalService.validateSnapshot(value); return true; }
        public synchronized boolean publish(int expected,long draftRevision,GraphDefinition next) { if(value.definition().version()!=expected||value.draft().revision()!=draftRevision)return false; value=new Snapshot(14,next,new Draft(draftRevision+1,next.version(),next),value.requests()); GraphApprovalService.validateSnapshot(value); return true; }
        public synchronized boolean create(int expected,GraphInstance next) throws IOException { if(expected!=value.definition().version()||value.requests().stream().anyMatch(r->r.id().equals(next.id())||(r.applicantId().equals(next.applicantId())&&r.submissionKey().equals(next.submissionKey()))))return false; var rows=new ArrayList<>(value.requests()); rows.add(next); var proposed=new Snapshot(14,value.definition(),value.draft(),rows); GraphApprovalService.validateSnapshot(proposed); if(fail)throw new IOException("injected failure"); value=proposed; if(lostAck) { lostAck=false; throw new IOException("lost acknowledgement"); } return true; }
        public boolean replace(String id,long expected,GraphInstance next) throws IOException {
            int attempt=attempts.incrementAndGet(); if(barrier!=null&&attempt<=2)try{barrier.await(5,TimeUnit.SECONDS);}catch(Exception e){throw new IOException(e);}
            synchronized(this) { if(forceConflicts-->0)return false; var rows=new ArrayList<>(value.requests()); int ix=0; for(;ix<rows.size();ix++)if(rows.get(ix).id().equals(id))break; if(ix==rows.size()||rows.get(ix).commandRevision()!=expected)return false; GraphEngine.validateTransition(rows.get(ix),next); if(fail)throw new IOException("injected failure"); rows.set(ix,next); value=new Snapshot(14,value.definition(),value.draft(),rows); if(lostAck){lostAck=false;throw new IOException("lost acknowledgement");} return true; }
        }
        public void close() {}
    }
    static ResponseStatusException status(int code,org.junit.jupiter.api.function.Executable action) { var e=assertThrows(ResponseStatusException.class,action); assertEquals(code,e.getStatusCode().value(),e.getReason()); return e; }
    @Test void commandReplayOppositeAndChangedPayloadHaveUnambiguousSemantics() throws Exception {
        var store=new Memory(); var service=new GraphApprovalService(store,new Directory()); var r=service.submit("alice",1,payment("20000"),"key-1"); String task=r.id()+":finance";
        r=service.decide("bob",r.id(),task,"APPROVE","reviewed","command-1"); final var saved=r;
        assertEquals(saved,service.decide("bob",r.id(),task,"APPROVE","reviewed","command-1")); var alias=service.decide("bob",r.id(),task,"APPROVE","new comment ignored","new-key"); assertEquals(saved.tasks(),alias.tasks()); assertEquals(2,alias.commandRevision());
        status(409,()->service.decide("bob",saved.id(),saved.id()+":financeFinal","REJECT","","new-key"));
        status(409,()->service.decide("bob",saved.id(),task,"REJECT","reviewed","command-1")); status(409,()->service.decide("bob",saved.id(),task,"APPROVE","changed","command-1")); status(409,()->service.decide("bob",saved.id(),task,"REJECT","","another-key")); assertEquals(2,store.snapshot().requests().get(0).commandRevision());
    }
    @Test void publicationDraftConflictAndInFlightVersionAreIndependent() throws Exception {
        var store=new Memory(); var service=new GraphApprovalService(store,new Directory()); var r=service.submit("alice",1,payment("9999"),"original");
        var invalid=new GraphDefinition(5,"payment-graph",1,"Incomplete draft",GraphSamples.payment().nodes(),List.of()); service.saveDraft("alice",0,invalid);
        status(400,()->service.publish("alice",1,1)); assertEquals(invalid,service.workspace("alice").draft().definition());
        var original=GraphSamples.payment(); service.saveDraft("alice",1,original); var published=service.publish("alice",1,2); assertEquals(2,published.version());
        status(409,()->service.saveDraft("alice",2,original)); assertEquals(1,service.get("alice",r.id()).definition().version());
        assertEquals(r,service.submit("alice",1,payment("9999"),"original")); status(409,()->service.submit("alice",2,payment("9999"),"original")); status(409,()->service.submit("alice",1,payment("9999"),"fresh"));
    }
    @Test void unselectedActorHasNoReadOrWriteRightsAndRevocationAfterReadIsChecked() throws Exception {
        var store=new Memory(); var dir=new Directory(); var service=new GraphApprovalService(store,dir); var d=GraphSamples.payment(); var nodes=d.nodes().stream().map(n->n.id().equals("businessReview")?GraphSamples.approval(n.id(),n.name(),"dana"):n).toList(); var changed=new GraphDefinition(5,d.id(),1,d.name(),nodes,d.edges()); service.saveDraft("alice",0,changed); service.publish("alice",1,1);
        var low=service.submit("alice",2,payment("1"),"low"); assertTrue(service.list("dana").isEmpty()); status(403,()->service.get("dana",low.id())); status(403,()->service.decide("dana",low.id(),low.id()+":standard","APPROVE","","vote"));
        var high=service.submit("alice",2,payment("20000"),"high"); assertEquals(high,service.get("dana",high.id())); status(403,()->service.decide("dana",high.id(),high.id()+":finance","APPROVE","","vote"));
        store.afterRead=()->dir.active.remove("dana"); status(403,()->service.get("dana",high.id())); assertEquals(0,store.snapshot().requests().get(1).commandRevision());
    }
    @Test void sameActorOwnsTwoRealTasksAndConcurrentArrivalsCreateOneSuccessor() throws Exception {
        for(int iteration=0;iteration<12;iteration++) {
            var store=new Memory(); var service=new GraphApprovalService(store,new Directory()); var d=GraphSamples.payment(); var nodes=d.nodes().stream().map(n->n.id().equals("businessReview")?GraphSamples.approval(n.id(),n.name(),"bob"):n).toList(); service.saveDraft("alice",0,new GraphDefinition(5,d.id(),1,d.name(),nodes,d.edges())); service.publish("alice",1,1);
            var r=service.submit("alice",2,payment("20000"),"parallel"); r=service.decide("bob",r.id(),r.id()+":finance","APPROVE","","finance-1"); assertEquals(Set.of("financeFinal","businessReview"),new HashSet<>(active(r)));
            final String id=r.id(); store.attempts.set(0); store.barrier=new CyclicBarrier(2); ExecutorService pool=Executors.newFixedThreadPool(2);
            try { var a=pool.submit(()->service.decide("bob",id,id+":financeFinal","APPROVE","","finance-final")); var b=pool.submit(()->service.decide("bob",id,id+":businessReview","APPROVE","","business")); a.get(10,TimeUnit.SECONDS); b.get(10,TimeUnit.SECONDS); } finally { pool.shutdownNow(); }
            var joined=service.get("alice",id); assertEquals(List.of("final"),active(joined)); assertEquals(3,joined.commandRevision()); assertEquals(1,joined.events().stream().filter(e->e.type().equals("JOIN_FIRED")).count()); GraphEngine.validateInstance(joined);
        }
    }
    @Test void lostAcknowledgementIsSafelyRecoverableWithoutDuplicateSubmissionOrVote() throws Exception {
        var store=new Memory(); var service=new GraphApprovalService(store,new Directory()); store.lostAck=true; assertThrows(IOException.class,()->service.submit("alice",1,payment("20000"),"recover")); var r=service.submit("alice",1,payment("20000"),"recover"); assertEquals(1,store.snapshot().requests().size());
        store.lostAck=true; assertThrows(IOException.class,()->service.decide("bob",r.id(),r.id()+":finance","APPROVE","","recover-vote")); var recovered=service.decide("bob",r.id(),r.id()+":finance","APPROVE","","recover-vote"); assertEquals(1,recovered.commandRevision()); assertEquals(1,recovered.commands().size());
        store.fail=true; assertThrows(IOException.class,()->service.decide("carol",r.id(),r.id()+":businessReview","APPROVE","","failure")); assertEquals(recovered,service.get("alice",r.id()));
    }
    @Test void previewDoesNotMutateDraftOrRequestsAndWrongCurrencyDoesNotTakeDefault() {
        var store=new Memory(); var service=new GraphApprovalService(store,new Directory()); var before=store.snapshot(); var preview=service.preview("alice",GraphSamples.payment(),payment("12000")); assertEquals(2,active(preview).size()); assertEquals(before,store.snapshot());
        var p=payment("12000"); var wrong=new BusinessDocument.PaymentRequest(1,p.businessId(),p.title(),p.reason(),p.supplierRef(),"USD",p.requestedPaymentOn(),p.lines()); status(400,()->service.preview("alice",GraphSamples.payment(),wrong)); assertEquals(before,store.snapshot());
    }
    @Test void simultaneousOppositeVotesCannotBothCommitAndRejectionRacesLeaveNoLiveTasks() throws Exception {
        for(boolean sameTask:List.of(true,false)) for(int iteration=0;iteration<8;iteration++) {
            var store=new Memory(); var service=new GraphApprovalService(store,new Directory()); var r=service.submit("alice",1,payment("20000"),"race"); final String id=r.id();
            store.barrier=new CyclicBarrier(2); ExecutorService pool=Executors.newFixedThreadPool(2);
            try {
                var reject=pool.submit(()->{try{return service.decide("bob",id,id+":finance","REJECT","","reject");}catch(ResponseStatusException e){assertEquals(409,e.getStatusCode().value());return null;}});
                var approve=pool.submit(()->{try{return service.decide(sameTask?"bob":"carol",id,id+(sameTask?":finance":":businessReview"),"APPROVE","","approve");}catch(ResponseStatusException e){assertEquals(409,e.getStatusCode().value());return null;}});
                reject.get(10,TimeUnit.SECONDS); approve.get(10,TimeUnit.SECONDS);
            } finally {pool.shutdownNow();}
            var finalState=service.get("alice",id); GraphEngine.validateInstance(finalState);
            if(sameTask) assertEquals(1,finalState.commands().size());
            else {assertEquals("REJECTED",finalState.status());assertTrue(active(finalState).isEmpty());}
        }
    }

}
