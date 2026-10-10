#!/usr/bin/env python3
"""Build and run the local-only standalone demo. No third-party Python packages."""
import argparse
import base64
import errno
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / 'examples/approval-ui'
BACKEND = ROOT / 'examples/approval-demo/backend'

# Never copy log text into diagnostics: even a line without a password/token
# label may contain credentials or business data. Only these fixed hints leave
# the private runtime directory. Reading and output are both bounded.
DIAGNOSTIC_BYTES = 64 * 1024
DIAGNOSTIC_HINTS = (
    (r'EADDRINUSE|address already in use|Port \d+ (?:was already|is already) in use',
     'Port conflict: choose unused --backend-port and --ui-port values.'),
    (r'EACCES|permission denied|AccessDeniedException',
     'Permission denied: check checkout, temporary-directory and executable permissions.'),
    (r'ENOSPC|no space left on device',
     'Disk full: free space in the checkout and temporary filesystem, then retry.'),
    (r'unable to access jarfile|invalid or corrupt jarfile|ZipException',
     'Backend JAR missing or unreadable: rerun the launcher to rebuild it.'),
    (r'UnsupportedClassVersionError|unrecognized VM option|could not create the Java Virtual Machine',
     'Java startup rejected: check java/javac versions and JAVA_TOOL_OPTIONS/JDK_JAVA_OPTIONS.'),
    (r'ERR_MODULE_NOT_FOUND|Cannot find module|vite: (?:not found|command not found)',
     'UI dependency missing: rerun npm ci in examples/approval-ui, then retry.'),
    (r'ECONNREFUSED|connection refused',
     'Connection refused: check the backend state and that both configured ports are free.'),
    (r'Set APPROVAL_(?:ALICE|BOB|CAROL)_PASSWORD to',
     'Demo credentials rejected: rerun for fresh generated accounts; do not share credentials.'),
    (r'APPLICATION FAILED TO START|BeanCreationException|BindException',
     'Backend configuration failed: check local Java/Spring overrides using the manual startup guide.'),
)
FAILURE_MESSAGES = {
    'early-exit': 'A demo service exited before readiness.',
    'timeout-ui': 'Demo readiness timed out: the UI did not return HTTP 200. Check the UI state and port.',
    'timeout-api': 'Demo readiness timed out: the UI responded, but its authenticated API did not become ready. Check the backend and proxy configuration.',
    'service-exit': 'A demo service stopped unexpectedly; stopping the other service.',
}


class DemoFailure(RuntimeError):
    def __init__(self, reason):
        super().__init__(FAILURE_MESSAGES[reason])
        self.reason = reason


def log_hints(path):
    """Classify a bounded log tail; return only constant, allowlisted text."""
    try:
        with path.open('rb') as log:
            log.seek(0, os.SEEK_END)
            log.seek(max(0, log.tell() - DIAGNOSTIC_BYTES))
            tail = log.read(DIAGNOSTIC_BYTES).decode('utf-8', errors='replace')
    except OSError:
        return ['Log unavailable; check the service state and local toolchain.']
    hints = [hint for pattern, hint in DIAGNOSTIC_HINTS if re.search(pattern, tail, re.IGNORECASE)]
    return hints[:6] or ['No recognized cause in the last 64 KiB of log. Use the manual startup guide to inspect the failure locally.']


def service_states(services):
    states = {}
    for name, child in services.items():
        code = child.poll() if child is not None else None
        states[name] = ('not started' if child is None else
                        'still running at failure' if code is None else
                        'exited with code ' + str(code))
    return states


def report_failure(runtime, states):
    print('TRYOUT: Safe diagnostic summary (raw logs and exception text are withheld).', file=sys.stderr)
    for name, state in states.items():
        print('  ' + name + ': ' + state, file=sys.stderr)
        for hint in log_hints(runtime / (name + '.log')):
            print('    ' + hint, file=sys.stderr)
    print('  Next: python3 scripts/tryout.py --check; manual startup: docs/GETTING_STARTED.md.', file=sys.stderr)
    print('  No diagnostic file is retained. Keep any manually inspected logs private.', file=sys.stderr)


def version(command, pattern):
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=30)
    match = re.search(pattern, result.stdout)
    if result.returncode or not match:
        raise RuntimeError('Cannot determine version: ' + command[0])
    return tuple(int(x) for x in match.groups())


def prerequisites(maven):
    if os.name != 'posix':
        raise RuntimeError('Use Linux, macOS, or WSL. Native Windows is not supported by this launcher.')
    if sys.version_info < (3, 9):
        raise RuntimeError('Python 3.9+ is required.')
    for name in ['java', 'javac', maven, 'node', 'npm']:
        if not shutil.which(name):
            raise RuntimeError('Missing prerequisite: ' + name + '. Install it first; see docs/TRYOUT.md.')
    if version(['javac', '-version'], r'javac (\d+)')[0] < 17:
        raise RuntimeError('JDK 17+ is required.')
    if version(['java', '-version'], r'version "(\d+)')[0] < 17:
        raise RuntimeError('Java runtime 17+ is required.')
    if version([maven, '-version'], r'Apache Maven (\d+)\.(\d+)') < (3, 8):
        raise RuntimeError('Maven 3.8+ is required.')
    node = version(['node', '--version'], r'v(\d+)\.(\d+)\.(\d+)')
    if not ((node[0] == 22 and node >= (22, 22, 2)) or (node[0] == 24 and node >= (24, 15, 0)) or node[0] >= 26):
        raise RuntimeError('Node must match package.json: 22.22.2+, 24.15.0+, or 26+.')


def check_ports(ports):
    if len(set(ports)) != len(ports):
        raise RuntimeError('Backend and UI ports must differ.')
    held = []
    try:
        for port in ports:
            if not 1024 <= port <= 65535:
                raise RuntimeError('Ports must be between 1024 and 65535.')
            s = socket.socket()
            held.append(s)
            try:
                s.bind(('127.0.0.1', port))
            except OSError:
                raise RuntimeError('Port ' + str(port) + ' is occupied. Use --backend-port / --ui-port; no existing process was stopped.') from None
    finally:
        for s in held:
            s.close()


class Processes:
    def __init__(self):
        self.children = []

    def start(self, command, cwd=ROOT, **kwargs):
        child = subprocess.Popen(command, cwd=cwd, start_new_session=True, **kwargs)
        self.children.append(child)
        return child

    def run(self, command, cwd=ROOT):
        child = self.start(command, cwd)
        result = child.wait()
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        self.children.remove(child)
        if result != 0:
            raise RuntimeError('Build failed: ' + command[0] + '. See the output above; runtime was not started.')

    def stop(self):
        # Kill owned groups even if their leader exited, so Maven/npm descendants cannot leak.
        for child in self.children:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + 10
        for child in self.children:
            try:
                child.wait(timeout=max(0.01, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                pass
        for child in self.children:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        for child in self.children:
            child.wait()


def wait_ready(children, url, password, timeout=90):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    auth = base64.b64encode(('alice:' + password).encode()).decode()
    deadline = time.monotonic() + timeout
    ui_responded = False
    while time.monotonic() < deadline:
        if any(p.poll() is not None for p in children):
            raise DemoFailure('early-exit')
        try:
            with opener.open(url, timeout=1) as response:
                assert response.status == 200
            ui_responded = True
            req = urllib.request.Request(url + '/api/me', headers={'Authorization': 'Basic ' + auth})
            with opener.open(req, timeout=1) as response:
                if json.load(response)['id'] == 'alice':
                    return
        except (OSError, http.client.HTTPException, ValueError, KeyError, TypeError, AssertionError):
            time.sleep(0.25)
    raise DemoFailure('timeout-api' if ui_responded else 'timeout-ui')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Only check prerequisites and ports; do not download or build')
    parser.add_argument('--backend-port', type=int, default=8080)
    parser.add_argument('--ui-port', type=int, default=5173)
    parser.add_argument('--maven', default='mvn', help='Maven executable (not a shell command)')
    args = parser.parse_args()
    processes = Processes()
    runtime = None
    services = {'backend': None, 'ui': None}
    failed_states = None
    stage = 'preparing the private runtime'
    def interrupt(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGINT, interrupt)
    try:
        prerequisites(args.maven)
        check_ports([args.backend_port, args.ui_port])
        print('Required tools are available, and the local ports are free.', flush=True)
        if args.check:
            return 0
        print('Building the demo and downloading the configured npm and Maven dependencies. This does not install system tools.', flush=True)
        for pom in ['pom.xml', 'examples/approval-domain/pom.xml', 'examples/approval-demo/backend/pom.xml']:
            processes.run([args.maven, '-B', '-ntp', '-f', pom, 'install' if 'backend' not in pom else 'package'])
        processes.run(['npm', 'ci'], UI)
        processes.run(['npm', 'run', 'build'], UI)
        check_ports([args.backend_port, args.ui_port])
        runtime = Path(tempfile.mkdtemp(prefix='arcflow-tryout-'))
        os.chmod(runtime, 0o700)
        passwords = {name: secrets.token_urlsafe(24) for name in ['alice', 'bob', 'carol']}
        credentials = runtime / 'credentials.json'
        with credentials.open('x') as output:
            os.chmod(credentials, 0o600)
            json.dump(passwords, output, indent=2)
        env = dict(os.environ)
        env.update({'APPROVAL_' + name.upper() + '_PASSWORD': value for name, value in passwords.items()})
        url = 'http://127.0.0.1:' + str(args.ui_port)
        env.update(APPROVAL_DATA_FILE=str(runtime / 'requests.json'), APPROVAL_UI_ORIGIN=url,
                   SERVER_ADDRESS='127.0.0.1', SERVER_PORT=str(args.backend_port))
        print('Private runtime directory: ' + str(runtime), flush=True)
        with (runtime / 'backend.log').open('w') as backend_log, (runtime / 'ui.log').open('w') as ui_log:
            stage = 'starting the backend'
            backend = processes.start(['java', '-jar', str(BACKEND / 'target/approval-demo-0.1.0-SNAPSHOT.jar')], env=env, stdout=backend_log, stderr=subprocess.STDOUT)
            services['backend'] = backend
            ui_env = dict(os.environ, ARCFLOW_BACKEND_PORT=str(args.backend_port))
            stage = 'starting the UI'
            ui = processes.start(['npm', 'run', 'dev', '--', '--port', str(args.ui_port), '--strictPort'], UI, env=ui_env, stdout=ui_log, stderr=subprocess.STDOUT)
            services['ui'] = ui
            stage = 'waiting for readiness'
            wait_ready([backend, ui], url, passwords['alice'])
            stage = 'running the demo'
            print('\nREADY: ' + url
                  + '\nOA leave / ERP procurement: ' + url
                  + '\nCRM quote discount (separate page): ' + url + '/quote-discount.html'
                  + '\nScenario library / OA expense (separate page): ' + url + '/scenarios.html'
                  + '\nOpen the private credentials file in your editor: ' + str(credentials)
                  + '\nUse the same demo accounts on each page; sign in separately. Passwords are never printed.'
                  + '\nStart as alice; see docs/GETTING_STARTED.md for existing walkthroughs and docs/EXPENSE_SCENARIO.md for expense review.'
                  + '\nCtrl-C stops both services and deletes this run\'s credentials, logs and demo data.', flush=True)
            while True:
                if backend.poll() is not None or ui.poll() is not None:
                    raise DemoFailure('service-exit')
                time.sleep(0.5)
    except KeyboardInterrupt:
        print('\nStopping the demo and deleting its temporary files.', flush=True)
        return 130
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        if runtime:
            # Exception messages can contain filenames, environment values or
            # subprocess arguments. Only launcher-owned reasons/errno hints are safe.
            detail = FAILURE_MESSAGES[error.reason] if isinstance(error, DemoFailure) else {
                errno.ENOENT: 'Required executable or file is missing; check the local toolchain.',
                errno.EACCES: 'Permission denied; check local file and executable permissions.',
                errno.ENOSPC: 'No space left on device; free temporary and checkout disk space.',
            }.get(getattr(error, 'errno', None), 'Check the service states and hints below.')
            print('TRYOUT: Failure while ' + stage + '. ' + detail, file=sys.stderr)
            failed_states = service_states(services)
        else:
            print('TRYOUT: ' + str(error), file=sys.stderr)
        return 1
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        try:
            processes.stop()
        finally:
            try:
                if runtime and failed_states is not None:
                    report_failure(runtime, failed_states)
            finally:
                if runtime:
                    shutil.rmtree(runtime)
                    if failed_states is not None:
                        print('TRYOUT: Temporary credentials, raw logs and demo data deleted.', file=sys.stderr)


if __name__ == '__main__':
    sys.exit(main())
