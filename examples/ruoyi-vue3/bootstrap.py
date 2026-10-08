#!/usr/bin/env python3
"""Fetch exact upstream commits into an isolated, disposable directory and apply ArcFlow overlay."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent

def run(*args):
    subprocess.run(args, check=True)

def bootstrap(destination):
    destination = destination.resolve()
    if destination.exists() and any(destination.iterdir()):
        raise SystemExit('Destination must be empty; refusing to modify an existing checkout')
    destination.mkdir(parents=True, exist_ok=True)
    lock = json.loads((HERE / 'upstream-lock.json').read_text())
    for name, source in lock.items():
        checkout = destination / name
        run('git', 'init', str(checkout))
        run('git', '-C', str(checkout), 'remote', 'add', 'origin', source['repository'])
        run('git', '-C', str(checkout), 'fetch', '--depth=1', 'origin', source['commit'])
        run('git', '-C', str(checkout), 'checkout', '--detach', 'FETCH_HEAD')
        actual = subprocess.check_output(['git', '-C', str(checkout), 'rev-parse', 'HEAD'], text=True).strip()
        if actual != source['commit']:
            raise SystemExit('Upstream commit mismatch')
    admin = destination / 'backend' / 'ruoyi-admin'
    shutil.copytree(HERE / 'backend' / 'src', admin / 'src', dirs_exist_ok=True)
    pom = admin / 'pom.xml'
    text = pom.read_text()
    marker = '<dependencies>'
    if text.count(marker) != 1:
        raise SystemExit('Upstream Maven layout changed')
    text = text.replace(marker, marker + '''
        <!-- ArcFlow reusable approval domain, not the standalone executable demo. -->
        <dependency>
            <groupId>com.arcflow.examples</groupId>
            <artifactId>approval-domain</artifactId>
            <version>0.1.0-SNAPSHOT</version>
        </dependency>''')
    pom.write_text(text)
    # Upstream hardcodes /home/ruoyi/logs, which is not writable on many hosts.
    # Retain its audit appenders; only make their directory local/configurable.
    logback = admin / 'src' / 'main' / 'resources' / 'logback.xml'
    logs = logback.read_text()
    marker = 'value="/home/ruoyi/logs"'
    if logs.count(marker) != 1:
        raise SystemExit('Upstream logging layout changed')
    logback.write_text(logs.replace(marker, 'value="${ARCFLOW_LOG_DIR:-./logs}"'))
    shutil.copytree(HERE / 'frontend' / 'src', destination / 'frontend' / 'src', dirs_exist_ok=True)
    # One reviewed business boundary for both hosts; do not fork money or retry
    # semantics in the native overlay. Committed copies also support direct view tests.
    shared = HERE.parent / 'approval-ui' / 'src'
    native = destination / 'frontend' / 'src' / 'views' / 'arcflow' / 'approval'
    for name in ('business-document.js', 'submission-intent.js', 'submission-response.js'):
        overlay = HERE / 'frontend' / 'src' / 'views' / 'arcflow' / 'approval' / name
        if overlay.read_bytes() != (shared / name).read_bytes():
            raise SystemExit(f'Shared/native helper drift: {name}')
        shutil.copyfile(shared / name, native / name)
    npm_lock = HERE / 'frontend' / 'package-lock.json'
    if npm_lock.exists():
        shutil.copyfile(npm_lock, destination / 'frontend' / 'package-lock.json')
    print(f'Pinned upstreams and overlay prepared in {destination}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, type=Path)
    bootstrap(parser.parse_args().directory)
