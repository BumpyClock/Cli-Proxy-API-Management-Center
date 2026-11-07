import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import en from '../src/i18n/locales/en.json';
import zhCN from '../src/i18n/locales/zh-CN.json';
import zhTW from '../src/i18n/locales/zh-TW.json';
import ru from '../src/i18n/locales/ru.json';

mock.module('../src/pages/LogsPage.module.scss', () => ({
  default: new Proxy({}, { get: (_, key) => String(key) }),
}));

const { ActiveLogFilters, LogsOptions } = await import('../src/pages/LogsPage');

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const noop = () => {};
const renderOptions = (overrides: Partial<Parameters<typeof LogsOptions>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(LogsOptions, {
      open: false,
      onOpenChange: noop,
      triggerRef: createRef<HTMLButtonElement>(),
      display: { hideManagementLogs: true, showRawLogs: false, wrapLogs: false },
      onHideManagementLogsChange: noop,
      onShowRawLogsChange: noop,
      onWrapLogsChange: noop,
      fullscreen: false,
      downloadDisabled: false,
      clearDisabled: false,
      onDownload: noop,
      onEnterFullscreen: noop,
      onClear: noop,
      ...overrides,
    })
  );

const triggerOf = (html: string) =>
  html.match(/<button[^>]*aria-controls="logs-options-panel"[^>]*>/)?.[0];
const panelOf = (html: string) => html.slice(html.indexOf('id="logs-options-panel"'));
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('display state shown on the Options trigger', () => {
  test('counts only switches that differ from their defaults', () => {
    const countOf = (hideManagementLogs: boolean, showRawLogs: boolean) =>
      renderOptions({ display: { hideManagementLogs, showRawLogs, wrapLogs: false } }).match(
        /<span class="filterPanelCount" aria-hidden="true">(\d+)<\/span>/
      )?.[1] ?? '0';
    expect(countOf(true, false)).toBe('0');
    expect(countOf(false, false)).toBe('1');
    expect(countOf(true, true)).toBe('1');
    expect(countOf(false, true)).toBe('2');
  });

  test('closed trigger has a visible label and announces changed settings', () => {
    const defaults = renderOptions();
    expect(triggerOf(defaults)).toContain('aria-expanded="false"');
    expect(textOf(defaults)).toStartWith('Options');
    expect(defaults).not.toContain('setting changed');

    const changed = renderOptions({
      display: { hideManagementLogs: true, showRawLogs: true, wrapLogs: false },
    });
    expect(changed).toContain('<span class="filterPanelCount" aria-hidden="true">1</span>');
    expect(changed).toContain('1 setting changed');
  });
});

describe('Options disclosure', () => {
  test('trigger controls a labelled region that is hidden until opened', () => {
    const closed = renderOptions();
    expect(closed).toMatch(
      /id="logs-options-panel"[^>]*role="region"[^>]*aria-label="Options"[^>]*hidden=""/
    );

    const open = renderOptions({ open: true });
    expect(triggerOf(open)).toContain('aria-expanded="true"');
    expect(open).not.toMatch(/id="logs-options-panel"[^>]*hidden/);
  });

  test('holds the display switches and routine actions as real controls', () => {
    const panel = panelOf(renderOptions({ open: true }));
    expect(panel.match(/role="switch"/g)).toHaveLength(3);
    expect(panel).toContain('aria-label="Log display options"');
    expect(panel).toContain('aria-label="Log actions"');
    expect(textOf(panel)).toContain('Hide /v0/management logs');
    expect(textOf(panel)).toContain('Show raw logs');
    expect(textOf(panel)).toContain('Download');
    expect(textOf(panel)).toContain('Full screen');
    expect(panel).not.toMatch(/role="menu|role="menuitem/);
  });

  test('Clear logs is last, behind a divider, labelled and danger-outline', () => {
    const panel = panelOf(renderOptions({ open: true }));
    const danger = panel.slice(panel.indexOf('<div class="optionsDanger"'));
    expect(panel.indexOf('class="optionsDanger"')).toBeGreaterThan(panel.indexOf('Download'));
    expect(danger).toMatch(/<button class="btn btn-danger-outline[^"]*"[^>]*>/);
    expect(textOf(danger)).toBe('Clear logs');
  });

  test('full screen leaves the panel while the visible exit button owns that action', () => {
    expect(textOf(panelOf(renderOptions({ open: true, fullscreen: true })))).not.toContain(
      'Full screen'
    );
  });

  test('disabled states pass through to the actions', () => {
    const panel = panelOf(
      renderOptions({ open: true, downloadDisabled: true, clearDisabled: true })
    );
    expect(panel.match(/<button [^>]*disabled=""/g)).toHaveLength(2);
  });
});

describe('active filter summary', () => {
  const renderSummary = (methods: string[], statuses: string[], paths: string[]) =>
    renderToStaticMarkup(
      createElement(ActiveLogFilters, {
        methods,
        statuses,
        paths,
        onRemove: noop,
        onClear: noop,
      } as Parameters<typeof ActiveLogFilters>[0])
    );

  test('renders nothing when no structured filter is active', () => {
    expect(renderSummary([], [], [])).toBe('');
  });

  test('lists active filters in panel order, whatever order they were chosen in', () => {
    const html = renderSummary(['POST', 'GET'], ['5xx', '2xx'], ['/v1/models']);
    const names = [...html.matchAll(/aria-label="Remove filter ([^"]+)"/g)].map(([, name]) => name);
    expect(names).toEqual(['GET', 'POST', '2xx', '5xx', '/v1/models']);
  });

  test('shows a count, one named remove button per filter and a clear action', () => {
    const html = renderSummary(['POST'], ['4xx'], []);
    expect(html).toContain('role="group" aria-label="Active filters"');
    expect(textOf(html)).toStartWith('2 filters');
    expect(textOf(html)).toEndWith('Clear Filters');
    // Remove buttons are plain actions, not toggles.
    expect(html).not.toContain('aria-pressed');
  });
});

test('new labels exist in every locale, including plural forms', () => {
  for (const locale of [en, zhCN, zhTW, ru] as Array<{ logs: Record<string, string> }>) {
    for (const key of [
      'options_button',
      'refresh_error_logs',
      'tabs_label',
      'active_filters_label',
      'remove_filter',
      'options_changed_count_other',
      'active_filters_count_other',
    ]) {
      expect(locale.logs[key]?.length ?? 0).toBeGreaterThan(0);
    }
  }
  expect(ru.logs.active_filters_count_few).toContain('{{count}}');
  expect(en.logs.options_changed_count_one).toContain('{{count}}');
});
