import { describe, expect, test } from 'bun:test';
import { resolvePluginResourceOpenURL } from '../src/features/plugins/pluginResources';

const documentURL = 'https://manager.example.invalid/management.html';

describe('plugin resource direct navigation boundary', () => {
  test.each([
    ['https://plugin.example.invalid/page', 'https://plugin.example.invalid/page'],
    ['http://localhost:8317/plugin', 'http://localhost:8317/plugin'],
    ['/plugin/page.html', 'https://manager.example.invalid/plugin/page.html'],
    ['relative.html', 'https://manager.example.invalid/relative.html'],
  ])('resolves web resource %s', (value, expected) => {
    expect(resolvePluginResourceOpenURL(value, documentURL)).toBe(expected);
  });

  test.each([
    '',
    '   ',
    'javascript:alert(1)',
    'data:text/html,test',
    'blob:https://a.test/id',
    'http://[',
  ])('does not offer an unsafe or invalid destination %s', (value) => {
    expect(resolvePluginResourceOpenURL(value, documentURL)).toBe('');
  });
});
