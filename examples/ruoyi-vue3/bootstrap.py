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
    shutil.copytree(HERE / 'frontend' / 'src', destination / 'frontend' / 'src', dirs_exist_ok=True)
    npm_lock = HERE / 'frontend' / 'package-lock.json'
    if npm_lock.exists():
        shutil.copyfile(npm_lock, destination / 'frontend' / 'package-lock.json')
    print(f'Pinned upstreams and overlay prepared in {destination}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, type=Path)
    bootstrap(parser.parse_args().directory)
