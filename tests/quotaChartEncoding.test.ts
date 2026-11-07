import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { splitAtForecast } from '@/components/ui/TimeSeriesChart.model';
import { QuotaOverview } from '@/features/quota/components/QuotaOverview';
import { classifyQuotaFiles } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';
import { buildAccountSeries, buildGlanceRows } from '@/features/quota/quotaAccountSeries';
import {
  formatQuotaSeriesLabel,
  quotaAccountLabel,
  quotaTimeFormat,
  quotaTimeZoneLabel,
} from '@/features/quota/quotaChartFormat';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();
await i18n.changeLanguage('en');
const t = i18n.t.bind(i18n);
const hour = 3_600_000;
const day = 24 * hour;
const now = Date.now();

describe('measured and projected segments', () => {
  test('a snapshot-then-forecast series is entirely projected after its measured point', () => {
    const samples = [
      { timestamp: now, value: 62 },
      { timestamp: now + day, value: 62 },
      { timestamp: now + day, value: 100 },
      { timestamp: now + 7 * day, value: 100 },
    ];
    const { measured, projected } = splitAtForecast(samples, now, 'stepAfter');
    expect(measured).toEqual([{ timestamp: now, value: 62 }]);
    expect(projected).toEqual(samples);
  });

  test('history and forecast share the boundary value, taken from the plotted line', () => {
    const samples = [
      { timestamp: 0, value: 10 },
      { timestamp: 100, value: 30 },
    ];
    const linear = splitAtForecast(samples, 50, 'linear');
    expect(linear.measured).toEqual([samples[0], { timestamp: 50, value: 20 }]);
    expect(linear.projected).toEqual([{ timestamp: 50, value: 20 }, samples[1]]);
    const step = splitAtForecast(samples, 50, 'stepAfter');
    expect(step.measured[1]).toEqual({ timestamp: 50, value: 10 });
  });

  test('an unreported boundary stays a gap instead of acquiring a value', () => {
    const { measured, projected } = splitAtForecast(
      [
        { timestamp: 0, value: null },
        { timestamp: 100, value: 30 },
      ],
      50
    );
    expect(measured[1]).toEqual({ timestamp: 50, value: null });
    expect(projected[0]).toEqual({ timestamp: 50, value: null });
  });
});

const quota = (
  remaining: number,
  resetAtMs: number | null,
  extra: Partial<QuotaCardState> = {}
): QuotaCardState =>
  ({
    status: 'success',
    windows: [
      {
        id: 'weekly',
        label: 'Weekly',
        usedPercent: 100 - remaining,
        resetAtMs,
        periodHours: 168,
      },
    ],
    checkedAt: now - 60_000,
    ...extra,
  }) as QuotaCardState;

const entries = classifyQuotaFiles([
  { name: 'alpha.json', provider: 'claude' },
  { name: 'bravo.json', provider: 'claude' },
  { name: 'charlie.json', provider: 'codex' },
  { name: 'delta.json', provider: 'claude' },
]);
const states = new Map<string, QuotaCardState | undefined>([
  ['alpha.json', quota(62, now + 2 * day)],
  ['bravo.json', quota(15, now + 3 * day)],
  ['charlie.json', quota(62, now + day)],
  ['delta.json', undefined],
]);
const quotaFor = (entry: (typeof entries)[number]) => states.get(entry.file.name);
const numbers = new Map(
  entries.map((entry, index) => [`${entry.type}:${entry.file.name}`, index + 1])
);

describe('one account identity for every quota chart', () => {
  test('legend labels read provider, file and window, with a stale mark', () => {
    expect(
      formatQuotaSeriesLabel({ provider: 'Claude', account: 'a.json', window: '7-day limit' })
    ).toBe('Claude · a.json · 7-day limit');
    const model = buildAccountSeries(
      entries,
      (entry) =>
        entry.file.name === 'alpha.json'
          ? quota(62, now + day, { stale: true } as Partial<QuotaCardState>)
          : quotaFor(entry),
      'weekly',
      now,
      now + 7 * day,
      numbers
    );
    const byName = (name: string) => model.accounts.find((account) => account.label === name)!;
    expect(quotaAccountLabel(byName('alpha.json'), t)).toBe(
      'Claude · alpha.json · Weekly · Stale snapshot'
    );
    expect(quotaAccountLabel(byName('charlie.json'), t)).toBe('Codex · charlie.json · Weekly');
  });

  test('times omit the zone and state it once in GMT offset notation', () => {
    expect(quotaTimeFormat('en-US').format(now)).not.toMatch(/GMT|UTC|[A-Z]{3}$/);
    expect(quotaTimeZoneLabel(now)).toMatch(/^GMT([+-]\d{1,2}(:\d{2})?)?$/);
  });
});

describe('at-a-glance list', () => {
  test('rows sort by least remaining, then sooner reset, with unknown accounts last', () => {
    const model = buildAccountSeries(entries, quotaFor, 'weekly', now, now + 7 * day, numbers);
    const rows = buildGlanceRows(model.accounts, now);
    expect(rows.map((row) => row.account.label)).toEqual([
      'bravo.json',
      'charlie.json',
      'alpha.json',
      'delta.json',
    ]);
    expect(rows.map((row) => row.remaining)).toEqual([15, 62, 62, null]);
    expect(rows[1].resetAtMs).toBe(now + day);
    expect(rows[3].resetAtMs).toBeNull();
  });

  test('stale snapshots keep their value but report no reset', () => {
    const model = buildAccountSeries(
      entries.slice(0, 1),
      () => quota(40, now + day, { stale: true } as Partial<QuotaCardState>),
      'weekly',
      now,
      now + 7 * day,
      numbers
    );
    const [row] = buildGlanceRows(model.accounts, now);
    expect(row.remaining).toBe(40);
    expect(row.resetAtMs).toBeNull();
    expect(row.stale).toBe(true);
  });

  test('the overview leads with a named list of exact percentages and reset times', () => {
    const markup = renderToStaticMarkup(
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
    const list = markup.match(/<ul[^>]*aria-label="Remaining by account"[\s\S]*?<\/ul>/)?.[0];
    expect(list).toBeDefined();
    const rows = list!.match(/<li[\s\S]*?<\/li>/g) ?? [];
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('bravo.json');
    expect(rows[0]).toContain('15%');
    expect(rows[0]).toContain(`Resets ${quotaTimeFormat('en').format(now + 3 * day)}`);
    expect(rows[3]).toContain('delta.json');
    expect(rows[3]).toContain('No reset reported');
    // The list precedes the chart and replaces its legend: each row toggles its own line.
    expect(markup.indexOf('aria-label="Remaining by account"')).toBeLessThan(
      markup.indexOf('aria-describedby="quota-accounts-readout"')
    );
    expect(markup).not.toContain('aria-label="Chart series"');
    expect(rows[2]).toContain('aria-label="Show 1 · Claude · alpha.json · Weekly in chart"');
    expect(rows[2]).toContain('aria-pressed="true"');
    expect(rows[3]).not.toContain('aria-pressed');
    // Only low remaining is flagged, in words as well as colour.
    expect(rows[0]).toContain('>Low<');
    expect(rows.slice(1).some((row) => row.includes('>Low<'))).toBe(false);
    // No measured history: the plot is labelled as a projection instead of shaded.
    expect(markup).toContain('Projected from the latest snapshot, assuming no further use');
    expect(markup).not.toContain('<pattern');
    expect(markup).toContain('Times in GMT');
    // Reading guidance sits in one disclosure, not as lines above the data.
    expect(markup).toContain('<summary>How to read this chart</summary>');
    expect(markup).toContain('Home and End');
    // Mode switches use the shared segmented control with visible group names.
    expect(markup).toContain('aria-labelledby="quota-view-label"');
    expect(markup).toContain('aria-labelledby="quota-window-label"');
    expect(markup).toMatch(/id="quota-view-label"[^>]*>View</);
  });
});
