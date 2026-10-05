#!/usr/bin/env python3
"""Real upstream login + ArcFlow smoke. Starts/restarts a packaged RuoYi server.

Requires a newly imported disposable database and Redis; never points at production.
No mock authentication or fabricated bearer tokens are used. Secrets stay in memory.
"""
import argparse
import base64
import redis
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import urllib.error
import urllib.request

from fixture import actor_state, install

BASE = os.getenv("ARCFLOW_TEST_URL", "http://127.0.0.1:8080").rstrip("/")


def api(path, token=None, body=None, *, method=None, allowed=(200,)):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode()),
                                 headers=headers, method=method or ("POST" if body is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            status, raw = res.status, res.read()
    except urllib.error.HTTPError as err:
        status, raw = err.code, err.read()
    value = json.loads(raw)
    code = value.get("code", status)
    assert code in allowed, f"{path}: expected {allowed}, got HTTP {status}, application code {code}"
    assert status < 500, f"{path}: unexpected server error {status}"
    return value


def data(path, token=None, body=None, **kwargs):
    return api(path, token, body, **kwargs)["data"]


def login(name, password):
    value = api("/login", body={"username": name, "password": password, "code": "", "uuid": ""})
    assert isinstance(value.get("token"), str) and value["token"], "Official login returned no token"
    return value["token"]


def decision(token, req, step, action="APPROVE", *, allowed=(200,)):
    return api(f"/arcflow/requests/{req['id']}/decisions", token,
               {"stepId": step, "decision": action, "comment": "CI decision"}, allowed=allowed)


def saved_request(token, req):
    matches = [item for item in data("/arcflow/requests", token) if item["id"] == req["id"]]
    assert len(matches) == 1, "Assigned participant cannot read the request snapshot"
    return matches[0]


def pending_members(req):
    """Derive the full worklist from the public snapshot, never just approverId."""
    if req["status"] != "PENDING":
        assert req["currentStepId"] is None
        return []
    step = next(node for node in req["definition"]["nodes"] if node["id"] == req["currentStepId"])
    members = step["assigneeIds"] if step["type"] == "parallelApproval" else [step["assigneeId"]]
    voted = {event["actorId"] for event in req["history"] if event["stepId"] == step["id"]}
    return [member for member in members if member not in voted]


def assert_votes(req, expected):
    assert [(event["actorId"], event["stepId"], event["action"]) for event in req["history"]] == [
        ("100", None, "SUBMIT"), *expected]


def assert_retry(token, req, step, action="APPROVE"):
    assert decision(token, req, step, action)["data"] == req, "Exact retry appended or changed a vote"
    opposite = "REJECT" if action == "APPROVE" else "APPROVE"
    decision(token, req, step, opposite, allowed=(409,))
    assert saved_request(token, req) == req, "Conflicting retry changed the saved request"


def run_groups(server, password, sequential):
    """Exercise schema-3 contracts through authenticated, real native endpoints."""
    a, first, second, outsider, none = (
        login("arcflow_" + name, password)
        for name in ("applicant", "first", "second", "outsider", "nopermission"))
    admin = login("admin", password)
    group = {"id": "group", "type": "parallelApproval", "name": "Joint review", "assigneeId": None,
             "assigneeIds": ["101", "102"], "completionMode": "ALL"}
    proposed = {**sequential, "schemaVersion": 3, "name": "CI ALL group then final approval", "nodes": [
        sequential["nodes"][0], group,
        {"id": "final", "type": "approval", "name": "Final approval", "assigneeId": "101"},
        sequential["nodes"][-1]]}

    # Shape validation must happen at this host's real HTTP boundary, before a
    # bad publication can replace the previously valid sequential definition.
    invalid_groups = [
        {**group, "assigneeIds": members} for members in (
            [], ["101"], ["101", "101"], ["101", "999999999"],
            ["101", ""], ["101", " "], ["101", 102], ["101", None], ["101", True],
            ["101", {"id": "102"}], "101,102", None,
            [str(member) for member in range(100, 117)])]
    invalid_groups += [{**group, "completionMode": mode} for mode in ("all", "FIRST", "", None, 1)]
    invalid_groups += [{**group, "assigneeId": "101"}, {**group, "unknown": "rejected"}]
    invalid_groups += [{key: value for key, value in group.items() if key != missing} for missing in group]
    malformed = [{**proposed, "nodes": [proposed["nodes"][0], invalid, proposed["nodes"][-1]]}
                 for invalid in invalid_groups]
    malformed.append({**proposed, "schemaVersion": 2})
    for candidate in malformed:
        api("/arcflow/process", admin,
            {"expectedVersion": sequential["version"], "definition": candidate}, allowed=(400,))
        assert data("/arcflow/process", a) == sequential, "Malformed group changed the published process"
    duplicate_key = json.dumps({"expectedVersion": sequential["version"], "definition": proposed}).replace(
        '"completionMode": "ALL"', '"completionMode": "ALL", "completionMode": "ANY"', 1).encode()
    api("/arcflow/process", admin, duplicate_key, allowed=(400,))
    assert data("/arcflow/process", a) == sequential

    publication = {"expectedVersion": sequential["version"], "definition": proposed}
    api("/arcflow/process", a, publication, allowed=(403,))
    all_definition = data("/arcflow/process", admin, publication)
    assert all_definition == {**proposed, "version": sequential["version"] + 1}
    api("/arcflow/process", admin, publication, allowed=(409,))
    submission = {"title": "Native ALL group", "reason": "Disposable group integration exercise", "days": 2,
                  "processVersion": all_definition["version"]}
    api("/arcflow/requests", none, submission, allowed=(403,))
    # Both positions in a group are authoritative assignments for self-submission.
    for participant in (first, second):
        api("/arcflow/requests", participant, submission, allowed=(400,))
    all_complete = data("/arcflow/requests", a, submission)
    all_reject = data("/arcflow/requests", a, {**submission, "title": "Native ALL immediate rejection"})
    all_partial_reject = data("/arcflow/requests", a, {**submission, "title": "Native ALL partial rejection"})
    assert all_complete["definition"] == all_definition and all_complete["currentStepId"] == "group"
    assert all_complete["approverId"] == "101" and pending_members(all_complete) == ["101", "102"]
    assert_votes(all_complete, [])
    for participant in (a, first, second):
        assert saved_request(participant, all_complete) == all_complete
    # In particular, non-first member 102 has this item in their pending worklist
    # even though the backward-compatible approverId points to 101.
    assert all_complete["id"] in {
        item["id"] for item in data("/arcflow/requests", second) if "102" in pending_members(item)}
    for unassigned in (outsider, admin):
        assert all(item["id"] != all_complete["id"] for item in data("/arcflow/requests", unassigned))
        decision(unassigned, all_complete, "group", allowed=(403, 404))
    decision(a, all_complete, "group", allowed=(403,))
    decision(none, all_complete, "group", allowed=(403,))
    decision(first, all_complete, "final", allowed=(409,))
    assert saved_request(a, all_complete) == all_complete

    # Publish a different policy before voting. Existing requests must continue
    # using their pinned ALL group and final stage, rather than the new ANY policy.
    any_proposal = {**all_definition, "name": "CI ANY group", "nodes": [
        all_definition["nodes"][0], {**group, "completionMode": "ANY"}, all_definition["nodes"][-1]]}
    any_definition = data("/arcflow/process", admin,
                          {"expectedVersion": all_definition["version"], "definition": any_proposal})
    assert any_definition == {**any_proposal, "version": all_definition["version"] + 1}
    assert saved_request(second, all_complete) == all_complete
    api("/arcflow/requests", a, submission, allowed=(409,))

    partial = decision(second, all_complete, "group")["data"]
    assert partial["status"] == "PENDING" and partial["currentStepId"] == "group"
    assert pending_members(partial) == ["101"] and partial["approverId"] == "101"
    assert partial["definition"] == all_definition
    assert_votes(partial, [("102", "group", "APPROVE")])
    assert_retry(second, partial, "group")
    assert partial["id"] not in {
        item["id"] for item in data("/arcflow/requests", second) if "102" in pending_members(item)}
    assert saved_request(second, partial) == partial, "Voting removed historical participant visibility"
    advanced = decision(first, partial, "group")["data"]
    assert advanced["status"] == "PENDING" and advanced["currentStepId"] == "final"
    assert pending_members(advanced) == ["101"]
    assert_votes(advanced, [("102", "group", "APPROVE"), ("101", "group", "APPROVE")])
    assert_retry(first, advanced, "group")
    assert_retry(second, advanced, "group")
    # The same actor may vote once in each assigned stage; replay identity includes
    # stepId, and a retry of the group cannot accidentally approve the final stage.
    all_complete = decision(first, advanced, "final")["data"]
    assert all_complete["status"] == "APPROVED" and pending_members(all_complete) == []
    assert all_complete["definition"] == all_definition
    assert_votes(all_complete, [("102", "group", "APPROVE"), ("101", "group", "APPROVE"),
                                ("101", "final", "APPROVE")])
    assert_retry(first, all_complete, "group")
    assert_retry(first, all_complete, "final")
    all_reject = decision(second, all_reject, "group", "REJECT")["data"]
    assert all_reject["status"] == "REJECTED" and pending_members(all_reject) == []
    assert_votes(all_reject, [("102", "group", "REJECT")])
    decision(first, all_reject, "group", allowed=(409,))
    decision(first, all_reject, "final", allowed=(409,))
    assert_retry(second, all_reject, "group", "REJECT")
    all_partial_reject = decision(first, all_partial_reject, "group")["data"]
    assert all_partial_reject["status"] == "PENDING" and pending_members(all_partial_reject) == ["102"]
    all_partial_reject = decision(second, all_partial_reject, "group", "REJECT")["data"]
    assert all_partial_reject["status"] == "REJECTED" and pending_members(all_partial_reject) == []
    assert_votes(all_partial_reject, [("101", "group", "APPROVE"), ("102", "group", "REJECT")])
    assert_retry(first, all_partial_reject, "group")

    any_submission = {**submission, "title": "Native ANY reject then approve", "processVersion": any_definition["version"]}
    any_approved = data("/arcflow/requests", a, any_submission)
    any_approved = decision(first, any_approved, "group", "REJECT")["data"]
    assert any_approved["status"] == "PENDING" and any_approved["currentStepId"] == "group"
    assert any_approved["approverId"] == "102" and pending_members(any_approved) == ["102"]
    assert_votes(any_approved, [("101", "group", "REJECT")])
    assert_retry(first, any_approved, "group", "REJECT")
    any_approved = decision(second, any_approved, "group")["data"]
    assert any_approved["status"] == "APPROVED" and pending_members(any_approved) == []
    assert_votes(any_approved, [("101", "group", "REJECT"), ("102", "group", "APPROVE")])
    assert_retry(first, any_approved, "group", "REJECT")
    assert_retry(second, any_approved, "group")

    any_rejected = data("/arcflow/requests", a, {**any_submission, "title": "Native ANY all reject"})
    any_rejected = decision(second, any_rejected, "group", "REJECT")["data"]
    assert any_rejected["status"] == "PENDING" and pending_members(any_rejected) == ["101"]
    any_rejected = decision(first, any_rejected, "group", "REJECT")["data"]
    assert any_rejected["status"] == "REJECTED" and pending_members(any_rejected) == []
    assert_votes(any_rejected, [("102", "group", "REJECT"), ("101", "group", "REJECT")])
    assert_retry(first, any_rejected, "group", "REJECT")
    assert_retry(second, any_rejected, "group", "REJECT")

    any_immediate = data("/arcflow/requests", a, {**any_submission, "title": "Native ANY immediate approval"})
    any_immediate = decision(second, any_immediate, "group")["data"]
    assert any_immediate["status"] == "APPROVED" and pending_members(any_immediate) == []
    assert_votes(any_immediate, [("102", "group", "APPROVE")])
    decision(first, any_immediate, "group", allowed=(409,))
    decision(first, any_immediate, "group", "REJECT", allowed=(409,))
    assert_retry(second, any_immediate, "group")

    # Keep both a partial group and an unvoted assignment while its non-first
    # participant becomes inactive/deleted. Cached upstream sessions grant no bypass.
    any_partial = data("/arcflow/requests", a, {**any_submission, "title": "Native ANY historical partial"})
    any_partial = decision(second, any_partial, "group", "REJECT")["data"]
    assert any_partial["status"] == "PENDING" and pending_members(any_partial) == ["101"]
    unvoted = data("/arcflow/requests", a, {**any_submission, "title": "Native ANY inactive assignment"})
    before_restart = {item["id"]: item for item in data("/arcflow/requests", a)}
    for status, deleted in (("1", "0"), ("0", "2")):
        actor_state(102, status=status, deleted=deleted)
        api("/arcflow/me", second, allowed=(401, 403))
        api("/arcflow/requests", second, allowed=(401, 403))
        decision(second, unvoted, "group", allowed=(401, 403))
        decision(second, any_partial, "group", "REJECT", allowed=(401, 403))
        assert "102" not in {str(person["id"]) for person in data("/arcflow/people", a)}
        api("/arcflow/process", admin,
            {"expectedVersion": any_definition["version"], "definition": any_definition}, allowed=(400,))
        api("/arcflow/requests", a, any_submission, allowed=(400,))
        assert data("/arcflow/process", a) == any_definition
        assert {item["id"]: item for item in data("/arcflow/requests", a)} == before_restart
        assert saved_request(first, any_partial) == any_partial

    server.stop()
    server.start()
    a, first, admin = login("arcflow_applicant", password), login("arcflow_first", password), login("admin", password)
    assert {item["id"]: item for item in data("/arcflow/requests", a)} == before_restart, \
        "Restart lost sequential/group definitions, votes or historical deleted participants"
    assert data("/arcflow/process", a) == any_definition
    assert saved_request(first, any_partial) == any_partial
    decision(second, unvoted, "group", allowed=(401, 403))
    decision(second, any_partial, "group", "REJECT", allowed=(401, 403))
    api("/arcflow/requests", a, any_submission, allowed=(400,))
    actor_state(102)
    second = login("arcflow_second", password)
    assert saved_request(second, any_partial) == any_partial
    assert_retry(second, any_partial, "group", "REJECT")

    # Leave the browser journey its original two-step schema-2 editor fixture.
    # Pending schema-3 snapshots must remain actionable after that later publication.
    restored_definition = data("/arcflow/process", admin, {
        "expectedVersion": any_definition["version"],
        "definition": {**sequential, "version": any_definition["version"]}})
    assert restored_definition == {**sequential, "version": any_definition["version"] + 1}
    assert saved_request(first, any_partial) == any_partial
    any_partial = decision(first, any_partial, "group")["data"]
    assert any_partial["status"] == "APPROVED" and pending_members(any_partial) == []
    assert any_partial["definition"] == any_definition and any_partial["processVersion"] == any_definition["version"]
    assert_votes(any_partial, [("102", "group", "REJECT"), ("101", "group", "APPROVE")])
    assert_retry(second, any_partial, "group", "REJECT")
    unvoted = decision(second, unvoted, "group")["data"]
    assert unvoted["status"] == "APPROVED" and unvoted["definition"] == any_definition
    assert_votes(unvoted, [("102", "group", "APPROVE")])
    assert_retry(second, unvoted, "group")
    assert data("/arcflow/process", a) == restored_definition
    print("PASS: native schema-3 ALL/ANY publication, strict group shapes, participant worklists, assignment/RBAC/self-submission, per-actor-and-step replay/conflict, pinned definitions, inactive/deleted group members, exact group restart persistence; two-step browser fixture restored")


def contains_component(routes, component):
    return any(r.get("component") == component or contains_component(r.get("children", []), component)
               for r in routes)


class Server:
    def __init__(self, jar, directory):
        self.jar, self.directory = jar.resolve(), directory.resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.proc = None
        self.log = None
        self.secret = secrets.token_urlsafe(48)

    def start(self):
        env = dict(os.environ, TOKEN_SECRET=self.secret,
                   ARCFLOW_LOG_DIR=str(self.directory / "logs"),
                   ARCFLOW_MYSQL_URL="jdbc:mysql://127.0.0.1:3306/ry-vue?useUnicode=true&characterEncoding=utf8&useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC",
                   REDIS_HOST="127.0.0.1", REDIS_PORT="6379", REDIS_PASSWORD="",
                   ARCFLOW_INITIAL_APPROVER_ID="101",
                   ARCFLOW_DATA_FILE=str(self.directory / "approval.json"),
                   RUOYI_UPLOAD_PATH=str(self.directory / "uploads"))
        self.log = (self.directory / "server.log").open("ab")
        self.proc = subprocess.Popen([
            "java", "-jar", str(self.jar), "--spring.profiles.active=druid,arcflow",
            "--server.port=8080",
            "--logging.file.path=" + str(self.directory / "logs"),
        ], env=env, stdout=self.log, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            assert self.proc.poll() is None, "RuoYi exited during startup; inspect server.log"
            try:
                api("/captchaImage")
                return
            except (OSError, ValueError, AssertionError):
                time.sleep(1)
        raise AssertionError("RuoYi startup timed out; inspect server.log")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=10)
        if self.log:
            self.log.close()


def run(server, password):
    tokens = {name: login("arcflow_" + name, password)
              for name in ("applicant", "first", "second", "outsider", "nopermission")}
    admin = login("admin", password)
    a, first, second, outsider, none = (tokens[n] for n in ("applicant", "first", "second", "outsider", "nopermission"))
    info = api("/getInfo", a)
    assert str(info["user"]["userId"]) == "100"
    assert "arcflow:request:submit" in info["permissions"]
    assert "arcflow:process:publish" not in info["permissions"]
    routes = data("/getRouters", a)
    assert contains_component(routes, "arcflow/approval/index"), "Seeded ArcFlow menu was not returned by RuoYi"
    assert str(data("/arcflow/me", a)["id"]) == "100"
    people = data("/arcflow/people", a)
    assert {"100", "101", "102"}.issubset({str(p["id"]) for p in people})
    for path in ("/arcflow/me", "/arcflow/people", "/arcflow/process", "/arcflow/requests"):
        api(path, allowed=(401,))
    api("/arcflow/me", "invalid-token", allowed=(401,))
    api("/arcflow/requests", none, allowed=(403,))
    definition = data("/arcflow/process", a)
    proposed = {**definition, "name": "CI two-step process", "nodes": [
        {"id": "start", "type": "start", "name": "Submit", "assigneeId": None},
        {"id": "first", "type": "approval", "name": "First approval", "assigneeId": "101"},
        {"id": "second", "type": "approval", "name": "Second approval", "assigneeId": "102"},
        {"id": "end", "type": "end", "name": "Complete", "assigneeId": None}]}
    publish = {"expectedVersion": definition["version"], "definition": proposed}
    api("/arcflow/process", a, publish, allowed=(403,))
    published = data("/arcflow/process", admin, publish)
    api("/arcflow/process", admin, publish, allowed=(409,))
    submission = {"title": "Real RuoYi CI", "reason": "Disposable integration exercise", "days": 2,
                  "processVersion": published["version"]}
    api("/arcflow/requests", none, submission, allowed=(403,))
    api("/arcflow/requests", a, {**submission, "processVersion": definition["version"]}, allowed=(409,))
    api("/arcflow/requests", a, {**submission, "applicantId": "1"}, allowed=(400,))
    api("/arcflow/requests", a, {**submission, "days": "2"}, allowed=(400,))
    for malformed in (b'', b'{"days":2,"days":3}', b'{"title":null}', b'{invalid'):
        api("/arcflow/requests", a, malformed, allowed=(400,))
    req = data("/arcflow/requests", a, submission)
    assert req["applicantId"] == "100" and req["currentStepId"] == "first"
    assert req["definition"] == published
    api(f"/arcflow/requests/{req['id']}/decisions", body={"stepId": "first", "decision": "APPROVE", "comment": ""}, allowed=(401,))
    decision(outsider, req, "first", allowed=(403, 404))
    decision(admin, req, "first", allowed=(403, 404))
    decision(a, req, "first", allowed=(403,))
    decision(second, req, "second", allowed=(409,))
    assert all(r["id"] != req["id"] for r in data("/arcflow/requests", outsider))
    advanced = decision(first, req, "first")["data"]
    assert advanced["status"] == "PENDING" and advanced["currentStepId"] == "second"
    replay = decision(first, req, "first")["data"]
    assert replay == advanced, "Replay changed request state/history"
    decision(first, req, "first", "REJECT", allowed=(409,))
    approved = decision(second, req, "second")["data"]
    assert approved["status"] == "APPROVED" and approved["currentStepId"] is None
    assert [event["actorId"] for event in approved["history"]] == ["100", "101", "102"]
    assert len(approved["history"]) == 3
    rejected_request = data("/arcflow/requests", a, submission)
    rejected = decision(first, rejected_request, "first", "REJECT")["data"]
    assert rejected["status"] == "REJECTED" and rejected["currentStepId"] is None
    decision(second, rejected_request, "second", allowed=(409,))
    assert decision(first, rejected_request, "first", "REJECT")["data"] == rejected
    api("/logout", outsider, method="POST")
    api("/arcflow/me", outsider, allowed=(401,))
    # RuoYi's bearer token is backed by a Redis login session. Expire that exact
    # disposable session using Redis TTL, without fabricating a signed token.
    expiring = login("arcflow_outsider", password)
    payload = expiring.split(".")[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    cache = redis.Redis(host="127.0.0.1", port=6379)
    session_key = "login_tokens:" + claims["login_user_key"]
    assert cache.expire(session_key, 1), "Official login did not create Redis session"
    deadline = time.monotonic() + 5
    while cache.exists(session_key) and time.monotonic() < deadline:
        time.sleep(0.1)
    assert not cache.exists(session_key), "Disposable session did not expire"
    api("/arcflow/me", expiring, allowed=(401,))
    # Existing Redis-backed sessions must not allow a disabled/deleted user through.
    actor_state(101, status="1")
    api("/arcflow/me", first, allowed=(401, 403))
    api("/arcflow/requests", a, submission, allowed=(400,))
    api("/arcflow/process", admin, {"expectedVersion": published["version"], "definition": published}, allowed=(400,))
    api("/login", body={"username": "arcflow_first", "password": password}, allowed=(500, 401, 403))
    actor_state(101, status="0", deleted="2")
    api("/arcflow/me", first, allowed=(401, 403))
    # Restore with the historical actor still deleted. Snapshot validation must be
    # structural, not depend on the present-day user directory.
    server.stop()
    server.start()
    a = login("arcflow_applicant", password)
    restored = next(r for r in data("/arcflow/requests", a) if r["id"] == req["id"])
    assert restored == approved, "Restart did not preserve exact state/history"
    assert data("/arcflow/process", a) == published
    actor_state(101)
    first = login("arcflow_first", password)
    assert decision(first, req, "first")["data"] == approved
    print("PASS: official login/menu, RBAC, authoritative assignments, ordered approvals, replay/conflict, logout/expired Redis session, disabled/deleted identity, restart persistence")
    run_groups(server, password, published)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jar", type=Path, required=True)
    parser.add_argument("--state-directory", type=Path, required=True)
    parser.add_argument("--frontend-directory", type=Path, help="Built official frontend; enables native Chromium journey")
    args = parser.parse_args()
    assert not (args.state_directory / "approval.json").exists(), "Use a fresh CI state directory"
    password = secrets.token_hex(10)  # Official RuoYi limits passwords to 20 characters.
    install(password)
    server = Server(args.jar, args.state_directory)
    try:
        server.start()
        run(server, password)
        if args.frontend_directory:
            from browser import run as run_browser
            run_browser(args.frontend_directory, args.state_directory / "screenshots", password)
    finally:
        server.stop()


if __name__ == "__main__":
    main()
