"""Unit tests for evidence gates only; these never generate screenshots/evidence."""
import copy
from pathlib import Path
import tempfile
import struct
import zlib
import unittest
from verify_graph_captures import names, png_size, validate_receipt, verify_directory


def metadata_fixture():
    # Minimal metadata unit vector, deliberately no PNG or image success receipt.
    return {'format': 1, 'sourceCommit': 'a' * 40, 'host': 'native-ruoyi', 'scenario': 'travel',
            'route': '/arcflow/graph', 'state': 'designer', 'locale': 'zh', 'viewport': {'width': 390, 'height': 844},
            'provenance': 'real-native-login-real-http-original-chromium-no-response-mocks',
            'actor': {'id': '1', 'displayName': 'Unit fixture'},
            'definition': {'id': 'travel-graph', 'schemaVersion': 6, 'version': 1,
                           'nodes': [{'assigneeIds': ['101']}, {'assigneeIds': ['102']}]},
            'instance': None,
            'dom': {'actorId': '1', 'actorLabel': 'Unit fixture (ID 1)', 'scenario': 'travel', 'definitionId': 'travel-graph', 'schema': 6, 'version': 1,
                    'tasks': [], 'joins': [], 'events': []}}


class CaptureGateTest(unittest.TestCase):
    def test_matrix_exactly_24_distinct_names(self):
        self.assertEqual(len(names()), 24)
        self.assertIn('native-travel-waiting-en-390', names())
        self.assertNotIn('native-travel-waiting-en-320', names())

    def test_designer_metadata_gate(self):
        validate_receipt(metadata_fixture())

    def test_identity_drift_is_rejected(self):
        changes = [('host', 'standalone'), ('scenario', 'payment'), ('sourceCommit', 'not-a-sha'),
                   ('state', 'unknown'), ('locale', 'fr'), ('route', '/api/graphs/travel'),
                   ('provenance', 'mocked')]
        for key, value in changes:
            with self.subTest(key=key):
                r = metadata_fixture(); r[key] = value
                with self.assertRaises(ValueError):
                    validate_receipt(r)

    def test_actor_schema_and_dom_drift_are_rejected(self):
        for path, value in [(('actor', 'id'), 'alice'), (('actor', 'id'), '101'),
                            (('actor', 'token'), 'forbidden'), (('definition', 'schemaVersion'), 5),
                            (('definition', 'id'), 'payment-graph'), (('dom', 'version'), 2),
                            (('viewport', 'width'), 320)]:
            with self.subTest(path=path):
                r = copy.deepcopy(metadata_fixture()); r[path[0]][path[1]] = value
                with self.assertRaises(ValueError):
                    validate_receipt(r)

    def test_missing_matrix_fails_without_pixels(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, 'Incomplete'):
                verify_directory(Path(tmp))

    def test_png_requires_decodable_pixels_and_valid_filters(self):
        def chunk(kind, content):
            return struct.pack('>I', len(content)) + kind + content + struct.pack('>I', zlib.crc32(kind + content) & 0xffffffff)
        header = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
        end = chunk(b'IEND', b'')
        # Invalid in-memory unit vectors, never written as captures/artifacts.
        for raw in (header + end, header + chunk(b'IDAT', b'not-zlib') + end,
                    header + chunk(b'IDAT', zlib.compress(b'\0')) + end,
                    header + chunk(b'IDAT', zlib.compress(b'\5\0\0\0')) + end):
            with self.assertRaises(ValueError):
                png_size(raw)

    def test_waiting_branch_and_native_vote_identity(self):
        r = metadata_fixture(); r['state'] = 'waiting'; r['actor'] = {'id': '101', 'displayName': 'Unit reviewer'}
        r['dom']['actorId'] = '101'; r['dom']['actorLabel'] = 'Unit reviewer (ID 101)'
        tasks = []
        for node, actor, voted in [('manager', '101', True), ('operations', '101', True), ('finance', '102', False)]:
            tasks.append({'id': 'unit:' + node, 'nodeId': node, 'status': 'COMPLETED' if voted else 'ACTIVE',
                          'participants': [actor], 'completionMode': 'ALL',
                          'votes': [{'actorId': actor, 'decision': 'APPROVE'}] if voted else []})
        fork = {'id': 'unit:fork', 'fired': False, 'arrivedBranchIds': ['operationsBranch'], 'expectedBranchIds': ['operationsBranch', 'financeBranch']}
        r['instance'] = {'id': 'unit', 'applicantId': '100', 'definition': r['definition'], 'status': 'PENDING',
                         'business': {'type': 'travel', 'businessId': 'NATIVE-BROWSER-TRAVEL', 'title': 'Native browser travel graph', 'currency': 'CNY', 'estimatedCost': 10000},
                         'tasks': tasks, 'forks': [fork], 'routes': [{'selectedEdgeId': 'highCost'}],
                         'commands': [{'taskId': t['id'], 'actorId': '101', 'decision': 'APPROVE'} for t in tasks[:2]],
                         'commandRevision': 2, 'events': [{'sequence': 1, 'type': 'UNIT-ONLY'}]}
        r['dom'].update(tasks=[{'id': t['id'], 'nodeId': t['nodeId'], 'status': t['status'], 'voteCount': len(t['votes'])} for t in tasks], joins=[copy.deepcopy(fork)], events=['#1 UNIT-ONLY'])
        validate_receipt(r)
        wrong_branch = copy.deepcopy(r)
        wrong_branch['instance']['forks'][0]['arrivedBranchIds'] = ['financeBranch']
        wrong_branch['dom']['joins'][0]['arrivedBranchIds'] = ['financeBranch']
        with self.assertRaisesRegex(ValueError, 'arrived branch'):
            validate_receipt(wrong_branch)
        wrong_vote = copy.deepcopy(r)
        wrong_vote['instance']['tasks'][1]['votes'][0]['actorId'] = '102'
        with self.assertRaisesRegex(ValueError, 'native vote'):
            validate_receipt(wrong_vote)

    def test_non_png_and_truncated_png_fail(self):
        for raw in (b'', b'not an image', b'\x89PNG\r\n\x1a\n', b'\x89PNG\r\n\x1a\n\0'):
            with self.assertRaises(ValueError):
                png_size(raw)


if __name__ == '__main__':
    unittest.main()
