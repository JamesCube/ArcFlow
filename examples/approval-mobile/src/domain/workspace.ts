import { computed, reactive } from "vue";
import { ApiError, inboxPath } from "./api";
import { InvalidPayloadError } from "./business";
import { canDecide, hasDecided, filterRequests } from "./model";
import type { Api, Person, Request, Decision, Tab, InboxBox, InboxFilters, InboxPage, Status, AuditEvent } from "./types";
export type ErrorCode =
  | ""
  | "credentials"
  | "expired"
  | "forbidden"
  | "missing"
  | "conflict"
  | "unavailable"
  | "network"
  | "commentLong"
  | "invalidData" | "filters" | "cursor" | "refresh";
// These checks establish that a 2xx reply is evidence for the exact reviewed
// instance. A structurally valid response alone is not a confirmed decision.
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a).sort(), right = Object.keys(b).sort();
  return left.length === right.length && left.every((key, index) =>
    key === right[index] && sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
function assertSnapshot(before: Request, after: Request) {
  if (!after || !Array.isArray(after.history)) throw new InvalidPayloadError();
  const immutable = ["id", "title", "reason", "days", "applicantId", "createdAt", "processId", "processVersion", "definition", "business"] as const;
  if (immutable.some((key) => !sameValue(before[key], after[key])) ||
      after.history.length < before.history.length ||
      before.history.some((event, index) => !sameValue(event, after.history[index])))
    throw new InvalidPayloadError();
}
function assertDecision(before: Request, after: Request, actor: string, stepId: string, decision: Decision) {
  assertSnapshot(before, after);
  const votes = after.history.filter((event) => event.actorId === actor && event.stepId === stepId);
  // Same-decision replays may contain the original note rather than a new note.
  // The durable actor/step/decision event, never HTTP status, proves the outcome.
  if (votes.length !== 1 || votes[0].action !== decision) throw new InvalidPayloadError();
}

const boxes: InboxBox[] = ["PENDING", "HANDLED"];
const emptyInbox = () => ({
  items: [] as Request[], nextCursor: null as string | null,
  loading: false, fresh: false, error: "" as ErrorCode,
});
export function createWorkspace(api: Api) {
  let epoch = 0, readVersion = 0;
  const cache = new Map<string, Request>();
  let readController: AbortController | undefined;
  let legacyController: AbortController | undefined, legacyVersion = 0;
  const pageControllers: Partial<Record<InboxBox, AbortController>> = {};
  const pageVersions: Record<InboxBox, number> = { PENDING: 0, HANDLED: 0 };
  let context: { requestId: string; stepId: string; decision: Decision } | null = null;
  const state = reactive({
    me: null as Person | null, people: [] as Person[],
    // The compatible broader list is fetched only for Related to me / detail reads.
    requests: [] as Request[], legacyFresh: false, legacyLoading: false,
    detail: null as Request | null, detailFresh: false,
    inboxes: { PENDING: emptyInbox(), HANDLED: emptyInbox() },
    filters: {} as InboxFilters,
    busy: false, loading: false, fresh: false, error: "" as ErrorCode,
    notice: false, selectedId: "", tab: "todo" as Tab, query: "",
    composer: null as Decision | null, comment: "",
  });
  const activeBox = computed<InboxBox | null>(() =>
    state.tab === "all" ? null : state.tab === "todo" ? "PENDING" : "HANDLED",
  );
  const activeInbox = computed(() => activeBox.value ? state.inboxes[activeBox.value] : null);
  const selected = computed(() => state.detail?.id === state.selectedId ? state.detail : undefined);
  const visible = computed(() => {
    if (!activeInbox.value)
      return filterRequests(state.requests, state.me?.id || "", "all", state.query);
    const needle = state.query.trim().toLocaleLowerCase();
    // Membership and creation ordering come from the server, never approverId or updatedAt.
    return activeInbox.value.items.filter((item) =>
      `${item.title} ${item.reason} ${item.applicantId} ${item.business?.businessId || ""} ${item.business?.type === "procurement" ? item.business.item : ""}`.toLocaleLowerCase().includes(needle),
    );
  });
  const listFresh = computed(() => activeInbox.value?.fresh ?? state.legacyFresh);
  const listLoading = computed(() => activeInbox.value?.loading ?? state.legacyLoading);
  const listError = computed(() => activeInbox.value?.error || "");
  const actionable = computed(() =>
    !!selected.value && !!state.me && state.detailFresh && !state.loading && !state.legacyLoading &&
    !state.busy && canDecide(selected.value, state.me.id),
  );
  function matches(box: InboxBox, item: Request) {
    return !!state.me && (box === "PENDING" ? canDecide(item, state.me.id) : hasDecided(item, state.me.id)) &&
      (!state.filters.status || item.status === state.filters.status) &&
      (!state.filters.processVersion || item.processVersion === state.filters.processVersion);
  }
  function checkSnapshot(item: Request) {
    const existing = cache.get(item.id);
    if (existing) {
      if (existing.history.length <= item.history.length) assertSnapshot(existing, item);
      else assertSnapshot(item, existing);
    }
  }
  function remember(item: Request): Request {
    checkSnapshot(item);
    const existing = cache.get(item.id);
    // Every saved decision appends history. Independent live snapshots must not
    // replace a newer vote with an older box or legacy response.
    const latest = existing && existing.history.length >= item.history.length ? existing : item;
    cache.set(item.id, latest);
    if (state.detail?.id === item.id) state.detail = latest;
    state.requests = state.requests.map((row) => row.id === item.id ? latest : row);
    for (const box of boxes)
      state.inboxes[box].items = state.inboxes[box].items
        .map((row) => row.id === item.id ? latest : row)
        .filter((row) => matches(box, row));
    return latest;
  }
  function invalidateReads() {
    readVersion++;
    readController?.abort();
    legacyController?.abort();
    legacyVersion++;
    state.legacyLoading = false;
    for (const box of boxes) {
      pageVersions[box]++;
      pageControllers[box]?.abort();
      state.inboxes[box].loading = false;
    }
  }
  function logout(error: ErrorCode = "") {
    context = null;
    epoch++;
    invalidateReads();
    api.logout();
    cache.clear();
    state.me = null;
    state.requests = [];
    state.people = [];
    state.detail = null;
    state.detailFresh = state.legacyFresh = false;
    state.inboxes.PENDING = emptyInbox();
    state.inboxes.HANDLED = emptyInbox();
    state.filters = {};
    state.tab = "todo";
    state.query = "";
    state.composer = null;
    state.comment = "";
    state.busy = state.loading = state.fresh = false;
    state.error = error;
    state.notice = false;
  }
  function failure(error: unknown): ErrorCode {
    if (error instanceof InvalidPayloadError) {
      // Never retain an apparently actionable or partially parsed document list.
      invalidateReads();
      state.loading = false;
      state.error = "invalidData";
      // Keep the last verified snapshots for future reconciliation, but hide
      // every visible row and decision until a fresh validated read succeeds.
      state.requests = [];
      state.detail = null;
      state.detailFresh = state.legacyFresh = false;
      for (const box of boxes) {
        state.inboxes[box].items = [];
        state.inboxes[box].nextCursor = null;
        state.inboxes[box].fresh = false;
      }
      state.composer = null;
      state.comment = "";
      state.fresh = false;
      state.notice = false;
      context = null;
      return "invalidData";
    }
    if (error instanceof ApiError)
      return ({ 401: "expired", 403: "forbidden", 404: "missing", 409: "conflict", 503: "unavailable" } as Record<number, ErrorCode>)[error.status] || "unavailable";
    return "network";
  }
  async function readInbox(box: InboxBox, append = false) {
    if (!state.me) return;
    const bucket = state.inboxes[box];
    const cursor = append ? bucket.nextCursor : null;
    if (append && (bucket.loading || !cursor)) return;
    pageControllers[box]?.abort();
    const controller = new AbortController();
    pageControllers[box] = controller;
    const run = epoch, version = ++pageVersions[box];
    bucket.loading = true;
    bucket.error = "";
    if (!append) bucket.fresh = false;
    const current = () => run === epoch && version === pageVersions[box] && !controller.signal.aborted;
    try {
      const page = await api.request<InboxPage>(inboxPath(box, state.filters, cursor ?? undefined), { signal: controller.signal });
      if (!current()) return;
      if (!page || !Array.isArray(page.items) || page.items.length > 25 ||
        new Set(page.items.map(item => item?.id)).size !== page.items.length ||
        page.nextCursor !== null && page.items.length === 0 ||
        !(page.nextCursor === null || typeof page.nextCursor === "string" && page.nextCursor.length > 0) ||
        page.nextCursor !== null && page.nextCursor === cursor)
        throw new ApiError(503);
      page.items.forEach(checkSnapshot);
      // A live page can overlap an earlier read. Keep one row per request without re-sorting.
      bucket.items = Array.from(new Map([
        ...(append ? bucket.items : []), ...page.items.map(remember),
      ].map((item) => [item.id, cache.get(item.id) || item])).values())
        .filter((item) => matches(box, item));
      bucket.nextCursor = page.nextCursor;
      bucket.fresh = true;
    } catch (error) {
      if (!current()) return;
      const code = error instanceof ApiError && error.status === 400 ? "cursor" : failure(error);
      if (code === "expired") logout("expired");
      else bucket.error = code;
    } finally {
      if (current()) bucket.loading = false;
    }
  }
  function reconcileComposer() {
    if (!context) return;
    const current = selected.value;
    if (!current || current.id !== context.requestId || current.currentStepId !== context.stepId || !canDecide(current, state.me!.id)) {
      context = null;
      state.composer = null;
      state.comment = "";
      state.error = "conflict";
    }
  }
  async function readLegacy(reviewed?: Request) {
    if (!state.me) return;
    legacyController?.abort();
    legacyController = new AbortController();
    const signal = legacyController.signal, run = epoch, version = ++legacyVersion;
    const current = () => run === epoch && version === legacyVersion && !signal.aborted;
    state.legacyLoading = true;
    state.legacyFresh = false;
    if (state.selectedId) state.detailFresh = false;
    try {
      const requests = await api.request<Request[]>("/requests", { signal });
      if (!current()) return;
      const reconciled = reviewed && requests.find((item) => item.id === reviewed.id);
      if (reviewed && reconciled) assertSnapshot(reviewed, reconciled);
      requests.forEach(checkSnapshot);
      state.requests = requests.map(remember);
      state.legacyFresh = true;
      if (state.selectedId) {
        state.detail = state.requests.find((item) => item.id === state.selectedId) || null;
        state.detailFresh = true;
        reconcileComposer();
      }
    } catch (error) {
      if (!current()) return;
      const code = failure(error);
      if (code === "expired") logout("expired");
      else state.error = state.notice ? "refresh" : code;
    } finally {
      if (current()) state.legacyLoading = false;
    }
  }
  async function refresh(preserveError = false, reviewed?: Request) {
    if (!state.me) return;
    invalidateReads();
    const run = epoch, version = readVersion;
    readController = new AbortController();
    state.loading = true;
    state.fresh = state.legacyFresh = state.detailFresh = false;
    if (!preserveError) state.error = "";
    const needsLegacy = state.tab === "all" || !!state.selectedId;
    await Promise.all([
      ...boxes.map((box) => readInbox(box)),
      ...(needsLegacy ? [readLegacy(reviewed)] : []),
    ]);
    if (run !== epoch || version !== readVersion) return;
    state.loading = false;
    if (state.detailFresh) reconcileComposer();
    state.fresh = needsLegacy ? state.legacyFresh : state.inboxes.PENDING.fresh && state.inboxes.HANDLED.fresh;
  }
  async function loadMore(box: InboxBox | null = activeBox.value) {
    if (box && !state.busy && !state.loading) await readInbox(box, true);
  }
  async function setTab(tab: Tab) {
    state.tab = tab;
    if (tab === "all" && !state.legacyFresh && !state.legacyLoading) await readLegacy();
  }
  async function setFilters(status: string, processVersion: string) {
    const version = processVersion.trim();
    if (!["", "PENDING", "APPROVED", "REJECTED"].includes(status) ||
      version !== "" && (!/^[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version)) || Number(version) > 2147483647)) {
      state.error = "filters";
      return;
    }
    const filters: InboxFilters = {};
    if (status) filters.status = status as Status;
    if (version) filters.processVersion = Number(version);
    if (JSON.stringify(state.filters) === JSON.stringify(filters)) return;
    invalidateReads();
    state.filters = filters;
    for (const box of boxes) state.inboxes[box] = emptyInbox();
    await refresh();
  }
  async function login(username: string, password: string) {
    if (state.busy) return;
    logout();
    state.busy = true;
    const run = epoch;
    readController = new AbortController();
    const signal = readController.signal;
    api.login(username, password);
    try {
      const me = await api.request<Person>("/me", { signal });
      if (run !== epoch || signal.aborted) return;
      const people = await api.request<Person[]>("/people", { signal });
      if (run !== epoch || signal.aborted) return;
      state.me = me;
      state.people = people;
      await refresh();
    } catch (error) {
      if (run === epoch)
        logout(error instanceof ApiError && error.status === 401 ? "credentials" : failure(error));
    } finally {
      if (run === epoch) state.busy = false;
    }
  }
  function route(id: string) {
    context = null;
    state.selectedId = id;
    state.detail = null;
    state.detailFresh = false;
    for (const box of boxes) {
      const item = state.inboxes[box].items.find((item) => item.id === id);
      if (item && state.inboxes[box].fresh) {
        state.detail = item;
        state.detailFresh = true;
        break;
      }
    }
    if (state.legacyFresh) {
      state.detail = state.requests.find((item) => item.id === id) || state.detail;
      state.detailFresh = !!state.detail;
    }
    state.composer = null;
    state.comment = "";
    state.notice = false;
  }
  function compose(decision: Decision) {
    if (!actionable.value || !selected.value?.currentStepId) return;
    context = { requestId: selected.value.id, stepId: selected.value.currentStepId, decision };
    state.composer = decision;
    state.comment = "";
    state.error = "";
    state.notice = false;
  }
  function cancel() {
    if (!state.busy) {
      context = null;
      state.composer = null;
      state.comment = "";
      state.error = "";
    }
  }
  function isConfirmedDecision(result: unknown, original: Request, actorId: string, stepId: string, decision: Decision): result is Request {
    if (!result || typeof result !== "object") return false;
    const record = result as Partial<Request>;
    if (record.id !== original.id ||
      !["PENDING", "APPROVED", "REJECTED"].includes(record.status || "") ||
      !Array.isArray(record.history) || record.history.length <= original.history.length ||
      !record.definition || !Array.isArray(record.definition.nodes) ||
      !(record.currentStepId === null || typeof record.currentStepId === "string")) return false;
    const history = record.history;
    if (!history.every((event: AuditEvent) => event && typeof event === "object" &&
      typeof event.actorId === "string" && ["SUBMIT", "APPROVE", "REJECT"].includes(event.action) &&
      typeof event.comment === "string" && typeof event.at === "string" &&
      (event.stepId === null || typeof event.stepId === "string"))) return false;
    // A successful HTTP status is not sufficient proof of this exact decision.
    // Retain the immutable prefix and require the actor's new vote for the reviewed step.
    return original.history.every((event, index) => {
      const saved = history[index];
      return saved.actorId === event.actorId && saved.action === event.action &&
        saved.comment === event.comment && saved.at === event.at && saved.stepId === event.stepId;
    }) && history.slice(original.history.length).some((event) =>
      event.actorId === actorId && event.stepId === stepId && event.action === decision,
    );
  }
  async function submit() {
    const request = selected.value, decision = state.composer;
    if (!request || !decision || !actionable.value || !context) return;
    if (request.id !== context.requestId || request.currentStepId !== context.stepId || decision !== context.decision) {
      context = null;
      state.composer = null;
      state.comment = "";
      state.error = "conflict";
      return;
    }
    if (state.comment.length > 2000) { state.error = "commentLong"; return; }
    const run = epoch, id = request.id, stepId = context.stepId, actorId = state.me!.id;
    state.busy = true;
    state.error = "";
    state.notice = false;
    invalidateReads();
    state.loading = false;
    state.detailFresh = false;
    try {
      const result = await api.request<Request>(`/requests/${id}/decisions`, {
        method: "POST", body: JSON.stringify({ stepId, decision, comment: state.comment }),
      });
      if (run !== epoch || state.me?.id !== actorId) return;
      assertDecision(request, result, actorId, stepId, decision);
      if (!isConfirmedDecision(result, request, actorId, stepId, decision))
        throw new InvalidPayloadError();
      const confirmed = remember(result);
      if (state.selectedId === id) state.detail = confirmed;
      context = null;
      state.composer = null;
      state.comment = "";
      state.notice = state.selectedId === id;
      // Partial votes and repeated actors may put a request in either or both boxes.
      // Invalidate every continuation and let the server establish membership again.
      await refresh();
    } catch (error) {
      if (run !== epoch) return;
      const code = failure(error);
      if (code === "expired") logout("expired");
      else { state.error = code; state.fresh = false; await refresh(true, request); }
    } finally {
      if (run === epoch) state.busy = false;
    }
  }
  return { state, selected, visible, actionable, activeBox, activeInbox, listFresh, listLoading,
    listError, login, logout, refresh, refreshDetail: readLegacy, loadMore, setTab, setFilters, route, compose, cancel, submit };
}
