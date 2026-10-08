package com.arcflow.approval;

import java.util.List;
import java.util.Objects;
import java.util.function.Function;

/** Compiled, versioned form metadata. This is not an arbitrary JSON-schema or script executor. */
public final class ScenarioCatalog {
    private ScenarioCatalog() {}
    public record Text(String zh, String en) {}
    public record Option(String value, Text label) {}
    public record Field(String path, String kind, Text label, boolean required, int maxLength, List<Option> options) {
        public Field { options = List.copyOf(options); }
    }
    public record Section(String id, Text title, List<Field> fields) {
        public Section { fields = List.copyOf(fields); }
    }
    public record LineItems(String path, Text label, int minItems, int maxItems, List<Field> fields) {
        public LineItems { fields = List.copyOf(fields); }
    }
    public record Template(String id, String domain, String documentType, int documentVersion, int formVersion,
                           Text title, Text description, List<Section> sections, LineItems lineItems) {
        public Template { sections = List.copyOf(sections); }
    }
    /** Typed registration separates form presentation, domain data and the reusable approval lifecycle. */
    public record Entry(Template template, Class<? extends BusinessDocument> documentClass,
                        ProcessDefinition initialProcess, Function<BusinessDocument,String> displayTotal) {
        public Entry {
            Objects.requireNonNull(template); Objects.requireNonNull(documentClass);
            Objects.requireNonNull(initialProcess); Objects.requireNonNull(displayTotal);
            ProcessDefinition.validate(initialProcess);
            if (!template.id().equals(initialProcess.id())) throw new IllegalArgumentException("Scenario and process identities must match");
        }
    }
    private static Text t(String zh,String en) { return new Text(zh,en); }
    private static Field f(String path,String kind,String zh,String en,int length,Option... options) {
        return new Field(path,kind,t(zh,en),true,length,List.of(options));
    }
    private static Option o(String value,String zh,String en) { return new Option(value,t(zh,en)); }
    public static Entry expense(String managerId,String financeId) {
        var template = new Template("oa-expense","OA","expense",1,1,t("费用报销审批","Expense reimbursement review"),
            t("合成费用明细与票据引用，审批通过不会打款。","Synthetic expense lines and receipt references. Approval does not issue a payment."),
            List.of(new Section("identity",t("申请信息","Request details"),List.of(
                f("businessId","text","报销单号","Expense reference",128),f("title","text","申请标题","Title",120),
                f("costCenter","select","成本中心","Cost center",0,o("ENGINEERING","研发","Engineering"),o("SALES","销售","Sales"),o("OPERATIONS","运营","Operations")),
                f("currency","select","币种","Currency",0,o("CNY","人民币 CNY","CNY"),o("USD","美元 USD","USD"),o("EUR","欧元 EUR","EUR"),o("GBP","英镑 GBP","GBP"),o("JPY","日元 JPY","JPY")))),
                new Section("reason",t("用途说明","Purpose"),List.of(f("reason","textarea","费用用途与说明","Business purpose",2000)))),
            new LineItems("lines",t("费用明细","Expense lines"),1,20,List.of(
                f("spentOn","date","发生日期","Expense date",10),
                f("category","select","费用类别","Category",0,o("TRAVEL","交通差旅","Travel"),o("MEALS","餐饮","Meals"),o("OFFICE","办公用品","Office"),o("OTHER","其他","Other")),
                f("description","text","费用说明","Description",240),f("amount","money","金额","Amount",0),
                f("receiptRef","text","合成票据引用","Synthetic receipt reference",128))));
        var process = new ProcessDefinition(2,"oa-expense",1,"费用报销审批 / Expense reimbursement review",List.of(
            new ProcessDefinition.ProcessNode("start","start","提交报销 / Submit expense",null),
            new ProcessDefinition.ProcessNode("manager","approval","费用审核 / Expense review",managerId),
            new ProcessDefinition.ProcessNode("finance","approval","财务复核 / Finance review",financeId),
            new ProcessDefinition.ProcessNode("end","end","审批完成 / Review complete",null)));
        return new Entry(template,BusinessDocument.Expense.class,process,document -> {
            var expense=(BusinessDocument.Expense)document;
            return expense.total().setScale("JPY".equals(expense.currency()) ? 0 : 2).toPlainString();
        });
    }
    public static Entry travel(String managerId,String financeId) {
        var template = new Template("oa-travel","OA","travel",1,1,t("出差申请审批","Business travel review"),
            t("合成行程与预算，审批通过不会预订、报销或付款。","Synthetic itinerary and budget. Approval does not book travel, reimburse expenses or issue a payment."),
            List.of(new Section("identity",t("申请信息","Request details"),List.of(
                f("businessId","text","出差单号","Travel reference",128),f("title","text","申请标题","Title",120),
                f("costCenter","select","成本中心","Cost center",0,o("ENGINEERING","研发","Engineering"),o("SALES","销售","Sales"),o("OPERATIONS","运营","Operations")),
                f("currency","select","币种","Currency",0,o("CNY","人民币 CNY","CNY"),o("USD","美元 USD","USD"),o("EUR","欧元 EUR","EUR"),o("GBP","英镑 GBP","GBP"),o("JPY","日元 JPY","JPY")))),
                new Section("itinerary",t("行程与预算","Itinerary and budget"),List.of(
                    f("destination","text","目的地","Destination",160),f("startDate","date","开始日期","Start date",10),
                    f("endDate","date","结束日期","End date",10),
                    f("purpose","select","出差用途","Travel purpose",0,o("CUSTOMER_VISIT","客户拜访","Customer visit"),o("PROJECT_DELIVERY","项目交付","Project delivery"),
                        o("TRAINING","培训","Training"),o("CONFERENCE","会议","Conference"),o("OTHER","其他","Other")),
                    f("estimatedCost","money","预计费用","Estimated cost",0))),
                new Section("reason",t("出差说明","Business justification"),List.of(f("reason","textarea","出差事由与说明","Business justification",2000)))),null);
        var process = new ProcessDefinition(2,"oa-travel",1,"出差申请审批 / Business travel review",List.of(
            new ProcessDefinition.ProcessNode("start","start","提交出差申请 / Submit travel",null),
            new ProcessDefinition.ProcessNode("tripReview","approval","行程审核 / Trip review",managerId),
            new ProcessDefinition.ProcessNode("budget","approval","预算复核 / Budget review",financeId),
            new ProcessDefinition.ProcessNode("end","end","审批完成 / Review complete",null)));
        return new Entry(template,BusinessDocument.Travel.class,process,document -> {
            var travel=(BusinessDocument.Travel)document;
            return travel.estimatedCost().setScale("JPY".equals(travel.currency()) ? 0 : 2).toPlainString();
        });
    }
}
