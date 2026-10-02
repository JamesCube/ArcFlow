#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p target/offline-classes
find src/main/java -name '*.java' | sort > target/main-sources.txt
compiler=(javac)
if ! command -v javac >/dev/null 2>&1; then compiler=(java com.sun.tools.javac.Main); fi
"${compiler[@]}" --release 17 -Xlint:all -Werror -encoding UTF-8 -d target/offline-classes @target/main-sources.txt src/test/java/com/arcflow/EngineChecks.java
java -cp target/offline-classes com.arcflow.EngineChecks
java -cp target/offline-classes com.arcflow.example.QuickStart
