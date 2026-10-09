package com.arcflow.approval;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class PaymentContractDocumentTest {
    final ObjectMapper mapper = ApprovalService.strictMapper(new ObjectMapper());
    static BigDecimal money(String value) { return new BigDecimal(value); }
    static BusinessDocument.PaymentRequest payment() { return new BusinessDocument.PaymentRequest(1,"PAY-DEMO-001"," Invoice allocation review "," Synthetic invoice allocation ","SUPPLIER-DEMO-A","CNY","2099-01-15",List.of(
        new BusinessDocument.PaymentLine("line-1","INV-DEMO-01"," Demo components ",money("10000.00"),money("4000.00"),money("4500.00"),money("500.00")," Synthetic quality deduction "),
        new BusinessDocument.PaymentLine("line-2","INV-DEMO-02"," Demo service ",money("4000.00"),money("0"),money("2500.00"),money("0"),""))); }
    static BusinessDocument.ContractApproval contract() { return new BusinessDocument.ContractApproval(1,"CONTRACT-DEMO-001"," Service contract review "," Synthetic internal review ","CUSTOMER-DEMO-A",1,"SERVICE","CNY",money("100000.00"),"2099-01-01","2099-12-31","NONSTANDARD"," Synthetic liability-limit deviation ","DOC-CONTRACT-DEMO-01",List.of(
        new BusinessDocument.ContractMilestone("line-1","M1"," Design phase ","2099-01-15",money("30000.00")," Deliver design and obtain manual acceptance "),
        new BusinessDocument.ContractMilestone("line-2","M2"," Midpoint ","2099-06-30",money("40000.00")," Midpoint acceptance "),
        new BusinessDocument.ContractMilestone("line-3","M3"," Final delivery ","2099-12-15",money("30000.00")," Final delivery acceptance "))); }
    ObjectNode node(BusinessDocument document) { return mapper.valueToTree(document); }
    BusinessDocument decode(ObjectNode node) throws IOException { return mapper.treeToValue(node, BusinessDocument.class); }
    ObjectNode line(ObjectNode node, int index) { return (ObjectNode)node.path("lines").get(index); }
    void invalid(ObjectNode node) throws IOException { var document=decode(node); assertThrows(IllegalArgumentException.class,document::validate,node.toString()); }
    @Test void exactSampleAmountsAndCanonicalizationNeverMutateImmutableRows() {
        var p=payment();p.validate();assertEquals(new BusinessDocument.PaymentSummary("paymentRequest","10000.00","7000.00","500.00","6500.00"),p.paymentSummary());
        var normalized=p.withText("Review","Reason");assertEquals("Demo components",normalized.lines().get(0).description());assertEquals("Synthetic quality deduction",normalized.lines().get(0).deductionReason());
        assertEquals(" Invoice allocation review ",p.title());assertThrows(UnsupportedOperationException.class,()->p.lines().clear());
        var c=contract();c.validate();var canonical=c.withText("Review","Reason");assertEquals("Design phase",canonical.lines().get(0).description());assertEquals("Synthetic liability-limit deviation",canonical.deviationReason());assertThrows(UnsupportedOperationException.class,()->c.lines().clear());
        var rows=new ArrayList<>(p.lines());var copied=new BusinessDocument.PaymentRequest(1,p.businessId(),p.title(),p.reason(),p.supplierRef(),p.currency(),p.requestedPaymentOn(),rows);rows.clear();assertEquals(2,copied.lines().size());
    }
    @Test void paymentBoundsDisallowExcessAllocationDeductionMissingReasonAndZeroNet() throws Exception {
        for(String field:List.of("invoiceAmount","previouslySettledAmount","allocationAmount","deductionAmount")) for(String value:List.of("-0.01","1000000000.01","0.001")) {var n=node(payment());line(n,0).put(field,money(value));invalid(n);}
        var zeroInvoice=node(payment());line(zeroInvoice,0).put("invoiceAmount",0);invalid(zeroInvoice);
        var zeroAllocation=node(payment());line(zeroAllocation,0).put("allocationAmount",0);invalid(zeroAllocation);
        var settled=node(payment());line(settled,0).put("previouslySettledAmount",10001);invalid(settled);
        var excess=node(payment());line(excess,0).put("allocationAmount",6001);invalid(excess);
        var deduction=node(payment());line(deduction,0).put("deductionAmount",4501);invalid(deduction);
        for(String blank:List.of(""," \t ","\u00a0\uFEFF")) {var n=node(payment());line(n,0).put("deductionReason",blank);invalid(n);}
        var zeroNet=node(payment());for(var row:zeroNet.path("lines"))((ObjectNode)row).set("deductionAmount",row.get("allocationAmount"));line(zeroNet,1).put("deductionReason","Demo deduction");invalid(zeroNet);
        var oneZero=node(payment());line(oneZero,0).put("deductionAmount",4500);decode(oneZero).validate();
    }
    @Test void exactDecimalTenthsAndMaximumTotalsAreConservedWithoutBinaryRounding() throws Exception {
        var p=node(payment());line(p,0).put("invoiceAmount",money("0.10")).put("previouslySettledAmount",0).put("allocationAmount",money("0.10")).put("deductionAmount",0);line(p,1).put("invoiceAmount",money("0.20")).put("allocationAmount",money("0.20"));
        var payment=(BusinessDocument.PaymentRequest)decode(p);payment.validate();assertEquals("0.30",payment.paymentSummary().netTotal());
        var max=node(payment());var rows=max.putArray("lines");for(int i=0;i<20;i++){var row=node(payment()).path("lines").get(0).deepCopy();((ObjectNode)row).put("lineId","L"+i).put("invoiceRef","I"+i).put("invoiceAmount",1000000000).put("previouslySettledAmount",0).put("allocationAmount",1000000000).put("deductionAmount",0);rows.add(row);}var maximum=(BusinessDocument.PaymentRequest)decode(max);maximum.validate();assertEquals("20000000000.00",maximum.paymentSummary().netTotal());
        var c=node(contract());c.put("contractAmount",money("0.30"));((ArrayNode)c.path("lines")).remove(2);line(c,0).put("amount",money("0.10"));line(c,1).put("amount",money("0.20"));decode(c).validate();
        c.put("contractAmount",money("0.31"));invalid(c);c.put("contractAmount",money("0.29"));invalid(c);
    }
    @Test void contractAmountsDatesReferencesAndConditionalTermsAreStrict() throws Exception {
        for(String value:List.of("0","-0.01","1000000000.01","100000.001","99999.99","100000.01")){var c=node(contract());c.put("contractAmount",money(value));invalid(c);}
        for(String value:List.of("0","-0.01","0.001","1000000000.01")){var c=node(contract());line(c,0).put("amount",money(value));invalid(c);}
        for(String field:List.of("startOn","endOn"))for(String value:List.of("0000-01-01","2099-02-29","2099-2-01","")){var c=node(contract());c.put(field,value);invalid(c);}
        var reverse=node(contract());reverse.put("startOn","2099-12-31").put("endOn","2099-01-01");invalid(reverse);
        for(String due:List.of("2098-12-31","2100-01-01","2099-02-29")){var c=node(contract());line(c,0).put("dueOn",due);invalid(c);}
        var outOfOrder=node(contract());line(outOfOrder,1).put("dueOn","2099-01-14");invalid(outOfOrder);
        var sameDay=node(contract());line(sameDay,1).put("dueOn","2099-01-15");decode(sameDay).validate();
        for(String blank:List.of(""," ","\u0085\u00a0")){var c=node(contract());c.put("deviationReason",blank);invalid(c);var a=node(contract());line(a,0).put("acceptanceCriteria",blank);invalid(a);}
        var standard=node(contract());standard.put("termsKind","STANDARD");invalid(standard);standard.put("deviationReason","").put("reason","Ordinary contract review notes remain welcome");decode(standard).validate();
        for(int version:List.of(0,-1)){var c=node(contract());c.put("contractRevision",version);invalid(c);}
        var maxRevision=node(contract());maxRevision.put("contractRevision",Integer.MAX_VALUE);decode(maxRevision).validate();
    }
    @Test void supportedCurrenciesAndJPYUseOneCurrencyWithoutConversion() throws Exception {
        for(var document:List.of(payment(),contract()))for(String currency:List.of("CNY","USD","EUR","GBP","JPY")){var n=node(document);n.put("currency",currency);decode(n).validate();}
        for(var document:List.of(payment(),contract())){var n=node(document);n.put("currency","BTC");invalid(n);}
        var p=node(payment());p.put("currency","JPY");line(p,0).put("deductionAmount",money("0.10"));invalid(p);
        var c=node(contract());c.put("currency","JPY");line(c,0).put("amount",money("30000.10"));line(c,2).put("amount",money("29999.90"));invalid(c);
    }
    @Test void lineBoundsUniqueReferencesAndRawTextBoundsAreVersioned() throws Exception {
        for(var d:List.of(payment(),contract())){
            var empty=node(d);empty.putArray("lines");invalid(empty);var many=node(d);var rows=many.putArray("lines");for(int i=0;i<21;i++)rows.add(node(d).path("lines").get(0));invalid(many);
            for(String field:List.of("lineId",d instanceof BusinessDocument.PaymentRequest ? "invoiceRef":"milestoneRef")){var duplicate=node(d);line(duplicate,1).set(field,line(duplicate,0).get(field));invalid(duplicate);}
            for(String field:List.of("businessId","title","reason")){var n=node(d);n.put(field,"\u00a0\uFEFF");invalid(n);}
            for(String field:List.of("title","reason")){var n=node(d);n.put(field,"x".repeat(field.equals("title")?121:2001));invalid(n);}
            var future=node(d);future.put("documentVersion",2);invalid(future);
            var detail=node(d);line(detail,0).put("description","x".repeat(241));invalid(detail);
        }
        var p=node(payment());line(p,0).put("deductionReason","x".repeat(1001));invalid(p);
        var c=node(contract());line(c,0).put("acceptanceCriteria","x".repeat(1001));invalid(c);
        c=node(contract());c.put("deviationReason","x".repeat(2001));invalid(c);
    }
    @Test void strictMapperRejectsMissingUnknownDerivedDuplicateAndCoercedFields() throws Exception {
        for(var d:List.of(payment(),contract())){
            ObjectNode original=node(d);var fields=new ArrayList<String>();original.fieldNames().forEachRemaining(fields::add);
            for(String field:fields){var missing=original.deepCopy();missing.remove(field);assertThrows(IOException.class,()->decode(missing),field);}
            var lineFields=new ArrayList<String>();line(original,0).fieldNames().forEachRemaining(lineFields::add);
            for(String field:lineFields){var missing=original.deepCopy();line(missing,0).remove(field);assertThrows(IOException.class,()->decode(missing),field);}
            for(String field:List.of("total","netTotal","grossAllocation","paymentSummary","signature","bankAccount")){var unknown=original.deepCopy();unknown.put(field,1);assertThrows(IOException.class,()->decode(unknown),field);}
            String raw=mapper.writeValueAsString(d);assertThrows(IOException.class,()->mapper.readValue(raw+" {}",BusinessDocument.class));assertThrows(IOException.class,()->mapper.readValue(raw.replaceFirst("\\{","{\"documentVersion\":1,"),BusinessDocument.class));
            for(String value:List.of("\"1\"","1.0","true","null","2147483648"))assertThrows(IOException.class,()->mapper.readValue(raw.replace("\"documentVersion\":1","\"documentVersion\":"+value),BusinessDocument.class));
            String amountField=d instanceof BusinessDocument.PaymentRequest?"invoiceAmount":"amount";
            for(JsonNode value:List.of(TextNode.valueOf("1.00"),BooleanNode.TRUE,NullNode.instance)){var n=original.deepCopy();line(n,0).set(amountField,value);if(value.isNull()){var decoded=decode(n);assertThrows(IllegalArgumentException.class,decoded::validate);}else assertThrows(IOException.class,()->decode(n));}
        }
    }
}
