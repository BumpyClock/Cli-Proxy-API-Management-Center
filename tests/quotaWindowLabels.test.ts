import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import en from '../src/i18n/locales/en.json';
import zhCN from '../src/i18n/locales/zh-CN.json';
import zhTW from '../src/i18n/locales/zh-TW.json';
import ru from '../src/i18n/locales/ru.json';
import { QuotaOverview } from '../src/features/quota/components/QuotaOverview';
import { classifyQuotaFiles } from '../src/features/quota/logic';
import type { QuotaCardState } from '../src/features/quota/providers';
import type { ClaudeQuotaState, CopilotQuotaState, MetaQuotaState } from '../src/types';

const reset = Date.UTC(2100, 0, 2);
const literalLabel = 'Provider allowance.reset <literal> & unchanged';
const entries = classifyQuotaFiles([
  { name: 'meta-fixture', provider: 'meta' },
  { name: 'copilot-fixture', provider: 'github-copilot' },
  { name: 'literal-fixture', provider: 'claude' },
]);
const metaSnapshot: MetaQuotaState = {
  status: 'success',
  data: { windows: [{ id: 'weekly', usedPercent: 25, resetAt: reset / 1000 }] },
};
const copilotSnapshot: CopilotQuotaState = {
  status: 'success',
  data: {
    plan: 'individual',
    resetAtMs: reset,
    resources: [
      {
        id: 'premium_interactions',
        remainingPercent: 60,
        remaining: 60,
        entitlement: 100,
        unlimited: false,
      },
    ],
  },
};
const claudeSnapshot: ClaudeQuotaState = {
  status: 'success',
  windows: [
    {
      id: 'weekly',
      label: literalLabel,
      usedPercent: 50,
      resetLabel: '',
      resetAtMs: reset,
      periodHours: 168,
    },
  ],
};
const snapshots: Record<string, QuotaCardState> = {
  meta: metaSnapshot,
  'github-copilot': copilotSnapshot,
  claude: claudeSnapshot,
};
const locales = [
  { language: 'en', bundle: en, meta: 'Weekly quota', copilot: 'Premium interactions' },
  { language: 'zh-CN', bundle: zhCN, meta: '每周额度', copilot: '高级交互' },
  { language: 'zh-TW', bundle: zhTW, meta: '每週額度', copilot: '進階互動' },
  { language: 'ru', bundle: ru, meta: 'Недельная квота', copilot: 'Премиум-взаимодействия' },
];

describe('quota account list window labels from production locales', () => {
  for (const { language, bundle, meta, copilot } of locales) {
    test(`Meta and Copilot keys resolve in ${language}; upstream literal labels survive`, async () => {
      // No shared singleton, staging fragments or cross-language fallback can mask a missing key.
      const i18n = createInstance();
      await i18n.init({
        lng: language,
        fallbackLng: false,
        resources: { [language]: { translation: bundle } },
        interpolation: { escapeValue: false },
      });
      const markup = renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(QuotaOverview, {
            entries,
            quotaFor: (entry) => snapshots[entry.type],
            resolvedTheme: 'light',
            disabled: false,
            canObserve: () => true,
            onRefresh: () => {},
            children: null,
          })
        )
      );
      // Each row of the account list names its provider window next to the provider.
      const list = markup.match(/<ul[^>]*id="quota-accounts-list"[\s\S]*?<\/ul>/)?.[0] ?? '';
      const rows = list.match(/<li[\s\S]*?<\/li>/g) ?? [];
      expect(rows).toHaveLength(3);
      const texts = rows.map((row) => row.replace(/<[^>]+>/g, ''));
      expect(texts.some((text) => text.includes(` · ${meta} · `))).toBe(true);
      expect(texts.some((text) => text.includes(` · ${copilot} · `))).toBe(true);
      const literal = renderToStaticMarkup(createElement('span', null, literalLabel));
      expect(texts.some((text) => text.includes(` · ${literal.slice(6, -7)} · `))).toBe(true);
      expect(markup).not.toContain('meta_quota.weekly');
      expect(markup).not.toContain('copilot_quota.premium_interactions');
      expect(markup).not.toContain('redesign.quota.');
      expect(markup).not.toContain('quota_management.');
      expect(markup).not.toContain('{{');
      // Exact values stay in the chart's collapsed data table, not a second scrolling table.
      expect(markup).not.toContain('<table');
    });
  }
});
