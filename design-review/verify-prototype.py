#!/usr/bin/env python3
"""Rerunnable checks for design-review/redesign.html.

Static checks: self-contained (no external refs or network APIs), no vh units,
required prototype labels, preserved nav labels, no leaked identifiers.
Optional runtime checks: --runtime explicitly opts into a separate headless
Chrome profile. Default checks are static and do not launch a browser.
The same self test is exposed as window.__cpamcSelfTest() in the existing browser.

Usage: python3 -I design-review/verify-prototype.py [--runtime]
"""
import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FILE = HERE / 'redesign.html'
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

NAV_LABELS = ['Dashboard', 'Quick Start', 'AI Providers', 'Auth Files', 'OAuth Login', 'Quota Management',
              'Usage Statistics', 'Logs Viewer', 'Config Panel', 'Plugins', 'Plugin Store', 'Management Center Info']
GROUPS = ["group: 'Operate'", "group: 'Gateway'", "group: 'Observe'", "group: 'Control'"]
REQUIRED = ['Design prototype', 'Sample data', 'No live changes', 'prefers-reduced-motion', 'showModal()']
FORBIDDEN_IDENTIFIERS = ['adityasharma', 'adityaksharma', 'railway.app', 'cliproxy-production', '131.107.', '5467818f', 'gmail.com', 'microsoft']


def static_checks(src: str) -> dict:
    res = {}
    res['externalSrcHref'] = re.findall(r'(?:src|href)\s*=\s*["\'](?:https?:)?//[^"\']+', src)
    res['cssUrlExternal'] = re.findall(r'url\(\s*["\']?(?:https?:)?//', src)
    res['cssImport'] = re.findall(r'@import', src)
    res['externalScriptsOrLinks'] = re.findall(r'<script[^>]+src=|<link[^>]+rel=["\']?stylesheet', src)
    res['networkApis'] = sorted(set(re.findall(r'\b(fetch\(|XMLHttpRequest|WebSocket\(|sendBeacon|EventSource\(|import\()', src)))
    res['vhUnits'] = re.findall(r'\d(?:\.\d+)?d?s?l?vh\b', src)
    res['htmlBodyHeight100'] = re.findall(r'(?:html|body)[^{]*\{[^}]*height\s*:\s*100%', src)
    res['emails'] = re.findall(r'[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', src, re.I)
    res['longDashes'] = len(re.findall('[—–]', src))
    res['missingRequired'] = [r for r in REQUIRED if r not in src]
    res['missingNavLabels'] = [l for l in NAV_LABELS if f"label: '{l}'" not in src]
    res['missingGroups'] = [g for g in GROUPS if g not in src]
    lower = src.lower()
    res['leakedIdentifiers'] = [f for f in FORBIDDEN_IDENTIFIERS if f in lower]
    for doc in ('critique.md', 'design-notes.md'):
        text = (HERE / doc).read_text(encoding='utf-8').lower()
        res['leakedIdentifiers'] += [f'{doc}: {f}' for f in FORBIDDEN_IDENTIFIERS if f in text]
        res['emails'] += re.findall(r'[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', text, re.I)
        if re.search('[\u2014\u2013]', text):
            res['longDashes'] += 1
    res['scriptSyntaxErrors'] = []
    if shutil.which('node'):
        for index, script in enumerate(re.findall(r'<script[^>]*>(.*?)</script>', src, re.S)):
            result = subprocess.run(['node', '--check', '--input-type=module'], input=script, capture_output=True, text=True)
            if result.returncode:
                res['scriptSyntaxErrors'].append({'script': index, 'error': result.stderr[:1200]})
    else:
        res['scriptSyntaxErrors'].append({'error': 'Node is required for JavaScript syntax validation.'})
    res['bytes'] = len(src.encode())
    bad = [k for k, v in res.items() if k != 'bytes' and v]
    res['pass'] = not bad
    res['failing'] = bad
    return res


def runtime_checks() -> dict:
    if not Path(CHROME).exists():
        return {'skipped': 'Google Chrome not found'}
    profile = tempfile.mkdtemp(prefix='cpamc-verify-')
    try:
        p = subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-first-run', f'--user-data-dir={profile}',
                            '--virtual-time-budget=5000', '--dump-dom', FILE.as_uri() + '?selftest=1'],
                           capture_output=True, text=True, timeout=120)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    m = re.search(r'<pre id="selftest-out"[^>]*>(.*?)</pre>', p.stdout, re.S)
    if not m:
        return {'pass': False, 'error': 'self test output missing', 'stderrTail': p.stderr[-400:]}
    data = json.loads(html.unescape(m.group(1)))
    data.pop('routes', None)
    data.pop('states', None)
    return data


def main() -> int:
    src = FILE.read_text(encoding='utf-8')
    s = static_checks(src)
    r = runtime_checks() if '--runtime' in sys.argv else {'skipped': 'Use --runtime to explicitly opt into isolated headless Chrome.'}
    print(json.dumps({'static': s, 'runtime': r}, indent=1))
    ok = s['pass'] and ('--runtime' not in sys.argv or r.get('pass', False))
    print('RESULT', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
