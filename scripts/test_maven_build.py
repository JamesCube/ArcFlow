"""Offline regression tests for root Maven build inventory validation."""
import json
from pathlib import Path
import tempfile
import unittest

from check_maven_build import GOALS, declared_plugins, verify

ROOT = Path(__file__).resolve().parents[1]


class MavenBuildInventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.pom = Path(self.temp.name) / "pom.xml"
        self.pom.write_text((ROOT / "pom.xml").read_text(encoding="utf-8"), encoding="utf-8")
        self.log = Path(self.temp.name) / "verify.log"
        plugins = self.plugins = declared_plugins(self.pom)
        self.text = "Apache Maven 3.9.16 (test)\nJava version: 17.0.20.1, vendor: test\n"
        self.text += "\n".join(
            f"[INFO] --- {name}:{plugins[name]}:{goal} (default-{goal}) @ arcflow-core ---"
            for name, goals in GOALS.items() for goal in sorted(goals)
        ) + "\n[INFO] BUILD SUCCESS\n"

    def check(self, text=None, java="17"):
        self.log.write_text(self.text if text is None else text, encoding="utf-8")
        return verify(self.pom, self.log, java)

    def test_declared_root_plugins_are_all_fixed(self):
        self.assertEqual(set(declared_plugins(self.pom)), set(GOALS))

    def test_success_records_toolchain_and_all_goals(self):
        result = self.check()
        self.assertEqual(result["maven"], "3.9.16")
        self.assertEqual(result["compiler_release"], 17)
        self.assertEqual(len(result["plugins"]), 4)
        json.dumps(result)

    def test_java21_and_full_plugin_names(self):
        text = self.text.replace("17.0.20.1", "21.0.12")
        for name in GOALS:
            text = text.replace(f"--- {name}:", f"--- maven-{name}-plugin:")
        self.assertEqual(self.check(text, "21")["java"], "21.0.12")

    def test_ansi_colors_are_ignored(self):
        self.check("\x1b[0m" + self.text.replace("[INFO]", "\x1b[32m[INFO]\x1b[0m"))

    def test_missing_explicit_pin_fails(self):
        source = self.pom.read_text(encoding="utf-8")
        version = declared_plugins(self.pom)["resources"]
        self.pom.write_text(source.replace(
            f"<artifactId>maven-resources-plugin</artifactId><version>{version}</version>",
            "<artifactId>maven-resources-plugin</artifactId>"), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "fixed release"):
            declared_plugins(self.pom)

    def test_dynamic_versions_fail(self):
        source = self.pom.read_text(encoding="utf-8")
        for version in ("LATEST", "[3.4,4)", "3.4.0-SNAPSHOT", "${resources.version}"):
            with self.subTest(version=version):
                self.pom.write_text(source.replace(
                    f"<artifactId>maven-resources-plugin</artifactId><version>{self.plugins['resources']}</version>",
                    f"<artifactId>maven-resources-plugin</artifactId><version>{version}</version>"),
                    encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "fixed release"):
                    declared_plugins(self.pom)

    def test_executed_plugin_drift_fails(self):
        with self.assertRaisesRegex(ValueError, "differs from POM"):
            self.check(self.text.replace(f"resources:{self.plugins['resources']}:", "resources:99.99.99:"))

    def test_missing_goal_fails(self):
        with self.assertRaisesRegex(ValueError, "goals are missing"):
            self.check("\n".join(line for line in self.text.splitlines() if ":testResources " not in line))

    def test_wrong_java_fails(self):
        with self.assertRaisesRegex(ValueError, "Expected JDK 21"):
            self.check(java="21")

    def test_missing_toolchain_inventory_fails(self):
        with self.assertRaisesRegex(ValueError, "Missing Maven/JDK"):
            self.check(self.text.replace("Apache Maven", "Unrecorded Maven"))

    def test_failed_build_fails(self):
        with self.assertRaisesRegex(ValueError, "BUILD SUCCESS"):
            self.check(self.text.replace("BUILD SUCCESS", "BUILD FAILURE"))

    def test_unknown_plugin_fails(self):
        with self.assertRaisesRegex(ValueError, "differs from POM"):
            self.check(self.text + "[INFO] --- unknown:1.0.0:run (check) @ arcflow-core ---\n")

    def test_foreign_plugin_coordinates_fail(self):
        with self.assertRaisesRegex(ValueError, "Unrecognized executed plugin"):
            self.check(self.text + "[INFO] --- org.codehaus.mojo:exec-maven-plugin:3.5.0:exec (check) @ arcflow-core ---\n")

    def test_fully_qualified_apache_plugin_coordinates(self):
        text = self.text
        for name in GOALS:
            text = text.replace(f"--- {name}:", f"--- org.apache.maven.plugins:maven-{name}-plugin:")
        self.check(text)

    def test_failure_is_not_masked_by_success_marker(self):
        with self.assertRaisesRegex(ValueError, "BUILD SUCCESS"):
            self.check(self.text + "[ERROR] BUILD FAILURE\n")


if __name__ == "__main__":
    unittest.main()
