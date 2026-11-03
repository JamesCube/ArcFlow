# 图流程独立参考模型

[English](GRAPH_REFERENCE_MODEL.en.md)

<!-- topic:purpose -->
## 为什么深化验证，而不是扩大功能

基线 `ec6e1b0134185060d35ac3ea6643f6d4ed3320a6` 中，`GraphEngine.validateInstance` 调用生产代码的 `start` 和 `decide` 重建状态。这能验证重放完整性，但创建和重放也可能共享同一个语义错误。现有随机测试同样调用该校验器。本次新增有明确边界的独立语义判定模型，不新增场景、不修改生产行为。

<!-- topic:expert-practice -->
## 专家会主动补上的工作

- 先明确投票门槛、终止取消、汇合释放、唯一激活和原始投票保存等安全性质，再统计测试数量。
- 区分实现内部一致性与独立规格意义上的正确性。
- 穷举有界模型中的每种调度和拒绝路径，而不只随机测试全部同意的路径。
- 故意植入错误语义，证明测试确实能发现声称要发现的问题。
- 报告模型边界和剩余风险。截图、CI 绿灯或测试数量都不是完整生产正确性的证明。

<!-- topic:original-sources -->
## 实际使用的原始素材

本次从固定提交的生产源码和测试入手，而不是功能摘要：

- `examples/approval-domain/src/main/java/com/arcflow/approval/graph/GraphEngine.java`：状态转移与重放逻辑。
- `examples/approval-domain/src/test/java/com/arcflow/approval/graph/GraphEngineTest.java`：已有样例和随机同意顺序测试。
- `examples/approval-jdbc/src/test/java/com/arcflow/approval/jdbc/GraphStoreContract.java`：已有的重启、并发决策、确认丢失及直接 SQL 投影校验。本次不将这些已有能力冒充新增成果。
- `examples/approval-domain/src/main/java/com/arcflow/approval/graph/JsonGraphApprovalStore.java`：原子快照和比较交换边界。

生产验收还需要经授权且最小化的命令/请求轨迹、数据库事务结果、真实审批制度与角色定义、故障日志及原始浏览器/网络证据。本次未取得生产记录、真实用户可用性研究或外部审计。合成用例不能替代这些事实。

<!-- topic:method -->
## 具体方法和工具

`GraphReferenceModelTest` 使用 Java 17、JUnit 5 和深度优先遍历。固定拓扑为分叉、两个投票组、汇合、最后一个审批节点；两个组各有两人，ALL/ANY 组合共四种。独立模型只使用整数投票和门槛：同意数达到门槛即通过；即使剩余人全部同意也达不到门槛即拒绝。期望状态计算不调用 `GraphEngine`、`validateInstance` 或任何生产状态归约器。生产方法仅作为被测对象。

遍历根据参考模型产生下一步动作，而不是根据被测引擎的活动任务列表。每个前缀都校验申请状态、任务存在性及状态、精确投票映射、版本、命令数、分支到达、唯一汇合事件和最终完成事件；还尝试提前激活前及终止后的非法首次投票。

固定模型覆盖 **916 个状态前缀、912 次合法决策、560 条终止路径、1,816 次非法决策**。这些精确数量本身也是断言，避免无意减少遍历覆盖。历史长度有限，重放别名、任意拓扑和无界调度不在此次枚举范围内。

`verify_graph_reference_mutations.py` 在隔离的临时源码副本中运行正确基线和五个错误版本，不修改当前检出目录的生产代码。每次必须恰好执行一个测试、零跳过；正确基线必须成功；错误版本必须恰好产生一个断言失败、零测试错误且退出码非零。缺少报告、编译失败、异常或超时均不算成功检出。

五个定向错误分别是：ALL 过早通过、ANY 过早拒绝、首个分支到达即汇合、重复发出汇合事件、拒绝终止后仍保留活动兄弟任务。这是定向敏感性验证，不是通用变异覆盖率。

<!-- topic:reproduce -->
## 独立复验

在完整仓库检出目录中，使用 JDK 17 和 Maven：

```sh
mvn install
mvn -f examples/approval-domain/pom.xml verify
python3 scripts/verify_graph_reference_mutations.py --maven mvn --output /tmp/graph-reference-mutations.json
```

已备好依赖缓存的离线环境可使用：

```sh
python3 scripts/verify_graph_reference_mutations.py --maven /path/to/mvn -- -o -Dmaven.repo.local=/path/to/cache
```

运行器会重新编译临时模块副本；根目录 core 构件必须先安装到同一 Maven 仓库。超时、缺依赖或编译失败属于阻塞，不是测试成功或变异被检出。

<!-- topic:evidence-and-limits -->
## 什么能佐证结果，以及不能证明什么

- 任何人都能重跑精确源码并检查 Surefire XML，不必相信文字统计。
- 独立数学模型与生产解释器逐状态比较。
- 故意写错的版本必须失败，排除无条件通过的空洞测试。
- Git 源码身份和新增提交将证据绑定到代码。后续远端 CI 应针对精确发布提交，不能引用旧提交的成功记录。
- 独立审阅者可以检查门槛规格是否符合实际业务规则；此处不声称已经完成此类业务规则审计。

边界：仅覆盖一个有界拓扑、两个二人组、最后一个单人审批节点、单进程状态归约器语义和合成付款数据。不证明所有图定义、条件路由、SQL 隔离、权限撤销、前端渲染、崩溃恢复或生产吞吐量。相关现有测试仍然必要。本次模型未发现生产行为错误；已验证的改进是更独立的证据，不是运行时缺陷修复。

<!-- topic:provenance -->
## 本地审计基线与发布边界

最初本地审计使用从上述精确主线提取的 68 个文件，包含根 core 和完整 approval-domain 模块，每个原始文件均比对远端 Git blob 身份。本地抽取基线提交不是远端提交，也不是完整仓库树。不能用抽取历史替换真实仓库历史。

发布变更只应将测试、工具、已登记的双语文档对及文档登记项应用到完整目标基线，并重新运行精确提交的 CI。本地模块验证不替代完整宿主验证或远端 CI。
