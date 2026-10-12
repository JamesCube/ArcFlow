package com.arcflow.approval.graph;

import com.arcflow.approval.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class GraphEngineTest {
    static final String AT="2026-10-11T07:00:00Z";
    static BusinessDocument.PaymentRequest payment(String amount) {
        return new BusinessDocument.PaymentRequest(1,"PAY-001","Synthetic supplier payment","Invoice allocation review","SUP-001","CNY","2026-10-12",List.of(new BusinessDocument.PaymentLine("L1","INV-001","Synthetic invoice",new BigDecimal(amount),BigDecimal.ZERO,new BigDecimal(amount),BigDecimal.ZERO,"")));
    }
    static GraphInstance start(String amount) { return GraphEngine.start("request-1","submit-1","alice",GraphSamples.payment(),payment(amount),AT); }
    static GraphInstance vote(GraphInstance before,String node,String actor,String decision) {
        return GraphEngine.decide(before,"request-1:"+node,actor,decision,"",actor+"-"+node,AT);
    }
    static List<String> active(GraphInstance r) { return r.tasks().stream().filter(t->t.status().equals("ACTIVE")).map(GraphInstance.Task::nodeId).toList(); }
    @Test void thresholdDefaultAndFirstMatchingPriorityUseExactServerFacts() {
        var low=start("9999.99"); assertEquals("otherwise",low.routes().get(0).selectedEdgeId()); assertEquals(List.of("standard"),active(low));
        var high=start("10000.00"); assertEquals("highValue",high.routes().get(0).selectedEdgeId()); assertEquals(Set.of("finance","businessReview"),new HashSet<>(active(high)));
        assertEquals("CNY 10000",high.routes().get(0).evaluations().get(0).facts().get(0).actualValue());
        var d=GraphSamples.payment(); var nodes=new ArrayList<>(d.nodes()); nodes.add(GraphSamples.approval("second","Second true condition","carol"));
        var edges=new ArrayList<>(d.edges()); edges.add(2,new GraphDefinition.Edge("secondMatch","amount","second","Also true",new ConditionalRouting.Rule("ALL",List.of(ConditionalRouting.Predicate.money("GT","CNY",new BigDecimal("5000")))),false)); edges.add(GraphSamples.edge("secondMerge","second","amountMerge","Merge"));
        var overlapping=new GraphDefinition(5,d.id(),1,d.name(),nodes,edges); GraphDefinition.validate(overlapping);
        var instance=GraphEngine.start("request-1","submit-1","alice",overlapping,payment("10000"),AT);
        assertEquals("highValue",instance.routes().get(0).selectedEdgeId()); assertTrue(instance.routes().get(0).evaluations().get(1).result()); assertFalse(GraphEngine.selectedNodeIds(instance).contains("second"));
    }
    @Test void branchesAdvanceIndependentlyThenJoinFiresExactlyOnce() {
        var r=start("12000"); assertEquals(0,r.commandRevision()); assertTrue(r.events().size()>1);
        r=vote(r,"businessReview","carol","APPROVE"); assertEquals(List.of("finance"),active(r)); assertEquals(List.of("businessBranch"),r.forks().get(0).arrivedBranchIds()); assertFalse(r.forks().get(0).fired());
        r=vote(r,"finance","bob","APPROVE"); assertEquals(List.of("financeFinal"),active(r)); assertFalse(r.forks().get(0).fired());
        r=vote(r,"financeFinal","bob","APPROVE"); assertEquals(List.of("final"),active(r)); assertTrue(r.forks().get(0).fired()); assertEquals(1,r.events().stream().filter(e->e.type().equals("JOIN_FIRED")).count());
        GraphEngine.validateInstance(r); r=vote(r,"final","carol","APPROVE"); assertEquals("APPROVED",r.status()); assertEquals(4,r.commandRevision()); assertTrue(active(r).isEmpty()); GraphEngine.validateInstance(r);
    }
    @Test void rejectCancelsOtherBranchAndNeverFabricatesVotes() {
        var r=vote(start("20000"),"finance","bob","REJECT"); assertEquals("REJECTED",r.status()); assertTrue(active(r).isEmpty());
        var other=r.tasks().stream().filter(t->t.nodeId().equals("businessReview")).findFirst().orElseThrow(); assertEquals("CANCELLED",other.status()); assertTrue(other.votes().isEmpty()); assertEquals(1,r.commands().size()); GraphEngine.validateInstance(r);
        var finalR=r; assertThrows(IllegalArgumentException.class,()->vote(finalR,"businessReview","carol","APPROVE"));
    }
    @Test void groupsRetainAnyVotingWithoutPretendingTheyAreParallelPaths() {
        var d=GraphSamples.payment(); var nodes=new ArrayList<>(d.nodes()); int ix=0; for(;ix<nodes.size();ix++)if(nodes.get(ix).id().equals("finance"))break;
        nodes.set(ix,new GraphDefinition.Node("finance","parallelApproval","Review group",List.of("bob","carol"),"ANY",null));
        var group=new GraphDefinition(5,d.id(),1,d.name(),nodes,d.edges()); var r=GraphEngine.start("request-1","submit-1","alice",group,payment("20000"),AT);
        r=vote(r,"finance","bob","REJECT"); assertEquals("PENDING",r.status()); assertEquals(2,active(r).size());
        r=vote(r,"finance","carol","APPROVE"); assertEquals(Set.of("financeFinal","businessReview"),new HashSet<>(active(r))); GraphEngine.validateInstance(r);
        var rejected=GraphEngine.start("request-1","submit-1","alice",group,payment("20000"),AT); rejected=vote(rejected,"finance","bob","REJECT"); rejected=vote(rejected,"finance","carol","REJECT"); assertEquals("REJECTED",rejected.status()); assertTrue(active(rejected).isEmpty());
    }
    @Test void snapshotReplayRejectsForgedRouteArrivalTaskAndHistory() {
        var r=start("20000");
        var forgedRoute=new GraphInstance(r.id(),r.submissionKey(),r.applicantId(),r.status(),r.createdAt(),r.updatedAt(),r.commandRevision(),r.definition(),r.business(),r.tasks(),r.forks(),List.of(new GraphInstance.Route("amount","otherwise",r.routes().get(0).evaluations())),r.events(),r.commands());
        assertThrows(IllegalArgumentException.class,()->GraphEngine.validateInstance(forgedRoute));
        var f=r.forks().get(0); var forgedFork=new GraphInstance.Fork(f.id(),f.forkId(),f.joinId(),f.expectedBranchIds(),f.expectedBranchIds(),true,f.lineage());
        var forged=new GraphInstance(r.id(),r.submissionKey(),r.applicantId(),"APPROVED",r.createdAt(),r.updatedAt(),0,r.definition(),r.business(),r.tasks(),List.of(forgedFork),r.routes(),r.events(),r.commands()); assertThrows(IllegalArgumentException.class,()->GraphEngine.validateInstance(forged));
        var next=vote(r,"finance","bob","APPROVE"); GraphEngine.validateTransition(r,next); assertThrows(IllegalArgumentException.class,()->GraphEngine.validateTransition(r,vote(next,"businessReview","carol","APPROVE")));
    }
    @Test void strictGraphWireRejectsMissingUnknownAndWrongScalarFields() throws Exception {
        ObjectMapper mapper=GraphApprovalService.strictMapper(new ObjectMapper()); String encoded=mapper.writeValueAsString(GraphSamples.payment()); assertEquals(GraphSamples.payment(),mapper.readValue(encoded,GraphDefinition.class));
        var tree=mapper.readTree(encoded); ((com.fasterxml.jackson.databind.node.ObjectNode)tree.get("nodes").get(0)).remove("pairId"); assertThrows(Exception.class,()->mapper.treeToValue(tree,GraphDefinition.class));
        var tree2=mapper.readTree(encoded); ((com.fasterxml.jackson.databind.node.ObjectNode)tree2).put("script","unsafe"); assertThrows(Exception.class,()->mapper.treeToValue(tree2,GraphDefinition.class));
        assertThrows(Exception.class,()->mapper.readValue(encoded.replace("\"defaultBranch\":false","\"defaultBranch\":\"false\""),GraphDefinition.class));
        var instance=start("12000"); assertEquals(instance,mapper.readValue(mapper.writeValueAsString(instance),GraphInstance.class));
    }
    @Test void malformedPairCrossLaneAndMissingDefaultArePreciseErrors() {
        var d=GraphSamples.payment(); var edges=new ArrayList<>(d.edges()); edges.removeIf(e->e.id().equals("otherwise"));
        var invalid=new GraphDefinition(5,d.id(),1,d.name(),d.nodes(),edges); assertTrue(GraphDefinition.diagnostics(invalid).stream().anyMatch(e->e.code().equals("DEFAULT_BRANCH")&&e.nodeId().equals("amount")));
        var cross=new ArrayList<>(d.edges()); int ix=0; for(;ix<cross.size();ix++)if(cross.get(ix).id().equals("financeNext"))break; cross.set(ix,GraphSamples.edge("financeNext","finance","businessReview","Cross lane"));
        assertFalse(GraphDefinition.diagnostics(new GraphDefinition(5,d.id(),1,d.name(),d.nodes(),cross)).isEmpty());
        var emptyNodes=List.of(GraphSamples.structural("start","start","Start",null),GraphSamples.structural("end","end","End",null));
        assertTrue(GraphDefinition.diagnostics(new GraphDefinition(5,"test",1,"Empty",emptyNodes,List.of(GraphSamples.edge("direct","start","end","Direct")))).stream().anyMatch(e->e.code().equals("EMPTY_APPROVAL_PATH")));
    }
    @Test void nestedExclusiveInsideParallelWaitsOnlyForItsSelectedBranch() {
        var d=GraphSamples.payment();
        var nodes=d.nodes().stream().map(n->switch(n.id()) {
            case "amount" -> GraphSamples.structural(n.id(),"parallelFork",n.name(),n.pairId());
            case "amountMerge" -> GraphSamples.structural(n.id(),"parallelJoin",n.name(),n.pairId());
            case "reviewFork" -> GraphSamples.structural(n.id(),"exclusiveGateway",n.name(),n.pairId());
            case "reviewJoin" -> GraphSamples.structural(n.id(),"exclusiveMerge",n.name(),n.pairId());
            default -> n;
        }).toList();
        var rule=new ConditionalRouting.Rule("ALL",List.of(ConditionalRouting.Predicate.money("GTE","CNY",new BigDecimal("10000"))));
        var edges=d.edges().stream().map(e->switch(e.id()) {
            case "highValue","otherwise" -> new GraphDefinition.Edge(e.id(),e.source(),e.target(),e.label(),null,false);
            case "financeBranch" -> new GraphDefinition.Edge(e.id(),e.source(),e.target(),e.label(),rule,false);
            case "businessBranch" -> new GraphDefinition.Edge(e.id(),e.source(),e.target(),e.label(),null,true);
            default -> e;
        }).toList();
        var definition=new GraphDefinition(5,d.id(),1,d.name(),nodes,edges); GraphDefinition.validate(definition);
        var r=GraphEngine.start("request-1","nested","alice",definition,payment("1"),AT); assertEquals(Set.of("businessReview","standard"),new HashSet<>(active(r))); assertFalse(GraphEngine.selectedNodeIds(r).contains("finance"));
        r=vote(r,"standard","bob","APPROVE"); assertEquals(List.of("businessReview"),active(r)); assertFalse(r.forks().get(0).fired());
        r=vote(r,"businessReview","carol","APPROVE"); assertEquals(List.of("final"),active(r)); assertTrue(r.forks().get(0).fired()); GraphEngine.validateInstance(r);
    }
    @Test void thirdNestedRegionIsRejectedButTwoLevelSampleIsValid() {
        var d=GraphSamples.payment(); GraphDefinition.validate(d);
        var nodes=new ArrayList<>(d.nodes()); nodes.add(GraphSamples.structural("extraFork","parallelFork","Too deep","extraJoin")); nodes.add(GraphSamples.structural("extraJoin","parallelJoin","Too deep join","extraFork")); nodes.add(GraphSamples.approval("extraA","A","bob")); nodes.add(GraphSamples.approval("extraB","B","carol"));
        var edges=new ArrayList<>(d.edges()); edges.removeIf(e->e.id().equals("financeNext")); edges.addAll(List.of(GraphSamples.edge("intoExtra","finance","extraFork","Enter"),GraphSamples.edge("extraLaneA","extraFork","extraA","A"),GraphSamples.edge("extraLaneB","extraFork","extraB","B"),GraphSamples.edge("extraArriveA","extraA","extraJoin","A done"),GraphSamples.edge("extraArriveB","extraB","extraJoin","B done"),GraphSamples.edge("outExtra","extraJoin","financeFinal","Continue")));
        assertTrue(GraphDefinition.diagnostics(new GraphDefinition(5,d.id(),1,d.name(),nodes,edges)).stream().anyMatch(e->e.code().equals("DEPTH_LIMIT")&&e.nodeId().equals("extraFork")));
    }
    @Test void everyRandomizedApprovalOrderingTerminatesWithoutDuplicateActivation() {
        Random random=new Random(5812);
        for(int run=0;run<100;run++) {
            var r=start(run%2==0?"10000":"9999.99");
            while(r.status().equals("PENDING")) {
                var pending=r.tasks().stream().filter(t->t.status().equals("ACTIVE")).toList(); assertFalse(pending.isEmpty());
                var task=pending.get(random.nextInt(pending.size())); r=vote(r,task.nodeId(),task.participants().get(0),"APPROVE"); GraphEngine.validateInstance(r);
            }
            assertEquals("APPROVED",r.status()); assertEquals(r.tasks().size(),new HashSet<>(r.tasks().stream().map(GraphInstance.Task::id).toList()).size());
            for(var fork:r.forks()) { assertTrue(fork.fired()); assertEquals(1,r.events().stream().filter(e->e.type().equals("JOIN_FIRED")&&fork.joinId().equals(e.nodeId())).count()); }
        }
    }

    @Test void replayReceiptBudgetNeverConsumesCapacityForOutstandingRealVotes() {
        var r=vote(start("20000"),"finance","bob","APPROVE");
        for(int i=0;i<768;i++)r=GraphEngine.decide(r,"request-1:finance","bob","APPROVE","alias","alias-"+i,AT);
        assertEquals(768,GraphEngine.replayReceiptCount(r)); assertEquals(769,r.commandRevision()); final var full=r;
        assertThrows(IllegalArgumentException.class,()->GraphEngine.decide(full,"request-1:finance","bob","APPROVE","alias","alias-overflow",AT));
        r=vote(r,"businessReview","carol","APPROVE");r=vote(r,"financeFinal","bob","APPROVE");r=vote(r,"final","carol","APPROVE");
        assertEquals("APPROVED",r.status());assertEquals(772,r.commandRevision());GraphEngine.validateInstance(r);
    }

}
