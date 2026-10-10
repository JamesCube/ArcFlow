#!/usr/bin/env python3
"""Offline, byte-locked verification of the cb3f1077 conditional-routing gallery.

The SHA256 below pins the independently retained source evidence manifest, not
an editable checksum list generated from this checkout. Rehashing a changed PNG,
sidecar, receipt, runtime report, or provenance inventory cannot bless it. This
verifies historical evidence integrity and documentation coverage; the separate
Node verifier checks complete PNG encoding and the business journey contract.
"""
from collections import Counter
from html.parser import HTMLParser
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import struct
import sys
from urllib.parse import unquote, urlsplit

from verify_developer_docs import anchors, unfenced

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = 'docs/images/conditional-routing/cb3f1077'
PAGES = 'docs/galleries/conditional-routing'
MANIFEST = f'{DIRECTORY}/provenance.json'
SOURCE_MANIFEST = f'{DIRECTORY}/source-evidence-manifest.json'
SOURCE_MANIFEST_SHA256 = '048de0db53f39b9cb8d3f68c5cffa998550c2d0e28afaefa0642e8f0347d0c7b'
CAPTURE = {
    'commit': 'cb3f1077fc725e0031620b1210a819917d8684a4',
    'tree': '9572d7e400261f7e49760b77edf7c1b86b7d955f',
    'runId': '38016643460', 'runAttempt': 1,
    'runUrl': 'https://github.com/JamesCube/ArcFlow/actions/runs/38016643460',
    'artifactId': 11655974545,
    'archiveSHA256': 'c733d1de07bedf1488252cff418264a748cb0e6053a75d09a799e655dece52c0',
}
BASELINE_COMMIT = '10e092fae22720b8c125d1a28a75f6fc559cfce8'
# Canonical JSON SHA256 of the independently audited public source comparison.
SOURCE_COMPARISON_SHA256 = 'c354e77b4c80976823e3e99466af37674facc919c8ff559ca3f0be95bfa07275'
UI_SHA256 = '238a4e4c2696b782a1cdbeb5046d1b08c509e51bad7d3951cf53a55f85267921'
BACKEND_SHA256 = '746006781e407bef377f8125d36e29a5995d486347bb57bb32c929572b1cc89c'
SCENARIOS = {'payment': 'erp-payment', 'receiving': 'erp-receiving', 'contract': 'crm-contract'}
STATES = {
    'payment': {'payment-conditions', 'payment-low-frozen', 'payment-high-entered',
                'payment-high-partial', 'payment-high-final-review',
                'payment-high-complete', 'payment-low-complete'},
    'receiving': {'receiving-conditions', 'receiving-clean-frozen',
                  'receiving-exception-entered', 'receiving-exception-partial',
                  'receiving-procurement-review', 'receiving-exception-approved',
                  'receiving-exception-rejected', 'receiving-clean-approved'},
    'contract': {'contract-conditions', 'contract-nonstandard-entered',
                 'contract-nonstandard-partial', 'contract-nonstandard-approved',
                 'contract-standard-approved'},
}
VARIANTS = {(locale, viewport) for locale in ('zh', 'en') for viewport in ('desktop', '390px')}
PNG = b'\x89PNG\r\n\x1a\n'
NAME = re.compile(r'((payment|receiving|contract)-[a-z-]+)-(zh|en)-(desktop|390px)\.(png|json)')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def equal(left, right):
    """JSON equality without treating true as 1 or false as 0."""
    return json.dumps(left, sort_keys=True) == json.dumps(right, sort_keys=True)


def strict_json(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError(f'{path.name}: duplicate JSON key {key}')
            result[key] = value
        return result
    def constant(value):
        raise ValueError(f'{path.name}: invalid JSON number {value}')
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=pairs, parse_constant=constant)


def safe_file(root, name, prefix=DIRECTORY):
    """Only canonical, regular, non-symlink files within the allowed directory."""
    if not isinstance(name, str):
        raise ValueError('Unsafe path: expected a string')
    rel = PurePosixPath(name)
    if (not name or rel.is_absolute() or '..' in rel.parts or '\\' in name or
            '\x00' in name or rel.as_posix() != name or
            not name.startswith(prefix + '/')):
        raise ValueError(f'Unsafe path: {name}')
    path = root / name
    if not path.resolve().is_relative_to((root / prefix).resolve()):
        raise ValueError(f'Path escapes gallery: {name}')
    if any(part.is_symlink() for part in [path, *path.parents] if part != root.parent):
        raise ValueError(f'Symlink evidence path: {name}')
    if not path.is_file():
        raise ValueError(f'Missing original file: {name}')
    return path


def expected_inventory(source):
    """Derive destinations from the locked original paths, never the new index."""
    groups = {}
    for original in source['files']:
        path = PurePosixPath(original)
        match = NAME.fullmatch(path.name)
        if match:
            _, scenario, locale, _, _ = match.groups()
            identity = (scenario, locale)
            if path.parent in groups and groups[path.parent] != identity:
                raise ValueError(f'Mixed original capture folder: {path.parent}')
            groups[path.parent] = identity
    expected = {}
    for original, sha256 in source['files'].items():
        path = PurePosixPath(original)
        match = NAME.fullmatch(path.name)
        if original == 'approval-demo/backend/target/routing-runtime.json':
            destination, kind = 'runtime/routing-runtime.json', 'runtime'
        elif match:
            _, scenario, locale, _, extension = match.groups()
            destination = f'{scenario}/{locale}/{path.name}'
            kind = 'image' if extension == 'png' else 'sidecar'
        elif path.name == 'routing-receipt.json' and path.parent in groups:
            scenario, locale = groups[path.parent]
            destination, kind = f'{scenario}/{locale}/{path.name}', 'receipt'
        else:
            raise ValueError(f'Unknown historical original path: {original}')
        name = f'{DIRECTORY}/{destination}'
        if name in expected:
            raise ValueError(f'Duplicate original destination: {name}')
        expected[name] = {'originalPath': original, 'sha256': sha256, 'kind': kind}
    return expected


class HtmlReferences(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.references = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if value and key in ('href', 'src', 'poster'):
                self.references.append(value)
            elif value and key == 'srcset':
                self.references.extend(item.strip().split()[0] for item in value.split(',') if item.strip())


def references(text):
    text = re.sub(r'<!--.*?-->', '', unfenced(text), flags=re.S)
    text = re.sub(r'`+[^`\n]*`+', '', text)
    html = HtmlReferences()
    html.feed(text)
    # Count reference definitions only when actually used by a rendered link.
    # HTMLParser handles whitespace, unquoted attributes and upper-case tags.
    inline = re.findall(r'!?\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["\'][^\n]*?["\'])?\s*\)', text)
    definition_pattern = r'^\s*\[([^\]\n]+)\]:\s*(<[^>]+>|\S+)[^\n]*$'
    normalize = lambda label: ' '.join(label.lower().split())
    definitions = {normalize(label): target for label, target in re.findall(definition_pattern, text, flags=re.M)}
    usage = re.sub(definition_pattern, '', text, flags=re.M)
    labels = [normalize(label or title) for title, label in re.findall(r'!?\[([^\]\n]+)\]\[([^\]\n]*)\]', usage)]
    labels += [normalize(label) for label in re.findall(r'!?\[([^\]\n]+)\](?![\[(])', usage)]
    resolved = [definitions[label] for label in labels if label in definitions]
    return html.references + [item.strip('<>') for item in inline + resolved]


def page_references(root, page):
    errors, destinations = [], set()
    for reference in references(page.read_text(encoding='utf-8')):
        try:
            uri = urlsplit(reference)
            if uri.scheme or uri.netloc:
                if uri.scheme not in ('https', 'http', 'mailto') or not uri.scheme:
                    errors.append(f'{page.name}: unsafe external link {reference}')
                continue
            decoded = unquote(uri.path)
            if '\\' in decoded or '\x00' in decoded or decoded.startswith('/'):
                errors.append(f'{page.name}: unsafe local link {reference}')
                continue
            target = (page.parent / decoded).resolve() if decoded else page.resolve()
            if not target.is_relative_to(root.resolve()) or not target.is_file():
                errors.append(f'{page.name}: missing or unsafe local link {reference}')
                continue
            destinations.add(target.relative_to(root.resolve()).as_posix())
            if uri.fragment and target.suffix == '.md' and unquote(uri.fragment) not in anchors(target):
                errors.append(f'{page.name}: missing local anchor {reference}')
        except (ValueError, OSError) as error:
            errors.append(f'{page.name}: invalid local link {reference}: {error}')
    return errors, destinations


def provenance_errors(metadata, name):
    expected = {
        'sourceRevision': CAPTURE['commit'], 'sourceWorkingTree': 'clean-commit',
        'trackedDiffSHA256': digest(b''), 'uiSourceTreeSHA256': UI_SHA256,
        'backendRuntime': 'declared-Boot-4.1.1', 'backendJarSHA256': BACKEND_SHA256,
        'captureRunId': CAPTURE['runId'], 'captureRunAttempt': str(CAPTURE['runAttempt']),
        'captureRepository': 'JamesCube/ArcFlow', 'captureRunUrl': CAPTURE['runUrl'],
    }
    return [f'Original provenance mismatch ({key}): {name}' for key, value in expected.items()
            if not equal(metadata.get(key), value)]


def verify(root=ROOT):
    root = Path(root).resolve()
    try:
        return verify_data(root)
    except (KeyError, TypeError, ValueError, OSError, AttributeError) as error:
        return [f'Invalid conditional gallery data: {error}']


def verify_data(root):
    errors = []
    source_path = safe_file(root, SOURCE_MANIFEST)
    if digest(source_path.read_bytes()) != SOURCE_MANIFEST_SHA256:
        return ['Historical source manifest hash mismatch; editable rehashing is not authorization to replace originals']
    source = strict_json(source_path)
    if source['artifactId'] != CAPTURE['artifactId'] or source['sourceCommit'] != CAPTURE['commit']:
        errors.append('Historical source manifest identity mismatch')
    expected = expected_inventory(source)
    if len(expected) != 167 or Counter(row['kind'] for row in expected.values()) != {
            'image': 80, 'sidecar': 80, 'receipt': 6, 'runtime': 1}:
        errors.append('Historical source inventory must contain 80 PNGs, 80 sidecars, 6 receipts and 1 runtime report')
    data = strict_json(safe_file(root, MANIFEST))
    if not equal(data.get('schemaVersion'), 1) or not equal(data.get('capture'), CAPTURE):
        errors.append('Historical capture identity mismatch')
    baseline = data.get('baseline', {})
    comparison_hash = digest(json.dumps(baseline.get('sourceComparison'), sort_keys=True, separators=(',', ':')).encode())
    if baseline.get('commit') != BASELINE_COMMIT or comparison_hash != SOURCE_COMPARISON_SHA256:
        errors.append('Verified public baseline/source comparison mismatch')
    files, images = data['files'], data['images']
    names = [entry['file'] for entry in files]
    if len(names) != len(set(names)):
        errors.append('Duplicate original file inventory entry')
    if len({entry['originalPath'] for entry in files}) != len(files):
        errors.append('Duplicate original archive path')
    if set(names) != set(expected):
        errors.append('Missing or extra original inventory paths')
    actual = set()
    for path in (root / DIRECTORY).rglob('*'):
        if path.is_symlink():
            errors.append(f'Symlink in original inventory: {path.relative_to(root)}')
        if path.is_file() or path.is_symlink():
            actual.add(path.relative_to(root).as_posix())
    if actual != set(expected) | {MANIFEST, SOURCE_MANIFEST}:
        errors.append('Missing or extra on-disk original paths')
    raw_files, json_files = {}, {}
    for entry in files:
        name = entry['file']
        try:
            path = safe_file(root, name)
            raw = path.read_bytes()
            raw_files[name] = raw
            original = expected.get(name)
            if original is None or any(not equal(entry.get(key), value) for key, value in original.items()):
                errors.append(f'Locked original inventory mismatch: {name}')
            if not equal(entry.get('bytes'), len(raw)):
                errors.append(f'Original byte count mismatch: {name}')
            if original is not None and digest(raw) != original['sha256']:
                errors.append(f'Historical original hash mismatch: {name}')
            if path.suffix == '.json':
                json_files[name] = strict_json(path)
        except (ValueError, OSError) as error:
            errors.append(str(error))
    image_paths = [entry['file'] for entry in images]
    wanted_images = {name for name, entry in expected.items() if entry['kind'] == 'image'}
    if len(images) != 80 or len(image_paths) != len(set(image_paths)) or set(image_paths) != wanted_images:
        errors.append('Missing, extra or duplicate image inventory; exactly 80 originals are required')
    variants = Counter((entry['state'], entry['locale'], entry['viewport']) for entry in images)
    wanted_variants = {(state, locale, viewport) for states in STATES.values() for state in states for locale, viewport in VARIANTS}
    if set(variants) != wanted_variants or any(count != 1 for count in variants.values()):
        errors.append('Business-state variants mismatch: 20 exact states each need zh/en × desktop/390px')
    source_images = {entry['path']: entry for entry in source['images']}
    for image in images:
        name = image['file']
        if name not in wanted_images or name not in raw_files:
            continue
        original = source_images[expected[name]['originalPath']]
        match = NAME.fullmatch(PurePosixPath(name).name)
        state, scenario, locale, viewport, _ = match.groups()
        sidecar_name = str(PurePosixPath(name).with_suffix('.json'))
        required = {
            'file': name, 'sidecar': sidecar_name, 'scenario': scenario, 'state': state,
            'locale': locale, 'viewport': viewport, 'width': original['width'], 'height': original['height'],
            'requestId': original['requestId'], 'status': original['requestStatus'],
            'currentStepId': original['currentStepId'], 'decisionCount': original['decisionCount'],
        }
        for key, value in required.items():
            if key not in image or not equal(image[key], value):
                errors.append(f'Image metadata mismatch ({key}): {name}')
        raw = raw_files[name]
        if len(raw) < 24 or raw[:8] != PNG or raw[12:16] != b'IHDR':
            errors.append(f'Invalid original PNG header: {name}')
        elif struct.unpack('>II', raw[16:24]) != (original['width'], original['height']):
            errors.append(f'PNG dimensions mismatch: {name}')
        sidecar = json_files.get(sidecar_name)
        if not isinstance(sidecar, dict):
            errors.append(f'Missing original sidecar: {name}')
            continue
        errors.extend(provenance_errors(sidecar, sidecar_name))
        sidecar_values = {key: original[key] for key in ('state', 'locale', 'viewport', 'capturedAt',
                          'requestId', 'requestStatus', 'currentStepId', 'decisionCount', 'scrollOrigin')}
        sidecar_values.update(image=PurePosixPath(name).name, imageSHA256=expected[name]['sha256'], fullPage=True)
        for key, value in sidecar_values.items():
            if key not in sidecar or not equal(sidecar[key], value):
                errors.append(f'Original sidecar metadata mismatch ({key}): {name}')
        receipt_name = f'{DIRECTORY}/{scenario}/{locale}/routing-receipt.json'
        receipt = json_files.get(receipt_name, {})
        checkpoints = {checkpoint['state']: checkpoint for checkpoint in receipt.get('checkpoints', [])}
        checkpoint = checkpoints.get(state)
        if state.endswith('-conditions'):
            if checkpoint is not None or any(image[key] is not None for key in ('requestId', 'status', 'currentStepId', 'decisionCount')):
                errors.append(f'Conditions capture must not invent a request: {name}')
        elif checkpoint is None:
            errors.append(f'Missing receipt checkpoint: {name}')
        else:
            checkpoint_values = {key: checkpoint[key] for key in ('requestId', 'currentStepId')}
            checkpoint_values.update(status=checkpoint['status'], decisionCount=sum(event['action'] != 'SUBMIT' for event in checkpoint['history']))
            if any(not equal(image[key], value) for key, value in checkpoint_values.items()):
                errors.append(f'Receipt checkpoint mismatch: {name}')
    for scenario, process in SCENARIOS.items():
        for locale in ('zh', 'en'):
            name = f'{DIRECTORY}/{scenario}/{locale}/routing-receipt.json'
            receipt = json_files.get(name, {})
            errors.extend(provenance_errors(receipt, name))
            if (receipt.get('result') != 'passed' or receipt.get('realBackend') is not True or
                    receipt.get('locale') != locale or receipt.get('backendSha256') != BACKEND_SHA256 or
                    {request['processId'] for request in receipt.get('requests', [])} != {process}):
                errors.append(f'Original receipt identity/result mismatch: {name}')
            checkpoint_states = [item['state'] for item in receipt.get('checkpoints', [])]
            if (len(checkpoint_states) != len(set(checkpoint_states)) or
                    set(checkpoint_states) != STATES[scenario] - {f'{scenario}-conditions'}):
                errors.append(f'Original receipt state inventory mismatch: {name}')
    runtime = json_files.get(f'{DIRECTORY}/runtime/routing-runtime.json', {})
    runtime_expected = {'schemaVersion': 1, 'sourceRevision': CAPTURE['commit'],
                        'backendJarSHA256': BACKEND_SHA256, 'springBootVersion': '4.1.1',
                        'springFrameworkVersion': '7.0.9', 'springSecurityVersion': '7.1.1'}
    if any(not equal(runtime.get(key), value) for key, value in runtime_expected.items()):
        errors.append('Original runtime report metadata mismatch')
    for suffix in ('', '.en'):
        for slug in ('README', 'CAPTURE', *SCENARIOS):
            name = f'{PAGES}/{slug}{suffix}.md'
            page = root / name
            if not page.is_file():
                errors.append(f'Missing bilingual gallery page: {name}')
                continue
            link_errors, destinations = page_references(root, page)
            errors.extend(link_errors)
            if 'cb3f1077' not in page.read_text(encoding='utf-8') or CAPTURE['runId'] not in page.read_text(encoding='utf-8'):
                errors.append(f'Missing historical capture identity: {name}')
            if slug in SCENARIOS:
                wanted = {path for path in wanted_images if path.startswith(f'{DIRECTORY}/{slug}/')}
                shown = {path for path in destinations if path.endswith('.png')}
                if shown != wanted:
                    errors.append(f'{name}: original PNG coverage mismatch; all four variants of every story state are required')
            if slug == 'README':
                for target in ('CAPTURE', *SCENARIOS):
                    if f'{PAGES}/{target}{suffix}.md' not in destinations:
                        errors.append(f'{name}: missing bilingual index entry for {target}')
        root_page = root / f'README{suffix}.md'
        if not root_page.is_file() or f'{PAGES}/README{suffix}.md' not in page_references(root, root_page)[1]:
            errors.append(f'Root README{suffix} lacks conditional gallery entry')
    return errors


def main():
    errors = verify()
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print('PASS: 80 byte-locked original PNGs, 20 × 4 variants, 80 original sidecars, 6 receipts, runtime, provenance and 10 bilingual pages.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
