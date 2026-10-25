"""Capture real native graph DOM and immutable response evidence; CI artifacts only."""
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.parse import urlsplit
from playwright.sync_api import expect


def capture(page, directory, state, actor, definition, instance=None):
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=Path(__file__).resolve().parents[3], text=True).strip()
    assert len(source) == 40 and actor['id'].isdigit()
    assert definition['id'] == 'travel-graph' and definition['schemaVersion'] == 6
    root = page.get_by_test_id('native-travel-graph')
    view = root.get_by_test_id('graph-workspace')
    for locale in ('zh', 'en'):
        root.locator('select').first.select_option(locale)
        for width, height in ((1440, 1080), (390, 844)):
            page.set_viewport_size({'width': width, 'height': height})
            assert page.viewport_size == {'width': width, 'height': height}
            assert urlsplit(page.url).path == '/arcflow/graph'
            expect(root).to_have_attribute('data-actor-id', actor['id'])
            expect(root.get_by_test_id('native-current-actor')).to_be_visible()
            expect(root.get_by_test_id('native-current-actor')).to_contain_text(actor['displayName'])
            expect(root.get_by_test_id('native-current-actor')).to_contain_text('ID ' + actor['id'])
            expect(view).to_have_attribute('lang', 'zh-CN' if locale == 'zh' else 'en')
            expect(view).to_have_attribute('data-scenario', 'travel')
            expect(view).to_have_attribute('data-definition-id', 'travel-graph')
            expect(view).to_have_attribute('data-definition-schema', '6')
            expect(view).to_have_attribute('data-definition-version', str(definition['version']))
            expect(view.locator('.gf-alert')).to_have_count(0)
            expect(page.locator('input[type="password"]')).to_have_count(0)
            expect(page.get_by_test_id('graph-scenario')).to_have_count(0)
            tasks, joins, events = [], [], []
            if instance is None:
                expect(view.get_by_test_id('graph-process-name')).to_have_value(definition['name'])
                expect(view.get_by_test_id('graph-process-name')).to_be_enabled()
                expect(view.get_by_test_id('graph-publish')).to_be_enabled()
                expect(view.get_by_test_id('graph-canvas')).to_be_visible()
            else:
                runtime = view.get_by_test_id('graph-runtime')
                expect(runtime).to_have_attribute('data-request-id', instance['id'])
                expect(runtime).to_have_attribute('data-request-status', instance['status'])
                expect(runtime).to_have_attribute('data-command-revision', str(instance['commandRevision']))
                expect(runtime).to_have_attribute('data-definition-version', str(instance['definition']['version']))
                expect(runtime).to_contain_text(instance['business']['businessId'])
                expect(runtime.get_by_role('heading', name=instance['business']['title'], exact=True)).to_be_visible()
                expect(runtime.get_by_test_id('graph-active-count')).to_have_text(str(sum(t['status'] == 'ACTIVE' for t in instance['tasks'])))
                expect(runtime.locator('.gf-task')).to_have_count(len(instance['tasks']))
                activity = runtime.locator('.gf-activity')
                if activity.get_attribute('open') is None:
                    activity.locator('summary').click()
                expect(activity.locator('li')).to_have_count(len(instance['events']))
                events = activity.locator('li > strong').all_text_contents()
                assert events == [f"#{event['sequence']} {event['type']}" for event in instance['events']]
                expect(runtime.locator('.gf-route-status')).to_have_count(len(instance['routes']))
                for task in instance['tasks']:
                    element = runtime.get_by_test_id('graph-task-' + task['nodeId'])
                    expect(element).to_have_attribute('data-task-id', task['id'])
                    expect(element).to_have_attribute('data-task-status', task['status'])
                    expect(element).to_have_attribute('data-vote-count', str(len(task['votes'])))
                    tasks.append({'id': element.get_attribute('data-task-id'), 'nodeId': task['nodeId'],
                                  'status': element.get_attribute('data-task-status'),
                                  'voteCount': int(element.get_attribute('data-vote-count'))})
                for fork in instance['forks']:
                    element = runtime.get_by_test_id('graph-join-' + fork['joinId'])
                    expect(element).to_have_attribute('data-fork-id', fork['id'])
                    expect(element).to_have_attribute('data-fork-fired', str(fork['fired']).lower())
                    arrived = json.loads(element.get_attribute('data-arrived-branch-ids'))
                    expected = json.loads(element.get_attribute('data-expected-branch-ids'))
                    assert arrived == fork['arrivedBranchIds'] and expected == fork['expectedBranchIds']
                    joins.append({'id': fork['id'], 'fired': element.get_attribute('data-fork-fired') == 'true',
                                  'arrivedBranchIds': arrived, 'expectedBranchIds': expected})
            name = f'native-travel-{state}-{locale}-{width}'
            png = directory / (name + '.png')
            # These are original Chromium pixels. Never synthesize or redraw evidence.
            page.screenshot(path=str(png), full_page=True, animations='disabled')
            receipt = {'format': 1, 'sourceCommit': source, 'host': 'native-ruoyi',
                       'scenario': 'travel', 'state': state, 'locale': locale,
                       'viewport': dict(page.viewport_size), 'route': urlsplit(page.url).path,
                       'actor': {'id': actor['id'], 'displayName': actor['displayName']},
                       'definition': definition, 'instance': instance,
                       'dom': {'actorId': root.get_attribute('data-actor-id'), 'actorLabel': root.get_by_test_id('native-current-actor').inner_text(), 'scenario': view.get_attribute('data-scenario'),
                               'definitionId': view.get_attribute('data-definition-id'),
                               'schema': int(view.get_attribute('data-definition-schema')),
                               'version': int(view.get_attribute('data-definition-version')),
                               'tasks': tasks, 'joins': joins, 'events': events},
                       'image': {'file': png.name, 'sha256': hashlib.sha256(png.read_bytes()).hexdigest(),
                                 'bytes': png.stat().st_size},
                       'provenance': 'real-native-login-real-http-original-chromium-no-response-mocks'}
            (directory / (name + '.json')).write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
    page.set_viewport_size({'width': 1440, 'height': 1080})
    root.locator('select').first.select_option('zh')
