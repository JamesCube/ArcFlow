# ArcFlow mobile approval client / 移动审批

A bounded **uni-app Vue 3, H5-first** local demonstration on the existing
standalone Spring approval backend. It is separate from the desktop authoring
UI and from the unmerged visual redesign. Base: **549e8da**.

本片交付真实后端驱动的移动审批工作台：待办 → 详情 → 同意/驳回及审批意见 →
不可改写的历史记录 → 我已处理。页面文案支持中文、英文；服务端保存的流程名、
申请内容和人名保持原文。没有伪造的业务 KPI、预置业务数据或假成功状态。

## Scope / 边界

- Real `/api/me`, `/api/people`, `/api/requests` and decision endpoints; Basic
  credentials remain in page memory only. Reload requires sign-in again and
  preserves an opaque `?task=<id>` deep link. No default password.
- Alice, Bob and Carol are explicitly labelled **demo identities**, not SSO.
  Every actor, visibility check, step authorization, vote and audit event remains
  authoritative on the server. UI action hints never grant permissions.
- Server definition snapshots drive read-only sequential/ALL/ANY summaries.
  My decisions includes a participant's completed vote even while the overall
  request remains pending. A decision note is part of the vote, **not** a chat or
  standalone comment endpoint.
- No mobile authoring or submission in this first slice. Create synthetic leave
  requests and publish processes in the existing desktop UI before reviewing
  them here. There are no attachment, pagination, due-date or tenant fields in
  the existing API; none are fabricated. This demo's API returns the full visible
  list; production pagination remains a backend project.
- Browser, Feishu, WeCom and DingTalk adapter boundaries are present. All enterprise
  identity and notification capabilities fail closed. `?host=feishu-web`,
  `?host=wecom-web`, `?host=dingtalk-web` and unknown host values show an
  unconfigured page, **never** a fallback demo identity. No OAuth exchange,
  provider SDK, app, account, callback endpoint, actual notification or platform
  integration has been created. Identity key design preserves provider/tenant/
  application/subject scope; it does not prove a platform identity.
- H5-native accessible button/input/textarea/label adapters live under
  `src/platform/h5-components.ts`. They intentionally avoid uni-H5's non-native
  keyboard/button and field-label behavior. App and mini-program controls,
  transport/navigation adapters and builds require separate implementation and
  acceptance. **No Android/iOS/mini-program build or device testing is claimed.**

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
requests as Alice, stop it, then start the mobile client (`npm run dev -- --port 5174` in the desktop UI selects that port). Never run two frontends
on the same port simultaneously. A production multi-client origin policy is not
introduced by this slice.

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

See [HTTP_VERIFICATION.md](HTTP_VERIFICATION.md) for the executed real backend
checks, [REVIEW.md](REVIEW.md) for independent review, and
[ACCEPTANCE.md](ACCEPTANCE.md) for exact passed/unrun stages and dependency risk.
The HTTP harness creates its own isolated store and ephemeral test credentials;
never point tests at personnel data. No credentials or data store are bundled.

## Architecture / 结构

- `src/domain/api.ts`: same-origin, allowlisted endpoint transport; sanitized
  error codes and explicit in-memory authorization.
- `src/domain/model.ts`: pure display projection. Exhaustive reference tests
  cover 2,304 reachable mixed three-stage states.
- `src/domain/workspace.ts`: refresh generations, auth epochs, no optimistic
  success, duplicate-click lock, frozen request/step/decision confirmation and
  reconciliation after uncertain writes. Old responses cannot restore a signed
  out identity; an old note cannot be applied to a later step.
- `src/platform/*`: explicit H5 runtime boundaries and fail-closed enterprise
  capability declarations. The query selector is an experience hint only.
- `src/components/Workspace.vue`: task-focused, single-column mobile experience;
  read-only process path, immutable history, safe-area dock, keyboard-native
  controls and decision-sheet focus handling.

本片没有多租户能力，不会将单租户演示的 404 掩蔽测试写成跨租户隔离验收。
后续生产身份、租户权限、分页、浏览器/真机视觉验收和各平台联调须分别完成。

## Dependency note / 依赖说明

The lockfile includes tested security overrides for the upstream uni compiler
(Vite 6.4.3, Vitest 4.1.11 and selected transitive patches). The final audit still
has 8 high, 4 moderate and 12 low affected package entries, no critical entry.
See ACCEPTANCE.md before running or exposing any toolchain. This is a local
verification slice; production readiness has not been established.
