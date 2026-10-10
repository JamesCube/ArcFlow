#!/usr/bin/env python3
"""Standard-library launcher regressions; no builds or default-port servers.

Run from the repository root: python3 -m unittest discover -s scripts -p 'test_tryout.py' -v
"""
import contextlib
import base64
import errno
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('tryout', Path(__file__).with_name('tryout.py'))
tryout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tryout)


class PrerequisitesTests(unittest.TestCase):
    def check(self, node=(22, 22, 2), java=17, javac=17, maven=(3, 8)):
        def version(command, pattern):
            return {'javac': (javac,), 'java': (java,), 'mvn': maven, 'node': node}[command[0]]
        with mock.patch.object(tryout.shutil, 'which', return_value='/bin/tool'), \
                mock.patch.object(tryout, 'version', side_effect=version):
            tryout.prerequisites('mvn')

    def test_supported_versions(self):
        for node in [(22, 22, 2), (22, 30, 0), (24, 15, 0), (24, 20, 0), (26, 0, 0)]:
            with self.subTest(node=node):
                self.check(node=node)

    def test_unsupported_node_versions(self):
        for node in [(20, 19, 0), (22, 22, 1), (23, 0, 0), (24, 14, 9), (25, 1, 0)]:
            with self.subTest(node=node), self.assertRaisesRegex(RuntimeError, 'Node must match'):
                self.check(node=node)

    def test_old_jdk_runtime_and_maven(self):
        for kwargs, message in [({'javac': 11}, 'JDK 17'), ({'java': 11}, 'runtime 17'),
                                ({'maven': (3, 6)}, 'Maven 3.8')]:
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(RuntimeError, message):
                self.check(**kwargs)

    def test_each_missing_tool_fails_before_version_probes(self):
        for missing in ['java', 'javac', 'mvn', 'node', 'npm']:
            with self.subTest(missing=missing), \
                    mock.patch.object(tryout.shutil, 'which', side_effect=lambda name: None if name == missing else '/bin/tool'), \
                    mock.patch.object(tryout, 'version') as probe, \
                    self.assertRaisesRegex(RuntimeError, 'Missing prerequisite: ' + missing):
                tryout.prerequisites('mvn')
            probe.assert_not_called()

    def test_version_parser_and_rejected_output(self):
        good = subprocess.CompletedProcess(['node'], 0, 'v22.22.2\n')
        with mock.patch.object(tryout.subprocess, 'run', return_value=good):
            self.assertEqual(tryout.version(['node', '--version'], r'v(\d+)\.(\d+)\.(\d+)'), (22, 22, 2))
        for result in [subprocess.CompletedProcess(['node'], 1, 'v22.22.2'),
                       subprocess.CompletedProcess(['node'], 0, 'unexpected')]:
            with mock.patch.object(tryout.subprocess, 'run', return_value=result), \
                    self.assertRaisesRegex(RuntimeError, 'Cannot determine version'):
                tryout.version(['node', '--version'], r'v(\d+)')


class PortTests(unittest.TestCase):
    def test_duplicate_and_invalid_ports(self):
        for ports in [[18080, 18080], [1023, 15173], [18080, 65536]]:
            with self.subTest(ports=ports), self.assertRaises(RuntimeError):
                tryout.check_ports(ports)

    def test_conflict_leaves_existing_listener_running(self):
        with socket.socket() as existing:
            existing.bind(('127.0.0.1', 0))
            existing.listen()
            port = existing.getsockname()[1]
            with self.assertRaisesRegex(RuntimeError, 'occupied'):
                tryout.check_ports([port])
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                accepted, _ = existing.accept()
                accepted.close()

    def test_success_releases_probe_socket(self):
        with socket.socket() as reserved:
            reserved.bind(('127.0.0.1', 0))
            port = reserved.getsockname()[1]
        tryout.check_ports([port])
        with socket.socket() as reclaimed:
            reclaimed.bind(('127.0.0.1', port))


class ProcessTests(unittest.TestCase):
    def test_start_uses_an_owned_new_session(self):
        processes = tryout.Processes()
        with mock.patch.object(tryout.subprocess, 'Popen') as popen:
            child = processes.start(['example'])
        self.assertEqual(processes.children, [child])
        self.assertTrue(popen.call_args.kwargs['start_new_session'])

    def test_nonzero_build_fails(self):
        processes = tryout.Processes()
        child = mock.Mock()
        child.wait.return_value = 2
        with mock.patch.object(processes, 'start', return_value=child), \
                mock.patch.object(tryout.os, 'killpg'):
            processes.children.append(child)
            with self.assertRaisesRegex(RuntimeError, 'Build failed'):
                processes.run(['mvn'])

    @unittest.skipUnless(os.name == 'posix', 'POSIX process groups are required')
    def test_cleanup_kills_descendant_when_leader_already_exited(self):
        # The descendant ignores TERM, so cleanup must kill the whole group even
        # though its leader has exited. A random listener proves it released
        # resources without relying on init to reap an orphan's zombie status.
        with tempfile.TemporaryDirectory(prefix='arcflow-launcher-test-') as directory:
            ready = Path(directory) / 'ready.json'
            descendant = (
                "import json,signal,socket,time; from pathlib import Path; "
                "signal.signal(signal.SIGTERM,signal.SIG_IGN); s=socket.socket(); "
                "s.bind(('127.0.0.1',0)); s.listen(); "
                "Path(" + repr(str(ready)) + ").write_text(json.dumps(s.getsockname()[1])); "
                "time.sleep(60)"
            )
            leader = (
                "import subprocess,sys,time; from pathlib import Path; "
                "subprocess.Popen([sys.executable,'-c'," + repr(descendant) + "]); "
                "p=Path(" + repr(str(ready)) + "); "
                "\nwhile not p.exists(): time.sleep(.01)\n"
            )
            processes = tryout.Processes()
            try:
                child = processes.start([sys.executable, '-c', leader])
                child.wait(timeout=5)
                port = json.loads(ready.read_text())
                with socket.create_connection(('127.0.0.1', port), timeout=1):
                    pass
                processes.stop()
                # Process termination scheduling is asynchronous after killpg.
                import time
                deadline = time.monotonic() + 3
                while True:
                    with socket.socket() as probe:
                        try:
                            probe.bind(('127.0.0.1', port))
                            break
                        except OSError:
                            if time.monotonic() >= deadline:
                                raise
                            time.sleep(.02)
            finally:
                processes.stop()


class ReadinessTests(unittest.TestCase):
    def timeout(self, responses, reason):
        child = mock.Mock()
        child.poll.return_value = None
        opener = mock.Mock()
        opener.open.side_effect = responses
        with mock.patch.object(tryout.urllib.request, 'build_opener', return_value=opener), \
                mock.patch.object(tryout.time, 'monotonic', side_effect=[0, 0, 2]), \
                mock.patch.object(tryout.time, 'sleep'), \
                self.assertRaises(tryout.DemoFailure) as caught:
            tryout.wait_ready([child], 'http://127.0.0.1:12345', 'secret', timeout=1)
        self.assertEqual(caught.exception.reason, reason)

    def test_timeout_identifies_ui_never_ready(self):
        self.timeout([OSError('private URL or token')], 'timeout-ui')

    def test_timeout_identifies_api_not_ready_after_ui_response(self):
        home = mock.MagicMock()
        home.__enter__.return_value.status = 200
        self.timeout([home, OSError('private auth error')], 'timeout-api')

    def test_malformed_profile_does_not_escape_as_a_traceback(self):
        for payload in [b'[]', b'null', b'"private-data"', b'{}', b'{"id":"bob"}']:
            with self.subTest(payload=payload):
                home = mock.MagicMock()
                home.__enter__.return_value.status = 200
                profile = mock.MagicMock()
                profile.__enter__.return_value = io.BytesIO(payload)
                self.timeout([home, profile], 'timeout-api')

    def test_malformed_http_cannot_echo_response_text_in_a_traceback(self):
        for error in [tryout.http.client.BadStatusLine('private-token-response'),
                      tryout.http.client.IncompleteRead(b'private-record')]:
            with self.subTest(error=type(error).__name__):
                self.timeout([error], 'timeout-ui')

    def test_early_service_exit_fails_without_http(self):
        child = mock.Mock()
        child.poll.return_value = 1
        with mock.patch.object(tryout.urllib.request, 'build_opener') as opener, \
                self.assertRaisesRegex(RuntimeError, 'before readiness'):
            tryout.wait_ready([child], 'http://127.0.0.1:12345', 'secret')
        opener.return_value.open.assert_not_called()

    def test_probes_root_then_authenticated_proxy_without_environment_proxy(self):
        child = mock.Mock()
        child.poll.return_value = None
        home = mock.MagicMock()
        home.__enter__.return_value.status = 200
        profile = mock.MagicMock()
        profile.__enter__.return_value = io.BytesIO(b'{"id":"alice"}')
        opener = mock.Mock()
        opener.open.side_effect = [home, profile]
        with mock.patch.object(tryout.urllib.request, 'build_opener', return_value=opener) as build:
            tryout.wait_ready([child], 'http://127.0.0.1:12345', 'secret')
        self.assertEqual(build.call_args.args[0].proxies, {})
        request = opener.open.call_args_list[1].args[0]
        self.assertEqual(request.full_url, 'http://127.0.0.1:12345/api/me')
        self.assertEqual(request.get_header('Authorization'), 'Basic YWxpY2U6c2VjcmV0')


class MainHarness:
    def setUp(self):
        self.output = io.StringIO()
        self.errors = io.StringIO()
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(contextlib.redirect_stdout(self.output))
        self.stack.enter_context(contextlib.redirect_stderr(self.errors))
        self.stack.enter_context(mock.patch.object(tryout.signal, 'signal'))
        self.prerequisites = self.stack.enter_context(mock.patch.object(tryout, 'prerequisites'))
        self.ports = self.stack.enter_context(mock.patch.object(tryout, 'check_ports'))
        self.real_processes_class = tryout.Processes
        self.process_factory = self.stack.enter_context(mock.patch.object(tryout, 'Processes'))
        self.processes = self.process_factory.return_value
        self.processes.start.return_value.poll.return_value = None
        self.stack.enter_context(mock.patch.object(sys, 'argv', ['tryout.py', '--backend-port', '38080', '--ui-port', '35173']))


class MainTests(MainHarness, unittest.TestCase):
    def test_check_does_not_build_or_allocate_runtime(self):
        with mock.patch.object(sys, 'argv', ['tryout.py', '--check']), \
                mock.patch.object(tryout.tempfile, 'mkdtemp') as create:
            self.assertEqual(tryout.main(), 0)
        self.processes.run.assert_not_called()
        self.processes.start.assert_not_called()
        create.assert_not_called()
        self.processes.stop.assert_called_once()

    def test_build_failure_does_not_start_services_or_create_credentials(self):
        self.processes.run.side_effect = RuntimeError('Build failed')
        with mock.patch.object(tryout.tempfile, 'mkdtemp') as create:
            self.assertEqual(tryout.main(), 1)
        create.assert_not_called()
        self.processes.start.assert_not_called()
        self.processes.stop.assert_called_once()

    def test_private_credentials_loopback_custom_ports_and_interrupt_cleanup(self):
        captured = {}
        def ready(children, url, password):
            backend_call, ui_call = self.processes.start.call_args_list
            env = backend_call.kwargs['env']
            runtime = Path(env['APPROVAL_DATA_FILE']).parent
            credentials = runtime / 'credentials.json'
            values = json.loads(credentials.read_text())
            captured.update(runtime=runtime, passwords=values)
            self.assertEqual(stat.S_IMODE(runtime.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(credentials.stat().st_mode), 0o600)
            self.assertEqual(set(values), {'alice', 'bob', 'carol'})
            self.assertEqual(len(set(values.values())), 3)
            for name, value in values.items():
                self.assertGreaterEqual(len(value), 32)
                self.assertEqual(env['APPROVAL_' + name.upper() + '_PASSWORD'], value)
                self.assertNotIn(value, repr(backend_call.args))
                self.assertNotIn(value, repr(ui_call.args))
                self.assertNotIn(value, repr(ui_call.kwargs))
            self.assertEqual(password, values['alice'])
            self.assertEqual(env['SERVER_ADDRESS'], '127.0.0.1')
            self.assertEqual(env['SERVER_PORT'], '38080')
            self.assertEqual(env['APPROVAL_UI_ORIGIN'], 'http://127.0.0.1:35173')
            self.assertEqual(url, 'http://127.0.0.1:35173')
            self.assertEqual(ui_call.kwargs['env']['ARCFLOW_BACKEND_PORT'], '38080')
            self.assertIn('--strictPort', ui_call.args[0])
            self.assertIn('35173', ui_call.args[0])
            raise KeyboardInterrupt
        with mock.patch.object(tryout, 'wait_ready', side_effect=ready):
            self.assertEqual(tryout.main(), 130)
        self.assertFalse(captured['runtime'].exists())
        self.processes.stop.assert_called_once()
        self.assertEqual(self.ports.call_count, 2)
        self.assertEqual(self.processes.run.call_count, 5)
        for password in captured['passwords'].values():
            self.assertNotIn(password, self.output.getvalue() + self.errors.getvalue())

    def test_startup_failure_cleans_runtime(self):
        captured = {}
        def fail(*args):
            env = self.processes.start.call_args_list[0].kwargs['env']
            captured['runtime'] = Path(env['APPROVAL_DATA_FILE']).parent
            raise RuntimeError('readiness failed')
        with mock.patch.object(tryout, 'wait_ready', side_effect=fail):
            self.assertEqual(tryout.main(), 1)
        self.assertFalse(captured['runtime'].exists())
        self.processes.stop.assert_called_once()
        self.assertIn('waiting for readiness', self.errors.getvalue())
        self.assertNotIn('readiness failed', self.errors.getvalue())
        self.assertIn('No recognized cause', self.errors.getvalue())

    def test_ready_lists_both_case_pages_on_the_configured_origin_without_passwords(self):
        captured = {}
        def ready(children, url, password):
            env = self.processes.start.call_args_list[0].kwargs['env']
            captured['runtime'] = Path(env['APPROVAL_DATA_FILE']).parent
            captured['passwords'] = json.loads((captured['runtime'] / 'credentials.json').read_text())
        with mock.patch.object(tryout, 'wait_ready', side_effect=ready), \
                mock.patch.object(tryout.time, 'sleep', side_effect=KeyboardInterrupt):
            self.assertEqual(tryout.main(), 130)
        output = self.output.getvalue()
        self.assertIn('\nREADY: http://127.0.0.1:35173\n', output)
        self.assertIn('OA leave / ERP procurement: http://127.0.0.1:35173\n', output)
        self.assertIn('CRM quote discount (separate page): http://127.0.0.1:35173/quote-discount.html\n', output)
        self.assertIn('Scenario library / OA expense (separate page): http://127.0.0.1:35173/scenarios.html\n', output)
        self.assertIn('sign in separately', output)
        self.assertIn('docs/GETTING_STARTED.md', output)
        self.assertTrue((tryout.UI / 'public/quote-discount.html').is_file())
        for password in captured['passwords'].values():
            self.assertNotIn(password, output + self.errors.getvalue())
        self.assertFalse(captured['runtime'].exists())
        self.processes.stop.assert_called_once()


class DiagnosticTests(unittest.TestCase):
    def hints(self, contents):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'backend.log'
            log.write_bytes(contents)
            return '\n'.join(tryout.log_hints(log))

    def test_allowlisted_causes_have_actionable_fixed_hints(self):
        for raw, expected in [
            (b'Port 8080 was already in use', 'choose unused'),
            (b'Error: Port 5173 is already in use', 'choose unused'),
            (b'java.net.BindException: Address already in use', 'choose unused'),
            (b'EACCES: permission denied /private/file', 'permissions'),
            (b'No space left on device', 'free space'),
            (b'Error: Unable to access jarfile /private/app.jar', 'rebuild'),
            (b'Invalid or corrupt jarfile /private/app.jar', 'rebuild'),
            (b'java.lang.UnsupportedClassVersionError: private-class', 'java/javac'),
            (b'Unrecognized VM option: private-value', 'JAVA_TOOL_OPTIONS'),
            (b'Error: Cannot find module /private/file', 'npm ci'),
            (b'/bin/sh: 1: vite: not found', 'npm ci'),
            (b'Error: connect ECONNREFUSED 127.0.0.1:8080', 'backend state'),
            (b'Set APPROVAL_ALICE_PASSWORD to a unique password', 'fresh generated'),
            (b'APPLICATION FAILED TO START', 'manual startup'),
        ]:
            with self.subTest(raw=raw):
                result = self.hints(raw)
                self.assertIn(expected, result)
                self.assertNotIn('/private', result)

    def test_secrets_data_and_terminal_controls_are_never_copied(self):
        # Include unlabelled/encoded values and secrets next to a recognized cause:
        # denylist redaction would be insufficient for these arbitrary formats.
        secret = 'sentinel-secret-with-no-label'
        basic = base64.b64encode(('alice:' + secret).encode()).decode()
        raw = ('Authorization: Basic ' + basic + '\nBearer bearer-sentinel\n'
               'password=' + secret + '\n' + secret + '\n'
               '{"employee":"private-person","requests":["private-reason"]}\n'
               '\x1b]52;c;clipboard-secret\x07\x1b[2J\rEACCES ' + secret + '\n').encode()
        result = self.hints(raw)
        self.assertIn('Permission denied', result)
        for value in [secret, basic, 'bearer-sentinel', 'private-person', 'private-reason',
                      'clipboard-secret', '\x1b', '\r', '\x07']:
            self.assertNotIn(value, result)

    def test_unknown_empty_and_invalid_utf8_logs_are_withheld(self):
        for raw in [b'', b'unknown-private-token', b'\xff\xfe private-data']:
            with self.subTest(raw=raw):
                self.assertIn('No recognized cause', self.hints(raw))
                self.assertNotIn('private-', self.hints(raw))

    def test_missing_or_unreadable_log_is_safe(self):
        with mock.patch.object(Path, 'open', side_effect=PermissionError('private-path-token')):
            result = tryout.log_hints(Path('ignored'))
        self.assertEqual(result, ['Log unavailable; check the service state and local toolchain.'])

    def test_large_logs_read_only_bounded_tail_and_bound_hint_count(self):
        log = io.BytesIO(b'Unable to access jarfile\n' + b'x' * (tryout.DIAGNOSTIC_BYTES * 2) + b'\nEACCES')
        wrapper = mock.MagicMock()
        wrapper.__enter__.return_value = log
        with mock.patch.object(Path, 'open', return_value=wrapper), \
                mock.patch.object(log, 'read', wraps=log.read) as read:
            hints = tryout.log_hints(Path('ignored'))
        read.assert_called_once_with(tryout.DIAGNOSTIC_BYTES)
        self.assertEqual(len(hints), 1)
        self.assertIn('Permission denied', hints[0])
        self.assertNotIn('JAR', str(hints))
        all_causes = b'EADDRINUSE EACCES ENOSPC ZipException UnsupportedClassVersionError ERR_MODULE_NOT_FOUND ECONNREFUSED APPLICATION FAILED TO START'
        self.assertEqual(len(self.hints(all_causes).splitlines()), 6)


class FailureLifecycleTests(MainHarness, unittest.TestCase):
    def test_early_exit_reports_service_exit_code_then_deletes_everything(self):
        captured = {}
        backend, ui = mock.Mock(), mock.Mock()
        backend.poll.return_value = 17
        ui.poll.return_value = None
        def start(command, *args, **kwargs):
            child = backend if command[0] == 'java' else ui
            if command[0] == 'java':
                runtime = Path(kwargs['env']['APPROVAL_DATA_FILE']).parent
                values = json.loads((runtime / 'credentials.json').read_text())
                captured.update(runtime=runtime, secrets=list(values.values()))
                (runtime / 'requests.json').write_text('{"private-record":"private-value"}')
                kwargs['stdout'].write('Error: Unable to access jarfile ' + values['alice'] + '\n')
                kwargs['stdout'].flush()
            return child
        self.processes.start.side_effect = start
        def stop():
            self.assertTrue(captured['runtime'].exists())
            self.assertNotIn('Safe diagnostic summary', self.errors.getvalue())
        self.processes.stop.side_effect = stop
        self.assertEqual(tryout.main(), 1)
        errors = self.errors.getvalue()
        self.assertIn('before readiness', errors)
        self.assertIn('backend: exited with code 17', errors)
        self.assertIn('ui: still running at failure', errors)
        self.assertIn('rebuild', errors)
        self.assertIn('demo data deleted', errors)
        self.assertFalse(captured['runtime'].exists())
        for secret in captured['secrets'] + ['private-record', 'private-value']:
            self.assertNotIn(secret, self.output.getvalue() + errors)

    @unittest.skipUnless(os.name == 'posix', 'POSIX process groups are required')
    def test_real_children_crash_diagnostics_and_sibling_cleanup(self):
        processes = self.real_processes_class()
        self.addCleanup(processes.stop)
        self.process_factory.return_value = processes
        start = processes.start
        captured = {}
        def substitute(command, cwd=tryout.ROOT, **kwargs):
            if command[0] == 'java':
                captured['runtime'] = Path(kwargs['env']['APPROVAL_DATA_FILE']).parent
                captured['secret'] = kwargs['env']['APPROVAL_ALICE_PASSWORD']
                script = "import os,sys; print('EADDRINUSE ' + os.environ['APPROVAL_ALICE_PASSWORD'], flush=True); sys.exit(17)"
            else:
                script = 'import time; time.sleep(60)'
            child = start([sys.executable, '-c', script], cwd, **kwargs)
            if command[0] == 'java':
                child.wait(timeout=5)
            return child
        with mock.patch.object(processes, 'run'), mock.patch.object(processes, 'start', side_effect=substitute):
            self.assertEqual(tryout.main(), 1)
        self.assertIn('backend: exited with code 17', self.errors.getvalue())
        self.assertIn('Port conflict: choose unused', self.errors.getvalue())
        self.assertNotIn(captured['secret'], self.output.getvalue() + self.errors.getvalue())
        self.assertFalse(captured['runtime'].exists())
        self.assertTrue(all(child.poll() is not None for child in processes.children))

    def test_ui_spawn_failure_with_sensitive_exception_is_withheld_and_cleaned(self):
        captured = {}
        def start(command, *args, **kwargs):
            if command[0] == 'java':
                captured['runtime'] = Path(kwargs['env']['APPROVAL_DATA_FILE']).parent
                child = mock.Mock()
                child.poll.return_value = None
                return child
            raise PermissionError(errno.EACCES, 'private exception token', '/private/token/path')
        self.processes.start.side_effect = start
        self.assertEqual(tryout.main(), 1)
        errors = self.errors.getvalue()
        self.assertIn('starting the UI', errors)
        self.assertIn('Permission denied', errors)
        self.assertIn('ui: not started', errors)
        self.assertNotIn('private exception token', errors)
        self.assertNotIn('/private/token/path', errors)
        self.assertFalse(captured['runtime'].exists())

    def test_readiness_timeouts_and_post_ready_exit_get_diagnostics_and_cleanup(self):
        for reason in ['timeout-ui', 'timeout-api', 'service-exit']:
            with self.subTest(reason=reason):
                captured = {}
                self.output.seek(0); self.output.truncate()
                self.errors.seek(0); self.errors.truncate()
                self.processes.start.reset_mock()
                child = self.processes.start.return_value
                child.poll.return_value = 0 if reason == 'service-exit' else None
                def ready(*args):
                    env = self.processes.start.call_args_list[0].kwargs['env']
                    captured['runtime'] = Path(env['APPROVAL_DATA_FILE']).parent
                    if reason != 'service-exit':
                        raise tryout.DemoFailure(reason)
                with mock.patch.object(tryout, 'wait_ready', side_effect=ready):
                    self.assertEqual(tryout.main(), 1)
                errors = self.errors.getvalue()
                self.assertIn(tryout.FAILURE_MESSAGES[reason], errors)
                self.assertIn('Safe diagnostic summary', errors)
                self.assertFalse(captured['runtime'].exists())
                self.assertEqual('\nREADY:' in self.output.getvalue(), reason == 'service-exit')

    def test_diagnostic_or_stop_error_cannot_skip_runtime_cleanup(self):
        for broken in ['report', 'stop']:
            with self.subTest(broken=broken):
                captured = {}
                self.processes.start.reset_mock()
                self.processes.stop.side_effect = RuntimeError('stop failed') if broken == 'stop' else None
                def fail(*args):
                    env = self.processes.start.call_args_list[0].kwargs['env']
                    captured['runtime'] = Path(env['APPROVAL_DATA_FILE']).parent
                    raise tryout.DemoFailure('early-exit')
                with mock.patch.object(tryout, 'wait_ready', side_effect=fail), \
                        mock.patch.object(tryout, 'report_failure', side_effect=RuntimeError('report failed') if broken == 'report' else None), \
                        self.assertRaises(RuntimeError):
                    tryout.main()
                self.assertFalse(captured['runtime'].exists())

    def test_success_and_user_interrupt_never_emit_diagnostics(self):
        with mock.patch.object(tryout, 'wait_ready'), \
                mock.patch.object(tryout.time, 'sleep', side_effect=KeyboardInterrupt), \
                mock.patch.object(tryout, 'report_failure') as report:
            self.assertEqual(tryout.main(), 130)
        self.assertIn('\nREADY:', self.output.getvalue())
        report.assert_not_called()


if __name__ == '__main__':
    unittest.main()
