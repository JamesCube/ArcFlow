#!/usr/bin/env python3
"""Verify the mobile client's contract against the real standalone Java backend.

Build the core, approval-domain and approval-demo backend first (see the backend
README). Run this script with Python 3.9+ and Java 17+ on PATH, or pass --java.
No Python packages, production credentials or running server are required.

The harness starts its own loopback-only backend, uses random per-run passwords
and a private temporary store, restarts it to verify persistence, and stops it
on exit. It refuses an occupied --port and never targets an existing server.
This exercises real HTTP, authentication and persistence, not browser rendering.
"""

import argparse
import base64
import concurrent.futures
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request


USERS = ("alice", "bob", "carol")


def available_port(requested):
    """Fail before starting Java if an explicitly chosen port is occupied."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", requested))
        return sock.getsockname()[1]


class Suite:
    def __init__(self, args, directory):
        self.args = args
        self.directory = Path(directory)
        self.jar = args.jar.resolve(strict=True)
        self.port = available_port(args.port)
        self.base = f"http://127.0.0.1:{self.port}/api"
        self.passwords = {user: secrets.token_urlsafe(32) for user in USERS}
        self.env = dict(os.environ)
        self.env["APPROVAL_DATA_FILE"] = str(self.directory / "requests.json")
        self.env["APPROVAL_UI_ORIGIN"] = "http://localhost:5173"
        for user, password in self.passwords.items():
            self.env[f"APPROVAL_{user.upper()}_PASSWORD"] = password
        self.process = None
        self.log = None
        self.http_checks = 0
        self.invariants = 0
        self.count_lock = threading.Lock()

    def check(self, condition, message):
        if not condition:
            raise AssertionError(message)
        with self.count_lock:
            self.invariants += 1

    def request(self, path, user="alice", body=None, expected=200,
                headers=None, with_status=False, count=True):
        request_headers = {"X-Arcflow-Client": "approval-demo"}
        if user is not None:
            credential = f"{user}:{self.passwords[user]}".encode("utf-8")
            request_headers["Authorization"] = "Basic " + base64.b64encode(credential).decode("ascii")
        raw = None
        if body is not None:
            request_headers["Content-Type"] = "application/json"
            raw = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        for key, value in (headers or {}).items():
            if value is None:
                request_headers.pop(key, None)
            else:
                request_headers[key] = value
        request = urllib.request.Request(self.base + path, data=raw, headers=request_headers)
        # Never send these loopback-only, synthetic credentials via a system proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=15) as response:
                status, data = response.status, json.load(response)
        except urllib.error.HTTPError as error:
            status, data = error.code, json.load(error)
        allowed = (expected,) if isinstance(expected, int) else expected
        if status not in allowed:
            raise AssertionError(f"{path}: expected HTTP {allowed}, got {status}: {data}")
        if status >= 400 and not (isinstance(data, dict) and isinstance(data.get("message"), str)):
            raise AssertionError(f"{path}: error response has no message")
        if count:
            with self.count_lock:
                self.http_checks += 1
        return (status, data) if with_status else data

    def start(self):
        self.log = open(self.directory / "backend.log", "ab")
        command = [self.args.java, "-jar", str(self.jar),
                   f"--server.port={self.port}", "--server.address=127.0.0.1",
                   f"--approval.data-file={self.directory / 'requests.json'}",
                   "--approval.ui-origin=http://localhost:5173"]
        self.process = subprocess.Popen(command, cwd=self.directory, env=self.env,
                                        stdout=self.log, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError("Disposable backend exited during startup: " + self.log_tail())
            try:
                identity = self.request("/me", count=False)
                if identity.get("id") != "alice":
                    raise RuntimeError("Unexpected backend identity")
                if self.process.poll() is not None:
                    raise RuntimeError("Disposable backend exited during readiness check")
                return
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                time.sleep(0.15)
        raise RuntimeError("Disposable backend did not become ready: " + self.log_tail())

    def log_tail(self):
        content = (self.directory / "backend.log").read_text(errors="replace")[-5000:]
        for password in self.passwords.values():
            content = content.replace(password, "[redacted]")
        return content

    def stop(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)
        if self.log is not None:
            self.log.close()
            self.log = None

    def restart(self):
        self.stop()
        self.start()

    def submit(self, version, user="alice", expected=201, **fields):
        body = {"title": "Synthetic mobile HTTP check", "reason": "Synthetic test data only",
                "days": 2, "processVersion": version}
        body.update(fields)
        return self.request("/requests", user, body, expected)

    def vote(self, item, user, decision="APPROVE", step="manager", comment="Original vote",
             expected=200, with_status=False, **extra):
        body = {"stepId": step, "decision": decision, "comment": comment}
        body.update(extra)
        return self.request(f"/requests/{item['id']}/decisions", user, body,
                            expected, with_status=with_status)

    def reload(self, item, user="alice"):
        matches = [row for row in self.request("/requests", user) if row["id"] == item["id"]]
        self.check(len(matches) == 1, "Request must remain visible exactly once")
        return matches[0]

    def state(self, item, status, step, history_count=None):
        self.check((item["status"], item["currentStepId"]) == (status, step),
                   f"Unexpected state: {item['status']}, {item['currentStepId']}")
        if history_count is not None:
            self.check(len(item["history"]) == history_count, "Unexpected history length")
        identities = [(event["stepId"], event["actorId"]) for event in item["history"][1:]]
        self.check(len(identities) == len(set(identities)), "Duplicate participant vote persisted")

    def publish(self, mode):
        current = self.request("/process")
        definition = {
            "schemaVersion": 3, "id": "leave-approval", "version": current["version"],
            "name": f"Synthetic mobile {mode} process", "nodes": [
                {"id": "start", "type": "start", "name": "Submit", "assigneeId": None},
                {"id": "manager", "type": "parallelApproval", "name": "Group",
                 "assigneeId": None, "assigneeIds": ["bob", "carol"], "completionMode": mode},
                {"id": "final", "type": "approval", "name": "Final review", "assigneeId": "carol"},
                {"id": "end", "type": "end", "name": "Completed", "assigneeId": None}]}
        result = self.request("/process", body={"expectedVersion": current["version"], "definition": definition})
        self.check(result["version"] == current["version"] + 1, "Publication did not increment version")
        return result

    def parallel(self, jobs):
        barrier = threading.Barrier(len(jobs))

        def run(job):
            barrier.wait(timeout=15)
            return job()

        with concurrent.futures.ThreadPoolExecutor(max_workers=len(jobs)) as pool:
            return list(pool.map(run, jobs))

    def authentication_and_identity(self):
        self.request("/me", user=None, expected=401)
        self.request("/requests", user=None, expected=401)
        wrong = base64.b64encode(b"bob:synthetic-wrong-password").decode("ascii")
        self.request("/me", headers={"Authorization": "Basic " + wrong}, expected=401)
        self.request("/me", headers={"Authorization": "Basic not-valid-base64"}, expected=401)
        for user in USERS:
            self.check(self.request("/me", user)["id"] == user, "Identity differs from authenticated principal")
        self.check({person["id"] for person in self.request("/people")} == set(USERS), "Unexpected people list")
        self.request("/process", headers={"Origin": "https://foreign.example"}, expected=403)
        self.request("/process", headers={"Sec-Fetch-Site": "cross-site"}, expected=403)
        self.request("/requests", body={}, headers={"X-Arcflow-Client": None}, expected=403)
        self.request("/process", "bob", b"not json", expected=403)
        self.submit(1, applicantId="bob", expected=400)
        self.submit(1, approverId="carol", expected=400)
        legacy = self.submit(1)
        self.check(legacy["applicantId"] == "alice" and legacy["history"][0]["actorId"] == "alice",
                   "Submission principal was not saved")
        self.vote(legacy, "alice", expected=403)
        self.vote(legacy, "carol", expected=404)
        self.check(not self.request("/requests", "carol"), "Unrelated user can see a request")
        for field in ("actorId", "applicantId", "approverId"):
            self.vote(legacy, "bob", expected=400, **{field: "carol"})
        self.vote(legacy, "bob", step="unknown-step", expected=409)
        self.state(self.reload(legacy), "PENDING", "manager", 1)
        print("PASS: authentication, strict actor payloads, principal authorization, concealed requests and browser guards", flush=True)
        return legacy

    def all_and_replays(self, legacy):
        published = self.publish("ALL")
        self.submit(1, expected=409)
        self.submit(published["version"], "bob", expected=400)
        item = self.submit(published["version"])
        self.check(item["definition"] == published, "Submission did not snapshot process")
        for user in ("bob", "carol"):
            self.check(self.reload(item, user) == item, "Assigned participant cannot see group work")
        self.vote(item, "carol", step="final", expected=409)
        self.vote(item, "bob", step="final", expected=403)
        self.vote(item, "alice", expected=403)
        original_comment = "同意。\nSynthetic mobile decision ✅"
        partial = self.vote(item, "bob", comment="  " + original_comment + "  ")
        self.state(partial, "PENDING", "manager", 2)
        self.check(partial["approverId"] == "carol", "First pending participant was not updated")
        self.check(partial["history"][-1]["comment"] == original_comment, "Comment was not trimmed losslessly")
        self.check(self.vote(item, "bob", comment="  " + original_comment + "  ") == partial, "Exact replay changed state")
        self.check(self.vote(item, "bob", comment="Attempted rewrite") == partial, "Replay rewrote original comment or time")
        self.vote(item, "bob", "REJECT", expected=409)
        self.check(self.reload(item, "bob") == partial, "GET reload changed partial group state")
        self.restart()
        self.check(self.reload(item, "carol") == partial, "Partial votes/comments did not survive backend restart")
        self.check(self.vote(item, "bob", comment="After restart") == partial, "Replay changed a restored vote")
        votes = self.parallel([lambda: self.vote(item, "carol", comment="Carol's one group vote") for _ in range(6)])
        self.check(all(result == votes[0] for result in votes), "Concurrent exact replays returned inconsistent state")
        advanced = votes[0]
        self.state(advanced, "PENDING", "final", 3)
        self.check(self.vote(item, "bob") == advanced, "Stale same-decision replay did not return current state")
        self.check(self.vote(item, "carol") == advanced, "Group replay accidentally advanced the next step")
        self.vote(item, "carol", "REJECT", expected=409)
        finished = self.vote(item, "carol", step="final", comment="Final approval")
        self.state(finished, "APPROVED", None, 4)
        self.check(self.vote(item, "bob") == finished, "Replay after completion did not return final state")
        self.check(self.vote(item, "carol", step="final") == finished, "Final-step replay changed history")
        self.vote(item, "carol", "REJECT", step="final", expected=409)
        self.vote(item, "alice", expected=403)
        self.check(self.reload(item) == finished, "Completed state changed during reload")
        self.check(finished["history"][1] == partial["history"][1], "Original decision event changed")
        old_done = self.vote(legacy, "bob", comment=None)
        self.state(old_done, "APPROVED", None, 2)
        self.check(old_done["processVersion"] == 1 and old_done["definition"] == legacy["definition"],
                   "Publication changed an existing request's definition")
        self.check(old_done["comment"] == "", "Null comment must normalize to empty string")
        print("PASS: ALL, exact/concurrent/opposite replays, current/future step authorization, immutable snapshots and restart", flush=True)

    def any_and_stale_steps(self):
        definition = self.publish("ANY")
        version = definition["version"]
        item = self.submit(version)
        partial = self.vote(item, "bob", "REJECT", comment="Needs changes")
        self.state(partial, "PENDING", "manager", 2)
        self.check(partial["approverId"] == "carol", "ANY rejected participant remains actionable")
        self.check(self.vote(item, "bob", "REJECT") == partial, "ANY rejection replay changed state")
        rejected = self.vote(item, "carol", "REJECT", comment="Also rejected")
        self.state(rejected, "REJECTED", None, 3)
        self.vote(item, "carol", step="final", expected=409)
        self.check(self.vote(item, "bob", "REJECT") == rejected, "Terminal ANY replay changed state")
        item = self.submit(version)
        advanced = self.vote(item, "bob", comment="First approval wins")
        self.state(advanced, "PENDING", "final", 2)
        self.vote(item, "carol", expected=409)
        self.vote(item, "carol", "REJECT", expected=409)
        self.check(self.reload(item) == advanced, "Stale unvoted member changed an advanced ANY group")
        rejected = self.vote(item, "carol", "REJECT", step="final", comment="Final-step rejection")
        self.state(rejected, "REJECTED", None, 3)
        self.check(self.vote(item, "bob") == rejected, "Earlier replay ignored a later terminal rejection")
        print("PASS: ANY partial rejection/all-reject/early-approve and stale, unvoted, future and terminal steps", flush=True)

    def concurrent_outcomes(self):
        for mode in ("ALL", "ANY"):
            definition = self.publish(mode)
            version = definition["version"]
            # Exercise both actor/action assignments; accept either legal serialization.
            for round_number in range(self.args.race_rounds):
                for actions in (("APPROVE", "REJECT"), ("REJECT", "APPROVE")):
                    item = self.submit(version)
                    jobs = [lambda user=user, action=action: self.vote(
                        item, user, action, comment=f"{mode} race {round_number}: {user} {action}",
                        expected=(200, 409), with_status=True)
                        for user, action in zip(("bob", "carol"), actions)]
                    results = self.parallel(jobs)
                    current = self.reload(item)
                    decisive = "REJECT" if mode == "ALL" else "APPROVE"
                    decisive_index = actions.index(decisive)
                    self.check(results[decisive_index][0] == 200, f"{mode} decisive vote was lost")
                    self.state(current, "REJECTED" if mode == "ALL" else "PENDING",
                               None if mode == "ALL" else "final")
                    saved = {event["actorId"]: event for event in current["history"][1:]}
                    accepted = {user for user, result in zip(("bob", "carol"), results) if result[0] == 200}
                    self.check(set(saved) == accepted, "Accepted HTTP votes differ from durable events")
                    for user, action, result in zip(("bob", "carol"), actions, results):
                        if result[0] == 200:
                            self.check(saved[user]["action"] == action, "Concurrent vote action changed")
                            self.check(saved[user]["comment"] == f"{mode} race {round_number}: {user} {action}",
                                       "Concurrent comment changed")
                            self.check(self.vote(item, user, action) == current, "Concurrent replay changed state")
                        else:
                            self.vote(item, user, action, expected=409)
                    if mode == "ANY":
                        self.state(self.vote(item, "carol", step="final"), "APPROVED", None, len(current["history"]) + 1)

            item = self.submit(version)
            action = "APPROVE" if mode == "ALL" else "REJECT"
            self.parallel([lambda user=user: self.vote(item, user, action) for user in ("bob", "carol")])
            self.state(self.reload(item), "PENDING" if mode == "ALL" else "REJECTED",
                       "final" if mode == "ALL" else None, 3)

            item = self.submit(version)
            results = self.parallel([lambda action=action: self.vote(item, "bob", action,
                        expected=(200, 409), with_status=True) for action in ("APPROVE", "REJECT")])
            self.check(sorted(result[0] for result in results) == [200, 409], "Opposite commands both won or both lost")
            winner = next(result[1] for result in results if result[0] == 200)
            self.check(self.reload(item) == winner, "Opposite-race winner differs from durable state")
            self.check(len(winner["history"]) == 2, "Opposite-race persisted extra events")
            print(f"PASS: {mode} concurrent mixed outcomes ({2 * self.args.race_rounds} races), same outcomes and opposite commands", flush=True)

    def durable_reload(self):
        before = {user: self.request("/requests", user) for user in USERS}
        process = self.request("/process")
        self.restart()
        self.check(self.request("/process") == process, "Published process did not survive restart")
        for user in USERS:
            after = self.request("/requests", user)
            self.check(after == before[user], f"{user}'s full state/comments/history changed after restart")
        snapshot = json.loads((self.directory / "requests.json").read_text())
        self.check(snapshot["schemaVersion"] == 3, "Group publication did not upgrade storage schema")
        backup = json.loads((self.directory / "requests.json.schema2.bak").read_text())
        self.check(backup["schemaVersion"] == 2 and len(backup["requests"]) == 1,
                   "Schema upgrade did not preserve the original sequential store")
        self.check(len(snapshot["requests"]) == len(before["alice"]), "Durable store lost a synthetic request")
        print("PASS: every principal's visible requests, Unicode comments, timestamps, histories and published definition survive full restart", flush=True)

    def run(self):
        self.start()
        legacy = self.authentication_and_identity()
        self.all_and_replays(legacy)
        self.any_and_stale_steps()
        self.concurrent_outcomes()
        self.durable_reload()
        print(f"PASS: {self.http_checks} real HTTP status checks; {self.invariants} contract invariants; 2 backend restarts", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--jar", type=Path, default=Path(__file__).resolve().parents[2] / "approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar")
    parser.add_argument("--java", default="java", help="Java 17+ executable (default: java on PATH)")
    parser.add_argument("--port", type=int, default=0, help="Free loopback port; 0 chooses an ephemeral port")
    parser.add_argument("--race-rounds", type=int, default=3, help="Rounds for each actor/action assignment and group mode")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    if args.race_rounds < 1:
        parser.error("--race-rounds must be positive")
    with tempfile.TemporaryDirectory(prefix="arcflow-mobile-http-") as directory:
        suite = Suite(args, directory)
        try:
            suite.run()
        finally:
            suite.stop()


if __name__ == "__main__":
    main()
