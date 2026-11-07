import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { CODEX_CONFIG, normalizeCodexAccountCredits } from '@/features/quota/providers/codex/data';
import { CodexQuotaBody } from '@/features/quota/providers/codex/CodexQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import { apiCallApi, type ApiCallRequest } from '@/services/api';
import { CODEX_RATE_LIMIT_RESET_CREDITS_URL, CODEX_USAGE_URL } from '@/utils/quota';
import type { CodexQuotaState } from '@/types';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();
await i18n.changeLanguage('en');
i18n.addResources('en', 'translation', {
  'codex_quota.credit_balance_label': 'Credit balance',
  'codex_quota.credit_unlimited': 'Unlimited',
});
const t = i18n.t.bind(i18n);
const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'codex-credit-test'
);
const originalRequest = apiCallApi.request;

afterEach(() => {
  apiCallApi.request = originalRequest;
});

function render(quota: CodexQuotaState) {
  return renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(CodexQuotaBody, { quota, classes }))
  );
}

describe('Codex account credits', () => {
  test('keeps finite nonnegative balances, including zero and decimal precision', () => {
    for (const [balance, expected] of [
      [0, '0'],
      [12.5, '12.5'],
      [' 0012.3400 ', '0012.3400'],
    ] as const) {
      expect(normalizeCodexAccountCredits({ balance })).toEqual({
        balance: expected,
        unlimited: false,
      });
    }
  });

  test('ignores malformed credits and requires an explicit unlimited boolean', () => {
    for (const credits of [undefined, null, [], 'credits', 0]) {
      expect(normalizeCodexAccountCredits(credits)).toEqual({ balance: null, unlimited: false });
    }
    for (const balance of [
      '',
      ' ',
      '-1',
      'NaN',
      'Infinity',
      '<b>5</b>',
      true,
      {},
      -1,
      NaN,
      Infinity,
    ]) {
      expect(normalizeCodexAccountCredits({ balance, unlimited: 'true' })).toEqual({
        balance: null,
        unlimited: false,
      });
    }
    expect(normalizeCodexAccountCredits({ unlimited: true })).toEqual({
      balance: null,
      unlimited: true,
    });
  });

  test('reads credits from the existing usage response without new endpoints or writes', async () => {
    const requests: ApiCallRequest[] = [];
    apiCallApi.request = async (request) => {
      requests.push(request);
      const body =
        request.url === CODEX_USAGE_URL
          ? {
              credits: { balance: '42.125', unlimited: true },
              rate_limit: {
                primary_window: {
                  used_percent: 100,
                  reset_at: Date.UTC(2099, 0, 8) / 1000,
                  limit_window_seconds: 604800,
                },
              },
            }
          : { available_count: 2, credits: [] };
      return { statusCode: 200, header: {}, body, bodyText: JSON.stringify(body) };
    };

    const data = await CODEX_CONFIG.fetchQuota({ name: 'codex.json', auth_index: 'fixture' }, t);
    const state = CODEX_CONFIG.buildSuccessState(data);

    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: 'GET', url: CODEX_USAGE_URL },
      { method: 'GET', url: CODEX_RATE_LIMIT_RESET_CREDITS_URL },
    ]);
    expect(state).toMatchObject({ creditBalance: '42.125', creditsUnlimited: true });
    expect(CODEX_CONFIG.getObservations(state).windows).toMatchObject([
      { id: 'weekly', remainingPercent: 0, unlimited: false },
    ]);
    expect(state.rateLimitResetCreditsAvailableCount).toBe(2);
  });

  test('renders zero balance without a plan and keeps manual resets distinct', () => {
    const markup = render({
      status: 'success',
      windows: [],
      creditBalance: '0',
      rateLimitResetCreditsAvailableCount: 3,
    });
    expect(markup).toContain('Credit balance');
    expect(markup).toMatch(/codexPlanValue[^>]*>0<\/span>/);
    expect(markup).toContain('Manual resets');
    expect(markup).toMatch(/codexPlanValue[^>]*>3<\/span>/);
    expect(markup).not.toContain('Unlimited');
  });

  test('renders unlimited credits without claiming unlimited quota windows', () => {
    const markup = render({
      status: 'success',
      windows: [],
      creditBalance: '12',
      creditsUnlimited: true,
    });
    expect(markup).toContain('Credit balance');
    expect(markup).toContain('Unlimited');
    expect(markup).not.toMatch(/codexPlanValue[^>]*>12<\/span>/);
    expect(markup).toContain('No quota data available');
    expect(markup).not.toContain('100%');
  });

  test('omits the credit row when credits are not reported', () => {
    const markup = render({ status: 'success', windows: [] });
    expect(markup).not.toContain('Credit balance');
    expect(markup).not.toContain('Unlimited');
  });
});
