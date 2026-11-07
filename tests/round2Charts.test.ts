import { describe, expect, test } from 'bun:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { TimeSeriesChart } from '@/components/ui/TimeSeriesChart';
import { groupIdenticalTraces, nextHiddenSeries } from '@/components/ui/TimeSeriesChart.model';
import { resetMarkers } from '@/features/quota/quotaAccountSeries';
import { formatDateTimeValue, isoTitle } from '@/utils/format';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));

const flat = (value: number) => [
  { timestamp: 0, value },
  { timestamp: 10, value: 100 },
];

describe('round 2 shared traces', () => {
  test('identical series share one trace; distinct series keep their own', () => {
    const groups = groupIdenticalTraces([
      { id: 'c', number: 3, samples: flat(62) },
      { id: 'a', number: 1, samples: flat(62) },
      { id: 'b', number: 2, samples: flat(40) },
      { id: 'd', number: 4, samples: flat(62) },
    ]);
    expect(groups).toEqual([
      { ids: ['a', 'c', 'd'], numbers: [1, 3, 4] },
      { ids: ['b'], numbers: [2] },
    ]);
  });

  test('samples within tolerance share a trace; beyond it they stay separate', () => {
    const near = [
      { timestamp: 0, value: 62 },
      { timestamp: 1_000, value: 100 },
    ];
    const close = [
      { timestamp: 0, value: 62 },
      { timestamp: 1_004, value: 100 },
    ];
    const far = [
      { timestamp: 0, value: 62 },
      { timestamp: 2_000, value: 100 },
    ];
    const traces = [
      { id: 'a', number: 1, samples: near },
      { id: 'b', number: 2, samples: close },
      { id: 'c', number: 3, samples: far },
    ];
    expect(groupIdenticalTraces(traces, { x: 10, y: 0.5 }).map((g) => g.ids)).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
    expect(groupIdenticalTraces(traces)).toHaveLength(3);
  });

  test('a gap is not the same trace as a value', () => {
    const groups = groupIdenticalTraces([
      { id: 'a', number: 1, samples: [{ timestamp: 0, value: null }] },
      { id: 'b', number: 2, samples: [{ timestamp: 0, value: 0 }] },
    ]);
    expect(groups).toHaveLength(2);
  });

  test('the legend explains a shared trace and keeps every exact value', () => {
    const series = [1, 2, 3, 4].map((number) => ({
      id: `s${number}`,
      label: `account-${number}.json`,
      number,
      color: `var(--chart-${number})`,
      marker: 'first' as const,
      points: flat(62),
    }));
    const markup = render(
      createElement(TimeSeriesChart, {
        id: 'shared',
        data: [],
        series,
        xDomain: [0, 10] as const,
        yDomain: [0, 100] as const,
        formatX: String,
        formatY: (value: number) => `${value}%`,
        ariaLabel: 'Quota',
        emptyText: 'none',
      })
    );
    expect(markup).toContain('1–4 overlap, drawn as one grey line');
    expect(markup.match(/<strong>62%<\/strong>/g)).toHaveLength(4);
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(4);
    expect(markup).toContain('Select a series to show only it');
  });
});

describe('round 2 legend isolation', () => {
  const ids = ['a', 'b', 'c'];

  test('first selection isolates the chosen series', () => {
    expect([...nextHiddenSeries(new Set(), ids, 'b')].sort()).toEqual(['a', 'c']);
  });

  test('later selections toggle one series at a time', () => {
    expect([...nextHiddenSeries(new Set(['a', 'c']), ids, 'a')]).toEqual(['c']);
  });

  test('hiding the last visible series shows everything again', () => {
    expect(nextHiddenSeries(new Set(['a', 'c']), ids, 'b').size).toBe(0);
  });

  test('a single series cannot be isolated into nothing', () => {
    expect(nextHiddenSeries(new Set(), ['a'], 'a').size).toBe(0);
  });
});

describe('round 2 reset markers', () => {
  const account = (number: number, resetAtMs: number | null, extra = {}) =>
    ({
      number,
      remaining: 62,
      quota: { stale: false },
      window: { recovers: true, resetAtMs },
      ...extra,
    }) as unknown as Parameters<typeof resetMarkers>[0][number];

  test('coincident resets merge into one labelled marker covering every account', () => {
    const markers = resetMarkers([account(2, 1_000), account(1, 1_010)], 0, 10_000, 100);
    expect(markers).toEqual([{ atMs: 1_000, numbers: [1, 2], all: true }]);
  });

  test('stale snapshots, past and out-of-range resets are not drawn', () => {
    const markers = resetMarkers(
      [
        account(1, 5_000),
        account(2, 6_000, { quota: { stale: true } }),
        account(3, -1),
        account(4, 50_000),
      ],
      0,
      10_000,
      100
    );
    expect(markers).toEqual([{ atMs: 5_000, numbers: [1], all: false }]);
  });
});

describe('round 2 timestamps', () => {
  test('metadata uses one medium date + short time format, exact ISO stays available', () => {
    const iso = '2026-11-06T20:32:00.000Z';
    const human = formatDateTimeValue(iso, 'en-US');
    // ICU versions join date and time with ", " or " at "; either is one consistent format.
    expect(human).toMatch(/^[A-Z][a-z]{2} \d{1,2}, 2026(,| at) \d{1,2}:\d{2}\s?[AP]M$/);
    expect(human).not.toContain(':00 ');
    expect(isoTitle(iso)).toBe(iso);
    expect(isoTitle('not a date')).toBe('');
  });
});
