import { describe, expect, test } from 'bun:test';
import { createInstance } from 'i18next';
import { resolveRouteTrail } from '../src/components/layout/routeLabel';
import en from '../src/i18n/locales/en.json';
import zhCN from '../src/i18n/locales/zh-CN.json';
import zhTW from '../src/i18n/locales/zh-TW.json';
import ru from '../src/i18n/locales/ru.json';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
const t = (key: string) => i18n.t(key);
const authFiles = { path: '/auth-files', label: en.nav.auth_files };

describe('top bar route trail', () => {
  test('OAuth editors name Auth Files as parent and end with the exact page h1', () => {
    expect(resolveRouteTrail(authFiles, '/auth-files/oauth-excluded', t, 'CPAMC')).toEqual({
      parent: authFiles,
      current: en.oauth_excluded.title,
    });
    expect(resolveRouteTrail(authFiles, '/auth-files/oauth-model-alias', t, 'CPAMC')).toEqual({
      parent: authFiles,
      current: en.oauth_model_alias.title,
    });
  });

  test('top-level pages have no parent and use the sidebar label', () => {
    expect(resolveRouteTrail(authFiles, '/auth-files', t, 'CPAMC')).toEqual({
      parent: null,
      current: en.nav.auth_files,
    });
    expect(resolveRouteTrail(undefined, '/unknown', t, 'CPAMC')).toEqual({
      parent: null,
      current: 'CPAMC',
    });
  });

  test('the phone Back link is named after its destination in every locale', () => {
    expect(i18n.t('header.back_to', { page: en.nav.auth_files })).toBe('Back to Auth Files');
    for (const messages of [zhCN, zhTW, ru] as Record<string, unknown>[]) {
      expect((messages.header as Record<string, string>).back_to).toContain('{{page}}');
      expect(messages.nav_short).toBeUndefined();
    }
  });
});
