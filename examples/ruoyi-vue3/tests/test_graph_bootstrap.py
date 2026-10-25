"""Offline checks for native travel graph dependency and menu boundaries."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bootstrap', ROOT / 'bootstrap.py')
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class GraphBootstrapTest(unittest.TestCase):
    def test_transport_free_dependency_closure_is_byte_exact(self):
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp)
            stale = destination / 'src/views/arcflow/graph/shared/scenarios/scenario-api.js'
            stale.parent.mkdir(parents=True)
            stale.write_text('stale standalone transport')
            paths = bootstrap.copy_graph_sources(destination)
            self.assertFalse(stale.exists(), 'Removed transport survived closure refresh')
            self.assertIn('graph/GraphWorkspaceCore.vue', paths)
            self.assertIn('scenarios/scenario-json.js', paths)
            self.assertNotIn('api.js', paths)
            self.assertNotIn('graph/GraphHub.vue', paths)
            self.assertNotIn('graph/GraphWorkspace.vue', paths)
            for path in paths:
                actual = destination / 'src/views/arcflow/graph/shared' / path
                self.assertEqual(actual.read_bytes(), (ROOT.parent / 'approval-ui/src' / path).read_bytes())
                self.assertNotIn('Basic ', actual.read_text())
                self.assertNotIn('.test', path)

    def test_menu_is_distinct_and_reuses_permission_vocabulary(self):
        menu = (ROOT / 'sql/menu.sql').read_text()
        self.assertEqual(menu.count("'arcflow/graph/index'"), 1)
        self.assertIn("(21006, '出差图工作台', 21000", menu)
        self.assertIn("'arcflow/approval/index'", menu)
        self.assertNotIn('arcflow:graph:', menu)


if __name__ == '__main__':
    unittest.main()
