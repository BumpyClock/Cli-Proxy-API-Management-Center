#!/usr/bin/env python3
"""Idempotently merge reviewed locale fragments; reject conflicting or missing keys."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANGUAGES = ('en', 'zh-CN', 'zh-TW', 'ru')


def merge(base, fragment, path=''):
    for key, value in fragment.items():
        full_key = f'{path}.{key}' if path else key
        if key not in base:
            base[key] = value
        elif isinstance(value, dict) and isinstance(base[key], dict):
            merge(base[key], value, full_key)
        elif base[key] != value:
            raise ValueError(f'Conflicting translation {full_key}')


def leaves(value, prefix=''):
    result = {}
    for key, child in value.items():
        path = f'{prefix}.{key}' if prefix else key
        if isinstance(child, dict):
            result.update(leaves(child, path))
        elif isinstance(child, str) and child.strip():
            result[path] = set(re.findall(r'{{\s*([^}]+?)\s*}}', child))
        else:
            raise ValueError(f'Invalid translation {path}')
    return result


def read_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f'Cannot read locale JSON {path.relative_to(ROOT)}') from error


def main():
    output = {}
    signatures = {}
    for language in LANGUAGES:
        destination = ROOT / 'src/i18n/locales' / f'{language}.json'
        document = read_json(destination)
        fragments = sorted((ROOT / 'design-review/implementation-i18n').glob(f'*/{language}.json'))
        if not fragments:
            raise ValueError(f'No fragments for {language}')
        additions = {}
        for fragment in fragments:
            values = read_json(fragment)
            merge(document, values)
            merge(additions, values)
        output[destination] = json.dumps(document, ensure_ascii=False, indent=2) + '\n'
        signatures[language] = leaves(additions)
    for language in LANGUAGES[1:]:
        if signatures[language] != signatures['en']:
            raise ValueError(f'Locale keys or interpolation parameters differ for {language}')
    for destination, content in output.items():
        if destination.read_text() != content:
            destination.write_text(content)
    print(f'Merged {len(signatures["en"])} keys across {len(LANGUAGES)} locales.')


if __name__ == '__main__':
    main()
