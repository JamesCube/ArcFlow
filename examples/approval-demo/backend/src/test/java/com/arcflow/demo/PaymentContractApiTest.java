package com.arcflow.demo;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Real security/filter/Jackson/controller boundary, with separate JSON scenario stores. */
@SpringBootTest(properties={"APPROVAL_ALICE_PASSWORD=test-alice-password","APPROVAL_BOB_PASSWORD=test-bob-password","APPROVAL_CAROL_PASSWORD=test-carol-password"})
@AutoConfigureMockMvc
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class PaymentContractApiTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    static final String PAYMENT="/api/scenarios/erp-payment", CONTRACT="/api/scenarios/crm-contract";
    static final String PAYMENT_DOCUMENT="""
        {"type":"paymentRequest","documentVersion":1,"businessId":"PAY-DEMO-001","title":"Payment application","reason":"Synthetic snapshots only","supplierRef":"SUPPLIER-DEMO-A","currency":"CNY","requestedPaymentOn":"2099-01-15","lines":[{"lineId":"line-1","invoiceRef":"INV-DEMO-01","description":"Equipment","invoiceAmount":10000.00,"previouslySettledAmount":4000.00,"allocationAmount":4500.00,"deductionAmount":500.00,"deductionReason":"Synthetic quality deduction"},{"lineId":"line-2","invoiceRef":"INV-DEMO-02","description":"Supplies","invoiceAmount":4000.00,"previouslySettledAmount":0,"allocationAmount":2500.00,"deductionAmount":0,"deductionReason":""}]}
        """;
    static final String CONTRACT_DOCUMENT="""
        {"type":"contractApproval","documentVersion":1,"businessId":"CONTRACT-DEMO-001","title":"Internal contract review","reason":"Synthetic draft only","customerRef":"CUSTOMER-DEMO-A","contractRevision":1,"contractCategory":"SERVICE","currency":"CNY","contractAmount":100000.00,"startOn":"2099-01-01","endOn":"2099-12-31","termsKind":"NONSTANDARD","deviationReason":"Synthetic liability limit deviation","documentRef":"DOC-CONTRACT-DEMO-01","lines":[{"lineId":"line-1","milestoneRef":"M1","description":"Proposal","dueOn":"2099-01-15","amount":30000.00,"acceptanceCriteria":"Proposal delivered and confirmed"},{"lineId":"line-2","milestoneRef":"M2","description":"Interim delivery","dueOn":"2099-06-30","amount":40000.00,"acceptanceCriteria":"Interim acceptance"},{"lineId":"line-3","milestoneRef":"M3","description":"Final delivery","dueOn":"2099-12-15","amount":30000.00,"acceptanceCriteria":"Final acceptance"}]}
        """;
    @DynamicPropertySource static void data(DynamicPropertyRegistry registry) throws Exception {
        var file=Files.createTempDirectory("payment-contract-api-").resolve("state.json");registry.add("approval.data-file",file::toString);
    }
    ObjectNode input(boolean payment) throws Exception {return mapper.createObjectNode().put("processVersion",1).set("business",mapper.readTree(payment?PAYMENT_DOCUMENT:CONTRACT_DOCUMENT));}
    ObjectNode business(ObjectNode input){return (ObjectNode)input.get("business");}
    ObjectNode line(ObjectNode input,int index){return (ObjectNode)input.path("business").path("lines").get(index);}
    String base(boolean payment){return payment?PAYMENT:CONTRACT;}
    MockHttpServletRequestBuilder write(String path,String actor){return post(path).with(httpBasic(actor,"test-"+actor+"-password")).header("X-Arcflow-Client","approval-demo").contentType("application/json");}
    JsonNode result(ResultActions action)throws Exception{return mapper.readTree(action.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));}
    ResultActions submit(boolean payment,String body,String key)throws Exception{return mvc.perform(write(base(payment)+"/documents","alice").header("Idempotency-Key",key).content(body));}
    JsonNode create(boolean payment,String key)throws Exception{return result(submit(payment,input(payment).toString(),key).andExpect(status().isCreated()));}
    ResultActions vote(boolean payment,String actor,String id,String step,String decision,String comment)throws Exception {
        var body=mapper.createObjectNode().put("stepId",step).put("decision",decision).put("comment",comment);
        return mvc.perform(write(base(payment)+"/requests/"+id+"/decisions",actor).content(body.toString()));
    }
    JsonNode read(String path,String actor)throws Exception{return result(mvc.perform(get(path).with(httpBasic(actor,"test-"+actor+"-password"))).andExpect(status().isOk()));}
    void invalid(boolean payment,Consumer<ObjectNode> change)throws Exception{var body=input(payment);change.accept(body);submit(payment,body.toString(),"invalid").andExpect(status().isBadRequest());}
    void sameMoney(String expected,JsonNode actual){assertTrue(actual.isTextual());assertEquals(0,new BigDecimal(expected).compareTo(new BigDecimal(actual.asText())));}

    @Test void paymentFourDerivedAmountsAreExactAndNeverAcceptedAsInput() throws Exception {
        var created=create(true,"payment-summary");var fields=new HashSet<String>();created.fieldNames().forEachRemaining(fields::add);
        assertEquals(Set.of("request","total","paymentSummary"),fields);sameMoney("6500",created.get("total"));
        var summary=created.get("paymentSummary");assertEquals("paymentRequest",summary.path("type").asText());
        var summaryFields=new HashSet<String>();summary.fieldNames().forEachRemaining(summaryFields::add);
        assertEquals(Set.of("type","declaredOutstanding","grossAllocation","deductionTotal","netTotal"),summaryFields);
        sameMoney("10000",summary.path("declaredOutstanding"));sameMoney("7000",summary.path("grossAllocation"));sameMoney("500",summary.path("deductionTotal"));sameMoney("6500",summary.path("netTotal"));
        for(String field:List.of("total","paymentSummary","grossAllocation","deductionTotal","netTotal","declaredOutstanding")) {
            invalid(true,b->b.put(field,"999"));invalid(true,b->business(b).put(field,"999"));
        }
        var exact=input(true);for(int i=0;i<2;i++)line(exact,i).put("invoiceAmount",new BigDecimal(i==0?"0.10":"0.20")).put("previouslySettledAmount",0).put("allocationAmount",new BigDecimal(i==0?"0.10":"0.20")).put("deductionAmount",0).put("deductionReason","");
        var sum=result(submit(true,exact.toString(),"decimal-payment").andExpect(status().isCreated()));sameMoney("0.30",sum.path("total"));
        var max=input(true);var lines=mapper.createArrayNode();for(int i=0;i<20;i++)lines.add(line(max,1).deepCopy().put("lineId","line-"+i).put("invoiceRef","INV-"+i).put("invoiceAmount",new BigDecimal("1000000000")).put("allocationAmount",new BigDecimal("1000000000")));business(max).set("lines",lines);
        sameMoney("20000000000",result(submit(true,max.toString(),"max-payment").andExpect(status().isCreated())).path("total"));
    }

    @Test void paymentAmountsDatesCurrenciesAndDeductionsRejectInvalidBoundaries() throws Exception {
        for(String field:List.of("invoiceAmount","previouslySettledAmount","allocationAmount","deductionAmount")) {
            invalid(true,b->line(b,0).put(field,new BigDecimal("-0.01")));
            invalid(true,b->line(b,0).put(field,new BigDecimal("1.001")));
            invalid(true,b->line(b,0).put(field,new BigDecimal("1000000000.01")));
            invalid(true,b->line(b,0).put(field,"100"));invalid(true,b->line(b,0).putNull(field));
        }
        invalid(true,b->line(b,0).put("invoiceAmount",0));invalid(true,b->line(b,0).put("allocationAmount",0));
        invalid(true,b->line(b,0).put("previouslySettledAmount",10001));invalid(true,b->line(b,0).put("allocationAmount",6001));
        invalid(true,b->line(b,0).put("deductionAmount",4501));invalid(true,b->line(b,0).put("deductionReason","\u00a0\u0085\ufeff"));
        invalid(true,b->{line(b,0).put("deductionAmount",4500);line(b,1).put("deductionAmount",2500).put("deductionReason","Full deduction");});
        invalid(true,b->line(b,1).put("invoiceRef","INV-DEMO-01"));invalid(true,b->line(b,1).put("lineId","line-1"));
        invalid(true,b->business(b).put("requestedPaymentOn","2099-02-29"));invalid(true,b->business(b).put("requestedPaymentOn","2099-1-15"));
        invalid(true,b->business(b).put("currency","AUD"));invalid(true,b->{business(b).put("currency","JPY");line(b,0).put("deductionAmount",new BigDecimal("500.01"));});
        assertTrue(read(PAYMENT+"/requests","alice").isEmpty());
        for(String currency:List.of("CNY","USD","EUR","GBP","JPY")){var body=input(true);business(body).put("currency",currency);submit(true,body.toString(),"payment-"+currency).andExpect(status().isCreated());}
    }

    @Test void contractExactMilestonesDatesAndStandardTermsHaveDistinctValidation() throws Exception {
        var created=create(false,"contract-summary");var keys=new HashSet<String>();created.fieldNames().forEachRemaining(keys::add);assertEquals(Set.of("request","total"),keys);sameMoney("100000",created.get("total"));
        invalid(false,b->business(b).put("contractAmount",new BigDecimal("100000.01")));invalid(false,b->business(b).put("contractAmount",new BigDecimal("99999.99")));
        invalid(false,b->line(b,0).put("amount",0));invalid(false,b->line(b,0).put("amount",-1));invalid(false,b->line(b,0).put("amount",new BigDecimal("30000.001")));
        invalid(false,b->business(b).put("contractAmount",new BigDecimal("1000000000.01")));invalid(false,b->business(b).put("contractAmount",0));
        invalid(false,b->business(b).put("contractRevision",0));invalid(false,b->business(b).put("contractRevision",new BigDecimal("1.5")));
        invalid(false,b->business(b).put("contractCategory","OTHER"));invalid(false,b->business(b).put("termsKind","OTHER"));
        invalid(false,b->business(b).put("deviationReason"," "));invalid(false,b->business(b).put("termsKind","STANDARD"));
        invalid(false,b->business(b).put("startOn","2100-01-01"));invalid(false,b->business(b).put("endOn","2099-02-29"));
        invalid(false,b->line(b,0).put("dueOn","2098-12-31"));invalid(false,b->line(b,2).put("dueOn","2100-01-01"));
        invalid(false,b->line(b,1).put("dueOn","2099-01-14"));invalid(false,b->line(b,0).put("dueOn","2099-02-29"));
        invalid(false,b->line(b,0).put("acceptanceCriteria","\u00a0\u0085\ufeff"));invalid(false,b->line(b,1).put("milestoneRef","M1"));invalid(false,b->line(b,1).put("lineId","line-1"));
        invalid(false,b->{business(b).put("currency","JPY");line(b,0).put("amount",new BigDecimal("30000.01"));line(b,1).put("amount",new BigDecimal("39999.99"));});
        var standard=input(false);business(standard).put("termsKind","STANDARD").put("deviationReason","");for(int i=0;i<3;i++)line(standard,i).put("dueOn","2099-06-30");
        submit(false,standard.toString(),"standard-same-date").andExpect(status().isCreated());
        var exact=input(false);business(exact).put("contractAmount",new BigDecimal("0.30"));((ArrayNode)business(exact).get("lines")).remove(2);line(exact,0).put("amount",new BigDecimal("0.10"));line(exact,1).put("amount",new BigDecimal("0.20"));
        sameMoney("0.30",result(submit(false,exact.toString(),"decimal-contract").andExpect(status().isCreated())).path("total"));
        for(String currency:List.of("CNY","USD","EUR","GBP","JPY")){var body=input(false);business(body).put("currency",currency);submit(false,body.toString(),"contract-"+currency).andExpect(status().isCreated());}
    }

    @Test void bothTypesRejectMissingUnknownDuplicateForgedAndLexicallyInvalidInput() throws Exception {
        for(boolean payment:List.of(true,false)) {
            var original=input(payment);var headFields=new ArrayList<String>();business(original).fieldNames().forEachRemaining(headFields::add);
            for(String field:headFields)invalid(payment,b->business(b).remove(field));
            var lineFields=new ArrayList<String>();line(original,0).fieldNames().forEachRemaining(lineFields::add);
            for(String field:lineFields)invalid(payment,b->line(b,0).remove(field));
            for(String field:List.of("applicantId","approverId","status","definition","processId")){invalid(payment,b->b.put(field,"forged"));invalid(payment,b->business(b).put(field,"forged"));invalid(payment,b->line(b,0).put(field,"forged"));}
            for(String field:List.of("title","reason"))invalid(payment,b->business(b).put(field,"x".repeat(2001)));
            invalid(payment,b->business(b).put(payment?"supplierRef":"customerRef","x".repeat(129)));
            invalid(payment,b->business(b).put("documentVersion",2));invalid(payment,b->business(b).put("documentVersion",0));invalid(payment,b->business(b).put("documentVersion","1"));
            invalid(payment,b->business(b).put("type","unknown"));invalid(payment,b->business(b).set("lines",mapper.createArrayNode()));
            invalid(payment,b->{var rows=(ArrayNode)business(b).get("lines");while(rows.size()<21)rows.add(rows.get(0).deepCopy());});
            invalid(payment,b->((ArrayNode)business(b).get("lines")).addNull());
            String raw=original.toString();submit(payment,raw.replace("\"documentVersion\":1","\"documentVersion\":1,\"documentVersion\":1"),"duplicate").andExpect(status().isBadRequest());
            submit(payment,raw.replace("\"lineId\":\"line-1\"","\"lineId\":\"line-1\",\"lineId\":\"line-1\""),"duplicate").andExpect(status().isBadRequest());
            for(String value:List.of("1.0","1e0","-0","true","null","2147483648"))submit(payment,raw.replace("\"documentVersion\":1","\"documentVersion\":"+value),"lexical").andExpect(status().isBadRequest());
            String amount=payment?"invoiceAmount":"contractAmount";for(String value:List.of("\"100\"","null","true","NaN","Infinity","1e999999"))submit(payment,raw.replaceFirst("\\\""+amount+"\\\":[0-9.]+","\""+amount+"\":"+value),"amount-lexical").andExpect(status().isBadRequest());
            mvc.perform(write(base(payment)+"/documents","alice").content(raw)).andExpect(status().isBadRequest());
            mvc.perform(write(base(payment)+"/documents","alice").header("Idempotency-Key","x","y").content(raw)).andExpect(status().isBadRequest());
            mvc.perform(write(base(payment)+"/documents","alice").header("Idempotency-Key","").content(raw)).andExpect(status().isBadRequest());
            assertTrue(read(base(payment)+"/requests","alice").isEmpty());
            submit(payment,raw,"invalid").andExpect(status().isCreated()); // Validation never reserved this key.
        }
    }

    @Test void paymentAllAnyRetryAndAllRejectUseRealIndependentActors() throws Exception {
        var saved=create(true,"payment-flow");String id=saved.path("request").path("id").asText();
        vote(true,"alice",id,"payment-check","APPROVE","").andExpect(status().isForbidden());
        vote(true,"bob",id,"payment-final","APPROVE","").andExpect(status().isConflict());
        var first=result(vote(true,"bob",id,"payment-check","APPROVE","Original opinion").andExpect(status().isOk()));
        assertEquals("payment-check",first.path("request").path("currentStepId").asText());assertEquals(2,first.path("request").path("history").size());
        assertEquals(first,result(vote(true,"bob",id,"payment-check","APPROVE","Must not replace").andExpect(status().isOk())));
        assertEquals(first,result(submit(true,input(true).toString(),"payment-flow").andExpect(status().isCreated())));
        vote(true,"bob",id,"payment-check","REJECT","").andExpect(status().isConflict());
        assertEquals("payment-final",result(vote(true,"carol",id,"payment-check","APPROVE","").andExpect(status().isOk())).path("request").path("currentStepId").asText());
        assertEquals("PENDING",result(vote(true,"bob",id,"payment-final","REJECT","ANY dissent").andExpect(status().isOk())).path("request").path("status").asText());
        var done=result(vote(true,"carol",id,"payment-final","APPROVE","").andExpect(status().isOk()));assertEquals("APPROVED",done.path("request").path("status").asText());assertEquals(5,done.path("request").path("history").size());
        assertEquals(saved.path("request").path("business"),done.path("request").path("business"));assertEquals(saved.path("paymentSummary"),done.path("paymentSummary"));
        assertEquals(done,result(submit(true,input(true).toString(),"payment-flow").andExpect(status().isCreated())));
        var rejected=create(true,"payment-reject");String rejectId=rejected.path("request").path("id").asText();
        var finalReject=result(vote(true,"bob",rejectId,"payment-check","REJECT","ALL veto").andExpect(status().isOk()));assertEquals("REJECTED",finalReject.path("request").path("status").asText());assertEquals(2,finalReject.path("request").path("history").size());
        vote(true,"carol",rejectId,"payment-check","APPROVE","").andExpect(status().isConflict());
    }

    @Test void contractSnapshotPublicationUsesNewAnyOnlyForNewRequests() throws Exception {
        var old=create(false,"contract-v1");String id=old.path("request").path("id").asText();
        var definition=(ObjectNode)old.path("request").path("definition").deepCopy();var nodes=(ArrayNode)definition.get("nodes");var end=nodes.remove(nodes.size()-1);
        nodes.add(mapper.createObjectNode().put("id","contract-final").put("type","parallelApproval").put("name","Final review").putNull("assigneeId").set("assigneeIds",mapper.createArrayNode().add("bob").add("carol")));
        ((ObjectNode)nodes.get(nodes.size()-1)).put("completionMode","ANY");nodes.add(end);definition.put("name","Contract policy v2");
        var publication=mapper.createObjectNode().put("expectedVersion",1).set("definition",definition);
        mvc.perform(write(CONTRACT+"/process","bob").content(publication.toString())).andExpect(status().isForbidden());
        mvc.perform(write(CONTRACT+"/process","alice").content(publication.toString())).andExpect(status().isOk());
        submit(false,input(false).toString(),"contract-stale").andExpect(status().isConflict());
        vote(false,"bob",id,"contract-review","APPROVE","").andExpect(status().isConflict());
        assertEquals("contract-review",result(vote(false,"bob",id,"commercial-review","APPROVE","Original commercial opinion").andExpect(status().isOk())).path("request").path("currentStepId").asText());
        assertEquals("PENDING",result(vote(false,"bob",id,"contract-review","APPROVE","Independent second vote").andExpect(status().isOk())).path("request").path("status").asText());
        var rejected=result(vote(false,"carol",id,"contract-review","REJECT","Terms rejected").andExpect(status().isOk()));assertEquals("REJECTED",rejected.path("request").path("status").asText());assertEquals(old.path("request").path("definition"),rejected.path("request").path("definition"));assertEquals(4,rejected.path("request").path("history").size());
        assertEquals(rejected,result(submit(false,input(false).toString(),"contract-v1").andExpect(status().isCreated())));
        var newer=input(false);newer.put("processVersion",2);String newId=result(submit(false,newer.toString(),"contract-v2").andExpect(status().isCreated())).path("request").path("id").asText();
        vote(false,"bob",newId,"commercial-review","APPROVE","").andExpect(status().isOk());vote(false,"bob",newId,"contract-review","APPROVE","").andExpect(status().isOk());
        assertEquals("contract-final",result(vote(false,"carol",newId,"contract-review","APPROVE","").andExpect(status().isOk())).path("request").path("currentStepId").asText());
        assertEquals("PENDING",result(vote(false,"bob",newId,"contract-final","REJECT","").andExpect(status().isOk())).path("request").path("status").asText());
        assertEquals("APPROVED",result(vote(false,"carol",newId,"contract-final","APPROVE","").andExpect(status().isOk())).path("request").path("status").asText());
    }

    @Test void authenticationCrossTypeAndWrongProcessDoNotLeakOrMutateRequests() throws Exception {
        for(boolean payment:List.of(true,false)) {
            mvc.perform(get(base(payment)+"/requests")).andExpect(status().isUnauthorized());mvc.perform(get(base(payment)+"/requests").with(user("mallory"))).andExpect(status().isForbidden());
            var body=input(payment);mvc.perform(post(base(payment)+"/documents").with(httpBasic("alice","test-alice-password")).header("Idempotency-Key","no-client").contentType("application/json").content(body.toString())).andExpect(status().isForbidden());
            var saved=create(payment,"separate-files");String id=saved.path("request").path("id").asText();
            mvc.perform(write("/api/documents","alice").header("Idempotency-Key","generic-rejected").content(body.toString())).andExpect(status().isBadRequest());
            for(String other:List.of(PAYMENT,CONTRACT,"/api/scenarios/oa-expense","/api/scenarios/oa-travel","/api/scenarios/oa-seal-use","/api/scenarios/erp-receiving"))if(!other.equals(base(payment))) {
                mvc.perform(write(other+"/documents","alice").header("Idempotency-Key","wrong-host").content(body.toString())).andExpect(status().isBadRequest());
                mvc.perform(write(other+"/requests/"+id+"/decisions","bob").content("{\"stepId\":\""+(payment?"payment-check":"commercial-review")+"\",\"decision\":\"APPROVE\",\"comment\":\"\"}")).andExpect(status().isNotFound());
            }
            assertEquals(mapper.createArrayNode().add(saved),read(base(payment)+"/requests","alice"));
        }
        assertTrue(read("/api/requests","alice").isEmpty());
    }
}
