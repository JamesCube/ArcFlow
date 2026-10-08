import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import Workspace from "../src/components/Workspace.vue";
import { ApiError } from "../src/domain/api";
import type { Api, Request } from "../src/domain/types";
import { request, listResponse } from "./fixtures";
function setup(
  options: {
    failList?: boolean;
    provider?: "feishu-web" | "unknown";
    task?: string;
    requests?: Request[];
  } = {},
) {
  let id = options.task || "",
    listener = () => {};
  const route = {
    read: () => id,
    open: (next: string) => {
      id = next;
      listener();
    },
    close: () => {
      id = "";
      listener();
    },
    subscribe: (next: () => void) => {
      listener = next;
      return () => {};
    },
  };
  const r = request();
  const api = {
    login: vi.fn(),
    logout: vi.fn(),
    request: vi.fn(async (path: string) => {
      if (path === "/me") return { id: "bob", displayName: "Bob" };
      if (path === "/people")
        return [
          { id: "alice", displayName: "Alice" },
          { id: "bob", displayName: "Bob" },
          { id: "carol", displayName: "Carol" },
        ];
      if (options.failList) throw new ApiError(503);
      return listResponse(path, options.requests || [r]);
    }),
  };
  const wrapper = mount(Workspace, {
    props: { api: api as Api, route, provider: options.provider },
    attachTo: document.body,
  });
  return { wrapper, api, route };
}
async function login(wrapper: ReturnType<typeof setup>["wrapper"]) {
  await wrapper.get("input[type=password]").setValue("local-test-password");
  await wrapper.get(".login-submit").trigger("click");
  await flushPromises();
}
beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  document.body.innerHTML = "";
});
describe("H5 native controls and view states (DOM tests, not browser acceptance)", () => {
  it("uses a real password field and native submit button with labels", async () => {
    const { wrapper } = setup();
    expect(wrapper.get("#demo-password").element.tagName).toBe("INPUT");
    expect(wrapper.get("#demo-password").attributes("type")).toBe("password");
    expect(wrapper.get("label").attributes("for")).toBe("demo-password");
    expect(wrapper.get(".login-submit").element.tagName).toBe("BUTTON");
    await login(wrapper);
    expect(wrapper.find(".request-card").exists()).toBe(true);
    wrapper.unmount();
  });
  it("has matching English/Chinese runtime states and no missing labels", async () => {
    const { wrapper } = setup();
    await wrapper.get(".language").trigger("click");
    expect(wrapper.text()).toContain("Review requests on your phone.");
    await login(wrapper);
    expect(wrapper.text()).toContain("To review");
    expect(wrapper.text()).toContain("Local H5 demo");
    wrapper.unmount();
  });
  it("cannot show a confident empty inbox after the first read fails", async () => {
    const { wrapper } = setup({ failList: true });
    await login(wrapper);
    expect(wrapper.text()).toContain("未能加载完整的申请列表");
    expect(wrapper.text()).not.toContain("当前没有待你审批的申请");
    wrapper.unmount();
  });
  for (const provider of ["feishu-web", "unknown"] as const)
    it(`${provider} blocks demo login instead of silently impersonating`, () => {
      const { wrapper, api } = setup({ provider });
      expect(wrapper.text()).toContain("PROVIDER_NOT_CONFIGURED");
      expect(wrapper.find("input").exists()).toBe(false);
      expect(api.request).not.toHaveBeenCalled();
      wrapper.unmount();
    });
  it("opens a deep link only after login and restores it after reload sign-in", async () => {
    const one = setup({ task: "r1" });
    expect(one.wrapper.text()).not.toContain("Quarterly planning leave");
    await login(one.wrapper);
    expect(one.wrapper.text()).toContain("Quarterly planning leave");
    expect(one.wrapper.find(".detail-hero").exists()).toBe(true);
    one.wrapper.unmount();
    const two = setup({ task: "r1" });
    expect(two.wrapper.find("input[type=password]").exists()).toBe(true);
    await login(two.wrapper);
    expect(two.wrapper.find(".detail-hero").exists()).toBe(true);
    two.wrapper.unmount();
  });
  it("dialog uses keyboard-native controls, labelled textarea and Escape cancellation without POST", async () => {
    const { wrapper, api } = setup({ task: "r1" });
    await login(wrapper);
    await wrapper.get(".action-dock .primary").trigger("click");
    await flushPromises();
    const textarea = wrapper.get("textarea");
    expect(textarea.attributes("id")).toBe("decision-comment");
    expect(textarea.attributes("aria-label")).toBe("审批意见（选填）");
    expect(document.activeElement).toBe(textarea.element);
    expect(wrapper.findAll(".decision-dialog button")).toHaveLength(3);
    await textarea.setValue("Draft only");
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    expect(wrapper.find("[role=dialog]").exists()).toBe(false);
    expect(
      api.request.mock.calls.some((call) => call[0].endsWith("decisions")),
    ).toBe(false);
    wrapper.unmount();
  });
  it("keeps list search when opening a task and going back", async () => {
    const { wrapper } = setup();
    await login(wrapper);
    await wrapper.get(".search-input").setValue("planning");
    await wrapper.get(".request-card").trigger("click");
    await flushPromises();
    await wrapper.get(".back").trigger("click");
    await flushPromises();
    expect(
      (wrapper.get(".search-input").element as HTMLInputElement).value,
    ).toBe("planning");
    expect(wrapper.find(".request-card").exists()).toBe(true);
    wrapper.unmount();
  });
});

it("traps reverse Tab when focus remains on the dialog after a failed write", async () => {
  const { wrapper, api } = setup({ task: "r1" });
  await login(wrapper);
  await wrapper.get(".action-dock .primary").trigger("click");
  await flushPromises();
  api.request
    .mockRejectedValueOnce(new Error("lost"))
    .mockImplementation(async (path) => listResponse(path, [request()]) as never);
  await wrapper.get(".dialog-actions .primary").trigger("click");
  await flushPromises();
  const dialog = wrapper.get(".decision-dialog");
  (dialog.element as HTMLElement).focus();
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(
    wrapper.get(".dialog-actions .primary").element,
  );
  wrapper.unmount();
});

function procurement(): Request {
  const common = { title: "Synthetic equipment", reason: "Synthetic procurement only" };
  return request({
    id: "po1", ...common, days: 0,
    business: { type: "procurement", businessId: "PO-2026-001", ...common,
      item: "Ergonomic chair", quantity: 3, unitPrice: "199.99", currency: "CNY" },
  });
}

it("renders mixed typed procurement, typed leave and legacy leave with exact summaries", async () => {
  const legacy = request();
  const typed = request({ id: "l2", days: 2,
    business: { type: "leave", businessId: "LEAVE-002", title: legacy.title, reason: legacy.reason, days: 2 },
  });
  const { wrapper } = setup({ requests: [procurement(), typed, legacy] });
  await login(wrapper);
  const cards = wrapper.findAll(".request-card");
  expect(cards).toHaveLength(3);
  expect(cards[0].text()).toContain("采购申请");
  expect(cards[0].text()).toContain("CNY 599.97");
  expect(cards[0].text()).toContain("PO-2026-001");
  expect(cards[0].text()).not.toContain("0 天");
  expect(cards[1].text()).toContain("2 天");
  expect(cards[1].text()).toContain("LEAVE-002");
  expect(cards[2].text()).toContain("3 天");
  expect(cards[2].find(".card-business-id").exists()).toBe(false);
  await wrapper.get(".search-input").setValue("PO-2026");
  expect(wrapper.findAll(".request-card")).toHaveLength(1);
  await wrapper.get(".search-input").setValue("ergonomic");
  expect(wrapper.findAll(".request-card")).toHaveLength(1);
  wrapper.unmount();
});

it("keeps procurement detail bilingual and read-only with exact financial labels", async () => {
  const { wrapper, api } = setup({ task: "po1", requests: [procurement()] });
  await login(wrapper);
  expect(wrapper.get(".detail-hero .type-label").text()).toBe("采购申请");
  expect(wrapper.get(".amount-value").text()).toBe("CNY 599.97");
  expect(wrapper.get(".business-fields").text()).toContain("CNY 199.99");
  expect(wrapper.get(".business-fields").text()).toContain("Ergonomic chair");
  expect(wrapper.get(".business-fields").text()).toContain("PO-2026-001");
  expect(wrapper.find(".duration-block").exists()).toBe(false);
  expect(wrapper.find("input, textarea, select").exists()).toBe(false);
  expect(wrapper.text()).toContain("采购事由");
  await wrapper.get(".language").trigger("click");
  expect(wrapper.text()).toContain("Procurement request");
  expect(wrapper.text()).toContain("Procurement total");
  expect(wrapper.text()).toContain("Business reference");
  expect(wrapper.text()).toContain("Unit price");
  expect(wrapper.text()).toContain("Currency");
  expect(wrapper.text()).toContain("Business reason");
  expect(wrapper.text()).not.toContain("Leave duration");
  await wrapper.get(".action-dock .primary").trigger("click");
  await flushPromises();
  expect(wrapper.get(".decision-business").text()).toBe("PO-2026-001 · CNY 599.97");
  expect(wrapper.findAll("input, textarea, select")).toHaveLength(1);
  expect(wrapper.get("textarea").attributes("id")).toBe("decision-comment");
  expect(api.request.mock.calls.every(([path]) => ["/me", "/people", "/requests"].includes(path) || path.startsWith("/requests/inbox?"))).toBe(true);
  wrapper.unmount();
});

it("shows typed leave reference while preserving the legacy leave view", async () => {
  const leave = request();
  const typed = request({ business: { type: "leave", businessId: "LEAVE-001", title: leave.title, reason: leave.reason, days: leave.days } });
  const { wrapper } = setup({ task: "r1", requests: [typed] });
  await login(wrapper);
  expect(wrapper.get(".duration-value").text()).toBe("3");
  expect(wrapper.get(".business-reference").text()).toBe("LEAVE-001");
  expect(wrapper.find(".amount-block").exists()).toBe(false);
  expect(wrapper.text()).toContain("请假申请");
  wrapper.unmount();
});

describe("member inbox pagination controls", () => {
  it("labels loaded-only search/counts and can load another page after zero local matches", async () => {
    const { wrapper, api } = setup();
    const original = api.request.getMockImplementation()!;
    api.request.mockImplementation(async (path) => {
      if (path === "/requests") return [request(), request({ id: "r2", title: "Later result" })];
      if (path.includes("box=PENDING")) return path.includes("cursor=")
        ? { items: [request({ id: "r2", title: "Later result" })], nextCursor: null } as never
        : { items: [request()], nextCursor: "next" } as never;
      return original(path);
    });
    await wrapper.get(".language").trigger("click");
    await login(wrapper);
    expect(wrapper.text()).toContain("Loaded to review");
    expect(wrapper.text()).toContain("matching loaded requests");
    expect(wrapper.text()).toContain("Search covers loaded requests only");
    expect(wrapper.text()).toContain("Filters apply to both inboxes");
    expect(wrapper.get(".count-orbit").text()).toContain("1+");
    await wrapper.get(".search-input").setValue("Later");
    expect(wrapper.find(".request-card").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("You’re all caught up");
    await wrapper.get(".load-more").trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".request-card")).toHaveLength(1);
    expect(wrapper.text()).toContain("Later result");
    expect(wrapper.find(".load-more").exists()).toBe(false);
    expect(wrapper.text()).toContain("End of this read");
    const inboxCalls = api.request.mock.calls.filter(([path]) => path.startsWith("/requests/inbox")).length;
    await wrapper.get(".request-card").trigger("click");
    await flushPromises();
    expect(wrapper.find(".detail-hero").exists()).toBe(true);
    await wrapper.get(".back").trigger("click");
    await flushPromises();
    expect(wrapper.get(".request-card").text()).toContain("Later result");
    expect(api.request.mock.calls.filter(([path]) => path.startsWith("/requests/inbox"))).toHaveLength(inboxCalls);
    wrapper.unmount();
  });
  it("uses native labeled filters, blocks malformed versions and resets both boxes", async () => {
    const { wrapper, api } = setup();
    await login(wrapper);
    expect(wrapper.get("label[for=inbox-status]").text()).toBe("申请状态");
    expect(wrapper.get("#inbox-status").element.tagName).toBe("SELECT");
    await wrapper.get("#inbox-version").setValue("1.5");
    const before = api.request.mock.calls.length;
    await wrapper.get(".filter-version-row button").trigger("click");
    await flushPromises();
    expect(api.request).toHaveBeenCalledTimes(before);
    expect(wrapper.text()).toContain("流程版本须为");
    await wrapper.get("#inbox-version").setValue("2");
    await wrapper.get("#inbox-status").setValue("APPROVED");
    await flushPromises();
    expect(api.request.mock.calls.slice(-2).map(([path]) => path)).toEqual([
      "/requests/inbox?box=PENDING&limit=25&status=APPROVED&processVersion=2",
      "/requests/inbox?box=HANDLED&limit=25&status=APPROVED&processVersion=2",
    ]);
    expect(wrapper.text()).not.toContain("当前没有待你审批的申请");
    wrapper.unmount();
  });
  it("retains list rows and offers retry after a continuation failure", async () => {
    const { wrapper, api } = setup();
    const original = api.request.getMockImplementation()!;
    api.request.mockImplementation(async (path) => {
      if (path.includes("box=PENDING")) {
        if (path.includes("cursor=")) throw new ApiError(503);
        return { items: [request()], nextCursor: "next" } as never;
      }
      return original(path);
    });
    await login(wrapper);
    await wrapper.get(".load-more").trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".request-card")).toHaveLength(1);
    expect(wrapper.text()).toContain("已有结果已保留");
    expect(wrapper.get(".load-more").attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });
});
