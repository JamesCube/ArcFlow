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
    public static Entry receiving(String warehouseId, String qualityId, String procurementId) {
        var template = new Template("erp-receiving", "ERP", "receiving", 1, 1,
            t("收货验收审批", "Goods receipt review"),
            t("手工录入的合成订单与验收记录；不会查询订单余额、入库或付款。", "Manually entered synthetic PO and inspection records; no order-balance lookup, stock posting or payment."),
            List.of(new Section("identity", t("到货信息", "Delivery details"), List.of(
                f("businessId", "text", "验收单号", "Receipt reference", 128), f("title", "text", "验收标题", "Title", 120),
                f("purchaseOrderRef", "text", "合成采购订单引用", "Synthetic purchase order reference", 128),
                f("warehouse", "select", "收货仓库", "Receiving warehouse", 0, o("EAST", "东区演示仓", "East demo warehouse"), o("WEST", "西区演示仓", "West demo warehouse")),
                f("receivedOn", "date", "收货日期", "Delivery date", 10))),
                new Section("reason", t("验收说明", "Inspection context"), List.of(f("reason", "textarea", "验收背景与说明", "Inspection context and notes", 2000)))),
            new LineItems("lines", t("物料与数量核对", "Materials and quantity reconciliation"), 1, 20, List.of(
                f("orderLineRef", "text", "订单行引用", "PO line reference", 128), f("description", "text", "物料说明", "Material description", 240),
                f("unit", "select", "计数单位", "Count unit", 0, o("PCS", "件", "Pieces"), o("BOX", "箱", "Boxes")),
                f("ordered", "quantity", "订单数量", "Ordered", 0), f("received", "quantity", "本次到货", "Received now", 0),
                f("accepted", "quantity", "合格数量", "Accepted", 0), f("rejected", "quantity", "不合格数量", "Rejected", 0),
                new Field("exceptionReason", "textarea", t("异常原因（有不合格数量时必填）", "Exception reason (required for rejected quantity)"), false, 1000, List.of()))));
        var process = new ProcessDefinition(3, "erp-receiving", 1, "收货验收审批 / Goods receipt review", List.of(
            new ProcessDefinition.ProcessNode("start", "start", "提交验收 / Submit receipt", null),
            new ProcessDefinition.ProcessNode("receiving-inspection", "parallelApproval", "仓库与质量会签 / Warehouse and quality", null, List.of(warehouseId, qualityId), "ALL"),
            new ProcessDefinition.ProcessNode("procurement-review", "approval", "采购复核 / Procurement review", procurementId),
            new ProcessDefinition.ProcessNode("end", "end", "验收审批完成 / Review complete", null)));
        return new Entry(template, BusinessDocument.Receiving.class, process, document -> null);
    }

}
