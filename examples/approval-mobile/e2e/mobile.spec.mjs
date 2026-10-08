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
async function login(page, actor = "bob") {
  await page.getByRole("button", { name: actor[0].toUpperCase() + actor.slice(1), exact: true }).click();
  await page.getByLabel("本地配置的密码").fill(passwords[actor]);
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
  await page.getByLabel("搜索已载入的标题、原因或申请人").fill(r.title);
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
  await expect(page.getByLabel("搜索已载入的标题、原因或申请人")).toHaveValue(r.title);
  await page.goBack();
  await expect(page.locator(".detail-title")).toHaveText(r.title);
  await page.goForward();
  await expect(page.getByLabel("搜索已载入的标题、原因或申请人")).toHaveValue(r.title);
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

// Synthetic document creation is confined to this test fixture. The shipped H5
// transport intentionally cannot POST /documents or /requests.
async function seedDocument(processVersion, business) {
  return api("alice", "/documents", { processVersion, business });
}
const procurementCopy = {
  zh: {
    type: "采购申请", total: "采购总额", reference: "业务单号", quantity: "数量",
    reason: "采购事由", leave: "请假时长", approve: "同意", note: "审批意见（选填）",
    confirm: "确认提交", back: "返回列表", search: "搜索已载入的标题、原因或申请人",
    done: "我已处理", empty: "这里暂时没有申请", saved: "你的审批决定已保存",
    status: "已通过", refresh: "刷新", history: "审批记录",
  },
  en: {
    type: "Procurement request", total: "Procurement total", reference: "Business reference", quantity: "Quantity",
    reason: "Business reason", leave: "Leave duration", approve: "Approve", note: "Decision note (optional)",
    confirm: "Submit decision", back: "Back to list", search: "Search loaded titles, reasons or applicants",
    done: "My decisions", empty: "No matching requests", saved: "Your decision has been saved",
    status: "Approved", refresh: "Refresh", history: "Decision history",
  },
};
for (const locale of ["zh", "en"]) {
  test(`typed procurement ${locale}: exact summary, read-only review, keyboard, history and empty states`, async ({ page }, testInfo) => {
    const label = procurementCopy[locale];
    const legacy = await seed("ANY", `Mixed legacy leave ${locale}`);
    const business = {
      type: "procurement", businessId: `PO-MOBILE-2026-${locale}`,
      title: "工位设备采购 · Workspace equipment", reason: "Synthetic review only. 用于移动端采购审批验收。",
      item: "人体工学椅 / Ergonomic chair", quantity: 3, unitPrice: 199.99, currency: "CNY",
    };
    const purchase = await seedDocument(legacy.processVersion, business);
    const leave = await seedDocument(legacy.processVersion, {
      type: "leave", businessId: `LEAVE-MOBILE-${locale}`, title: `Mixed typed leave ${locale}`,
      reason: "Synthetic typed leave", days: 2,
    });
    const mobileWrites = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/")) mobileWrites.push(new URL(request.url()).pathname);
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await login(page);
    if (locale === "en") await page.getByRole("button", { name: "English", exact: true }).click();
    const search = page.getByLabel(label.search);
    await search.fill(business.businessId);
    const card = page.locator(".request-card");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(label.type);
    await expect(card).toContainText("CNY 599.97");
    await expect(card).not.toContainText(locale === "zh" ? "0 天" : "0 days");
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".detail-title")).toHaveText(purchase.title);
    await expect(page.getByRole("button", { name: label.refresh, exact: true })).toBeEnabled();
    await expect(page.locator(".amount-value")).toHaveText("CNY 599.97");
    await expect(page.locator(".procurement-detail")).toContainText(business.businessId);
    await expect(page.locator(".procurement-detail")).toContainText(business.item);
    await expect(page.locator(".procurement-detail")).toContainText("CNY 199.99");
    await expect(page.getByText(label.reason, { exact: true })).toBeVisible();
    await expect(page.getByText(label.leave, { exact: true })).toHaveCount(0);
    await expect(page.locator("input, textarea, select")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`procurement-${locale}-detail-390.png`), fullPage: true });
    await page.screenshot({ path: testInfo.outputPath(`procurement-${locale}-dock-390.png`) });
    for (let pass = 0; pass < 2; pass++) {
      const approve = page.getByRole("button", { name: label.approve, exact: true });
      await approve.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByLabel(label.note)).toBeFocused();
      await expect(page.getByRole("dialog")).toContainText("CNY 599.97");
      await page.getByLabel(label.note).fill("Unsubmitted synthetic note");
      await page.keyboard.press("Tab");
      await expect(page.locator(".dialog-actions .secondary")).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(page.getByLabel(label.note)).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(approve).toBeFocused();
      await page.getByRole("button", { name: label.back }).click();
      await expect(search).toHaveValue(business.businessId);
      await page.goBack();
      await expect(page.locator(".detail-title")).toHaveText(purchase.title);
      await page.goForward();
      await expect(search).toHaveValue(business.businessId);
      await page.locator(".request-card").click();
      await expect(page.getByRole("button", { name: label.approve, exact: true })).toBeEnabled();
    }
    expect(mobileWrites).toEqual([]);
    await page.getByRole("button", { name: label.approve, exact: true }).click();
    const decisionNote = `Synthetic procurement approved · ${locale}`;
    await page.getByLabel(label.note).fill(decisionNote);
    await page.getByRole("button", { name: label.confirm, exact: true }).click();
    await expect(page.getByText(label.saved, { exact: true })).toBeVisible();
    await expect(page.locator(".detail-hero .status")).toHaveText(label.status);
    await expect(page.locator(".history-section")).toContainText(decisionNote);
    await expect(page.locator(".action-dock")).toHaveCount(0);
    expect(mobileWrites).toEqual([`/api/requests/${purchase.id}/decisions`]);
    const saved = (await api("alice", "/requests")).find((item) => item.id === purchase.id);
    expect(saved.business).toEqual(purchase.business);
    expect(saved.history.filter((event) => event.actorId === "bob")).toHaveLength(1);
    const replay = await api("bob", `/requests/${purchase.id}/decisions`, {
      stepId: "team", decision: "APPROVE", comment: decisionNote,
    });
    expect(replay.history).toEqual(saved.history);
    await page.screenshot({ path: testInfo.outputPath(`procurement-${locale}-history-390.png`), fullPage: true });
    await page.getByRole("button", { name: label.back }).click();
    await page.getByRole("tab", { name: label.done, exact: true }).click();
    await expect(page.locator(".request-card")).toHaveCount(1);
    await expect(page.locator(".request-card")).toContainText("CNY 599.97");
    await page.screenshot({ path: testInfo.outputPath(`procurement-${locale}-decisions-390.png`) });
    await search.fill(`NO-MATCH-${purchase.id}`);
    await expect(page.getByRole("heading", { name: label.empty })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`procurement-${locale}-empty-390.png`) });
    // Typed and legacy leave coexist without a procurement total or invented ID.
    await page.goto(`/?task=${leave.id}`);
    await login(page);
    await expect(page.locator(".duration-value")).toHaveText("2");
    await expect(page.locator(".business-reference")).toHaveText(leave.business.businessId);
    await expect(page.locator(".amount-block")).toHaveCount(0);
    await page.goto(`/?task=${legacy.id}`);
    await login(page);
    await expect(page.locator(".duration-value")).toHaveText("3");
    await expect(page.locator(".business-reference")).toHaveCount(0);
    expect(mobileWrites.every((path) => path.endsWith("/decisions"))).toBe(true);
  });
}

test("maximum JPY procurement stays exact and wraps at 390px", async ({ page }, testInfo) => {
  const legacy = await seed("ANY", "JPY fixture process");
  const purchase = await seedDocument(legacy.processVersion, {
    type: "procurement", businessId: "PO-JPY-" + "A".repeat(100),
    title: "Synthetic maximum JPY document", reason: "Boundary values, no actual order or payment.",
    item: "Long synthetic equipment specification ".repeat(5), quantity: 100000, unitPrice: 1000000000, currency: "JPY",
  });
  await page.goto(`/?task=${purchase.id}`);
  await login(page);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator(".amount-value")).toHaveText("JPY 100,000,000,000,000");
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("procurement-jpy-maximum-390.png"), fullPage: true });
});

test("member paging keeps later-page procurement immutable after a non-first member's partial ALL vote", async ({ page }) => {
  test.setTimeout(120_000);
  // Publish a new version so earlier tests cannot fill or contaminate these pages.
  const legacy = await seed("ALL", "Mobile paging · oldest legacy leave");
  const purchase = await seedDocument(legacy.processVersion, {
    type: "procurement", businessId: `PO-MOBILE-PAGE-v${legacy.processVersion}`,
    title: "Mobile paging · later-page procurement", reason: "Synthetic paging review only.",
    item: "Ergonomic chair", quantity: 3, unitPrice: 199.99, currency: "CNY",
  });
  const newer = [];
  for (let index = 1; index <= 25; index++) {
    newer.push(await api("alice", "/requests", {
      title: `Mobile paging · newer leave ${index}`, reason: "Synthetic page boundary fixture.",
      days: 1, processVersion: legacy.processVersion,
    }));
  }
  expect(purchase.approverId).toBe("bob");
  expect(purchase.definition.nodes.find((node) => node.id === "team").assigneeIds).toEqual(["bob", "carol"]);

  // Observe real filtered HTTP replies; no successful response is mocked.
  async function pendingPage(cursor, action) {
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET" && url.pathname === "/api/requests/inbox" &&
        url.searchParams.get("box") === "PENDING" && url.searchParams.get("limit") === "25" &&
        url.searchParams.get("status") === "PENDING" &&
        url.searchParams.get("processVersion") === String(legacy.processVersion) &&
        url.searchParams.get("cursor") === cursor;
    });
    await action();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    return response.json();
  }
  await page.goto("/");
  await login(page, "carol");
  await expect(page.locator(".identity-bar")).toContainText("Carol");
  await page.getByLabel("流程版本（选填）").fill(String(legacy.processVersion));
  const first = await pendingPage(null, () => page.getByLabel("申请状态", { exact: true }).selectOption("PENDING"));
  expect(first.items.map((item) => item.id)).toEqual([...newer].reverse().map((item) => item.id));
  expect(first.items.every((item) => item.processVersion === legacy.processVersion && item.status === "PENDING")).toBe(true);
  expect(first.nextCursor).toEqual(expect.any(String));
  expect(first.nextCursor.length).toBeGreaterThan(0);
  await expect(page.locator(".request-card .request-title")).toHaveText([...newer].reverse().map((item) => item.title));
  await expect(page.locator(".count-orbit")).toContainText("25+");

  const search = page.getByLabel("搜索已载入的标题、原因或申请人");
  const more = page.getByRole("button", { name: "加载更多", exact: true });
  const refresh = page.getByRole("button", { name: "刷新", exact: true });
  await search.fill(purchase.business.businessId);
  await expect(page.locator(".request-card")).toHaveCount(0);
  await expect(page.getByText("搜索仅覆盖已载入的申请。继续加载可查看更多结果。", { exact: true })).toBeVisible();
  const second = await pendingPage(first.nextCursor, () => more.click());
  expect(second.items).toEqual([purchase, legacy]);
  expect(second.nextCursor).toBeNull();
  await expect(page.locator(".request-card")).toHaveCount(1);
  await expect(page.locator(".request-card")).toContainText("CNY 599.97");
  await expect(page.locator(".request-card .type-label")).toHaveText("采购申请");
  await expect(more).toHaveCount(0);

  const refreshed = await pendingPage(null, () => refresh.click());
  expect(refreshed).toEqual(first);
  await expect(search).toHaveValue(purchase.business.businessId);
  await expect(page.locator(".request-card")).toHaveCount(0);
  const reloaded = await pendingPage(refreshed.nextCursor, () => more.click());
  expect(reloaded).toEqual(second);
  await page.locator(".request-card").click();
  await expect(page.locator(".detail-title")).toHaveText(purchase.title);
  await expect(refresh).toBeEnabled();
  await expect(page.locator(".amount-value")).toHaveText("CNY 599.97");
  await expect(page.locator(".procurement-detail .business-value")).toHaveText([
    purchase.business.businessId, "Ergonomic chair", "3", "CNY 199.99", "CNY",
  ]);
  await expect(page.locator("input, textarea, select")).toHaveCount(0);

  await page.getByRole("button", { name: "同意", exact: true }).click();
  const comment = "Carol's partial ALL vote on the later-page procurement";
  await page.getByLabel("审批意见（选填）").fill(comment);
  const afterVote = await pendingPage(null, () => page.getByRole("button", { name: "确认提交", exact: true }).click());
  // Only the older purchase leaves this inbox; the newest 25 and their cursor stay unchanged.
  expect(afterVote).toEqual(first);
  await expect(page.getByText("你的审批决定已保存", { exact: true })).toBeVisible();
  await expect(refresh).toBeEnabled();
  await expect(page.locator(".detail-hero .status")).toHaveText("审批中");
  await expect(page.locator(".action-dock")).toHaveCount(0);
  await expect(page.locator(".history-section")).toContainText(comment);
  const handled = await api("carol", `/requests/inbox?box=HANDLED&limit=25&status=PENDING&processVersion=${legacy.processVersion}`);
  expect(handled.items).toHaveLength(1);
  expect(handled.nextCursor).toBeNull();
  const saved = handled.items[0];
  expect(saved.id).toBe(purchase.id);
  expect(saved.status).toBe("PENDING");
  expect(saved.currentStepId).toBe("team");
  expect(saved.business).toEqual(purchase.business);
  expect(saved.definition).toEqual(purchase.definition);
  expect(saved.createdAt).toBe(purchase.createdAt);
  expect(saved.history.slice(0, purchase.history.length)).toEqual(purchase.history);
  expect(saved.history.slice(purchase.history.length)).toEqual([
    expect.objectContaining({ actorId: "carol", stepId: "team", action: "APPROVE", comment }),
  ]);

  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await expect(search).toHaveValue(purchase.business.businessId);
  const remaining = await pendingPage(afterVote.nextCursor, () => more.click());
  expect(remaining.items.map((item) => item.id)).toEqual([legacy.id]);
  expect(remaining.nextCursor).toBeNull();
  await expect(page.locator(".request-card")).toHaveCount(0);
  await page.getByRole("tab", { name: "我已处理", exact: true }).click();
  await expect(page.getByLabel("申请状态", { exact: true })).toHaveValue("PENDING");
  await expect(page.getByLabel("流程版本（选填）")).toHaveValue(String(legacy.processVersion));
  await expect(page.locator(".request-card")).toHaveCount(1);
  await expect(page.locator(".request-card .request-title")).toHaveText(purchase.title);
  await expect(page.locator(".request-card .status")).toHaveText("审批中");
  await expect(page.locator(".request-card")).toContainText("CNY 599.97");

  await page.locator(".request-card").click();
  await expect(page.locator(".detail-title")).toHaveText(purchase.title);
  await expect(refresh).toBeEnabled();
  await page.goBack();
  await expect(page.getByRole("tab", { name: "我已处理", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(search).toHaveValue(purchase.business.businessId);
  const signedOutRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) signedOutRequests.push(request.url());
  });
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await expect(page.getByLabel("本地配置的密码")).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL((url) => url.searchParams.get("task") === purchase.id);
  await expect(page.getByLabel("本地配置的密码")).toBeVisible();
  await expect(page.locator(".request-card, .detail-title, .action-dock")).toHaveCount(0);
  expect(signedOutRequests).toEqual([]);
});
