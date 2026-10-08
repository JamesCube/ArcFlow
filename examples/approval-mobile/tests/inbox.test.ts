import { describe, it, expect, vi } from "vitest";
import { createWorkspace } from "../src/domain/workspace";
import { ApiError, createApi, inboxPath } from "../src/domain/api";
import type { Api, InboxPage, Request } from "../src/domain/types";
import { request, deferred, approved } from "./fixtures";
const page = (items: Request[], nextCursor: string | null = null): InboxPage => ({ items, nextCursor });
function voted(r = request()): Request {
  return { ...r, history: [...r.history, { actorId: "bob", action: "APPROVE", comment: "", at: r.updatedAt, stepId: "team" }] };
}
function repeated(r = request()): Request {
  return { ...approved(r), status: "PENDING", currentStepId: "later" };
}
function setup() {
  const r = request({ approverId: "carol" });
  const reads = vi.fn(async (path: string, _options?: RequestInit): Promise<unknown> =>
    path === "/requests" ? [r] : page(path.includes("box=PENDING") ? [r] : []));
  let actor = "bob";
  const api: Api = {
    login: (name) => { actor = name; }, logout: vi.fn(),
    request: vi.fn((path: string, options?: RequestInit) => (
      path === "/me" ? Promise.resolve({ id: actor, displayName: actor }) :
      path === "/people" ? Promise.resolve([]) : reads(path, options)
    )) as Api["request"],
  };
  return { r, api, reads, w: createWorkspace(api) };
}
describe("independent server member inboxes", () => {
  it("uses bounded server boxes, including non-representative members, and keeps legacy lazy", async () => {
    const { w, reads, r } = setup();
    await w.login("bob", "local");
    expect(reads.mock.calls.map(([path]) => path)).toEqual([
      "/requests/inbox?box=PENDING&limit=25", "/requests/inbox?box=HANDLED&limit=25",
    ]);
    expect(w.visible.value).toEqual([r]);
    w.route(r.id);
    expect(w.actionable.value).toBe(true);
    await w.setTab("all");
    expect(reads).toHaveBeenCalledWith("/requests", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it("preserves each box's cursor, server creation order, and deduplicates live page overlaps", async () => {
    const { w, reads, r } = setup();
    const second = request({ id: "r2", updatedAt: "2099-01-01T00:00:00Z" });
    const handled = voted(request({ id: "h1" }));
    reads.mockImplementation(async (path) => {
      const query = new URLSearchParams(path.split("?")[1]);
      if (query.get("box") === "HANDLED") return page([handled], "handled cursor");
      if (query.has("cursor")) return page([second, request({ id: "r3" })]);
      return page([r, second], "pending +/& cursor");
    });
    await w.login("bob", "local");
    await w.setTab("done");
    await w.setTab("todo");
    expect(reads).toHaveBeenCalledTimes(2);
    await w.loadMore();
    expect(w.visible.value.map((item) => item.id)).toEqual(["r1", "r2", "r3"]);
    expect(w.state.inboxes.HANDLED.nextCursor).toBe("handled cursor");
    const query = new URLSearchParams(reads.mock.calls.at(-1)![0].split("?")[1]);
    expect(query.get("cursor")).toBe("pending +/& cursor");
    const calls = reads.mock.calls.length;
    await w.loadMore();
    expect(reads).toHaveBeenCalledTimes(calls);
  });
  it("preserves paged inboxes across Related to me, opening detail and Back", async () => {
    const { w, reads, r } = setup();
    reads.mockImplementation(async (path) => path === "/requests" ? [r, request({ id: "r2" })] :
      path.includes("cursor=") ? page([request({ id: "r2" })], "after-page-two") :
      page(path.includes("PENDING") ? [r] : [], path.includes("PENDING") ? "page-two" : null));
    await w.login("bob", "local");
    await w.loadMore();
    await w.setTab("all");
    await w.setTab("todo");
    w.route("r2");
    await w.refreshDetail();
    w.route("");
    expect(w.visible.value.map((item) => item.id)).toEqual(["r1", "r2"]);
    expect(w.state.inboxes.PENDING.nextCursor).toBe("after-page-two");
    expect(reads.mock.calls.filter(([path]) => path.startsWith("/requests/inbox"))).toHaveLength(3);
  });
  it("retains loaded items on page error, retries that cursor, and ignores duplicate clicks", async () => {
    const { w, reads, r } = setup();
    reads.mockImplementation(async (path) => page(path.includes("PENDING") ? [r] : [], path.includes("PENDING") ? "next" : null));
    await w.login("bob", "local");
    const pending = deferred<InboxPage>();
    reads.mockImplementationOnce(() => pending.promise);
    const loading = w.loadMore();
    await w.loadMore();
    expect(reads).toHaveBeenCalledTimes(3);
    pending.reject(new Error("offline"));
    await loading;
    expect(w.visible.value).toHaveLength(1);
    expect(w.state.inboxes.PENDING).toMatchObject({ nextCursor: "next", fresh: true, loading: false, error: "network" });
    reads.mockResolvedValueOnce(page([request({ id: "r2" })]));
    await w.loadMore();
    expect(reads.mock.calls.at(-1)![0]).toContain("cursor=next");
    expect(w.visible.value).toHaveLength(2);
    expect(w.listError.value).toBe("");
  });
  it("keeps handled usable when pending fails; a failed empty page is not confirmed empty", async () => {
    const { w, reads } = setup();
    reads.mockImplementation(async (path) => {
      if (path.includes("PENDING")) throw new ApiError(503);
      return page([voted()]);
    });
    await w.login("bob", "local");
    expect(w.listFresh.value).toBe(false);
    expect(w.listError.value).toBe("unavailable");
    await w.setTab("done");
    expect(w.listFresh.value).toBe(true);
    expect(w.visible.value).toHaveLength(1);
  });
  it("resets both cursors on filters and blocks stale ignored-abort page responses", async () => {
    const { w, reads, r } = setup();
    reads.mockResolvedValue(page([r], "old"));
    await w.login("bob", "local");
    const old = deferred<InboxPage>();
    reads.mockImplementationOnce(() => old.promise);
    const loading = w.loadMore();
    const signal = reads.mock.calls.at(-1)![1]!.signal!;
    reads.mockResolvedValue(page([]));
    await w.setFilters("APPROVED", "2");
    expect(signal.aborted).toBe(true);
    expect(reads.mock.calls.slice(-2).every(([path]) => path.includes("status=APPROVED&processVersion=2") && !path.includes("cursor="))).toBe(true);
    old.resolve(page([r], "stale"));
    await loading;
    expect(w.state.inboxes.PENDING.items).toEqual([]);
    expect(w.state.inboxes.HANDLED.nextCursor).toBeNull();
  });
  it("rejects invalid filter values without issuing requests", async () => {
    const { w, reads } = setup();
    await w.login("bob", "local");
    const before = reads.mock.calls.length;
    for (const version of ["0", "-1", "1.5", "1e2", "9007199254740992", "2147483648", "bad"]) await w.setFilters("", version);
    await w.setFilters("bogus", "");
    expect(reads).toHaveBeenCalledTimes(before);
    expect(w.state.error).toBe("filters");
  });
  it("clears actor filters/search/pages and ignores a late response or 401 after actor change", async () => {
    const { w, reads, r } = setup();
    reads.mockResolvedValue(page([r], "old"));
    await w.login("bob", "local");
    w.state.query = "secret";
    await w.setFilters("PENDING", "1");
    const old = deferred<InboxPage>();
    reads.mockImplementationOnce(() => old.promise);
    const loading = w.loadMore("PENDING");
    const signal = reads.mock.calls.at(-1)![1]!.signal!;
    reads.mockResolvedValue(page([]));
    await w.login("carol", "local");
    expect(signal.aborted).toBe(true);
    old.reject(new ApiError(401));
    await loading;
    expect(w.state.me?.id).toBe("carol");
    expect(w.state.filters).toEqual({});
    expect(w.state.query).toBe("");
    expect(w.visible.value).toEqual([]);
  });
  it.each([voted, repeated, approved])("refreshes both boxes from first page after a vote (%#)", async (advance) => {
    const { w, reads, r } = setup();
    if (advance === repeated) r.definition.nodes.splice(-1, 0, { id: "later", name: "Bob again", type: "approval", assigneeId: "bob" });
    await w.login("bob", "local");
    w.route("r1"); w.compose("APPROVE");
    const next = advance(r);
    reads.mockImplementation(async (path) => {
      if (path.endsWith("/decisions")) return next;
      if (path === "/requests") return [next];
      return page(path.includes("box=HANDLED") || next.currentStepId === "later" ? [next] : []);
    });
    await w.submit();
    expect(w.state.notice).toBe(true);
    expect(w.state.inboxes.HANDLED.items).toEqual([next]);
    expect(w.state.inboxes.PENDING.items).toHaveLength(next.currentStepId === "later" ? 1 : 0);
    expect(reads.mock.calls.slice(-3).every(([path]) => !path.includes("cursor="))).toBe(true);
    expect(w.selected.value).toEqual(next);
    expect(w.actionable.value).toBe(next.currentStepId === "later");
  });
  it("a newer handled snapshot cannot be regressed by pending or legacy reads", async () => {
    const { w, reads, r } = setup();
    await w.login("bob", "local");
    w.route("r1");
    const oldPending = deferred<InboxPage>(), oldLegacy = deferred<Request[]>();
    const next = voted(r);
    reads.mockImplementation((path) => path === "/requests" ? oldLegacy.promise :
      path.includes("PENDING") ? oldPending.promise : Promise.resolve(page([next])));
    const refresh = w.refresh();
    await Promise.resolve();
    oldPending.resolve(page([r]));
    oldLegacy.resolve([r]);
    await refresh;
    expect(w.selected.value?.history).toEqual(next.history);
    expect(w.state.inboxes.PENDING.items).toEqual([]);
    expect(w.actionable.value).toBe(false);
  });
  it("ignores an in-flight continuation after a confirmed vote even if fetch ignores abort", async () => {
    const { w, reads, r } = setup();
    reads.mockImplementation(async (path) => page(path.includes("PENDING") ? [r] : [], path.includes("PENDING") ? "next" : null));
    await w.login("bob", "local");
    const old = deferred<InboxPage>();
    reads.mockImplementationOnce(() => old.promise);
    const loading = w.loadMore();
    const signal = reads.mock.calls.at(-1)![1]!.signal!;
    w.route("r1"); w.compose("APPROVE");
    const next = voted(r);
    reads.mockImplementation(async (path) => path.endsWith("/decisions") ? next :
      path === "/requests" ? [next] : page(path.includes("HANDLED") ? [next] : []));
    await w.submit();
    expect(signal.aborted).toBe(true);
    old.resolve(page([r], "stale-cursor"));
    await loading;
    expect(w.state.inboxes.PENDING.items).toEqual([]);
    expect(w.state.inboxes.PENDING.nextCursor).toBeNull();
    expect(w.state.inboxes.HANDLED.items).toEqual([next]);
  });
  it("closes the old confirmation when a later handled response reveals the same actor's next stage", async () => {
    const { w, reads, r } = setup();
    r.definition.nodes.splice(-1, 0, { id: "later", name: "Bob again", type: "approval", assigneeId: "bob" });
    await w.login("bob", "local");
    w.route("r1"); w.compose("REJECT"); w.state.comment = "old stage only";
    const handled = deferred<InboxPage>();
    reads.mockImplementation(async (path) => path === "/requests" ? [r] :
      path.includes("HANDLED") ? handled.promise : page([r]));
    const refreshing = w.refresh();
    await Promise.resolve();
    handled.resolve(page([repeated(r)]));
    await refreshing;
    expect(w.state.composer).toBeNull();
    expect(w.state.comment).toBe("");
    expect(w.state.error).toBe("conflict");
    expect(w.selected.value?.currentStepId).toBe("later");
    expect(w.state.inboxes.PENDING.items[0].currentStepId).toBe("later");
    expect(w.state.inboxes.HANDLED.items[0].currentStepId).toBe("later");
    expect(w.actionable.value).toBe(true);
  });
  it("keeps a confirmed vote distinct from a failed refresh and disables stale actions", async () => {
    const { w, reads, r } = setup();
    await w.login("bob", "local");
    w.route("r1"); w.compose("APPROVE");
    reads.mockImplementation(async (path) => {
      if (path.endsWith("/decisions")) return voted(r);
      throw new ApiError(503);
    });
    await w.submit();
    expect(w.state.notice).toBe(true);
    expect(w.state.error).toBe("refresh");
    expect(w.selected.value?.history).toEqual(voted(r).history);
    expect(w.actionable.value).toBe(false);
  });
  it.each([
    ["wrong request", (r: Request) => ({ ...voted(r), id: "another-request" })],
    ["unknown status", (r: Request) => ({ ...voted(r), status: "SUCCEEDED" })],
    ["missing history", (r: Request) => ({ ...voted(r), history: undefined })],
    ["another actor", (r: Request) => ({ ...voted(r), history: [...r.history, { ...voted(r).history.at(-1)!, actorId: "carol" }] })],
    ["another step", (r: Request) => ({ ...voted(r), history: [...r.history, { ...voted(r).history.at(-1)!, stepId: "later" }] })],
    ["another decision", (r: Request) => ({ ...voted(r), history: [...r.history, { ...voted(r).history.at(-1)!, action: "REJECT" }] })],
    ["rewritten prior history", (r: Request) => ({ ...voted(r), history: [{ ...r.history[0], comment: "changed" }, voted(r).history.at(-1)!] })],
    ["unknown audit action", (r: Request) => ({ ...voted(r), history: [...voted(r).history, { ...voted(r).history.at(-1)!, action: "EDIT" }] })],
  ] as const)("treats a %s success payload as uncertain and reconciles without confirming it", async (_, malformed) => {
    const { w, reads, r } = setup();
    await w.login("bob", "local");
    w.route("r1"); w.compose("APPROVE"); w.state.comment = "Keep this note";
    reads.mockImplementation(async (path) => path.endsWith("/decisions") ? malformed(r) :
      path === "/requests" ? [r] : page(path.includes("PENDING") ? [r] : []));
    await w.submit();
    expect(w.state.notice).toBe(false);
    expect(w.state.error).toBe("invalidData");
    expect(w.selected.value).toEqual(r);
    expect(w.state.inboxes.HANDLED.items).toEqual([]);
    expect(w.state.composer).toBeNull();
    expect(w.state.comment).toBe("");
    expect(w.actionable.value).toBe(true);
    expect(reads.mock.calls.filter(([path]) => path.endsWith("/decisions"))).toHaveLength(1);
    expect(reads.mock.calls.slice(-3).map(([path]) => path)).toEqual([
      "/requests/inbox?box=PENDING&limit=25", "/requests/inbox?box=HANDLED&limit=25", "/requests",
    ]);
  });
  it("recovers an actually committed vote after a wrong-request payload without claiming confirmation", async () => {
    const { w, reads, r } = setup();
    await w.login("bob", "local");
    w.route("r1"); w.compose("APPROVE");
    reads.mockImplementation(async (path) => path.endsWith("/decisions") ? { ...voted(r), id: "wrong" } :
      path === "/requests" ? [voted(r)] : page(path.includes("HANDLED") ? [voted(r)] : []));
    await w.submit();
    expect(w.state.notice).toBe(false);
    expect(w.state.composer).toBeNull();
    expect(w.selected.value).toEqual(voted(r));
    expect(w.actionable.value).toBe(false);
    expect(w.state.inboxes.PENDING.items).toEqual([]);
    expect(w.state.inboxes.HANDLED.items).toEqual([voted(r)]);
  });
  it("cursor errors preserve results and refresh recovers from the first page", async () => {
    const { w, reads, r } = setup();
    reads.mockResolvedValue(page([r], "bad"));
    await w.login("bob", "local");
    reads.mockRejectedValueOnce(new ApiError(400));
    await w.loadMore();
    expect(w.listError.value).toBe("cursor");
    reads.mockResolvedValue(page([]));
    await w.refresh();
    expect(w.listError.value).toBe("");
    expect(w.visible.value).toEqual([]);
    expect(reads.mock.calls.slice(-2).every(([path]) => !path.includes("cursor="))).toBe(true);
  });
});
describe("inbox transport allowlist", () => {
  it("encodes an opaque cursor once and forwards cancellation without an actor override", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(page([])) });
    const api = createApi(fetcher), controller = new AbortController();
    const path = inboxPath("HANDLED", { status: "PENDING", processVersion: 3 }, "opaque +/=%?");
    await api.request(path, { signal: controller.signal });
    expect(fetcher).toHaveBeenCalledWith(`/api${path}`, expect.objectContaining({ signal: controller.signal }));
    const params = new URLSearchParams(path.split("?")[1]);
    expect(params.get("cursor")).toBe("opaque +/=%?");
    expect(params.has("actor")).toBe(false);
  });
  it("rejects actor spoofing, duplicate parameters, empty filters and invalid ranges before fetching", async () => {
    const fetcher = vi.fn(), api = createApi(fetcher);
    for (const query of ["actor=bob", "actorId=bob", "box=PENDING&box=HANDLED", "status=", "status=pending", "processVersion=0", "limit=101", "limit=0", "cursor=", "unknown=1", "box=PENDING#x"])
      await expect(api.request(`/requests/inbox?${query}`)).rejects.toThrow("Unsupported endpoint");
    expect(fetcher).not.toHaveBeenCalled();
  });
});


describe("procurement and inbox integration", () => {
  function withProcurement(r: Request) {
    r.days = 0;
    r.business = { type: "procurement", businessId: "PO-INBOX", title: r.title, reason: r.reason,
      item: "Synthetic chairs", quantity: 3, unitPrice: "199.99", currency: "CNY" };
    return r;
  }
  it("rejects rewritten typed continuations atomically and retains the verified snapshot for retries", async () => {
    const { w, reads, r } = setup(); withProcurement(r);
    reads.mockImplementation(async path => path === "/requests" ? [r] : page(path.includes("PENDING") ? [r] : [], path.includes("PENDING") ? "next" : null));
    await w.login("bob", "local"); w.route(r.id);
    const changed = { ...r, business: { ...r.business!, quantity: 4 } as Request["business"] };
    reads.mockImplementation(async path => path === "/requests" ? [changed] : page(path.includes("PENDING") ? [request({ id: "new-row" }), changed] : []));
    await w.loadMore();
    expect(w.state.error).toBe("invalidData");
    expect(w.state.inboxes.PENDING.items).toEqual([]);
    expect(w.selected.value).toBeUndefined();
    expect(w.actionable.value).toBe(false);
    await w.refresh();
    expect(w.state.error).toBe("invalidData");
    expect(w.state.requests).toEqual([]);
    expect(w.state.inboxes.PENDING.items).toEqual([]);
    reads.mockImplementation(async path => path === "/requests" ? [r] : page(path.includes("PENDING") ? [r] : []));
    await w.refresh();
    expect(w.selected.value?.business).toEqual(r.business);
    expect(w.actionable.value).toBe(true);
  });
  it("keeps exact procurement data after voting while ignoring an older ignored-abort continuation", async () => {
    const { w, reads, r } = setup(); withProcurement(r);
    reads.mockImplementation(async path => path === "/requests" ? [r] : page(path.includes("PENDING") ? [r] : [], path.includes("PENDING") ? "next" : null));
    await w.login("bob", "local");
    const old = deferred<InboxPage>(); reads.mockImplementationOnce(() => old.promise);
    const loading = w.loadMore(); const signal = reads.mock.calls.at(-1)![1]!.signal!;
    w.route(r.id); w.compose("APPROVE"); const next = voted(r);
    reads.mockImplementation(async path => path.endsWith("/decisions") ? next : path === "/requests" ? [next] : page(path.includes("HANDLED") ? [next] : []));
    await w.submit(); expect(signal.aborted).toBe(true);
    old.resolve(page([r], "stale")); await loading;
    expect(w.state.notice).toBe(true);
    expect(w.selected.value?.business).toEqual(r.business);
    expect(w.selected.value?.history).toEqual(next.history);
    expect(w.state.inboxes.PENDING.items).toEqual([]);
    expect(w.state.inboxes.HANDLED.items).toEqual([next]);
  });
  it("rejects a page larger than its requested 25-row bound without mutating the cache", async () => {
    const { w, reads } = setup();
    reads.mockResolvedValue(page(Array.from({ length: 26 }, (_, i) => request({ id: `item-${i}` }))));
    await w.login("bob", "local");
    expect(w.state.inboxes.PENDING.error).toBe("unavailable");
    expect(w.visible.value).toEqual([]);
    expect(w.state.inboxes.PENDING.fresh).toBe(false);
  });
});
