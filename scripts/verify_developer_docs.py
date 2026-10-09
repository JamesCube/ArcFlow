#!/usr/bin/env python3
"""Check developer docs, local links, JSON examples, and the actual controller inventory.

Uses only Python's standard library. --write-inventory is an explicit maintainer
operation after reviewing a deliberate controller change; CI never uses it.
"""
import argparse
import json
from pathlib import Path
import re
import sys
import unicodedata
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
CONTROLLERS = [
    ('standalone', 'examples/approval-demo/backend/src/main/java/com/arcflow/demo/ApprovalController.java'),
    ('standalone', 'examples/approval-demo/backend/src/main/java/com/arcflow/demo/ScenarioController.java'),
    ('standalone', 'examples/approval-demo/backend/src/main/java/com/arcflow/demo/QuoteDiscountController.java'),
    ('ruoyi', 'examples/ruoyi-vue3/backend/src/main/java/com/ruoyi/arcflow/ArcFlowController.java'),
]
INVENTORY = ROOT / 'docs/api/endpoint-inventory.json'


def inventory():
    routes = []
    for host, source in CONTROLLERS:
        text = (ROOT / source).read_text()
        base = re.search(r'@RequestMapping\("([^"]+)"\)', text).group(1)
        for match in re.finditer(r'@(Get|Post|Put|Delete|Patch)Mapping\b(?:\(([^\n]*?)\))?', text):
            arguments = match.group(2) or ''
            path = re.search(r'(?:(?:value|path)\s*=\s*)?"([^"]*)"', arguments)
            route = {'host': host, 'method': match.group(1).upper(), 'path': base + (path.group(1) if path else ''), 'source': source}
            if 'consumes=MediaType.APPLICATION_JSON_VALUE' in arguments:
                route['consumes'] = 'application/json'
                route['note'] = 'Bounded raw UTF-8 seal-use submission handler takes precedence over the scenario template.'
            routes.append(route)
    return sorted(routes, key=lambda r: (r['host'], r['path'], r['method']))


def unique_json(p):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise ValueError(f'{p}: duplicate JSON key {key}')
            result[key] = value
        return result
    return json.loads(p.read_text(), object_pairs_hook=pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f'Invalid JSON number: {value}')))


def unfenced(text):
    return re.sub(r'^```[^\n]*\n.*?^```[^\n]*$', '', text, flags=re.M | re.S)


def anchors(path):
    text = unfenced(path.read_text())
    result = set(re.findall(r'<a\s+id=["\']([^"\']+)', text))
    seen = {}
    for heading in re.findall(r'^#{1,6}\s+(.+?)\s*#*$', text, re.M):
        heading = re.sub(r'\[([^]]+)\]\([^)]*\)', r'\1', heading)
        heading = re.sub(r'<[^>]*>', '', heading).replace('`', '').strip().lower()
        # GitHub heading anchors retain Unicode letters and numbers, spaces, _ and -.
        slug = ''.join(c for c in heading if c in ' _-' or unicodedata.category(c)[0] in 'LN').replace(' ', '-')
        number = seen.get(slug, 0)
        seen[slug] = number + 1
        result.add(slug + (f'-{number}' if number else ''))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-inventory', action='store_true')
    args = parser.parse_args()
    actual = {'formatVersion': 1, 'description': 'Controller mappings in this checkout. This is an offline inventory, not a deployed OpenAPI endpoint.', 'endpoints': inventory()}
    if args.write_inventory:
        INVENTORY.parent.mkdir(parents=True, exist_ok=True)
        INVENTORY.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + '\n')
        print(f'Wrote {len(actual["endpoints"])} controller mappings. Review API docs before committing.')
        return
    errors = []
    expected_sources = {source for _, source in CONTROLLERS}
    actual_sources = {str(p.relative_to(ROOT)) for p in (ROOT / 'examples').glob('**/src/main/java/**/*Controller.java') if '/target/' not in str(p) and '/.work/' not in str(p)}
    if actual_sources != expected_sources:
        errors.append('Controller files changed: review the documented host inventory and CONTROLLERS list.')
    if unique_json(INVENTORY) != actual:
        errors.append('Controller inventory drift: review docs/api/API_REFERENCE.md, then explicitly regenerate the inventory.')
    files = [ROOT / p for p in ['README.md', 'README.en.md', 'CONTRIBUTING.md', 'docs/GETTING_STARTED.md',
                              'examples/approval-demo/backend/README.md', 'examples/approval-domain/README.md',
                              'docs/CAPABILITIES.md', 'docs/CONDITIONAL_ROUTING.md',
                              'docs/PAYMENT_CONTRACT_SCENARIOS.md', 'docs/UNIFIED_SCENARIO_INTEGRATION.md']]
    files += sorted((ROOT / 'docs/development').glob('*.md'))
    files += sorted((ROOT / 'docs/api').rglob('*.md'))
    refs = 0
    for path in files:
        text = unfenced(path.read_text())
        links = re.findall(r'!?\[[^\]\n]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)', text)
        links += re.findall(r'^\[[^]\n]+\]:\s*(\S+)', text, re.M)
        for ref in links:
            uri = urlsplit(ref.strip('<>'))
            if uri.scheme or uri.netloc:
                continue
            destination = (path.parent / unquote(uri.path)).resolve() if uri.path else path.resolve()
            refs += 1
            if not destination.is_relative_to(ROOT) or not destination.exists():
                errors.append(f'{path.relative_to(ROOT)}: missing local target {ref}')
            elif uri.fragment and destination.suffix == '.md' and unquote(uri.fragment) not in anchors(destination):
                errors.append(f'{path.relative_to(ROOT)}: missing Markdown anchor {ref}')
    examples = sorted((ROOT / 'docs/api/examples').glob('*.json'))
    if len(examples) != 12:
        errors.append(f'Expected 12 reviewed request examples, found {len(examples)}')
    for path in examples:
        body = unique_json(path)
        if not isinstance(body, dict):
            errors.append(f'{path.name}: request body must be an object')
        if re.search(r'"(?:password|token|authorization|secret|apiKey)"\s*:', path.read_text(), re.I):
            errors.append(f'{path.name}: credential-like field in public example')
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        sys.exit(1)
    print(f'PASS: {len(files)} Markdown files; {refs} local links/anchors; {len(examples)} strict JSON request examples; {len(actual["endpoints"])} controller mappings.')


if __name__ == '__main__':
    main()
