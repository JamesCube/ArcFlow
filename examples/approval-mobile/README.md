# ArcFlow mobile approval client / 移动审批

A **uni-app Vue 3, H5-first** client for reviewing approvals on the standalone
Spring backend. Use the desktop UI to create requests and edit processes, then
use this client to review them. The initial implementation was based on
**549e8da**; its verification records keep that baseline.

这个移动端示例连接实际后端，可以查看待办和详情、填写审批意见、同意或驳回申请，
再查看不可改写的历史记录和自己已处理的事项。界面支持中英文切换；流程名、申请内容和人名
保留原文。列表和处理结果都来自服务端，没有预置业务数据或模拟成功状态。

## Scope / 边界

- Uses `/api/me`, `/api/people`, `/api/requests/inbox`, the compatible `/api/requests` list and decision endpoints; Basic
  credentials remain in page memory only. Reload requires sign-in again and
  preserves an opaque `?task=<id>` deep link. No default password.
- Alice, Bob and Carol are labelled **demo identities**. The server checks who
  is signed in, which requests they can see and which steps they can decide. It
  records the votes and history. UI hints do not grant permissions, and this
  client does not provide SSO.
- Server definition snapshots drive read-only sequential/ALL/ANY summaries.
  My decisions includes a participant's completed vote even while the overall
  request remains pending. A decision note is part of the vote, **not** a chat or
  standalone comment endpoint.
- Mobile authoring and submission are not supported. Create synthetic leave or
  procurement requests and publish processes in the desktop UI. Pending and
  handled pages come from the server-side member inbox, with independent
  cursors and retry state. Detail refresh uses the compatible visible-request
  list; an actor switch, sign-out or newer refresh invalidates stale responses.
- Typed procurement details show the immutable item, quantity, exact unit
  price, total and currency. There are no attachment, due-date or tenant fields.
- The platform interfaces include browser, Feishu, WeCom and DingTalk adapters.
  Enterprise identity and notifications remain unconfigured and reject use.
  `?host=feishu-web`,
  `?host=wecom-web`, `?host=dingtalk-web` and unknown host values show an
  unconfigured page, **never** a fallback demo identity. No OAuth exchange,
  provider SDK, app, account, callback endpoint, actual notification or platform
  integration has been created. Identity keys keep provider, tenant, application
  and subject scopes separate; they have not been connected to or verified by
  a platform.
- H5-native accessible button/input/textarea/label adapters live under
  `src/platform/h5-components.ts`. They intentionally avoid uni-H5's non-native
  keyboard/button and field-label behavior. App and mini-program controls,
  transport/navigation adapters and builds still need to be implemented and
  tested. **No Android/iOS/mini-program build or device testing is claimed.**

## Run locally / 本地运行

Requirements: Java 17+, Maven, Node 22.22.2+ or 24.15.0+ (see engines), npm.
Use only synthetic data. The existing Boot 3 demo and this mobile client are not
production deployments; see the backend's security/persistence limits.

From the repository root, build the backend dependencies:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
```

Set your own three passwords (at least 12 characters each) in your local shell,
without committing them. In the backend terminal:

```sh
export APPROVAL_ALICE_PASSWORD='your-unique-local-alice-password'
export APPROVAL_BOB_PASSWORD='your-unique-local-bob-password'
export APPROVAL_CAROL_PASSWORD='your-unique-local-carol-password'
export APPROVAL_UI_ORIGIN='http://127.0.0.1:5174'
# Optional: an absolute APPROVAL_DATA_FILE path for an isolated synthetic store.
mvn -f examples/approval-demo/backend/pom.xml spring-boot:run
```

In another terminal:

```sh
cd examples/approval-mobile
npm ci
npm run dev:h5
```

Open **http://127.0.0.1:5174** in an ordinary browser and sign in using the
matching local demo password. The Vite proxy forwards `/api` to loopback port
8080 (`ARCFLOW_BACKEND_PORT` overrides it). Use the exact origin above: localhost
and 127.0.0.1 are different origins. The backend intentionally rejects foreign
Origin values. Its mandatory write header remains `X-Arcflow-Client: approval-demo`.

For initial request creation via the existing desktop UI, run that UI on port
5174 instead of this mobile server so its origin is the same, create synthetic
requests as Alice, stop it, then start the mobile client. In the desktop UI,
`npm run dev -- --port 5174` selects that port. Never run two frontends on the same
port simultaneously. Supporting several frontend origins in production would
require a separate backend policy.

The compiler launcher uses upstream's CI mode to skip optional update/usage
reporting and machine-identifier collection; app statistics are disabled.

## Verification / 验证

```sh
npm run typecheck
npm test
npm run build:h5
# From repository root after packaging the backend:
python3 examples/approval-mobile/scripts/verify-http.py
```

See [HTTP_VERIFICATION.md](HTTP_VERIFICATION.md) for the backend test results,
[REVIEW.md](REVIEW.md) for the independent review, and
[ACCEPTANCE.md](ACCEPTANCE.md) for what passed, what is still untested and the
remaining dependency risks.
The HTTP harness creates its own isolated store and ephemeral test credentials;
never point tests at personnel data. No credentials or data store are bundled.

## Architecture / 结构

- `src/domain/api.ts`: same-origin, allowlisted endpoint transport; sanitized
  error codes and explicit in-memory authorization.
- `src/domain/model.ts`: converts server data into display state. Exhaustive
  reference tests cover 2,304 reachable mixed three-stage states.
- `src/domain/workspace.ts`: tracks refresh and sign-in generations, waits for
  server-confirmed success, blocks duplicate clicks, locks confirmation to its
  original request/step/decision and checks the saved state after uncertain
  writes. Old responses cannot restore a signed-out identity; an old note
  cannot be applied to a later step.
- `src/platform/*`: H5 adapters and unconfigured enterprise adapters. The host
  query parameter selects a UI experience; it does not establish an identity.
- `src/components/Workspace.vue`: single-column task screen with a
  read-only process path, immutable history, safe-area dock, keyboard-native
  controls and decision-sheet focus handling.

这个示例不支持多租户。无权访问时返回 404 的测试，只覆盖当前单租户示例，
不能说明不同租户之间已经隔离。生产身份认证、租户权限、组合版本的浏览器和真机测试，
以及各平台接入，都还需要单独完成。

## Dependency note / 依赖说明

The lockfile includes tested security overrides for the upstream uni compiler
(Vite 6.4.3, Vitest 4.1.11 and selected transitive patches). The audit recorded in
ACCEPTANCE.md found 8 high, 4 moderate and 12 low affected package entries, with no critical entry. Read that record before running the
toolchain, and check the current dependencies again before any deployment. Keep
this demo local; it has not been verified for production use.

## Current local integration / 当前本地组合

The procurement review model and member paging are combined in this source.
See [the procurement scope](../../docs/PROCUREMENT_UI.md),
[member inbox adoption](MEMBER_INBOX_ADOPTION.md) and
[the combined verification report](../../docs/LOCAL_INTEGRATION.md).
This does not turn earlier screenshots or browser results into evidence for
this combined version. After packaging the backend, also run:

```sh
python3 examples/approval-mobile/scripts/verify-documents-http.py
```
