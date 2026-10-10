#!/usr/bin/env python3
"""Verify published JSON examples against a disposable, real standalone backend.

No existing server or data path is accepted. Credentials are generated in memory;
the jar is launched on loopback, restarted once, and stopped in all outcomes.
"""
import argparse
import base64
import copy
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import zipfile
from verify_developer_docs import unique_json
import urllib.error
import urllib.request
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / 'docs/api/examples'
CASES = [
    ('leave', '/api', False, True),
    ('procurement', '/api', False, True),
    ('quote-discount', '/api/crm', True, False),
    ('expense', '/api/scenarios/oa-expense', True, True),
    ('travel', '/api/scenarios/oa-travel', True, True),
    ('seal-use', '/api/scenarios/oa-seal-use', True, True),
    ('receiving', '/api/scenarios/erp-receiving', True, True),
    ('payment', '/api/scenarios/erp-payment', True, True),
    ('contract', '/api/scenarios/crm-contract', True, True),
]


def sample(name):
    return unique_json(EXAMPLES / (name + '.json'))


def raw_sample(name):
    # Preserve JSON numeric tokens such as 1.000 and -0 for the real HTTP decoder.
    return (EXAMPLES / (name + '.json')).read_bytes()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jar', type=Path, required=True)
    parser.add_argument('--java', default='java')
    args = parser.parse_args()
    jar = args.jar.resolve(strict=True)
    with zipfile.ZipFile(jar) as packaged:
        for library in ("spring-boot-4.1.1.jar", "spring-boot-jackson2-4.1.1.jar"):
            assert "BOOT-INF/lib/" + library in packaged.namelist(), ("Unexpected backend runtime", library)
    passwords = {a: secrets.token_urlsafe(24) for a in ('alice', 'bob', 'carol')}
    env = dict(os.environ, **{f'APPROVAL_{a.upper()}_PASSWORD': p for a, p in passwords.items()})
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    count = 0

    def call(actor, method, path, body=None, expected=200, key=None, client=True, origin=None, raw=None):
        nonlocal count
        headers = {}
        if actor:
            headers['Authorization'] = 'Basic ' + base64.b64encode(f'{actor}:{passwords[actor]}'.encode()).decode()
        if client:
            headers['X-Arcflow-Client'] = 'approval-demo'
        if origin is not None:
            headers['Origin'] = origin
        if key is not None:
            headers['Idempotency-Key'] = key
        if body is not None:
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(base + path, method=method, headers=headers,
                                     data=raw if raw is not None else None if body is None else json.dumps(body, ensure_ascii=False).encode())
        try:
            with opener.open(req, timeout=10) as response:
                status, payload = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, payload = error.code, error.read()
        assert status == expected, (method, path, status, expected, payload.decode())
        count += 1
        return json.loads(payload) if payload else None

    def request(view):
        return view.get('request', view)

    def finish(route, view):
        """Use the saved step/participants, never an actor or route supplied by a form."""
        attempts = 0
        while request(view)['status'] == 'PENDING':
            attempts += 1
            assert attempts <= 16, 'Saved approval stages failed to advance within the supported bound'
            r = request(view)
            step = next(n for n in r['definition']['nodes'] if n['id'] == r['currentStepId'])
            participants = step.get('assigneeIds') or [step['assigneeId']]
            voted = {h['actorId'] for h in r['history'] if h['stepId'] == step['id']}
            actor = next(a for a in participants if a not in voted)
            vote = {'stepId': step['id'], 'decision': 'APPROVE', 'comment': 'Synthetic API example review'}
            path = route + '/requests/' + r['id'] + '/decisions'
            view = call(actor, 'POST', path, vote)
            assert view == call(actor, 'POST', path, vote), 'Same vote must replay without extra history'
        assert request(view)['status'] == 'APPROVED'
        return view

    with tempfile.TemporaryDirectory(prefix='arcflow-api-docs-') as tmp:
        directory = Path(tmp)
        process = None
        log = None

        def stop():
            nonlocal process, log
            if process is not None:
                process.terminate()
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)
                process = None
            if log is not None:
                log.close()
                log = None

        def start():
            nonlocal process, log
            log = (directory / 'server.log').open('ab')
            process = subprocess.Popen([args.java, '-jar', str(jar), f'--server.port={port}',
                                        '--server.address=127.0.0.1', f'--approval.data-file={directory / "state.json"}',
                                        '--approval.ui-origin=http://localhost:5173'],
                                       cwd=directory, env=env, stdout=log, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError('Disposable backend exited before readiness')
                try:
                    call('alice', 'GET', '/api/me')
                    return
                except urllib.error.URLError:
                    time.sleep(.1)
            raise RuntimeError('Disposable backend did not become ready')

        try:
            start()
            call(None, 'GET', '/api/me', expected=401)
            assert {p['id'] for p in call('alice', 'GET', '/api/people')} == {'alice', 'bob', 'carol'}
            catalog = call('alice', 'GET', '/api/scenarios')
            assert {s['id'] for s in catalog} == {'oa-expense', 'oa-travel', 'oa-seal-use', 'erp-receiving', 'erp-payment', 'crm-contract'}
            assert call('alice', 'GET', '/api/crm/quotes')[0]['businessId'] == 'Q-DEMO-001'
            legacy_body = sample('legacy-leave')
            call('alice', 'POST', '/api/requests', legacy_body, 403, client=False)
            call('alice', 'POST', '/api/requests', legacy_body, 403, origin='https://untrusted.invalid')
            legacy = call('alice', 'POST', '/api/requests', legacy_body, 201, 'docs-legacy', origin='http://localhost:5173', raw=raw_sample('legacy-leave'))
            assert legacy == call('alice', 'POST', '/api/requests', legacy_body, 201, 'docs-legacy')
            call('carol', 'POST', '/api/requests/' + legacy['id'] + '/decisions',
                 {'stepId': legacy['currentStepId'], 'decision': 'APPROVE'}, 404)
            call('alice', 'POST', '/api/requests', dict(legacy_body, applicantId='bob'), 400, 'forged-actor')
            legacy = finish('/api', legacy)
            saved = []
            for name, route, wrapped, keyed in CASES:
                body = sample(name)
                assert call('alice', 'GET', route + '/process')['version'] == body['processVersion']
                key = 'docs-' + name if keyed else None
                if route.startswith('/api/scenarios/'):
                    call('alice', 'POST', route + '/documents', body, 400)
                    call('alice', 'POST', '/api/documents', body, 400, 'wrong-host-' + name)
                if route == '/api/crm':
                    call('alice', 'POST', route + '/documents', body, 400, 'not-accepted')
                view = call('alice', 'POST', route + '/documents', body, 201, key, raw=raw_sample(name))
                r = request(view)
                if name in {'expense', 'travel', 'payment', 'contract'}:
                    assert view['total'] == {'expense': '0.30', 'travel': '2800.29', 'payment': '6500.00', 'contract': '100000.00'}[name]
                if name == 'quote-discount':
                    assert (view['requestedTotal'], view['reductionTotal'], view['discountPercent']) == ('8500.00', '1500.00', '15')
                assert ('request' in view) == wrapped
                assert r['business']['type'] == body['business']['type']
                assert view == call('alice', 'POST', route + '/documents', body, 201, key)
                changed = copy.deepcopy(body)
                changed['business']['reason'] += ' changed'
                call('alice', 'POST', route + '/documents', changed, 409, key)
                call('alice', 'POST', route + '/requests/' + r['id'] + '/decisions',
                     {'stepId': r['currentStepId'], 'decision': 'APPROVE'}, 403)
                approved = finish(route, view)
                assert request(approved)['business'] == r['business']
                assert request(approved)['definition'] == r['definition']
                assert approved == call('alice', 'POST', route + '/documents', body, 201, key)
                assert any(request(v)['id'] == r['id'] for v in call('alice', 'GET', route + '/requests'))
                saved.append((route, body, key, approved))
            raw_money = raw_sample('expense').replace(b'0.1,', b'0.100,')
            assert raw_money != raw_sample('expense')
            call('alice', 'POST', '/api/scenarios/oa-expense/documents', sample('expense'), 400, 'raw-money-precision', raw=raw_money)
            raw_receiving = raw_sample('receiving').replace(b'\"rejected\": 0,', b'\"rejected\": -0,')
            assert raw_receiving != raw_sample('receiving')
            call('alice', 'POST', '/api/scenarios/erp-receiving/documents', sample('receiving'), 400, 'raw-negative-zero', raw=raw_receiving)
            inbox = call('bob', 'GET', '/api/requests/inbox?box=HANDLED&limit=2')
            assert len(inbox['items']) == 2 and inbox['nextCursor']
            call('bob', 'GET', '/api/requests/inbox?box=HANDLED&limit=2&cursor=' + urllib.parse.quote(inbox['nextCursor']))
            call('bob', 'GET', '/api/requests/inbox?box=INVALID', expected=400)

            publication = sample('publish-all')
            call('bob', 'POST', '/api/process', publication, 403)
            assert call('alice', 'POST', '/api/process', publication, raw=raw_sample('publish-all'))['version'] == 2
            call('alice', 'POST', '/api/process', publication, 409)
            call('alice', 'POST', '/api/requests', legacy_body, 409, 'new-stale-version')
            group_body = dict(sample('legacy-leave'), processVersion=2)
            group = call('alice', 'POST', '/api/requests', group_body, 201, 'group-all')
            path = '/api/requests/' + group['id'] + '/decisions'
            vote = {'stepId': 'team', 'decision': 'APPROVE', 'comment': 'Synthetic ALL vote'}
            partial = call('bob', 'POST', path, vote)
            assert partial['status'] == 'PENDING'
            call('bob', 'POST', path, dict(vote, decision='REJECT'), 409)
            assert finish('/api', partial)['status'] == 'APPROVED'
            publication['expectedVersion'] = publication['definition']['version'] = 2
            publication['definition']['nodes'][1]['completionMode'] = 'ANY'
            assert call('alice', 'POST', '/api/process', publication)['version'] == 3
            any_group = call('alice', 'POST', '/api/requests', dict(group_body, processVersion=3), 201, 'group-any')
            path = '/api/requests/' + any_group['id'] + '/decisions'
            partial = call('bob', 'POST', path, dict(vote, decision='REJECT'))
            assert partial['status'] == 'PENDING'
            assert finish('/api', partial)['status'] == 'APPROVED'

            # Every supported conditional fact is tested with its actual business host.
            conditional = []
            for name, scenario_id, predicate in [
                ('payment', 'erp-payment', {'field': 'payment.netTotal', 'operator': 'GTE', 'currency': 'CNY', 'threshold': 10000}),
                ('receiving', 'erp-receiving', {'field': 'receiving.hasRejectedLines', 'operator': 'EQ', 'expected': True}),
                ('contract', 'crm-contract', {'field': 'contract.termsKind', 'operator': 'EQ', 'values': ['NONSTANDARD']}),
            ]:
                pub = sample('publish-payment-routing')
                pub['definition']['id'] = scenario_id
                pub['definition']['nodes'][2]['runIf']['predicates'] = [predicate]
                route = '/api/scenarios/' + scenario_id
                assert call('alice', 'POST', route + '/process', pub, raw=raw_sample('publish-payment-routing') if name == 'payment' else None)['version'] == 2
                body = sample(name)
                body['processVersion'] = 2
                v = call('alice', 'POST', route + '/documents', body, 201, 'conditional-' + name)
                selected = ['base', 'final'] if name == 'payment' else ['base', 'risk', 'final']
                assert v['request']['routing']['stepIds'] == selected
                conditional.append((route, body, 'conditional-' + name, finish(route, v)))
            # Expense is a fourth finite fact using the existing immutable multi-line document.
            expense_route = '/api/scenarios/oa-expense'
            expense_pub = sample('publish-expense-routing')
            assert call('alice', 'POST', expense_route + '/process', expense_pub,
                        raw=raw_sample('publish-expense-routing'))['version'] == 2
            for boundary, total, steps in [('below', '0.29', ['base', 'final']),
                                           ('equal', '0.30', ['base', 'risk', 'final']),
                                           ('above', '0.31', ['base', 'risk', 'final'])]:
                name = 'expense-routing-' + boundary
                body = sample(name)
                view = call('alice', 'POST', expense_route + '/documents', body, 201, name, raw=raw_sample(name))
                assert view['total'] == total
                assert view['request']['routing']['stepIds'] == steps
                if boundary == 'below':
                    assert not any(v['request']['id'] == view['request']['id'] for v in call('carol', 'GET', expense_route + '/requests'))
                    call('carol', 'POST', expense_route + '/requests/' + view['request']['id'] + '/decisions',
                         {'stepId': 'risk', 'decision': 'APPROVE'}, 404)
                conditional.append((expense_route, body, name, finish(expense_route, view)))
            payment_route = '/api/scenarios/erp-payment'
            high = sample('payment')
            high['processVersion'] = 2
            high['business']['lines'][0].update(invoiceAmount=15000, previouslySettledAmount=0, allocationAmount=15000)
            high_view = call('alice', 'POST', payment_route + '/documents', high, 201, 'conditional-payment-high')
            assert high_view['request']['routing']['stepIds'] == ['base', 'risk', 'final']
            foreign = copy.deepcopy(high)
            foreign['business']['currency'] = 'USD'
            call('alice', 'POST', payment_route + '/documents', foreign, 400, 'currency-mismatch')
            stop()
            start()
            for route, body, key, approved in saved + conditional:
                assert approved == call('alice', 'POST', route + '/documents', body, 201, key)
            state = json.loads((directory / 'state.json.scenario-erp-payment.json').read_text())
            assert state['schemaVersion'] == 13
            print(json.dumps({'status': 'PASS', 'backend': 'real packaged standalone Spring Boot 4.1.1',
                              'http_checks': count, 'json_example_files': len(list(EXAMPLES.glob('*.json'))),
                              'business_types': 9, 'scenario_catalog_entries': 6,
                              'conditional_business_types': 4, 'restart': True,
                              'synthetic_only': True, 'browser': 'not run by this script',
                              'native_ruoyi': 'not run by this standalone script'}, indent=2))
        finally:
            stop()


if __name__ == '__main__':
    main()
