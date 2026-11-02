import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { QuotaOverview } from '@/features/quota/components/QuotaOverview';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';

const entries: QuotaFileEntry[] = [
  { type: 'claude', file: { name: 'private-email@example.invalid.json', type: 'claude' } },
  { type: 'claude', file: { name: 'not-loaded.json', type: 'claude' } },
];
const render = (quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined) =>
  renderToStaticMarkup(
    createElement(QuotaOverview, {
      entries,
      quotaFor,
      resolvedTheme: 'dark',
      disabled: false,
      onRefresh: () => {},
      children: createElement('div', null, 'Account-only details'),
    })
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
    expect(markup).toContain('100%');
    expect(markup).toMatch(/1<!-- --> \/ <!-- -->2|1 \/ 2/);
    expect(markup).toContain('role="img"');
    expect(markup).toContain(i18n.t('quota_management.pool_no_history'));
    expect(markup).toContain(i18n.t('quota_management.pool_no_usage'));
    expect(markup).not.toContain('private-email@example.invalid');
    expect(markup).not.toContain('Account-only details');
    expect(markup).not.toContain('NaN');
    expect(markup).not.toContain('quota_management.');
  });

  test('unloaded providers offer refresh and account details instead of zero capacity', () => {
    const markup = render(() => undefined);
    expect(markup).not.toContain('role="img"');
    expect(markup).toContain(renderToStaticMarkup(i18n.t('quota_management.pool_load_prompt')));
    expect(markup).toContain(i18n.t('quota_management.pool_account_details'));
    expect(markup).toContain('<strong>—</strong>');
    expect(markup).not.toContain('<strong>0%</strong>');
  });

  test('every new overview translation is present in all four locales', () => {
    const keys = Object.keys(i18n.getResourceBundle('en', 'translation').quota_management).filter(
      (key) => key.startsWith('pool_')
    );
    expect(keys.length).toBeGreaterThan(20);
    for (const language of ['en', 'zh-CN', 'zh-TW', 'ru']) {
      const section = i18n.getResourceBundle(language, 'translation').quota_management;
      for (const key of keys) expect(typeof section[key]).toBe('string');
    }
  });
});
