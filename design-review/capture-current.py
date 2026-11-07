#!/usr/bin/env python3
"""Read-only Chrome capture. Uses existing authenticated profile; never saves form values."""
import argparse
import base64
import json
from pathlib import Path

from chrome_safe import call

ROOT = Path(__file__).resolve().parent
ROUTES = [
    ('dashboard', '/'), ('quick-start', '/quick-start'), ('providers', '/ai-providers'),
    ('auth-files', '/auth-files'), ('oauth-excluded', '/auth-files/oauth-excluded'),
    ('oauth-model-alias', '/auth-files/oauth-model-alias'), ('oauth', '/oauth'),
    ('quota', '/quota'), ('usage', '/usage'), ('plugins', '/plugins'),
    ('plugin-store', '/plugin-store'), ('config', '/config'), ('logs', '/logs'),
    ('system', '/system'), ('login', '/login'),
]
PRIVACY = r'''() => {
  const scrub = value => value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'account@example.com')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/aditya(?:k)?sharma[\w.-]*/gi, '[account]')
    .replace(/(?:https?:\/\/)?[\w.-]+\.up\.railway\.app/gi, 'https://proxy.example.invalid')
    .replace(/api-key:[a-f\d]+/gi, 'api-key:[redacted]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[address]')
    .replace(/\b(?:[a-f\d]{0,4}:){3,7}[a-f\d]{0,4}\b/gi, '[address]')
    .replace(/\b(?=[A-Za-z0-9_-]{32,}\b)(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]+\b/g, '[redacted]');
  const mask = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.parentElement.closest('script,style,textarea,.cm-content')) nodes.push(n);
    }
    for (const n of nodes) { const next = scrub(n.textContent); if (next !== n.textContent) n.textContent = next; }
  };
  if (!document.getElementById('review-privacy')) {
    const style = document.createElement('style'); style.id='review-privacy';
    style.textContent='input:not([type=checkbox]):not([type=radio]):not([type=number]){-webkit-text-security:disc!important} textarea,.cm-content,[class*=secretValue],[class*=keyValue]{filter:blur(9px)!important}';
    document.head.append(style);
    new MutationObserver(mask).observe(document.body,{subtree:true,childList:true});
  }
  mask();
  return {route:location.hash, headings:[...document.querySelectorAll('h1,h2,h3')].map(n=>n.textContent), text:scrub(document.body.innerText).slice(0,18000), viewport:{width:innerWidth,height:innerHeight}, overflow:document.documentElement.scrollWidth>innerWidth};
}'''

def evaluate(page, function):
    data = call('evaluate_script', {'pageId': page, 'function': function})
    texts = [x['text'] for x in data.get('content', []) if x['type'] == 'text']
    for text in texts:
        if '```json\n' in text:
            try:
                return json.loads(text.split('```json\n', 1)[1].split('```', 1)[0])
            except json.JSONDecodeError as error:
                raise RuntimeError('Browser evaluation returned invalid JSON') from error
    return {'toolText': '\n'.join(texts)}

def screenshot(page, name):
    full_page = name != 'plugin-store-mobile'
    scope = 'full-page' if full_page else 'viewport; long catalog sampled at first viewport'
    try:
        data = call('take_screenshot', {'pageId': page, 'fullPage': full_page, 'format': 'png'})
    except RuntimeError as error:
        if 'Unable to capture screenshot' not in str(error):
            raise
        scope = 'viewport; browser rejected full-page image dimensions'
        data = call('take_screenshot', {'pageId': page, 'fullPage': False, 'format': 'png'})
    image = next((c for c in data['content'] if c['type'] == 'image'), None)
    if image is None:
        raise RuntimeError('Screenshot tool returned no image: ' + str(data)[:600])
    path = ROOT / 'current' / (name + '.png')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(base64.b64decode(image['data']))
    return {'image': str(path.relative_to(ROOT)), 'imageScope': scope}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--page-id', type=int, required=True)
    parser.add_argument('--mobile', action='store_true')
    parser.add_argument('--login-page-id', type=int, help='Separate page showing the local built login UI; avoids logging out production.')
    parser.add_argument('--only', help='Comma-separated route names to recapture; preserves other manifest entries.')
    args = parser.parse_args()
    manifest_path = ROOT / ('manifest-mobile.json' if args.mobile else 'manifest.json')
    if args.only and manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text())
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError('Cannot resume unreadable capture manifest') from error
    else:
        manifest = []
    call('emulate', {'pageId': args.page_id, 'viewport': '1440x1000x1'})
    selected = [(n, r) for n, r in ROUTES if not args.only or n in args.only.split(',')]
    if args.mobile:
        call('emulate', {'pageId': args.page_id, 'viewport': '390x844x1,mobile,touch'})
    suffix = '-mobile' if args.mobile else ''
    for name, route in selected:
        page = args.page_id
        if name == 'login':
            if args.login_page_id is None:
                print('login: skipped; supply --login-page-id for separate local login page', flush=True)
                continue
            page = args.login_page_id
            call('emulate', {'pageId': page, 'viewport': '390x844x1,mobile,touch' if args.mobile else '1440x1000x1'})
        evaluate(page, '() => {location.hash=' + json.dumps('#' + route) + '; return {navigated:true};}')
        call('navigate_page', {'pageId': page, 'type': 'reload'})
        evaluate(page, 'async () => {await new Promise(r=>setTimeout(r,1800)); return {ready:true};}')
        evidence = evaluate(page, PRIVACY)
        if evidence.get('route') != '#' + route:
            raise RuntimeError(f'{name} redirected; refusing mislabeled screenshot')
        evidence.update({'name':name, 'requestedRoute':route, **screenshot(page,name+suffix)})
        if name == 'login':
            evidence['source'] = 'Local dist/index.html login. No production logout or credential entry.'
        manifest = [x for x in manifest if x['name'] != name] + [evidence]
        manifest_path.write_text(json.dumps(manifest,indent=2))
        print(name+suffix+': '+str(evidence.get('route'))+' -> '+evidence['image'], flush=True)
    evaluate(args.page_id, '() => {location.hash="#/"; return {done:true};}')

if __name__ == '__main__':
    main()
