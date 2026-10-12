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
    public static Node approval(String id,String name,String actor) { return new Node(id,"approval",name,List.of(actor),"ALL",null); }
    public static Node structural(String id,String type,String name,String pair) { return new Node(id,type,name,List.of(),null,pair); }
    public static Edge edge(String id,String source,String target,String label) { return new Edge(id,source,target,label,null,false); }
}
