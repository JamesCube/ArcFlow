import json
from pathlib import Path
import tempfile
import unittest

import verify_developer_docs as docs


class DeveloperDocsChecks(unittest.TestCase):
    def test_all_real_controllers_are_inventoried(self):
        endpoints = docs.inventory()
        self.assertEqual(30, len(endpoints))
        self.assertEqual(9, sum(e['host'] == 'ruoyi' for e in endpoints))
        self.assertEqual(21, sum(e['host'] == 'standalone' for e in endpoints))
        self.assertFalse(any(e['path'].endswith('/login') for e in endpoints))

    def test_bounded_seal_handler_is_distinguished(self):
        endpoints = docs.inventory()
        seal = [e for e in endpoints if e['path'] == '/api/scenarios/oa-seal-use/documents']
        self.assertEqual(1, len(seal))
        self.assertEqual('application/json', seal[0]['consumes'])
        self.assertIn('/api/scenarios/{scenarioId}/documents', {e['path'] for e in endpoints})

    def test_json_rejects_duplicate_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'sample.json'
            path.write_text('{"field": 1, "field": 2}')
            with self.assertRaises(ValueError):
                docs.unique_json(path)

    def test_json_rejects_nonfinite_numbers(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'sample.json'
            for value in ['NaN', 'Infinity', '-Infinity']:
                path.write_text('{"amount": ' + value + '}')
                with self.assertRaises(ValueError):
                    docs.unique_json(path)

    def test_fenced_examples_do_not_create_fake_links_or_headings(self):
        text = '# Real\n```md\n# Fake\n[not a link](missing.md)\n```\n[real](README.md)\n'
        self.assertNotIn('Fake', docs.unfenced(text))
        self.assertIn('[real]', docs.unfenced(text))

    def test_explicit_unicode_and_duplicate_anchors(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'sample.md'
            path.write_text('<a id="en"></a>\n# 简体中文\n## API `request`\n## API `request`\n')
            self.assertEqual({'en', '简体中文', 'api-request', 'api-request-1'}, docs.anchors(path))

    def test_examples_have_expected_business_types(self):
        directory = docs.ROOT / 'docs/api/examples'
        bodies = [docs.unique_json(p) for p in directory.glob('*.json')]
        self.assertEqual(16, len(bodies))
        self.assertEqual({'leave', 'procurement', 'quoteDiscount', 'expense', 'travel', 'sealUse',
                          'receiving', 'paymentRequest', 'contractApproval'},
                         {body['business']['type'] for body in bodies if 'business' in body})


if __name__ == '__main__':
    unittest.main()
