# Arcflow approval UI prototype

Vue 3 + Vite UI for the companion Spring Boot approval example. This is an original, deliberately narrow demonstration: submit leave → designated reviewer → approve/reject → visible status and activity. The process blueprint is a **fixed, read-only sequential template**, not a general-purpose workflow designer. No DingTalk assets or RuoYi integration are included.

## Run

Requires Node 22.22.2+ (or 24.15+) (Node 22 LTS recommended) and a running approval backend at `http://localhost:8080`.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. The Vite development proxy forwards `/api` to the backend. Configure the backend's permitted UI origin if changing that URL. The backend requires user-provided `APPROVAL_ALICE_PASSWORD`, `APPROVAL_BOB_PASSWORD`, and `APPROVAL_CAROL_PASSWORD`; there are no built-in passwords. Sign in as Alice to submit, sign out, then sign in as Bob or Carol to review a request assigned to them. Refresh to fetch changes from other sessions.

```sh
npm test
npm run build
```

## Contract and boundaries

- GET `/api/me`, `/api/people`, `/api/process`, `/api/requests`
- POST `/api/requests`: `{title, reason, days, approverId}`
- POST `/api/requests/{id}/decisions`: `{decision: "APPROVE" | "REJECT", comment}`
- All requests send an explicit Basic Authorization header and `X-Arcflow-Client: approval-demo`, with `credentials: omit` and `cache: no-store`.
- Credentials are held in a private in-memory API closure. Password input clears after login attempts; logout clears the closure and all request data. There is no browser storage or persistent session. Browsers/password managers may independently offer to remember input; do not save demo passwords on shared machines.
- This demo is localhost-only and intended for synthetic data. Remote deployment requires a separate security review and production authentication/session design.
- The versioned process document separates execution nodes/edges from its sibling `layout` object. The UI visualizes the supported sequence, not arbitrary graphs. The activity view renders the ordered server history (actor, action, comment, and timestamp).
- Repeated clicks while a mutation is in flight are suppressed. No automatic retry occurs after an ambiguous network failure: refresh first to avoid creating duplicate requests. This is not durable server-side idempotency.
- The backend saves a local JSON snapshot across restarts. This is not a production database. No production persistence, distributed concurrency guarantees, workflow migration, arbitrary branching, or RuoYi embedding is claimed.
- The production build is static. The Vite proxy is development-only: production hosting needs a separately configured same-origin `/api` reverse proxy and HTTPS.
