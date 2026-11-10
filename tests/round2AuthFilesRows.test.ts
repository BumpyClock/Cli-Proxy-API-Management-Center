import { describe, expect, mock, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { compileString } from 'sass';
import i18n from '@/i18n';
import type { AuthFileItem } from '@/types';
import type { AuthFileCardProps } from '@/features/authFiles/components/AuthFileCard';
import { summarizeRequestActivity } from '@/features/authFiles/logic';
import { menuFocusTarget } from '@/utils/menuFocus';
import { AuthFilesSectionNav } from '@/features/authFiles/components/AuthFilesSectionNav';
import { activeAuthFilesSection } from '@/features/authFiles/sections';
import { statusBarDataFromRecentRequests } from '@/utils/recentRequests';

// Same quota-module mock as the round-1 card tests so the shared registry stays consistent.
mock.module('../src/features/authFiles/components/AuthFileQuota.module.scss', () => ({
  default: new Proxy({}, { get: (_, key) => String(key) }),
}));
const { AuthFileCard } = await import('@/features/authFiles/components/AuthFileCard');

const noop = () => {};
const renderRow = (file: Partial<AuthFileItem>, overrides: Partial<AuthFileCardProps> = {}) =>
  renderToStaticMarkup(
    createElement(
      'table',
      null,
      createElement(
        'tbody',
        null,
        createElement(AuthFileCard, {
          file: { name: 'claude-1.json', type: 'claude', ...file } as AuthFileItem,
          compact: false,
          selected: false,
          resolvedTheme: 'light',
          disableControls: false,
          deleting: null,
          statusUpdating: {},
          manualRefreshing: {},
          cooldownResetting: {},
          quotaFilterType: 'all',
          statusBarCache: new Map(),
          onShowModels: noop,
          onDownload: noop,
          onManualRefresh: noop,
          onCooldownReset: noop,
          onOpenPrefixProxyEditor: noop,
          onDelete: noop,
          onToggleStatus: noop,
          onToggleSelect: noop,
          ...overrides,
        })
      )
    )
  );
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const cell = (markup: string, label: string) =>
  markup.split(`data-label="${escapeHtml(label)}"`)[1].split('</td>')[0];
const compiled = (path: string) =>
  compileString(`@use 'src/styles/variables.scss' as *;\n${readFileSync(path, 'utf8')}`, {
    url: new URL(`../${path}`, import.meta.url),
    loadPaths: [process.cwd()],
  })
    .css.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');
const cardCss = compiled('src/features/authFiles/components/AuthFileCard.module.scss');

describe('request activity summary', () => {
  const empty = statusBarDataFromRecentRequests([]);

  test('no totals and an empty window is idle, with the window length kept for the title', () => {
    expect(summarizeRequestActivity({ success: 0, failure: 0 }, empty)).toEqual({
      kind: 'idle',
      windowMinutes: 200,
    });
  });

  test('totals without recent traffic report the figure but no strip', () => {
    expect(summarizeRequestActivity({ success: 12, failure: 1 }, empty)).toEqual({
      kind: 'active',
      success: 12,
      failure: 1,
      windowMinutes: 200,
      windowHasSignal: false,
    });
  });

  test('recent traffic turns the strip on; window totals fill in when counters are absent', () => {
    const busy = statusBarDataFromRecentRequests([{ success: 3, failed: 1 }]);
    expect(summarizeRequestActivity({ success: 0, failure: 0 }, busy)).toMatchObject({
      kind: 'active',
      success: 3,
      failure: 1,
      windowHasSignal: true,
    });
  });
});

describe('requests cell', () => {
  test('idle rows render one short value and no tick strip', () => {
    const requests = cell(renderRow({}), i18n.t('auth_files.card_requests'));
    expect(requests.split(i18n.t('redesign.authFiles.requestsNone'))).toHaveLength(2);
    expect(requests).not.toContain('statusBlock');
    expect(requests).not.toContain(i18n.t('stats.failure'));
  });

  test('totals render as one inline figure; the strip appears only with recent traffic', () => {
    const quiet = cell(
      renderRow({ successCount: 12, failureCount: 1 }),
      i18n.t('auth_files.card_requests')
    );
    expect(quiet).toContain(
      `${i18n.t('redesign.authFiles.requestsOk', { count: 12 })}</span><span aria-hidden="true">·</span>`
    );
    expect(quiet).toContain(i18n.t('redesign.authFiles.requestsFailed', { count: 1 }));
    expect(quiet).toContain(
      `title="${escapeHtml(i18n.t('redesign.authFiles.requestsTotal', { success: 12, failure: 1 }))}"`
    );
    expect(quiet).not.toContain('%');

    const busy = cell(
      renderRow({ successCount: 12, failureCount: 1, recentRequests: [{ success: 4, failed: 0 }] }),
      i18n.t('auth_files.card_requests')
    );
    expect(busy).toContain('100%');
  });

  test('operational values use 13px secondary text', () => {
    expect(cardCss).toMatch(
      /\.requestsFigure, \.requestsIdle \{ font-size: 13px; line-height: 20px; color: var\(--text-secondary\); \}/
    );
    expect(cardCss).toMatch(/\.modified \{ font-size: 13px; color: var\(--text-secondary\); \}/);
    expect(cardCss).not.toMatch(/font-size: 11px; line-height: 1\.4;/);
  });
});

describe('status and enabled state', () => {
  test('a healthy enabled row shows no Enabled chip; the toggle states it', () => {
    const status = cell(renderRow({}), i18n.t('common.status'));
    expect(status).not.toContain(i18n.t('redesign.authFiles.disabled'));
    expect(status).not.toContain(i18n.t('redesign.authFiles.problem'));
    // A plain "No issues" word, not a chip: the column is never blank, exceptions stand out.
    expect(status).toContain(i18n.t('redesign.authFiles.status_ok'));
    expect(status).not.toContain(i18n.t('redesign.authFiles.enabled'));
  });

  test('disabled and problem rows keep a visible chip', () => {
    expect(cell(renderRow({ disabled: true }), i18n.t('common.status'))).toContain(
      i18n.t('redesign.authFiles.disabled')
    );
    expect(cell(renderRow({ unavailable: true }), i18n.t('common.status'))).toContain(
      i18n.t('redesign.authFiles.problem')
    );
  });

  test('healthy cards keep one unlabelled line: the quiet status word and the update time', () => {
    expect(cardCss).toMatch(
      /\.row > \.statusQuiet::before, \.row > \.statusRepeatsSwitch::before, \.row > \.statusRepeatsSwitch \.state \{ display: none; \}/
    );
    expect(cardCss).toMatch(/\.cardUpdated \{ display: none; \}/);
    expect(cardCss).toMatch(/\.rowExpanded \.cardUpdated \{ display: none; \}/);
    const status = cell(
      renderRow({ email: 'ops@example.test', modtime: '2026-11-06T23:34:00Z' }),
      i18n.t('common.status')
    );
    expect(status).toContain(i18n.t('redesign.authFiles.status_ok'));
    expect(status).toContain('<time dateTime="2026-11-06T23:34:00.000Z"');
    expect(status).toContain(i18n.t('redesign.authFiles.updated'));
  });
});

describe('compact desktop row', () => {
  test('row padding and a one-line provider/file subline keep rows near 64-80px', () => {
    expect(cardCss).toMatch(/\.row > td \{ padding: 12px;/);
    expect(cardCss).toMatch(/\.subline \{ display: flex; align-items: center; flex-wrap: wrap;/);
    const markup = renderRow({ email: 'ops@example.test' });
    const credential = cell(markup, i18n.t('redesign.authFiles.credential'));
    expect(credential.indexOf('<h3')).toBeLessThan(credential.indexOf('claude-1'));
    expect(credential).toMatch(/<p><span aria-hidden="true"[^>]*>[^<]+<\/span><span title=/);
  });
});

describe('row actions menu', () => {
  const markup = renderRow({ email: 'ops@example.test' });
  const actions = cell(markup, i18n.t('redesign.authFiles.actions'));

  test('one labelled menu button at every width with closed menu semantics', () => {
    const trigger = actions.match(/<button[^>]*aria-haspopup="menu"[^>]*>/)![0];
    expect(trigger).toContain('aria-expanded="false"');
    expect(trigger).not.toContain('aria-controls');
    expect(actions).toMatch(/<div[^>]*role="menu"[^>]*hidden=""/);
    // Visible text at both widths; no kebab-only or desktop-only variant.
    expect(cardCss).not.toContain('rowActionsKebab');
    expect(cardCss).not.toContain('rowActionsText');
  });

  test('menu items are flat menuitems managed by roving focus', () => {
    const items = actions.match(/<button[^>]*role="menuitem"[^>]*>/g) ?? [];
    expect(items).toHaveLength(5);
    for (const item of items) expect(item).toContain('tabindex="-1"');
    expect(actions).toContain('role="separator"');
  });

  test('roving focus wraps and supports Home/End', () => {
    expect(menuFocusTarget('ArrowDown', -1, 5)).toBe(0);
    expect(menuFocusTarget('ArrowDown', 4, 5)).toBe(0);
    expect(menuFocusTarget('ArrowUp', 0, 5)).toBe(4);
    expect(menuFocusTarget('ArrowUp', -1, 5)).toBe(4);
    expect(menuFocusTarget('Home', 3, 5)).toBe(0);
    expect(menuFocusTarget('End', 0, 5)).toBe(4);
    expect(menuFocusTarget('Enter', 0, 5)).toBeNull();
    expect(menuFocusTarget('ArrowDown', -1, 0)).toBeNull();
  });

  test('phone triggers and items reach 44px', () => {
    const compact = cardCss.slice(cardCss.indexOf('@media (max-width: 1100px)'));
    expect(compact).toMatch(/\.actionsTrigger, \.detailsToggle \{ min-height: 44px;/);
    expect(compact).toMatch(/\.actions :global\(\.btn\) \{ min-height: 44px; \}/);
    expect(cardCss).toMatch(
      /\.selectCell > label::after \{ content: ""; position: absolute; inset: -11px; \}/
    );
  });
});

describe('section navigation', () => {
  test('editor sub-routes resolve to their section for the phone select', () => {
    expect(activeAuthFilesSection('/auth-files')).toBe('/auth-files');
    expect(activeAuthFilesSection('/auth-files/oauth-excluded')).toBe('/auth-files/oauth-excluded');
    expect(activeAuthFilesSection('/auth-files/oauth-model-alias/x')).toBe(
      '/auth-files/oauth-model-alias'
    );
  });

  test('the select shows the current section and navigates to the same routes', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/auth-files/oauth-model-alias'] },
        createElement(AuthFilesSectionNav)
      )
    );
    expect(markup).toMatch(/<option value="\/auth-files\/oauth-model-alias" selected="">/);
    const hrefs = [...markup.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    const values = [...markup.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    expect(values).toEqual(hrefs);
    expect(markup).toMatch(
      new RegExp(`<label for="[^"]+">${i18n.t('redesign.authFiles.section')}</label>`)
    );
  });

  test('phones swap the underline tabs for the select; desktop keeps the tabs', () => {
    const css = compiled('src/features/authFiles/components/AuthFilesSectionNav.module.scss');
    const desktop = css.slice(0, css.indexOf('@media (max-width: 768px)'));
    expect(desktop).toMatch(/\.picker \{ display: none; \}/);
    expect(css).toMatch(
      /@media \(max-width: 768px\) \{ \.subnav \{ display: none; \} \.picker \{ display: flex;/
    );
  });
});
