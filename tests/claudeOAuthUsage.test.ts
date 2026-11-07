import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { normalizeClaudeUsageSnapshot } from '@/services/api/claudeUsage';
import { apiCallApi, type ApiCallResult } from '@/services/api/apiCall';
import { CLAUDE_CONFIG } from '@/features/quota/providers/claude/data';
import { ClaudeQuotaBody } from '@/features/quota/providers/claude/ClaudeQuotaBody';
import { buildTimelineLane } from '@/features/quota/quotaTimelineModel';
import { nextRecoveryMs, collectQuotaRowInstants } from '@/features/quota/resetSchedule';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import {
  failedSnapshot,
  checkingSnapshot,
  successfulSnapshot,
} from '@/features/quota/snapshotState';
import { selectQuotaWindow } from '@/features/quota/providers/observations';
import { CLAUDE_PROFILE_URL, CLAUDE_USAGE_URL, getStatusFromError } from '@/utils/quota';
import type { ClaudeQuotaState } from '@/types';
import { createTestI18n } from './helpers/locales';
import fixture from './fixtures/claude-oauth-usage.json';

const i18n = await createTestI18n();
const file = { name: 'claude-fixture.json', type: 'claude', authIndex: 'synthetic-index' };
const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'claude-usage-test'
);
const result = (statusCode: number, body: unknown): ApiCallResult => ({
  statusCode,
  header: {},
  body,
  bodyText: JSON.stringify(body),
});
const snapshot = normalizeClaudeUsageSnapshot(fixture)!;
const quota: ClaudeQuotaState = {
  status: 'success',
  windows: [],
  extraUsage: snapshot.extraUsage,
  dollarWindows: snapshot.dollarWindows,
};
const render = (state: ClaudeQuotaState) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(ClaudeQuotaBody, { quota: state, classes })
    )
  );
const originalRequest = apiCallApi.request;
afterEach(() => {
  apiCallApi.request = originalRequest;
});

describe('Claude OAuth usage normalization', () => {
  test('keeps extra-usage minor units separate from discovered dollar balances', () => {
    expect(snapshot.extraUsage).toEqual({
      isEnabled: true,
      monthlyLimit: 5000,
      usedCredits: 1250,
      utilization: 25,
      currency: 'USD',
      disabledReason: null,
      userDisabled: false,
      spendLimitReached: false,
    });
    expect(snapshot.dollarWindows.map((balance) => balance.key)).toEqual([
      'iguana_necktie',
      'additional_credit_balance',
    ]);
    expect(snapshot.dollarWindows[0]).toMatchObject({
      usedDollars: 5.043595,
      remainingDollars: 94.956405,
      limitDollars: 100,
    });
  });

  test('preserves false, zero, null, and numeric strings', () => {
    const normalized = normalizeClaudeUsageSnapshot({
      extra_usage: { is_enabled: false, monthly_limit: '0', used_credits: 0 },
      balance: {
        limit_dollars: '20',
        used_dollars: null,
        remaining_dollars: '0',
        utilization: '100',
        resets_at: null,
      },
    })!;
    expect(normalized.extraUsage).toMatchObject({
      isEnabled: false,
      monthlyLimit: 0,
      usedCredits: 0,
      utilization: null,
    });
    expect(normalized.dollarWindows[0]).toMatchObject({
      limitDollars: 20,
      usedDollars: null,
      remainingDollars: 0,
      utilization: 100,
      resetsAt: null,
    });
  });

  test('does not invent a dollar balance from a partial record or unrelated values', () => {
    expect(normalizeClaudeUsageSnapshot({ arbitrary: { utilization: 99 } })).toBeNull();
    const partial = normalizeClaudeUsageSnapshot({
      five_hour: null,
      incomplete: { remaining_dollars: 10, resets_at: null },
    });
    expect(partial?.dollarWindows).toEqual([]);
    expect(normalizeClaudeUsageSnapshot({ extra_usage: {} })?.extraUsage).toMatchObject({
      isEnabled: null,
      usedCredits: null,
      monthlyLimit: null,
    });
  });

  test('discovers future complete balance keys without interpreting their names', () => {
    const normalized = normalizeClaudeUsageSnapshot({
      future_balance: { ...fixture.additional_credit_balance },
    });
    expect(normalized?.dollarWindows[0].key).toBe('future_balance');
  });
});

describe('Claude quota reads and shared observations', () => {
  test('keeps read-only usage/profile dispatch and distinct plan/dollar rows', async () => {
    const requests: Parameters<typeof apiCallApi.request>[0][] = [];
    apiCallApi.request = async (request) => {
      requests.push(request);
      return request.url === CLAUDE_USAGE_URL
        ? result(200, fixture)
        : result(200, { account: { has_claude_max: true } });
    };
    const data = await CLAUDE_CONFIG.fetchQuota(file, i18n.t);
    expect(requests.map(({ url }) => url)).toEqual([CLAUDE_USAGE_URL, CLAUDE_PROFILE_URL]);
    expect(requests.every(({ method }) => method === 'GET')).toBe(true);
    expect(requests[0]).toMatchObject({
      authIndex: file.authIndex,
      header: { Accept: 'application/json', Authorization: 'Bearer $TOKEN$' },
    });
    expect(data.windows.map(({ id }) => id)).toEqual([
      'five-hour',
      'seven-day',
      'seven-day-sonnet',
    ]);
    expect(data.extraUsage).toEqual(snapshot.extraUsage);
    expect(data.dollarWindows).toEqual(snapshot.dollarWindows);
    expect(data.planType).toBe('plan_max');
    expect(CLAUDE_CONFIG.buildSuccessState(data).dollarWindows).toEqual(snapshot.dollarWindows);
  });

  test('preserves genuine Fable scoped windows alongside an independent balance', async () => {
    apiCallApi.request = async ({ url }) =>
      result(
        200,
        url === CLAUDE_USAGE_URL
          ? {
              ...fixture,
              limits: [
                {
                  kind: 'weekly_scoped',
                  percent: 20,
                  resets_at: fixture.seven_day.resets_at,
                  scope: { model: { display_name: 'Fable 5' } },
                },
              ],
            }
          : null
      );
    const data = await CLAUDE_CONFIG.fetchQuota(file, i18n.t);
    expect(data.windows.find(({ id }) => id === 'seven-day-fable')?.usedPercent).toBe(20);
    expect(data.dollarWindows).toHaveLength(2);
  });

  test('dollar resets participate in recovery without becoming quota percentages or recurrence', () => {
    const observations = CLAUDE_CONFIG.getObservations(quota);
    expect(observations.windows[0]).toMatchObject({
      id: 'dollar:iguana_necktie',
      remainingPercent: null,
      periodHours: null,
      resetAtMs: Date.parse(fixture.iguana_necktie.resets_at),
    });
    expect(observations.limits).toEqual([]);
    expect(nextRecoveryMs('claude', quota, Date.parse('2026-10-31T00:00:00Z'))).toBe(
      Date.parse(fixture.iguana_necktie.resets_at)
    );
    expect(collectQuotaRowInstants('claude', quota)).toHaveLength(1);
    expect(
      buildTimelineLane({ name: file.name, displayName: 'Claude', provider: 'claude', quota })
        .anchorMs
    ).toBeNull();
    expect(selectQuotaWindow(observations)?.remainingPercent).toBeNull();
  });

  test('account windows remain preferred when dollar balances are present', () => {
    const state = {
      ...quota,
      windows: [
        {
          id: 'seven-day',
          label: 'Account',
          usedPercent: 100,
          resetLabel: '',
          resetAtMs: Date.parse('2099-01-08T00:00:00Z'),
          periodHours: 168,
        },
      ],
    };
    const chosen = selectQuotaWindow(CLAUDE_CONFIG.getObservations(state));
    expect(chosen?.id).toBe('seven-day');
    expect(chosen?.remainingPercent).toBe(0);
  });

  test('profile failure does not discard a successful balance-only usage response', async () => {
    apiCallApi.request = async ({ url }) =>
      url === CLAUDE_USAGE_URL
        ? result(200, { balance: fixture.additional_credit_balance })
        : result(503, { error: 'profile unavailable' });
    const data = await CLAUDE_CONFIG.fetchQuota(file, i18n.t);
    expect(data.planType).toBeNull();
    expect(data.windows).toEqual([]);
    expect(data.dollarWindows).toHaveLength(1);
  });

  test('rejects failed usage responses rather than treating embedded amounts as success', async () => {
    for (const statusCode of [401, 403, 429, 500]) {
      apiCallApi.request = async () => result(statusCode, fixture);
      try {
        await CLAUDE_CONFIG.fetchQuota(file, i18n.t);
        throw new Error('Failed usage must not produce a snapshot');
      } catch (error) {
        expect(getStatusFromError(error)).toBe(statusCode);
      }
    }
  });

  test('rejects malformed successful usage responses', async () => {
    for (const value of [null, '', 'not-json', [], { error: 'no usage' }]) {
      apiCallApi.request = async () => result(200, value);
      await expect(CLAUDE_CONFIG.fetchQuota(file, i18n.t)).rejects.toThrow(
        i18n.t('claude_quota.empty_windows')
      );
    }
  });

  test('shared refresh ownership retains balances on errors and replaces them after recovery', () => {
    const cached = successfulSnapshot(quota, 123);
    expect(checkingSnapshot(cached, CLAUDE_CONFIG.buildLoadingState())).toMatchObject({
      dollarWindows: snapshot.dollarWindows,
      refreshing: true,
      checkedAt: 123,
    });
    const failed = failedSnapshot(cached, CLAUDE_CONFIG.buildErrorState('failure', 502));
    expect(failed).toMatchObject({
      dollarWindows: snapshot.dollarWindows,
      stale: true,
      checkedAt: 123,
    });
    expect(
      successfulSnapshot({ status: 'success', windows: [], dollarWindows: [] }, 456)
    ).toMatchObject({
      dollarWindows: [],
      stale: false,
      checkedAt: 456,
    });
  });
});

describe('Claude read-only amount rendering', () => {
  test('formats minor-unit extra usage and dollar-unit balances independently', () => {
    const markup = render(quota);
    expect(markup).toContain('Spent $12.50 / Limit $50.00');
    expect(markup).toContain('25% used');
    expect(markup).toContain('$94.96 remaining');
    expect(markup).toContain('Spent $5.04 / Limit $100.00');
    expect(markup).toContain('$20.00 remaining');
    expect(markup).toContain('Not provided');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('No quota data available');
  });

  test('renders disabled reasons, zero amounts, and untrusted strings as text', () => {
    const markup = render({
      ...quota,
      extraUsage: {
        ...snapshot.extraUsage!,
        isEnabled: false,
        usedCredits: 0,
        monthlyLimit: 0,
        utilization: 0,
        userDisabled: true,
        spendLimitReached: true,
        disabledReason: '<script>alert(1)</script>',
      },
    });
    expect(markup).toContain('Disabled');
    expect(markup).toContain('Spent $0.00 / Limit $0.00');
    expect(markup).toContain('Disabled by user');
    expect(markup).toContain('Spending limit reached');
    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(markup).not.toContain('<script>');
  });

  test('renders unknown currency amounts as unknown rather than zero', () => {
    const markup = render({
      ...quota,
      extraUsage: {
        ...snapshot.extraUsage!,
        usedCredits: null,
        monthlyLimit: null,
        isEnabled: null,
      },
      dollarWindows: [{ ...snapshot.dollarWindows[0], remainingDollars: null }],
    });
    expect(markup).toContain('Unknown');
    expect(markup).toContain('Spent -- / Limit --');
    expect(markup).toContain('-- remaining');
    expect(markup).not.toContain('Spent $0.00');
  });
});
