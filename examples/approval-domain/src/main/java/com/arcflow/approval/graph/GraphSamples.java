package com.arcflow.approval.graph;

import com.arcflow.approval.ConditionalRouting;
import java.math.BigDecimal;
import java.util.List;
import static com.arcflow.approval.graph.GraphDefinition.*;

/** Editable demonstration, using real payment facts and explicit demo user IDs, not role resolution. */
public final class GraphSamples {
    private GraphSamples() {}
    public static GraphDefinition payment() {
        return new GraphDefinition(5,"payment-graph",1,"付款分支与并行审批 / Payment graph",List.of(
            structural("start","start","提交付款 / Submit payment",null),
            structural("amount","exclusiveGateway","按净额选择 / Route by net amount","amountMerge"),
            structural("reviewFork","parallelFork","独立复核 / Independent reviews","reviewJoin"),
            approval("finance","财务复核 / Finance review","bob"),
            approval("financeFinal","财务确认 / Finance confirmation","bob"),
            approval("businessReview","业务复核 / Business review","carol"),
            structural("reviewJoin","parallelJoin","等待全部复核 / Wait for all reviews","reviewFork"),
            approval("standard","普通付款审核 / Standard payment review","bob"),
            structural("amountMerge","exclusiveMerge","所选路径汇合 / Selected path merge","amount"),
            approval("final","最终确认 / Final confirmation","carol"),
            structural("end","end","审批完成 / Completed",null)),List.of(
            edge("toAmount","start","amount","继续 / Continue"),
            new Edge("highValue","amount","reviewFork","净额 ≥ 10,000 CNY / Net ≥ 10,000 CNY",new ConditionalRouting.Rule("ALL",List.of(ConditionalRouting.Predicate.money("GTE","CNY",new BigDecimal("10000")))),false),
            new Edge("otherwise","amount","standard","默认 / Default",null,true),
            edge("financeBranch","reviewFork","finance","财务 / Finance"),edge("businessBranch","reviewFork","businessReview","业务 / Business"),
            edge("financeNext","finance","financeFinal","继续 / Continue"),edge("financeArrive","financeFinal","reviewJoin","财务完成 / Finance done"),
            edge("businessArrive","businessReview","reviewJoin","业务完成 / Business done"),edge("reviewMerged","reviewJoin","amountMerge","合流 / Merge"),
            edge("standardMerged","standard","amountMerge","合流 / Merge"),edge("toFinal","amountMerge","final","最终确认 / Final review"),edge("toEnd","final","end","完成 / Complete")));
    }
    public static GraphDefinition travel() {
        return new GraphDefinition(6,"travel-graph",1,"出差分支与并行审批 / Travel graph",List.of(
            structural("start","start","提交出差 / Submit travel",null), approval("manager","经理审批 / Manager review","bob"),
            structural("cost","exclusiveGateway","费用分支 / Estimated cost","costMerge"),
            structural("travelFork","parallelFork","独立出差复核 / Independent travel reviews","travelJoin"),
            approval("operations","运营复核 / Operations review","bob"), approval("finance","财务复核 / Finance review","carol"),
            structural("travelJoin","parallelJoin","等待全部复核 / Wait for all reviews","travelFork"),
            structural("costMerge","exclusiveMerge","所选路径汇合 / Selected path merge","cost"),
            structural("end","end","审批完成 / Completed",null)),List.of(
            edge("toManager","start","manager","经理审核 / Manager"), edge("toCost","manager","cost","费用评估 / Cost"),
            condition("highCost","cost","travelFork","预计费用 ≥ 10,000 CNY / Cost ≥ 10,000 CNY",new ConditionalRouting.Predicate("travel.estimatedCost","GTE","CNY",new BigDecimal("10000"),null,null)),
            new Edge("otherwise","cost","costMerge","默认 / Default",null,true),
            edge("operationsBranch","travelFork","operations","运营 / Operations"), edge("financeBranch","travelFork","finance","财务 / Finance"),
            edge("operationsArrive","operations","travelJoin","运营完成 / Operations done"), edge("financeArrive","finance","travelJoin","财务完成 / Finance done"),
            edge("travelMerged","travelJoin","costMerge","合流 / Merge"), edge("toEnd","costMerge","end","完成 / Complete")));
    }
    public static GraphDefinition receiving() {
        return new GraphDefinition(6,"receiving-graph",1,"收货质量分支与并行审批 / Receiving graph",List.of(
            structural("start","start","提交收货 / Submit receiving",null),
            structural("quality","exclusiveGateway","质量异常分支 / Quality exception","qualityMerge"),
            structural("receivingFork","parallelFork","独立异常复核 / Independent exception reviews","receivingJoin"),
            approval("qualityReview","质量复核 / Quality review","bob"), approval("purchasingReview","采购复核 / Purchasing review","carol"),
            structural("receivingJoin","parallelJoin","等待全部复核 / Wait for all reviews","receivingFork"),
            approval("standard","常规收货审核 / Standard receiving review","bob"),
            structural("qualityMerge","exclusiveMerge","所选路径汇合 / Selected path merge","quality"),
            structural("end","end","审批完成 / Completed",null)),List.of(
            edge("toQuality","start","quality","检查质量 / Check quality"),
            condition("hasExceptions","quality","receivingFork","存在拒收行 / Rejected lines",ConditionalRouting.Predicate.flag(true)),
            new Edge("otherwise","quality","standard","默认 / Default",null,true),
            edge("qualityBranch","receivingFork","qualityReview","质量 / Quality"), edge("purchasingBranch","receivingFork","purchasingReview","采购 / Purchasing"),
            edge("qualityArrive","qualityReview","receivingJoin","质量完成 / Quality done"), edge("purchasingArrive","purchasingReview","receivingJoin","采购完成 / Purchasing done"),
            edge("receivingMerged","receivingJoin","qualityMerge","合流 / Merge"), edge("standardMerged","standard","qualityMerge","合流 / Merge"),
            edge("toEnd","qualityMerge","end","完成 / Complete")));
    }
    public static GraphDefinition quote() {
        return new GraphDefinition(6,"quote-graph",1,"报价折扣分支与并行审批 / Quote discount graph",List.of(
            structural("start","start","提交折扣 / Submit discount",null),
            structural("discount","exclusiveGateway","折扣比例分支 / Exact discount","discountMerge"),
            structural("quoteFork","parallelFork","独立商业与财务复核 / Independent reviews","quoteJoin"),
            approval("commercial","商业复核 / Commercial review","bob"), approval("finance","财务复核 / Finance review","carol"),
            structural("quoteJoin","parallelJoin","等待全部复核 / Wait for all reviews","quoteFork"),
            approval("standard","常规折扣审核 / Standard discount review","bob"),
            structural("discountMerge","exclusiveMerge","所选路径汇合 / Selected path merge","discount"),
            approval("final","最终确认 / Final confirmation","carol"), structural("end","end","审批完成 / Completed",null)),List.of(
            edge("toDiscount","start","discount","折扣评估 / Evaluate discount"),
            condition("discounted","discount","quoteFork","折扣 ≥ 20% / Discount ≥ 20%",new ConditionalRouting.Predicate("quote.discountPercent","GTE",null,new BigDecimal("20"),null,null)),
            new Edge("otherwise","discount","standard","默认 / Default",null,true),
            edge("commercialBranch","quoteFork","commercial","商业 / Commercial"), edge("financeBranch","quoteFork","finance","财务 / Finance"),
            edge("commercialArrive","commercial","quoteJoin","商业完成 / Commercial done"), edge("financeArrive","finance","quoteJoin","财务完成 / Finance done"),
            edge("quoteMerged","quoteJoin","discountMerge","合流 / Merge"), edge("standardMerged","standard","discountMerge","合流 / Merge"),
            edge("toFinal","discountMerge","final","最终确认 / Final review"), edge("toEnd","final","end","完成 / Complete")));
    }
    private static Edge condition(String id,String source,String target,String label,ConditionalRouting.Predicate predicate) {
        return new Edge(id,source,target,label,new ConditionalRouting.Rule("ALL",List.of(predicate)),false);
    }
    public static Node approval(String id,String name,String actor) { return new Node(id,"approval",name,List.of(actor),"ALL",null); }
    public static Node structural(String id,String type,String name,String pair) { return new Node(id,type,name,List.of(),null,pair); }
    public static Edge edge(String id,String source,String target,String label) { return new Edge(id,source,target,label,null,false); }
}
