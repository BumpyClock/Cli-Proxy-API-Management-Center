import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { UtilitiesMenuList } from '@/components/layout/HeaderUtilities';
import { createTestI18n, productionLocales } from './helpers/locales';

const i18n = await createTestI18n('en');
const noop = () => {};
const renderMenu = (language: 'en' | 'ru', theme: 'dark' | 'auto') =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(UtilitiesMenuList, {
        language,
        theme,
        onRefresh: noop,
        onLanguageSelect: noop,
        onThemeSelect: noop,
        onSignOut: noop,
      })
    )
  );
const items = (html: string) =>
  [
    ...html.matchAll(
      /role="(menuitem(?:radio)?)"(?: aria-checked="(true|false)")?[^>]*>(.*?)<\/button>/g
    ),
  ].map(([, role, checked, inner]) => ({
    role,
    checked,
    text: inner
      .replace(/<[^>]+>/g, '')
      .replace('✓', '')
      .replaceAll('&amp;', '&'),
  }));
const layout = readFileSync('src/components/layout/MainLayout.tsx', 'utf8');

describe('phone Utilities menu', () => {
  test('names every item and orders refresh, languages, themes, sign out', () => {
    const list = items(renderMenu('en', 'dark'));
    expect(list.map((item) => item.text)).toEqual([
      'Refresh config & page',
      '简体中文',
      '繁體中文（台灣）',
      'English',
      'Русский',
      'Follow system',
      'Pure White',
      'Wool Paper',
      'Dark',
      'Sign out',
    ]);
    expect(list[0].role).toBe('menuitem');
    expect(list.at(-1)?.role).toBe('menuitem');
    expect(list.slice(1, -1).every((item) => item.role === 'menuitemradio')).toBe(true);
  });

  test('marks exactly the current language and the current theme as checked', () => {
    const checked = items(renderMenu('ru', 'dark'))
      .filter((item) => item.checked === 'true')
      .map((item) => item.text);
    expect(checked).toEqual(['Русский', 'Dark']);
  });

  test('groups the radios under visible Language and Theme headings', () => {
    const html = renderMenu('en', 'auto');
    const groups = [...html.matchAll(/role="group" aria-labelledby="([^"]+)"/g)].map(([, id]) => {
      const heading = html.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`));
      return heading?.[1];
    });
    expect(groups).toEqual(['Language', 'Theme']);
    // Menu items stay out of the tab order; the menu moves focus with arrow keys.
    expect(html).not.toMatch(/role="menuitem(radio)?"(?![^>]*tabindex="-1")[^>]*>/);
  });
});

describe('header utility names', () => {
  test('the shell refresh names its literal scope, distinct from page-level refresh labels', () => {
    for (const locale of Object.values(productionLocales)) {
      const header = locale.header as Record<string, string>;
      for (const key of ['refresh_all', 'reload', 'reload_scope']) {
        expect(header[key]).toBeUndefined();
      }
      expect(header.refresh_config_page.length).toBeGreaterThan(0);
      for (const key of ['utilities', 'logout', 'language_current', 'theme_current']) {
        expect(header[key]?.length ?? 0).toBeGreaterThan(0);
      }
      expect(header.language_current).toContain('{{language}}');
      expect(header.theme_current).toContain('{{theme}}');
    }
    expect(i18n.t('header.refresh_config_page')).not.toBe(i18n.t('common.refresh'));
    // It does not reload the app, so the name never says "Reload".
    expect(i18n.t('header.refresh_config_page')).not.toMatch(/reload/i);
  });

  test('the desktop button shows the same scoped name it announces', () => {
    const source = readFileSync('src/components/layout/HeaderUtilities.tsx', 'utf8');
    const desktop = source.slice(source.indexOf('function DesktopUtilities'));
    expect(desktop).toContain("const refreshName = t('header.refresh_config_page');");
    expect(desktop).toContain('aria-label={refreshName}');
    expect(desktop).toContain('<span className="header-utility-label">{refreshName}</span>');
  });

  test('the shell renders one utilities component wired to the existing handlers', () => {
    expect(layout).toContain('<HeaderUtilities');
    expect(layout).toContain('compact={isDrawerNav}');
    expect(layout).toContain('onRefresh={() => void handleRefreshAll()}');
    expect(layout).toContain('onSignOut={logout}');
    // handleRefreshAll keeps its scope: config, plugin resources, Auth Files count, page handler.
    const refreshAll = layout.slice(layout.indexOf('const handleRefreshAll'));
    for (const call of [
      'fetchConfig(true)',
      'loadPluginResources()',
      'loadAuthFilesCount()',
      'triggerHeaderRefresh()',
    ]) {
      expect(refreshAll.slice(0, 400)).toContain(call);
    }
  });
});
