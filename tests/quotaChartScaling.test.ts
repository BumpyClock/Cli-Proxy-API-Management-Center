import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import en from '../src/i18n/locales/en.json';
import { TimeSeriesChart } from '../src/components/ui/TimeSeriesChart';
import { TimeSeriesChartTable } from '../src/components/ui/TimeSeriesChartTable';
import {
  buildInspectionTimes,
  inspectSeriesValue,
  moveInspectionIndex,
  pointerInspectionIndex,
  seriesMarker,
} from '../src/components/ui/TimeSeriesChart.model';
import type {
  TimeSeriesChartProps,
  TimeSeriesSeries,
} from '../src/components/ui/TimeSeriesChart.types';
import { buildAccountSeries } from '../src/features/quota/quotaAccountSeries';
import { classifyQuotaFiles } from '../src/features/quota/logic';
import { QuotaOverview } from '../src/features/quota/components/QuotaOverview';

const now = Date.UTC(2100, 0, 1);
const hour = 3_600_000;
const end = now + 7 * 24 * hour;
const i18n = createInstance();
await i18n.init({
  lng: 'en',
  fallbackLng: false,
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});

function fleet(count: number, stale = false) {
  const entries = classifyQuotaFiles(
    Array.from({ length: count }, (_, index) => ({
      name: `account-${String(index).padStart(4, '0')}`,
      provider: 'claude',
    }))
  );
  const snapshots = new Map(
    entries.map((entry, index) => [
      entry,
      {
        status: 'success' as const,
        stale,
        checkedAt: now - hour,
        windows: [
          {
            id: 'weekly',
            label: 'Weekly',
            usedPercent: 80,
            periodHours: 168,
            resetAtMs: now + (index + 1) * 1000,
          },
        ],
      },
    ])
  );
  const numbers = new Map(
    entries.map((entry, index) => [`${entry.type}:${entry.file.name}`, index + 1])
  );
  const quotaFor = (entry: (typeof entries)[number]) => snapshots.get(entry);
  const model = buildAccountSeries(entries, quotaFor, 'weekly', now, end, numbers);
  const props: TimeSeriesChartProps = {
    id: 'fleet',
    data: model.data,
    series: model.series,
    xDomain: [now, end],
    yDomain: [0, 100],
    formatX: String,
    formatY: (value) => `${value}%`,
    ariaLabel: 'Independent allowances',
    emptyText: 'No reported allowances',
  };
  return { entries, quotaFor, numbers, model, props };
}

function renderChart(props: TimeSeriesChartProps) {
  return renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(TimeSeriesChart, props))
  );
}

function renderOverview(count: number) {
  const { entries, quotaFor, numbers } = fleet(count);
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(QuotaOverview, {
        entries,
        quotaFor,
        seriesNumbers: numbers,
        resolvedTheme: 'light',
        disabled: false,
        canObserve: () => true,
        onRefresh: () => {},
        children: null,
      })
    )
  );
}

const occurrences = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

describe('independent quota chart scaling', () => {
  for (const count of [250, 500]) {
    test(`${count} distinct resets store at most four points per account, not a reset matrix`, () => {
      const { model } = fleet(count);
      expect(model.accounts).toHaveLength(count);
      expect(model.series).toHaveLength(count);
      expect(model.data).toHaveLength(0);
      expect(model.series.reduce((sum, item) => sum + item.points.length, 0)).toBe(4 * count);
      for (const [index, item] of model.series.entries()) {
        expect(item.points.map((point) => point.timestamp)).toEqual([
          now,
          now + (index + 1) * 1000,
          now + (index + 1) * 1000,
          end,
        ]);
        expect(item.points.map((point) => point.value)).toEqual([20, 20, 100, 100]);
        expect(item.number).toBe(index + 1);
        expect(item.strokeDasharray).toBeTruthy();
      }
      expect(buildInspectionTimes(model.data, model.series)).toHaveLength(count + 2);
      const markup = renderChart(fleet(count).props);
      expect(occurrences(markup, /aria-pressed="true"/g)).toBe(count);
      expect(markup).not.toContain('<table');
      expect(markup).not.toContain('<td');
      expect(markup).toContain('<details');
      expect(Buffer.byteLength(markup)).toBeLessThan(count * 800);
    });
  }

  test('doubling fleet size keeps initial chart and overview output linear', () => {
    const smallChart = renderChart(fleet(250).props);
    const largeChart = renderChart(fleet(500).props);
    expect(Buffer.byteLength(largeChart)).toBeLessThan(Buffer.byteLength(smallChart) * 2.1);
    const smallOverview = renderOverview(250);
    const largeOverview = renderOverview(500);
    expect(Buffer.byteLength(largeOverview)).toBeLessThan(Buffer.byteLength(smallOverview) * 2.1);
    expect(Buffer.byteLength(largeOverview)).toBeLessThan(500 * 2000);
    // Exactly one authoritative account/reset breakdown, not a second projection table.
    expect(occurrences(largeOverview, /<table\b/g)).toBe(1);
    expect(occurrences(largeOverview, /<tr>/g)).toBe(501);
    expect(occurrences(largeOverview, /<td>/g)).toBe(2000);
    expect(largeOverview).toContain('aria-details="quota-accounts-breakdown"');
    expect(largeOverview).toContain('id="quota-accounts-breakdown"');
    expect(largeOverview).not.toContain('View data table');
  });

  test('expanded generic sparse evidence also stays linear and respects visible series', () => {
    const { props } = fleet(500);
    const renderTable = (series: readonly TimeSeriesSeries[]) =>
      renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(TimeSeriesChartTable, { ...props, series })
        )
      );
    const markup = renderTable(props.series);
    expect(occurrences(markup, /<td>/g)).toBe(2000);
    expect(markup).toContain('<td>20%</td>');
    expect(markup).toContain('<td>100%</td>');
    const onlyLast = renderTable(props.series.slice(-1));
    expect(occurrences(onlyLast, /<td>/g)).toBe(4);
    expect(onlyLast).toContain('account-0499');
    expect(onlyLast).not.toContain('account-0000');
  });

  test('keyboard inspection traverses real times, not every account at every reset', () => {
    const { model } = fleet(500);
    const times = buildInspectionTimes(model.data, model.series);
    let selected = moveInspectionIndex(0, 'End', times.length);
    expect(times[selected]).toBe(end);
    expect(inspectSeriesValue(model.data, model.series[499], times[selected])).toBe(100);
    selected = moveInspectionIndex(selected, 'Home', times.length);
    expect(times[selected]).toBe(now);
    expect(inspectSeriesValue(model.data, model.series[499], times[selected])).toBe(20);
    selected = moveInspectionIndex(selected, 'ArrowRight', times.length);
    expect(times[selected]).toBe(now + 1000);
    expect(inspectSeriesValue(model.data, model.series[0], times[selected])).toBe(100);
    expect(inspectSeriesValue(model.data, model.series[499], times[selected])).toBe(20);
    expect(moveInspectionIndex(0, 'ArrowLeft', times.length)).toBe(0);
    expect(moveInspectionIndex(times.length - 1, 'ArrowRight', times.length)).toBe(
      times.length - 1
    );
    expect(seriesMarker(model.data, model.series[499])).toEqual({ timestamp: now, value: 20 });
    // Hiding a neighbouring series does not alter this series' samples or numbering.
    const onlyLast = model.series.slice(-1);
    expect(inspectSeriesValue(model.data, onlyLast[0], now + 1000)).toBe(20);
    expect(onlyLast[0].number).toBe(500);
  });

  test('pointer inspection uses sparse timestamp labels, even after series switches', () => {
    const { model } = fleet(500);
    const times = buildInspectionTimes(model.data, model.series);
    // Recharts indexes concatenated per-series samples, not the sorted inspection times.
    const index = pointerInspectionIndex(times, true, {
      activeLabel: now + 500_000,
      activeTooltipIndex: '1997',
    });
    expect(index).toBe(500);
    expect(inspectSeriesValue(model.data, model.series[499], times[index ?? 0])).toBe(100);
    expect(pointerInspectionIndex(times, true, { activeLabel: String(now + 1000) })).toBe(1);
    expect(pointerInspectionIndex(times, true, { activeTooltipIndex: '1' })).toBeNull();
    expect(pointerInspectionIndex(times, true, { activeLabel: 'not-a-time' })).toBeNull();
    expect(pointerInspectionIndex(times, true, { activeLabel: now - 1 })).toBeNull();
    expect(pointerInspectionIndex(times, false, { activeTooltipIndex: '2' })).toBe(2);
    expect(pointerInspectionIndex(times, false, { activeTooltipIndex: null })).toBeNull();
  });

  test('retained stale fleets keep measurements but have no reset forecasts', () => {
    const { model } = fleet(500, true);
    expect(model.series).toHaveLength(500);
    expect(buildInspectionTimes(model.data, model.series)).toEqual([now, end]);
    for (const item of model.series) {
      expect(item.points).toEqual([
        { timestamp: now, value: 20 },
        { timestamp: end, value: 20 },
      ]);
      expect(inspectSeriesValue(model.data, item, now + hour)).toBe(20);
    }
  });
});

describe('shared chart inspection compatibility', () => {
  const dense = [
    { timestamp: 0, values: { traffic: 0, missing: null } },
    { timestamp: 10, values: { traffic: 100, missing: 50 } },
  ];
  const traffic: TimeSeriesSeries = { id: 'traffic', label: 'Traffic', color: 'red' };

  test('dense traffic data retains zero, exact observations and linear interpolation', () => {
    expect(buildInspectionTimes(dense, [traffic])).toEqual([0, 10]);
    expect(inspectSeriesValue(dense, traffic, 0)).toBe(0);
    expect(inspectSeriesValue(dense, traffic, 10)).toBe(100);
    expect(inspectSeriesValue(dense, traffic, 5)).toBe(50);
    expect(seriesMarker(dense, traffic)).toEqual({ timestamp: 10, value: 100 });
    expect(inspectSeriesValue(dense, { ...traffic, id: 'missing' }, 0)).toBeNull();
    expect(inspectSeriesValue(dense, { ...traffic, id: 'missing' }, 5)).toBeNull();
  });

  test('sparse nulls remain gaps, and samples do not extend beyond their measured range', () => {
    const sparse: TimeSeriesSeries = {
      ...traffic,
      interpolation: 'stepAfter',
      points: [
        { timestamp: 0, value: 0 },
        { timestamp: 10, value: null },
        { timestamp: 20, value: 80 },
      ],
    };
    expect(inspectSeriesValue([], sparse, -1)).toBeNull();
    expect(inspectSeriesValue([], sparse, 0)).toBe(0);
    expect(inspectSeriesValue([], sparse, 5)).toBe(0);
    expect(inspectSeriesValue([], sparse, 10)).toBeNull();
    expect(inspectSeriesValue([], sparse, 15)).toBeNull();
    expect(inspectSeriesValue([], sparse, 20)).toBe(80);
    expect(inspectSeriesValue([], sparse, 21)).toBeNull();
    expect(inspectSeriesValue([], { ...sparse, interpolation: 'linear' }, 5)).toBeNull();
  });
});
