#!/usr/bin/env python3
"""Offline integrity/semantic gates for real native travel capture artifacts.

This does not create pixels or replace human visual review. It accepts only the
complete 24-capture matrix emitted by graph_capture.py, with native identities.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import zlib

STATES = ('designer', 'submitted', 'parallel', 'waiting', 'completed', 'rejected')
LOCALES = ('zh', 'en')
WIDTHS = (1440, 390)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def names():
    return {f'native-travel-{state}-{locale}-{width}' for state in STATES for locale in LOCALES for width in WIDTHS}


def validate_receipt(r):
    require(r['format'] == 1 and re.fullmatch('[0-9a-f]{40}', r['sourceCommit']), 'Invalid source identity')
    require(r['host'] == 'native-ruoyi' and r['scenario'] == 'travel' and r['route'] == '/arcflow/graph', 'Not native travel')
    state, locale, width = r['state'], r['locale'], r['viewport']['width']
    require(state in STATES and locale in LOCALES and width in WIDTHS, 'Unexpected matrix cell')
    require(r['viewport']['height'] == (1080 if width == 1440 else 844), 'Unexpected viewport')
    require(r['provenance'] == 'real-native-login-real-http-original-chromium-no-response-mocks', 'Wrong capture provenance')
    require(r['actor']['id'] == {'designer': '1', 'submitted': '100', 'parallel': '101', 'waiting': '101', 'completed': '102', 'rejected': '101'}[state], 'Wrong numeric native actor')
    require(set(r['actor']) == {'id', 'displayName'}, 'Unexpected actor metadata')
    definition, dom = r['definition'], r['dom']
    require(dom['actorId'] == r['actor']['id'] and r['actor']['displayName'] in dom['actorLabel'] and 'ID ' + r['actor']['id'] in dom['actorLabel'], 'DOM actor drift')
    require(definition['id'] == 'travel-graph' and definition['schemaVersion'] == 6 and definition['version'] >= 1, 'Wrong graph definition')
    require(dom['scenario'] == 'travel' and dom['definitionId'] == 'travel-graph' and dom['schema'] == 6 and dom['version'] == definition['version'], 'DOM definition drift')
    assignments = {actor for node in definition['nodes'] for actor in node['assigneeIds']}
    require(assignments == {'101', '102'}, 'Demo/non-native graph assignments')
    instance = r['instance']
    if state == 'designer':
        require(instance is None and dom['tasks'] == [] and dom['joins'] == [] and dom['events'] == [], 'Designer contains runtime state')
        return
    require(instance['applicantId'] == '100' and instance['definition'] == definition, 'Instance identity/definition drift')
    business = instance['business']
    reject = state == 'rejected'
    require(business['type'] == 'travel' and business['businessId'] == ('NATIVE-BROWSER-TRAVEL-REJECT' if reject else 'NATIVE-BROWSER-TRAVEL'), 'Wrong captured business')
    require(business['title'] == ('Native browser travel rejection' if reject else 'Native browser travel graph'), 'Wrong business title')
    require(business['currency'] == 'CNY' and business['estimatedCost'] == 10000, 'Wrong route amount')
    expected_status = 'APPROVED' if state == 'completed' else 'REJECTED' if reject else 'PENDING'
    require(instance['status'] == expected_status, 'Wrong terminal state')
    tasks, forks = instance['tasks'], instance['forks']
    expected_active = {'submitted': {'manager'}, 'parallel': {'operations', 'finance'}, 'waiting': {'finance'}, 'completed': set(), 'rejected': set()}[state]
    require({t['nodeId'] for t in tasks if t['status'] == 'ACTIVE'} == expected_active, 'Wrong active task set')
    require(dom['tasks'] == [{'id': t['id'], 'nodeId': t['nodeId'], 'status': t['status'], 'voteCount': len(t['votes'])} for t in tasks], 'DOM task drift')
    require(all(re.fullmatch('[1-9][0-9]*', a) for t in tasks for a in t['participants']), 'Non-numeric task actor')
    require(len({t['id'] for t in tasks}) == len(tasks), 'Duplicate task ID')
    require(dom['joins'] == [{'id': f['id'], 'fired': f['fired'], 'arrivedBranchIds': f['arrivedBranchIds'], 'expectedBranchIds': f['expectedBranchIds']} for f in forks], 'DOM join drift')
    if state == 'submitted':
        require(forks == [] and len(tasks) == 1, 'Submitted graph already branched')
    else:
        require(len(forks) == 1 and len(tasks) == 3, 'Missing fork/tasks')
        fork = forks[0]
        require(set(fork['expectedBranchIds']) == {'operationsBranch', 'financeBranch'}, 'Wrong parallel branches')
        require(len(fork['arrivedBranchIds']) == {'parallel': 0, 'waiting': 1, 'completed': 2, 'rejected': 0}[state], 'Wrong join arrivals')
        require(fork['fired'] == (state == 'completed'), 'Wrong join firing')
        require(any(route['selectedEdgeId'] == 'highCost' for route in instance['routes']), 'Missing real cost routing trace')
    expected_tasks = {
        'submitted': {'manager': ('ACTIVE', '101', None)},
        'parallel': {'manager': ('COMPLETED', '101', 'APPROVE'), 'operations': ('ACTIVE', '101', None), 'finance': ('ACTIVE', '102', None)},
        'waiting': {'manager': ('COMPLETED', '101', 'APPROVE'), 'operations': ('COMPLETED', '101', 'APPROVE'), 'finance': ('ACTIVE', '102', None)},
        'completed': {'manager': ('COMPLETED', '101', 'APPROVE'), 'operations': ('COMPLETED', '101', 'APPROVE'), 'finance': ('COMPLETED', '102', 'APPROVE')},
        'rejected': {'manager': ('COMPLETED', '101', 'APPROVE'), 'operations': ('REJECTED', '101', 'REJECT'), 'finance': ('CANCELLED', '102', None)},
    }[state]
    require({t['nodeId'] for t in tasks} == set(expected_tasks), 'Unexpected task nodes')
    expected_commands = []
    for node, (status, actor, decision) in expected_tasks.items():
        task = next(t for t in tasks if t['nodeId'] == node)
        require(task['status'] == status and task['participants'] == [actor] and task['completionMode'] == 'ALL', 'Wrong native assignment/task result')
        require([(v['actorId'], v['decision']) for v in task['votes']] == ([] if decision is None else [(actor, decision)]), 'Wrong native vote')
        if decision is not None:
            expected_commands.append((task['id'], actor, decision))
    require([(c['taskId'], c['actorId'], c['decision']) for c in instance['commands']] == expected_commands, 'Wrong decision command identity')
    if forks:
        require(set(forks[0]['arrivedBranchIds']) == ({'operationsBranch'} if state == 'waiting' else {'operationsBranch', 'financeBranch'} if state == 'completed' else set()), 'Wrong arrived branch identity')
    require(len(instance['commands']) == {'submitted': 0, 'parallel': 1, 'waiting': 2, 'completed': 3, 'rejected': 2}[state], 'Wrong durable command count')
    require(instance['commandRevision'] == len(instance['commands']), 'Command revision drift')
    require(bool(instance['events']), 'Missing execution trace')
    require(dom['events'] == [f"#{e['sequence']} {e['type']}" for e in instance['events']], 'DOM execution trace drift')
    if reject:
        require(any(t['nodeId'] == 'finance' and t['status'] == 'CANCELLED' for t in tasks), 'Rejection did not cancel finance')


def png_size(raw):
    require(raw[:8] == b'\x89PNG\r\n\x1a\n', 'Not original PNG format')
    offset, size, ended, compressed, bpp = 8, None, False, bytearray(), None
    while offset < len(raw):
        require(offset + 12 <= len(raw), 'Truncated PNG')
        length = struct.unpack('>I', raw[offset:offset + 4])[0]
        kind = raw[offset + 4:offset + 8]
        require(offset + 12 + length <= len(raw), 'Truncated PNG chunk')
        content = raw[offset + 8:offset + 8 + length]
        require(zlib.crc32(kind + content) & 0xffffffff == struct.unpack('>I', raw[offset + 8 + length:offset + 12 + length])[0], 'PNG CRC mismatch')
        if size is None:
            require(kind == b'IHDR' and length == 13, 'Missing PNG header')
            width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', content)
            require(width > 0 and height > 0 and depth == 8 and color in (2, 6) and compression == filtering == interlace == 0, 'Unsupported Chromium PNG format')
            size, bpp = (width, height), (3 if color == 2 else 4)
        elif kind == b'IHDR':
            raise ValueError('Duplicate PNG header')
        if kind == b'IDAT':
            compressed.extend(content)
        offset += length + 12
        if kind == b'IEND':
            require(length == 0, 'Invalid PNG end')
            ended = True
            break
    require(ended and offset == len(raw), 'PNG missing end or trailing bytes')
    require(bool(compressed), 'PNG has no pixel data')
    stride = 1 + size[0] * bpp
    expected = stride * size[1]
    require(expected <= 256_000_000, 'PNG exceeds capture size bound')
    try:
        decoder = zlib.decompressobj()
        pixels = decoder.decompress(compressed, expected + 1)
        require(decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail and len(pixels) == expected, 'Invalid PNG decoded pixel length')
    except zlib.error as error:
        raise ValueError('Invalid PNG compressed pixels') from error
    require(all(pixels[row * stride] <= 4 for row in range(size[1])), 'Invalid PNG scanline filter')
    return size


def verify_directory(directory, expected_commit=None):
    directory = Path(directory)
    expected = {name + suffix for name in names() for suffix in ('.png', '.json')}
    actual = {p.name for p in directory.glob('native-travel-*') if p.is_file()}
    require(actual == expected, 'Incomplete or unexpected native travel capture files')
    receipts, commits = [], set()
    for name in sorted(names()):
        r = json.loads((directory / (name + '.json')).read_text())
        validate_receipt(r)
        require(name == f"native-travel-{r['state']}-{r['locale']}-{r['viewport']['width']}", 'Filename/matrix mismatch')
        require(r['image']['file'] == name + '.png', 'Image path mismatch')
        raw = (directory / r['image']['file']).read_bytes()
        require(len(raw) == r['image']['bytes'] and hashlib.sha256(raw).hexdigest() == r['image']['sha256'], 'Image integrity mismatch')
        width, height = png_size(raw)
        require(width == r['viewport']['width'] and height >= r['viewport']['height'], 'Image viewport/crop mismatch')
        commits.add(r['sourceCommit']); receipts.append(r)
    require(len(commits) == 1 and (expected_commit is None or commits == {expected_commit}), 'Source commit drift')
    require(len({r['image']['sha256'] for r in receipts}) == 24, 'Duplicate pixels reused across capture cells')
    for state in STATES:
        cells = [r for r in receipts if r['state'] == state]
        require(len(cells) == 4, 'State matrix incomplete')
        require(all(r['definition'] == cells[0]['definition'] and r['instance'] == cells[0]['instance'] for r in cells), 'State changed across locale/width capture')
    original = [r['instance'] for r in receipts if r['state'] in ('submitted', 'parallel', 'waiting', 'completed')]
    require(len({i['id'] for i in original}) == 1, 'Lifecycle screenshots are not the same request')
    require(all(r['definition'] == receipts[0]['definition'] for r in receipts), 'Capture definition drift')
    lifecycle = [next(r['instance'] for r in receipts if r['state'] == state)
                 for state in ('submitted', 'parallel', 'waiting', 'completed')]
    require(all(i['business'] == lifecycle[0]['business'] and i['submissionKey'] == lifecycle[0]['submissionKey'] for i in lifecycle), 'Original intent drift')
    for earlier, later in zip(lifecycle, lifecycle[1:]):
        require(later['commands'][:len(earlier['commands'])] == earlier['commands'] and later['events'][:len(earlier['events'])] == earlier['events'], 'Lifecycle history was rewritten')
    rejected = next(r['instance'] for r in receipts if r['state'] == 'rejected')
    require(rejected['id'] != lifecycle[0]['id'], 'Rejection reused completed request identity')
    return {'status': 'PASS', 'sourceCommit': commits.pop(), 'captures': len(receipts), 'scope': 'Integrity and DOM/API identity gates only; human pixel review still required'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--expected-commit')
    args = parser.parse_args()
    print(json.dumps(verify_directory(args.directory, args.expected_commit), indent=2))
