#!/usr/bin/env python3
"""Real upstream login + ArcFlow smoke. Starts/restarts a packaged RuoYi server.

Requires a newly imported disposable database and Redis; never points at production.
No mock authentication or fabricated bearer tokens are used. Secrets stay in memory.
"""
import argparse
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
    print("PASS: official login/menu, RBAC, authoritative assignments, ordered approvals, replay/conflict, logout, disabled/deleted identity, restart persistence")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jar", type=Path, required=True)
    parser.add_argument("--state-directory", type=Path, required=True)
    args = parser.parse_args()
    assert not (args.state_directory / "approval.json").exists(), "Use a fresh CI state directory"
    password = secrets.token_hex(10)  # Official RuoYi limits passwords to 20 characters.
    install(password)
    server = Server(args.jar, args.state_directory)
    try:
        server.start()
        run(server, password)
    finally:
        server.stop()


if __name__ == "__main__":
    main()
