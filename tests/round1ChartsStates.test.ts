import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { TimeSeriesChart } from '@/components/ui/TimeSeriesChart';
import { EmptyRequestFlow, ThroughputChart } from '@/features/dashboard/components/ThroughputChart';
import { QuotaHeader } from '@/features/quota/components/QuotaHeader';
import type { TrafficWindow } from '@/features/dashboard/types';
import { UsagePageContent } from '@/pages/UsagePage';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();
const render = (element: ReactElement) =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(MemoryRouter, null, element))
  );
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const bucketMs = 600_000;
const traffic = (counts: Array<[number, number]>): TrafficWindow => {
  const success = counts.reduce((sum, [ok]) => sum + ok, 0);
  const failed = counts.reduce((sum, [, bad]) => sum + bad, 0);
  return {
    buckets: counts.map(([ok, bad], index) => ({
      startMs: index * bucketMs,
      endMs: (index + 1) * bucketMs,
      success: ok,
      failed: bad,
      partial: index === counts.length - 1,
    })),
    success,
    failed,
    total: success + failed,
    successRate: success + failed ? (success / (success + failed)) * 100 : null,
    peakTotal: Math.max(0, ...counts.map(([ok, bad]) => ok + bad)),
    peakIndex: -1,
    windowMinutes: counts.length * 10,
    startMs: 0,
    endMs: counts.length * bucketMs,
  };
};

describe('round 1 chart states', () => {
  test('an all-zero request window states its buckets and stays inspectable', () => {
    const markup = render(
      createElement(EmptyRequestFlow, {
        zoneLabel: 'GMT-8',
        stamp: null,
        traffic: traffic([
          [0, 0],
          [0, 0],
        ]),
      })
    );
    // One compact line states the window and its zone; the zero buckets sit behind a
    // data-table disclosure. No legend, plot or markers.
    expect(markup).toContain('0 in every 10-minute bucket');
    expect(markup).toContain('GMT-8');
    expect(markup).toContain('View data table');
    expect(markup).not.toContain('aria-pressed');
    expect(markup).not.toContain('recharts');
    expect(markup).not.toContain('No traffic recorded yet');
  });

  test('a window with requests has no idle note', () => {
    const markup = render(
      createElement(ThroughputChart, {
        traffic: traffic([
          [3, 1],
          [2, 0],
        ]),
      })
    );
    expect(markup).not.toContain('0 in every 10-minute bucket');
  });

  test('missing buckets stay the unavailable placeholder, not a zero window', () => {
    const markup = render(createElement(ThroughputChart, { traffic: traffic([]) }));
    expect(markup).toContain('No traffic recorded yet');
    expect(markup).not.toContain('0 in every 10-minute bucket');
  });

  test('legend chips keep the full identity in title and text while the name ellipsizes', () => {
    const label = 'Claude · claude-workspace-1-with-a-very-long-account-name.json';
    const markup = render(
      createElement(TimeSeriesChart, {
        id: 'legend',
        data: [{ timestamp: 1, values: { a: 62 } }],
        series: [{ id: 'a', label, number: 1, color: 'var(--chart-1)' }],
        xDomain: [0, 2],
        formatX: String,
        formatY: (value: number) => `${value}%`,
        ariaLabel: 'Quota',
        emptyText: 'None',
      })
    );
    expect(markup).toContain(`title="1 · ${label} · 62%"`);
    expect(markup).toContain(`>${label}</span>`);
    const scss = source('src/components/ui/TimeSeriesChart.module.scss');
    const name = scss.slice(scss.indexOf('.name {'), scss.indexOf('}', scss.indexOf('.name {')));
    expect(name).toContain('white-space: nowrap');
    expect(name).toContain('text-overflow: ellipsis');
    expect(scss).not.toContain('overflow-wrap: anywhere');
    expect(scss).toMatch(/\[data-theme='dark'\]\) \.plot :global\(\.recharts-cartesian-grid/);
    const readout = scss.slice(
      scss.indexOf('.readout {'),
      scss.indexOf('}', scss.indexOf('.readout {'))
    );
    expect(readout).not.toContain('font-mono');
  });

  test('marker numbers are drawn once per coincident group, not as per-dot labels', () => {
    const chart = source('src/components/ui/TimeSeriesChart.tsx');
    expect(chart).toContain('groupCoincidentMarkers(');
    expect(chart).not.toMatch(/<ReferenceDot[^>]*label=/);
    expect(chart).toContain('layoutTimeAxis(');
  });

  test('unreported daily history is a compact status, labeled unreported, with its explanation', () => {
    const markup = render(
      createElement(UsagePageContent, {
        payload: {
          usage: { total_requests: 3, total_tokens: 30, success_count: 3, failure_count: 0 },
        },
        enabled: true,
        loading: false,
        error: null,
        lastUpdated: 1_000,
        now: 1_000,
        onRefresh: () => {},
      })
    );
    // Round 2: both series unreported collapse into one notice after Top Models.
    expect(markup.match(/data-daily-history="unreported"/g)).toHaveLength(1);
    expect(markup.match(/>Not reported</g)).toHaveLength(1);
    expect(markup).toContain('missing dates are never filled with zeros');
    expect(markup.indexOf('usage-models-title')).toBeLessThan(markup.indexOf('usage-daily-title'));
    expect(markup).not.toContain('View data table');
    expect(markup).not.toContain('aria-pressed');
    expect(markup).not.toContain('<strong>0</strong>');
  });

  test('page refresh actions use the shared labeled RefreshButton with visible scope', () => {
    const quota = render(
      createElement(QuotaHeader, {
        totalCount: 6,
        loadedCount: 4,
        attentionCount: 0,
        refreshing: false,
        disableControls: false,
        onRefreshAll: () => {},
      })
    );
    // Full scope on desktop, short scope on phones; never icon-only.
    expect(quota).toMatch(/<span[^>]*>Refresh all quotas<\/span>/);
    expect(quota).toMatch(/<span[^>]*>Refresh quotas<\/span>/);
    expect(quota).not.toContain('aria-label="Refresh all quotas"');
    for (const path of [
      'src/features/dashboard/DashboardPage.tsx',
      'src/features/dashboard/components/QuotaSummaryChart.tsx',
      'src/features/quota/components/QuotaHeader.tsx',
      'src/pages/UsagePage.tsx',
    ]) {
      expect(source(path)).toContain('<RefreshButton');
    }
  });
});
