import { describe, it, expect, vi } from "vitest";
import { createWorkspace } from "../src/domain/workspace";
import { ApiError } from "../src/domain/api";
import type { Api, Request } from "../src/domain/types";
import { request, deferred, listResponse, approved } from "./fixtures";
function setup() {
  const r = request();
  const api = {
    login: vi.fn(),
    logout: vi.fn(),
    request: vi.fn(async (path: string) =>
      path === "/me"
        ? { id: "bob", displayName: "Bob" }
        : path === "/people"
          ? [{ id: "bob", displayName: "Bob" }]
          : listResponse(path, [r]),
    ),
  };
  return { r, api, w: createWorkspace(api as Api) };
}
describe("server-confirmed state and interrupted flows", () => {
  it("does not load data before authentication", async () => {
    const { api, w } = setup();
    await w.refresh();
    expect(api.request).not.toHaveBeenCalled();
    expect(w.actionable.value).toBe(false);
  });
  it("logs in with configured credentials then fetches the real worklist", async () => {
    const { api, w } = setup();
    await w.login("bob", "configured");
    expect(api.login).toHaveBeenCalledWith("bob", "configured");
    expect(w.visible.value).toHaveLength(1);
    w.route("r1");
    expect(w.actionable.value).toBe(true);
  });
  it("rejects invalid authentication without fabricated account data", async () => {
    const { api, w } = setup();
    api.request.mockRejectedValue(new ApiError(401));
    await w.login("bob", "wrong");
    expect(w.state.error).toBe("credentials");
    expect(w.state.me).toBeNull();
    expect(w.state.requests).toEqual([]);
  });
  it("retains deep-link ID on expired auth but clears private data and draft", async () => {
    const { api, w } = setup();
    await w.login("bob", "valid");
    w.route("r1");
    w.compose("APPROVE");
    w.state.comment = "note";
    api.request.mockRejectedValue(new ApiError(401));
    await w.refresh();
    expect(w.state.selectedId).toBe("r1");
    expect(w.state.error).toBe("expired");
    expect(w.state.me).toBeNull();
    expect(w.state.requests).toEqual([]);
    expect(w.state.comment).toBe("");
  });
  it("prevents duplicate clicks and posts no actor override", async () => {
    const { api, w, r } = setup();
    await w.login("bob", "valid");
    w.route("r1");
    w.compose("APPROVE");
    w.state.comment = "Reviewed";
    const pending = deferred<Request>();
    api.request.mockImplementation((path) => path.endsWith("/decisions")
      ? pending.promise as never : Promise.resolve(listResponse(path, [approved(r)])) as never);
    const one = w.submit(),
      two = w.submit();
    expect(
      api.request.mock.calls.filter((c) => c[0].includes("decisions")),
    ).toHaveLength(1);
    expect(w.state.notice).toBe(false);
    const call = api.request.mock.calls.at(-1) as unknown as [
      string,
      { body: string },
    ];
    expect(JSON.parse(call[1].body)).toEqual({
      stepId: "team",
      decision: "APPROVE",
      comment: "Reviewed",
    });
    pending.resolve(approved(r));
    await Promise.all([one, two]);
    expect(w.state.notice).toBe(true);
    expect(w.actionable.value).toBe(false);
  });
  it("does not rewrite the final request outcome after a partial ALL vote", async () => {
    const { api, w, r } = setup();
    await w.login("bob", "valid");
    w.route("r1");
    w.compose("APPROVE");
    const voted = {
      ...r,
      history: [
        ...r.history,
        {
          actorId: "bob",
          action: "APPROVE",
          comment: "",
          at: r.updatedAt,
          stepId: "team",
        },
      ],
    };
    api.request.mockImplementation(async (path) => path.endsWith("/decisions") ? voted as never : listResponse(path, [voted as Request]) as never);
    await w.submit();
    expect(w.selected.value?.status).toBe("PENDING");
    expect(w.actionable.value).toBe(false);
    w.state.tab = "done";
    expect(w.visible.value).toHaveLength(1);
  });
  it("cancel discards a decision note without calling the backend", async () => {
    const { api, w } = setup();
    await w.login("bob", "valid");
    w.route("r1");
    w.compose("REJECT");
    w.state.comment = "No";
    const before = api.request.mock.calls.length;
    w.cancel();
    expect(w.state.composer).toBeNull();
    expect(w.state.comment).toBe("");
    expect(api.request).toHaveBeenCalledTimes(before);
  });
  it("back/new navigation closes the sheet and preserves list filters", async () => {
    const { w } = setup();
    await w.login("bob", "valid");
    w.state.query = "planning";
    w.state.tab = "all";
    w.route("r1");
    w.compose("REJECT");
    w.route("");
    expect(w.state.composer).toBeNull();
    expect(w.state.query).toBe("planning");
    expect(w.state.tab).toBe("all");
  });
  it("failed submission retains the note and refreshes before retry", async () => {
    const { api, w, r } = setup();
    await w.login("bob", "valid");
    w.route("r1");
    w.compose("APPROVE");
    w.state.comment = "Keep me";
    api.request
      .mockRejectedValueOnce(new Error("secret network details"))
      .mockImplementation(async (path) => listResponse(path, [r]) as never);
    await w.submit();
    expect(w.state.notice).toBe(false);
    expect(w.state.error).toBe("network");
    expect(w.state.comment).toBe("Keep me");
    expect(w.state.composer).toBe("APPROVE");
    expect(w.actionable.value).toBe(true);
  });
  it("disables stale actions if both write and reconciliation fail", async () => {
    const { api, w } = setup();
    await w.login("bob", "valid");
    w.route("r1");
    w.compose("REJECT");
    api.request.mockRejectedValue(new Error("offline"));
    await w.submit();
    expect(w.actionable.value).toBe(false);
    expect(w.state.fresh).toBe(false);
    expect(w.state.notice).toBe(false);
  });
  it("refreshes conflict state and removes old actions", async () => {
    const { api, w, r } = setup();
    await w.login("bob", "valid");
    w.route("r1");
    w.compose("REJECT");
    api.request
      .mockRejectedValueOnce(new ApiError(409))
      .mockImplementation(async (path) => listResponse(path, [
        approved(r),
      ]) as never);
    await w.submit();
    expect(w.state.error).toBe("conflict");
    expect(w.selected.value?.status).toBe("APPROVED");
    expect(w.actionable.value).toBe(false);
  });
  it("ignores old refresh results after a newer refresh", async () => {
    const { api, w } = setup();
    await w.login("bob", "valid");
    const old = deferred<unknown>();
    api.request.mockImplementationOnce(() => old.promise as never)
      .mockImplementation(async (path) => listResponse(path, []) as never);
    const first = w.refresh();
    await w.refresh();
    old.resolve({ items: [request()], nextCursor: "old" });
    await first;
    expect(w.state.inboxes.PENDING.items).toEqual([]);
    expect(w.state.inboxes.PENDING.nextCursor).toBeNull();
  });
  it("ignores pending authentication after logout", async () => {
    const { api, w } = setup();
    const pending = deferred<unknown>();
    api.request.mockImplementationOnce(() => pending.promise as never);
    const login = w.login("bob", "valid");
    w.logout();
    pending.resolve({ id: "bob", displayName: "Bob" });
    await login;
    expect(w.state.me).toBeNull();
    expect(w.state.requests).toEqual([]);
  });
  it("ignores a late decision response after logout", async () => {
    const { api, w, r } = setup();
    await w.login("bob", "valid");
    w.route("r1");
    w.compose("APPROVE");
    const pending = deferred<Request>();
    api.request.mockImplementation(() => pending.promise as never);
    const sent = w.submit();
    w.logout();
    pending.resolve({ ...r, status: "APPROVED" });
    await sent;
    expect(w.state.requests).toEqual([]);
    expect(w.state.notice).toBe(false);
  });
  it("guards decision length and inactive/unknown tasks", async () => {
    const { api, w } = setup();
    await w.login("bob", "valid");
    w.route("missing");
    w.compose("APPROVE");
    expect(w.state.composer).toBeNull();
    w.route("r1");
    w.compose("APPROVE");
    w.state.comment = "x".repeat(2001);
    const calls = api.request.mock.calls.length;
    await w.submit();
    expect(w.state.error).toBe("commentLong");
    expect(api.request).toHaveBeenCalledTimes(calls);
  });
});

describe("frozen reviewed step", () => {
  function nextStep(r: Request): Request {
    return {
      ...r,
      currentStepId: "later",
      history: [
        ...r.history,
        {
          actorId: "bob",
          action: "APPROVE",
          comment: "Already committed",
          at: r.updatedAt,
          stepId: "team",
        },
        {
          actorId: "carol",
          action: "APPROVE",
          comment: "",
          at: r.updatedAt,
          stepId: "team",
        },
      ],

    };
  }
  it("refresh cannot carry a prior step decision to a later step assigned to the same actor", async () => {
    const { api, w, r } = setup();
    r.definition.nodes.splice(-1, 0, { id: "later", type: "approval", name: "Later Bob step", assigneeId: "bob" });
    await w.login("bob", "valid");
    w.route("r1");
    w.compose("REJECT");
    w.state.comment = "Only intended for team";
    api.request.mockImplementation(async (path) => listResponse(path, [nextStep(r)]) as never);
    await w.refresh();
    expect(w.state.composer).toBeNull();
    expect(w.state.comment).toBe("");
    expect(w.state.error).toBe("conflict");
    const before = api.request.mock.calls.length;
    await w.submit();
    expect(api.request).toHaveBeenCalledTimes(before);
    expect(w.actionable.value).toBe(true);
  });
  it("a lost response reconciles a committed vote without silently retrying the next stage", async () => {
    const { api, w, r } = setup();
    r.definition.nodes.splice(-1, 0, { id: "later", type: "approval", name: "Later Bob step", assigneeId: "bob" });
    await w.login("bob", "valid");
    w.route("r1");
    w.compose("APPROVE");
    w.state.comment = "Only first stage";
    api.request
      .mockRejectedValueOnce(new Error("response lost"))
      .mockImplementation(async (path) => listResponse(path, [nextStep(r)]) as never);
    await w.submit();
    expect(w.state.composer).toBeNull();
    expect(w.state.notice).toBe(false);
    expect(w.selected.value?.currentStepId).toBe("later");
    expect(
      api.request.mock.calls.filter((call) => call[0].endsWith("/decisions")),
    ).toHaveLength(1);
    await w.submit();
    expect(
      api.request.mock.calls.filter((call) => call[0].endsWith("/decisions")),
    ).toHaveLength(1);
  });
});

it("clears stale visible business data and freezes decisions when strict parsing fails", async () => {
  const { InvalidPayloadError } = await import("../src/domain/business");
  const { api, w } = setup();
  await w.login("bob", "valid");
  w.route("r1");
  w.compose("APPROVE");
  w.state.comment = "Do not apply to malformed data";
  api.request.mockRejectedValueOnce(new InvalidPayloadError());
  await w.refresh();
  expect(w.state.error).toBe("invalidData");
  expect(w.state.requests).toEqual([]);
  expect(w.selected.value).toBeUndefined();
  expect(w.state.composer).toBeNull();
  expect(w.state.comment).toBe("");
  expect(w.actionable.value).toBe(false);
  expect(w.state.fresh).toBe(false);
  expect(w.state.notice).toBe(false);
});

it("never announces success for a malformed decision reply and reconciles via a valid read", async () => {
  const { InvalidPayloadError } = await import("../src/domain/business");
  const { api, w, r } = setup();
  await w.login("bob", "valid");
  w.route("r1");
  w.compose("APPROVE");
  api.request.mockRejectedValueOnce(new InvalidPayloadError()).mockImplementation(async path => listResponse(path, [r]) as never);
  await w.submit();
  expect(w.state.notice).toBe(false);
  expect(w.state.error).toBe("invalidData");
  expect(w.state.composer).toBeNull();
  expect(w.state.requests).toEqual([r]);
});

describe("decision evidence matches the reviewed immutable instance", () => {
  const purchase = (): Request => {
    const r = request({ days: 0 });
    return { ...r, business: { type: "procurement", businessId: "PO-001", title: r.title, reason: r.reason,
      item: "Synthetic item", quantity: 3, unitPrice: "199.99", currency: "CNY" } };
  };
  const voted = (r: Request): Request => ({ ...r, history: [...r.history,
    { actorId: "bob", action: "APPROVE", comment: "Original durable note", at: r.updatedAt, stepId: "team" },
  ] });
  const mutations: [string, (r: Request) => Request][] = [
    ["unchanged pending reply", r => r],
    ["other identity", r => ({ ...voted(r), id: "other" })],
    ["created timestamp", r => ({ ...voted(r), createdAt: "2026-10-06T00:00:00Z" })],
    ["business reference", r => ({ ...voted(r), business: { ...r.business!, businessId: "PO-OTHER" } })],
    ["business amount", r => ({ ...voted(r), business: { ...r.business!, quantity: 4 } as Request["business"] })],
    ["definition snapshot", r => ({ ...voted(r), definition: { ...r.definition, name: "Different routing snapshot" } })],
    ["rewritten audit prefix", r => ({ ...voted(r), history: [{ ...r.history[0], comment: "Rewritten" }, voted(r).history[1]] })],
    ["wrong decision", r => ({ ...voted(r), history: [...r.history, { ...voted(r).history[1], action: "REJECT" }] })],
    ["wrong actor", r => ({ ...voted(r), history: [...r.history, { ...voted(r).history[1], actorId: "carol" }] })],
    ["wrong step", r => ({ ...voted(r), history: [...r.history, { ...voted(r).history[1], stepId: "future" }] })],
    ["duplicate vote", r => ({ ...voted(r), history: [...voted(r).history, voted(r).history[1]] })],
  ];
  for (const [label, mutate] of mutations) it(`rejects ${label} instead of confirming success`, async () => {
    const { api, w } = setup();
    const r = purchase();
    api.request.mockResolvedValueOnce({ id: "bob", displayName: "Bob" } as never)
      .mockResolvedValueOnce([] as never).mockImplementation(async path => listResponse(path, [r]) as never);
    await w.login("bob", "valid");
    w.route(r.id);
    w.compose("APPROVE");
    const reconciliation = deferred<Request[]>();
    api.request.mockResolvedValueOnce(mutate(r) as never).mockImplementation(async path =>
      listResponse(path, await reconciliation.promise) as never);
    const sending = w.submit();
    await Promise.resolve();
    await Promise.resolve();
    expect(w.state.notice).toBe(false);
    expect(w.state.requests).toEqual([]);
    expect(w.state.composer).toBeNull();
    expect(w.actionable.value).toBe(false);
    reconciliation.resolve([r]);
    await sending;
    expect(w.state.notice).toBe(false);
    expect(w.state.error).toBe("invalidData");
    expect(w.state.requests).toEqual([r]);
  });
  it("rejects a changed immutable snapshot during reconciliation as well", async () => {
    const { api, w } = setup();
    const r = purchase();
    api.request.mockResolvedValueOnce({ id: "bob", displayName: "Bob" } as never)
      .mockResolvedValueOnce([] as never).mockImplementation(async path => listResponse(path, [r]) as never);
    await w.login("bob", "valid");
    w.route(r.id);
    w.compose("APPROVE");
    const altered = { ...voted(r), business: { ...r.business!, businessId: "CHANGED" } };
    api.request.mockResolvedValueOnce(altered as never).mockImplementation(async path => listResponse(path, [altered]) as never);
    await w.submit();
    expect(w.state.error).toBe("invalidData");
    expect(w.state.requests).toEqual([]);
    expect(w.state.fresh).toBe(false);
    expect(w.state.notice).toBe(false);
  });
  it("accepts proven same-decision replay while preserving its original durable note", async () => {
    const { api, w } = setup();
    const r = purchase();
    api.request.mockResolvedValueOnce({ id: "bob", displayName: "Bob" } as never)
      .mockResolvedValueOnce([] as never).mockImplementation(async path => listResponse(path, [r]) as never);
    await w.login("bob", "valid");
    w.route(r.id);
    w.compose("APPROVE");
    w.state.comment = "Changed retry note must not overwrite audit";
    api.request.mockResolvedValueOnce(voted(r) as never).mockImplementation(async path => listResponse(path, [voted(r)]) as never);
    await w.submit();
    expect(w.state.notice).toBe(true);
    expect(w.selected.value?.history.at(-1)?.comment).toBe("Original durable note");
    expect(w.actionable.value).toBe(false);
  });
});
