"""Travel-only graph acceptance through real native sessions; invoked by smoke.py.

No mocked users, tokens, storage or HTTP. This is authored coverage, not evidence
of a pass until the packaged official host and services actually run it.
"""
import json
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote
from fixture import actor_state, connection

BASE = '/arcflow/graphs/travel'


def run(server, password, api, data, login):
    tokens = {name: login('arcflow_' + name, password)
              for name in ('applicant', 'first', 'second', 'outsider', 'nopermission')}
    a, first, second, outsider, none = (tokens[n] for n in tokens)
    admin = login('admin', password)
    sequential_file = server.directory / 'approval.json'
    sequential_bytes = sequential_file.read_bytes()
    sequential = data('/arcflow/requests', a)
    process = data(BASE + '/process', a)
    assert process['id'] == 'travel-graph' and process['schemaVersion'] == 6
    assert {member for node in process['nodes'] for member in node['assigneeIds']} == {'101', '102'}
    assert all(set(node) == {'id', 'type', 'name', 'assigneeIds', 'completionMode', 'pairId'} for node in process['nodes'])
    capabilities = data(BASE + '/capabilities', a)
    assert capabilities['permissions'] == {'canPublish': False, 'canSubmit': True, 'canDecide': True}
    assert data(BASE + '/capabilities', admin)['permissions']['canPublish']
    assert all(person['id'].isdigit() and person['id'] != '104' for person in data(BASE + '/users', a))
    for suffix in ('/process', '/capabilities', '/users', '/requests'):
        api(BASE + suffix, allowed=(401,))
        api(BASE + suffix, none, allowed=(403,))
    api(BASE + '/workspace', a, allowed=(403,))
    workspace = data(BASE + '/workspace', admin)
    assert workspace['storageSchemaVersion'] == 14 and workspace['requests'] == []

    def submission(identifier, amount=10000, version=None):
        return {'expectedVersion': version or process['version'], 'business': {
            'type': 'travel', 'documentVersion': 1, 'businessId': identifier,
            'title': 'Native graph CI', 'reason': 'Disposable native travel graph acceptance',
            'destination': 'Shanghai', 'startDate': '2028-02-28', 'endDate': '2028-03-01',
            'purpose': 'PROJECT_DELIVERY', 'estimatedCost': amount, 'currency': 'CNY', 'costCenter': 'ENGINEERING'}}

    def key(value):
        return [('Idempotency-Key', value)]

    def submit(payload, token=a, command='travel-submit', allowed=(200,)):
        return api(BASE + '/requests', token, payload, headers=key(command), allowed=allowed)

    def path(req, node):
        task = next(t for t in req['tasks'] if t['nodeId'] == node)
        return BASE + '/requests/' + req['id'] + '/tasks/' + quote(task['id'], safe='') + '/decision'

    def vote(req, node, token, command, action='APPROVE', allowed=(200,)):
        return api(path(req, node), token, {'decision': action, 'comment': 'Native graph CI'},
                   headers=key(command), allowed=allowed)

    payload = submission('NATIVE-GRAPH-HIGH')
    before = data(BASE + '/requests', a)
    for headers in ([], key(''), key('bad key'), key('duplicate') * 2):
        api(BASE + '/requests', a, payload, headers=headers, allowed=(400,))
    submit(payload, none, allowed=(403,))
    submit({**payload, 'actorId': '101'}, allowed=(400,))
    raw = json.dumps(payload).replace('10000', '10000.000000000000001').encode()
    api(BASE + '/requests', a, raw, headers=key('raw-subcent'), allowed=(400,))
    api('/arcflow/documents', a, {'business': payload['business'], 'processVersion': 1},
        headers=key('wrong-sequential-family'), allowed=(400,))
    assert data(BASE + '/requests', a) == before
    high = submit(payload)['data']
    assert high['applicantId'] == '100' and high['definition'] == process
    assert high == submit(payload)['data']
    submit(submission('CHANGED'), allowed=(409,))
    for unassigned in (outsider, admin, a, none):
        vote(high, 'manager', unassigned, 'denied', allowed=(403, 404))
    for headers in ([], key(''), key('duplicate') * 2):
        api(path(high, 'manager'), first, {'decision': 'APPROVE', 'comment': ''},
            headers=headers, allowed=(400,))
    high = vote(high, 'manager', first, 'manager')['data']
    assert high['status'] == 'PENDING'
    assert {t['nodeId'] for t in high['tasks'] if t['status'] == 'ACTIVE'} == {'operations', 'finance'}
    waiting = vote(high, 'operations', first, 'operations')['data']
    assert waiting['forks'][0]['fired'] is False and len(waiting['forks'][0]['arrivedBranchIds']) == 1
    assert vote(waiting, 'operations', first, 'operations')['data'] == waiting
    vote(waiting, 'operations', first, 'operations', 'REJECT', allowed=(409,))

    # New publication must not reinterpret a waiting v1 instance.
    draft = {'expectedRevision': workspace['draft']['revision'], 'definition': {**process, 'name': 'Native graph v2'}}
    api(BASE + '/draft', a, draft, method='PUT', allowed=(403,))
    for changed in ({'id': 'payment-graph'}, {'schemaVersion': 5}):
        api(BASE + '/draft', admin, {**draft, 'definition': {**process, **changed}}, method='PUT', allowed=(400,))
    saved = data(BASE + '/draft', admin, draft, method='PUT')
    api(BASE + '/draft', admin, draft, method='PUT', allowed=(409,))
    publication = {'expectedVersion': process['version'], 'expectedDraftRevision': saved['revision']}
    current = data(BASE + '/publish', admin, publication)
    api(BASE + '/publish', admin, publication, allowed=(409,))
    assert current['version'] == process['version'] + 1
    assert submit(payload)['data'] == waiting
    submit(submission('STALE'), command='stale', allowed=(409,))

    # Current database identity is authoritative even for cached valid sessions.
    for status, deleted in (('1', '0'), ('0', '2')):
        try:
            actor_state(102, status=status, deleted=deleted)
            api(BASE + '/process', second, allowed=(401, 403))
            vote(waiting, 'finance', second, 'finance', allowed=(401, 403))
            assert '102' not in {p['id'] for p in data(BASE + '/users', a)}
        finally:
            actor_state(102)
    with connection() as db, db.cursor() as cur:
        assert cur.execute('UPDATE sys_user_role SET role_id=21001 WHERE user_id=102 AND role_id=21000') == 1
    try:
        vote(waiting, 'finance', second, 'finance', allowed=(403,))
    finally:
        with connection() as db, db.cursor() as cur:
            assert cur.execute('UPDATE sys_user_role SET role_id=21000 WHERE user_id=102 AND role_id=21001') == 1

    # Actual JVM shutdown/reopen, not merely a second in-memory service.
    server.stop()
    graph_file = server.directory / 'approval.json.travel.graph.json'
    assert json.loads(graph_file.read_text())['storageSchemaVersion'] == 14
    assert sequential_file.read_bytes() == sequential_bytes
    server.start()
    a, first, second = (login('arcflow_' + n, password) for n in ('applicant', 'first', 'second'))
    assert data(BASE + '/requests/' + waiting['id'], a) == waiting
    assert api(BASE + '/requests', a, payload, headers=key('travel-submit'))['data'] == waiting
    assert vote(waiting, 'operations', first, 'operations')['data'] == waiting
    done = vote(waiting, 'finance', second, 'finance')['data']
    assert done['status'] == 'APPROVED' and done['forks'][0]['fired']
    assert done['definition'] == process and done['business'] == payload['business']
    assert vote(done, 'finance', second, 'finance')['data'] == done

    low = api(BASE + '/requests', a, submission('NATIVE-GRAPH-LOW', 9999.99, current['version']), headers=key('low'))['data']
    low = vote(low, 'manager', first, 'low-manager')['data']
    assert low['status'] == 'APPROVED' and low['forks'] == []
    rejected = api(BASE + '/requests', a, submission('NATIVE-GRAPH-REJECT', version=current['version']), headers=key('reject'))['data']
    rejected = vote(rejected, 'manager', first, 'reject-manager')['data']
    rejected = vote(rejected, 'finance', second, 'reject-finance', 'REJECT')['data']
    assert rejected['status'] == 'REJECTED' and not any(t['status'] == 'ACTIVE' for t in rejected['tasks'])
    vote(rejected, 'operations', first, 'too-late', allowed=(409,))

    concurrent = api(BASE + '/requests', a, submission('NATIVE-GRAPH-CAS', version=current['version']), headers=key('cas'))['data']
    concurrent = vote(concurrent, 'manager', first, 'cas-manager')['data']
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = [pool.submit(vote, concurrent, node, token, command)
                   for node, token, command in [('operations', first, 'cas-operations'), ('finance', second, 'cas-finance')]]
        for result in results:
            result.result()
    joined = data(BASE + '/requests/' + concurrent['id'], a)
    assert joined['status'] == 'APPROVED' and joined['forks'][0]['fired']
    assert len(joined['forks'][0]['arrivedBranchIds']) == 2 and len(joined['commands']) == 3
    assert data('/arcflow/requests', a) == sequential and sequential_file.read_bytes() == sequential_bytes
    # Corrupt this disposable graph's semantic state, then require the packaged
    # native application to fail for that exact cause (not port/DB/timeouts).
    server.stop()
    original_graph = graph_file.read_bytes()
    corrupt = json.loads(original_graph)
    assert corrupt['requests'], 'Corruption probe requires persisted instances'
    corrupt['requests'][-1]['status'] = 'CORRUPT-NATIVE-PROBE'
    damaged_bytes = json.dumps(corrupt).encode()
    log_file = server.directory / 'server.log'
    log_offset = log_file.stat().st_size
    try:
        graph_file.write_bytes(damaged_bytes)
        try:
            server.start()
        except AssertionError as failure:
            assert str(failure) == 'RuoYi exited during startup; inspect server.log', \
                'Corruption probe failed for a timeout or unrelated readiness assertion'
            assert server.proc.poll() not in (None, 0), 'Corruption probe did not exit unsuccessfully'
            diagnostic = log_file.read_bytes()[log_offset:].decode(errors='replace')
            assert 'Corrupt graph snapshot' in diagnostic and 'arcFlowTravelGraph' in diagnostic, \
                'Native failure did not identify the corrupted travel graph bean'
        else:
            raise AssertionError('Native host accepted a corrupt graph snapshot')
        assert graph_file.read_bytes() == damaged_bytes, 'Failed startup rewrote corrupt graph bytes'
        assert sequential_file.read_bytes() == sequential_bytes, 'Corrupt graph startup modified sequential state'
    finally:
        server.stop()
        graph_file.write_bytes(original_graph)
    server.start()
    a = login('arcflow_applicant', password)
    assert data(BASE + '/requests/' + joined['id'], a) == joined
    assert graph_file.read_bytes() == original_graph and sequential_file.read_bytes() == sequential_bytes
    print('PASS: native travel graph numeric identity/RBAC, strict keys/money, frozen publication, fork/join/rejection, concurrent CAS, real JVM restart/replay, corrupt-store fail-closed startup/recovery and sequential byte isolation')
