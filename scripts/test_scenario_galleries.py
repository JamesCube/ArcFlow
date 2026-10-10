"""Regression tests: inconsistent evidence must never produce a passing gallery check."""
import copy
import hashlib
import json
from unittest.mock import patch
from pathlib import Path
import struct
import tempfile
import unittest
import zlib

import verify_scenario_galleries as gallery


class OriginalEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.name = 'docs/images/scenarios/travel/travel-01-pending-en-390.png'
        self.path = self.root / self.name
        self.path.parent.mkdir(parents=True)
        def chunk(kind, payload):
            return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))
        # A real, tiny compressed all-black 390×844 PNG; no external imaging dependency.
        png = gallery.PNG + chunk(b'IHDR', struct.pack('>IIBBBBB', 390, 844, 8, 2, 0, 0, 0))
        png += chunk(b'IDAT', zlib.compress(b'\0' * (844 * (390 * 3 + 1)))) + chunk(b'IEND', b'')
        self.path.write_bytes(png)
        self.commit = 'a' * 40
        self.run = {'id': 123, 'attempt': 1, 'url': 'https://github.com/test/example/actions/runs/123'}
        self.image = {'file': self.name, 'scenario': 'oa-travel', 'suite': 'scenario', 'captureCommit': self.commit,
                      'runUrl': self.run['url'], 'sha256': hashlib.sha256(png).hexdigest(),
                      'bytes': len(png), 'width': 390, 'height': 844,
                      'artifact': {'id': 11610673542, **gallery.ARTIFACTS[11610673542], 'originalPath': 'capture/travel-01-pending-en-390.png'},
                      'evidence': {'sourceRevision': self.commit, 'scenario': 'oa-travel',
                                   'captureRunId': '123', 'captureRunAttempt': '1', 'captureRunUrl': self.run['url'],
                                   'locale': 'en', 'state': 'pending', 'image': 'travel-01-pending-en-390.png',
                                   'imageSHA256': hashlib.sha256(png).hexdigest(),
                                   'viewport': {'width': 390, 'height': 844}, 'fullPage': False}}

    def errors(self, image=None):
        return gallery.validate_image(self.root, image or self.image, self.commit, self.run)

    def test_valid_original(self):
        self.assertEqual([], self.errors())

    def test_legacy_github_run_sidecar(self):
        ev = self.image['evidence']
        del ev['captureRunId']; del ev['captureRunAttempt']; del ev['captureRunUrl']
        ev['githubRun'] = {'id': '123', 'attempt': '1'}
        self.assertEqual([], self.errors())

    def test_image_tampering(self):
        self.path.write_bytes(self.path.read_bytes() + b'changed')
        self.assertTrue(any('hash mismatch' in e for e in self.errors()))

    def test_wrong_dimensions(self):
        self.image['height'] = 2000
        self.assertTrue(any('dimensions mismatch' in e for e in self.errors()))

    def test_changed_sidecar_hash(self):
        self.image['evidence']['imageSHA256'] = 'c' * 64
        self.assertTrue(any('hash mismatch' in e for e in self.errors()))

    def test_other_capture_commit(self):
        self.image['evidence']['sourceRevision'] = 'd' * 40
        self.assertTrue(any('commit mismatch' in e for e in self.errors()))

    def test_other_run_attempt(self):
        self.image['evidence']['captureRunAttempt'] = '2'
        self.assertTrue(any('run identity mismatch' in e for e in self.errors()))

    def test_false_viewport_or_missing_state(self):
        self.image['evidence']['viewport'] = {'width': 1440, 'height': 1000}
        self.image['evidence']['state'] = ''
        errors = self.errors()
        self.assertTrue(any('Viewport capture dimensions' in e for e in errors))
        self.assertTrue(any('Missing state' in e for e in errors))

    def test_path_escape(self):
        for name in ['../secrets.png', '/tmp/secrets.png', 'docs/images/scenarios/../../../secrets.png']:
            with self.subTest(name=name):
                image = copy.deepcopy(self.image); image['file'] = name
                self.assertTrue(any('Unsafe' in e for e in self.errors(image)))

    def test_missing_or_non_png_file(self):
        self.path.write_text('not a screenshot')
        self.assertTrue(any('Invalid PNG' in e for e in self.errors()))
        self.path.unlink()
        self.assertTrue(any('Missing image' in e for e in self.errors()))

    def test_broken_local_link_and_anchor(self):
        page = self.root / 'page.md'
        page.write_text('# Page\n\n[Missing](missing.md)\n[Missing anchor](page.md#absent)\n')
        self.assertEqual(2, len(gallery.validate_links(self.root, page)))
        page.write_text('# Page\n\n[Valid](page.md#page)\n[External](https://example.com/)\n')
        self.assertEqual([], gallery.validate_links(self.root, page))

    def test_exact_state_rejects_substring(self):
        self.image['evidence']['state'] = 'e'
        self.assertTrue(any('exact state' in e for e in self.errors()))

    def test_artifact_identity_rejects_relabeling(self):
        for key, value in [('id', 42), ('name', 'wrong-artifact'), ('sha256', 'c' * 64)]:
            with self.subTest(key=key):
                image = copy.deepcopy(self.image); image['artifact'][key] = value
                self.assertTrue(any('Artifact identity' in e for e in self.errors(image)))

    def test_dirty_source_is_rejected(self):
        self.image['evidence']['sourceWorkingTree'] = 'modified-local-worktree'
        self.assertTrue(any('Dirty source' in e for e in self.errors()))

    def test_ui_source_hash_is_rejected(self):
        self.image['evidence']['uiSourceTreeSHA256'] = 'f' * 64
        self.assertTrue(any('UI source hash' in e for e in self.errors()))

    def test_pinned_historical_and_baseline_identities(self):
        original = json.loads((gallery.ROOT / gallery.MANIFEST).read_text())
        for key in ['captureCommit', 'captureTree']:
            with self.subTest(key=key):
                data = copy.deepcopy(original); data[key] = 'f' * 40
                with patch.object(gallery.json, 'loads', return_value=data):
                    self.assertTrue(any('Historical capture' in e for e in gallery.verify()))
        data = copy.deepcopy(original); data['applicationBaseline']['trees']['src'] = 'f' * 40
        with patch.object(gallery.json, 'loads', return_value=data):
            self.assertTrue(any('baseline identity' in e for e in gallery.verify()))

    def test_current_complete_gallery(self):
        self.assertEqual([], gallery.verify())


if __name__ == '__main__':
    unittest.main()
