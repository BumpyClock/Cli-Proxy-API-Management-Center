import { describe, expect, mock, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { compileString } from 'sass';
import i18n from '@/i18n';
import type { AuthFileItem } from '@/types';
import { formatDateTimeValue } from '@/utils/format';
import type { AuthFileCardProps } from '@/features/authFiles/components/AuthFileCard';

// Bun loads SCSS modules as strings; the quota host validates class names at import time.
// Same module mock as authFileQuotaZero.test.ts so the shared registry stays consistent.
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
          quotaFilterType: 'all',
          statusBarCache: new Map(),
          onShowModels: noop,
          onDownload: noop,
          onManualRefresh: noop,
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

const cardCss = compileString(
  `@use 'src/styles/variables.scss' as *;\n${readFileSync(
    'src/features/authFiles/components/AuthFileCard.module.scss',
    'utf8'
  )}`,
  {
    url: new URL('../src/features/authFiles/components/AuthFileCard.module.scss', import.meta.url),
    loadPaths: [process.cwd()],
  }
)
  .css.replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');
const compactCss = cardCss.slice(cardCss.indexOf('@media (max-width: 1100px)'));

describe('compact credential card disclosure', () => {
  const markup = renderRow({ email: 'ops@example.test', modified: 1_700_000_000 });

  test('Details is a named disclosure button that controls the file metadata', () => {
    const toggle = markup
      .match(/<button type="button"[^>]*aria-expanded="false"[^>]*>/g)!
      .find((button) => !button.includes('aria-haspopup'));
    expect(toggle).toBeTruthy();
    const controls = toggle!.match(/aria-controls="([^"]+)"/)![1].split(' ');
    expect(controls).toHaveLength(1);
    expect(cell(markup, i18n.t('redesign.authFiles.updated'))).toContain(`id="${controls[0]}"`);

    const name = i18n.t('redesign.authFiles.detailsFor', { name: 'ops@example.test' });
    expect(toggle).toContain(`aria-label="${escapeHtml(name)}"`);
    // Label in name: the accessible name contains the visible "Details" text.
    expect(name).toContain(i18n.t('redesign.authFiles.details'));
  });

  test('the request summary stays visible in the collapsed card instead of being duplicated', () => {
    expect(compactCss).not.toContain('.requestsCell { display: none');
    expect(compactCss).not.toMatch(/:not\(\.rowExpanded\) > \.requestsCell/);
    // One summary per row: no second copy beside status.
    expect(markup.split(i18n.t('redesign.authFiles.requestsNone'))).toHaveLength(2);
  });

  test('retains selection, the enable toggle and every row action in the collapsed card', () => {
    expect(markup).toContain(
      `aria-label="${escapeHtml(i18n.t('auth_files.card_select', { name: 'claude-1.json' }))}"`
    );
    expect(markup).toContain(
      `aria-label="${escapeHtml(i18n.t('auth_files.card_toggle', { name: 'claude-1.json' }))}"`
    );
    for (const key of [
      'models_button',
      'manual_refresh_button',
      'download_button',
      'prefix_proxy_button',
      'delete_button',
    ]) {
      expect(cell(markup, i18n.t('redesign.authFiles.actions'))).toContain(
        i18n.t(`auth_files.${key}`)
      );
    }
  });

  test('collapses only file metadata in the compact layout', () => {
    expect(compactCss).toMatch(/\.row:not\(\.rowExpanded\) > \.detailCell \{ display: none; \}/);
    expect(compactCss).toMatch(/\.detailsToggle \{ display: inline-flex;/);
    const desktopCss = cardCss.slice(0, cardCss.indexOf('@media (max-width: 1100px)'));
    expect(desktopCss).toMatch(/\.detailsToggle \{ display: none; \}/);
    // Identity and toggle first, then status/requests/quota, then actions before the disclosed row.
    const areas = compactCss.match(/grid-template-areas: ([^;]+);/)![1];
    expect(areas.indexOf('credential')).toBeLessThan(areas.indexOf('status'));
    expect(areas.indexOf('toggle')).toBeLessThan(areas.indexOf('status'));
    expect(areas.indexOf('requests')).toBeLessThan(areas.indexOf('actions'));
    expect(areas.indexOf('actions')).toBeLessThan(areas.indexOf('updated'));
  });
});

describe('row actions menu control', () => {
  const markup = renderRow({ email: 'ops@example.test' });
  const actions = cell(markup, i18n.t('redesign.authFiles.actions'));

  test('the trigger is a visibly labelled menu button with a credential-specific name', () => {
    const trigger = actions.match(/<button[^>]*aria-haspopup="menu"[^>]*>/)![0];
    const name = i18n.t('redesign.authFiles.actionsFor', { name: 'ops@example.test' });
    expect(trigger).toContain(`aria-label="${escapeHtml(name)}"`);
    expect(trigger).toContain('aria-expanded="false"');
    expect(actions).toContain(`<span>${i18n.t('redesign.authFiles.actions')}</span>`);
    expect(name).toContain(i18n.t('redesign.authFiles.actions'));
    expect(actions).not.toContain('<details');
    expect(cardCss).toMatch(/\.actionsTrigger \{[^}]*border: 1px solid/);
  });

  test('the menu floats instead of stretching the actions column, and closes predictably', () => {
    expect(cardCss).toMatch(/\.actions \{ position: fixed;/);
    const source = readFileSync('src/features/authFiles/components/AuthFileCard.tsx', 'utf8');
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain("document.addEventListener('pointerdown', handlePointerDown)");
    expect(source).toContain('triggerRef.current?.focus()');
  });
});

describe('quota cell states', () => {
  test('an unchecked supported quota says so in muted type with a details chevron', () => {
    const quota = cell(renderRow({}), i18n.t('redesign.authFiles.quota'));
    const summary = quota.split('<summary')[1].split('</summary>')[0];
    expect(summary).toContain(i18n.t('redesign.authFiles.quotaNotChecked'));
    expect(summary).toContain('class="summaryMuted"');
    expect(summary).toContain('class="summaryChevron"');
  });

  test('a provider without quota reporting shows plain "Not reported" text', () => {
    const quota = cell(renderRow({ type: 'gemini' }), i18n.t('redesign.authFiles.quota'));
    expect(quota).not.toContain('<summary');
    expect(quota).toContain(i18n.t('redesign.authFiles.notReported'));
  });
});

describe('updated column and request mini-bars', () => {
  test('formats the modification time on one line with the exact instant as its title', () => {
    const markup = renderRow({ modified: 1_700_000_000 });
    const updated = cell(markup, i18n.t('redesign.authFiles.updated'));
    expect(updated).toContain(
      '<time dateTime="2023-11-14T22:13:20.000Z" title="2023-11-14T22:13:20.000Z"'
    );
    expect(updated).toContain(formatDateTimeValue(1_700_000_000, i18n.language));
    // No orphaned "-" placeholder for an unreported file size.
    expect(updated).not.toMatch(/>-</);
    expect(updated).not.toContain(i18n.t('auth_files.file_size'));
  });

  test('labels a reported size and states an unreported modification time', () => {
    const markup = renderRow({ size: 2048 });
    const updated = cell(markup, i18n.t('redesign.authFiles.updated'));
    expect(updated).toContain(i18n.t('auth_files.file_size'));
    expect(updated).toContain(i18n.t('redesign.authFiles.notReported'));
  });

  test('idle rows show one muted value; the window stays in the title and accessible text', () => {
    const idle = cell(renderRow({}), i18n.t('auth_files.card_requests'));
    const windowText = i18n.t('redesign.authFiles.recentNone', { minutes: 200 });
    expect(idle).toContain(i18n.t('redesign.authFiles.requestsNone'));
    expect(idle).toContain(`title="${windowText}"`);
    // Visible short value is hidden from AT; the full window is read instead.
    expect(idle).toContain(
      `<span aria-hidden="true">${i18n.t('redesign.authFiles.requestsNone')}</span>`
    );
    expect(idle).toContain(`<span>${windowText}</span>`);
    expect(idle).not.toContain('statusBlocks');
    expect(idle).not.toContain(i18n.t('stats.success'));

    const busy = cell(
      renderRow({ successCount: 12, failureCount: 1, recentRequests: [{ success: 3, failed: 1 }] }),
      i18n.t('auth_files.card_requests')
    );
    expect(busy).toContain(i18n.t('redesign.authFiles.requestsOk', { count: 12 }));
    expect(busy).toContain(i18n.t('redesign.authFiles.requestsFailed', { count: 1 }));
    expect(busy).toContain(i18n.t('redesign.authFiles.recentRate', { minutes: 200 }));
    expect(busy).toContain('75%');
  });
});
