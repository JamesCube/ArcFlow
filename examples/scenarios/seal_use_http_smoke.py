#!/usr/bin/env python3
"""Exercise synthetic Seal review against a disposable packaged backend and real restarts.

Uses only loopback HTTP, random throwaway passwords and temporary local snapshots.
Does not stamp, sign, upload, fetch document references or contact an external service.
Build the repository's supported standalone backend first; this is not a mock server.
"""
import argparse
import base64
import copy
import http.client
import json
import os
import pathlib
import secrets
import socket
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
import zipfile


SEAL = '/api/scenarios/oa-seal-use'
EXPENSE = '/api/scenarios/oa-expense'
BUSINESS_FIELDS = {
    'type', 'documentVersion', 'businessId', 'title', 'reason',
    'documentName', 'documentRef', 'sealType', 'copyCount',
}


def seal_input(version=1):
    return {
        'business': {
            'type': 'sealUse', 'documentVersion': 1, 'businessId': 'SEAL-HTTP-001',
            'title': 'Synthetic seal-use request',
            'reason': 'Review synthetic delivery documents only',
            'documentName': 'Synthetic delivery statement', 'documentRef': 'DEMO-DOC-001',
            'sealType': 'OFFICIAL', 'copyCount': 2,
        },
        'processVersion': version,
    }


def expense_input():
    return {
        'business': {
            'type': 'expense', 'documentVersion': 1, 'businessId': 'EXP-SEAL-CONTROL',
            'title': 'Expense isolation control', 'reason': 'Synthetic receipt only',
            'costCenter': 'ENGINEERING', 'currency': 'CNY',
            'lines': [{'lineId': 'line-1', 'spentOn': '2026-10-01', 'category': 'OFFICE',
                       'description': 'Demo stationery', 'amount': .1, 'receiptRef': 'R-SEAL-CONTROL'}],
        },
        'processVersion': 1,
    }


def assert_seal_view(view, status=None):
    assert set(view) == {'request', 'total'}, view
    assert view['total'] is None, 'Seal must explicitly return total: null, never zero or money'
    request = view['request']
    assert request['processId'] == 'oa-seal-use' and request['days'] == 0, request
    assert set(request['business']) == BUSINESS_FIELDS, request['business']
    assert request['business']['type'] == 'sealUse'
    assert type(request['business']['documentVersion']) is int and request['business']['documentVersion'] == 1
    assert type(request['business']['copyCount']) is int and 1 <= request['business']['copyCount'] <= 100
    assert not {'amount', 'currency', 'unitPrice', 'total', 'lines'} & set(request), request
    if status is not None:
        assert request['status'] == status, request
    return request


def verify_packaged_runtime(jar):
    """Do not accidentally turn a successful downgraded host into acceptance evidence."""
    pom = pathlib.Path(__file__).resolve().parents[1] / 'approval-demo/backend/pom.xml'
    expected = ET.parse(pom).findtext('m:parent/m:version', namespaces={'m': 'http://maven.apache.org/POM/4.0.0'})
    with zipfile.ZipFile(jar) as package:
        libraries = {pathlib.PurePosixPath(name).name for name in package.namelist()
                     if name.startswith('BOOT-INF/lib/') and name.endswith('.jar')}
    assert f'spring-boot-{expected}.jar' in libraries, f'Packaged backend must use Spring Boot {expected}'
    assert f'spring-boot-jackson2-{expected}.jar' in libraries, 'Supported strict Jackson 2 bridge is required'
    assert all(name.endswith(f'-{expected}.jar') for name in libraries if name.startswith('spring-boot-'))
    return expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jar', required=True, type=pathlib.Path)
    parser.add_argument('--java', default='java')
    args = parser.parse_args()
    jar = args.jar.resolve(strict=True)
    boot_version = verify_packaged_runtime(jar)
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    passwords = {actor: secrets.token_urlsafe(24) for actor in ('alice', 'bob', 'carol')}
    environment = dict(os.environ, **{f'APPROVAL_{actor.upper()}_PASSWORD': value for actor, value in passwords.items()})
    checks = 0

    def call(actor, method, path, body=None, expected=200, key=None, *, raw=None, headers=(), client=True,
             content_type='application/json'):
        nonlocal checks
        assert body is None or raw is None, 'Supply one body representation'
        payload = (raw if isinstance(raw, bytes) else raw.encode('utf-8')) if raw is not None else None if body is None else json.dumps(body, ensure_ascii=True).encode('utf-8')
        outgoing = []
        if actor is not None:
            credentials = f'{actor}:{passwords.get(actor, "invalid-demo-password")}'.encode()
            outgoing.append(('Authorization', 'Basic ' + base64.b64encode(credentials).decode('ascii')))
        if client:
            outgoing.append(('X-Arcflow-Client', 'approval-demo'))
        if key is not None:
            outgoing.append(('Idempotency-Key', key))
        if payload is not None:
            outgoing.extend((('Content-Type', content_type), ('Content-Length', str(len(payload)))))
        outgoing.extend(headers)
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
        try:
            connection.putrequest(method, path)
            for name, value in outgoing:
                connection.putheader(name, value)  # Preserve repeated Idempotency-Key header lines.
            connection.endheaders(payload)
            response = connection.getresponse()
            status, response_body = response.status, response.read()
        finally:
            connection.close()
        assert status == expected, (method, path, status, expected, response_body.decode('utf-8', errors='replace'))
        checks += 1
        if not response_body:
            return None
        try:
            return json.loads(response_body)
        except json.JSONDecodeError:
            if status < 400:
                raise
            return None  # Container/firewall errors need not use the application's JSON envelope.

    with tempfile.TemporaryDirectory(prefix='arcflow-seal-http-') as temporary:
        root = pathlib.Path(temporary)
        data_file = root / 'state.json'
        seal_file = root / 'state.json.scenario-oa-seal-use.json'
        expense_file = root / 'state.json.scenario-oa-expense.json'
        process = None
        log = None

        def stop():
            nonlocal process, log
            if process is not None:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                process = None
            if log is not None:
                log.close()
                log = None

        def start():
            nonlocal process, log
            log = (root / 'server.log').open('ab')
            process = subprocess.Popen([
                args.java, '-jar', str(jar), f'--server.port={port}', '--server.address=127.0.0.1',
                f'--approval.data-file={data_file}',
            ], cwd=root, env=environment, stdout=log, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError('Disposable backend exited before readiness')
                try:
                    assert call('alice', 'GET', '/api/me')['id'] == 'alice'
                    return
                except (ConnectionError, TimeoutError, OSError, http.client.HTTPException):
                    time.sleep(.1)
            raise RuntimeError('Disposable backend did not become ready within 60 seconds')

        def decision(actor, view, step, action, expected=200, route=SEAL):
            return call(actor, 'POST', route + '/requests/' + view['request']['id'] + '/decisions',
                        {'stepId': step, 'decision': action, 'comment': 'Synthetic review only'}, expected)

        def assert_isolation(expense_view, expense_bytes):
            assert call('alice', 'GET', EXPENSE + '/requests') == [expense_view]
            assert expense_file.read_bytes() == expense_bytes, 'Seal operations must not rewrite Expense storage'
            expense_state = json.loads(expense_bytes)
            assert expense_state['schemaVersion'] == 7
            assert all(request['business']['type'] == 'expense' for request in expense_state['requests'])
            for actor in ('alice', 'bob', 'carol'):
                assert call(actor, 'GET', '/api/requests') == []
                assert call(actor, 'GET', '/api/crm/requests') == []
                for box in ('PENDING', 'HANDLED'):
                    assert call(actor, 'GET', '/api/requests/inbox?box=' + box)['items'] == []

        try:
            start()
            catalog = call('alice', 'GET', '/api/scenarios')
            assert [item['id'] for item in catalog] == ['erp-receiving', 'oa-expense', 'oa-seal-use', 'oa-travel']
            assert catalog[1]['lineItems']['maxItems'] == 20
            template = catalog[2]
            assert template['documentType'] == 'sealUse' and template['documentVersion'] == 1
            assert template['formVersion'] == 1 and template['lineItems'] is None
            fields = [field for section in template['sections'] for field in section['fields']]
            assert len(fields) == 7 and {field['path'] for field in fields} == BUSINESS_FIELDS - {'type', 'documentVersion'}
            count_field = next(field for field in fields if field['path'] == 'copyCount')
            assert count_field['kind'] == 'integer' and count_field['maxLength'] == 16
            definition = call('alice', 'GET', SEAL + '/process')
            assert definition['id'] == 'oa-seal-use' and definition['schemaVersion'] == 2
            assert [(node['id'], node['assigneeId']) for node in definition['nodes'][1:-1]] == [('documentReview', 'bob'), ('sealReview', 'carol')]

            # Create an independent monetary control before any Seal mutation.
            expense = call('alice', 'POST', EXPENSE + '/documents', expense_input(), 201, 'shared-local-key')
            assert expense['total'] == '0.10'
            expense_bytes = expense_file.read_bytes()
            assert_isolation(expense, expense_bytes)

            # A real schema-2 Seal publication is reopened before the first schema-9 document.
            seeded_definition = copy.deepcopy(definition)
            seeded_definition['name'] = 'Synthetic Seal review before typed storage'
            definition = call('alice', 'POST', SEAL + '/process', {'expectedVersion': 1, 'definition': seeded_definition})
            assert definition == dict(seeded_definition, version=2)
            before_upgrade = seal_file.read_bytes()
            assert json.loads(before_upgrade)['schemaVersion'] == 2
            stop()
            start()
            assert seal_file.read_bytes() == before_upgrade, 'Opening schema 2 must not rewrite it'
            body = seal_input(2)

            for path in ('/api/scenarios', SEAL + '/process', SEAL + '/requests'):
                call(None, 'GET', path, expected=401)
            call(None, 'POST', SEAL + '/documents', body, 401, 'unauthenticated')
            call('unknown', 'POST', SEAL + '/documents', body, 401, 'unknown-principal')
            call('alice', 'POST', SEAL + '/documents', body, 403, 'missing-client', client=False)
            call('alice', 'POST', SEAL + '/documents', body, 403, 'foreign-origin', headers=(('Origin', 'https://attacker.example'),))
            call('alice', 'POST', SEAL + '/documents', body, 403, 'cross-site', headers=(('Sec-Fetch-Site', 'cross-site'),))
            call('alice', 'POST', SEAL + '/documents', body, 400)
            for key in ('', ' ', 'a,b', 'a/b', '_a', 'a' * 129):
                call('alice', 'POST', SEAL + '/documents', body, 400, key)
            for second in ('one', 'two'):
                call('alice', 'POST', SEAL + '/documents', body, 400, 'one', headers=(('Idempotency-Key', second),))
            for actor in ('bob', 'carol'):
                call(actor, 'POST', SEAL + '/documents', body, 400, 'self-review')

            compact = json.dumps(body, separators=(',', ':'))
            for field, original in (('copyCount', 2), ('documentVersion', 1), ('processVersion', 2)):
                for raw_value in ('1.0', '1e0', '"1"', 'true', 'null', '0', '-1', '1.5', '2147483648', '{}', '[]'):
                    raw = compact.replace(f'"{field}":{original}', f'"{field}":{raw_value}')
                    call('alice', 'POST', SEAL + '/documents', expected=400, key='bad-integer', raw=raw)
            invalid = copy.deepcopy(body)
            invalid['business']['copyCount'] = 101
            call('alice', 'POST', SEAL + '/documents', invalid, 400, 'bad-count')
            for field in BUSINESS_FIELDS:
                for missing in (True, False):
                    invalid = copy.deepcopy(body)
                    if missing:
                        del invalid['business'][field]
                    else:
                        invalid['business'][field] = None
                    call('alice', 'POST', SEAL + '/documents', invalid, 400, 'bad-shape')
            for field in ('business', 'processVersion'):
                invalid = copy.deepcopy(body)
                del invalid[field]
                call('alice', 'POST', SEAL + '/documents', invalid, 400, 'bad-envelope')
            for field in ('applicantId', 'approverId', 'processId', 'total', 'currency', 'amount', 'purpose', 'signature', 'sealImage'):
                for nested in (False, True):
                    invalid = copy.deepcopy(body)
                    (invalid['business'] if nested else invalid)[field] = 'forged'
                    call('alice', 'POST', SEAL + '/documents', invalid, 400, 'spoofed')
            for field in ('type', 'documentVersion', 'documentRef', 'copyCount'):
                token = f'"{field}":' + json.dumps(body['business'][field], separators=(',', ':'))
                call('alice', 'POST', SEAL + '/documents', expected=400, key='duplicate-json', raw=compact.replace(token, token + ',' + token))
            for raw in (compact + ' {}', compact + ' null', '[]', 'null', '', ' ', '{}', '{"business":'):
                call('alice', 'POST', SEAL + '/documents', expected=400, key='trailing-json', raw=raw)
            # Count the complete decoded envelope in UTF-16, before parsing or replay.
            # The supplementary title makes this boundary differ from bytes/code points.
            oversized_body = copy.deepcopy(body)
            oversized_body['business']['title'] = '\U0001f600' * 60
            oversized = json.dumps(oversized_body, ensure_ascii=False, separators=(',', ':'))
            utf16_units = len(oversized.encode('utf-16-le')) // 2
            oversized += ' ' * (8_000_001 - utf16_units)
            assert len(oversized.encode('utf-16-le')) // 2 == 8_000_001
            call('alice', 'POST', SEAL + '/documents', expected=400, key='oversized-envelope', raw=oversized)
            for content_type in ('application/vnd.arcflow+json', 'application/problem+json', 'text/plain'):
                rejected_media = call('alice', 'POST', SEAL + '/documents', body, 415, 'media-fallback', content_type=content_type)
                assert isinstance(rejected_media.get('message'), str), 'Media errors must resolve to JSON without a denied /error dispatch'
            call(None, 'POST', SEAL + '/documents', body, 401, 'media-auth', content_type='text/plain')
            call('alice', 'POST', SEAL + '/documents', body, 403, 'media-client', client=False, content_type='text/plain')
            for field in ('title', 'reason', 'documentName'):
                malformed = copy.deepcopy(body)
                malformed['business'][field] = 'UTF8_MARKER'
                encoded = json.dumps(malformed).encode('utf-8')
                for invalid_bytes in (b'\xff', b'\xc3(', b'\xc0\xaf', b'\xed\xa0\x80', b'\xf4\x90\x80\x80'):
                    call('alice', 'POST', SEAL + '/documents', expected=400, key='invalid-utf8',
                         raw=encoded.replace(b'UTF8_MARKER', invalid_bytes))
            for field, values in {
                'documentName': ('', '\x00', '\u00a0\u0085\ufeff', 'x' * 161, 'x' * 160 + ' '),
                'title': ('x' * 121, '\ufeff'), 'reason': ('x' * 2001, '\u2007'),
                'businessId': (' bad', '_bad', 'a' * 129),
                'documentRef': (' bad', 'bad ', 'a?b', 'a#b', '文档', 'a' * 129),
                'sealType': ('official', 'OFFICIAL ', 'PERSONAL'),
            }.items():
                for value in values:
                    invalid = copy.deepcopy(body)
                    invalid['business'][field] = value
                    call('alice', 'POST', SEAL + '/documents', invalid, 400, 'bad-field')
            assert call('alice', 'GET', SEAL + '/requests') == []
            assert seal_file.read_bytes() == before_upgrade, 'Rejected commands must not mutate storage or bind keys'

            original = call('alice', 'POST', SEAL + '/documents', body, 201, 'shared-local-key')
            original_request = assert_seal_view(original, 'PENDING')
            assert original_request['applicantId'] == 'alice' and original_request['currentStepId'] == 'documentReview'
            assert original_request['business'] == body['business'] and original_request['definition'] == definition
            assert call('alice', 'POST', SEAL + '/documents', body, 201, 'shared-local-key') == original
            assert json.loads(seal_file.read_bytes())['schemaVersion'] == 9
            backup = root / 'state.json.scenario-oa-seal-use.json.schema2.bak'
            assert backup.read_bytes() == before_upgrade, 'Schema-9 upgrade must retain the exact original schema-2 bytes'

            for route in (EXPENSE, '/api', '/api/crm', '/api/scenarios/oa-travel', '/api/scenarios/erp-receiving'):
                # CRM must reject the Seal body itself, rather than its separate key policy.
                call('alice', 'POST', route + '/documents', body, 400, None if route == '/api/crm' else 'wrong-host')
                decision('bob', original, 'documentReview', 'APPROVE', 404, route)
            call('alice', 'POST', SEAL + '/documents', expense_input(), 400, 'wrong-type')
            for wrong_type in ('leave', 'procurement', 'quoteDiscount', 'travel', 'sealuse'):
                invalid = copy.deepcopy(body)
                invalid['business']['type'] = wrong_type
                call('alice', 'POST', SEAL + '/documents', invalid, 400, 'wrong-type')
            decision('bob', expense, 'manager', 'APPROVE', 404)
            for scenario_id in ('oa-seal', 'not-registered', 'state.json', 'oa-seal-use.json'):
                call('alice', 'GET', '/api/scenarios/' + scenario_id + '/process', expected=404)
                call('alice', 'POST', '/api/scenarios/' + scenario_id + '/documents', body, 404, 'unknown-route')
            decision('alice', original, 'documentReview', 'APPROVE', 403)
            decision('carol', original, 'documentReview', 'APPROVE', 403)
            decision('carol', original, 'sealReview', 'APPROVE', 409)
            intermediate = decision('bob', original, 'documentReview', 'APPROVE')
            assert_seal_view(intermediate, 'PENDING')
            assert intermediate['request']['currentStepId'] == 'sealReview'
            assert decision('bob', original, 'documentReview', 'APPROVE') == intermediate

            for wrong_id in ('oa-expense', 'quote-discount', 'leave-approval', 'oa-travel'):
                invalid_definition = dict(definition, id=wrong_id)
                call('alice', 'POST', SEAL + '/process', {'expectedVersion': 2, 'definition': invalid_definition}, 400)
            assert call('alice', 'GET', SEAL + '/process') == definition
            next_definition = copy.deepcopy(definition)
            next_definition['name'] = 'Updated synthetic Seal review'
            next_definition['nodes'][1]['name'] = 'Updated document-review label'
            publication = {'expectedVersion': 2, 'definition': next_definition}
            call('bob', 'POST', SEAL + '/process', publication, 403)
            call('carol', 'POST', SEAL + '/process', publication, 403)
            published = call('alice', 'POST', SEAL + '/process', publication)
            assert published == dict(next_definition, version=3)
            call('alice', 'POST', SEAL + '/process', publication, 409)
            call('alice', 'POST', SEAL + '/documents', body, 409, 'stale-new')
            for field, value in {
                'businessId': 'SEAL-HTTP-CHANGED', 'title': 'Changed title', 'reason': 'Changed purpose',
                'documentName': 'Changed document', 'documentRef': 'DEMO-CHANGED', 'sealType': 'CONTRACT', 'copyCount': 3,
            }.items():
                changed = copy.deepcopy(body)
                changed['business'][field] = value
                call('alice', 'POST', SEAL + '/documents', changed, 409, 'shared-local-key')
            call('alice', 'POST', SEAL + '/documents', dict(body, processVersion=3), 409, 'shared-local-key')
            approved = decision('carol', original, 'sealReview', 'APPROVE')
            assert_seal_view(approved, 'APPROVED')
            assert approved['request']['business'] == original_request['business']
            assert approved['request']['definition'] == definition and approved['request']['processVersion'] == 2
            assert len(approved['request']['history']) == 3 and approved['request']['currentStepId'] is None
            assert decision('bob', original, 'documentReview', 'APPROVE') == approved
            decision('carol', original, 'sealReview', 'REJECT', 409)

            rejected_body = seal_input(3)
            rejected_body['business'].update(sealType='CONTRACT', copyCount=1)
            created = call('alice', 'POST', SEAL + '/documents', rejected_body, 201, 'seal-reject-document')
            rejected = decision('bob', created, 'documentReview', 'REJECT')
            assert_seal_view(rejected, 'REJECTED')
            assert len(rejected['request']['history']) == 2 and rejected['request']['currentStepId'] is None
            decision('bob', created, 'documentReview', 'APPROVE', 409)
            decision('carol', created, 'sealReview', 'APPROVE', 409)

            pending_body = seal_input(3)
            pending_body['business'].update(sealType='FINANCE', copyCount=100)
            created = call('alice', 'POST', SEAL + '/documents', pending_body, 201, 'seal-resume')
            pending = decision('bob', created, 'documentReview', 'APPROVE')
            assert_seal_view(pending, 'PENDING')

            second_reject_body = seal_input(3)
            second_reject_body['business']['documentName'] = ' \tSynthetic delivery statement\n'
            created = call('alice', 'POST', SEAL + '/documents', second_reject_body, 201, 'seal-reject-seal')
            assert created['request']['business']['documentName'] == 'Synthetic delivery statement'
            decision('bob', created, 'documentReview', 'APPROVE')
            second_rejected = decision('carol', created, 'sealReview', 'REJECT')
            assert_seal_view(second_rejected, 'REJECTED')
            assert len(second_rejected['request']['history']) == 3
            assert_isolation(expense, expense_bytes)

            saved = seal_file.read_bytes()
            snapshot = json.loads(saved)
            assert snapshot['schemaVersion'] == 9 and len(snapshot['requests']) == 4 and len(snapshot['submissions']) == 4
            assert all(set(request['business']) == BUSINESS_FIELDS for request in snapshot['requests'])
            assert all(request['business']['type'] == 'sealUse' for request in snapshot['requests'])
            expected_views = {
                'shared-local-key': (body, approved), 'seal-reject-document': (rejected_body, rejected),
                'seal-resume': (pending_body, pending), 'seal-reject-seal': (second_reject_body, second_rejected),
            }
            stop()
            start()
            assert seal_file.read_bytes() == saved, 'Schema-9 reopen must be read-only'
            assert call('alice', 'GET', SEAL + '/process') == published
            for key, (submitted, expected_view) in expected_views.items():
                assert call('alice', 'POST', SEAL + '/documents', submitted, 201, key) == expected_view
                assert_seal_view(expected_view)
            assert decision('carol', approved, 'sealReview', 'APPROVE') == approved
            assert decision('bob', rejected, 'documentReview', 'REJECT') == rejected
            assert decision('carol', second_rejected, 'sealReview', 'REJECT') == second_rejected
            assert seal_file.read_bytes() == saved, 'Read/replay must not rewrite restored snapshots'
            assert_isolation(expense, expense_bytes)

            # A later publication cannot downgrade a restored schema-9 file.
            later = copy.deepcopy(published)
            later['name'] = 'Synthetic review after restart'
            final_definition = call('alice', 'POST', SEAL + '/process', {'expectedVersion': 3, 'definition': later})
            assert final_definition == dict(later, version=4)
            assert json.loads(seal_file.read_bytes())['schemaVersion'] == 9
            resumed = decision('carol', pending, 'sealReview', 'APPROVE')
            assert_seal_view(resumed, 'APPROVED')
            assert resumed['request']['definition'] == published and resumed['request']['business'] == pending['request']['business']
            assert len(resumed['request']['history']) == 3
            assert backup.read_bytes() == before_upgrade, 'Later writes must preserve the original upgrade backup'
            expected_views['seal-resume'] = (pending_body, resumed)
            final_bytes = seal_file.read_bytes()
            stop()
            start()
            assert call('alice', 'GET', SEAL + '/process') == final_definition
            for key, (submitted, expected_view) in expected_views.items():
                assert call('alice', 'POST', SEAL + '/documents', submitted, 201, key) == expected_view
            views = call('alice', 'GET', SEAL + '/requests')
            assert len(views) == 4
            assert {view['request']['id'] for view in views} == {view['request']['id'] for _, view in expected_views.values()}
            for view in views:
                assert_seal_view(view)
            assert seal_file.read_bytes() == final_bytes
            assert json.loads(final_bytes)['schemaVersion'] == 9
            assert backup.read_bytes() == before_upgrade
            assert_isolation(expense, expense_bytes)
            print(f'Seal-use real-HTTP smoke passed on Boot {boot_version}: {checks} checks; strict nine-field input, '
                  'explicit null total, both review/rejection stages, pinned intent, schema-9 upgrade/restarts and byte-exact Expense isolation. '
                  'Synthetic approval only; no seal or signature applied.')
        except Exception:
            stop()
            log_file = root / 'server.log'
            if log_file.exists():
                print('Disposable backend log tail:\n' + log_file.read_text(errors='replace')[-12000:])
            raise
        finally:
            stop()


if __name__ == '__main__':
    main()
