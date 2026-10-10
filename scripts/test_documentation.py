import hashlib
from pathlib import Path
import tempfile
import unittest
import check_documentation as docs


class DocumentationContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'guide.md').write_text('# 指南\n[English](guide.en.md)\n<!-- topic:setup -->\n## 运行\n')
        (self.root / 'guide.en.md').write_text('# Guide\n[简体中文](guide.md)\n<!-- topic:setup -->\n## Run\n')
        self.manifest = {'formatVersion': 1, 'documents': [{'path': 'guide.md', 'category': 'how-to', 'topics': ['setup']}], 'historicalSources': []}

    def errors(self):
        return docs.check_pairs(self.root, self.manifest)[0]

    def test_valid_pair(self):
        self.assertEqual([], self.errors())

    def test_missing_translation_fails(self):
        (self.root / 'guide.en.md').unlink()
        self.assertTrue(any('counterpart' in x for x in self.errors()))

    def test_missing_topic_fails(self):
        p = self.root / 'guide.en.md'; p.write_text(p.read_text().replace('<!-- topic:setup -->', ''))
        self.assertTrue(any('topic coverage' in x for x in self.errors()))

    def test_duplicate_topic_fails(self):
        p = self.root / 'guide.en.md'; p.write_text(p.read_text() + '\n<!-- topic:setup -->')
        self.assertTrue(any('duplicate topic' in x for x in self.errors()))

    def test_unregistered_page_fails(self):
        (self.root / 'forgotten.md').write_text('# Forgotten')
        self.assertTrue(any('absent from' in x for x in self.errors()))

    def test_stacked_languages_fail(self):
        p = self.root / 'guide.md'; p.write_text(p.read_text() + '\n## English\nOld text')
        self.assertTrue(any('stacked language' in x for x in self.errors()))

    def test_missing_switch_fails(self):
        p = self.root / 'guide.en.md'; p.write_text(p.read_text().replace('[简体中文](guide.md)', ''))
        self.assertTrue(any('language-switch' in x for x in self.errors()))

    def test_untranslated_prose_fails(self):
        p = self.root / 'guide.en.md'; p.write_text(p.read_text() + '\n\n' + '未翻译的中文段落' * 12)
        self.assertTrue(any('untranslated' in x for x in self.errors()))

    def test_missing_link_and_anchor_fail(self):
        p = self.root / 'guide.md'; p.write_text(p.read_text() + '\n[bad](absent.md)\n[anchor](guide.en.md#absent)')
        errors, count = docs.check_links(self.root, {'guide.md'})
        self.assertEqual(3, count)
        self.assertTrue(any('missing local' in x for x in errors))
        self.assertTrue(any('missing anchor' in x for x in errors))

    def test_links_in_fences_are_not_validated(self):
        p = self.root / 'guide.md'; p.write_text(p.read_text() + '\n```md\n[bad](absent.md)\n```\n')
        self.assertEqual([], docs.check_links(self.root, {'guide.md'})[0])

    def test_english_navigation_must_stay_english(self):
        (self.root / 'other.md').write_text('# Other')
        (self.root / 'other.en.md').write_text('# Other')
        p = self.root / 'guide.en.md'; p.write_text(p.read_text() + '\n[Other](other.md)')
        self.assertTrue(any('targets Chinese' in x for x in docs.check_links(self.root, {'guide.en.md'})[0]))

    def test_archive_hash_and_registration(self):
        p = self.root / 'docs/history/source.txt'; p.parent.mkdir(parents=True); p.write_bytes(b'original\n')
        self.manifest['historicalSources'] = [{'path':'docs/history/source.txt','revision':'a'*40,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}]
        self.assertEqual([], docs.check_history(self.root, self.manifest))
        p.write_bytes(b'edited\n')
        self.assertTrue(any('bytes changed' in x for x in docs.check_history(self.root, self.manifest)))
        self.manifest['historicalSources'] = []
        self.assertTrue(any('registry drift' in x for x in docs.check_history(self.root, self.manifest)))

    def test_registry_rejects_unsafe_path(self):
        self.manifest['documents'][0]['path'] = '../outside.md'
        self.assertTrue(any('unsafe' in x for x in self.errors()))

    def test_relative_dot_language_switch_is_valid(self):
        p = self.root / 'guide.md'
        p.write_text(p.read_text().replace('(guide.en.md)', '(./guide.en.md)'))
        self.assertEqual([], self.errors())

    def test_external_lookalike_is_not_language_switch(self):
        p = self.root / 'guide.md'
        p.write_text(p.read_text().replace('(guide.en.md)', '(https://example.invalid/guide.en.md)'))
        self.assertTrue(any('language-switch' in x for x in self.errors()))

    def test_encoded_english_navigation_still_checks_locale(self):
        (self.root / 'other.md').write_text('# Other')
        (self.root / 'other.en.md').write_text('# Other')
        p = self.root / 'guide.en.md'
        p.write_text(p.read_text() + '\n[Other](other%2Emd)')
        self.assertTrue(any('targets Chinese' in x for x in docs.check_links(self.root, {'guide.en.md'})[0]))

    def test_links_in_comments_and_inline_code_are_not_navigation(self):
        p = self.root / 'guide.md'
        p.write_text(p.read_text() + '\n<!-- [old](absent.md) -->\n`[syntax](missing.md)`\n')
        self.assertEqual([], docs.check_links(self.root, {'guide.md'})[0])

    def test_switch_hidden_in_comment_is_not_navigation(self):
        p = self.root / 'guide.md'
        p.write_text(p.read_text().replace('[English](guide.en.md)', '<!-- [English](guide.en.md) -->'))
        self.assertTrue(any('language-switch' in x for x in self.errors()))

    def test_inline_example_topic_does_not_count(self):
        p = self.root / 'guide.en.md'
        p.write_text(p.read_text().replace('<!-- topic:setup -->', '`<!-- topic:setup -->`'))
        self.assertTrue(any('topic coverage' in x for x in self.errors()))

    def test_topic_hidden_in_larger_comment_does_not_count(self):
        p = self.root / 'guide.en.md'
        p.write_text(p.read_text().replace('<!-- topic:setup -->', '<!-- old content\n<!-- topic:setup -->\n-->'))
        self.assertTrue(any('topic coverage' in x for x in self.errors()))

    def test_tilde_and_longer_backtick_fences_hide_links(self):
        p = self.root / 'guide.md'
        p.write_text(p.read_text() + '\n~~~md\n[bad](absent.md)\n~~~\n````md\n```\n[bad](also-absent.md)\n````\n')
        self.assertEqual([], docs.check_links(self.root, {'guide.md'})[0])

    def test_heading_in_code_or_comment_cannot_satisfy_anchor(self):
        p = self.root / 'guide.md'
        p.write_text(p.read_text() + '\n[bad](guide.en.md#hidden)\n')
        p = self.root / 'guide.en.md'
        p.write_text(p.read_text() + '\n~~~md\n## Hidden\n~~~\n<!--\n## Hidden\n-->\n')
        self.assertTrue(any('missing anchor' in x for x in docs.check_links(self.root, {'guide.md'})[0]))

    def test_registry_topic_ids_are_validated(self):
        self.manifest['documents'][0]['topics'] = ['not a stable id']
        self.assertTrue(any('stable topic' in x for x in self.errors()))

    def test_nonarray_registry_fails_readably(self):
        self.manifest['documents'] = {'guide.md': 'how-to'}
        self.assertTrue(any('array' in x for x in self.errors()))

    def test_symlinked_document_cannot_escape_repository(self):
        with tempfile.TemporaryDirectory() as outside:
            target = Path(outside) / 'external.md'
            target.write_text('# External\n[English](guide.en.md)\n<!-- topic:setup -->')
            p = self.root / 'guide.md'
            p.unlink()
            p.symlink_to(target)
            self.assertTrue(any('outside repository' in x for x in self.errors()))

    def test_archive_requires_sha256_and_revision_format(self):
        p = self.root / 'docs/history/source.txt'
        p.parent.mkdir(parents=True)
        p.write_bytes(b'original\n')
        self.manifest['historicalSources'] = [{'path': 'docs/history/source.txt', 'revision': 'main', 'sha256': 'short'}]
        errors = docs.check_history(self.root, self.manifest)
        self.assertTrue(any('revision' in x for x in errors))
        self.assertTrue(any('SHA-256' in x for x in errors))

    def test_archive_symlink_cannot_read_outside_repository(self):
        with tempfile.TemporaryDirectory() as outside:
            target = Path(outside) / 'external.txt'
            target.write_bytes(b'original\n')
            p = self.root / 'docs/history/source.txt'
            p.parent.mkdir(parents=True)
            p.symlink_to(target)
            self.manifest['historicalSources'] = [{'path': 'docs/history/source.txt', 'revision': 'a' * 40, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}]
            self.assertTrue(any('outside repository' in x for x in docs.check_history(self.root, self.manifest)))

    def test_bad_category_fails(self):
        self.manifest['documents'][0]['category'] = 'miscellaneous'
        self.assertTrue(any('category' in x for x in self.errors()))


class TryoutDocumentationTests(unittest.TestCase):
    def test_safe_failure_diagnostics_are_registered_in_both_languages(self):
        manifest = docs.unique_json(docs.ROOT / 'docs/documentation-map.json')
        entry = next(item for item in manifest['documents'] if item['path'] == 'docs/TRYOUT.md')
        self.assertIn('safe-failure-diagnostics', entry['topics'])
        for relative in ['docs/TRYOUT.md', 'docs/TRYOUT.en.md']:
            with self.subTest(path=relative):
                text = (docs.ROOT / relative).read_text()
                self.assertEqual(1, text.count('<!-- topic:safe-failure-diagnostics -->'))

    def test_safe_failure_guidance_keeps_bounds_privacy_cleanup_and_localized_recovery(self):
        # Check the actual guidance, not just matching topic markers: the language
        # split must not silently drop the diagnostic limits or recovery warnings.
        expected = {
            'docs/TRYOUT.md': [
                '无法启动、提前退出或就绪超时', '失败阶段', '状态及退出码',
                'UI 未响应与后端认证 API 未就绪', '末尾最多 64 KiB', '最多六条固定',
                '不保证覆盖完整根因', '未知日志、异常详情、凭据和请求数据不会复制',
                '不会另存诊断文件', '失败及正常 Ctrl-C', '终止本次进程组并删除私有运行目录',
                'python3 scripts/tryout.py --check', '(GETTING_STARTED.md#简体中文)',
                '不要将凭据文件或未经检查的原始日志', '强制结束进程或系统崩溃仍可能阻止清理',
            ],
            'docs/TRYOUT.en.md': [
                'cannot start, exits early, or never becomes ready', 'failing phase', 'state/exit code',
                'unresponsive UI', 'authenticated backend API that is not ready',
                'at most the last 64 KiB', 'up to six fixed', 'not a complete root-cause analysis',
                'Unknown text, exception details, credentials and request data are never copied',
                'no diagnostic file is saved', 'stops its process groups and deletes the private runtime directory',
                'on failure as well as normal Ctrl-C', 'python3 scripts/tryout.py --check',
                '(GETTING_STARTED.en.md#english)',
                'Do not paste the private credentials file or unreviewed raw logs',
                'Forced kills and OS crashes still cannot guarantee cleanup',
            ],
        }
        for relative, fragments in expected.items():
            text = (docs.ROOT / relative).read_text()
            section = text.split('<!-- topic:safe-failure-diagnostics -->', 1)[-1].split('\n\n- ', 1)[0]
            for fragment in fragments:
                with self.subTest(path=relative, guidance=fragment):
                    self.assertIn(fragment, section)


if __name__ == '__main__':
    unittest.main()
