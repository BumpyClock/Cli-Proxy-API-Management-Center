import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';

const source = (path: string) => readFileSync(path, 'utf8');
/** The JSX passed to `<PageHeader actions={...}>`, up to the header's closing `/>`. */
const headerActions = (page: string) => {
  const header = page.slice(page.indexOf('<PageHeader'));
  return header.slice(header.indexOf('actions={'), header.search(/\n\s*\/>/));
};

describe('page header action slot', () => {
  test('Plugins and Plugin Store refresh from the page header, not the toolbar', () => {
    const plugins = source('src/features/plugins/PluginsPage.tsx');
    const store = source('src/features/plugins/PluginStorePage.tsx');
    expect(headerActions(plugins)).toContain("label={t('plugin_management.refresh_plugins')}");
    expect(headerActions(plugins)).toContain('onClick={() => void loadPlugins()}');
    expect(headerActions(store)).toContain("label={t('plugin_store.refresh_registry')}");
    expect(headerActions(store)).toContain('onClick={() => void loadStore()}');
    for (const page of [plugins, store]) {
      const toolbar = page.slice(page.indexOf('className={styles.toolbar}'));
      expect(toolbar.slice(0, toolbar.indexOf('</div>'))).not.toContain('RefreshButton');
    }
  });

  test('System header action carries an icon like the other header buttons', () => {
    const actions = headerActions(source('src/pages/SystemPage.tsx'));
    expect(actions).toMatch(/<Icon\w+ size=\{iconSize\['16'\]\}/);
    expect(actions).toContain("t('system_info.version_check_button')");
  });

  test('Logs keeps its header actions on one row under the title on both tabs', () => {
    const logs = source('src/pages/LogsPage.tsx');
    const css = source('src/components/ui/PageHeader.module.scss');
    expect(logs).toMatch(/<PageHeader[\s\S]{0,200}stackActionsOnPhone/);
    expect(css).toMatch(/\.stackActions \.actions \{\s*flex: 1 1 100%;\s*order: 3;/);
  });
});

describe('logs refresh controls', () => {
  const logs = source('src/pages/LogsPage.tsx');

  test('auto refresh shows its full name at every width', () => {
    expect(logs).not.toContain('auto_refresh_short');
    for (const locale of [en, zhCN, zhTW, ru] as Array<{ logs: Record<string, string> }>) {
      expect(locale.logs.auto_refresh_short).toBeUndefined();
      expect(locale.logs.auto_refresh.length).toBeGreaterThan(0);
    }
  });

  test('full screen keeps the search field and moves refresh and Exit into the toolbar', () => {
    const toolbar = logs.slice(logs.indexOf('<div className={styles.filters}>'));
    const search = toolbar.indexOf("aria-label={t('logs.search_label')}");
    const fullscreenBar = toolbar.indexOf(
      '{fullscreenLogs && (\n                <div className={styles.fullscreenBar}>'
    );
    expect(search).toBeGreaterThan(-1);
    expect(fullscreenBar).toBeGreaterThan(search);
    // Search is not inside a full-screen-only or normal-only branch.
    expect(toolbar.slice(0, search)).not.toMatch(/fullscreenLogs \?/);
    expect(toolbar.slice(fullscreenBar, fullscreenBar + 600)).toContain('{refreshControls}');
    expect(toolbar.slice(fullscreenBar, fullscreenBar + 900)).toContain(
      "t('logs.exit_fullscreen_button')"
    );
  });
});
