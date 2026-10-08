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
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import sync_playwright, expect

ORIGIN = "http://127.0.0.1:5173"
WORKSPACE = ORIGIN + "/arcflow/approval"
TITLE = "Native RuoYi browser approval"
GROUP_TITLE = "Native RuoYi group approval"
PROCUREMENT_TITLE = "Native RuoYi procurement approval"
ALL_STAGE = "All reviewers"
ANY_STAGE = "Any reviewer"
WORKSPACE_HEADING = re.compile(r"^ArcFlow (?:审批工作台|approval workspace)$")
DESKTOP = {"width": 1440, "height": 1080}
NARROW = {"width": 390, "height": 844}


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
    expect(page.get_by_role("heading", name="ArcFlow 审批工作台", exact=True)).to_be_visible()
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
    expect(page.get_by_role("heading", name="ArcFlow 审批工作台", exact=True)).to_be_visible()
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
        expect(page.get_by_role("heading", name=WORKSPACE_HEADING)).to_be_visible()
        page.locator(".avatar-wrapper").hover()
        page.get_by_text("退出登录", exact=True).click()
    dialog.get_by_role("button", name="确定", exact=True).click()
    expect(page).to_have_url(re.compile(r"/login(?:\?|$)"))
    page.goto(WORKSPACE)
    expect(page).to_have_url(re.compile(r"/login\?redirect="))
    expect(page.get_by_role("heading", name=WORKSPACE_HEADING)).to_have_count(0)


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


def persisted_request(page, name, expected, *, reload=False, title=GROUP_TITLE):
    action = page.reload if reload else lambda: page.get_by_role("button", name="刷新", exact=True).click()
    items = native_data(page, "/arcflow/requests", action, method="GET")
    loaded(page, name)
    assert next(item for item in items if item["id"] == expected["id"]) == expected, \
        "Native reload/refresh changed the persisted request or participant history"
    page.get_by_role("tab", name="我参与的申请", exact=True).click()
    select_request(page, title)


def decide_group(page, req, action):
    label = "投同意票" if action == "APPROVE" else "投拒绝票"
    updated = native_data(page, f"/arcflow/requests/{req['id']}/decisions",
                          lambda: page.get_by_role("button", name=label, exact=True).click())
    assert updated["definition"] == req["definition"], "A vote rewrote the submission's process snapshot"
    assert updated["history"][:-1] == req["history"], "A vote rewrote earlier participant votes"
    assert updated["history"][-1]["action"] == action
    assert updated["history"][-1]["stepId"] == req["currentStepId"]
    assert updated.get("business") == req.get("business"), "A vote changed the typed business document"
    return updated


def no_group_inbox_item(page, title=GROUP_TITLE):
    page.get_by_role("tab", name=re.compile("待我审批")).click()
    expect(request_row(page, title)).to_have_count(0)
    expect(page.get_by_role("button", name="投同意票", exact=True)).to_have_count(0)
    expect(page.get_by_role("button", name="投拒绝票", exact=True)).to_have_count(0)


def screenshot(page, directory, name):
    expect(page.locator('input[type="password"]')).to_have_count(0)
    expect(page.get_by_role("heading", name=WORKSPACE_HEADING)).to_be_visible()
    page.screenshot(path=str(directory / name), full_page=True, animations="disabled")


def keyboard_choice(page, test_id, value, *, last):
    """Exercise the real native select with keyboard events, not DOM mutation."""
    control = page.get_by_test_id(test_id)
    control.focus()
    expect(control).to_be_focused()
    control.press("End" if last else "Home")
    control.press("Enter")
    control.press("Escape")
    expect(control).to_have_value(value)


def procurement_detail(page, business):
    expect(page.get_by_test_id("business-detail")).to_be_visible()
    expect(page.get_by_test_id("business-detail")).to_contain_text(business["item"])
    expect(page.get_by_test_id("detail-business-id")).to_have_text(business["businessId"])
    expect(page.get_by_test_id("detail-total")).to_have_text("USD 0.30")
    expect(page.locator(".detail")).to_contain_text(business["reason"])


def procurement_screenshots(page, directory, view, business):
    """Capture both actual locales at desktop and a 390px narrow viewport."""
    first = 7 if view == "author" else 11
    for offset, (language, viewport, size) in enumerate((
        ("zh-CN", DESKTOP, "desktop"), ("en", DESKTOP, "desktop"),
        ("zh-CN", NARROW, "narrow"), ("en", NARROW, "narrow"),
    )):
        page.set_viewport_size(viewport)
        keyboard_choice(page, "language-select", language, last=language == "en")
        heading = "ArcFlow 审批工作台" if language == "zh-CN" else "ArcFlow approval workspace"
        expect(page.get_by_role("heading", name=heading, exact=True)).to_be_visible()
        if view == "author":
            expect(page.get_by_test_id("business-type")).to_have_value("procurement")
            expect(page.get_by_test_id("business-id")).to_have_value(business["businessId"])
            expect(page.get_by_test_id("item")).to_have_value(business["item"])
            expect(page.get_by_test_id("quantity")).to_have_value("3")
            expect(page.get_by_test_id("unit-price")).to_have_value("0.10")
            expect(page.get_by_test_id("exact-total")).to_have_text("USD 0.30")
            expect(page.get_by_label("标题" if language == "zh-CN" else "Title", exact=True)).to_have_value(business["title"])
            expect(page.get_by_label("原因" if language == "zh-CN" else "Reason", exact=True)).to_have_value(business["reason"])
        else:
            procurement_detail(page, business)
        # The official shell and mounted workspace must not introduce page-wide
        # horizontal scrolling. Tables may retain their own internal scroller.
        expect(page.locator(".arcflow-approval")).to_be_visible()
        page.wait_for_function("document.documentElement.scrollWidth <= window.innerWidth + 1")
        page.evaluate("window.scrollTo(0, 0)")
        locale = "zh" if language == "zh-CN" else "en"
        screenshot(page, directory, f"{first + offset:02d}-native-procurement-{view}-{locale}-{size}.png")
    page.set_viewport_size(DESKTOP)
    keyboard_choice(page, "language-select", "zh-CN", last=False)


def procurement_journey(page, output_directory, password, definition):
    """Submit and approve one synthetic typed document using real native UI."""
    business = {"type": "procurement", "businessId": "PO-NATIVE-UI-001", "title": PROCUREMENT_TITLE,
                "reason": "Synthetic CI procurement / 合成采购测试; no personal information.",
                "item": "USB-C adapter / USB-C 转接头", "quantity": 3, "unitPrice": 0.10, "currency": "USD"}
    document_posts = []

    def observe_document(request):
        if urlsplit(request.url).path == "/prod-api/arcflow/documents" and request.method == "POST":
            # Only synthetic document bodies are retained in test memory; never
            # collect login requests, credentials, authorization or session data.
            document_posts.append(request.post_data_json)

    page.on("request", observe_document)
    try:
        login(page, "applicant", password)
        expect(page.get_by_test_id("business-type")).to_have_value("leave")
        keyboard_choice(page, "business-type", "procurement", last=True)
        page.get_by_label("标题", exact=True).fill(business["title"])
        page.get_by_label("原因", exact=True).fill(business["reason"])
        page.get_by_test_id("business-id").fill(business["businessId"])
        page.get_by_test_id("item").fill(business["item"])
        page.get_by_test_id("quantity").fill("0")
        page.get_by_test_id("unit-price").fill("0.001")
        page.get_by_test_id("currency").select_option("USD")
        # A keyboard submission of invalid quantity/precision must remain local.
        page.get_by_test_id("submit-document").focus()
        page.get_by_test_id("submit-document").press("Enter")
        expect(page.get_by_test_id("submission-errors")).to_be_visible()
        assert not document_posts, "Invalid procurement authoring reached the server"
        page.get_by_test_id("quantity").fill("3")
        page.get_by_test_id("quantity").press("Tab")
        expect(page.get_by_test_id("unit-price")).to_be_focused()
        page.get_by_test_id("unit-price").fill("0.10")
        expect(page.get_by_test_id("exact-total")).to_have_text("USD 0.30")

        # Native workspace navigation and type changes must not lose entered fields.
        page.get_by_role("tab", name="流程设计", exact=True).click()
        expect(page.get_by_label("流程名称", exact=True)).to_be_disabled()
        page.get_by_role("tab", name="我的申请", exact=True).click()
        expect(page.get_by_test_id("unit-price")).to_have_value("0.10")
        keyboard_choice(page, "business-type", "leave", last=False)
        expect(page.get_by_test_id("item")).to_have_count(0)
        keyboard_choice(page, "business-type", "procurement", last=True)
        procurement_screenshots(page, output_directory, "author", business)
        document = native_data(page, "/arcflow/documents",
            lambda: page.get_by_test_id("submit-document").press("Enter"))
        assert document_posts == [{"business": business, "processVersion": definition["version"]}], \
            "Procurement did not use the typed document endpoint and exact normalized fields"
        assert document["business"] == business and document["days"] == 0
        assert document["title"] == business["title"] and document["reason"] == business["reason"]
        assert document["applicantId"] == "100" and document["definition"] == definition
        all_step, any_step = definition["nodes"][1:-1]
        assert document["status"] == "PENDING" and document["currentStepId"] == all_step["id"]
        procurement_detail(page, business)
        group_current(page, ALL_STAGE, ANY_STAGE)
        persisted_request(page, "applicant", document, reload=True, title=PROCUREMENT_TITLE)
        procurement_detail(page, business)
        logout(page)

        # Use the real ALL -> ANY definition. The non-first ALL participant votes
        # first, and the same people can vote independently in the following stage.
        login(page, "second", password)
        page.get_by_role("tab", name=re.compile("待我审批")).click()
        select_request(page, PROCUREMENT_TITLE)
        procurement_detail(page, business)
        document = decide_group(page, document, "APPROVE")
        assert document["history"][-1]["actorId"] == "102"
        assert document["status"] == "PENDING" and document["currentStepId"] == all_step["id"]
        group_current(page, ALL_STAGE, ANY_STAGE)
        snapshot_vote(page, ALL_STAGE, "second", "已同意")
        no_group_inbox_item(page, PROCUREMENT_TITLE)
        persisted_request(page, "second", document, reload=True, title=PROCUREMENT_TITLE)
        procurement_detail(page, business)
        logout(page)

        login(page, "first", password)
        page.get_by_role("tab", name=re.compile("待我审批")).click()
        select_request(page, PROCUREMENT_TITLE)
        document = decide_group(page, document, "APPROVE")
        assert document["status"] == "PENDING" and document["currentStepId"] == any_step["id"]
        expect(snapshot_step(page, ALL_STAGE)).to_contain_text("已通过")
        document = decide_group(page, document, "REJECT")
        assert document["status"] == "PENDING" and document["currentStepId"] == any_step["id"]
        group_current(page, ANY_STAGE)
        snapshot_vote(page, ANY_STAGE, "first", "已拒绝")
        no_group_inbox_item(page, PROCUREMENT_TITLE)
        persisted_request(page, "first", document, title=PROCUREMENT_TITLE)
        procurement_detail(page, business)
        logout(page)

        login(page, "second", password)
        page.get_by_role("tab", name=re.compile("待我审批")).click()
        select_request(page, PROCUREMENT_TITLE)
        document = decide_group(page, document, "APPROVE")
        assert document["status"] == "APPROVED" and document["currentStepId"] is None
        assert document["business"] == business
        assert [(event["actorId"], event["action"]) for event in document["history"]] == [
            ("100", "SUBMIT"), ("102", "APPROVE"), ("101", "APPROVE"), ("101", "REJECT"), ("102", "APPROVE")]
        expect(page.locator(".el-timeline-item")).to_have_count(5)
        for stage in (ALL_STAGE, ANY_STAGE):
            expect(snapshot_step(page, stage)).to_contain_text("已通过")
        no_group_inbox_item(page, PROCUREMENT_TITLE)
        page.get_by_role("tab", name="我参与的申请", exact=True).click()
        select_request(page, PROCUREMENT_TITLE)
        procurement_screenshots(page, output_directory, "detail", business)
        # Reload verifies the exact final business, immutable snapshot and votes.
        persisted_request(page, "second", document, reload=True, title=PROCUREMENT_TITLE)
        procurement_detail(page, business)
        assert len(document_posts) == 1, "Navigation or approval duplicated the procurement submission"
        logout(page)
    finally:
        page.remove_listener("request", observe_document)


def procurement_paging_journey(page, password, definition):
    """Cross a real 25-row native inbox boundary with immutable procurement."""
    # Reuse the disposable harness's official login/API flow. These are real
    # server-created fixtures, never fabricated tokens or intercepted responses.
    from smoke import data as api_data, login as api_login

    admin = api_login("admin", password)
    applicant = api_login("arcflow_applicant", password)
    first_actor = api_login("arcflow_first", password)
    definition = api_data("/arcflow/process", admin, {
        "expectedVersion": definition["version"],
        "definition": {**definition, "name": "Native paged procurement review"},
    })
    all_step, any_step = definition["nodes"][1:-1]
    business = {"type": "procurement", "businessId": f"PO-NATIVE-PAGED-{definition['version']}",
                "title": f"Native paged procurement v{definition['version']}",
                "reason": "Synthetic native inbox paging; no order or payment.",
                "item": "Synthetic USB-C adapter", "quantity": 3, "unitPrice": 0.10, "currency": "USD"}
    document = api_data("/arcflow/documents", applicant,
                        {"business": business, "processVersion": definition["version"]})
    fillers = [api_data("/arcflow/requests", applicant, {
        "title": f"Native paging leave v{definition['version']} {index:02}",
        "reason": "Synthetic native inbox fixture", "days": 1, "processVersion": definition["version"],
    }) for index in range(1, 27)]
    expected_titles = [item["title"] for item in reversed(fillers)] + [document["title"]]
    rows = page.locator(".el-table__body-wrapper tr")

    def read_page(box, action, cursor=None):
        def matches(response):
            url = urlsplit(response.url)
            query = parse_qs(url.query)
            return (url.path == "/prod-api/arcflow/requests/inbox"
                    and response.request.method == "GET" and query.get("box") == [box]
                    and query.get("limit") == ["25"]
                    and query.get("processVersion") == [str(definition["version"])]
                    and query.get("cursor") == (None if cursor is None else [cursor]))
        with page.expect_response(matches) as pending:
            action()
        response = pending.value
        assert response.status == 200, "Native inbox paging transport failed"
        value = response.json()
        assert value.get("code") == 200, "Native inbox paging returned an application error"
        result = value["data"]
        assert len(result["items"]) <= 25
        assert all(item["processVersion"] == definition["version"] for item in result["items"])
        return result

    def filter_box(box):
        page.get_by_role("tab", name="待我审批" if box == "PENDING" else "我已处理", exact=True).click()
        version = page.get_by_role("textbox", name="筛选流程版本", exact=True)
        # @change is committed by the real input blur. Each box is independent.
        if version.input_value() != str(definition["version"]):
            version.fill(str(definition["version"]))
            return read_page(box, lambda: version.press("Tab"))
        return read_page(box, lambda: page.get_by_role("button", name="刷新本列表", exact=True).click())

    def load_rest(first_page, expected):
        assert len(first_page["items"]) == 25 and first_page["nextCursor"]
        expect(rows).to_have_count(25)
        expect(request_row(page, document["title"])).to_have_count(0)
        rest = read_page("PENDING", lambda: page.get_by_role("button", name="加载更多", exact=True).click(),
                         first_page["nextCursor"])
        combined = first_page["items"] + rest["items"]
        assert rest["nextCursor"] is None
        assert len({item["id"] for item in combined}) == len(expected), "Native paging repeated or lost a request"
        assert [item["title"] for item in combined] == expected
        expect(rows).to_have_count(len(expected))
        expect(rows.locator("td:first-child .cell")).to_have_text(expected)
        expect(page.get_by_role("button", name="加载更多", exact=True)).to_have_count(0)
        return rest

    login(page, "second", password)
    first_page = filter_box("PENDING")
    load_rest(first_page, expected_titles)
    # Native per-list refresh must restart at 25, not append or retain its cursor.
    restarted = read_page("PENDING", lambda: page.get_by_role("button", name="刷新本列表", exact=True).click())
    assert restarted == first_page
    load_rest(restarted, expected_titles)
    select_request(page, document["title"])
    procurement_detail(page, business)
    assert document["approverId"] == "101", "Fixture must exercise the non-first group member"
    document = decide_group(page, document, "APPROVE")
    expect(page.get_by_role("button", name="刷新", exact=True)).to_be_enabled()
    assert document["status"] == "PENDING" and document["currentStepId"] == all_step["id"]
    assert [(event["actorId"], event["action"]) for event in document["history"]] == [
        ("100", "SUBMIT"), ("102", "APPROVE")]
    load_rest(filter_box("PENDING"), expected_titles[:-1])
    expect(request_row(page, document["title"])).to_have_count(0)
    handled = filter_box("HANDLED")
    assert handled["items"] == [document] and handled["nextCursor"] is None
    expect(rows).to_have_count(1)
    select_request(page, document["title"])
    procurement_detail(page, business)
    expect(page.get_by_role("button", name="投同意票", exact=True)).to_have_count(0)

    # A saved ALL vote stays handled while a later ANY stage makes this same
    # actor eligible again. Creation order still puts the document on page two.
    advanced = api_data(f"/arcflow/requests/{document['id']}/decisions", first_actor, {
        "stepId": all_step["id"], "decision": "APPROVE", "comment": "Synthetic group completion",
    })
    assert advanced["status"] == "PENDING" and advanced["currentStepId"] == any_step["id"]
    updated_handled = read_page("HANDLED", lambda: page.get_by_role("button", name="刷新", exact=True).click())
    expect(page.get_by_role("button", name="刷新", exact=True)).to_be_enabled()
    assert updated_handled["items"] == [advanced]
    select_request(page, document["title"])
    expect(page.get_by_role("button", name="投同意票", exact=True)).to_be_visible()
    load_rest(filter_box("PENDING"), expected_titles)
    select_request(page, document["title"])
    procurement_detail(page, business)
    completed = decide_group(page, advanced, "APPROVE")
    expect(page.get_by_role("button", name="刷新", exact=True)).to_be_enabled()
    assert completed["status"] == "APPROVED" and completed["business"] == business
    assert [(event["actorId"], event["stepId"], event["action"]) for event in completed["history"]] == [
        ("100", None, "SUBMIT"), ("102", all_step["id"], "APPROVE"),
        ("101", all_step["id"], "APPROVE"), ("102", any_step["id"], "APPROVE")]
    final_handled = filter_box("HANDLED")
    assert final_handled["items"] == [completed]
    select_request(page, business["title"])
    expect(page.get_by_role("button", name="投同意票", exact=True)).to_have_count(0)
    persisted_request(page, "second", completed, reload=True, title=business["title"])
    procurement_detail(page, business)
    logout(page, cancel_first=True)
    # Neither cached detail nor an inbox can survive the genuine host logout.
    expect(rows).to_have_count(0)


def run(frontend_directory, output_directory, password):
    frontend_directory = frontend_directory.resolve()
    assert (frontend_directory / "index.html").is_file(), "Build the official frontend first"
    output_directory.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 5173), partial(Frontend, directory=str(frontend_directory)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(viewport=DESKTOP, locale="zh-CN")
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
            expect(page.get_by_text("当前节点已通过，等待下一节点审批。", exact=True)).to_be_visible()
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
            expect(page.get_by_text("当前节点已通过，等待下一节点审批。", exact=True)).to_be_visible()
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
            procurement_journey(page, output_directory, password, group_definition)
            procurement_paging_journey(page, password, group_definition)
            assert not errors, f"Uncaught browser exceptions: {errors}"
            context.close()
            browser.close()
        print("PASS: native RuoYi Chromium login/menu, editor/publish RBAC, applicant submit, ordered SINGLE approvals, ALL/ANY configuration and participant votes, partial-vote inbox exclusion, snapshot/audit history, real-response reload/refresh retention, logout/cancel, network-error recovery, typed procurement validation/keyboard/navigation/exact totals and real group approvals, real 25-row member-inbox load-more/refresh with second-page procurement and pending/handled later-stage overlap; fourteen authenticated workspace screenshots including CN/EN desktop/narrow procurement authoring and detail")
    finally:
        server.shutdown()
        server.server_close()
