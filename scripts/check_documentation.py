#!/usr/bin/env python3
"""Validate maintained document pairs, topic coverage, local links and archived source bytes.

CI reads docs/documentation-map.json; it never generates or repairs documentation.
No third-party dependencies are required. URL availability is not an offline guarantee.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import sys
import unicodedata
from urllib.parse import unquote, urlsplit
from verify_developer_docs import unique_json

ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = {'tutorial', 'how-to', 'explanation', 'reference', 'history', 'index'}
IGNORED = {'.git', 'node_modules', 'target', 'dist', '.work', 'test-results', 'playwright-report'}
TOPICS = re.compile(r'<!-- topic:([a-z0-9][a-z0-9-]*) -->')


def markdown_files(root):
    return {p.relative_to(root).as_posix() for p in root.rglob('*.md')
            if not (set(p.relative_to(root).parts) & IGNORED)}


def english_path(path):
    return str(Path(path).with_name(Path(path).stem + '.en.md'))


def unfenced(text):
    """Remove CommonMark-style backtick/tilde fences, preserving line boundaries."""
    output, fence, width = [], None, 0
    for line in text.splitlines(keepends=True):
        if fence:
            if re.fullmatch(r' {0,3}' + re.escape(fence) + '{' + str(width) + r',}[ \t]*(?:\n)?', line):
                fence = None
            output.append('\n' if line.endswith('\n') else '')
            continue
        opening = re.match(r' {0,3}(`{3,}|~{3,})(.*)', line)
        if opening and not (opening[1][0] == '`' and '`' in opening[2]):
            fence, width = opening[1][0], len(opening[1])
            output.append('\n' if line.endswith('\n') else '')
        else:
            output.append(line)
    return ''.join(output)


def visible_markdown(text, keep_topics=False):
    text = unfenced(text)
    return re.sub(r'<!--.*?-->', lambda m: m[0] if keep_topics and TOPICS.fullmatch(m[0]) else '', text, flags=re.S)


def without_inline_code(text):
    return re.sub(r'(`+)(.*?)\1(?!`)', '', text, flags=re.S)


def local_links(text):
    text = without_inline_code(visible_markdown(text))
    return re.findall(r'!?\[[^\]\n]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)', text) + re.findall(r'^\[[^]\n]+\]:\s*(\S+)', text, re.M)


def anchors(path):
    text = visible_markdown(path.read_text())
    result = set(re.findall(r'<a\s+id=["\']([^"\']+)', text))
    seen = {}
    for heading in re.findall(r'^#{1,6}\s+(.+?)\s*#*$', text, re.M):
        heading = re.sub(r'\[([^]]+)\]\([^)]*\)', r'\1', heading)
        heading = re.sub(r'<[^>]*>', '', heading).replace('`', '').strip().lower()
        slug = ''.join(c for c in heading if c in ' _-' or unicodedata.category(c)[0] in 'LN').replace(' ', '-')
        number = seen.get(slug, 0)
        seen[slug] = number + 1
        result.add(slug + (f'-{number}' if number else ''))
    return result


def has_language_switch(root, file, counterpart, prose):
    expected = file.with_name(counterpart).resolve()
    for link in local_links(prose):
        uri = urlsplit(link.strip('<>'))
        if uri.scheme or uri.netloc or not uri.path:
            continue
        target = (file.parent / unquote(uri.path)).resolve()
        if target == expected and target.is_relative_to(root.resolve()):
            return True
    return False


def check_pairs(root, manifest):
    errors, registered = [], set()
    documents = manifest.get('documents', [])
    if type(manifest.get('formatVersion')) is not int or manifest.get('formatVersion') != 1:
        errors.append('Unsupported documentation registry formatVersion')
    if not isinstance(documents, list):
        errors.append('Documentation registry documents must be an array')
        documents = []
    if not documents:
        errors.append('Documentation registry is empty')
    for entry in documents:
        if not isinstance(entry, dict):
            errors.append('Documentation registry entry must be an object')
            continue
        path = entry.get('path', '')
        if not isinstance(path, str):
            errors.append('Documentation registry path must be a string')
            continue
        if not path.endswith('.md') or path.endswith('.en.md'):
            errors.append(f'{path}: registry path must name the default Chinese .md file')
            continue
        if Path(path).is_absolute() or '..' in Path(path).parts:
            errors.append(f'{path}: unsafe document path')
            continue
        if entry.get('category') not in CATEGORIES:
            errors.append(f'{path}: unknown information-architecture category')
        topics = entry.get('topics', [])
        if not isinstance(topics, list) or not topics or any(not isinstance(t, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]*', t) for t in topics):
            errors.append(f'{path}: topics must be a nonempty array of stable topic IDs')
            topics = []
        elif len(topics) != len(set(topics)):
            errors.append(f'{path}: topics must be nonempty and unique')
        for relative in (path, english_path(path)):
            if relative in registered:
                errors.append(f'{relative}: duplicate registry entry')
            registered.add(relative)
            file = root / relative
            if not file.resolve().is_relative_to(root.resolve()):
                errors.append(f'{relative}: document resolves outside repository')
                continue
            if not file.is_file():
                errors.append(f'{relative}: missing language counterpart')
                continue
            text = file.read_text()
            prose = visible_markdown(text, keep_topics=True)
            found = TOPICS.findall(without_inline_code(prose))
            if len(found) != len(set(found)):
                errors.append(f'{relative}: duplicate topic marker')
            if set(found) != set(topics):
                errors.append(f'{relative}: topic coverage differs from registry: {sorted(set(found)^set(topics))}')
            if len(re.findall(r'^# (?!#).+', prose, re.M)) != 1:
                errors.append(f'{relative}: expected exactly one page title')
            if re.search(r'^#{1,3}\s+(?:English|简体中文|中文)\s*$', prose, re.M):
                errors.append(f'{relative}: stacked language sections are not allowed')
            counterpart = Path(path if relative.endswith('.en.md') else english_path(path)).name
            if not has_language_switch(root, file, counterpart, prose):
                errors.append(f'{relative}: missing direct language-switch link')
            if relative.endswith('.en.md'):
                for paragraph in re.split(r'\n\s*\n', prose):
                    if paragraph.startswith('|'):
                        continue
                    clean = re.sub(r'`[^`]*`|<[^>]*>|https?://\S+', '', paragraph)
                    chinese = len(re.findall('[\u4e00-\u9fff]', clean))
                    if chinese > 35 and chinese / max(1, len(clean)) > .35:
                        errors.append(f'{relative}: untranslated Chinese prose paragraph')
                        break
    actual = markdown_files(root)
    for missing in sorted(actual - registered):
        errors.append(f'{missing}: Markdown page absent from documentation registry')
    for stale in sorted(registered - actual):
        if (root / stale).exists():
            errors.append(f'{stale}: registry points to an excluded file')
    return errors, registered & actual


def check_links(root, paths):
    errors, count, cache = [], 0, {}
    for relative in sorted(paths):
        path = root / relative
        for ref in local_links(path.read_text()):
            uri = urlsplit(ref.strip('<>'))
            if uri.scheme or uri.netloc:
                continue
            count += 1
            target = (path.parent / unquote(uri.path)).resolve() if uri.path else path.resolve()
            if not target.is_relative_to(root.resolve()) or not target.exists():
                errors.append(f'{relative}: missing local link {ref}')
            elif uri.fragment and target.suffix == '.md':
                if target not in cache:
                    cache[target] = anchors(target)
                if unquote(uri.fragment) not in cache[target]:
                    errors.append(f'{relative}: missing anchor {ref}')
            decoded_path = unquote(uri.path)
            if relative.endswith('.en.md') and decoded_path.endswith('.md') and not decoded_path.endswith('.en.md'):
                switch = path.with_name(path.name.replace('.en.md', '.md')).resolve()
                candidate = target.with_name(target.stem + '.en.md')
                if target != switch and candidate.exists():
                    errors.append(f'{relative}: English link targets Chinese page {ref}')
    return errors, count


def check_history(root, manifest):
    errors, seen = [], set()
    sources = manifest.get('historicalSources', [])
    if not isinstance(sources, list):
        return ['Historical source registry must be an array']
    for item in sources:
        if not isinstance(item, dict):
            errors.append('Historical source entry must be an object')
            continue
        path = item.get('path', '')
        if not isinstance(path, str):
            errors.append('Historical source path must be a string')
            continue
        if not path.startswith('docs/history/') or not path.endswith('.txt') or '..' in Path(path).parts:
            errors.append(f'{path}: historical source must be a text artifact inside docs/history')
            continue
        if path in seen:
            errors.append(f'{path}: duplicate historical source')
        seen.add(path)
        file = root / path
        if not isinstance(item.get('revision'), str) or not re.fullmatch('[0-9a-f]{40}', item['revision']):
            errors.append(f'{path}: missing exact source revision')
        if not isinstance(item.get('sha256'), str) or not re.fullmatch('[0-9a-f]{64}', item['sha256']):
            errors.append(f'{path}: missing exact SHA-256 digest')
        if not file.resolve().is_relative_to(root.resolve()):
            errors.append(f'{path}: historical source resolves outside repository')
            continue
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != item.get('sha256'):
            errors.append(f'{path}: historical source bytes changed or missing')
    actual = {p.relative_to(root).as_posix() for p in (root / 'docs/history').rglob('*.txt')}
    if actual != seen:
        errors.append(f'Historical source registry drift: {sorted(actual ^ seen)}')
    return errors


def validate(root=ROOT):
    manifest = unique_json(root / 'docs/documentation-map.json')
    errors, pages = check_pairs(root, manifest)
    link_errors, refs = check_links(root, pages)
    errors += link_errors + check_history(root, manifest)
    return errors, {'pairs': len(manifest.get('documents', [])), 'pages': len(pages),
                    'localLinks': refs, 'historicalSources': len(manifest.get('historicalSources', []))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        errors, summary = validate(args.root.resolve())
    except (OSError, ValueError) as error:
        print(f'Invalid documentation registry: {error}', file=sys.stderr)
        return 1
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print('PASS documentation: ' + json.dumps(summary, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
