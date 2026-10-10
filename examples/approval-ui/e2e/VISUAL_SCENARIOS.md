# 真实后端视觉场景

<!-- Legacy fragments remain entry points after the language split. -->
<a id="captures-and-evidence"></a>
<a id="honest-comparison-and-scope"></a>
<a id="real-backend-visual-scenarios"></a>

[English](VISUAL_SCENARIOS.en.md)


<!-- topic:scope -->
`visual-scenarios.spec.mjs` 以一次有顺序的 Chromium 流程验证 Spring Boot API 与 Vue 工作台，标题以 `visual showcase:` 开头，方便独立运行图集：

```sh
npm run test:e2e -- --grep-invert 'visual showcase:'
npm run test:e2e -- --grep 'visual showcase:' --output=visual-results
```

先按[UI 指南](../README.md#验证界面与真实-http)构建后端并安装 Playwright。每次拒绝复用服务器，创建临时密码与单写者存储；保持单 worker，不能并发向同后端发布。测试读取当前版本再发布，不重写已有快照/版本。运行结束关闭临时服务，临时目录可能保留到 runner 清理；失败后不额外发布“清理数据”，避免掩盖原错误。功能套件和图集分别运行，数据互不干扰。

<!-- topic:captures -->
## 截图与证据

桌面视口 1440×1000、全页；手机 390×844、当前可见视口，流程、检查器、决策、快照和历史分别截图。

| PNG 前缀 | 内容 | 语言 |
| --- | --- | --- |
| `01-same-scene-three-step-any` | 原工作台三步，选中首个未发布 ANY | 中文 |
| `02-sequential-leave-designer` | Bob 经理复核、Carol HR 复核 | 中英文 |
| `02-tablet-sequential-designer-en-1024` | 1024px 中间宽度 | 英文 |
| `03-applicant-new-leave-form` | Alice 未提交三天请假 | 中英文 |
| `04-applicant-submitted-leave` | 实际提交与保存定义 | 中英文 |
| `05-all-group-designer` | 可编辑 ALL 与完成规则 | 中英文 |
| `06-mobile-all-workspace` | 手机工作区顶端 | 中英文 |
| `06-mobile-all-designer-flow` | 紧凑手机流程 | 中英文 |
| `07-mobile-all-designer-inspector` | 名称、模式、参与人与规则 | 中英文 |
| `08-mobile-bob-review-controls` | Bob 当前意见与操作 | 中英文 |
| `09-bob-partial-all-awaiting-carol` | Bob 已同意且不可再投，等待 Carol | 中英文 |
| `10-any-group-designer` | 可编辑 ANY 与规则 | 中英文 |
| `11-any-approved-readonly-snapshot-activity` | Bob ANY 同意、Carol 该组无需处理、另一步最终同意及历史 | 中英文 |
| `12-mobile-any-saved-snapshot` | 同一保存 ANY 手机快照 | 中英文 |
| `13-mobile-any-completed-activity` | 实际完成历史 | 中英文 |

共 28 张，全部为真实已认证界面。初始化与两次顺序决策调用真实版本检查 API，ALL/ANY 编辑、发布、提交与分组票通过浏览器。ANY 完成后再次发布，再核对旧 ALL/ANY 定义不变且部分 ALL 仍待审批。ID、版本和时间由后端产生，可随运行变化，因此这不是逐像素 golden image 对比。

每图检查 document/body 横向溢出。手机检查器高度至少 44px、字号 16px，决策按钮高度 44px、字号 15px，插入/新增/步骤控件触控目标 44px。检查本地化标签、参与人状态及页面异常，不代表完整无障碍、真机或 200% 缩放验收。

<!-- topic:scope-limits -->
## 比较方式与范围

首场景复现 `Parallel synthetic review`、`跨团队协同审批`（ANY，Bob+Carol）、`Team group`（ANY，Bob+Carol）、`Final review`（Carol）。首组未发布且被选中；先取消 Carol 再撤销恢复，与历史 `02-workbench-any-inspector.png` 操作一致。新的语言选择覆盖整个工作区。新存储的版本号可能不同，应比较结构、名称、成员、选择与草稿状态；原图保持不变并标拍摄提交。

所有姓名、申请、原因、意见均为合成数据。中英流程名称是保存的数据，语言切换只译界面。“Manager review”“HR review”只是步骤名，实际固定 bob/carol，不解析主管或组织目录。此图集不验证若依或生产环境。

不生成密码页、trace、HAR、视频或认证状态，日志不含凭据。传输/密码输入错误必须简短脱敏，不能追加可能包含 header/填充值的原始 error/cause。CI 只上传 PNG 目录；验收需检查对应提交完成的 CI 和真实图片，静态语法不能替代。
