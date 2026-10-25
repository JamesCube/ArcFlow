package com.arcflow.approval.graph;

import com.arcflow.approval.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static com.arcflow.approval.graph.GraphBusinessScenariosTest.travel;
import static com.arcflow.approval.graph.GraphApprovalServiceTest.status;
import static org.junit.jupiter.api.Assertions.*;

/** Host-neutral numeric assignment contract; real RuoYi RBAC is covered by native integration smoke. */
class GraphNativeTravelSeedTest {
    @TempDir Path directory;
    static final class Directory implements ActorDirectory {
        final Set<String> active=new HashSet<>(Set.of("1","100","101","102","103","104"));
        final Set<String> reviewers=new HashSet<>(Set.of("101","102","103"));
        public Optional<ApprovalService.Person> findActive(String id) { return active.contains(id)?Optional.of(new ApprovalService.Person(id,id)):Optional.empty(); }
        public List<ApprovalService.Person> listActive() { return active.stream().map(id->findActive(id).orElseThrow()).toList(); }
        public boolean canPublish(String id) { return id.equals("1"); }
        public boolean canAssignApproval(String id) { return active.contains(id)&&reviewers.contains(id); }
    }
    static GraphInstance vote(GraphApprovalService service,GraphInstance request,String node,String actor,String decision,String key) throws Exception {
        var task=request.tasks().stream().filter(t->t.nodeId().equals(node)).findFirst().orElseThrow();
        return service.decide(actor,request.id(),task.id(),decision,"",key);
    }
    public static final class LockProbe {
        public static void main(String[] args) throws Exception {
            try(var store=new JsonGraphApprovalStore(new ObjectMapper(),args[0],GraphSamples.travel("101","102","103"))) {
                if(store.snapshot().storageSchemaVersion()!=14)throw new IllegalStateException("Unexpected schema");
                System.out.println("OPENED");
            } catch(java.io.IOException failure) {
                if(!"Another process owns the graph data file".equals(failure.getMessage()))throw failure;
                System.out.println("LOCKED");System.exit(23);
            }
        }
    }
    private void probe(Path file,int expected,String marker) throws Exception {
        String executable=Path.of(System.getProperty("java.home"),"bin","java").toString();
        String classpath=System.getProperty("surefire.test.class.path",System.getProperty("java.class.path"));
        Process child=new ProcessBuilder(executable,"-cp",classpath,LockProbe.class.getName(),file.toString()).redirectErrorStream(true).start();
        try {
            assertTrue(child.waitFor(30,java.util.concurrent.TimeUnit.SECONDS),"Graph lock subprocess timed out");
            String output=new String(child.getInputStream().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
            assertEquals(expected,child.exitValue(),output);assertTrue(output.contains(marker),output);
        } finally { if(child.isAlive())child.destroyForcibly(); }
    }
    @Test void nativeTravelStoreExcludesAnotherJvmAndReleasesOwnershipOnClose() throws Exception {
        Path file=directory.resolve("exclusive.travel.graph.json");byte[] original;
        try(var store=new JsonGraphApprovalStore(new ObjectMapper(),file.toString(),GraphSamples.travel("101","102","103"))) {
            original=Files.readAllBytes(file);probe(file,23,"LOCKED");assertArrayEquals(original,Files.readAllBytes(file));
        }
        probe(file,0,"OPENED");assertArrayEquals(original,Files.readAllBytes(file));
    }
    @Test void seedOverridesOnlyHostRolesWhileStandaloneAssignmentsStayUnchanged() {
        var nativeSeed=GraphSamples.travel("101","102","103");GraphDefinition.validate(nativeSeed);
        assertEquals(List.of("101","102","103"),nativeSeed.nodes().stream().filter(GraphDefinition.Node::human).flatMap(n->n.assigneeIds().stream()).toList());
        assertEquals(List.of("bob","bob","carol"),GraphSamples.travel().nodes().stream().filter(GraphDefinition.Node::human).flatMap(n->n.assigneeIds().stream()).toList());
        assertEquals(6,nativeSeed.schemaVersion());assertEquals("travel-graph",nativeSeed.id());
    }
    @Test void waitingJoinRestartsWithFrozenNumericActorsDespiteChangedBootstrapSeedAndKeysReplay() throws Exception {
        Path file=directory.resolve("native.travel.graph.json");var actors=new Directory();GraphInstance waiting;
        try(var service=new GraphApprovalService(new JsonGraphApprovalStore(new ObjectMapper(),file.toString(),GraphSamples.travel("101","102","103")),actors)) {
            var submitted=service.submit("100",1,travel("10000.00"),"submit-native");
            var fork=vote(service,submitted,"manager","101","APPROVE","manager-key");
            waiting=vote(service,fork,"operations","102","APPROVE","operations-key");
            assertFalse(waiting.forks().get(0).fired());assertEquals(1,waiting.forks().get(0).arrivedBranchIds().size());
            service.saveDraft("1",0,GraphSamples.travel("103","103","103"));service.publish("1",1,1);
        }
        try(var service=new GraphApprovalService(new JsonGraphApprovalStore(new ObjectMapper(),file.toString(),GraphSamples.travel("103","103","103")),actors)) {
            assertEquals(waiting,service.get("100",waiting.id()));
            assertEquals(waiting,service.submit("100",1,travel("10000.00"),"submit-native"));
            assertEquals(waiting,vote(service,waiting,"operations","102","APPROVE","operations-key"));
            var done=vote(service,waiting,"finance","103","APPROVE","finance-key");
            assertEquals("APPROVED",done.status());assertEquals(1,done.events().stream().filter(e->e.type().equals("JOIN_FIRED")).count());
            assertEquals(1,done.definition().version());assertEquals(2,service.process("100").version());
            assertEquals(List.of("101","102","103"),done.definition().nodes().stream().filter(GraphDefinition.Node::human).flatMap(n->n.assigneeIds().stream()).toList());
        }
    }
    @Test void unavailableUnpermittedAndDemoAssignmentsCannotPublishOrSubmit() throws Exception {
        var actors=new Directory();var seed=GraphSamples.travel("101","102","103");
        try(var service=new GraphApprovalService(new JsonGraphApprovalStore(new ObjectMapper(),directory.resolve("native.graph.json").toString(),seed),actors)) {
            actors.reviewers.remove("102");status(400,()->service.submit("100",1,travel("10000"),"blocked"));
            var low=service.submit("100",1,travel("1"),"selected-only");assertEquals("PENDING",low.status());
            service.saveDraft("1",0,seed);status(400,()->service.publish("1",1,1));
            actors.reviewers.add("102");actors.active.remove("103");status(400,()->service.publish("1",1,1));
            actors.active.add("103");service.saveDraft("1",1,GraphSamples.travel());status(400,()->service.publish("1",1,2));
            assertEquals(1,service.process("100").version());
        }
    }
    @Test void publisherHasNoVisibilityOrVoteBypassAndRejectionCancelsJoin() throws Exception {
        var actors=new Directory();try(var service=new GraphApprovalService(new JsonGraphApprovalStore(new ObjectMapper(),directory.resolve("native.graph.json").toString(),GraphSamples.travel("101","102","103")),actors)) {
            var submitted=service.submit("100",1,travel("10000"),"reject");
            status(403,()->service.get("1",submitted.id()));assertTrue(service.list("1").isEmpty());
            status(403,()->vote(service,submitted,"manager","1","APPROVE","admin"));
            var fork=vote(service,submitted,"manager","101","APPROVE","manager");
            var rejected=vote(service,fork,"finance","103","REJECT","finance");
            assertEquals("REJECTED",rejected.status());assertFalse(rejected.forks().get(0).fired());
            assertEquals(1,rejected.tasks().stream().filter(t->t.status().equals("CANCELLED")).count());
        }
    }
}
