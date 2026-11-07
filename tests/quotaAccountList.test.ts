import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { resolveSeriesStrokes } from '@/components/ui/TimeSeriesChart.model';
import { QuotaGlanceList } from '@/features/quota/components/QuotaGlanceList';
import { QuotaOverview } from '@/features/quota/components/QuotaOverview';
import { classifyQuotaFiles, type QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';
import { buildAccountSeries, buildGlanceRows } from '@/features/quota/quotaAccountSeries';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();
const hour = 3_600_000;
const day = 24 * hour;
const now = Date.now();
const end = now + 7 * day;

const snapshot = (remaining: number, resetAtMs: number, extra: Partial<QuotaCardState> = {}) =>
  ({
    status: 'success',
    windows: [
      { id: 'weekly', label: 'Weekly', usedPercent: 100 - remaining, resetAtMs, periodHours: 168 },
    ],
    checkedAt: now - 60_000,
    ...extra,
  }) as QuotaCardState;

const entries = classifyQuotaFiles([
  { name: 'same-a.json', provider: 'claude' },
  { name: 'same-b.json', provider: 'claude' },
  { name: 'distinct.json', provider: 'codex' },
  { name: 'retained.json', provider: 'claude' },
  { name: 'never.json', provider: 'claude' },
]);
const states: Record<string, QuotaCardState | undefined> = {
  'same-a.json': snapshot(62, now + 2 * day),
  'same-b.json': snapshot(62, now + 2 * day),
  'distinct.json': snapshot(20, now + day),
  'retained.json': snapshot(45, now + day, {
    stale: true,
    error: 'upstream 503',
  } as Partial<QuotaCardState>),
  'never.json': undefined,
};
const quotaFor = (entry: QuotaFileEntry) => states[entry.file.name];
const numbers = new Map(
  entries.map((entry, index) => [`${entry.type}:${entry.file.name}`, index + 1])
);
const wrap = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
const rowsOf = (markup: string) => {
  const list = markup.match(/<ul[^>]*aria-label="Remaining by account"[\s\S]*?<\/ul>/)?.[0];
  return list?.match(/<li[\s\S]*?<\/li>/g) ?? [];
};
const rowFor = (rows: string[], name: string) => rows.find((row) => row.includes(`>${name}<`))!;

describe('quota account list', () => {
  const markup = wrap(
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
  );
  const rows = rowsOf(markup);

  test('one row per account, and no second breakdown table', () => {
    expect(rows).toHaveLength(5);
    expect(markup).not.toContain('<table');
    expect(markup).not.toContain('Account breakdown');
    expect(markup).not.toContain('aria-label="Chart series"');
  });

  test('each swatch shows the stroke the chart draws for that account', () => {
    const shared = 'stroke="var(--text-secondary)"';
    expect(rowFor(rows, 'same-a.json')).toContain(shared);
    expect(rowFor(rows, 'same-b.json')).toContain(shared);
    const distinct = rowFor(rows, 'distinct.json');
    const number = distinct.match(/aria-hidden="true">(\d+)<\/span>/)?.[1];
    expect(distinct).toContain(`stroke="var(--chart-${number})"`);
    expect(rowFor(rows, 'never.json')).not.toContain('<svg class');
    expect(markup).toContain('1,2 overlap, drawn as one grey line');
  });

  test('plotted rows toggle their line; unplotted rows have no toggle', () => {
    const toggle = rowFor(rows, 'same-a.json').match(/<button[^>]*aria-pressed[^>]*>/)?.[0];
    expect(toggle).toContain('aria-pressed="true"');
    expect(toggle).toContain('aria-label="Show 1 · Claude · same-a.json · Weekly in chart"');
    expect(rowFor(rows, 'never.json')).not.toContain('aria-pressed');
  });

  test('rows carry the snapshot state, failure detail and their own refresh', () => {
    expect(rowFor(rows, 'same-a.json')).toContain('Checked ');
    const retained = rowFor(rows, 'retained.json');
    expect(retained).toContain('Stale snapshot');
    expect(retained).toContain('upstream 503');
    expect(retained).toContain('<strong>45%</strong>');
    expect(rowFor(rows, 'never.json')).toContain('Not checked yet');
    for (const row of rows) expect(row).toMatch(/aria-label="Refresh [^"]+\.json"/);
  });

  test('only remaining under 30% is flagged, and it says so in words', () => {
    expect(rowFor(rows, 'distinct.json')).toContain('>Low<');
    expect(rowFor(rows, 'distinct.json')).toContain('data-tone="low"');
    for (const name of ['same-a.json', 'retained.json', 'never.json']) {
      expect(rowFor(rows, name)).not.toContain('>Low<');
      expect(rowFor(rows, name)).not.toContain('data-tone');
    }
  });

  test('attention states are a pill with icon and words; a healthy row has none', () => {
    const pill = (row: string) =>
      [...row.matchAll(/data-state="(\w+)"><svg[\s\S]*?<\/svg>([^<]+)</g)].map((m) => [m[1], m[2]]);
    expect(pill(rowFor(rows, 'distinct.json'))).toEqual([['problem', 'Low']]);
    expect(pill(rowFor(rows, 'retained.json'))).toEqual([['stale', 'Stale snapshot']]);
    expect(pill(rowFor(rows, 'never.json'))).toEqual([['unknown', 'Not checked yet']]);
    expect(pill(rowFor(rows, 'same-a.json'))).toEqual([]);
    // A stale snapshot has no reset projection, so its row names no reset time.
    expect(rowFor(rows, 'retained.json')).not.toContain('Resets ');
  });

  test('a failed check is a problem pill with its error, never a checked time', () => {
    const failed = classifyQuotaFiles([{ name: 'failed.json', provider: 'claude' }]);
    const state = {
      status: 'error',
      error: 'upstream 500',
      checkedAt: now - day,
    } as QuotaCardState;
    const model = buildAccountSeries(failed, () => state, 'weekly', now, end, new Map());
    const row = rowsOf(
      wrap(
        createElement(QuotaGlanceList, {
          rows: buildGlanceRows(model.accounts, now),
          formatTime: (at: number) => new Date(at).toISOString(),
          formatPercent: (value: number) => `${value}%`,
          controls: {
            hidden: new Set(),
            onToggle: () => {},
            canRefresh: () => true,
            onRefresh: () => {},
          },
        })
      )
    )[0];
    expect(row).toMatch(/data-state="problem"><svg[\s\S]*?<\/svg>Check failed</);
    expect(row).toContain('upstream 500');
    expect(row).not.toContain('Checked ');
  });

  test('line keys lead with the snapshot dot, as each plotted line starts', () => {
    const key = rowFor(rows, 'same-a.json').match(/<svg[^>]*width="30"[\s\S]*?<\/svg>/)?.[0];
    expect(key).toContain('<circle');
    expect(key).toContain('stroke-dasharray="5 4"');
  });
});

describe('compact dashboard list', () => {
  test('rows keep identity and values without toggles or refresh actions', () => {
    const model = buildAccountSeries(entries, quotaFor, 'weekly', now, end, numbers);
    const { strokes } = resolveSeriesStrokes(model.series, model.data, {
      xDomain: [now, end],
      yDomain: [0, 100],
      forecast: true,
    });
    const markup = wrap(
      createElement(QuotaGlanceList, {
        rows: buildGlanceRows(model.accounts, now),
        strokes,
        formatTime: (value: number) => new Date(value).toISOString(),
        formatPercent: (value: number) => `${value}%`,
        layout: 'columns',
      })
    );
    expect(markup).not.toContain('<button');
    expect(markup).toContain('title="Claude · same-a.json · Weekly"');
    expect(markup).toContain('data-layout="columns"');
    expect(markup).not.toContain('upstream 503');
  });
});
