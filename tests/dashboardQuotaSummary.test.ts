import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { QuotaSummaryChart } from '@/features/dashboard/components/QuotaSummaryChart';
import { classifyQuotaFiles } from '@/features/quota/logic';
import { buildAccountSeries } from '@/features/quota/quotaAccountSeries';
import { resolveQuotaEntryCheck, resolveQuotaRefreshTargets } from '@/features/quota/refreshScope';
import { checkingSnapshot, failedSnapshot } from '@/features/quota/snapshotState';
import { useAuthStore, useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { createTestI18n, localeParityIssues, productionLocales } from './helpers/locales';

const now = Date.now();
const hour = 3_600_000;
const files: readonly AuthFileItem[] = [
  { name: 'first.json', provider: 'claude', account: 'never-show-this-secret' },
  { name: 'second.json', provider: 'claude' },
];
const i18n = await createTestI18n();

const snapshot = (remaining: number | null, resetAtMs: number | null = now + hour) => ({
  status: 'success' as const,
  windows: [
    {
      id: 'weekly',
      label: 'Weekly',
      usedPercent: remaining === null ? null : 100 - remaining,
      resetLabel: '',
      resetAtMs,
      periodHours: 168,
    },
  ],
  checkedAt: now - 60_000,
});

const quotaState = useQuotaStore.getState();
const authInitial = useAuthStore.getInitialState();
const quotaInitial = useQuotaStore.getInitialState();
const savedAuthInitial = { ...authInitial };
const savedQuotaInitial = { ...quotaInitial };
let connectionStatus: typeof authInitial.connectionStatus = 'connected';

const render = (items: readonly AuthFileItem[] = files, filesReady = true) => {
  // Zustand's bound hook closes over its original API. Supply and restore SSR hydration state.
  Object.assign(authInitial, { connectionStatus });
  Object.assign(quotaInitial, useQuotaStore.getState());
  try {
    return renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(
          MemoryRouter,
          null,
          createElement(QuotaSummaryChart, { files: items, filesReady })
        )
      )
    );
  } finally {
    Object.assign(authInitial, savedAuthInitial);
    Object.assign(quotaInitial, savedQuotaInitial);
  }
};

beforeEach(() => {
  connectionStatus = 'connected';
  useQuotaStore.getState().clearQuotaCache();
});
afterEach(() => {
  useQuotaStore.setState(quotaState, true);
});

describe('dashboard quota summary rendering', () => {
  test('shows independent percentages, numbered account lines, resets and actual snapshot time', () => {
    useQuotaStore.getState().setClaudeQuota({
      'first.json': snapshot(25),
      'second.json': { ...snapshot(80, now + 2 * hour), checkedAt: now - 120_000 },
    });
    const markup = render();
    expect(markup).toContain('Remaining quota');
    expect(markup).toContain('<strong>25%</strong>');
    expect(markup).toContain('<strong>80%</strong>');
    expect(markup).toContain('first.json · Weekly');
    expect(markup).toContain('second.json · Weekly');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toMatch(/aria-hidden="true">1<\/span>/);
    expect(markup).toMatch(/aria-hidden="true">2<\/span>/);
    expect(markup).toContain(i18n.t('redesign.chart.table'));
    expect(markup).not.toContain('<table');
    expect(markup).not.toContain('105%');
    expect(markup).toContain('2 of 2 eligible accounts measured');
    expect(markup).toContain('Oldest displayed snapshot');
    expect(markup).toContain(`dateTime="${new Date(now - 120_000).toISOString()}"`);
    expect(markup).toContain('href="/quota"');
    expect(markup).toContain('No automatic quota polling.');
    expect(markup).toContain('No usage history.');
    expect(markup).not.toContain('never-show-this-secret');
    expect(markup).not.toContain('redesign.');
    expect(markup).not.toContain('NaN');
  });

  test('missing, failed, expired and successful-but-unreported accounts never become zero', () => {
    for (const state of [
      undefined,
      { status: 'error' as const, windows: [], error: 'private response' },
      snapshot(null),
      snapshot(20, now - hour),
    ]) {
      useQuotaStore.getState().setClaudeQuota(state ? { 'first.json': state } : {});
      const markup = render();
      expect(markup).toContain('0 of 2 eligible accounts measured');
      expect(markup).not.toContain('<strong>0%</strong>');
      expect(markup).not.toContain('<td>0%</td>');
      expect(markup).not.toContain('aria-pressed=');
      expect(markup).not.toContain('private response');
    }
  });

  test('unlimited provider allowances do not acquire finite percentages', () => {
    useQuotaStore.getState().setCopilotQuota({
      'unlimited.json': {
        status: 'success',
        data: {
          plan: 'individual',
          resetAtMs: now + hour,
          resources: [
            {
              id: 'premium_interactions',
              remainingPercent: null,
              remaining: null,
              entitlement: null,
              unlimited: true,
            },
          ],
        },
      },
    });
    const markup = render([{ name: 'unlimited.json', provider: 'github-copilot' }]);
    expect(markup).toContain('0 of 1 eligible accounts measured');
    expect(markup).not.toContain('<strong>0%</strong>');
    expect(markup).not.toContain('<strong>100%</strong>');
    expect(markup).not.toContain('aria-pressed=');
  });

  test('a real reported zero stays zero, while an unreported neighbour is absent', () => {
    useQuotaStore.getState().setClaudeQuota({ 'first.json': snapshot(0) });
    const markup = render();
    expect(markup).toContain('<strong>0%</strong>');
    expect(markup).toContain('1 of 2 eligible accounts measured');
    expect(markup).not.toContain('second.json · Weekly');
  });

  test('checking keeps cached measurements and announces pending status', () => {
    const cached = snapshot(35);
    useQuotaStore.getState().setClaudeQuota({
      'first.json': { ...cached, ...checkingSnapshot(cached, { status: 'loading' }) },
    });
    const markup = render();
    expect(markup).toContain('<strong>35%</strong>');
    expect(markup).toContain('Checking eligible accounts.');
    expect(markup).toContain('Cached snapshots stay visible.');
    expect(markup).toContain('disabled=""');
  });

  test('failed refresh keeps and labels stale measurements without projecting a reset', () => {
    const cached = snapshot(35);
    useQuotaStore.getState().setClaudeQuota({
      'first.json': {
        ...cached,
        ...failedSnapshot(cached, { status: 'error', error: 'provider unavailable' }),
      },
    });
    const markup = render();
    expect(markup).toContain('<strong>35%</strong>');
    expect(markup).toContain('first.json · Weekly · Stale');
    expect(markup).toContain('Quota checks failed');
    expect(markup).not.toContain('<td>100%</td>');
    expect(markup).toContain(`dateTime="${new Date(cached.checkedAt).toISOString()}"`);
  });

  test('disabled and unsupported credentials count as skipped without plotted values', () => {
    useQuotaStore.getState().setClaudeQuota({
      'disabled.json': snapshot(90),
    });
    const markup = render([
      { name: 'disabled.json', provider: 'claude', disabled: true },
      { name: 'unsupported.json', provider: 'unknown' },
    ]);
    expect(markup).toContain('0 of 0 eligible accounts measured');
    expect(markup).toContain('2 skipped');
    expect(markup).toContain('No eligible accounts.');
    expect(markup).not.toContain('<strong>90%</strong>');
    expect(markup).toContain('disabled=""');
  });

  test('waiting and disconnected states do not advertise successful fresh checks', () => {
    const waiting = render([], false);
    expect(waiting).toContain('Waiting for credential files.');
    expect(waiting).toContain('disabled=""');
    expect(waiting).not.toContain('<time');
    useQuotaStore.getState().setClaudeQuota({ 'first.json': snapshot(25) });
    connectionStatus = 'disconnected';
    const offline = render();
    expect(offline).toContain('Connect to check quota.');
    expect(offline).not.toContain('first.json');
    expect(offline).not.toContain('<strong>25%</strong>');
  });

  test('legacy cached values without a successful-check timestamp say time unavailable', () => {
    const cached = snapshot(25);
    const withoutTime = { ...cached, checkedAt: undefined };
    useQuotaStore.getState().setClaudeQuota({ 'first.json': withoutTime });
    const markup = render();
    expect(markup).toContain('<strong>25%</strong>');
    expect(markup).toContain('Snapshot time unavailable.');
    expect(markup).not.toContain('<time');
  });
});

describe('dashboard quota request and projection contracts', () => {
  test('entry waits for accepted files, checks every eligible account once and ignores file polling', () => {
    const entries = classifyQuotaFiles([
      ...Array.from({ length: 60 }, (_, i) => ({ name: `${i}.json`, provider: 'claude' })),
      { name: 'disabled', provider: 'claude', disabled: true },
      { name: 'unsupported', provider: 'unknown' },
    ]);
    const scope = { sessionGeneration: 4, filesGeneration: 4, hasError: false, disabled: false };
    expect(resolveQuotaEntryCheck(null, true, scope, entries)).toBeNull();
    expect(
      resolveQuotaEntryCheck(null, false, { ...scope, filesGeneration: null }, entries)
    ).toBeNull();
    const first = resolveQuotaEntryCheck(null, false, scope, entries);
    expect(first).toHaveLength(60);
    const polledFiles = entries.map((entry) => ({ ...entry, file: { ...entry.file } })).reverse();
    expect(resolveQuotaEntryCheck(4, false, scope, polledFiles)).toBeNull();
    expect(resolveQuotaEntryCheck(4, false, scope, [])).toBeNull();
    expect(resolveQuotaEntryCheck(null, false, { ...scope, disabled: true }, entries)).toBeNull();
    expect(
      resolveQuotaEntryCheck(null, false, { ...scope, filesGeneration: 3 }, entries)
    ).toBeNull();
    expect(
      resolveQuotaEntryCheck(
        4,
        false,
        { ...scope, sessionGeneration: 5, filesGeneration: 5 },
        entries
      )
    ).toHaveLength(60);
    expect(resolveQuotaEntryCheck(null, false, scope, entries)).toHaveLength(60);
    expect(
      resolveQuotaRefreshTargets({ sessionGeneration: 3, scope: 'all' }, scope, entries)
    ).toEqual([]);
  });

  test('only a real next reset produces a step, and account percentages never combine', () => {
    const entries = classifyQuotaFiles([...files]);
    const states = [snapshot(25), snapshot(80, now + 2 * hour)];
    const model = buildAccountSeries(
      entries,
      (entry) => states[entries.indexOf(entry)],
      'weekly',
      now,
      now + 7 * 24 * hour,
      new Map(entries.map((entry, index) => [`${entry.type}:${entry.file.name}`, index + 1]))
    );
    const end = now + 7 * 24 * hour;
    expect(model.data).toEqual([]);
    expect(model.series[0].points).toEqual([
      { timestamp: now, value: 25 },
      { timestamp: now + hour, value: 25 },
      { timestamp: now + hour, value: 100 },
      { timestamp: end, value: 100 },
    ]);
    expect(model.series[1].points).toEqual([
      { timestamp: now, value: 80 },
      { timestamp: now + 2 * hour, value: 80 },
      { timestamp: now + 2 * hour, value: 100 },
      { timestamp: end, value: 100 },
    ]);
    expect(model.series.map((series) => series.number)).toEqual([1, 2]);
    expect(
      model.series.every(
        (series) =>
          series.interpolation === 'stepAfter' &&
          series.strokeDasharray &&
          series.marker === 'first'
      )
    ).toBe(true);
  });

  test('component delegates fetching and interpretation; charts never create list requests or quota timers', () => {
    const source = readFileSync('src/features/dashboard/components/QuotaSummaryChart.tsx', 'utf8');
    expect(source).toContain('useQuotaBatchLoader()');
    expect(source).toContain('resolveQuotaEntryCheck(');
    expect(source).toContain('resolveQuotaRefreshTargets(');
    expect(source).toContain('buildAccountSeries(');
    expect(source).toContain('getQuotaDataAdapter(entry.type).storeSelector(state)');
    expect(source).toContain('key={generation}');
    expect(source).toContain('yDomain={[0, 100]}');
    expect(source).toContain('<TimeSeriesChart');
    for (const forbidden of [
      'authFilesApi',
      'setInterval',
      'setTimeout',
      'fetchQuota(',
      'apiClient.',
      'usedPercent',
    ]) {
      expect(source).not.toContain(forbidden);
    }
    const entryEffect = source.slice(
      source.indexOf('useEffect(() =>'),
      source.indexOf('const now = useNow()')
    );
    expect(entryEffect).toContain('checkedGeneration.current = generation');
    expect(entryEffect).toContain('useQuotaStore.getState().cacheGeneration');
    expect(entryEffect).not.toContain('quotas');
    expect(entryEffect).not.toContain('now,');
  });

  test('shipped dashboard quota translations have key and interpolation parity', () => {
    expect(localeParityIssues(productionLocales, ['redesign.dashboardQuota'])).toEqual([]);
  });
});
