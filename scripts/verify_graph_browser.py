#!/usr/bin/env python3
"""Validate graph browser receipts/screenshots against the actual source and packaged backend.

This integrity gate does not replace human visual inspection. It rejects missing,
truncated, cross-revision or incomplete evidence instead of counting PNG files.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import zlib

REQUIRED_STATES = {'designer', 'designer-dense', 'waiting-join', 'rejected', 'approved', 'default-approved', 'distinct-actors-active', 'distinct-actors-completed'}
DESIGNER_STATES = {'designer', 'designer-dense', 'designer-properties'}
REQUIRED_SCREENSHOTS = ({(state, language, width) for state in REQUIRED_STATES
                         for language in ('en', 'zh') for width in (390, 1440)}
                        | {(state, language, 320) for state in ('designer', 'designer-dense') for language in ('en', 'zh')}
                        | {('designer-properties', language, width) for language in ('en', 'zh')
                           for width in (320, 390)})
RECOVERY_CHECKPOINTS = {
    'committed-submission-response-loss-original-key-body-mode-close-back-retry',
    'committed-decision-response-loss-original-key-body-mode-retry',
    'distinct-actor-simultaneous-branch-arrival-one-join-one-successor-no-lost-vote',
}
REQUIRED_CHECKPOINTS = {
    'ui-insert-paired-region-delete-undo-redo-move-branches-save-reload-publish',
    'ui-condition-editor-save-reload-exact-threshold-boundary',
    'server-preview-multiline-netTotal-12500-keyboard-mode-navigation',
    'same-actor-multiple-tasks-independent-progress-join-once-frozen-ALL',
    'default-selected-unselected-skipped-group-ANY',
    'rejection-cancels-active-sibling-and-unfired-join',
    'browser-reload-preserves-durable-runtime',
    '320px-keyboard-properties-escape',
    'condition-properties-320px-390px-bilingual-paired-regions-visible',
    'runtime-expanded-resize-restores-request-navigation',
    'four-branches-two-levels-readable-at-320px-and-desktop',
}

def require(condition, message):
    if not condition:
        raise ValueError(message)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def png_dimensions(data):
    require(data.startswith(b'\x89PNG\r\n\x1a\n'), 'Invalid PNG signature')
    offset, width, height, depth, color, seen_end = 8, None, None, None, None, False
    payload = bytearray()
    while offset < len(data):
        require(offset + 12 <= len(data), 'Truncated PNG chunk')
        length = struct.unpack('>I', data[offset:offset+4])[0]
        kind = data[offset+4:offset+8]
        require(offset + 12 + length <= len(data), 'Truncated PNG payload')
        body = data[offset+8:offset+8+length]
        crc = struct.unpack('>I', data[offset+8+length:offset+12+length])[0]
        require(zlib.crc32(kind+body) & 0xffffffff == crc, 'PNG CRC mismatch')
        if kind == b'IHDR':
            require(width is None and length == 13, 'Invalid PNG header')
            width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', body)
            require(width > 0 and height > 0 and depth == 8 and color in (2, 6) and compression == filtering == interlace == 0, 'Unsupported screenshot encoding')
        elif kind == b'IDAT':
            payload.extend(body)
        elif kind == b'IEND':
            require(length == 0 and offset + 12 == len(data), 'Invalid PNG ending')
            seen_end = True
        offset += 12 + length
    require(seen_end and width and payload, 'Incomplete PNG')
    decompressed = zlib.decompress(payload)
    stride = width * (3 if color == 2 else 4) + 1
    require(len(decompressed) == stride * height, 'PNG pixel bytes incomplete')
    require(all(decompressed[i] <= 4 for i in range(0, len(decompressed), stride)), 'Invalid PNG scanline filter')
    return width, height

def provenance(item, source, backend):
    require(item.get('sourceRevision') == source, 'Screenshot/receipt source revision mismatch')
    require(item.get('sourceWorkingTree') == 'clean-commit', 'Evidence must come from a clean source commit')
    require(item.get('trackedDiffSHA256') == sha(b''), 'Evidence has a tracked source diff')
    require(item.get('backendJarSHA256') == backend, 'Evidence backend archive mismatch')
    require(re.fullmatch(r'[0-9a-f]{64}', item.get('uiSourceTreeSHA256', '')) is not None, 'Missing UI source hash')
    require(item.get('captureSessionId') and item.get('captureRunId'), 'Missing capture run identity')

def rendered_state(item):
    """Bind captured pixels to the state read back from Vue's rendered elements.

    Server responses alone cannot prove the UI accepted a response. The browser
    capture also asserts visible localized status text and absence of alerts;
    this gate independently rejects missing or stale DOM-state receipts.
    """
    request = item.get('request')
    displayed = item.get('renderedState')
    if item.get('state') in DESIGNER_STATES:
        require(request is None and displayed is None, 'Designer capture must not claim a runtime state')
        return
    require(isinstance(request, dict) and isinstance(displayed, dict), 'Missing rendered runtime state')
    require(type(displayed.get('commandRevision')) is int and type(displayed.get('definitionVersion')) is int
            and type(displayed.get('activeTaskCount')) is int, 'Invalid rendered runtime counters')
    tasks = displayed.get('tasks')
    forks = displayed.get('forks')
    require(isinstance(tasks, list) and isinstance(forks, list), 'Missing rendered tasks or joins')
    require(all(isinstance(t, dict) and isinstance(t.get('id'), str) and isinstance(t.get('status'), str)
                and type(t.get('voteCount')) is int for t in tasks), 'Invalid rendered task state')
    require(all(isinstance(f, dict) and isinstance(f.get('id'), str) and type(f.get('fired')) is bool
                and isinstance(f.get('arrivedBranchIds'), list) and isinstance(f.get('expectedBranchIds'), list)
                for f in forks), 'Invalid rendered join state')
    for fork in forks:
        for field in ('arrivedBranchIds', 'expectedBranchIds'):
            ids = fork[field]
            require(all(isinstance(branch, str) and branch for branch in ids) and len(ids) == len(set(ids)),
                    'Invalid or duplicate rendered join branches')
    def normalize_forks(items):
        return sorted((dict(f, arrivedBranchIds=sorted(f['arrivedBranchIds']),
                               expectedBranchIds=sorted(f['expectedBranchIds'])) for f in items), key=lambda f: f['id'])
    expected = {
        'id': request['id'], 'status': request['status'],
        'commandRevision': request['commandRevision'], 'definitionVersion': request['definition']['version'],
        'activeTaskCount': sum(t['status'] == 'ACTIVE' for t in request['tasks']),
        'tasks': sorted(({'id': t['id'], 'status': t['status'], 'voteCount': len(t['votes'])}
                         for t in request['tasks']), key=lambda t: t['id']),
        'forks': normalize_forks({'id': f['id'], 'fired': f['fired'],
                                  'arrivedBranchIds': f['arrivedBranchIds'], 'expectedBranchIds': f['expectedBranchIds']}
                                 for f in request['forks']),
    }
    observed = dict(displayed, tasks=sorted(tasks, key=lambda t: t['id']), forks=normalize_forks(forks))
    require(observed == expected, 'Screenshot DOM does not match the expected request, revision, tasks or joins')

def canvas_state(item):
    """Require readable, complete default views, not merely one node in a clipped canvas."""
    canvases = item.get('canvases')
    if item.get('state') == 'designer-properties':
        require(canvases == [], 'Properties capture must truthfully record its hidden canvas')
        return
    require(isinstance(canvases, list) and len(canvases) > 0, 'Missing visible graph canvas evidence')
    definition = (item.get('request') or {}).get('definition') or item.get('designerDefinition')
    require(isinstance(definition, dict) and isinstance(definition.get('nodes'), list), 'Missing independent canvas definition')
    expected_ids = sorted(node['id'] for node in definition['nodes'])
    require(expected_ids and len(expected_ids) == len(set(expected_ids)), 'Invalid canvas definition nodes')
    for canvas in canvases:
        require(isinstance(canvas, dict) and canvas.get('scrollLeft') == 0 and canvas.get('scrollTop') == 0,
                'Graph canvas is not captured from its internal origin')
        for field in ('clientWidth', 'scrollWidth', 'clientHeight', 'scrollHeight'):
            require(type(canvas.get(field)) is int and canvas[field] > 0, 'Invalid graph canvas dimensions')
        require(canvas['clientWidth'] <= item['viewport']['width'] and canvas['scrollWidth'] >= canvas['clientWidth']
                and canvas['scrollHeight'] >= canvas['clientHeight'], 'Inconsistent graph canvas dimensions')
        ids = canvas.get('visibleNodeIds')
        require(isinstance(ids, list) and ids and all(isinstance(node, str) and node for node in ids)
                and len(ids) == len(set(ids)), 'No distinct visible graph nodes in canvas')
        require(sorted(ids) == expected_ids and canvas.get('allNodeIds') == expected_ids
                and canvas.get('fullyVisibleNodeIds') == expected_ids,
                'Default graph view hides or clips a definition node')
        require(canvas.get('nodeHorizontalClipping') == [], 'Default graph view has horizontal node clipping')
        if item.get('state') == 'designer-dense':
            width = canvas.get('minimumNodeWidth')
            require(type(width) in (int, float) and math.isfinite(width) and width >= 140,
                    'Dense graph node text is squeezed below the readable track width')
        bounds = canvas.get('clientBounds')
        require(isinstance(bounds, dict) and all(type(bounds.get(field)) in (int, float)
                and math.isfinite(bounds[field]) for field in ('left', 'top', 'right', 'bottom')),
                'Missing actual graph client bounds')
        require(abs(bounds['right'] - bounds['left'] - canvas['clientWidth']) < 0.01
                and abs(bounds['bottom'] - bounds['top'] - canvas['clientHeight']) < 0.01,
                'Graph client bounds differ from canvas dimensions')

def designer_state(item):
    if item.get('state') != 'designer-properties':
        return
    definition, observed = item.get('designerDefinition'), item.get('designerState')
    require(isinstance(definition, dict) and definition.get('schemaVersion') == 5
            and isinstance(observed, dict), 'Missing independent designer property state')
    require(observed.get('selectedKind') == 'edge', 'Properties screenshot must show an editable condition branch')
    selected = next((edge for edge in definition.get('edges', []) if edge['id'] == observed.get('selectedId')), None)
    require(selected is not None and selected.get('defaultBranch') is False
            and isinstance(selected.get('condition'), dict) and selected['condition'].get('predicates'),
            'Properties screenshot must show a non-default condition branch')
    expected = {'definitionId': definition['id'], 'definitionVersion': definition['version'],
                'definitionName': definition['name'], 'selectedKind': 'edge', 'selectedId': selected['id'],
                'edge': {key: selected[key] for key in ('id', 'label', 'defaultBranch', 'condition')}}
    require(observed == expected, 'Visible designer controls differ from the independently published definition')

def validate(directory, source, backend):
    require(re.fullmatch(r'[0-9a-f]{40}', source) is not None, 'Expected exact source commit SHA')
    receipts = list(directory.rglob('graph-receipt.json'))
    require(len(receipts) == 1, 'Exactly one completed graph journey receipt is required')
    receipt = json.loads(receipts[0].read_text())
    provenance(receipt, source, backend)
    require(receipt.get('result') == 'passed' and receipt.get('realBackend') is True and receipt.get('browser') == 'Chromium', 'Real browser journey did not complete')
    require(REQUIRED_CHECKPOINTS <= set(receipt.get('checkpoints', [])), 'Missing required graph user journeys')
    recovery_paths = list(directory.rglob('graph-recovery-receipt.json'))
    require(len(recovery_paths) == 1, 'Exactly one completed concurrency/recovery browser receipt is required')
    recovery = json.loads(recovery_paths[0].read_text())
    provenance(recovery, source, backend)
    require(recovery.get('result') == 'passed' and recovery.get('realBackend') is True and recovery.get('browser') == 'Chromium', 'Concurrency/recovery browser journey did not complete')
    require(RECOVERY_CHECKPOINTS <= set(recovery.get('checkpoints', [])), 'Missing distinct-actor concurrency or lost-response browser journeys')
    sessions = {receipt['captureSessionId'], recovery['captureSessionId']}
    requests = receipt.get('requests', []) + recovery.get('requests', [])
    require(len(receipt.get('requests', [])) >= 3 and len(recovery.get('requests', [])) >= 1, 'Missing distinct graph request outcomes')
    require(any(r.get('status') == 'APPROVED' and r.get('forks') and all(f['fired'] for f in r['forks']) for r in requests), 'No approved joined request')
    require(any(r.get('status') == 'APPROVED' and not r.get('forks') for r in requests), 'No completed default request')
    require(any(r.get('status') == 'REJECTED' and any(t['status'] == 'CANCELLED' for t in r['tasks']) and not any(t['status'] == 'ACTIVE' for t in r['tasks']) for r in requests), 'No terminal rejection with cancelled sibling')
    for r in requests:
        require(r['definition']['schemaVersion'] == 5, 'Receipt used a legacy definition')
        require(len({t['id'] for t in r['tasks']}) == len(r['tasks']), 'Duplicate task activation in receipt')
        require(r['commandRevision'] == len(r['commands']), 'Command revision and receipt count differ')
        for fork in r['forks']:
            count = sum(e['type'] == 'JOIN_FIRED' and e['nodeId'] == fork['joinId'] for e in r['events'])
            require(count == (1 if fork['fired'] else 0), 'Join did not fire exactly once per activation')
    seen = set()
    for path in directory.rglob('graph-*.json'):
        if path.name in ('graph-receipt.json', 'graph-recovery-receipt.json'):
            continue
        item = json.loads(path.read_text())
        if item.get('scenario') != 'graph-workflow':
            continue
        provenance(item, source, backend)
        rendered_state(item)
        canvas_state(item)
        designer_state(item)
        require(item['captureSessionId'] in sessions, 'Mixed browser sessions')
        image = item.get('image')
        require(isinstance(image, str) and Path(image).name == image, 'Unsafe screenshot path')
        data = path.with_name(image).read_bytes()
        require(sha(data) == item.get('imageSHA256'), 'Screenshot hash mismatch')
        width, height = png_dimensions(data)
        viewport = item.get('viewport', {})
        require(width == viewport.get('width') and height >= viewport.get('height', 1), 'Screenshot viewport mismatch')
        require(item.get('scrollOrigin') == {'x': 0, 'y': 0}, 'Screenshot is not captured from page origin')
        key = (item.get('state'), item.get('locale'), width)
        require(key not in seen, 'Duplicate screenshot state/locale/viewport')
        seen.add(key)
        r = item.get('request')
        if item.get('state') == 'waiting-join':
            require(r and r['status'] == 'PENDING' and any(not f['fired'] and 0 < len(f['arrivedBranchIds']) < len(f['expectedBranchIds']) for f in r['forks']), 'Waiting screenshot does not contain a partial join')
        if item.get('state') == 'rejected':
            require(r and r['status'] == 'REJECTED' and not any(t['status'] == 'ACTIVE' for t in r['tasks']), 'Rejection screenshot contains live tasks')
        if item.get('state') == 'distinct-actors-active':
            active = [t for t in r['tasks'] if t['status'] == 'ACTIVE'] if r else []
            require(len(active) >= 2 and len({actor for task in active for actor in task['participants']}) >= 2, 'No independent tasks for different actors in screenshot')
        if item.get('state') in ('approved', 'distinct-actors-completed'):
            require(r and r['status'] == 'APPROVED', 'Approved screenshot is not approved')
        if item.get('state') == 'default-approved':
            require(r and r['status'] == 'APPROVED' and not r['forks'], 'Default screenshot did not complete its exclusive route')
            selected = {route['selectedEdgeId'] for route in r.get('routes', [])}
            require(any(edge['id'] in selected and edge.get('defaultBranch') is True
                        for edge in r['definition'].get('edges', [])), 'Default screenshot does not select the default edge')
            require(any(task.get('completionMode') == 'ANY' and task['status'] == 'COMPLETED'
                        and len(task['votes']) == 1 for task in r['tasks']), 'Default screenshot does not prove one-vote ANY completion')
    require(REQUIRED_SCREENSHOTS <= seen, f'Missing bilingual desktop/narrow screenshots: {REQUIRED_SCREENSHOTS-seen}')
    return len(seen)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,required=True)
    parser.add_argument('--source-sha',required=True)
    parser.add_argument('--backend-jar',type=Path,required=True)
    args=parser.parse_args()
    count=validate(args.directory,args.source_sha,sha(args.backend_jar.read_bytes()))
    print(f'Graph browser evidence verified: full journey receipt and {count} integrity-checked screenshots; visual review remains separate.')

if __name__=='__main__': main()
