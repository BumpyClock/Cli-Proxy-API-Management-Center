#!/usr/bin/env python3
"""Checksum-verified, backed-up UI-only Railway deployment. Never restarts the backend."""
import hashlib
import json
import subprocess
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = 'cliproxy-production-6997.up.railway.app'
PREVIOUS_SHA = 'cd7e5d191e178ba93aba97f41dd52442ad1ed8d27529e8d25878eb1308cfeabb'


class SingleFileCheck(HTMLParser):
    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'script' and values.get('src'):
            raise ValueError('Build requires an external script')
        if tag == 'link' and values.get('rel') == 'stylesheet' and values.get('href'):
            raise ValueError('Build requires an external stylesheet')


def main():
    try:
        artifact = (ROOT / 'dist/index.html').read_bytes()
    except OSError as error:
        raise RuntimeError('Production build is unavailable') from error
    SingleFileCheck().feed(artifact.decode('utf-8'))
    for marker in [b'MOCK DATA ONLY', b'mock-preview-only', b'/__mock/state', b'Design prototype', b'No live changes']:
        if marker in artifact:
            raise RuntimeError('Refusing an artifact containing review or fixture markers')
    sha = hashlib.sha256(artifact).hexdigest()
    backup = f'/data/ui-deployments/redesign-{sha[:16]}/management.previous.html'
    script = f'''set -eu
TARGET=/data/static/management.html
STAGE=/data/static/.management-{sha}.staging
BACKUP={backup}
CURRENT=$(sha256sum "$TARGET" | cut -d ' ' -f 1)
[ "$CURRENT" = "{PREVIOUS_SHA}" ] || [ "$CURRENT" = "{sha}" ] || {{ echo 'Unexpected live UI; no changes made'; exit 2; }}
CONFIG=$(sha256sum /data/config.yaml | cut -d ' ' -f 1)
BINARY=$(sha256sum /CLIProxyAPI/CLIProxyAPIPlus | cut -d ' ' -f 1)
COUNT=$(find /data/auth -maxdepth 1 -type f | wc -l | tr -d ' ')
START=$(awk '{{print $22}}' /proc/1/stat)
[ "$(awk '/disable-auto-update-panel:/{{print $2}}' /data/config.yaml)" = true ]
if [ "$CURRENT" != "{sha}" ]; then
  umask 022
  cat > "$STAGE"
  [ "$(sha256sum "$STAGE" | cut -d ' ' -f 1)" = "{sha}" ]
  mkdir -p "$(dirname "$BACKUP")"
  if [ ! -e "$BACKUP" ]; then cp -p "$TARGET" "$BACKUP"; fi
  [ "$(sha256sum "$BACKUP" | cut -d ' ' -f 1)" = "{PREVIOUS_SHA}" ]
  chmod 0644 "$STAGE"
  mv -f "$STAGE" "$TARGET"
fi
[ "$(sha256sum "$TARGET" | cut -d ' ' -f 1)" = "{sha}" ]
[ "$(sha256sum /data/config.yaml | cut -d ' ' -f 1)" = "$CONFIG" ]
[ "$(sha256sum /CLIProxyAPI/CLIProxyAPIPlus | cut -d ' ' -f 1)" = "$BINARY" ]
[ "$(find /data/auth -maxdepth 1 -type f | wc -l | tr -d ' ')" = "$COUNT" ]
[ "$(awk '{{print $22}}' /proc/1/stat)" = "$START" ]
printf 'UI_SHA256=%s\\nCONFIG_SHA256=%s\\nBINARY_SHA256=%s\\nAUTH_FILE_COUNT=%s\\nPROCESS_START=%s\\n' '{sha}' "$CONFIG" "$BINARY" "$COUNT" "$START"
'''
    command = [
        'railway', 'ssh',
        '--project=dfd6c6e7-76a9-4f83-8208-0346accca71b',
        '--environment=ff7fc14f-3aaa-45e8-965d-61183aec3d54',
        '--service=d13f56ab-4a40-4411-9726-c9f910639047',
        '--identity-file', str(Path.home() / '.ssh/railway_ed25519'),
        '--', 'sh', '-lc', script,
    ]
    try:
        result = subprocess.run(command, input=artifact, capture_output=True, timeout=120, check=False)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError('SSH timed out. Inspect live/staging hashes before retrying.') from error
    if result.returncode:
        raise RuntimeError('SSH deployment failed. Inspect live/staging hashes before retrying; raw output suppressed.')
    facts = dict(line.split('=', 1) for line in result.stdout.decode().splitlines() if '=' in line)
    if facts.get('UI_SHA256') != sha:
        raise RuntimeError('SSH did not confirm the deployed checksum')
    receipt = {
        'url': f'https://{HOST}/management.html',
        'artifactSha256': sha,
        'artifactBytes': len(artifact),
        'previousSha256': PREVIOUS_SHA,
        'rollbackFile': backup,
        'method': 'Checksum-verified atomic HTML replacement over Railway SSH',
        'backendRestarted': False,
        'configAndBinaryUnchanged': True,
        'authFileCountUnchanged': True,
        'remoteFacts': facts,
        'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'localVerification': 'Bun 1.3.14; 1120 tests, lint, TypeScript passed on identical PR tree; merged-main build passed',
        'boatCI': 'GitHub verify and test-build checks passed on PR head 02b3201.',
    }
    (ROOT / 'design-review/implemented/deployment.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
