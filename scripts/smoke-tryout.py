#!/usr/bin/env python3
"""Real build/start/readiness/SIGINT smoke test. Requires the documented toolchain."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
with socket.socket() as first, socket.socket() as second:
    first.bind(('127.0.0.1', 0))
    second.bind(('127.0.0.1', 0))
    ports = [first.getsockname()[1], second.getsockname()[1]]
with tempfile.TemporaryDirectory(prefix='arcflow-smoke-') as temporary:
    log_path = Path(temporary) / 'launcher.log'
    with log_path.open('w') as log:
        process = subprocess.Popen([sys.executable, str(ROOT / 'scripts/tryout.py'), '--backend-port', str(ports[0]), '--ui-port', str(ports[1]), *sys.argv[1:]], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
    runtime = None
    try:
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            output = log_path.read_text()
            for line in output.splitlines():
                if line.startswith('Private runtime directory: '):
                    runtime = Path(line.split(': ', 1)[1])
            if '\nREADY: ' in output:
                break
            if process.poll() is not None:
                raise RuntimeError('Launcher exited before READY. Output:\n' + output)
            time.sleep(0.5)
        else:
            raise RuntimeError('Launcher did not become ready within 600 seconds.')
        assert runtime is not None
        assert runtime.stat().st_mode & 0o777 == 0o700
        creds = runtime / 'credentials.json'
        assert creds.stat().st_mode & 0o777 == 0o600
        passwords = json.loads(creds.read_text())
        assert set(passwords) == {'alice', 'bob', 'carol'}
        assert len(set(passwords.values())) == 3
        logs = output + ''.join(p.read_text() for p in runtime.glob('*.log'))
        assert not any(p in logs for p in passwords.values()), 'Password leaked to logs'
        process.send_signal(signal.SIGINT)
        assert process.wait(timeout=20) == 130
        assert not runtime.exists(), 'Private runtime was not removed'
        for port in ports:
            with socket.socket() as probe:
                assert probe.connect_ex(('127.0.0.1', port)) != 0, 'Service survived Ctrl-C'
        print('PASS: fresh build, non-default ports, authenticated readiness, secret permissions/no log leakage, Ctrl-C cleanup.')
    finally:
        if process.poll() is None:
            process.send_signal(signal.SIGTERM)
            process.wait(timeout=25)
