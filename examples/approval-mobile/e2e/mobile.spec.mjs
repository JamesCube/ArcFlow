import { test, expect, request as playwrightRequest } from "@playwright/test";
// Authored acceptance only until explicitly run. Uses real API and an isolated local demo.
const allowed = process.env.ARCFLOW_E2E_CONFIRM_DISPOSABLE === "yes";
const origin = process.env.ARCFLOW_MOBILE_URL || "http://127.0.0.1:5174";
const passwords = Object.fromEntries(
  ["alice", "bob", "carol"].map((id) => [
    id,
    process.env[`APPROVAL_${id.toUpperCase()}_PASSWORD`],
  ]),
);
test.beforeAll(() => {
  if (!allowed || Object.values(passwords).some((value) => !value))
    throw new Error(
      "Set disposable-demo confirmation and all three locally configured test passwords before running browser tests.",
    );
});
async function api(actor, path, data) {
  const context = await playwrightRequest.newContext({
    baseURL: origin,
    extraHTTPHeaders: {
      Authorization: `Basic ${Buffer.from(`${actor}:${passwords[actor]}`).toString("base64")}`,
      "X-Arcflow-Client": "approval-demo",
      Origin: origin,
    },
  });
  try {
    const response =
      data === undefined
        ? await context.get(`/api${path}`)
        : await context.post(`/api${path}`, { data });
    expect(response.ok()).toBe(true);
    return await response.json();
  } finally {
    await context.dispose();
  }
}
async function seed(mode, title) {
  const p = await api("alice", "/process");
  const definition = {
    schemaVersion: 3,
    id: p.id,
    version: p.version,
    name: "Mobile verification",
    nodes: [
      { id: "start", type: "start", name: "发起申请", assigneeId: null },
      {
        id: "team",
        type: "parallelApproval",
        name: "团队审批",
        assigneeId: null,
        assigneeIds: ["bob", "carol"],
        completionMode: mode,
      },
      { id: "end", type: "end", name: "完成", assigneeId: null },
    ],
  };
  const published = await api("alice", "/process", {
    expectedVersion: p.version,
    definition,
  });
  return api("alice", "/requests", {
    title,
    reason: "Synthetic mobile verification only.\n用于移动界面验收的合成申请。",
    days: 3,
    processVersion: published.version,
  });
}
async function login(page) {
  await page.getByLabel("本地配置的密码").fill(passwords.bob);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.getByRole("button", { name: "退出" })).toBeVisible();
}
async function screenshot(page, testInfo, name) {
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: name.startsWith("completed"),
  });
}
test("real ALL vote, decision note, cancel, back, durable history and reload", async ({
  page,
}, testInfo) => {
  const r = await seed("ALL", "年度计划 · 移动审批验证");
  await page.goto("/");
  await login(page);
  await page.getByLabel("搜索标题、原因或申请人").fill(r.title);
  await expect(
    page.getByRole("button", { name: new RegExp(r.title) }),
  ).toBeVisible();
  await screenshot(page, testInfo, "inbox-390");
  await page.getByRole("button", { name: new RegExp(r.title) }).click();
  await expect(page.locator(".detail-title")).toHaveText(r.title);
  await page.getByRole("button", { name: "驳回", exact: true }).click();
  await page.getByLabel("审批意见（选填）").fill("Unsaved");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "返回列表" }).click();
  await expect(page.getByLabel("搜索标题、原因或申请人")).toHaveValue(r.title);
  await page.goBack();
  await expect(page.locator(".detail-title")).toHaveText(r.title);
  await page.goForward();
  await expect(page.getByLabel("搜索标题、原因或申请人")).toHaveValue(r.title);
  await page.getByRole("button", { name: new RegExp(r.title) }).click();
  await expect(
    page.getByRole("button", { name: "刷新", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".action-dock")).toBeVisible();
  await screenshot(page, testInfo, "detail-390");
  await page.getByRole("button", { name: "同意", exact: true }).click();
  await expect(page.getByLabel("审批意见（选填）")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".dialog-actions .secondary")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".dialog-actions .primary")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".decision-dialog .icon-button")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".dialog-actions .primary")).toBeFocused();
  await page.getByLabel("审批意见（选填）").fill("同意。阶段意见只记录一次。");
  await screenshot(page, testInfo, "decision-390");
  await page.getByRole("button", { name: "确认提交" }).click();
  await expect(page.getByText("你的审批决定已保存")).toBeVisible();
  await expect(page.locator(".detail-hero .status")).toHaveText("审批中");
  let saved = (await api("alice", "/requests")).find((x) => x.id === r.id);
  expect(saved.history.filter((x) => x.actorId === "bob")).toHaveLength(1);
  expect(saved.history.at(-1).comment).toBe("同意。阶段意见只记录一次。");
  await api("carol", `/requests/${r.id}/decisions`, {
    stepId: "team",
    decision: "APPROVE",
    comment: "Second vote",
  });
  await page.reload();
  await login(page);
  await expect(page.locator(".detail-hero .status")).toHaveText("已通过");
  await expect(page.locator(".action-dock")).toHaveCount(0);
  await screenshot(page, testInfo, "completed-390");
});
test("ANY rejection remains pending until another member approves", async ({
  page,
}) => {
  const r = await seed("ANY", "或签语义验证");
  await page.goto(`/?task=${r.id}`);
  await login(page);
  await page.getByRole("button", { name: "驳回", exact: true }).click();
  await expect(
    page.getByText(
      "或签：任一成员同意即进入下一节点；只有所有成员驳回才结束申请。",
    ),
  ).toBeVisible();
  await page.getByLabel("审批意见（选填）").fill("第一位成员驳回");
  await page.getByRole("button", { name: "确认提交" }).click();
  await expect(page.getByText("你的审批决定已保存")).toBeVisible();
  await expect(page.locator(".detail-hero .status")).toHaveText("审批中");
  await expect(page.locator(".action-dock")).toHaveCount(0);
  const partial = (await api("alice", "/requests")).find((x) => x.id === r.id);
  expect(
    partial.history.filter((x) => x.actorId === "bob").map((x) => x.action),
  ).toEqual(["REJECT"]);
  await api("carol", `/requests/${r.id}/decisions`, {
    stepId: "team",
    decision: "APPROVE",
    comment: "",
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.locator(".detail-hero .status")).toHaveText("已通过");
});
test("network interruption gives no success and preserves the review note", async ({
  page,
}) => {
  const r = await seed("ALL", "网络中断验证");
  await page.goto(`/?task=${r.id}`);
  await login(page);
  await page.getByRole("button", { name: "同意", exact: true }).click();
  await page.getByLabel("审批意见（选填）").fill("Retain this note");
  await page.route("**/decisions", (route) => route.abort());
  await page.getByRole("button", { name: "确认提交" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "连接中断",
  );
  await expect(page.getByRole("button", { name: "确认提交" })).toBeEnabled();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("审批意见（选填）")).toHaveValue(
    "Retain this note",
  );
  expect(
    (await api("alice", "/requests")).find((x) => x.id === r.id).history,
  ).toHaveLength(1);
  await expect(page.getByText("你的审批决定已保存")).toHaveCount(0);
});
for (const width of [360, 390, 430])
  test(`actual H5 viewport ${width} has no horizontal overflow`, async ({
    page,
  }, testInfo) => {
    const r = await seed(
      "ALL",
      "移动端长标题与实际内容折行验证 · Quarterly planning and team handover",
    );
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/?task=${r.id}`);
    await login(page);
    await expect(page.locator(".detail-title")).toHaveText(r.title);
    await expect(
      page.getByRole("button", { name: "刷新", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await screenshot(page, testInfo, `detail-${width}`);
  });
test("unconfigured and unknown enterprise hosts never expose demo sign-in", async ({
  page,
}) => {
  for (const host of ["feishu-web", "wecom-web", "dingtalk-web", "invalid"]) {
    await page.goto(`/?host=${host}`);
    await expect(page.getByText("PROVIDER_NOT_CONFIGURED")).toBeVisible();
    await expect(page.locator("input[type=password]")).toHaveCount(0);
  }
});

test("English decision sheet reflows at 360px with native controls", async ({
  page,
}, testInfo) => {
  const r = await seed("ALL", "Quarterly planning and team handover");
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto(`/?task=${r.id}`);
  await login(page);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator(".detail-title")).toHaveText(r.title);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("All must approve");
  await expect(page.getByLabel("Decision note (optional)")).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Submit decision", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await screenshot(page, testInfo, "decision-en-360");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
