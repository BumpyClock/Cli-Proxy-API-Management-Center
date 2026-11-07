"""Existing-profile Chrome tools without unrelated tabs or URL credentials in output."""
import json
import re
import subprocess
from urllib.parse import urlsplit, urlunsplit

ALLOWED_HOSTS = {'127.0.0.1', 'localhost', 'cliproxy-production-6997.up.railway.app'}


def clean_url(match):
    value = urlsplit(match.group(0))
    host = value.hostname or ''
    port = f':{value.port}' if value.port else ''
    return urlunsplit((value.scheme, host + port, value.path, '', ''))


def safe_text(text):
    if text.startswith('## Pages'):
        output = []
        for line in text.splitlines():
            match = re.match(r'^(\d+): .*\((https?://[^\s]+)\)(.*)$', line)
            if match and urlsplit(match[2]).hostname in ALLOWED_HOSTS:
                output.append(f'{match[1]}: scoped app tab{match[3]}')
        return '\n'.join(output)
    return re.sub(r'https?://[^\s<>"\)]+', clean_url, text)


def call(tool, args):
    result = subprocess.run(
        ['mcporter', 'call', 'chrome-devtools.' + tool, '--args', json.dumps(args), '--output', 'json'],
        capture_output=True, text=True, check=False,
    )
    if result.returncode:
        try:
            failure = json.loads(result.stdout)
            message = next((item.get('text', '') for item in failure.get('content', []) if item.get('type') == 'text'), '')
        except json.JSONDecodeError:
            message = result.stderr
        message = safe_text(message).splitlines()[0] if message else 'No diagnostic message'
        message = re.sub(r'Bearer\s+\S+|[A-Za-z0-9_-]{32,}', '[redacted]', message)
        raise RuntimeError(f'{tool} failed: {message[:240]}')
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f'{tool} returned invalid JSON; raw output suppressed') from error
    for item in data.get('content', []):
        if item.get('type') == 'text':
            item['text'] = safe_text(item['text'])
    if data.get('isError'):
        raise RuntimeError(f'{tool} failed; raw browser output suppressed')
    return data


def evaluate(page, function):
    data = call('evaluate_script', {'pageId': page, 'function': function})
    for item in data.get('content', []):
        text = item.get('text', '')
        if '```json\n' in text:
            try:
                return json.loads(text.split('```json\n', 1)[1].split('```', 1)[0])
            except json.JSONDecodeError as error:
                raise RuntimeError('Browser returned invalid evaluation JSON; raw output suppressed') from error
    raise RuntimeError('Browser did not return a JSON evaluation result')
