#!/usr/bin/env python3
"""Check the root verify lifecycle's declared and executed plugin inventory."""
import argparse
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

NS = {"m": "http://maven.apache.org/POM/4.0.0"}
GOALS = {
    "resources": {"resources", "testResources"},
    "compiler": {"compile", "testCompile"},
    "surefire": {"test"},
    "jar": {"jar"},
}
EXECUTION = re.compile(
    r"^\[INFO\] --- (\S+) \([^)]*\) @ arcflow-core ---\s*$", re.MULTILINE
)


def declared_plugins(pom):
    root = ET.parse(pom).getroot()
    if root.findtext("m:properties/m:maven.compiler.release", namespaces=NS) != "17":
        raise ValueError("The core must retain maven.compiler.release=17")
    plugins = {}
    for plugin in root.findall("m:build/m:plugins/m:plugin", NS):
        group = plugin.findtext("m:groupId", default="org.apache.maven.plugins", namespaces=NS)
        artifact = plugin.findtext("m:artifactId", namespaces=NS)
        if group != "org.apache.maven.plugins" or artifact not in {
            f"maven-{name}-plugin" for name in GOALS
        }:
            raise ValueError(f"Unexpected root build plugin: {group}:{artifact}; update the inventory deliberately")
        name = artifact[len("maven-"):-len("-plugin")]
        version = plugin.findtext("m:version", default="", namespaces=NS)
        if not re.fullmatch(r"\d+(?:\.\d+){1,3}", version):
            raise ValueError(f"{artifact} must declare a fixed release version")
        if name in plugins:
            raise ValueError(f"Duplicate plugin: {artifact}")
        plugins[name] = version
    if set(plugins) != set(GOALS):
        raise ValueError(f"Missing explicit root verify plugins: {sorted(set(GOALS) - set(plugins))}")
    return plugins


def verify(pom, log, expected_java):
    declared = declared_plugins(pom)
    text = re.sub(r"\x1b\[[0-9;]*m", "", Path(log).read_text(encoding="utf-8"))
    maven = re.search(r"^Apache Maven ([^\s]+)", text, re.MULTILINE)
    java = re.search(r"^Java version: ([^,\s]+)", text, re.MULTILINE)
    if not maven or not java:
        raise ValueError("Missing Maven/JDK inventory; run mvn --show-version")
    if java.group(1).split(".")[0] != expected_java:
        raise ValueError(f"Expected JDK {expected_java}, found {java.group(1)}")
    if (not re.search(r"^\[INFO\] BUILD SUCCESS\s*$", text, re.MULTILINE)
            or re.search(r"^\[\w+\] BUILD FAILURE\s*$", text, re.MULTILINE)):
        raise ValueError("Root verify did not report BUILD SUCCESS")
    actual = {name: set() for name in GOALS}
    for execution in EXECUTION.findall(text):
        parts = execution.split(":")
        if len(parts) == 4 and parts[0] == "org.apache.maven.plugins":
            parts = parts[1:]
        if len(parts) != 3:
            raise ValueError(f"Unrecognized executed plugin coordinates: {execution}")
        name, version, goal = parts
        if name.startswith("maven-") and name.endswith("-plugin"):
            name = name[len("maven-"):-len("-plugin")]
        if name not in declared or version != declared[name]:
            raise ValueError(f"Executed plugin differs from POM: {name}:{version}:{goal}")
        actual[name].add(goal)
    if actual != GOALS:
        raise ValueError(f"Root verify goals are missing or unexpected: {actual}")
    return {"maven": maven.group(1), "java": java.group(1), "compiler_release": 17,
            "plugins": {f"org.apache.maven.plugins:maven-{name}-plugin": {
                "version": declared[name], "goals": sorted(actual[name])
            } for name in sorted(GOALS)}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pom", type=Path, default=Path("pom.xml"))
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--java", choices=("17", "21"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        inventory = verify(args.pom, args.log, args.java)
    except (ValueError, OSError, ET.ParseError) as error:
        parser.exit(1, f"Build inventory failed: {error}\n")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(inventory, sort_keys=True))


if __name__ == "__main__":
    main()
