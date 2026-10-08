# 截图复现 / Reproduce the gallery

[流程设计器](DESIGNER_GALLERY.md) · [业务全流程](CASE_GALLERY.md) · [逐图来源](images/gallery/provenance.json)

## Capture contract / 采集约束

- Real Spring Boot backend, real Vue/CRM UI, authenticated Chromium sessions and synthetic data. No mocked success responses, rewritten DOM, generated UI or screenshot retouching.
- The gallery fixture is opt-in (`ARCFLOW_GALLERY=1`). Every invocation starts a fresh disposable data store through the existing Playwright config. The CRM rejection path runs in another invocation so it never overwrites an approved quotation.
- The test exercises UI insertion, order, undo, ALL/ANY selection, validation and publication. It submits and decides requests through UI controls, checks real HTTP results and asserts state transitions. The saved-version example publishes a newer definition and compares the existing request’s definition with its original snapshot.
- CRM result cards do not show review comments or a full activity timeline. The capture fixture checks those saved events through the real API; captions do not present them as visible card content.
- PNGs are captured after authentication, with fonts ready and reduced motion. Capture checks reject horizontal overflow or visible password inputs. There are no auth traces, videos, HAR files or saved login state.
- Existing ALL/ANY, native RuoYi and H5 images are taken from successful browser acceptance at the per-image commit in the manifest. H5 screenshots are 390px browser viewports, not physical-phone or native-app certification.

全部截图使用隔离演示账号与合成数据。页面按钮、服务端结果、状态推进及版本不变性均有断言；截图本身不能证明 JDBC、幂等、权限隔离或生产就绪。报价页的完整审批历史仍以接口记录为准，不能把截图卡片当成完整审计界面。

## Run / 运行

First follow the [standalone backend](../examples/approval-demo/backend/README.md) and [UI](../examples/approval-ui/README.md) prerequisites. Build the real backend JAR and install the UI’s locked dependencies. Playwright’s config supplies disposable passwords, owns the backend and Vite servers, and uses a new temporary store; do not point it at real data or an already-running shared service.

```bash
mvn --batch-mode --no-transfer-progress install
mvn --batch-mode --no-transfer-progress -f examples/approval-domain/pom.xml install
mvn --batch-mode --no-transfer-progress -f examples/approval-demo/backend/pom.xml package
cd examples/approval-ui
npm ci
npx playwright install --with-deps chromium
# Install Noto CJK fonts through your OS for readable Chinese captures.
ARCFLOW_GALLERY=1 npm run test:e2e -- e2e/gallery.spec.mjs --output=gallery-results
ARCFLOW_GALLERY=1 GALLERY_CRM_REJECT=1 npm run test:e2e -- e2e/gallery.spec.mjs --grep "isolated CRM" --output=gallery-rejection-results
```

Run these two invocations serially. The first produces eight designer states and the OA/ERP/CRM journeys; the second produces the alternate CRM rejection. Both Chinese and English variants use the same saved business state. Standard functional runs skip this opt-in fixture; [Approval demo CI](../.github/workflows/approval-demo.yml) explicitly runs it on fresh backends after the normal functional suites and retains PNGs for seven days.

每轮单独启动后端，不与其他测试共享存储。中文和英文是同一状态的界面语言变体，不计为两个不同业务场景；每种业务的第六张驳回截图是另一条分支。

## Accepted capture runs / 已通过的采集来源

| Capture | Exact commit | Passing run | Used here |
| --- | --- | --- | --- |
| Designer + OA/ERP/CRM | `21429cd1b0adcec6ffba3f5a473b1e06f4a35aa2` | [Approval demo CI](https://github.com/JamesCube/ArcFlow/actions/runs/37775938307) | 26 states, 52 Chinese/English PNGs |
| ALL/ANY behavior | `c4b3135a049654e9d6f87c042b1ba334ad6e4870` | [Main standalone](https://github.com/JamesCube/ArcFlow/actions/runs/37774389459) | 2 states, 4 Chinese/English PNGs |
| Native RuoYi | `c4b3135a049654e9d6f87c042b1ba334ad6e4870` | [Main RuoYi](https://github.com/JamesCube/ArcFlow/actions/runs/37774389578) | 2 Chinese PNGs |
| H5 | `c4b3135a049654e9d6f87c042b1ba334ad6e4870` | [Main H5](https://github.com/JamesCube/ArcFlow/actions/runs/37774389564) | 3 Chinese PNGs |

共 33 个不同场景、61 张原始截图；中英文变体不重复计数为业务场景。原图共 11,315,297 bytes。截图提交比最终文档提交早；后续文档修改不会改写图片来源。

33 distinct scenes and 61 original PNGs, with language variants counted once as scenes. Captured images total 11,315,297 bytes. Image provenance is independent of the final documentation commit.

## Evidence and limits / 验证与限制

The gallery manifest gives the exact capture commit, passing workflow and immutable PNG checksum for every file. New capture fixtures and workflow wiring change no application behavior relative to main `c4b3135a049654e9d6f87c042b1ba334ad6e4870`. Further documentation commits do not recapture the UI or turn historical test results into evidence for a new commit.

The local cloud execution environment could build and discover the Playwright tests but its Chromium process failed while creating an IPC socket (`Operation not permitted`). An escalation attempt was accepted by the command tool and reached the same runtime limitation; no local browser pass is claimed. The repository’s existing GitHub Actions Chromium runner performed the captures. Early capture-fixture failures were corrected against the existing API/UI contracts; only images from a fully passing capture run are included.

本地浏览器未运行成功，不能宣称本地像素验收通过。实际图片由既有 GitHub Actions 环境采集，再下载原始 PNG 做独立像素审阅。图片来源与最后文档提交是两回事，请检查所用提交对应的 CI。
