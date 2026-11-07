#!/usr/bin/env python3
"""Exercise local-fixture cache/refresh states through the real built UI."""
import json
import re
import runpy
import sys
from http.client import HTTPConnection
from pathlib import Path

from chrome_safe import call, evaluate

PAGE = int(sys.argv[1])
ROOT = Path(__file__).resolve().parent
visit = runpy.run_path(str(ROOT / 'verify-implementation.py'))['visit']
assert evaluate(PAGE, '() => location.origin') == 'http://127.0.0.1:4173'


def api(path, body=None):
    connection = HTTPConnection('127.0.0.1', 8318, timeout=5)
    try:
        connection.request(
            'POST' if body is not None else 'GET',
            '/v0/management/__mock/' + path,
            body=json.dumps(body) if body is not None else None,
            headers={'Content-Type': 'application/json'},
        )
        response = connection.getresponse()
        if response.status != 200:
            raise RuntimeError(f'Mock control returned HTTP {response.status}')
        return json.loads(response.read())
    except json.JSONDecodeError as error:
        raise RuntimeError('Invalid mock control JSON') from error
    finally:
        connection.close()


def quota_calls():
    counts = api('requests')
    return counts.get('/api-call', 0) + counts.get('/copilot-quota', 0)


def state(delay=300):
    return evaluate(PAGE, '''async () => {
      await new Promise(resolve => setTimeout(resolve, ''' + str(delay) + '''));
      return {
        lines: document.querySelectorAll('path.recharts-line-curve').length,
        status: document.querySelector('main [role=status]')?.textContent || '',
        usage: document.querySelector('[data-usage-state]')?.dataset.usageState,
        stale: [...document.querySelectorAll('figure button')].some(button => button.textContent.includes('Stale')),
        activeTag: document.activeElement?.tagName
      };
    }''')


def refresh(delay=350):
    evaluate(PAGE, '() => {document.querySelector("main header button").click(); return true;}')
    return state(delay)


results = {}
api('state', {'failedAccounts': [], 'delayMs': 0, 'usageEnabled': True, 'usageFails': False})
visit(PAGE, '/quota')
evaluate(PAGE, '''() => {
  const filters=document.querySelector('main details');filters.open=true;
  document.querySelector('main input[type=search]')?.parentElement.querySelector('button')?.click();
  [...filters.querySelectorAll('button')].find(button=>button.textContent.trim().startsWith('All')).click();
  [...document.querySelectorAll('main button')].find(button=>button.textContent.trim()==='Weekly').click();
  return true;
}''')
assert state()['lines'] == 6
refresh(900)
before = quota_calls()
evaluate(PAGE, '() => {document.querySelector("figure [tabindex=\\"0\\"]").focus();return true;}')
call('press_key', {'pageId': PAGE, 'key': 'Home'})
first = evaluate(PAGE, '() => document.getElementById(document.activeElement.getAttribute("aria-describedby")).textContent')
call('press_key', {'pageId': PAGE, 'key': 'ArrowRight'})
second = evaluate(PAGE, '() => document.getElementById(document.activeElement.getAttribute("aria-describedby")).textContent')
assert first != second
call('press_key', {'pageId': PAGE, 'key': 'End'})
call('press_key', {'pageId': PAGE, 'key': 'Tab'})
assert state()['activeTag'] == 'SUMMARY'
results['native_chart_keyboard'] = True

evaluate(PAGE, '() => {document.querySelector("figure button").focus();return true;}')
call('press_key', {'pageId': PAGE, 'key': 'Enter'})
assert state()['lines'] == 5
assert evaluate(PAGE, '() => document.activeElement.getAttribute("aria-pressed")') == 'false'
call('press_key', {'pageId': PAGE, 'key': 'Enter'})
assert state()['lines'] == 6

evaluate(PAGE, '''() => {
  const filters=document.querySelector('main details');filters.open=true;
  [...filters.querySelectorAll('button')].find(button=>button.textContent.trim().startsWith('Claude')).click();
  return true;
}''')
assert state()['lines'] == 3
evaluate(PAGE, '''() => {
  const filters=document.querySelector('main details');
  [...filters.querySelectorAll('button')].find(button=>button.textContent.trim().startsWith('All')).click();
  [...document.querySelectorAll('main button')].find(button=>button.textContent.trim()==='5-hour').click();
  return true;
}''')
assert state()['lines'] == 6
evaluate(PAGE, '() => {[...document.querySelectorAll("main button")].find(button=>button.textContent.trim()==="Weekly").click();return true;}')
snapshot = call('take_snapshot', {'pageId': PAGE})
text = '\n'.join(item.get('text', '') for item in snapshot['content'] if item['type'] == 'text')
search = re.search(r'uid=(\S+) (?:searchbox|textbox) "[^"\n]*[Ss]earch', text)
if search is None:
    raise RuntimeError('Quota search input missing from accessibility tree')
call('fill', {'pageId': PAGE, 'uid': search[1], 'value': 'mock-codex'})
assert state()['lines'] == 2
evaluate(PAGE, '() => {document.querySelector("main input[type=search]").parentElement.querySelector("button").click();return true;}')
assert state()['lines'] == 6
assert quota_calls() == before
results['filters_windows_series_search_no_refetch'] = True

api('state', {'failedAccounts': ['claude-1'], 'delayMs': 500})
pending = refresh(150)
assert pending['lines'] == 6 and 'Checking' in pending['status']
failed = state(1800)
assert failed['lines'] == 6 and failed['stale'] and '1 failed' in failed['status']
results['cached_refresh_and_partial_failure'] = True
api('state', {'failedAccounts': [], 'delayMs': 0})
assert refresh(900)['stale'] is False
before = quota_calls()
visit(PAGE, '/usage')
visit(PAGE, '/quota')
assert quota_calls() > before
results['route_reentry_checks_again'] = True

visit(PAGE, '/usage')
assert state()['usage'] == 'live'
api('state', {'usageEnabled': False})
assert refresh()['usage'] == 'off'
api('state', {'usageEnabled': True, 'usageFails': False})
assert refresh()['usage'] == 'live'
api('state', {'usageFails': True})
stale = refresh()
assert stale['usage'] == 'stale' and stale['lines'] == 2
api('state', {'usageEnabled': None, 'usageFails': False})
assert refresh()['usage'] == 'unknown'
api('state', {'usageEnabled': True, 'usageFails': True})
assert refresh()['usage'] == 'error'
api('state', {'usageEnabled': True, 'usageFails': False})
assert refresh()['usage'] == 'live'
results['usage_live_off_unknown_error_retained_stale'] = True
(ROOT / 'implemented/runtime-states.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
