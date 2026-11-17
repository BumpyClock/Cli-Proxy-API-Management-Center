import { describe, expect, test } from 'bun:test';
import { parse as parseYaml, parseDocument } from 'yaml';
import {
  buildConfigSavePreview,
  readCommercialModeFromYaml,
  shouldReloadVisualDraft,
} from '../src/features/config/hooks/useConfigDocument';

const owner = { revision: 1, assertConnection() {} };

function applyProxyEdit(yaml: string): string {
  const document = parseDocument(yaml);
  document.set('proxy-url', 'http://local-proxy.example');
  return document.toString();
}

describe('config document concurrency policy', () => {
  test('restart warnings read the native server commercial-mode flag', () => {
    expect(readCommercialModeFromYaml('server:\n  commercial-mode: true\n')).toBe(true);
    expect(readCommercialModeFromYaml('server:\n  commercial-mode: false\n')).toBe(false);
    expect(readCommercialModeFromYaml('server: null\n')).toBe(false);
    expect(readCommercialModeFromYaml('commercial-mode: true\n')).toBe(false);
  });

  test('rebasing a visual preview preserves server changes and uses the reviewed draft', () => {
    expect(shouldReloadVisualDraft(false, null)).toBe(false);
    const first = buildConfigSavePreview(
      owner,
      { origin: 'visual', applyVisualChanges: applyProxyEdit },
      'debug: false\nproxy-url: http://old-proxy.example\n'
    );
    const latest = 'debug: true\nproxy-url: http://old-proxy.example\nsource-only: server\n';
    const rebased = buildConfigSavePreview(first.owner, first.draft, latest);

    expect(parseYaml(rebased.modified)).toEqual({
      debug: true,
      'proxy-url': 'http://local-proxy.example',
      'source-only': 'server',
    });
    expect(parseYaml(first.modified).debug).toBe(false);
    expect(rebased.serverContent).toBe(latest);
  });

  test('rebasing a source-origin visual preview preserves the same local draft and visual edits', () => {
    const source = 'debug: false\nsource-only: local\n';
    const server = 'debug: true\nsource-only: server\n';
    const first = buildConfigSavePreview(
      owner,
      { origin: 'source', content: source, applyVisualChanges: applyProxyEdit },
      server
    );
    const rebased = buildConfigSavePreview(first.owner, first.draft, 'other: server\n');

    expect(shouldReloadVisualDraft(true, null)).toBe(true);
    expect(parseYaml(rebased.modified)).toEqual({
      debug: false,
      'source-only': 'local',
      'proxy-url': 'http://local-proxy.example',
    });
    expect(rebased.modified).toBe(first.modified);
    expect(rebased.original).toBe('other: server\n');
  });

  test('retries parsing after a YAML error even without a source edit', () => {
    expect(shouldReloadVisualDraft(false, 'Invalid YAML')).toBe(true);
  });
});
