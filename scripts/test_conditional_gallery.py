"""Mutation regressions against the real, byte-locked conditional gallery.

All mutations occur in one private temporary checkout, restored after each test.
The fixture retains real original bytes; no hashes, states, dimensions, receipt
identities, or positive validation results are mocked.
"""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest

import verify_conditional_gallery as gallery


class ConditionalGalleryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name) / 'repo'
        shutil.copytree(gallery.ROOT, cls.root,
                        ignore=shutil.ignore_patterns('.git', 'node_modules', '__pycache__', 'target', 'dist'))

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.before = {}
        self.data = json.loads((self.root / gallery.MANIFEST).read_text())
        self.image = next(item for item in self.data['images']
                          if item['state'] == 'payment-high-partial' and item['locale'] == 'en'
                          and item['viewport'] == 'desktop')

    def tearDown(self):
        for name, original in reversed(list(self.before.items())):
            path = self.root / name
            if path.is_symlink():
                path.unlink()
            if original is None:
                if path.exists():
                    path.unlink()
            else:
                path.write_bytes(original)

    def remember(self, name):
        if name not in self.before:
            path = self.root / name
            self.before[name] = path.read_bytes() if path.is_file() else None

    def write(self, name, raw):
        self.remember(name)
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw.encode() if isinstance(raw, str) else raw)

    def save(self):
        self.write(gallery.MANIFEST, json.dumps(self.data, ensure_ascii=False, indent=2) + '\n')

    def rehash_inventory(self, name):
        raw = (self.root / name).read_bytes()
        entry = next(item for item in self.data['files'] if item['file'] == name)
        entry.update(sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw))
        self.save()

    def mutate_json(self, name, change, rehash=False):
        data = json.loads((self.root / name).read_text())
        change(data)
        self.write(name, json.dumps(data, ensure_ascii=False, indent=2) + '\n')
        if rehash:
            self.rehash_inventory(name)

    def rejected(self, needle=None):
        errors = gallery.verify(self.root)
        self.assertTrue(errors, 'Mutated evidence incorrectly passed')
        if needle:
            self.assertTrue(any(needle in error for error in errors), '\n'.join(errors))

    def test_complete_unmodified_gallery(self):
        self.assertEqual([], gallery.verify(self.root))

    def test_png_byte_mutation(self):
        name = self.image['file']
        self.write(name, (self.root / name).read_bytes() + b'changed')
        self.rejected('Historical original hash mismatch')

    def test_rehashing_png_sidecar_and_inventory_cannot_bless_new_pixels(self):
        name = self.image['file']
        raw = (self.root / name).read_bytes() + b'changed'
        self.write(name, raw)
        self.rehash_inventory(name)
        self.mutate_json(self.image['sidecar'], lambda item: item.update(imageSHA256=hashlib.sha256(raw).hexdigest()), rehash=True)
        self.rejected('Historical original hash mismatch')

    def test_sidecar_byte_mutation_even_when_rehashed(self):
        self.mutate_json(self.image['sidecar'], lambda item: item.update(requestStatus='APPROVED'), rehash=True)
        self.rejected('Historical original hash mismatch')
        self.rejected('Original sidecar metadata mismatch (requestStatus)')

    def test_receipt_byte_mutation_even_when_rehashed(self):
        name = f'{gallery.DIRECTORY}/payment/en/routing-receipt.json'
        self.mutate_json(name, lambda item: item['checkpoints'][0].update(requestId='invented-request'), rehash=True)
        self.rejected('Historical original hash mismatch')
        self.rejected('Receipt checkpoint mismatch')

    def test_runtime_byte_mutation_even_when_rehashed(self):
        name = f'{gallery.DIRECTORY}/runtime/routing-runtime.json'
        self.mutate_json(name, lambda item: item.update(springBootVersion='3.5.0'), rehash=True)
        self.rejected('Historical original hash mismatch')
        self.rejected('Original runtime report metadata mismatch')

    def test_source_manifest_rehash_attack(self):
        name = self.image['file']
        raw = (self.root / name).read_bytes() + b'replacement'
        self.write(name, raw)
        self.rehash_inventory(name)
        original = next(item['originalPath'] for item in self.data['files'] if item['file'] == name)
        self.mutate_json(gallery.SOURCE_MANIFEST,
                         lambda item: item['files'].update({original: hashlib.sha256(raw).hexdigest()}))
        self.rejected('Historical source manifest hash mismatch')

    def test_source_manifest_whitespace_is_not_an_original_copy(self):
        path = self.root / gallery.SOURCE_MANIFEST
        self.write(gallery.SOURCE_MANIFEST, path.read_bytes() + b'\n')
        self.rejected('Historical source manifest hash mismatch')

    def test_provenance_hash_cannot_substitute_for_locked_original(self):
        self.data['files'][0]['sha256'] = 'f' * 64
        self.save()
        self.rejected('Locked original inventory mismatch')

    def test_wrong_original_archive_path(self):
        self.data['files'][0]['originalPath'] = 'invented/routing-runtime.json'
        self.save()
        self.rejected('Locked original inventory mismatch')

    def test_wrong_capture_identity(self):
        for key, value in [('commit', 'f' * 40), ('tree', 'f' * 40), ('runId', '123'),
                           ('runAttempt', 2), ('artifactId', 123), ('archiveSHA256', 'f' * 64)]:
            with self.subTest(key=key):
                original = self.data['capture'][key]
                self.data['capture'][key] = value
                self.save()
                self.rejected('Historical capture identity mismatch')
                self.data['capture'][key] = original

    def test_wrong_baseline_or_comparison(self):
        self.data['baseline']['commit'] = 'f' * 40
        self.save()
        self.rejected('baseline/source comparison mismatch')
        self.data['baseline']['commit'] = gallery.BASELINE_COMMIT
        self.data['baseline']['sourceComparison']['captureUiTreeSHA256'] = 'f' * 64
        self.save()
        self.rejected('baseline/source comparison mismatch')

    def test_missing_original_of_each_kind(self):
        for kind in ('image', 'sidecar', 'receipt', 'runtime'):
            with self.subTest(kind=kind):
                name = next(item['file'] for item in self.data['files'] if item['kind'] == kind)
                self.remember(name)
                (self.root / name).unlink()
                self.rejected('Missing or extra on-disk original paths')
                (self.root / name).write_bytes(self.before[name])

    def test_extra_unregistered_png_and_json(self):
        for extension in ('png', 'json'):
            name = f'{gallery.DIRECTORY}/payment/en/unregistered.{extension}'
            self.write(name, b'not original')
            self.rejected('Missing or extra on-disk original paths')

    def test_missing_inventory_entry(self):
        self.data['files'].pop()
        self.save()
        self.rejected('Missing or extra original inventory paths')

    def test_duplicate_inventory_entry(self):
        self.data['files'].append(copy.deepcopy(self.data['files'][0]))
        self.save()
        self.rejected('Duplicate original file inventory entry')

    def test_extra_registered_inventory_entry(self):
        item = copy.deepcopy(self.data['files'][0])
        item.update(file=f'{gallery.DIRECTORY}/runtime/invented.json', originalPath='invented.json')
        self.data['files'].append(item)
        self.write(item['file'], '{}')
        self.save()
        self.rejected('Missing or extra original inventory paths')

    def test_missing_and_duplicate_image(self):
        removed = self.data['images'].pop()
        self.save()
        self.rejected('exactly 80 originals')
        self.data['images'].append(copy.deepcopy(self.data['images'][0]))
        self.save()
        self.rejected('duplicate image inventory')
        self.assertIsNotNone(removed)

    def test_duplicate_variant_and_unknown_state(self):
        self.image['viewport'] = '390px'
        self.save()
        self.rejected('Business-state variants mismatch')
        self.image['viewport'] = 'desktop'
        self.image['state'] = 'payment-invented-state'
        self.save()
        self.rejected('Business-state variants mismatch')

    def test_wrong_request_status_step_or_decision_count(self):
        for key, value in [('requestId', 'invented'), ('status', 'APPROVED'),
                           ('currentStepId', 'payment-final'), ('decisionCount', 3),
                           ('decisionCount', True)]:
            with self.subTest(key=key, value=value):
                old = self.image[key]
                self.image[key] = value
                self.save()
                self.rejected(f'Image metadata mismatch ({key})')
                self.image[key] = old

    def test_wrong_sidecar_pointer_or_dimensions(self):
        self.image['sidecar'] = self.data['images'][0]['sidecar']
        self.image['height'] += 1
        self.save()
        self.rejected('Image metadata mismatch (sidecar)')
        self.rejected('Image metadata mismatch (height)')

    def test_wrong_locale_and_scenario(self):
        self.image['locale'] = 'zh'
        self.image['scenario'] = 'receiving'
        self.save()
        self.rejected('Image metadata mismatch (locale)')
        self.rejected('Image metadata mismatch (scenario)')

    def test_unsafe_inventory_paths(self):
        for name in ('/tmp/invented.png', '../invented.png',
                     f'{gallery.DIRECTORY}/../invented.png',
                     f'{gallery.DIRECTORY}/payment//en/invented.png',
                     f'{gallery.DIRECTORY}/payment\\en\\invented.png'):
            with self.subTest(name=name):
                self.data['files'][0]['file'] = name
                self.save()
                self.rejected('Unsafe path')

    def test_symlink_evidence_is_rejected(self):
        name = self.image['file']
        self.remember(name)
        path = self.root / name
        path.unlink()
        other = next(item['file'] for item in self.data['images'] if item['file'] != name)
        path.symlink_to(self.root / other)
        self.rejected('Symlink')

    def test_missing_original_link_in_each_language(self):
        relative = '../../images/conditional-routing/cb3f1077/' + self.image['file'].removeprefix(gallery.DIRECTORY + '/')
        for suffix in ('', '.en'):
            with self.subTest(language=suffix):
                name = f'{gallery.PAGES}/payment{suffix}.md'
                text = (self.root / name).read_text()
                self.assertIn(relative, text)
                self.write(name, text.replace(relative, 'README' + suffix + '.md'))
                self.rejected('original PNG coverage mismatch')

    def test_unused_reference_definition_cannot_fake_coverage(self):
        relative = '../../images/conditional-routing/cb3f1077/' + self.image['file'].removeprefix(gallery.DIRECTORY + '/')
        name = f'{gallery.PAGES}/payment.md'
        text = (self.root / name).read_text()
        self.write(name, text.replace(relative, 'README.md') + '\n[unused]: ' + relative + '\n')
        self.rejected('original PNG coverage mismatch')

    def test_broken_markdown_and_html_links(self):
        name = f'{gallery.PAGES}/payment.md'
        self.write(name, (self.root / name).read_text() + '\n[Broken](missing.md)\n<img src=missing.png>\n')
        self.rejected('missing or unsafe local link missing.md')
        self.rejected('missing or unsafe local link missing.png')

    def test_broken_anchor_and_path_escape(self):
        name = f'{gallery.PAGES}/payment.md'
        self.write(name, (self.root / name).read_text() +
                   '\n[Broken](README.md#absent-anchor)\n<a href="../../../../../../etc/passwd">Outside</a>\n')
        self.rejected('missing local anchor')
        self.rejected('missing or unsafe local link ../../../../../../etc/passwd')

    def test_missing_bilingual_page(self):
        name = f'{gallery.PAGES}/contract.en.md'
        self.remember(name)
        (self.root / name).unlink()
        self.rejected('Missing bilingual gallery page')

    def test_missing_root_entry_point(self):
        name = 'README.en.md'
        text = (self.root / name).read_text()
        target = f'{gallery.PAGES}/README.en.md'
        self.assertIn(target, text)
        self.write(name, text.replace(target, 'README.en.md'))
        self.rejected('Root README.en lacks conditional gallery entry')

    def test_duplicate_json_key_and_nonfinite_number(self):
        raw = (self.root / gallery.MANIFEST).read_text()
        self.write(gallery.MANIFEST, raw.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1', 1))
        self.rejected('duplicate JSON key')
        self.write(gallery.MANIFEST, raw.replace('"schemaVersion": 1', '"schemaVersion": NaN', 1))
        self.rejected('invalid JSON number')

    def test_link_extraction_supports_real_references_and_ignores_examples(self):
        text = ('[Original][photo]\n[photo]: image.png\n'
                '[unused]: invisible.png\n<img SRC = "mobile.png">\n'
                '<!-- ![Hidden](hidden.png) -->\n`[Code](code.png)`\n'
                '```md\n![Example](example.png)\n```\n')
        self.assertEqual({'image.png', 'mobile.png'}, set(gallery.references(text)))


if __name__ == '__main__':
    unittest.main()
