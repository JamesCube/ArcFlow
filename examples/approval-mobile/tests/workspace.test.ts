import { describe, it, expect, vi } from "vitest";
import { createWorkspace } from "../src/domain/workspace";
import { ApiError } from "../src/domain/api";
import type { Api, Request } from "../src/domain/types";
import { request, deferred } from "./fixtures";
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
          : [r],
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
    api.request.mockImplementation(() => pending.promise as never);
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
    pending.resolve({ ...r, status: "APPROVED", currentStepId: null });
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
    api.request.mockResolvedValue(voted as never);
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
      .mockResolvedValueOnce([r]);
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
      .mockResolvedValueOnce([
        { ...r, status: "APPROVED", currentStepId: null },
      ]);
    await w.submit();
    expect(w.state.error).toBe("conflict");
    expect(w.selected.value?.status).toBe("APPROVED");
    expect(w.actionable.value).toBe(false);
  });
  it("ignores old refresh results after a newer refresh", async () => {
    const { api, w } = setup();
    await w.login("bob", "valid");
    const old = deferred<Request[]>();
    api.request
      .mockImplementationOnce(() => old.promise as never)
      .mockResolvedValueOnce([]);
    const first = w.refresh();
    await w.refresh();
    old.resolve([request()]);
    await first;
    expect(w.state.requests).toEqual([]);
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
      definition: {
        ...r.definition,
        nodes: [
          ...r.definition.nodes.slice(0, -1),
          {
            id: "later",
            type: "approval",
            name: "Later Bob step",
            assigneeId: "bob",
          },
          r.definition.nodes.at(-1)!,
        ],
      },
    };
  }
  it("refresh cannot carry a prior step decision to a later step assigned to the same actor", async () => {
    const { api, w, r } = setup();
    await w.login("bob", "valid");
    w.route("r1");
    w.compose("REJECT");
    w.state.comment = "Only intended for team";
    api.request.mockResolvedValue([nextStep(r)] as never);
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
    await w.login("bob", "valid");
    w.route("r1");
    w.compose("APPROVE");
    w.state.comment = "Only first stage";
    api.request
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce([nextStep(r)] as never);
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
