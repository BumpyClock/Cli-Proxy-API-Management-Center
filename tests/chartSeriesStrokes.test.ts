import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { TimeSeriesChart, type TimeSeriesChartProps } from '@/components/ui/TimeSeriesChart';
import {
  nextHiddenSeries,
  PROJECTED_DASH,
  resolveSeriesStrokes,
  SHARED_STROKE,
} from '@/components/ui/TimeSeriesChart.model';
import type { TimeSeriesSeries } from '@/components/ui/TimeSeriesChart.types';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();
const domain = [0, 1_000] as const;
const flat = (value: number) => [
  { timestamp: 0, value },
  { timestamp: 1_000, value },
];
const account = (number: number, value: number, dash?: string): TimeSeriesSeries => ({
  id: `s${number}`,
  label: `account-${number}.json`,
  number,
  color: `var(--chart-${number})`,
  strokeDasharray: dash,
  marker: 'first',
  points: flat(value),
});
// 1 and 2 coincide exactly; 3 is distinct.
const series = [account(1, 62, '6 4'), account(2, 62, '2 4'), account(3, 40, '8 3 2 3')];
const options = { xDomain: domain, yDomain: [0, 100] as const };

const render = (props: Partial<TimeSeriesChartProps>) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(TimeSeriesChart, {
        id: 'strokes',
        data: [],
        series,
        xDomain: domain,
        yDomain: [0, 100],
        formatX: String,
        formatY: (value: number) => `${value}%`,
        ariaLabel: 'Quota',
        emptyText: 'none',
        ...props,
      })
    )
  );

describe('drawn series strokes', () => {
  test('exactly overlapping series share the grey trace; a distinct series keeps its colour', () => {
    const { traces, strokes } = resolveSeriesStrokes(series, [], options);
    expect(traces.map((trace) => trace.ids)).toEqual([['s1', 's2'], ['s3']]);
    expect(strokes.get('s1')).toEqual({
      color: SHARED_STROKE,
      dash: undefined,
      shared: true,
      numbers: [1, 2],
      visible: true,
    });
    expect(strokes.get('s2')?.color).toBe(SHARED_STROKE);
    expect(strokes.get('s3')).toMatchObject({ color: 'var(--chart-3)', dash: '8 3 2 3' });
  });

  test('isolating one member of a shared trace draws it in its own colour', () => {
    const { strokes } = resolveSeriesStrokes(series, [], {
      ...options,
      hidden: new Set(['s2', 's3']),
    });
    expect(strokes.get('s1')).toMatchObject({ color: 'var(--chart-1)', shared: false });
    expect(strokes.get('s2')).toMatchObject({ color: 'var(--chart-2)', visible: false });
  });

  test('on a forecast plot the key shows the projected dash actually drawn', () => {
    const { strokes } = resolveSeriesStrokes(series, [], { ...options, forecast: true });
    expect(strokes.get('s1')?.dash).toBe(PROJECTED_DASH);
    expect(strokes.get('s3')?.dash).toBe('8 3 2 3');
  });

  test('legend swatches use the drawn stroke and number badges stay neutral', () => {
    const markup = render({});
    expect(markup).not.toContain('border-color');
    // Two shared rows plus the shared-trace note, and the distinct series in its colour.
    expect(markup.match(/stroke="var\(--text-secondary\)"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(markup).toContain('stroke="var(--chart-3)"');
    expect(markup).not.toContain('stroke="var(--chart-1)"');
    expect(markup).toContain('1,2 overlap, drawn as one grey line');
  });

  test('without a legend, the shared note stays and a controlled selection shows Show all', () => {
    const markup = render({ legendPlacement: 'none' });
    expect(markup).not.toContain('aria-pressed');
    expect(markup).toContain('1,2 overlap, drawn as one grey line');
    expect(markup).not.toContain('Select a series to show only it');
    const isolated = render({ legendPlacement: 'none', hiddenSeries: new Set(['s2', 's3']) });
    expect(isolated).toContain('Show all series');
    expect(isolated).not.toContain('overlap');
  });

  test('stale ids in a selection never count as hidden series', () => {
    expect([...nextHiddenSeries(new Set(['gone']), ['a', 'b'], 'a')]).toEqual(['b']);
  });
});

describe('projection encoding', () => {
  test('a projection covering the whole plot is labelled, not shaded', () => {
    const markup = render({ forecast: { from: 0, label: 'Projected from latest snapshot' } });
    expect(markup).toContain('Projected from latest snapshot');
    expect(markup).not.toContain('<pattern');
    expect(markup).not.toContain('Projected from latest snapshot →');
  });

  test('no chart source keeps the diagonal hatch', async () => {
    const source = await Bun.file('src/components/ui/TimeSeriesChart.tsx').text();
    expect(source).not.toContain('<pattern');
    expect(source).not.toContain('ForecastHatch');
  });
});
