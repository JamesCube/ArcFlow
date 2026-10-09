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
    public static Entry paymentRequest(String firstReviewer, String secondReviewer) {
        var template = new Template("erp-payment", "ERP", "paymentRequest", 1, 1, t("付款申请审批", "Payment request review"),
            t("合成发票分配与扣减，人工核对后仅完成申请审批；不付款、不锁定余额，也不跨申请占用发票。", "Synthetic invoice allocations and deductions for internal review only. No payment, balance lock or cross-request invoice reservation."),
            List.of(new Section("identity", t("付款申请", "Payment request"), List.of(
                f("businessId", "text", "付款申请编号", "Payment request reference", 128), f("title", "text", "申请标题", "Title", 120),
                f("supplierRef", "text", "合成供应商引用", "Synthetic supplier reference", 128),
                f("currency", "select", "币种", "Currency", 0, currencies()), f("requestedPaymentOn", "date", "期望付款日期", "Requested payment date", 10))),
                new Section("reason", t("付款用途", "Business purpose"), List.of(f("reason", "textarea", "用途与核对说明", "Purpose and review notes", 2000)))),
            new LineItems("lines", t("发票分配与扣减", "Invoice allocation and deductions"), 1, 20, List.of(
                f("invoiceRef", "text", "合成发票引用", "Synthetic invoice reference", 128), f("description", "text", "款项说明", "Description", 240),
                f("invoiceAmount", "money", "声明发票金额", "Declared invoice amount", 0), f("previouslySettledAmount", "money", "声明已结金额", "Declared settled amount", 0),
                f("allocationAmount", "money", "本次冲销额", "Allocation this request", 0), f("deductionAmount", "money", "本次扣减额", "Deduction this request", 0),
                new Field("deductionReason", "textarea", t("扣减原因（扣减时必填）", "Deduction explanation (required when positive)"), false, 1000, List.of()))));
        var process = new ProcessDefinition(3, "erp-payment", 1, "付款申请审批 / Payment request review", List.of(
            new ProcessDefinition.ProcessNode("start", "start", "提交付款申请 / Submit payment request", null),
            new ProcessDefinition.ProcessNode("payment-check", "parallelApproval", "金额与用途联合核对 / Amount and purpose review", null, List.of(firstReviewer, secondReviewer), "ALL"),
            new ProcessDefinition.ProcessNode("payment-final", "parallelApproval", "最终复核 / Final review", null, List.of(firstReviewer, secondReviewer), "ANY"),
            new ProcessDefinition.ProcessNode("end", "end", "付款申请审批完成 / Payment request review complete", null)));
        return new Entry(template, BusinessDocument.PaymentRequest.class, process, document -> {
            var payment = (BusinessDocument.PaymentRequest) document;
            return BusinessDocument.displayMoney(payment.netTotal(), payment.currency());
        });
    }
    public static Entry contractApproval(String commercialReviewer, String jointReviewer) {
        var template = new Template("crm-contract", "CRM", "contractApproval", 1, 1, t("合同审批", "Contract approval"),
            t("合成合同草案、条款与付款里程碑的内部审批；不会签署、发送客户、建立应收或修改CRM。", "Internal review of synthetic contract drafts, terms and payment milestones. No signing, customer delivery, receivables or CRM changes."),
            List.of(new Section("identity", t("合同草案", "Contract draft"), List.of(
                f("businessId", "text", "合同申请编号", "Contract request reference", 128), f("title", "text", "合同标题", "Title", 120),
                f("customerRef", "text", "合成客户引用", "Synthetic customer reference", 128), f("contractRevision", "integer", "声明合同修订号", "Declared contract revision", 16),
                f("contractCategory", "select", "合同类别", "Contract category", 0, o("PRODUCT", "产品", "Product"), o("SERVICE", "服务", "Service")),
                f("documentRef", "text", "合成文档引用", "Synthetic document reference", 128))),
                new Section("term", t("金额与期限", "Amount and term"), List.of(
                    f("currency", "select", "币种", "Currency", 0, currencies()), f("contractAmount", "money", "合同总额", "Contract amount", 0),
                    f("startOn", "date", "合同开始日期", "Contract start date", 10), f("endOn", "date", "合同结束日期", "Contract end date", 10))),
                new Section("terms", t("条款复核", "Terms review"), List.of(
                    f("termsKind", "select", "条款类型", "Terms kind", 0, o("STANDARD", "标准条款", "Standard"), o("NONSTANDARD", "非标准条款", "Nonstandard")),
                    new Field("deviationReason", "textarea", t("非标差异说明（非标时必填）", "Nonstandard deviation explanation (required for nonstandard terms)"), false, 2000, List.of()))),
                new Section("reason", t("申请说明", "Review context"), List.of(f("reason", "textarea", "申请理由与普通备注", "Review purpose and general notes", 2000)))),
            new LineItems("lines", t("付款里程碑与交付条件", "Payment milestones and acceptance criteria"), 1, 20, List.of(
                f("milestoneRef", "text", "里程碑引用", "Milestone reference", 128), f("description", "text", "里程碑说明", "Milestone description", 240),
                f("dueOn", "date", "计划日期", "Due date", 10), f("amount", "money", "里程碑金额", "Milestone amount", 0),
                f("acceptanceCriteria", "textarea", "交付与验收条件", "Delivery and acceptance criteria", 1000))));
        var process = new ProcessDefinition(3, "crm-contract", 1, "合同审批 / Contract approval", List.of(
            new ProcessDefinition.ProcessNode("start", "start", "提交合同草案 / Submit contract draft", null),
            new ProcessDefinition.ProcessNode("commercial-review", "approval", "商务核对 / Commercial review", commercialReviewer),
            new ProcessDefinition.ProcessNode("contract-review", "parallelApproval", "合同联合复核 / Joint contract review", null, List.of(commercialReviewer, jointReviewer), "ALL"),
            new ProcessDefinition.ProcessNode("end", "end", "合同内部审批完成 / Internal contract review complete", null)));
        return new Entry(template, BusinessDocument.ContractApproval.class, process, document -> {
            var contract = (BusinessDocument.ContractApproval) document;
            return BusinessDocument.displayMoney(contract.contractAmount(), contract.currency());
        });
    }
    private static Option[] currencies() { return new Option[]{o("CNY", "人民币 CNY", "CNY"), o("USD", "美元 USD", "USD"), o("EUR", "欧元 EUR", "EUR"), o("GBP", "英镑 GBP", "GBP"), o("JPY", "日元 JPY", "JPY")}; }

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
    }    public static Entry sealUse(String managerId, String financeId) {
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
