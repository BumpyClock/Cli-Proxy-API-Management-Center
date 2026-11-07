import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { EmptyRequestFlow, ThroughputChart } from '@/features/dashboard/components/ThroughputChart';
import { VitalsStrip } from '@/features/dashboard/components/VitalsStrip';
import type { SourceStatus } from '@/features/dashboard/logic/freshness';
import { deriveRequestScope, requestScopeLabel } from '@/features/dashboard/logic/requestScope';
import { credentialsVitalLine } from '@/features/dashboard/logic/vitals';
import type { TrafficWindow } from '@/features/dashboard/types';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();
const t = i18n.t.bind(i18n);
const render = (element: ReactElement) =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(MemoryRouter, null, element))
  );

const loaded: SourceStatus = { receivedAt: 1_000, error: null, loading: false };
const failed: SourceStatus = {
  receivedAt: null,
  error: 'Request failed with status code 500',
  loading: false,
};
const pending: SourceStatus = { receivedAt: null, error: null, loading: true };
const staleAfterFailure: SourceStatus = { receivedAt: 1_000, error: 'timeout', loading: false };

/** The Requests line exactly as the page composes it. */
const requestsLine = (credentials: SourceStatus, traffic: SourceStatus) => {
  const label = requestScopeLabel(deriveRequestScope({ credentials, traffic }));
  if (!label) return null;
  return label.missingKey
    ? t('dashboard.vitals_scope_partial', {
        window: '3h 20m',
        scope: t(label.scopeKey),
        missing: t(label.missingKey),
      })
    : t('dashboard.vitals_scope', { window: '3h 20m', scope: t(label.scopeKey) });
};

describe('Requests KPI scope says which sources the total sums', () => {
  test('both sources loaded: current credentials', () => {
    expect(deriveRequestScope({ credentials: loaded, traffic: loaded })).toEqual({ kind: 'all' });
    expect(requestsLine(loaded, loaded)).toBe('Last 3h 20m · current credentials');
  });

  test('provider-key usage failed: credential files only, and says why', () => {
    expect(deriveRequestScope({ credentials: loaded, traffic: failed })).toEqual({
      kind: 'credentialFilesOnly',
      missing: 'failed',
    });
    expect(requestsLine(loaded, failed)).toBe(
      'Last 3h 20m · credential files only; provider key usage unavailable'
    );
  });

  test('credential files failed: provider keys only', () => {
    expect(requestsLine(failed, loaded)).toBe(
      'Last 3h 20m · provider keys only; credential files unavailable'
    );
  });

  test('a source still loading is named as loading, not unavailable', () => {
    expect(requestsLine(loaded, pending)).toBe(
      'Last 3h 20m · credential files only; provider key usage loading'
    );
    expect(requestsLine(pending, loaded)).toBe(
      'Last 3h 20m · provider keys only; credential files loading'
    );
  });

  test('a failure after a success keeps the last answer in the total', () => {
    expect(deriveRequestScope({ credentials: loaded, traffic: staleAfterFailure })).toEqual({
      kind: 'all',
    });
  });

  test('nothing loaded yet: no scope claim at all', () => {
    expect(deriveRequestScope({ credentials: pending, traffic: failed })).toEqual({ kind: 'none' });
    expect(requestsLine(pending, failed)).toBeNull();
  });

  test('every scope phrase exists in all four locales', async () => {
    const keys = [
      'dashboard.vitals_scope',
      'dashboard.vitals_scope_partial',
      'dashboard.vitals_rate_scope',
      'dashboard.vitals_success_unmeasured',
      'dashboard.vitals_unavailable',
      'dashboard.vitals_usage_differs_short',
      'dashboard.vitals_usage_differs',
      'dashboard.scope_all',
      'dashboard.scope_credential_files_only',
      'dashboard.scope_provider_keys_only',
      'dashboard.scope_missing_provider_keys_failed',
      'dashboard.scope_missing_provider_keys_loading',
      'dashboard.scope_missing_credential_files_failed',
      'dashboard.scope_missing_credential_files_loading',
    ];
    for (const language of ['en', 'zh-CN', 'zh-TW', 'ru'] as const) {
      const localized = await createTestI18n(language);
      for (const key of keys) expect(localized.exists(key)).toBe(true);
    }
  });
});

describe('Credential files KPI states the serving count once', () => {
  test('all serving: no second line repeating it', () => {
    expect(credentialsVitalLine({ total: 6, limited: 0, problems: 0, disabled: 0 }, t)).toBe('');
    const markup = render(
      createElement(VitalsStrip, {
        ariaLabel: 'Vitals',
        items: [
          {
            key: 'credentials',
            label: 'Credential files',
            value: t('dashboard.vitals_of', { serving: 6, total: 6 }),
            unit: t('dashboard.vitals_serving_unit'),
          },
        ],
      })
    );
    expect(markup.match(/serving/gi)?.length).toBe(1);
  });

  test('exceptions are listed', () => {
    expect(credentialsVitalLine({ total: 6, limited: 1, problems: 2, disabled: 1 }, t)).toBe(
      'including 1 limited · 2 need attention · 1 disabled'
    );
  });
});

const bucketMs = 600_000;
const traffic = (counts: Array<[number, number]>): TrafficWindow => {
  const success = counts.reduce((sum, [ok]) => sum + ok, 0);
  const failedCount = counts.reduce((sum, [, bad]) => sum + bad, 0);
  return {
    buckets: counts.map(([ok, bad], index) => ({
      startMs: index * bucketMs,
      endMs: (index + 1) * bucketMs,
      success: ok,
      failed: bad,
      partial: index === counts.length - 1,
    })),
    success,
    failed: failedCount,
    total: success + failedCount,
    successRate: success + failedCount ? (success / (success + failedCount)) * 100 : null,
    peakTotal: Math.max(0, ...counts.map(([ok, bad]) => ok + bad)),
    peakIndex: -1,
    windowMinutes: counts.length * 10,
    startMs: 0,
    endMs: counts.length * bucketMs,
  };
};

describe('Request flow empty state', () => {
  test('an all-zero window is one row: title, bucket fact, zone, freshness, then the table', () => {
    const markup = render(
      createElement(EmptyRequestFlow, {
        traffic: traffic([
          [0, 0],
          [0, 0],
        ]),
        zoneLabel: 'UTC',
        stamp: createElement('span', { 'data-stamp': '' }, 'Updated just now'),
      })
    );
    const row = markup.slice(0, markup.indexOf('<details'));
    expect(row).toContain('>Request flow</h2>');
    expect(row).toContain('0 in every 10-minute bucket');
    // The page status row owns "no requests"; this row does not repeat it.
    expect(markup).not.toMatch(/no requests/i);
    expect(row).toMatch(/–[^<]*UTC/);
    expect(row).toContain('Updated just now');
    expect(row).not.toContain('<header');
    expect(markup).not.toContain('<figure');
    // The zero buckets stay inspectable behind one native disclosure.
    expect(markup.match(/<details\b/g)?.length).toBe(1);
    expect(markup).toContain('<summary>View data table</summary>');
    expect(markup.match(/<tr>/g)?.length).toBe(3);
  });

  test('a window with requests still plots, exactly as before', () => {
    const markup = render(
      createElement(ThroughputChart, {
        traffic: traffic([
          [3, 1],
          [2, 0],
        ]),
      })
    );
    expect(markup).toContain('<figure');
    expect(markup).not.toContain('0 in every 10-minute bucket');
  });

  test('no buckets at all stays the unavailable line, not a zero window', () => {
    const markup = render(createElement(ThroughputChart, { traffic: traffic([]) }));
    expect(markup).toContain('No traffic recorded yet');
    expect(markup).not.toContain('0 in every 10-minute bucket');
  });
});

describe('Success rate with no requests is an undefined ratio', () => {
  test('a null value renders a muted dash named for assistive tech, not 0% or a word', () => {
    const markup = render(
      createElement(VitalsStrip, {
        ariaLabel: 'Vitals',
        items: [
          {
            key: 'success',
            label: t('dashboard.vitals_success'),
            value: null,
            detail: t('dashboard.vitals_success_unmeasured'),
          },
        ],
      })
    );
    expect(markup).toContain('<span aria-hidden="true">—</span>');
    expect(markup).toContain('Unavailable');
    expect(markup).toContain('No requests to measure');
    expect(markup).not.toContain('0%');
    expect(markup).not.toContain('role="meter"');
  });
});

describe('Requests and the usage-statistics count', () => {
  test('the alternate count names its source and the same window, with the reason on demand', () => {
    expect(t('dashboard.vitals_usage_differs_short', { count: 135 })).toBe(
      'Usage statistics: 135 in the same window'
    );
    expect(t('dashboard.vitals_usage_differs')).toContain('credentials no longer listed');
  });

  test('no dashboard string calls the usage count "since restart"', async () => {
    const { default: en } = await import('../src/i18n/locales/en.json');
    expect(JSON.stringify(en.dashboard)).not.toMatch(/since restart/i);
  });
});

describe('Dashboard order', () => {
  test('an all-zero request flow follows Remaining quota; a plotted one precedes it', () => {
    const page = readFileSync(
      new URL('../src/features/dashboard/DashboardPage.tsx', import.meta.url),
      'utf8'
    );
    const before = page.indexOf('{!trafficIdle && requestFlow}');
    const quota = page.indexOf('<QuotaSummaryChart');
    const after = page.indexOf('{trafficIdle && requestFlow}');
    expect(before).toBeGreaterThan(-1);
    expect(before).toBeLessThan(quota);
    expect(after).toBeGreaterThan(quota);
  });
});
