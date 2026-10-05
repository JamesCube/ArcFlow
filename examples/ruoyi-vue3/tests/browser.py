"""One native RuoYi Chromium journey against the real disposable CI server.

Serve the already-built official frontend on loopback with its normal /prod-api
proxy. No alternate login, synthetic tokens, API response mocks or auth traces.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import http.client
from pathlib import Path
import re
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect

ORIGIN = "http://127.0.0.1:5173"
WORKSPACE = ORIGIN + "/arcflow/approval"
TITLE = "Native RuoYi browser approval"
GROUP_TITLE = "Native RuoYi group approval"
ALL_STAGE = "All reviewers"
ANY_STAGE = "Any reviewer"


class Frontend(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Never persist request paths, headers, credentials or tokens.

    def do_GET(self):
        if self.path.startswith("/prod-api/"):
            return self.proxy()
        # History-mode navigation uses the same built index as the root route.
        if not Path(self.translate_path(urlsplit(self.path).path)).is_file():
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self):
        self.proxy()

    def proxy(self):
        if not self.path.startswith("/prod-api/"):
            self.send_error(404)
            return
        upstream = http.client.HTTPConnection("127.0.0.1", 8080, timeout=20)
        try:
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            headers = {k: v for k, v in self.headers.items()
                       if k.lower() not in ("host", "connection", "content-length")}
            upstream.request(self.command, self.path[len("/prod-api"):], body, headers)
            response = upstream.getresponse()
            content = response.read()
            self.send_response(response.status)
            self.send_header("Content-Type", response.getheader("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        finally:
            upstream.close()


def loaded(page, name):
    expect(page.get_by_role("heading", name="ArcFlow 请假审批", exact=True)).to_be_visible()
    expect(page.locator(".page-header")).to_contain_text("当前用户：CI " + name)
    expect(page.get_by_text("已加载最新数据。", exact=True)).to_be_visible()


def login(page, name, password):
    page.goto(ORIGIN + "/login")
    expect(page.get_by_placeholder("验证码", exact=True)).to_have_count(0)
    page.get_by_placeholder("账号", exact=True).fill("admin" if name == "admin" else "arcflow_" + name)
    try:
        page.get_by_placeholder("密码", exact=True).fill(password)
    except Exception:
        # Playwright action logs may echo fill values; never expose the CI password.
        raise AssertionError("Native password entry failed (details redacted)") from None
    page.get_by_role("button", name=re.compile(r"登\s*录$")).click()
    expect(page.locator(".sidebar-container")).to_be_visible()
    # Enter through the genuine database-generated RuoYi menu, never a substitute shell.
    sidebar = page.locator(".sidebar-container")
    sidebar.get_by_text("ArcFlow", exact=True).click()
    sidebar.get_by_text("审批工作台", exact=True).click()
    expect(page).to_have_url(WORKSPACE)
    expect(page.get_by_role("heading", name="ArcFlow 请假审批", exact=True)).to_be_visible()
    expect(page.get_by_text("已加载最新数据。", exact=True)).to_be_visible()
    if name != "admin":
        loaded(page, name)


def logout(page, cancel_first=False):
    page.locator(".avatar-wrapper").hover()
    page.get_by_text("退出登录", exact=True).click()
    dialog = page.get_by_role("dialog")
    if cancel_first:
        dialog.get_by_role("button", name="取消", exact=True).click()
        expect(dialog).not_to_be_visible()
        expect(page.get_by_role("heading", name="ArcFlow 请假审批", exact=True)).to_be_visible()
        page.locator(".avatar-wrapper").hover()
        page.get_by_text("退出登录", exact=True).click()
    dialog.get_by_role("button", name="确定", exact=True).click()
    expect(page).to_have_url(re.compile(r"/login(?:\?|$)"))
    page.goto(WORKSPACE)
    expect(page).to_have_url(re.compile(r"/login\?redirect="))
    expect(page.get_by_role("heading", name="ArcFlow 请假审批", exact=True)).to_have_count(0)


def request_row(page, title):
    return page.locator(".el-table__body-wrapper tr").filter(has_text=title)


def select_request(page, title=TITLE):
    request_row(page, title).click()
    expect(page.locator(".detail")).to_contain_text(title)


def native_data(page, path, action, method="POST"):
    """Observe a native UI request without changing its real server response."""
    with page.expect_response(lambda response: urlsplit(response.url).path == "/prod-api" + path
                              and response.request.method == method) as pending:
        action()
    response = pending.value
    assert response.status == 200, f"Native {method} {path} failed"
    value = response.json()
    assert value.get("code") == 200, f"Native {method} {path} returned an application error"
    return value["data"]


def open_select(page, label):
    # Element Plus renders selected text above a non-filterable readonly input.
    # Click its normal visible wrapper, not that covered accessibility input.
    combobox = page.get_by_role("combobox", name=label, exact=True)
    page.locator(".el-select__wrapper").filter(has=combobox).click()


def choose_option(page, label, option):
    open_select(page, label)
    page.get_by_role("listbox", name=label, exact=True).get_by_role(
        "option", name=option, exact=True).click()
    page.keyboard.press("Escape")


def snapshot_step(page, name):
    step = page.locator(".snapshot > li").filter(has=page.get_by_text(name, exact=True))
    expect(step).to_have_count(1)
    return step


def snapshot_vote(page, stage, actor, state):
    vote = snapshot_step(page, stage).locator(".participant-votes li").filter(has_text="CI " + actor)
    expect(vote).to_have_count(1)
    expect(vote).to_contain_text(state)


def group_current(page, current, later=None):
    expect(page.locator(".detail")).to_contain_text("审批中")
    step = snapshot_step(page, current)
    expect(step).to_contain_text("当前审批")
    # A participant's approval is not proof that the group has completed.
    expect(step).not_to_contain_text("已通过")
    if later:
        expect(snapshot_step(page, later)).to_contain_text("等待中")
        expect(snapshot_step(page, later)).not_to_contain_text("当前审批")
        expect(snapshot_step(page, later)).not_to_contain_text("已通过")


def persisted_request(page, name, expected, *, reload=False):
    action = page.reload if reload else lambda: page.get_by_role("button", name="刷新", exact=True).click()
    items = native_data(page, "/arcflow/requests", action, method="GET")
    loaded(page, name)
    assert next(item for item in items if item["id"] == expected["id"]) == expected, \
        "Native reload/refresh changed the persisted request or participant history"
    page.get_by_role("tab", name="我参与的申请", exact=True).click()
    select_request(page, GROUP_TITLE)


def decide_group(page, req, action):
    label = "投同意票" if action == "APPROVE" else "投拒绝票"
    updated = native_data(page, f"/arcflow/requests/{req['id']}/decisions",
                          lambda: page.get_by_role("button", name=label, exact=True).click())
    assert updated["definition"] == req["definition"], "A vote rewrote the submission's process snapshot"
    assert updated["history"][:-1] == req["history"], "A vote rewrote earlier participant votes"
    assert updated["history"][-1]["action"] == action
    assert updated["history"][-1]["stepId"] == req["currentStepId"]
    return updated


def no_group_inbox_item(page):
    page.get_by_role("tab", name=re.compile("待我审批")).click()
    expect(request_row(page, GROUP_TITLE)).to_have_count(0)
    expect(page.get_by_role("button", name="投同意票", exact=True)).to_have_count(0)
    expect(page.get_by_role("button", name="投拒绝票", exact=True)).to_have_count(0)


def screenshot(page, directory, name):
    expect(page.locator('input[type="password"]')).to_have_count(0)
    expect(page.get_by_role("heading", name="ArcFlow 请假审批", exact=True)).to_be_visible()
    page.screenshot(path=str(directory / name), full_page=True, animations="disabled")


def run(frontend_directory, output_directory, password):
    frontend_directory = frontend_directory.resolve()
    assert (frontend_directory / "index.html").is_file(), "Build the official frontend first"
    output_directory.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 5173), partial(Frontend, directory=str(frontend_directory)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(viewport={"width": 1440, "height": 1080}, locale="zh-CN")
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(error.message))
            page.set_default_timeout(15000)
            # HTTP smoke left a real two-step definition. Edit and publish it through native UI.
            login(page, "admin", password)
            page.get_by_role("tab", name="流程设计", exact=True).click()
            page.get_by_label("流程名称", exact=True).fill("Native browser two-step process")
            page.get_by_label("审批 1 名称", exact=True).fill("Team review")
            page.get_by_label("审批 2 名称", exact=True).fill("Final review")
            for step, actor in ((1, "first (101)"), (2, "second (102)")):
                page.get_by_role("combobox", name=f"审批 {step} 审批人", exact=True).click()
                page.get_by_role("listbox", name=f"审批 {step} 审批人", exact=True).get_by_role(
                    "option", name="CI " + actor, exact=True).click()
            sequential_definition = native_data(page, "/arcflow/process",
                lambda: page.get_by_role("button", name="发布新版本", exact=True).click())
            expect(page.get_by_text(re.compile(r"已发布版本 v\d+。"))).to_be_visible()
            expect(page.get_by_role("button", name="发布新版本", exact=True)).to_be_disabled()
            screenshot(page, output_directory, "01-native-process-editor.png")
            logout(page)

            login(page, "applicant", password)
            page.get_by_role("tab", name="流程设计", exact=True).click()
            expect(page.get_by_label("流程名称", exact=True)).to_be_disabled()
            expect(page.get_by_role("button", name="发布新版本", exact=True)).to_have_count(0)
            expect(page.get_by_text("当前账号仅可查看流程，发布需要流程管理权限。", exact=True)).to_be_visible()
            page.get_by_role("tab", name="我的申请", exact=True).click()
            page.get_by_label("标题", exact=True).fill(TITLE)
            page.get_by_label("原因", exact=True).fill("Synthetic CI browser journey; no personal information.")
            page.get_by_role("button", name=re.compile("提交申请 · v")).click()
            expect(page.get_by_text("申请已提交。", exact=True)).to_be_visible()
            expect(page.locator(".detail")).to_contain_text("CI first")
            expect(page.get_by_role("button", name="投同意票", exact=True)).to_have_count(0)
            page.reload()
            loaded(page, "applicant")
            select_request(page)
            expect(page.locator(".detail")).to_contain_text("审批中")
            logout(page, cancel_first=True)

            # Later assigned participant can see the snapshot but cannot decide early.
            login(page, "second", password)
            page.get_by_role("tab", name="我参与的申请", exact=True).click()
            select_request(page)
            expect(page.get_by_role("button", name="投同意票", exact=True)).to_have_count(0)
            logout(page)
            login(page, "first", password)
            page.get_by_role("tab", name=re.compile("待我审批")).click()
            select_request(page)
            page.get_by_role("button", name="投同意票", exact=True).click()
            expect(page.get_by_text("本节点已通过，已流转至下一审批人。", exact=True)).to_be_visible()
            expect(page.get_by_role("button", name="投同意票", exact=True)).to_have_count(0)
            logout(page)
            login(page, "second", password)
            page.get_by_role("tab", name=re.compile("待我审批")).click()
            select_request(page)
            page.get_by_role("button", name="投同意票", exact=True).click()
            expect(page.get_by_text("申请已通过。", exact=True)).to_be_visible()
            expect(page.locator(".el-timeline-item")).to_have_count(3)
            expect(page.locator(".el-timeline")).to_contain_text("CI applicant · 提交")
            expect(page.locator(".el-timeline")).to_contain_text("CI first · 通过 · Team review")
            expect(page.locator(".el-timeline")).to_contain_text("CI second · 通过 · Final review")
            expect(page.get_by_role("button", name="投同意票", exact=True)).to_have_count(0)
            screenshot(page, output_directory, "02-native-approved-history.png")
            # Authenticated direct navigation reloads the real router and session.
            page.goto(WORKSPACE)
            loaded(page, "second")
            page.get_by_role("tab", name="我参与的申请", exact=True).click()
            select_request(page)
            expect(page.locator(".detail")).to_contain_text("已通过")
            # Only this explicit transport failure is injected; no API response is mocked.
            page.route("**/prod-api/arcflow/requests", lambda route: route.abort("failed"))
            page.get_by_role("button", name="刷新", exact=True).click()
            expect(page.get_by_text("加载失败或无访问权限。请检查若依登录状态和菜单权限，然后刷新。", exact=True)).to_be_visible()
            page.unroute("**/prod-api/arcflow/requests")
            page.get_by_role("button", name="刷新", exact=True).click()
            expect(page.get_by_text("已加载最新数据。", exact=True)).to_be_visible()
            expect(page.get_by_text("加载失败或无访问权限。请检查若依登录状态和菜单权限，然后刷新。", exact=True)).to_have_count(0)
            logout(page)

            # Publish real schema-3 groups using the official editor and login.
            login(page, "admin", password)
            page.get_by_role("tab", name="流程设计", exact=True).click()
            page.get_by_label("流程名称", exact=True).fill("Native browser group process")
            for step, stage, mode, retained, added in (
                (1, ALL_STAGE, "全员同意（ALL）", "first (101)", "second (102)"),
                (2, ANY_STAGE, "任一同意（ANY）", "second (102)", "first (101)"),
            ):
                page.get_by_label(f"审批 {step} 名称", exact=True).fill(stage)
                choose_option(page, f"审批 {step} 完成方式", mode)
                expect(page.get_by_label(f"审批 {step} 名称", exact=True)).to_have_value(stage)
                expect(page.get_by_role("combobox", name=f"审批 {step} 审批人", exact=True)).to_have_count(0)
                expect(page.get_by_role("button", name="发布新版本", exact=True)).to_be_disabled()
                participant_label = f"审批 {step} 参与人"
                open_select(page, participant_label)
                choices = page.get_by_role("listbox", name=participant_label, exact=True)
                expect(choices.get_by_role("option", name="CI " + retained, exact=True)).to_have_attribute("aria-selected", "true")
                expect(choices.get_by_role("option", name="CI " + added, exact=True)).to_have_attribute("aria-selected", "false")
                choices.get_by_role("option", name="CI " + added, exact=True).click()
                page.keyboard.press("Escape")
            expect(page.get_by_role("button", name="发布新版本", exact=True)).to_be_enabled()
            group_definition = native_data(page, "/arcflow/process",
                lambda: page.get_by_role("button", name="发布新版本", exact=True).click())
            expect(page.get_by_text(re.compile(r"已发布版本 v\d+。"))).to_be_visible()
            expect(page.get_by_role("button", name="发布新版本", exact=True)).to_be_disabled()
            assert group_definition["schemaVersion"] == 3
            assert group_definition["version"] == sequential_definition["version"] + 1
            assert [node["id"] for node in group_definition["nodes"]] == [node["id"] for node in sequential_definition["nodes"]], \
                "Changing completion mode replaced stable node IDs"
            all_step, any_step = group_definition["nodes"][1:-1]
            for step, name, mode, actors in ((all_step, ALL_STAGE, "ALL", ["101", "102"]),
                                           (any_step, ANY_STAGE, "ANY", ["102", "101"])):
                assert step["type"] == "parallelApproval" and step["name"] == name
                assert step["completionMode"] == mode and step["assigneeId"] is None
                assert step["assigneeIds"] == actors, "Mode conversion lost the original participant or added an unchosen one"
            screenshot(page, output_directory, "03-native-group-editor.png")
            logout(page)

            login(page, "applicant", password)
            page.get_by_label("标题", exact=True).fill(GROUP_TITLE)
            page.get_by_label("原因", exact=True).fill("Synthetic ALL and ANY participant votes through native RuoYi.")
            group = native_data(page, "/arcflow/requests",
                lambda: page.get_by_role("button", name=re.compile("提交申请 · v")).click())
            expect(page.get_by_text("申请已提交。", exact=True)).to_be_visible()
            assert group["definition"] == group_definition
            assert group["status"] == "PENDING" and group["currentStepId"] == all_step["id"]
            assert group["approverId"] == "101", "Fixture must retain first actor as the compatibility pointer"
            group_current(page, ALL_STAGE, ANY_STAGE)
            for actor in ("first", "second"):
                snapshot_vote(page, ALL_STAGE, actor, "待投票")
                snapshot_vote(page, ANY_STAGE, actor, "等待中")
            expect(page.get_by_role("button", name="投同意票", exact=True)).to_have_count(0)
            persisted_request(page, "applicant", group, reload=True)
            logout(page)

            # The second ALL participant may vote first, despite approverId=101.
            login(page, "second", password)
            page.get_by_role("tab", name=re.compile("待我审批")).click()
            select_request(page, GROUP_TITLE)
            expect(page.get_by_role("button", name="投同意票", exact=True)).to_be_visible()
            group = decide_group(page, group, "APPROVE")
            assert group["history"][-1]["actorId"] == "102"
            assert group["status"] == "PENDING" and group["currentStepId"] == all_step["id"]
            assert group["approverId"] == "101" and len(group["history"]) == 2
            expect(page.get_by_text("投票已记录，等待本组其他参与人。", exact=True)).to_be_visible()
            group_current(page, ALL_STAGE, ANY_STAGE)
            snapshot_vote(page, ALL_STAGE, "second", "已同意")
            snapshot_vote(page, ALL_STAGE, "first", "待投票")
            screenshot(page, output_directory, "04-native-all-partial-votes.png")
            no_group_inbox_item(page)
            persisted_request(page, "second", group, reload=True)
            group_current(page, ALL_STAGE, ANY_STAGE)
            snapshot_vote(page, ALL_STAGE, "second", "已同意")
            snapshot_vote(page, ALL_STAGE, "first", "待投票")
            no_group_inbox_item(page)
            persisted_request(page, "second", group)
            group_current(page, ALL_STAGE, ANY_STAGE)
            no_group_inbox_item(page)
            logout(page)

            login(page, "first", password)
            page.get_by_role("tab", name=re.compile("待我审批")).click()
            select_request(page, GROUP_TITLE)
            group_current(page, ALL_STAGE, ANY_STAGE)
            snapshot_vote(page, ALL_STAGE, "second", "已同意")
            group = decide_group(page, group, "APPROVE")
            assert group["history"][-1]["actorId"] == "101"
            assert group["status"] == "PENDING" and group["currentStepId"] == any_step["id"]
            assert group["approverId"] == "102" and len(group["history"]) == 3
            expect(page.get_by_text("本节点已通过，已流转至下一审批人。", exact=True)).to_be_visible()
            expect(snapshot_step(page, ALL_STAGE)).to_contain_text("已通过")
            group_current(page, ANY_STAGE)
            for actor in ("first", "second"):
                snapshot_vote(page, ALL_STAGE, actor, "已同意")
                snapshot_vote(page, ANY_STAGE, actor, "待投票")
            # Voting in ALL must not prevent the same actor's vote in the next group.
            expect(page.get_by_role("button", name="投拒绝票", exact=True)).to_be_visible()
            group = decide_group(page, group, "REJECT")
            assert group["history"][-1]["actorId"] == "101"
            assert group["status"] == "PENDING" and group["currentStepId"] == any_step["id"]
            assert group["approverId"] == "102" and len(group["history"]) == 4
            expect(page.get_by_text("投票已记录，等待本组其他参与人。", exact=True)).to_be_visible()
            expect(page.get_by_text("申请已拒绝。", exact=True)).to_have_count(0)
            group_current(page, ANY_STAGE)
            snapshot_vote(page, ANY_STAGE, "first", "已拒绝")
            snapshot_vote(page, ANY_STAGE, "second", "待投票")
            screenshot(page, output_directory, "05-native-any-partial-rejection.png")
            no_group_inbox_item(page)
            persisted_request(page, "first", group, reload=True)
            group_current(page, ANY_STAGE)
            snapshot_vote(page, ANY_STAGE, "first", "已拒绝")
            snapshot_vote(page, ANY_STAGE, "second", "待投票")
            no_group_inbox_item(page)
            persisted_request(page, "first", group)
            group_current(page, ANY_STAGE)
            no_group_inbox_item(page)
            logout(page)

            # ANY remains open after one rejection, and another participant can approve.
            login(page, "second", password)
            page.get_by_role("tab", name=re.compile("待我审批")).click()
            select_request(page, GROUP_TITLE)
            group_current(page, ANY_STAGE)
            snapshot_vote(page, ANY_STAGE, "first", "已拒绝")
            group = decide_group(page, group, "APPROVE")
            assert group["status"] == "APPROVED" and group["currentStepId"] is None
            assert [(event["actorId"], event["action"]) for event in group["history"]] == [
                ("100", "SUBMIT"), ("102", "APPROVE"), ("101", "APPROVE"), ("101", "REJECT"), ("102", "APPROVE")]
            expect(page.get_by_text("申请已通过。", exact=True)).to_be_visible()
            for stage in (ALL_STAGE, ANY_STAGE):
                expect(snapshot_step(page, stage)).to_contain_text("已通过")
                expect(snapshot_step(page, stage)).not_to_contain_text("当前审批")
            for actor in ("first", "second"):
                snapshot_vote(page, ALL_STAGE, actor, "已同意")
            snapshot_vote(page, ANY_STAGE, "first", "已拒绝")
            snapshot_vote(page, ANY_STAGE, "second", "已同意")
            expect(page.locator(".el-timeline-item")).to_have_count(5)
            for event in ("CI applicant · 提交", "CI second · 通过 · " + ALL_STAGE,
                          "CI first · 通过 · " + ALL_STAGE, "CI first · 拒绝 · " + ANY_STAGE,
                          "CI second · 通过 · " + ANY_STAGE):
                expect(page.locator(".el-timeline")).to_contain_text(event)
            no_group_inbox_item(page)
            screenshot(page, output_directory, "06-native-group-approved-history.png")
            persisted_request(page, "second", group, reload=True)
            expect(snapshot_step(page, ALL_STAGE)).to_contain_text("已通过")
            expect(snapshot_step(page, ANY_STAGE)).to_contain_text("已通过")
            snapshot_vote(page, ANY_STAGE, "first", "已拒绝")
            no_group_inbox_item(page)
            logout(page)
            assert not errors, f"Uncaught browser exceptions: {errors}"
            context.close()
            browser.close()
        print("PASS: native RuoYi Chromium login/menu, editor/publish RBAC, applicant submit, ordered SINGLE approvals, ALL/ANY configuration and participant votes, partial-vote inbox exclusion, snapshot/audit history, real-response reload/refresh retention, logout/cancel, network-error recovery; six workspace screenshots only")
    finally:
        server.shutdown()
        server.server_close()
