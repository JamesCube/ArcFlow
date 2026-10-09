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
    /** Compiled non-monetary form. References and seal categories are synthetic, inert values. */
    public static Entry sealUse(String managerId, String financeId) {
        var template = new Template("oa-seal-use", "OA", "sealUse", 1, 1,
            t("用印申请审批", "Seal-use request review"),
            t("合成文件引用与印章类别；审批通过不代表已盖章或签署。", "Synthetic document references and seal categories. Approval does not apply a seal or sign a document."),
            List.of(new Section("identity", t("申请信息", "Request details"), List.of(
                f("businessId", "text", "用印申请编号", "Seal-use reference", 128),
                f("title", "text", "申请标题", "Title", 120))),
                new Section("document", t("文件与用印", "Document and seal use"), List.of(
                    f("documentName", "text", "文件名称", "Document name", 160),
                    f("documentRef", "text", "合成文件引用", "Synthetic document reference", 128),
                    f("sealType", "select", "合成印章类别", "Synthetic seal category", 0,
                        o("OFFICIAL", "公章（合成）", "Official (synthetic)"),
                        o("CONTRACT", "合同章（合成）", "Contract (synthetic)"),
                        o("FINANCE", "财务章（合成）", "Finance (synthetic)")),
                    f("copyCount", "integer", "用印份数", "Copies", 16))),
                new Section("reason", t("用途说明", "Business purpose"), List.of(
                    f("reason", "textarea", "用途说明", "Business purpose", 2000)))), null);
        var process = new ProcessDefinition(2, "oa-seal-use", 1, "用印申请审批 / Seal-use request review", List.of(
            new ProcessDefinition.ProcessNode("start", "start", "提交申请 / Submit request", null),
            new ProcessDefinition.ProcessNode("documentReview", "approval", "文件审核 / Document review", managerId),
            new ProcessDefinition.ProcessNode("sealReview", "approval", "用印复核 / Seal-use review", financeId),
            new ProcessDefinition.ProcessNode("end", "end", "审批完成 / Review complete", null)));
        return new Entry(template, BusinessDocument.SealUse.class, process, document -> null);
    }

}
