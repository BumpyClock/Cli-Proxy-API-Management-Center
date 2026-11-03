import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createTestI18n, localeParityIssues, productionLocales } from './helpers/locales';
import { QuotaOverview } from '@/features/quota/components/QuotaOverview';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';

const i18n = await createTestI18n();

const entries: QuotaFileEntry[] = [
  { type: 'claude', file: { name: 'private-email@example.invalid.json', type: 'claude' } },
  { type: 'claude', file: { name: 'not-loaded.json', type: 'claude' } },
];
const render = (
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined,
  canObserve: (entry: QuotaFileEntry) => boolean = () => true
) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(QuotaOverview, {
        entries,
        quotaFor,
        resolvedTheme: 'dark',
        disabled: false,
        canObserve,
        onRefresh: () => {},
        children: createElement('div', null, 'Account-only details'),
      })
    )
  );

describe('quota overview rendering', () => {
  test('shows measured coverage, labelled reset assumptions, and an accessible chart', () => {
    const markup = render((entry) =>
      entry === entries[0]
        ? {
            status: 'success',
            windows: [
              {
                label: 'Weekly',
                usedPercent: 25,
                resetAtMs: Date.now() + 86_400_000,
                periodHours: 168,
              },
            ],
          }
        : undefined
    );
    expect(markup).toContain('75%');
    expect(markup).toContain('<table');
    expect(markup).toContain('scope="row"');
    expect(markup).toContain(i18n.t('redesign.quota.evidence'));
    expect(markup).toContain(i18n.t('redesign.quota.independent'));
    expect(markup).toContain('private-email@example.invalid');
    expect(markup).toContain('Account-only details');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).not.toContain('NaN');
    expect(markup).not.toContain('quota_management.');
  });

  test('unloaded providers offer refresh and account details instead of zero capacity', () => {
    const markup = render(() => undefined);
    expect(markup).toContain(renderToStaticMarkup(i18n.t('quota_management.pool_no_window')));
    expect(markup).toContain(i18n.t('quota_management.pool_account_details'));
    expect(markup).toContain(i18n.t('quota_management.pool_unknown'));
    expect(markup).not.toContain('<strong>0%</strong>');
  });

  test('unsupported observations disable only their account refresh control', () => {
    const markup = render(
      () => undefined,
      (entry) => entry === entries[1]
    );
    const rows = markup.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
    const unsupported = rows.find((row) => row.includes('private-email@example.invalid'));
    const supported = rows.find((row) => row.includes('not-loaded'));
    expect(unsupported).toContain('disabled=""');
    expect(supported).toBeDefined();
    expect(supported).not.toContain('disabled=""');
  });

  test('shipped overview and chart translations have key and interpolation parity', () => {
    const keys = Object.keys(productionLocales.en.quota_management).filter((key) =>
      key.startsWith('pool_')
    );
    expect(keys.length).toBeGreaterThan(20);
    expect(
      localeParityIssues(productionLocales, [
        'redesign.quota',
        'redesign.chart',
        ...keys.map((key) => `quota_management.${key}`),
      ])
    ).toEqual([]);
  });
});
