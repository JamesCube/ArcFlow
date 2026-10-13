#!/usr/bin/env python3
"""Require actual three-domain graph journeys, rendered-state receipts and PNG integrity."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from verify_graph_browser import require, png_dimensions, provenance, rendered_state, canvas_state

BUSINESS = {'travel': 'travel', 'receiving': 'receiving', 'quote': 'quoteDiscount'}
EDGES = {'travel': 'highCost', 'receiving': 'hasExceptions', 'quote': 'discounted'}
FACTS = {'travel': 'travel.estimatedCost', 'receiving': 'receiving.hasRejectedLines', 'quote': 'quote.discountPercent'}
STATES = {'designer', 'form', 'waiting-join', 'approved', 'default-approved', 'rejected', 'properties'}
CHECKPOINTS = {
    'scenario-bound-ui-author-save-publish-and-unsaved-switch',
    'server-derived-high-default-preview-without-write',
    'real-child-jvm-restart-at-partial-join-preserves-frozen-business',
    'independent-business-review-tasks-join-once-and-approve',
    'ordinary-default-route-and-unselected-reviewer-isolation',
    'terminal-rejection-cancels-parallel-business-sibling',
}

def expected_captures():
    return {(scenario, state, locale, width) for scenario in BUSINESS for state in STATES
            for locale in ('en', 'zh') for width in ((320,) if state == 'properties' else (320, 390, 1440))}

def check_request(request, scenario):
    require(isinstance(request, dict) and request.get('business', {}).get('type') == BUSINESS[scenario], 'Wrong business snapshot family')
    require(request.get('definition', {}).get('id') == f'{scenario}-graph', 'Wrong scenario graph ID')
    require(request.get('definition', {}).get('schemaVersion') == 6, 'Wrong definition schema')
    require(isinstance(request.get('tasks'), list) and isinstance(request.get('forks'), list), 'Missing durable task state')
    require(request.get('routes') and request['routes'][0].get('selectedEdgeId'), 'Missing frozen route')

def check_journey(item, scenario):
    require(item.get('scenario') == scenario and item.get('businessType') == BUSINESS[scenario], 'Wrong journey family')
    require(CHECKPOINTS <= set(item.get('checkpoints', [])), 'Incomplete business graph journey')
    require(item.get('browserErrors') == [], 'Browser reported errors')
    for key in ('approved', 'ordinary', 'rejected', 'highPreview', 'lowPreview'):
        check_request(item.get(key), scenario)
    approved, ordinary, rejected = (item[key] for key in ('approved', 'ordinary', 'rejected'))
    require(approved['status'] == ordinary['status'] == 'APPROVED' and rejected['status'] == 'REJECTED', 'Missing complete terminal journeys')
    require(len({approved['id'], ordinary['id'], rejected['id']}) == 3, 'Cases must be independent persisted requests')
    require(approved['routes'][0]['selectedEdgeId'] == EDGES[scenario] and rejected['routes'][0]['selectedEdgeId'] == EDGES[scenario], 'Missing exceptional branches')
    require(ordinary['routes'][0]['selectedEdgeId'] == 'otherwise' and ordinary['forks'] == [], 'Missing ordinary default branch')
    require(item['highPreview']['routes'][0]['selectedEdgeId'] == EDGES[scenario] and item['lowPreview']['routes'][0]['selectedEdgeId'] == 'otherwise', 'Both input previews are required')
    require(ordinary['definition']['version'] > approved['definition']['version'], 'Old/new frozen publication versions missing')
    require(len(approved['forks']) == 1 and approved['forks'][0]['fired'] is True and len(approved['forks'][0]['arrivedBranchIds']) == 2, 'Independent approval branches did not join')
    require(any(task['status'] == 'CANCELLED' for task in rejected['tasks']) and all(task['status'] != 'ACTIVE' for task in rejected['tasks']), 'Rejection did not cancel siblings')
    require(len(rejected['forks']) == 1 and rejected['forks'][0]['fired'] is False, 'Rejected join fired')
    restart = item.get('restart', {})
    before, after = restart.get('persistedBefore', {}), restart.get('persistedAfterReady', {})
    require(restart.get('scenario') == scenario and restart.get('exitedBeforeReplacement') is True and restart.get('oldProcessAbsentAfterReady') is True, 'Missing real JVM restart witness')
    require(restart.get('processBefore', {}).get('pid') != restart.get('processAfter', {}).get('pid'), 'Backend PID did not change')
    require(restart.get('processBefore', {}).get('spawnedAt') != restart.get('processAfter', {}).get('spawnedAt'), 'Backend process birth did not change')
    require(before.get('fileSHA256') and before['fileSHA256'] == after.get('fileSHA256') and before.get('request') == after.get('request'), 'Business store changed during restart')
    partial = before.get('request', {})
    check_request(partial, scenario)
    require(partial['status'] == 'PENDING' and len(partial['forks']) == 1 and partial['forks'][0]['fired'] is False and len(partial['forks'][0]['arrivedBranchIds']) == 1, 'Restart was not at a partial join')
    require(partial['id'] == approved['id'] and partial['definition'] == approved['definition'] and partial['business'] == approved['business'] and partial['routes'] == approved['routes'], 'Frozen snapshot changed after restart')
    require(restart.get('persistedAfterDecision', {}).get('request') == approved and restart['persistedAfterDecision']['fileSHA256'] != before['fileSHA256'], 'No durable post-restart decision')
    rendered_state({'state': 'waiting-join', 'request': partial, 'renderedState': restart.get('renderedAfterReload')})
    if scenario == 'travel':
        for name, checkpoint in (('submissionRecovery', 'committed-submission-retry-keeps-scenario-body-and-key'),
                                 ('decisionRecovery', 'committed-decision-retry-keeps-scenario-body-and-key')):
            require(checkpoint in item['checkpoints'], 'Missing cross-scenario uncertain-response recovery')
            recovery = item.get(name, {})
            attempts = recovery.get('attempts', [])
            require(len(attempts) == 2 and attempts[0] == attempts[1] and isinstance(attempts[0].get('key'), str) and attempts[0]['key'], 'Recovery changed original key/body')
            body = json.loads(attempts[0]['body'])
            recovered = recovery.get('instance', {})
            require(recovered.get('id') == approved['id'] and recovered.get('business') == approved['business'] and recovered.get('definition') == approved['definition'], 'Recovery moved to another business workspace')
            if name == 'submissionRecovery':
                require(body.get('expectedVersion') == approved['definition']['version'] and body.get('business', {}).get('type') == 'travel', 'Submission retry lost original payload family/version')
            else:
                require(recovered == partial and sum(command.get('id') == attempts[0]['key'] for command in recovered.get('commands', [])) == 1, 'Decision retry appended duplicate or changed state')
    return item

def check_capture(item, journey):
    scenario, state = item.get('scenario'), item.get('state')
    require(scenario in BUSINESS and state in STATES and item.get('businessType') == BUSINESS[scenario], 'Unknown business capture')
    require(item.get('locale') in ('en', 'zh') and item.get('viewport', {}).get('width') in (320, 390, 1440), 'Missing bilingual/responsive capture')
    visible = item.get('visible', {})
    require(visible.get('scenario') == ('quoteDiscount' if scenario == 'quote' else scenario) and visible.get('definitionId') == f'{scenario}-graph', 'Visible workspace belongs to another family')
    layout = item.get('layout', {})
    require(layout.get('width') == item['viewport']['width'] and layout.get('document', float('inf')) <= layout['width'] and layout.get('body', float('inf')) <= layout['width'], 'Viewport horizontal overflow')
    require(layout.get('x') == layout.get('y') == 0, 'Capture not at document origin')
    if item['viewport']['width'] == 320:
        readability = item.get('readability', {})
        require(readability.get('refresh') == {'word': '刷新' if item['locale'] == 'zh' else 'Refresh', 'lineCount': 1}, 'Refresh label breaks inside a word')
        if scenario == 'quote' and state not in ('form', 'properties'):
            words = readability.get('commercial')
            require(isinstance(words, list) and words and all(word == {'word': 'Commercial', 'lineCount': 1} for word in words), 'Commercial node label breaks inside a word')
    if state in ('designer', 'form', 'properties'):
        require(item.get('request') is None and item.get('renderedState') is None, 'Form/designer falsely claims persisted runtime')
        if state in ('designer', 'properties'):
            definition = item.get('definition', {})
            require(definition == journey['approved']['definition'] and visible.get('processName') == definition['name'], 'Designer differs from submitted graph')
            if state == 'designer':
                canvas_state(dict(item, designerDefinition=definition))
            else:
                require(item['viewport']['width'] == 320, 'Properties evidence must cover the narrowest viewport')
                fields = {field.get('testid'): field for field in visible.get('fields', [])}
                edge = next(edge for edge in definition['edges'] if edge['id'] == EDGES[scenario])
                rule = edge['condition']['predicates'][0]
                controls = {'graph-branch-name': edge['label'], 'graph-condition-mode': edge['condition']['mode'],
                            'graph-field-0': FACTS[scenario], 'graph-operator-0': rule['operator']}
                if scenario == 'receiving':
                    controls['graph-expected-0'] = str(rule['expected']).lower()
                else:
                    controls['graph-threshold-0'] = str(rule['threshold'])
                    if scenario == 'travel': controls['graph-condition-currency-0'] = rule['currency']
                require(all(fields.get(key, {}).get('value') == value for key, value in controls.items()), 'Properties hide or alter a typed condition control')
        else:
            fields = visible.get('fields')
            require(isinstance(fields, list) and fields, 'Filled business form is not evidenced')
            prefix = 'graph-quote-' if scenario == 'quote' else f'graph-{scenario}-'
            require(any(field.get('testid', '').startswith(prefix) and field.get('value') for field in fields), 'No populated real business fields')
        for field in visible.get('fields', []):
            bounds = field.get('bounds', {})
            require(isinstance(bounds.get('left'), (int, float)) and isinstance(bounds.get('right'), (int, float)) and 0 <= bounds['left'] < bounds['right'] <= item['viewport']['width'], 'Business controls are clipped')
    else:
        expected = {'approved': journey['approved'], 'default-approved': journey['ordinary'], 'rejected': journey['rejected'], 'waiting-join': journey['restart']['persistedBefore']['request']}[state]
        require(item.get('request') == expected, 'Capture is detached from its durable journey')
        rendered_state(item)
        canvas_state(item)


def verify(directory, source, backend):
    backend_hash = hashlib.sha256(backend.read_bytes()).hexdigest()
    journeys = {}
    sessions = set()
    for path in directory.rglob('graph-business-*-journey.json'):
        item = json.loads(path.read_text())
        scenario = item.get('scenario')
        require(scenario in BUSINESS and scenario not in journeys, 'Duplicate/unknown business journey')
        provenance(item, source, backend_hash)
        provenance(item.get('restart', {}), source, backend_hash)
        journeys[scenario] = check_journey(item, scenario)
        sessions.add((item.get('captureSessionId'), item.get('captureRunId'), item.get('captureRunAttempt')))
    require(set(journeys) == set(BUSINESS), 'Three successful business journeys are required')
    expected = expected_captures()
    observed = set()
    for image in directory.rglob('*.png'):
        item = json.loads(image.with_suffix('.json').read_text())
        provenance(item, source, backend_hash)
        key = (item.get('scenario'), item.get('state'), item.get('locale'), item.get('viewport', {}).get('width'))
        require(key in expected and key not in observed, 'Unexpected/duplicate business screenshot')
        observed.add(key)
        require(item.get('image') == image.name and item.get('imageSHA256') == hashlib.sha256(image.read_bytes()).hexdigest(), 'Screenshot identity/hash mismatch')
        width, height = png_dimensions(image.read_bytes())
        require(width == item['viewport']['width'] and height >= item['viewport']['height'] and item.get('fullPage') is True, 'Screenshot dimensions differ')
        require(item.get('capturedAt'), 'Missing capture time')
        check_capture(item, journeys[item['scenario']])
        sessions.add((item.get('captureSessionId'), item.get('captureRunId'), item.get('captureRunAttempt')))
        if os.environ.get('GITHUB_RUN_ID'):
            require(item.get('captureRunId') == os.environ['GITHUB_RUN_ID'] and item.get('captureRunAttempt') == os.environ.get('GITHUB_RUN_ATTEMPT') and item.get('captureRepository') == os.environ.get('GITHUB_REPOSITORY'), 'Capture belongs to another CI run')
    require(observed == expected, 'Incomplete business screenshot set')
    require(len(sessions) == 1, 'Mixed capture sessions')
    return len(observed)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, type=Path)
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--backend-jar', required=True, type=Path)
    args = parser.parse_args()
    count = verify(args.directory, args.source_sha, args.backend_jar)
    print(f'PASS: three persisted business graph journeys, real restarts, {count} original screenshots at {args.source_sha}')
