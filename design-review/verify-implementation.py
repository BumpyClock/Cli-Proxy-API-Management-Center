#!/usr/bin/env python3
"""Capture the built app in an existing Chrome tab, without starting another browser."""
import argparse
import base64
import json
import runpy
from pathlib import Path

from chrome_safe import call, evaluate

ROOT = Path(__file__).resolve().parent
PRIVACY = runpy.run_path(str(ROOT / 'capture-current.py'))['PRIVACY']
ROUTES = [
    ('dashboard', '/'),
    ('quick-start', '/quick-start'),
    ('providers', '/ai-providers'),
    ('auth-files', '/auth-files'),
    ('oauth-excluded', '/auth-files/oauth-excluded'),
    ('oauth-model-alias', '/auth-files/oauth-model-alias'),
    ('oauth', '/oauth'),
    ('quota', '/quota'),
    ('usage', '/usage'),
    ('config', '/config'),
    ('logs', '/logs'),
    ('system', '/system'),
    ('plugins', '/plugins'),
    ('plugin-store', '/plugin-store'),
]


def screenshot(page, path):
    data = call('take_screenshot', {'pageId': page, 'fullPage': False, 'format': 'png'})
    image = next((item for item in data['content'] if item['type'] == 'image'), None)
    if image is None:
        raise RuntimeError('Browser returned no screenshot')
    path.write_bytes(base64.b64decode(image['data']))


def visit(page, route):
    available = evaluate(page, '''async () => {
      const target = ''' + json.dumps('#' + route) + ''';
      if (innerWidth <= 768) {
        document.querySelector('.main-header .mobile-menu-btn')?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
      }
      const link = [...document.querySelectorAll('a[href]')].find(node => {
        const url = new URL(node.href);
        return url.origin === location.origin && url.hash === target;
      });
      if (!link) return false;
      link.click();
      return true;
    }''')
    if not available:
        return None
    return evaluate(page, r'''async () => {
      await new Promise(resolve => setTimeout(resolve, 1100));
      document.querySelector('.content')?.scrollTo(0, 0); window.scrollTo(0, 0);
      const roots = [...document.querySelectorAll('*')].map(node => node.shadowRoot).filter(Boolean);
      roots.flatMap(root => [...root.querySelectorAll('button')]).find(button =>
        /^(Close|Dismiss)$/i.test(button.getAttribute('aria-label') || button.title)
      )?.click();
      document.activeElement?.blur();
      return {
        route: location.hash,
        viewport: [innerWidth, innerHeight],
        headings: [...document.querySelectorAll('main h1')].map(node => node.textContent),
        overflow: document.documentElement.scrollWidth > innerWidth,
        rawKeys: /\b(?:redesign|quota_management|dashboard|auth_files)\.[a-z_]+/.test(document.body.innerText),
        chartLines: document.querySelectorAll('path.recharts-line-curve').length,
        healthyShellBadges: document.querySelectorAll('.main-header .status-badge, .sidebar .status-badge').length,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches
      };
    }''')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--page-id', type=int, required=True)
    parser.add_argument('--production', action='store_true', help='Scrub live data before screenshots.')
    parser.add_argument('--only', help='Comma-separated route names.')
    parser.add_argument('--no-capture', action='store_true')
    args = parser.parse_args()
    origin = evaluate(args.page_id, '() => location.origin')
    expected = 'https://cliproxy-production-6997.up.railway.app' if args.production else 'http://127.0.0.1:4173'
    if origin != expected:
        raise RuntimeError('Refusing to inspect an unexpected browser origin')
    folder = ROOT / 'implemented' / ('production' if args.production else 'fixture')
    folder.mkdir(parents=True, exist_ok=True)
    records = []
    for width, height in [(1440, 1000), (390, 844)]:
        viewport = f'{width}x{height}x1' + (',mobile,touch' if width == 390 else '')
        call('emulate', {'pageId': args.page_id, 'viewport': viewport})
        ready = evaluate(args.page_id, '''async () => {
          await new Promise(resolve => setTimeout(resolve, 1500));
          return Boolean(document.querySelector('main h1'));
        }''')
        if not ready:
            raise RuntimeError('Authenticated app unavailable after viewport change')
        for name, route in ROUTES:
            if args.only and name not in args.only.split(','):
                continue
            record = visit(args.page_id, route)
            if record is None:
                if name not in {'plugins', 'plugin-store'}:
                    raise RuntimeError(f'Expected application link missing for {name}')
                records.append({'name': name, 'width': width, 'skipped': 'Route link unavailable for current backend capabilities.'})
                print(f'{name}-{width}: unavailable; not captured', flush=True)
                continue
            if record['route'] != '#' + route:
                raise RuntimeError(f'{name} redirected; refusing a mislabeled screenshot')
            if record['overflow'] or record['rawKeys'] or record['healthyShellBadges']:
                raise RuntimeError(f'{name} failed viewport/translation/shell checks at {width}')
            if record['viewport'] != [width, height]:
                raise RuntimeError('Browser viewport did not match requested CSS dimensions')
            if args.production:
                evaluate(args.page_id, PRIVACY)
            if not args.production and name in {'dashboard', 'quota', 'usage'} and record['chartLines'] == 0:
                raise RuntimeError(f'Expected fixture chart missing on {name}')
            path = folder / f'{name}-{width}.png'
            if not args.no_capture:
                screenshot(args.page_id, path)
            records.append({'name': name, **record, 'image': str(path.relative_to(ROOT)) if not args.no_capture else None})
            print(f'{name}-{width}: passed; {record["chartLines"]} chart lines', flush=True)
    (folder / 'verification.json').write_text(json.dumps(records, indent=2, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    main()
