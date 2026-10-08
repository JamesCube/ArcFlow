import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import Workspace from "../src/components/Workspace.vue";
import { ApiError } from "../src/domain/api";
import type { Api } from "../src/domain/types";
import { request } from "./fixtures";
function setup(
  options: {
    failList?: boolean;
    provider?: "feishu-web" | "unknown";
    task?: string;
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
      return [r];
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
    .mockResolvedValueOnce([request()] as never);
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
