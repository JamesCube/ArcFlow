package com.arcflow.approval;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class ConditionalRoutingStoreTest {
    @TempDir Path dir;
    final ObjectMapper mapper=ApprovalService.strictMapper(new ObjectMapper());
    final ActorDirectoryTest.Directory actors=new ActorDirectoryTest.Directory();
    ConditionalRoutingStoreTest(){actors.active.addAll(List.of("303","404","505"));}
    Path file(){return dir.resolve("state.json");}
    ProcessDefinition routed(){return ConditionalRoutingTest.definition(ConditionalRoutingTest.money("GTE","10000"));}
    ProcessDefinition old(){var d=routed();var nodes=new ArrayList<>(d.nodes());var n=nodes.get(2);nodes.set(2,new ProcessDefinition.ProcessNode(n.id(),n.type(),n.name(),n.assigneeId(),n.assigneeIds(),n.completionMode()));return new ProcessDefinition(3,d.id(),1,d.name(),nodes);}
    ApprovalService open()throws IOException{return new ApprovalService(mapper,file().toString(),actors,old());}
    Map<String,byte[]> backups()throws IOException{var result=new TreeMap<String,byte[]>();try(var paths=Files.list(dir)){for(var p:paths.filter(p->p.toString().endsWith(".bak")).toList())result.put(p.getFileName().toString(),Files.readAllBytes(p));}return result;}
    void equalBackups(Map<String,byte[]> expected)throws IOException{var actual=backups();assertEquals(expected.keySet(),actual.keySet());for(String k:expected.keySet())assertArrayEquals(expected.get(k),actual.get(k));}
    @Test void everyKnownWrapperStillReadsOldShapeWithoutRewritingOrBackup()throws Exception{
        var sequential=new ProcessDefinition(2,"erp-payment",1,"Old",List.of(new ProcessDefinition.ProcessNode("start","start","Start",null),new ProcessDefinition.ProcessNode("base","approval","Base","202"),new ProcessDefinition.ProcessNode("end","end","End",null)));
        for(int schema=1;schema<=13;schema++){
            var root=mapper.createObjectNode().put("schemaVersion",schema);root.putArray("requests");if(schema>=2)root.set("definition",mapper.valueToTree(sequential));if(schema>=4)root.putArray("submissions");if(schema==13)root.putArray("routingDefinitions");
            byte[] bytes=(root.toPrettyString()+"\n  ").getBytes(java.nio.charset.StandardCharsets.UTF_8);Files.write(file(),bytes);
            try(var store=open()){assertTrue(store.list("101").isEmpty());}assertArrayEquals(bytes,Files.readAllBytes(file()));assertTrue(backups().isEmpty());
        }
    }
    @Test void publishingSchemaFourImmediatelyUpgradesEmptyTwelveAndBacksUpExactBytes()throws Exception{
        var root=mapper.createObjectNode().put("schemaVersion",12);root.set("definition",mapper.valueToTree(old()));root.putArray("requests");root.putArray("submissions");
        byte[] bytes=(root.toPrettyString()+"\n ").getBytes(java.nio.charset.StandardCharsets.UTF_8);Files.write(file(),bytes);
        try(var service=open()){
            service.publishForDocument("1",1,routed(),BusinessDocument.PaymentRequest.class);
            assertEquals(13,mapper.readTree(Files.readAllBytes(file())).path("schemaVersion").asInt());assertTrue(service.list("101").isEmpty());
            assertArrayEquals(bytes,Files.readAllBytes(dir.resolve("state.json.schema12.bak")));
            service.publishForDocument("1",2,new ProcessDefinition(3,old().id(),2,"Return to fixed",old().nodes()),BusinessDocument.PaymentRequest.class);
            assertEquals(13,mapper.readTree(Files.readAllBytes(file())).path("schemaVersion").asInt());
        }
    }
    @Test void failedUpgradeRetainsMemoryAndImmediateBytesThenRetriesOneBackup()throws Exception{
        ApprovalService.Request oldRequest;
        try(var service=open()){
            oldRequest=service.submitDocument("101",PaymentContractDocumentTest.payment(),1,"old");service.decide("202",oldRequest.id(),"base","APPROVE","Immediately preceding vote");
            byte[] bytes=Files.readAllBytes(file());Path saved=dir.resolve("saved.json");Files.move(file(),saved);Files.createDirectory(file());Files.writeString(file().resolve("block"),"block");
            try{assertThrows(IOException.class,()->service.publishForDocument("1",1,routed(),BusinessDocument.PaymentRequest.class));assertEquals(1,service.process().version());assertEquals(2,service.list("101").get(0).history().size());assertArrayEquals(bytes,Files.readAllBytes(dir.resolve("state.json.schema11.bak")));}
            finally{Files.delete(file().resolve("block"));Files.delete(file());Files.move(saved,file());}
            var previous=backups();service.publishForDocument("1",1,routed(),BusinessDocument.PaymentRequest.class);equalBackups(previous);
            assertEquals(13,mapper.readTree(Files.readAllBytes(file())).path("schemaVersion").asInt());
            var restored=service.submitDocument("101",PaymentContractDocumentTest.payment(),1,"old");assertNull(restored.routing());assertEquals(oldRequest.definition(),restored.definition());assertEquals("risk",restored.currentStepId());
        }
        try(var service=open()){assertEquals(2,service.process().version());assertNull(service.list("101").get(0).routing());}
    }
    @Test void everyRouteTamperAndLowerWrapperRejectsWithoutChangingAnyBytes()throws Exception{
        try(var service=open()){service.publishForDocument("1",1,routed(),BusinessDocument.PaymentRequest.class);service.submitDocument("101",PaymentContractDocumentTest.payment(),2,"route");}
        byte[] good=Files.readAllBytes(file());var baseline=(ObjectNode)mapper.readTree(good);var variants=new ArrayList<ObjectNode>();
        for(int schema:List.of(1,2,3,4,5,6,7,8,9,10,11,12,14)){var variant=baseline.deepCopy();variant.put("schemaVersion",schema);variants.add(variant);}
        for(String field:List.of("schemaVersion","stepIds","evaluations")){var variant=baseline.deepCopy();((ObjectNode)variant.path("requests").get(0).get("routing")).remove(field);variants.add(variant);}
        var missing=baseline.deepCopy();((ObjectNode)missing.path("requests").get(0)).remove("routing");variants.add(missing);
        var nullRoute=baseline.deepCopy();((ObjectNode)nullRoute.path("requests").get(0)).putNull("routing");variants.add(nullRoute);
        var unknown=baseline.deepCopy();((ObjectNode)unknown.path("requests").get(0).get("routing")).put("script","true");variants.add(unknown);
        for(List<String> ids:List.of(List.<String>of(),List.of("risk"),List.of("base","risk","final"),List.of("final","base"),List.of("base","base","final"),List.of("base","unknown","final"))){var variant=baseline.deepCopy();var array=((ObjectNode)variant.path("requests").get(0).get("routing")).putArray("stepIds");ids.forEach(array::add);variants.add(variant);}
        for(String field:List.of("stepId","result","predicates")){var variant=baseline.deepCopy();((ObjectNode)variant.path("requests").get(0).path("routing").path("evaluations").get(0)).remove(field);variants.add(variant);}
        var lie=baseline.deepCopy();((ObjectNode)lie.path("requests").get(0).path("routing").path("evaluations").get(0)).put("result",true);variants.add(lie);
        var fact=baseline.deepCopy();((ObjectNode)fact.path("requests").get(0).path("routing").path("evaluations").get(0).path("predicates").get(0)).put("actualValue","CNY 999999");variants.add(fact);
        var version=baseline.deepCopy();((ObjectNode)version.path("requests").get(0).get("routing")).put("schemaVersion",2);variants.add(version);
        var oldDefinition=baseline.deepCopy();((ObjectNode)oldDefinition.path("requests").get(0)).set("definition",mapper.valueToTree(new ProcessDefinition(3,old().id(),2,old().name(),old().nodes())));variants.add(oldDefinition);
        var before=backups();
        for(var variant:variants){byte[] bytes=mapper.writeValueAsBytes(variant);Files.write(file(),bytes);assertThrows(IOException.class,this::open);assertArrayEquals(bytes,Files.readAllBytes(file()));equalBackups(before);}
        Files.write(file(),good);try(var service=open()){assertEquals(List.of("base","final"),service.list("101").get(0).routing().stepIds());}
    }
    @Test void routeIsImmutableThroughStoreTransitionEvenWhenNewRouteWouldBeStructurallyValid()throws Exception{
        try(var store=new JsonApprovalStore(mapper,file().toString(),routed());var service=new ApprovalService(store,actors)){
            var created=service.submitDocument("101",PaymentContractDocumentTest.payment(),1,"route");var next=service.decide("202",created.id(),"base","APPROVE","");
            var node=(ObjectNode)mapper.valueToTree(next);((ObjectNode)node.path("routing")).putArray("stepIds").add("base").add("risk").add("final");
            var forged=mapper.treeToValue(node,ApprovalService.Request.class);byte[] before=Files.readAllBytes(file());
            assertThrows(IllegalArgumentException.class,()->ApprovalService.validateTransition(created,forged));assertArrayEquals(before,Files.readAllBytes(file()));
            assertEquals(next,store.request(created.id()));
        }
    }
    @Test void retainedDefinitionsRejectCurrentHistoricalMissingDuplicateAndDowngradedConflicts()throws Exception{
        try(var service=open()){
            service.publishForDocument("1",1,routed(),BusinessDocument.PaymentRequest.class);
            service.submitDocument("101",PaymentContractDocumentTest.payment(),2,"old-route");
            var next=new ProcessDefinition(4,routed().id(),2,"Later rules",routed().nodes());
            service.publishForDocument("1",2,next,BusinessDocument.PaymentRequest.class);
        }
        byte[] good=Files.readAllBytes(file());var baseline=(ObjectNode)mapper.readTree(good);
        assertEquals(2,baseline.path("routingDefinitions").size());var variants=new ArrayList<ObjectNode>();
        var absent=baseline.deepCopy();absent.remove("routingDefinitions");variants.add(absent);
        var empty=baseline.deepCopy();empty.putArray("routingDefinitions");variants.add(empty);
        var duplicate=baseline.deepCopy();((ArrayNode)duplicate.get("routingDefinitions")).add(duplicate.path("routingDefinitions").get(0));variants.add(duplicate);
        var future=baseline.deepCopy();((ObjectNode)future.path("routingDefinitions").get(1)).put("version",4);variants.add(future);
        var different=baseline.deepCopy();((ObjectNode)different.path("routingDefinitions").get(1)).put("id","another-process");variants.add(different);
        var missingOld=baseline.deepCopy();((ArrayNode)missingOld.get("routingDefinitions")).remove(0);variants.add(missingOld);
        var rootDowngrade=baseline.deepCopy();rootDowngrade.set("definition",mapper.valueToTree(new ProcessDefinition(3,old().id(),3,"Downgrade",old().nodes())));variants.add(rootDowngrade);
        var legacyClaim=baseline.deepCopy();var r=(ObjectNode)legacyClaim.path("requests").get(0);r.remove("routing");r.set("definition",mapper.valueToTree(new ProcessDefinition(3,old().id(),2,old().name(),old().nodes())));variants.add(legacyClaim);
        var forged=baseline.deepCopy();var request=(ObjectNode)forged.path("requests").get(0);var definition=(ObjectNode)request.get("definition");
        ((ObjectNode)definition.path("nodes").get(2).path("runIf").path("predicates").get(0)).put("threshold",1);
        request.set("routing",mapper.valueToTree(ConditionalRouting.freeze(mapper.treeToValue(definition,ProcessDefinition.class),mapper.treeToValue(request.get("business"),BusinessDocument.class))));variants.add(forged);
        var before=backups();for(var variant:variants){byte[] bytes=mapper.writeValueAsBytes(variant);Files.write(file(),bytes);assertThrows(IOException.class,this::open);assertArrayEquals(bytes,Files.readAllBytes(file()));equalBackups(before);}
        Files.write(file(),good);try(var service=open()){assertEquals(List.of("base","final"),service.list("101").get(0).routing().stepIds());}
    }
    @Test void frozenEvaluationBooleansCannotBeCoercedFromNumbersOrStrings()throws Exception{
        try(var service=open()){service.publishForDocument("1",1,routed(),BusinessDocument.PaymentRequest.class);service.submitDocument("101",PaymentContractDocumentTest.payment(),2,"bool");}
        var good=(ObjectNode)mapper.readTree(Files.readAllBytes(file()));var before=backups();
        for(JsonNode value:List.of(TextNode.valueOf("false"),IntNode.valueOf(0),DoubleNode.valueOf(0.0),NullNode.instance))for(boolean atom:List.of(false,true)){
            var variant=good.deepCopy();var evaluation=(ObjectNode)variant.path("requests").get(0).path("routing").path("evaluations").get(0);
            if(atom)evaluation=(ObjectNode)evaluation.path("predicates").get(0);evaluation.set("result",value);
            byte[] bytes=mapper.writeValueAsBytes(variant);Files.write(file(),bytes);assertThrows(IOException.class,this::open);assertArrayEquals(bytes,Files.readAllBytes(file()));equalBackups(before);
        }
    }

}
