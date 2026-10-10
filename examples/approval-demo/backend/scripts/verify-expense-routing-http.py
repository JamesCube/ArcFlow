#!/usr/bin/env python3
"""Verify finite expense routing over real HTTP using a disposable packaged backend.

Starts only its own loopback process with generated in-memory passwords and a
fresh temporary store. Optional receipts contain synthetic responses/snapshots,
never credentials. No scenario inbox endpoint, external payment, RuoYi or H5.
"""
import argparse
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[4]
EXAMPLES = ROOT / 'docs/api/examples'
BASE = '/api/scenarios/oa-expense'


def example(name):
    return json.loads((EXAMPLES / (name + '.json')).read_bytes())


class Backend:
    def __init__(self, jar, java, directory):
        self.jar, self.java, self.directory = jar, java, directory
        self.process = self.log = None
        self.count = 0
        self.passwords = {a: secrets.token_urlsafe(24) for a in ('alice', 'bob', 'carol')}
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.base = 'http://127.0.0.1:' + str(sock.getsockname()[1])
        self.client = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def start(self):
        self.log = (self.directory / 'backend.log').open('ab')
        env = dict(os.environ, **{f'APPROVAL_{a.upper()}_PASSWORD': p for a, p in self.passwords.items()})
        self.process = subprocess.Popen([self.java, '-jar', str(self.jar), '--server.address=127.0.0.1',
                                         '--server.port=' + self.base.rsplit(':', 1)[1],
                                         '--approval.data-file=' + str(self.directory / 'state.json')],
                                        cwd=self.directory, env=env, stdout=self.log, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise AssertionError('Packaged backend exited before readiness')
            try:
                self.call('GET', '/api/me')
                return
            except urllib.error.URLError:
                time.sleep(.1)
        raise AssertionError('Packaged backend readiness timed out')

    def stop(self):
        if self.process is not None:
            self.process.terminate()
            try:
                self.process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)
            self.process = None
        if self.log is not None:
            self.log.close()
            self.log = None

    def call(self, method, path, body=None, actor='alice', key=None, expected=200, raw=None):
        headers = {'X-Arcflow-Client': 'approval-demo'}
        if actor:
            headers['Authorization'] = 'Basic ' + base64.b64encode(f'{actor}:{self.passwords[actor]}'.encode()).decode()
        if key is not None:
            headers['Idempotency-Key'] = key
        if body is not None:
            headers['Content-Type'] = 'application/json'
        payload = raw if raw is not None else None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=payload, headers=headers, method=method)
        try:
            with self.client.open(request, timeout=15) as response:
                status, data = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, data = error.code, error.read()
        assert status == expected, (method, path, expected, status, data.decode(errors='replace'))
        self.count += 1
        return json.loads(data) if data else None

    def vote(self, view, actor, step, decision='APPROVE', expected=200):
        return self.call('POST', BASE + '/requests/' + view['request']['id'] + '/decisions',
                         {'stepId': step, 'decision': decision, 'comment': 'Synthetic expense routing review'},
                         actor=actor, expected=expected)


def verify(server, receipt):
    state = server.directory / 'state.json.scenario-oa-expense.json'
    pub = example('publish-expense-routing')
    server.call('GET', BASE + '/process', actor=None, expected=401)
    server.call('POST', BASE + '/process', pub, actor='bob', expected=403)
    published = server.call('POST', BASE + '/process', pub, raw=(EXAMPLES / 'publish-expense-routing.json').read_bytes())
    assert published['schemaVersion'] == 4 and published['version'] == 2
    assert server.call('GET', BASE + '/process') == published
    server.call('POST', BASE + '/process', pub, expected=409)
    receipt('expense-schema4-publication-only.json', state.read_bytes())
    before = state.read_bytes()
    foreign = example('expense-routing-equal')
    foreign['business']['currency'] = 'USD'
    failure = server.call('POST', BASE + '/documents', foreign, key='reusable-after-mismatch', expected=400)
    assert 'currency' in failure['message'].lower()
    assert state.read_bytes() == before
    assert server.call('GET', BASE + '/requests') == []
    receipt('currency-mismatch.json', {'response': failure, 'snapshot_sha256_before': hashlib.sha256(before).hexdigest(),
                                     'snapshot_sha256_after': hashlib.sha256(state.read_bytes()).hexdigest()})
    for field in ('routing', 'stepIds', 'evaluations', 'selectedStepIds', 'total', 'totalAmount'):
        forged = example('expense-routing-equal')
        forged[field] = []
        server.call('POST', BASE + '/documents', forged, key='forged-' + field, expected=400)
        assert state.read_bytes() == before
    forged = example('expense-routing-equal')
    forged['business']['totalAmount'] = .01
    server.call('POST', BASE + '/documents', forged, key='forged-business-total', expected=400)
    assert state.read_bytes() == before
    views = {}
    for name, total, selected in [('below', '0.29', ['base', 'final']),
                                  ('equal', '0.30', ['base', 'risk', 'final']),
                                  ('above', '0.31', ['base', 'risk', 'final'])]:
        body = example('expense-routing-' + name)
        key = 'reusable-after-mismatch' if name == 'equal' else 'expense-' + name
        view = server.call('POST', BASE + '/documents', body, key=key, expected=201,
                           raw=(EXAMPLES / ('expense-routing-' + name + '.json')).read_bytes())
        assert view['total'] == total
        assert view['request']['status'] == 'PENDING' and view['request']['currentStepId'] == 'base'
        assert view['request']['definition'] == published
        assert view['request']['routing']['schemaVersion'] == 1
        assert view['request']['routing']['stepIds'] == selected
        assert server.call('POST', BASE + '/documents', body, key=key, expected=201) == view
        views[name] = view
        receipt(name + '-submitted.json', view)
    assert views['equal']['request']['routing']['evaluations'][0]['predicates'][0] == {
        'field': 'expense.totalAmount', 'actualValue': 'CNY 0.3', 'result': True}
    assert len(server.call('GET', BASE + '/requests')) == 3
    visible = server.call('GET', BASE + '/requests', actor='carol')
    assert {v['request']['id'] for v in visible} == {views[n]['request']['id'] for n in ('equal', 'above')}
    server.vote(views['below'], 'carol', 'risk', expected=404)
    server.vote(views['equal'], 'carol', 'risk', expected=409)
    # The standalone scenario host has no GET single-item or inbox endpoint.
    # Its UI derives pending work from this actor-filtered list; domain/JDBC suites cover inbox projections.
    above_approve = server.call('POST', BASE + '/documents', example('expense-routing-above'),
                                key='expense-above-approve', expected=201)
    assert above_approve['request']['routing']['stepIds'] == ['base', 'risk', 'final']
    receipt('expense-schema4-requests.json', state.read_bytes())
    next_pub = copy.deepcopy(pub)
    next_pub['expectedVersion'] = next_pub['definition']['version'] = 2
    next_pub['definition']['nodes'][2]['runIf']['predicates'][0]['threshold'] = .1
    assert server.call('POST', BASE + '/process', next_pub)['version'] == 3
    low_body = example('expense-routing-below')
    assert server.call('POST', BASE + '/documents', low_body, key='expense-below', expected=201) == views['below']
    server.call('POST', BASE + '/documents', low_body, key='new-stale-key', expected=409)
    low_body['processVersion'] = 3
    server.call('POST', BASE + '/documents', low_body, key='expense-below', expected=409)
    newer = server.call('POST', BASE + '/documents', low_body, key='new-version', expected=201)
    assert newer['request']['routing']['stepIds'] == ['base', 'risk', 'final']
    server.stop()
    server.start()
    assert server.call('GET', BASE + '/process')['version'] == 3
    for name, view in views.items():
        body = example('expense-routing-' + name)
        key = 'reusable-after-mismatch' if name == 'equal' else 'expense-' + name
        assert server.call('POST', BASE + '/documents', body, key=key, expected=201) == view
    low = server.vote(views['below'], 'bob', 'base')
    assert low['request']['currentStepId'] == 'final'
    assert low['request']['definition'] == views['below']['request']['definition']
    assert low['request']['routing'] == views['below']['request']['routing']
    low = server.vote(low, 'bob', 'final')
    assert low['request']['status'] == 'APPROVED'
    assert views['below']['request']['id'] not in {v['request']['id'] for v in server.call('GET', BASE + '/requests', actor='carol')}
    equal = server.vote(views['equal'], 'bob', 'base')
    assert equal['request']['currentStepId'] == 'risk'
    equal = server.vote(equal, 'carol', 'risk')
    assert equal['request']['currentStepId'] == 'final'
    equal = server.vote(equal, 'bob', 'final')
    assert equal['request']['status'] == 'APPROVED'
    above_approve = server.vote(above_approve, 'bob', 'base')
    assert above_approve['request']['currentStepId'] == 'risk'
    above_approve = server.vote(above_approve, 'carol', 'risk')
    assert above_approve['request']['currentStepId'] == 'final'
    above_approve = server.vote(above_approve, 'bob', 'final')
    assert above_approve['request']['status'] == 'APPROVED'
    receipt('above-approved.json', above_approve)
    high = server.vote(views['above'], 'bob', 'base')
    high = server.vote(high, 'carol', 'risk', decision='REJECT')
    assert high['request']['status'] == 'REJECTED'
    assert high['request']['routing'] == views['above']['request']['routing']
    assert server.vote(high, 'carol', 'risk', decision='REJECT') == high
    assert server.call('POST', BASE + '/documents', example('expense-routing-above'), key='expense-above', expected=201) == high
    for name, view in [('below-approved', low), ('equal-approved', equal), ('above-rejected', high), ('new-version', newer)]:
        receipt(name + '.json', view)
    snapshot = json.loads(state.read_bytes())
    assert snapshot['schemaVersion'] == 13
    receipt('expense-schema4-final.json', state.read_bytes())
    return {'status': 'PASS', 'backend': 'real packaged standalone Spring Boot 4.1.1', 'http_checks': server.count,
            'expense_exact_totals': ['0.29', '0.30', '0.31'], 'threshold': 'CNY 0.30 GTE',
            'currency_mismatch_no_write_and_reusable_key': True, 'skipped_actor_no_read_or_vote': True,
            'high_approve_and_reject': True, 'republish_frozen_old_request': True, 'restart_replay': True,
            'definition_schema': 4, 'route_schema': 1, 'json_wrapper': 13, 'new_endpoints': 0,
            'scenario_inbox': 'UI derives from actor-filtered list; domain/JDBC tests cover projections',
            'ruoyi_h5': 'unsupported; not exercised', 'synthetic_only': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jar', type=Path, required=True)
    parser.add_argument('--java', default='java')
    parser.add_argument('--output-dir', type=Path, help='Optional synthetic JSON receipts; never stores credentials or server log')
    args = parser.parse_args()
    jar = args.jar.resolve(strict=True)
    with zipfile.ZipFile(jar) as packaged:
        for name in ('spring-boot-4.1.1.jar', 'spring-boot-jackson2-4.1.1.jar'):
            assert 'BOOT-INF/lib/' + name in packaged.namelist(), ('Unexpected runtime', name)
    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
    def receipt(name, body):
        if args.output_dir:
            target = args.output_dir / name
            if isinstance(body, bytes):
                target.write_bytes(body)
            else:
                target.write_text(json.dumps(body, indent=2, ensure_ascii=False) + '\n')
    with tempfile.TemporaryDirectory(prefix='arcflow-expense-http-') as temporary:
        server = Backend(jar, args.java, Path(temporary))
        try:
            server.start()
            result = verify(server, receipt)
            receipt('verification.json', result)
            print(json.dumps(result, indent=2))
        finally:
            server.stop()


if __name__ == '__main__':
    main()
