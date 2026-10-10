#!/usr/bin/env python3
"""Offline integrity checks for five historical, original-PNG scenario galleries."""
from collections import Counter
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import struct
import sys
from urllib.parse import unquote, urlsplit

from verify_developer_docs import anchors, unfenced

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = 'docs/images/scenarios/provenance.json'
COUNTS = {'oa-travel': 20, 'oa-seal-use': 18, 'erp-receiving': 17,
          'erp-payment': 25, 'crm-contract': 24}
SLUGS = ['travel', 'seal-use', 'receiving', 'payment', 'contract']
PNG = b'\x89PNG\r\n\x1a\n'
CAPTURE_COMMIT = '8c26d953e53991d3e445aa69c530726f1d81daae'
CAPTURE_TREE = '45de9943bc651bef4e377d5b9c1ef38f52670619'
CAPTURE_RUN = {'id': 37918452685, 'attempt': 1, 'url': 'https://github.com/JamesCube/ArcFlow/actions/runs/37918452685', 'event': 'push', 'status': 'completed', 'conclusion': 'success'}
BASELINE_COMMIT = '199db7548f6faba5dfef105eaaf7311972adb388'
BASELINE_TREES = {'examples/approval-demo/backend/src': 'e8b1522fcb12319227aee14ce7f7f5ab1f130b05',
 'examples/approval-domain/src': '5cf2022eb74b71cda6133015bf98bbeb0a302184',
 'examples/approval-ui': '955a62f838ad3b39a6467549fda9b25ce221bfb2',
 'src': 'b1e63401f96f18819b214cbac40e89e990e9ba68'}
ARTIFACTS = {11610223049: {'name': 'receiving-browser-evidence',
               'sha256': 'b144edc9288322de75620d274d89370621ccc1862299bdcb2b892f4823990908'},
 11610673542: {'name': 'scenario-browser-evidence-oa-travel',
               'sha256': 'ac199cd8281cdf4768a8ba774119fd31a3468463286352d442d92d7960ba9512'},
 11610883325: {'name': 'conditional-routing-browser-evidence',
               'sha256': 'ef114652847a46c0d6152c967d547d7b0c20b482eedc2e24f50c7cf29e567d0c'},
 11611098043: {'name': 'payment-contract-browser-evidence',
               'sha256': '358349afcf98ef643e4f6369a317bf1f1b7f04473c8e14971a59554b2fc5b1fa'},
 11611137862: {'name': 'scenario-browser-evidence-oa-seal-use',
               'sha256': 'f55c1d8f53ab93406f41a44ba9f878f3958be5ad0b4ec2b6d10d5711c7b21071'}}
SCENARIO_ARTIFACT = {'oa-travel': 11610673542, 'oa-seal-use': 11611137862, 'erp-receiving': 11610223049, 'erp-payment': 11611098043, 'crm-contract': 11611098043}
ROUTING_ARTIFACT = 11610883325
UI_SOURCE_SHA256 = 'df3fa2908d6ba7664afad7c8cdc757831a6674a317699d4baf689aeeb09ef5b4'



def validate_image(root, image, commit, run):
    """Return all mismatches without trusting the manifest's file path."""
    errors = []
    name = image.get('file', '')
    rel = PurePosixPath(name)
    if (rel.is_absolute() or '..' in rel.parts or '\\' in name or
            not name.startswith('docs/images/scenarios/') or rel.suffix != '.png'):
        return [f'Unsafe image path: {name}']
    path = (root / name).resolve()
    if not path.is_relative_to((root / 'docs/images/scenarios').resolve()):
        return [f'Image escapes gallery: {name}']
    if not path.is_file():
        return [f'Missing image: {name}']
    raw = path.read_bytes()
    evidence = image.get('evidence', {})
    if len(raw) < 24 or raw[:8] != PNG or raw[12:16] != b'IHDR':
        return [f'Invalid PNG: {name}']
    dimensions = struct.unpack('>II', raw[16:24])
    if dimensions != (image.get('width'), image.get('height')):
        errors.append(f'PNG dimensions mismatch: {name}')
    if len(raw) != image.get('bytes'):
        errors.append(f'PNG byte count mismatch: {name}')
    digest = hashlib.sha256(raw).hexdigest()
    if digest != image.get('sha256') or digest != evidence.get('imageSHA256'):
        errors.append(f'PNG hash mismatch: {name}')
    if image.get('captureCommit') != commit or evidence.get('sourceRevision') != commit:
        errors.append(f'Capture commit mismatch: {name}')
    if image.get('suite') == 'conditional-routing' and 'scenario' not in evidence:
        route_scenario = {'payment': 'erp-payment', 'contract': 'crm-contract', 'receiving': 'erp-receiving'}.get(rel.name.split('-')[0])
        if image.get('scenario') != route_scenario:
            errors.append(f'Routing scenario mismatch: {name}')
    elif image.get('scenario') != evidence.get('scenario'):
        errors.append(f'Scenario mismatch: {name}')
    if image.get('runUrl') != run['url']:
        errors.append(f'Run URL mismatch: {name}')
    observed_run = evidence.get('githubRun', {})
    run_id = evidence.get('captureRunId', observed_run.get('id'))
    attempt = evidence.get('captureRunAttempt', observed_run.get('attempt'))
    if str(run_id) != str(run['id']) or str(attempt) != str(run['attempt']):
        errors.append(f'Capture run identity mismatch: {name}')
    if evidence.get('captureRunUrl', run['url']) != run['url']:
        errors.append(f'Sidecar run URL mismatch: {name}')
    if evidence.get('locale') not in ('en', 'zh', 'zh-CN'):
        errors.append(f'Unknown UI locale: {name}')
    expected_state = rel.stem
    if image.get('suite') == 'scenario':
        if image.get('scenario') == 'oa-travel':
            expected_state = re.sub(r'^travel-\d+-', '', expected_state)
            expected_state = re.sub(r'-(?:zh|en)-(?:desktop|390)$', '', expected_state)
        elif image.get('scenario') == 'oa-seal-use':
            expected_state = re.sub(r'^\d+-', '', expected_state)
            expected_state = re.sub(r'-(?:zh|en)-(?:desktop|390)$', '', expected_state)
        elif image.get('scenario') in ('erp-payment', 'crm-contract'):
            expected_state = expected_state.removeprefix(image['scenario'] + '-')
            expected_state = re.sub(r'-(?:zh|en)-(?:desktop|390)$', '', expected_state)
    if not evidence.get('state') or evidence.get('state') != expected_state or evidence.get('image') != rel.name:
        errors.append(f'Missing state or exact state/sidecar filename mismatch: {name}')
    if image.get('scenario') in ('erp-payment', 'crm-contract') or image.get('suite') == 'conditional-routing':
        required_source = {'sourceWorkingTree', 'trackedDiffSHA256', 'uiSourceTreeSHA256', 'backendJarSHA256'}
        if not required_source <= evidence.keys():
            errors.append(f'Missing clean source evidence: {name}')
    elif image.get('scenario') == 'erp-receiving' and 'sourceTreeClean' not in evidence:
        errors.append(f'Missing receiving clean source evidence: {name}')
    if 'sourceWorkingTree' in evidence and evidence['sourceWorkingTree'] != 'clean-commit':
        errors.append(f'Dirty source working tree: {name}')
    if 'sourceTreeClean' in evidence and evidence['sourceTreeClean'] is not True:
        errors.append(f'Dirty source tree: {name}')
    if 'trackedDiffSHA256' in evidence and evidence['trackedDiffSHA256'] != hashlib.sha256(b'').hexdigest():
        errors.append(f'Nonempty source diff: {name}')
    if 'uiSourceTreeSHA256' in evidence and evidence['uiSourceTreeSHA256'] != UI_SOURCE_SHA256:
        errors.append(f'UI source hash mismatch: {name}')
    viewport = evidence.get('viewport', {})
    if viewport not in ({'width': 1440, 'height': 1000}, {'width': 390, 'height': 844}):
        errors.append(f'Unexpected viewport: {name}')
    if type(evidence.get('fullPage')) is not bool:
        errors.append(f'Missing capture mode: {name}')
    elif evidence['fullPage']:
        if dimensions[0] != viewport.get('width') or dimensions[1] < viewport.get('height', 0):
            errors.append(f'Full-page dimensions mismatch: {name}')
    elif dimensions != (viewport.get('width'), viewport.get('height')):
        errors.append(f'Viewport capture dimensions mismatch: {name}')
    artifact = image.get('artifact', {})
    if (not artifact.get('id') or not artifact.get('name') or
            not re.fullmatch(r'[0-9a-f]{64}', artifact.get('sha256', '')) or
            PurePosixPath(artifact.get('originalPath', '')).name != rel.name):
        errors.append(f'Incomplete artifact provenance: {name}')
    expected_artifact = ROUTING_ARTIFACT if image.get('suite') == 'conditional-routing' else SCENARIO_ARTIFACT.get(image.get('scenario'))
    if (artifact.get('id') != expected_artifact or
            {k: artifact.get(k) for k in ('name', 'sha256')} != ARTIFACTS.get(expected_artifact)):
        errors.append(f'Artifact identity mismatch: {name}')
    return errors


def local_references(text):
    text = unfenced(text)
    return (re.findall(r'!?\[[^\]\n]*\]\(([^)\s]+)\)', text) +
            re.findall(r'(?:href|src)=["\']([^"\']+)["\']', text))


def validate_links(root, page):
    errors = []
    for reference in local_references(page.read_text()):
        parts = urlsplit(reference)
        if parts.scheme or parts.netloc:
            continue
        destination = (page.parent / unquote(parts.path)).resolve() if parts.path else page
        if not destination.is_relative_to(root.resolve()) or not destination.is_file():
            errors.append(f'{page.name}: missing local link {reference}')
        elif parts.fragment and destination.suffix == '.md' and unquote(parts.fragment) not in anchors(destination):
            errors.append(f'{page.name}: missing local anchor {reference}')
    return errors


def verify(root=ROOT):
    errors = []
    data = json.loads((root / MANIFEST).read_text())
    images = data['images']
    commit, run = data['captureCommit'], data['captureRun']
    if commit != CAPTURE_COMMIT or data.get('captureTree') != CAPTURE_TREE or run != CAPTURE_RUN:
        errors.append('Historical capture commit/tree/run identity mismatch')
    baseline = data.get('applicationBaseline', {})
    if baseline.get('commit') != BASELINE_COMMIT or baseline.get('trees') != BASELINE_TREES:
        errors.append('Verified application baseline identity mismatch')
    if not re.fullmatch(r'[0-9a-f]{40}', commit) or run.get('conclusion') != 'success':
        errors.append('Invalid capture identity or historical run status')
    if len(images) != data['imageCount'] or Counter(i['scenario'] for i in images) != COUNTS:
        errors.append('Five-case image inventory mismatch')
    if sum(i['bytes'] for i in images) != data['totalImageBytes']:
        errors.append('Total PNG bytes mismatch')
    paths = [i['file'] for i in images]
    if len(set(paths)) != len(paths):
        errors.append('Duplicate image path')
    hashes = {i['sha256'] for i in images}
    if len(hashes) != data['uniqueImageSHA256Count']:
        errors.append('Unique original PNG count mismatch')
    duplicates = {h: sorted(i['file'] for i in images if i['sha256'] == h) for h in hashes
                  if sum(i['sha256'] == h for i in images) > 1}
    declared = {g['sha256']: sorted(g['files']) for g in data['identicalOriginalGroups']}
    if duplicates != declared:
        errors.append('Undeclared duplicate original image')
    for group in data['identicalOriginalGroups']:
        members = [i for i in images if i['file'] in group['files']]
        if not group.get('reason') or any('catalog' not in i['evidence']['state'] for i in members) or len({i['evidence']['locale'] for i in members}) != 1:
            errors.append('Duplicate group is not the same shared catalog state')
    actual = {p.relative_to(root).as_posix() for p in (root / 'docs/images/scenarios').rglob('*.png')}
    if set(paths) != actual:
        errors.append('Unregistered or missing original PNG')
    for image in images:
        errors.extend(validate_image(root, image, commit, run))
    pages = [root / 'docs/galleries' / (name + suffix + '.md')
             for name in ['README', 'CAPTURE', *SLUGS] for suffix in ['', '.en']]
    for page in pages:
        if not page.is_file():
            errors.append(f'Missing bilingual page: {page.name}')
            continue
        errors.extend(validate_links(root, page))
        text = page.read_text()
        if '8c26d95' not in text or '37918452685' not in text:
            errors.append(f'Missing historical identity: {page.name}')
    gallery_pages = [p for p in pages if p.is_file() and p.name.split('.')[0] in SLUGS]
    documented = set()
    for page in gallery_pages:
        text = page.read_text()
        for image in images:
            ref = '../images/scenarios/' + image['file'].removeprefix('docs/images/scenarios/')
            if f'src="{ref}"' not in text:
                continue
            documented.add(image['file'])
            # Each image's own section must carry its state, hash and actual dimensions.
            section = next(s for s in text.split('\n### ') if f'src="{ref}"' in s)
            ev = image['evidence']; vp = ev['viewport']
            english = '.en.' in page.name
            language = ('Chinese' if english else '中文') if ev['locale'].startswith('zh') else 'English'
            mode = ('full-page original' if english else '全页原图') if ev['fullPage'] else ('viewport original' if english else '视口原图')
            expected = [f"`{ev['state']}`", image['sha256'], f"{vp['width']}×{vp['height']}",
                        f"{image['width']}×{image['height']}", language, mode]
            if any(token not in section for token in expected):
                errors.append(f'{page.name}: incomplete per-image caption for {image["file"]}')
    if documented != set(paths):
        errors.append('Some original images have no gallery section')
    for suffix in ['', '.en']:
        text = (root / 'docs/galleries' / f'README{suffix}.md').read_text()
        for slug in SLUGS:
            if f'({slug}{suffix}.md)' not in text:
                errors.append(f'Index lacks {slug}{suffix}')
        readme = (root / f'README{suffix}.md').read_text()
        if f'(docs/galleries/README{suffix}.md)' not in readme:
            errors.append(f'Root README{suffix} lacks gallery entry')
    return errors


def main():
    try:
        errors = verify()
    except (KeyError, TypeError, ValueError, OSError) as error:
        print(f'Invalid gallery data: {error}', file=sys.stderr)
        return 1
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print('PASS: 104 original PNGs, provenance/sidecars, 14 bilingual pages, captions and local links.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
