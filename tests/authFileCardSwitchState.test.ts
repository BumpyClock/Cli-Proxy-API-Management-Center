import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileString } from 'sass';
import i18n from '@/i18n';
import type { AuthFileItem } from '@/types';
import type { AuthFileCardProps } from '@/features/authFiles/components/AuthFileCard';

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
const toggleCell = (markup: string) =>
  markup.split(`data-label="${i18n.t('auth_files.status_toggle_label')}"`)[1].split('</td>')[0];
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

describe('credential card switch state', () => {
  test('the switch cell names the actual state in words beside a still-named switch', () => {
    const enabled = toggleCell(renderRow({}));
    expect(enabled).toContain(`aria-hidden="true">${i18n.t('redesign.authFiles.enabled')}</span>`);
    expect(enabled).toContain('role="switch"');
    expect(enabled).toContain('checked=""');
    expect(enabled).toContain(
      `aria-label="${i18n.t('auth_files.card_toggle', { name: 'claude-1.json' })}"`
    );

    const disabled = toggleCell(renderRow({ disabled: true }));
    expect(disabled).toContain(
      `aria-hidden="true">${i18n.t('redesign.authFiles.disabled')}</span>`
    );
    expect(disabled).not.toContain('checked=""');
  });

  test('selection stays a separate checkbox with its own name', () => {
    const markup = renderRow({});
    const select = markup
      .split(`data-label="${i18n.t('redesign.authFiles.select')}"`)[1]
      .split('</td>')[0];
    expect(select).toContain('type="checkbox"');
    expect(select).not.toContain('role="switch"');
    expect(select).toContain(i18n.t('auth_files.card_select', { name: 'claude-1.json' }));
    expect(toggleCell(markup)).not.toContain(
      i18n.t('auth_files.card_select', { name: 'claude-1.json' })
    );
  });

  test('the state word is for the card layout; the desktop column header names the column', () => {
    const desktop = cardCss.slice(0, cardCss.indexOf('@media (max-width: 1100px)'));
    expect(desktop).toMatch(/\.toggleState \{[^}]*display: none;/);
    const cards = cardCss.slice(cardCss.indexOf('@media (max-width: 1100px)'));
    expect(cards).toMatch(/\.toggleState \{[^}]*display: block;[^}]*font-size: 12px;/);
  });

  test('cards skip a status row that would only repeat "Disabled"', () => {
    const source = readFileSync('src/features/authFiles/components/AuthFileCard.tsx', 'utf8');
    expect(source).toMatch(
      /const statusRepeatsSwitch =\s*!isRuntimeOnly && file\.disabled === true && !showWarning && !hasCooldownContent;/
    );
    expect(cardCss).toMatch(/\.row > \.statusRepeatsSwitch \.state \{ display: none; \}/);
  });

  test('runtime-only credentials have no switch and no state word', () => {
    const cell = toggleCell(renderRow({ runtime_only: true } as Partial<AuthFileItem>));
    expect(cell).not.toContain('role="switch"');
    expect(cell).not.toContain(i18n.t('redesign.authFiles.enabled'));
  });
});

describe('NativeSelect stacked layout', () => {
  test('consumers ask for label-above-select instead of overriding its internals', () => {
    const select = readFileSync('src/components/ui/NativeSelect.tsx', 'utf8');
    expect(select).toContain("layout === 'stacked' ? styles.stacked : ''");
    for (const path of [
      'src/features/authFiles/components/AuthFilesSectionNav.tsx',
      'src/features/authFiles/components/ProviderTabs.tsx',
    ]) {
      expect(readFileSync(path, 'utf8'), path).toContain('layout="stacked"');
    }
    const page = readFileSync('src/features/authFiles/AuthFilesPage.module.scss', 'utf8');
    expect(page).not.toMatch(/\.pickers > div/);
    const css = compileString(
      `@use 'src/styles/variables.scss' as *;\n${readFileSync('src/components/ui/NativeSelect.module.scss', 'utf8')}`,
      { loadPaths: [process.cwd()] }
    ).css.replace(/\s+/g, ' ');
    expect(css).toMatch(/\.stacked \{ flex-direction: column; align-items: stretch;/);
  });
});
