#!/usr/bin/env python3
"""Dependency-free authenticated HTTP smoke check against a disposable local demo.

Requires a freshly built backend jar. Never points at an existing store/server.
Credentials are random per run, held in memory, and never printed.
"""
import argparse
import base64
import concurrent.futures
import copy
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--jar', type=Path, default=Path(__file__).parent / 'backend/target/approval-demo-0.1.0-SNAPSHOT.jar')
parser.add_argument('--port', type=int, default=18080)
args = parser.parse_args()
jar = args.jar.resolve(strict=True)
base = f'http://127.0.0.1:{args.port}/api'
passwords = {user: secrets.token_urlsafe(24) for user in ('alice', 'bob', 'carol')}
checks = 0

def call(path, user='alice', body=None, expected=200, headers=None):
    global checks
    h = {'X-Arcflow-Client': 'approval-demo'}
    if user:
        h['Authorization'] = 'Basic ' + base64.b64encode(f'{user}:{passwords[user]}'.encode()).decode()
    raw = None
    if body is not None:
        raw = json.dumps(body).encode(); h['Content-Type'] = 'application/json'
    h.update(headers or {})
    request = urllib.request.Request(base + path, data=raw, headers=h)
    try:
        with urllib.request.urlopen(request, timeout=10) as r: status, data = r.status, json.load(r)
    except urllib.error.HTTPError as e:
        status, data = e.code, json.load(e)
    assert status == expected, f'{path}: expected {expected}, got {status}: {data}'
    checks += 1
    return data

def submission(version): return {'title': 'Synthetic HTTP check', 'reason': 'No personal information', 'days': 2, 'processVersion': version}
def vote(item, user, action, step='manager', expected=200):
    return call(f'/requests/{item["id"]}/decisions', user, {'stepId': step, 'decision': action, 'comment': f'{user} original vote'}, expected)
def assert_state(item, status, step, history):
    assert (item['status'], item['currentStepId'], len(item['history'])) == (status, step, history), item

def proposal(version, mode):
    return {'schemaVersion': 3, 'id': 'leave-approval', 'version': version, 'name': 'Synthetic parallel process', 'nodes': [
        {'id': 'start', 'type': 'start', 'name': 'Submit', 'assigneeId': None},
        {'id': 'manager', 'type': 'parallelApproval', 'name': 'Group', 'assigneeId': None, 'assigneeIds': ['bob', 'carol'], 'completionMode': mode},
        {'id': 'final', 'type': 'approval', 'name': 'Final review', 'assigneeId': 'carol'},
        {'id': 'end', 'type': 'end', 'name': 'End', 'assigneeId': None}]}

with tempfile.TemporaryDirectory(prefix='arcflow-parallel-http-') as directory:
    env = dict(os.environ, APPROVAL_DATA_FILE=str(Path(directory) / 'requests.json'))
    for user, password in passwords.items(): env[f'APPROVAL_{user.upper()}_PASSWORD'] = password
    process = None
    def start():
        global process
        process = subprocess.Popen(['java', '-jar', str(jar), f'--server.port={args.port}', '--server.address=127.0.0.1', f'--approval.data-file={Path(directory) / "requests.json"}'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(200):
            if process.poll() is not None: raise RuntimeError('Disposable backend exited during startup')
            try:
                call('/me'); return
            except (urllib.error.URLError, TimeoutError): time.sleep(.1)
        raise RuntimeError('Disposable backend did not become ready')
    def stop():
        if process and process.poll() is None:
            process.terminate()
            try: process.wait(timeout=15)
            except subprocess.TimeoutExpired: process.kill(); process.wait()
    try:
        # Refuse accidental reuse of an unrelated local backend.
        try:
            urllib.request.urlopen(base + '/me', timeout=1)
        except urllib.error.HTTPError:
            raise RuntimeError('Port already serves an HTTP backend; choose a free --port')
        except urllib.error.URLError: pass
        else: raise RuntimeError('Port already in use; choose a free --port')
        start()
        call('/me', None, expected=401)
        call('/process', headers={'Origin': 'https://foreign.example'}, expected=403)
        old = call('/requests', body=submission(1), expected=201)
        d = proposal(1, 'ALL')
        for members in ([], ['bob'], ['bob', 'bob'], ['bob', 'alice'], ['bob', 2]):
            bad = copy.deepcopy(d); bad['nodes'][1]['assigneeIds'] = members
            call('/process', body={'expectedVersion': 1, 'definition': bad}, expected=400)
        call('/process', 'bob', {'expectedVersion': 1, 'definition': d}, 403)
        published = call('/process', body={'expectedVersion': 1, 'definition': d})
        assert published['version'] == 2 and published['schemaVersion'] == 3
        call('/process', body={'expectedVersion': 1, 'definition': d}, expected=409)
        call('/requests', 'bob', submission(2), 400)
        item = call('/requests', body=submission(2), expected=201)
        vote(item, 'alice', 'APPROVE', expected=403)
        vote(item, 'carol', 'APPROVE', 'final', 409)
        partial = vote(item, 'carol', 'APPROVE'); assert_state(partial, 'PENDING', 'manager', 2)
        assert partial['approverId'] == 'bob'
        assert vote(item, 'carol', 'APPROVE') == partial
        vote(item, 'carol', 'REJECT', expected=409)
        # Persist a partial group, restart the actual backend, then continue it.
        stop(); start()
        restored = next(r for r in call('/requests', 'carol') if r['id'] == item['id'])
        assert restored == partial
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: vote(item, 'bob', 'APPROVE'), range(4)))
        assert all(r == results[0] for r in results); assert_state(results[0], 'PENDING', 'final', 3)
        assert vote(item, 'carol', 'APPROVE') == results[0]
        done = vote(item, 'carol', 'APPROVE', 'final'); assert_state(done, 'APPROVED', None, 4)
        assert done['definition'] == published
        assert_state(vote(old, 'bob', 'APPROVE'), 'APPROVED', None, 2)
        print('PASS: legacy + ALL permissions, duplicates, partial restart, next-step isolation, immutable snapshot')

        call('/process', body={'expectedVersion': 2, 'definition': proposal(2, 'ANY')})
        item = call('/requests', body=submission(3), expected=201)
        partial = vote(item, 'bob', 'REJECT'); assert_state(partial, 'PENDING', 'manager', 2)
        assert_state(vote(item, 'carol', 'REJECT'), 'REJECTED', None, 3)
        item = call('/requests', body=submission(3), expected=201)
        assert_state(vote(item, 'bob', 'APPROVE'), 'PENDING', 'final', 2)
        vote(item, 'carol', 'APPROVE', expected=409)
        assert_state(vote(item, 'carol', 'APPROVE', 'final'), 'APPROVED', None, 3)
        call('/process', body={'expectedVersion': 3, 'definition': proposal(3, 'ALL')})
        item = call('/requests', body=submission(4), expected=201)
        assert_state(vote(item, 'bob', 'REJECT'), 'REJECTED', None, 2)
        vote(item, 'carol', 'APPROVE', expected=409)
        print('PASS: ANY partial rejection/all-reject/early-approve and ALL early-reject terminal rules')
        print(f'PASS: {checks} authenticated HTTP assertions against a disposable backend, including restart')
    finally: stop()
