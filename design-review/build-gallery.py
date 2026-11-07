#!/usr/bin/env python3
"""Build an offline screenshot gallery from captured, redacted page evidence."""
import base64
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load_manifest(name):
    try:
        return json.loads((ROOT / name).read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f'Cannot read {name}') from error


def build():
    sections = []
    for title, filename in [('Desktop · 1440 px', 'manifest.json'), ('Mobile · 390 px', 'manifest-mobile.json')]:
        cards = []
        for entry in load_manifest(filename):
            path = ROOT / entry['image']
            image = base64.b64encode(path.read_bytes()).decode()
            name = html.escape(entry['name'].replace('-', ' ').title())
            route = html.escape(entry['requestedRoute'])
            note = html.escape(entry.get('source', entry.get('imageScope', 'Captured production UI. Inner scrolling regions show their first viewport.')))
            cards.append(f'<details><summary>{name}<code>{route}</code></summary><p>{note}</p><img alt="{name} current UI screenshot" loading="lazy" src="data:image/png;base64,{image}"></details>')
        sections.append(f'<section><h2>{title}</h2>{"".join(cards)}</section>')
    document = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CLI Proxy · Current UI screenshots</title><style>
:root{font:15px/1.5 system-ui,sans-serif;color-scheme:dark;--bg:#111316;--text:#eff1f3;--muted:#aeb4bc;--line:#343940;--accent:#85b8ff}*{box-sizing:border-box}body{margin:0;padding:32px;background:var(--bg);color:var(--text)}main{max-width:1120px;margin:auto}h1{font-size:28px;letter-spacing:-.03em;margin:0 0 12px}h2{font-size:20px;margin:32px 0 12px}p{color:var(--muted);max-width:80ch}details{border-top:1px solid var(--line)}summary{padding:16px 0;cursor:pointer;font-weight:600}code{font:12px ui-monospace,monospace;font-weight:400;color:var(--muted);margin-left:16px}details p{font-size:13px}img{display:block;max-width:100%;height:auto;margin-bottom:20px;border:1px solid var(--line)}:focus-visible{outline:2px solid var(--accent);outline-offset:4px}@media(max-width:600px){body{padding:16px}code{display:block;margin:4px 0 0 16px}}
</style><main><h1>Current app. Before redesign.</h1><p>30 captures across 15 page views. Desktop and mobile. Captured from the authenticated Railway deployment, except the login screen, captured from the same local production build without logging you out. Secrets and email addresses masked in capture. No settings changed.</p><p>Long pages and nested scrolling regions may show only the first viewport. Plugin resource pages require an installed plugin; none were installed, so that dynamic view has source-only design coverage. Login's file URL is an artifact of local capture, not a verified production bug.</p>''' + ''.join(sections) + '</main></html>'
    (ROOT / 'screenshots.html').write_text(document)
    print(f'Built screenshots.html · {len(document):,} bytes · {sum(len(load_manifest(f)) for f in ["manifest.json", "manifest-mobile.json"])} captures')


if __name__ == '__main__':
    build()
