# 成员收件箱前端接入 / Member inbox frontend adoption

This is a historical local checkpoint for its stated input tree. For the later combined source, see [LOCAL_INTEGRATION](LOCAL_INTEGRATION.md) and the exact commit’s CI results.

本地补丁以 `cac609569807ae65d488a9e79c8cf463aebad961` 为基础，接入该版本的全成员收件箱 API。仅修改三个前端及其测试、说明；不改领域、存储或后端接口，不包含采购界面；另已在本地接入 PR #18 的前端文案，未合并该 PR。

This local-only change is based on backend commit `cac609569807ae65d488a9e79c8cf463aebad961`, tree `a1dc75ae7e14f822a2b581d27238a8aadd1b52dc`. It does not publish a branch, PR, deployment or upstream change.

## 使用方式 / Behavior

- 独立桌面：打开“待我审批”或“我已审批”，分别筛选申请当前状态、保存的流程版本；点击“加载更多”。申请列表仍保留申请人和参与人的历史可见范围。
- 若依：待办、已办分别分页与筛选；“我的申请”和参与历史仍使用兼容列表。沿用原生登录与读取权限，查询参数不能指定另一个人。
- H5：待办、已办分别保存游标。两列表共用状态、流程版本筛选，界面明确说明作用范围；搜索仅检索已加载结果。打开详情、返回及切换列表保留分页进度；“我参与的”及直接打开历史详情按需加载兼容列表。
- 已办只包含本人实际作出的审批决定。全员同意中的部分投票仍可显示“审批中”；同一个人进入后续节点时可同时出现在待办和已办。
- 显示的数量是已加载行数，不是服务端总数。分页是实时列表；“更新数据”从第一页重新查询，才能发现较新的申请或成员变化。
- 退出、身份变化、筛选变化会取消旧请求并使旧响应失效。记录缓存按只追加的审批历史保留较新的快照，避免慢响应覆盖已保存的决定。
- 不确定的审批结果不会自动重试。独立桌面尝试读取历史以恢复状态，恢复失败时锁定该申请的审批操作；若依要求先刷新；H5 使用详情新鲜度和确认上下文保护。

English: all three consumers use bounded, independent PENDING/HANDLED cursors. Standalone and native filters are per box; mobile filters are explicitly shared and reset both cursors. Legacy applicant/history visibility remains intact. Actor/session epochs, AbortSignals and per-read generations reject late success and error responses. Cross-list caches cannot replace a longer saved decision history with an older snapshot. Loaded counts do not imply a total or frozen multi-page snapshot.

## 本地验证 / Local validation

- Standalone: 271 unit/component/DOM tests; Vite production build.
- Native RuoYi overlay: 44 pure Node tests and 11 mounted DOM tests. The standalone suite includes 10 pre-existing native submission compatibility cases.
- Mobile/H5: 71 unit/DOM tests, Vue TypeScript checking and H5 production build.
- Real client/HTTP: 22 assertions against a fresh Java 17 backend, using the actual standalone API transport and pagination controller. Creates 27 synthetic requests and verifies two pages, actor membership, partial ALL votes, subsequent-stage pending/handled overlap, filter reset and logout cleanup.
- Independent source review covered session isolation, stale replies, cache consistency, partial votes and page preservation. Findings in native legacy reconciliation, mobile route paging and standalone uncertain-decision recovery were fixed and regression-tested.

All final JavaScript checks used already-installed binaries. No dependencies were installed or downloaded; unit/DOM/build checks used a fail-closed preload blocking network I/O. The HTTP check used only its own disposable loopback backend. A prior npm route was stopped after a registry-network restriction; it is not used as final verification evidence.

## 尚未验证 / Remaining gates

没有运行本补丁的 Chromium 或其他浏览器，也没有截图、远端 CI 或完整若依宿主构建结果。移动端仍是 H5；App、小程序、真机、无障碍及跨浏览器行为需单独验收。历史截图或旧提交的通过记录不能代表本补丁。

The complete pinned RuoYi frontend/server environment was not present, so its full production build and native login/permission/browser integration remain unrun. Vite/SFC builds, mounted DOM tests and local HTTP checks are not visual or production acceptance. The backend producer's database matrix is separate evidence; this frontend patch does not extend those claims.

## PR #18 文案整合 / Local copy integration

已按 PR #18 的准确提交 `188924015b991848923aa477f9b169de0a28b17e`，在本地整合 12 个前端及测试选择器文件。流程、分页、取消与会话隔离实现保持不变；新增 DOM 用例检查切换语言、第二页加载、退出以及旧身份响应隔离。PR #18 仍未合并，后端基础仍为上方的 `cac6095`。启动脚本和根包描述两个非前端文件未纳入。详情见 [文案整合记录](MEMBER_INBOX_COPY_INTEGRATION.md)。
