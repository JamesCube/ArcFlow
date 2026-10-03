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


def select_request(page):
    page.locator(".el-table__body-wrapper tr").filter(has_text=TITLE).click()
    expect(page.locator(".detail")).to_contain_text(TITLE)


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
                page.get_by_label(f"审批 {step} 审批人", exact=True).click()
                page.get_by_role("option", name="CI " + actor, exact=True).click()
            page.get_by_role("button", name="发布新版本", exact=True).click()
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
            expect(page.get_by_role("button", name="通过当前节点", exact=True)).to_have_count(0)
            page.reload()
            loaded(page, "applicant")
            select_request(page)
            expect(page.locator(".detail")).to_contain_text("审批中")
            logout(page, cancel_first=True)

            # Later assigned participant can see the snapshot but cannot decide early.
            login(page, "second", password)
            page.get_by_role("tab", name="我参与的申请", exact=True).click()
            select_request(page)
            expect(page.get_by_role("button", name="通过当前节点", exact=True)).to_have_count(0)
            logout(page)
            login(page, "first", password)
            page.get_by_role("tab", name=re.compile("待我审批")).click()
            select_request(page)
            page.get_by_role("button", name="通过当前节点", exact=True).click()
            expect(page.get_by_text("本节点已通过，已流转至下一审批人。", exact=True)).to_be_visible()
            expect(page.get_by_role("button", name="通过当前节点", exact=True)).to_have_count(0)
            logout(page)
            login(page, "second", password)
            page.get_by_role("tab", name=re.compile("待我审批")).click()
            select_request(page)
            page.get_by_role("button", name="通过当前节点", exact=True).click()
            expect(page.get_by_text("申请已通过。", exact=True)).to_be_visible()
            expect(page.locator(".el-timeline-item")).to_have_count(3)
            expect(page.locator(".el-timeline")).to_contain_text("CI applicant · 提交")
            expect(page.locator(".el-timeline")).to_contain_text("CI first · 通过 · Team review")
            expect(page.locator(".el-timeline")).to_contain_text("CI second · 通过 · Final review")
            expect(page.get_by_role("button", name="通过当前节点", exact=True)).to_have_count(0)
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
            assert not errors, f"Uncaught browser exceptions: {errors}"
            context.close()
            browser.close()
        print("PASS: native RuoYi Chromium login/menu, editor/publish RBAC, applicant submit, ordered two-step UI approvals, audit history, reload/direct route, logout/cancel, network-error recovery; two workspace screenshots only")
    finally:
        server.shutdown()
        server.server_close()
