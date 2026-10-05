import { describe, it, expect, vi } from "vitest";
import { createApi, ApiError } from "../src/domain/api";
import {
  browserRoute,
  createHostAdapter,
  identityKey,
  requestedProvider,
} from "../src/platform/adapters";
import { copy } from "../src/copy";
describe("transport and fail-closed host boundaries", () => {
  it("uses explicit in-memory credentials, known endpoint and server-required CSRF header", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: "bob" }) });
    const api = createApi(fetcher);
    api.login("bob", "configured");
    await api.request("/me");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/me",
      expect.objectContaining({
        credentials: "omit",
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: `Basic ${btoa("bob:configured")}`,
          "X-Arcflow-Client": "approval-demo",
        }),
      }),
    );
    api.logout();
    await api.request("/me");
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe("");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
  it("does not expose arbitrary server text", async () => {
    const api = createApi(
      vi
        .fn()
        .mockResolvedValue({
          ok: false,
          status: 409,
          json: async () => ({ message: "secret token or HTML" }),
        }),
    );
    await expect(api.request("/requests")).rejects.toEqual(new ApiError(409));
  });
  it("rejects arbitrary API destinations before network activity", async () => {
    const fetcher = vi.fn();
    const api = createApi(fetcher);
    for (const path of [
      "https://example.com",
      "/process",
      "/requests/../../me",
      "//example.com",
    ])
      await expect(api.request(path)).rejects.toThrow("Unsupported endpoint");
    expect(fetcher).not.toHaveBeenCalled();
  });
  for (const provider of ["feishu-web", "wecom-web", "dingtalk-web"] as const)
    it(`${provider} never returns identity or sends notification when unconfigured`, async () => {
      const adapter = createHostAdapter(provider);
      expect(adapter.capabilities.identity).toBe("not-configured");
      expect(await adapter.getAuthGrant()).toEqual({
        ok: false,
        code: "PROVIDER_NOT_CONFIGURED",
      });
      expect(await adapter.sendNotification()).toEqual({
        ok: false,
        code: "PROVIDER_NOT_CONFIGURED",
      });
    });
  it("browser host does not claim enterprise capabilities", async () => {
    expect(await createHostAdapter("browser").getAuthGrant()).toEqual({
      ok: false,
      code: "CAPABILITY_UNSUPPORTED",
    });
    expect(requestedProvider("?host=feishu-web")).toBe("feishu-web");
    expect(requestedProvider("?host=https://evil")).toBe("unknown");
    expect(requestedProvider("?host=")).toBe("unknown");
    expect(requestedProvider("")).toBe("browser");
  });
  it("does not merge provider, tenant, application or subject scopes", () => {
    const id = {
      provider: "feishu-web" as const,
      externalTenantId: "a",
      applicationId: "b",
      externalUserId: "c",
    };
    expect(
      new Set([
        identityKey(id),
        identityKey({ ...id, provider: "wecom-web" }),
        identityKey({ ...id, externalTenantId: "a:b" }),
        identityKey({ ...id, applicationId: "b:c" }),
        identityKey({ ...id, externalUserId: "c:d" }),
      ]).size,
    ).toBe(5);
  });
  it("routes only opaque task IDs, preserving same-origin and login-independent deep links", () => {
    history.replaceState(null, "", "/?task=r1");
    const route = browserRoute();
    expect(route.read()).toBe("r1");
    const listener = vi.fn(),
      dispose = route.subscribe(listener);
    route.open("r2");
    expect(route.read()).toBe("r2");
    expect(listener).toHaveBeenCalledTimes(1);
    route.close();
    expect(route.read()).toBe("");
    history.replaceState(null, "", "/?task=https%3A%2F%2Fevil");
    expect(route.read()).toBe("");
    dispose();
    history.replaceState(null, "", "/");
  });
  it("provides identical bilingual UI and error keys", () => {
    expect(Object.keys(copy.zh).sort()).toEqual(Object.keys(copy.en).sort());
    expect(Object.keys(copy.zh.errors)).toEqual(Object.keys(copy.en.errors));
    for (const lang of Object.values(copy))
      for (const value of Object.values(lang))
        if (typeof value === "string") expect(value.length).toBeGreaterThan(0);
  });
});
