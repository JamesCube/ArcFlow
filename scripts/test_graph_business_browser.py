"""Synthetic unit fixtures test the evidence gate; these are not product captures."""
import copy
import tempfile
import unittest
from pathlib import Path
from verify_graph_business_browser import BUSINESS, CHECKPOINTS, EDGES, check_journey, check_capture, verify


def rendered(request):
    return {'id': request['id'], 'status': request['status'], 'commandRevision': request['commandRevision'],
            'definitionVersion': request['definition']['version'],
            'activeTaskCount': sum(t['status'] == 'ACTIVE' for t in request['tasks']),
            'tasks': [{'id': t['id'], 'status': t['status'], 'voteCount': len(t['votes'])} for t in request['tasks']],
            'forks': [{k: fork[k] for k in ('id', 'fired', 'arrivedBranchIds', 'expectedBranchIds')} for fork in request['forks']]}


def fixture(scenario='travel'):
    definition = {'id': f'{scenario}-graph', 'schemaVersion': 6, 'version': 2, 'name': 'Unit fixture', 'nodes': [{'id': 'a'}, {'id': 'b'}]}
    partial = {'id': f'{scenario}-high', 'status': 'PENDING', 'commandRevision': 1, 'business': {'type': BUSINESS[scenario]},
               'definition': definition, 'routes': [{'selectedEdgeId': EDGES[scenario]}],
               'tasks': [{'id': 'a', 'status': 'COMPLETED', 'votes': [{}]}, {'id': 'b', 'status': 'ACTIVE', 'votes': []}],
               'commands': [{'id': 'decision-key'}], 'forks': [{'id': 'fork', 'fired': False, 'arrivedBranchIds': ['a'], 'expectedBranchIds': ['a', 'b']}]}
    approved = copy.deepcopy(partial)
    approved.update(status='APPROVED', commandRevision=2)
    approved['tasks'][1].update(status='COMPLETED', votes=[{}])
    approved['forks'][0].update(fired=True, arrivedBranchIds=['a', 'b'])
    ordinary = copy.deepcopy(approved)
    ordinary.update(id=f'{scenario}-ordinary', forks=[])
    ordinary['definition']['version'] = 3
    ordinary['routes'][0]['selectedEdgeId'] = 'otherwise'
    rejected = copy.deepcopy(partial)
    rejected.update(id=f'{scenario}-rejected', status='REJECTED')
    rejected['tasks'][0]['status'] = 'REJECTED'
    rejected['tasks'][1]['status'] = 'CANCELLED'
    rejected['forks'][0]['arrivedBranchIds'] = []
    before = {'fileSHA256': 'a' * 64, 'request': partial}
    restart = {'scenario': scenario, 'exitedBeforeReplacement': True, 'oldProcessAbsentAfterReady': True,
               'processBefore': {'pid': 1, 'spawnedAt': 'before'}, 'processAfter': {'pid': 2, 'spawnedAt': 'after'},
               'persistedBefore': before, 'persistedAfterReady': copy.deepcopy(before),
               'persistedAfterDecision': {'fileSHA256': 'b' * 64, 'request': approved}, 'renderedAfterReload': rendered(partial)}
    result = {'scenario': scenario, 'businessType': BUSINESS[scenario], 'checkpoints': sorted(CHECKPOINTS), 'browserErrors': [],
            'approved': approved, 'ordinary': ordinary, 'rejected': rejected, 'highPreview': copy.deepcopy(partial),
            'lowPreview': copy.deepcopy(ordinary), 'restart': restart}
    if scenario == 'travel':
        import json
        for name, key, body, checkpoint in (
            ('submissionRecovery', 'submission-key', {'expectedVersion': 2, 'business': {'type': 'travel'}}, 'committed-submission-retry-keeps-scenario-body-and-key'),
            ('decisionRecovery', 'decision-key', {'decision': 'APPROVE', 'comment': ''}, 'committed-decision-retry-keeps-scenario-body-and-key')):
            attempt = {'key': key, 'body': json.dumps(body)}
            result[name] = {'instance': copy.deepcopy(partial), 'attempts': [attempt, copy.deepcopy(attempt)]}
            result['checkpoints'].append(checkpoint)
    return result


def capture(journey, state='approved'):
    scenario = journey['scenario']
    request = journey[state] if state == 'approved' else journey['restart']['persistedBefore']['request']
    return {'scenario': scenario, 'businessType': BUSINESS[scenario], 'state': state, 'locale': 'en',
            'viewport': {'width': 390, 'height': 844},
            'visible': {'scenario': 'quoteDiscount' if scenario == 'quote' else scenario, 'definitionId': f'{scenario}-graph'},
            'layout': {'width': 390, 'document': 390, 'body': 390, 'x': 0, 'y': 0},
            'request': copy.deepcopy(request), 'renderedState': rendered(request),
            'canvases': [{'scrollLeft': 0, 'scrollTop': 0, 'clientWidth': 350, 'scrollWidth': 350,
                          'clientHeight': 900, 'scrollHeight': 900, 'clientBounds': {'left': 20, 'top': 100, 'right': 370, 'bottom': 1000}, 'visibleNodeIds': ['a', 'b'], 'allNodeIds': ['a', 'b'],
                          'fullyVisibleNodeIds': ['a', 'b'], 'nodeHorizontalClipping': []}]}


class BusinessGraphEvidenceTests(unittest.TestCase):
    def test_all_three_real_case_shapes_are_required_and_supported(self):
        for scenario in BUSINESS:
            journey = fixture(scenario)
            self.assertIs(check_journey(journey, scenario), journey)
            check_capture(capture(journey), journey)
            check_capture(capture(journey, 'waiting-join'), journey)

    def test_missing_behavior_checkpoint_is_rejected(self):
        value = fixture(); value['checkpoints'].remove(next(iter(CHECKPOINTS)))
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            check_journey(value, 'travel')

    def test_wrong_business_snapshot_family_is_rejected(self):
        value = fixture(); value['ordinary']['business']['type'] = 'paymentRequest'
        with self.assertRaisesRegex(ValueError, 'family'):
            check_journey(value, 'travel')

    def test_default_case_cannot_be_another_exceptional_branch(self):
        value = fixture(); value['ordinary']['routes'][0]['selectedEdgeId'] = 'highCost'
        with self.assertRaisesRegex(ValueError, 'ordinary default'):
            check_journey(value, 'travel')

    def test_later_publication_must_not_rewrite_old_snapshot(self):
        value = fixture(); value['ordinary']['definition']['version'] = 2
        with self.assertRaisesRegex(ValueError, 'publication'):
            check_journey(value, 'travel')

    def test_join_does_not_pass_without_both_arrivals(self):
        value = fixture(); value['approved']['forks'][0]['arrivedBranchIds'] = ['a']
        with self.assertRaisesRegex(ValueError, 'did not join'):
            check_journey(value, 'travel')

    def test_rejected_sibling_cannot_remain_active(self):
        value = fixture(); value['rejected']['tasks'][1]['status'] = 'ACTIVE'
        with self.assertRaisesRegex(ValueError, 'cancel siblings'):
            check_journey(value, 'travel')

    def test_restart_requires_a_new_process(self):
        value = fixture(); value['restart']['processAfter']['pid'] = 1
        with self.assertRaisesRegex(ValueError, 'PID'):
            check_journey(value, 'travel')

    def test_restart_store_mutation_is_rejected(self):
        value = fixture(); value['restart']['persistedAfterReady']['fileSHA256'] = 'c' * 64
        with self.assertRaisesRegex(ValueError, 'store changed'):
            check_journey(value, 'travel')

    def test_restart_at_completed_join_is_rejected(self):
        value = fixture(); value['restart']['persistedBefore']['request']['forks'][0]['fired'] = True
        value['restart']['persistedAfterReady'] = copy.deepcopy(value['restart']['persistedBefore'])
        with self.assertRaisesRegex(ValueError, 'partial join'):
            check_journey(value, 'travel')

    def test_stale_dom_receipt_is_rejected(self):
        value = fixture(); value['restart']['renderedAfterReload']['commandRevision'] = 0
        with self.assertRaisesRegex(ValueError, 'DOM'):
            check_journey(value, 'travel')

    def test_visible_wrong_workspace_is_rejected(self):
        journey = fixture(); value = capture(journey); value['visible']['scenario'] = 'receiving'
        with self.assertRaisesRegex(ValueError, 'another family'):
            check_capture(value, journey)

    def test_capture_detached_from_journey_is_rejected(self):
        journey = fixture(); value = capture(journey); value['request']['id'] = 'another'
        with self.assertRaisesRegex(ValueError, 'detached'):
            check_capture(value, journey)

    def test_overflow_and_clipped_canvas_are_rejected(self):
        journey = fixture(); value = capture(journey); value['layout']['document'] = 600
        with self.assertRaisesRegex(ValueError, 'overflow'):
            check_capture(value, journey)
        value = capture(journey); value['canvases'][0]['fullyVisibleNodeIds'] = ['a']
        with self.assertRaisesRegex(ValueError, 'hides or clips'):
            check_capture(value, journey)

    def test_response_loss_retry_cannot_change_key_or_body(self):
        value = fixture(); value['submissionRecovery']['attempts'][1]['key'] = 'new-key'
        with self.assertRaisesRegex(ValueError, 'original key/body'):
            check_journey(value, 'travel')

    def test_empty_evidence_is_not_a_green_build(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); backend = root / 'unit.jar'; backend.write_bytes(b'unit fixture')
            with self.assertRaisesRegex(ValueError, 'Three successful'):
                verify(root, '0' * 40, backend)


if __name__ == '__main__':
    unittest.main()
