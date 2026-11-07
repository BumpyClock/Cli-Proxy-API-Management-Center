import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import {
  PLUGIN_STORE_SOURCES_CONFIG_PATH,
  PLUGINS_ENABLED_CONFIG_PATH,
  PluginNoticeGroup,
  PluginsDisabledNotice,
  PluginTrustNotice,
} from '@/features/plugins/components/PluginNotices';
import { findConfigFieldById } from '@/features/config/searchIndex';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();
const source = (path: string) => readFileSync(path, 'utf8');
const pluginsPage = source('src/features/plugins/PluginsPage.tsx');
const storePage = source('src/features/plugins/PluginStorePage.tsx');
const count = (text: string, needle: string) => text.split(needle).length - 1;

describe('round 1 plugins disabled notice', () => {
  test('links to the existing Config Panel field deep link', () => {
    expect(PLUGINS_ENABLED_CONFIG_PATH).toBe('/config?field=pluginsEnabled');
    expect(findConfigFieldById('pluginsEnabled')?.sectionId).toBe('advanced');

    const message = i18n.t('plugin_management.global_disabled_hint');
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(
          MemoryRouter,
          null,
          createElement(PluginNoticeGroup, null, createElement(PluginsDisabledNotice, { message }))
        )
      )
    );
    expect(markup).toContain(message);
    expect(markup).toContain('href="/config?field=pluginsEnabled"');
    expect(markup).toContain(i18n.t('plugin_management.open_plugins_setting'));
    expect(markup).not.toContain('role="switch"');
  });

  test('both plugin pages use the notice instead of a raw warning banner', () => {
    expect(pluginsPage).toMatch(
      /<PluginsDisabledNotice message=\{t\('plugin_management\.global_disabled_hint'\)\}/
    );
    expect(storePage).toMatch(
      /<PluginsDisabledNotice message=\{t\('plugin_store\.global_disabled_hint'\)\}/
    );
    expect(pluginsPage).not.toContain('styles.warningBox');
  });
});

describe('round 1 plugin refresh and empty states', () => {
  test('each page has exactly one scoped refresh action', () => {
    expect(count(pluginsPage, '<RefreshButton')).toBe(1);
    expect(pluginsPage).toContain("label={t('plugin_management.refresh_plugins')}");
    expect(pluginsPage).not.toContain('IconRefreshCw');

    expect(count(storePage, '<RefreshButton')).toBe(1);
    expect(storePage).toContain("label={t('plugin_store.refresh_registry')}");
    // The remaining refresh glyph belongs to the per-card Update action only.
    expect(count(storePage, '<IconRefreshCw')).toBe(1);
    expect(storePage).toMatch(
      /<IconRefreshCw size=\{iconSize\['14'\]\} \/>\s*\{t\('plugin_store\.update'\)\}/
    );
  });

  test('empty states offer a next step that navigates, never a refresh or an install', () => {
    // From the EmptyState title prop to its self-closing line.
    const emptyState = (page: string, key: string) =>
      page.match(new RegExp(`title=\\{t\\('${key}'\\)\\}[\\s\\S]*?\\n\\s*/>`))?.[0];

    const storeEmpty = emptyState(storePage, 'plugin_store\\.no_plugins');
    expect(storeEmpty).toBeDefined();
    expect(storeEmpty).toContain('to={PLUGIN_STORE_SOURCES_CONFIG_PATH}');
    expect(storeEmpty).toContain("t('plugin_store.review_sources')");

    const pluginsEmpty = emptyState(pluginsPage, 'plugin_management\\.no_plugins');
    expect(pluginsEmpty).toBeDefined();
    expect(pluginsEmpty).toContain('to="/plugin-store"');
    expect(pluginsEmpty).toContain("t('plugin_management.browse_store')");

    for (const empty of [storeEmpty, pluginsEmpty]) {
      expect(empty).not.toContain('RefreshButton');
      expect(empty).not.toContain('onClick');
    }
    expect(PLUGIN_STORE_SOURCES_CONFIG_PATH).toBe('/config?field=pluginStoreSources');
    expect(findConfigFieldById('pluginStoreSources')).toBeDefined();
  });

  test('a search with no matches says so instead of claiming the directory is empty', () => {
    expect(pluginsPage).toContain("t('plugin_management.no_matches')");
    expect(pluginsPage).toContain("t('plugin_management.clear_search')");
  });

  test('store keeps the third-party trust warning prominent and separate from calm notices', () => {
    const trustIndex = storePage.indexOf('<PluginTrustNotice />');
    const groupIndex = storePage.indexOf('<PluginNoticeGroup>');
    expect(trustIndex).toBeGreaterThan(-1);
    expect(groupIndex).toBeGreaterThan(trustIndex);
    // Rendered unconditionally: not inside a `&&` or ternary branch.
    expect(storePage).toMatch(/\n\s*<PluginTrustNotice \/>\n/);
    expect(storePage).toMatch(/<PluginNotice>\s*\{t\('plugin_store\.restart_required_banner'/);

    const markup = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n }, createElement(PluginTrustNotice))
    );
    expect(markup).toContain('data-tone="security"');
    expect(markup).toContain('role="note"');
    expect(markup).toContain(i18n.t('plugin_store.security_banner_title'));
    expect(markup).toContain(i18n.t('plugin_store.security_banner_text'));
    // Never dismissible: the notice has no controls of its own.
    expect(markup).not.toContain('<button');
  });
});
