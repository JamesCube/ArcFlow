#!/usr/bin/env python3
"""Prove the bounded reference oracle detects five targeted semantic regressions.

Uses isolated temporary source copies; never edits the checkout's engine.
Example: python3 scripts/verify_graph_reference_mutations.py --maven mvn
Additional Maven arguments may follow --, e.g. -- -o -Dmaven.repo.local=/cache.
"""
import argparse
import json
import pathlib
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
ENGINE = pathlib.Path("src/main/java/com/arcflow/approval/graph/GraphEngine.java")
REPORT = pathlib.Path("target/surefire-reports/TEST-com.arcflow.approval.graph.GraphReferenceModelTest.xml")
MUTANTS = {
    "all_approval_uses_any_threshold": (
        'boolean approved = "ALL".equals(task.completionMode())',
        'boolean approved = "ANY".equals(task.completionMode())'),
    "any_rejection_uses_all_rule": (
        'boolean rejected = "ALL".equals(task.completionMode())',
        'boolean rejected = true'),
    "join_fires_on_first_arrival": (
        'boolean fired=arrived.size()==fork.expectedBranchIds().size();',
        'boolean fired=!arrived.isEmpty();'),
    "join_emits_twice": (
        'event("JOIN_FIRED",node.id(),null,fork.id());',
        'event("JOIN_FIRED",node.id(),null,fork.id()); event("JOIN_FIRED",node.id(),null,fork.id());'),
    "terminal_rejection_leaves_active_sibling": (
        'pending.nodeId(),"CANCELLED",pending.participants()',
        'pending.nodeId(),"ACTIVE",pending.participants()'),
}


def run(maven, extra, output):
    source = ROOT / "examples/approval-domain"
    original = (source / ENGINE).read_text()
    results = []
    for name, change in [("baseline", None), *MUTANTS.items()]:
        with tempfile.TemporaryDirectory(prefix="arcflow-reference-") as directory:
            work = pathlib.Path(directory) / "approval-domain"
            shutil.copytree(source, work, ignore=shutil.ignore_patterns("target", ".git"))
            if change:
                old, new = change
                if original.count(old) != 1:
                    raise RuntimeError(f"Mutation {name} no longer matches exactly once; review current source")
                (work / ENGINE).write_text(original.replace(old, new))
            command = [maven, *extra, "-f", str(work / "pom.xml"), "-Dtest=GraphReferenceModelTest", "test", "-q"]
            result = subprocess.run(command, capture_output=True, text=True, timeout=180)
            report = work / REPORT
            if not report.exists():
                raise RuntimeError(f"{name}: no test report; infrastructure failure, NOT a killed mutant\n{result.stdout}\n{result.stderr}")
            suite = ET.parse(report).getroot()
            tests, failures, errors, skipped = (int(suite.get(k, "0")) for k in ("tests", "failures", "errors", "skipped"))
            killed = result.returncode != 0 and failures == 1 and errors == 0 and skipped == 0
            if tests != 1 or skipped != 0 or (name == "baseline" and (result.returncode != 0 or failures + errors)) or (name != "baseline" and not killed):
                raise RuntimeError(f"{name}: unexpected result ({tests=}, {failures=}, {errors=}, {skipped=}, exit={result.returncode})")
            row = {"case": name, "tests": tests, "failures": failures, "errors": errors, "skipped": skipped, "result": "passed" if name == "baseline" else "killed",
                   "assertion_messages": [failure.get("message", "") for failure in suite.findall(".//failure")]}
            results.append(row)
            print(json.dumps(row), flush=True)
    if output:
        pathlib.Path(output).write_text(json.dumps({"scope": "Five targeted mutations, not a general mutation score", "results": results}, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--maven", default="mvn")
    parser.add_argument("--output")
    parser.add_argument("maven_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    extra = args.maven_args[1:] if args.maven_args[:1] == ["--"] else args.maven_args
    run(args.maven, extra, args.output)
