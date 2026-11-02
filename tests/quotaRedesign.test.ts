import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { classifyQuotaFiles } from '@/features/quota/logic';
import { resolveQuotaEntryCheck, resolveQuotaRefreshTargets } from '@/features/quota/refreshScope';
import {
  checkingSnapshot,
  failedSnapshot,
  successfulSnapshot,
} from '@/features/quota/snapshotState';
import { buildAccountSeries } from '@/features/quota/quotaAccountSeries';
import type { QuotaCardState } from '@/features/quota/providers';

const now = Date.UTC(2026, 10, 2);
const hour = 3_600_000;
const entries = classifyQuotaFiles([
  { name: 'a', provider: 'claude' },
  { name: 'b', provider: 'claude' },
]);
const quota = (remaining: number, reset: number | null, periodHours = 168) => ({
  status: 'success' as const,
  windows: [
    { id: 'weekly', label: 'Weekly', usedPercent: 100 - remaining, resetAtMs: reset, periodHours },
  ],
});
const numbers = new Map(
  entries.map((entry, index) => [`${entry.type}:${entry.file.name}`, index + 1])
);

describe('quota redesign data contracts', () => {
  test('automatic checks cover the full eligible list, including off-page targets', () => {
    const all = classifyQuotaFiles([
      ...Array.from({ length: 60 }, (_, i) => ({ name: `${i}`, provider: 'claude' })),
      { name: 'disabled', provider: 'claude', disabled: true },
      { name: 'unsupported', provider: 'unknown' },
      { name: 'runtime', provider: 'github-copilot', runtime_only: true },
    ]);
    const targets = resolveQuotaRefreshTargets(
      { sessionGeneration: 1, scope: 'all' },
      { sessionGeneration: 1, filesGeneration: 1, hasError: false, disabled: false },
      all
    );
    expect(targets).toHaveLength(60);
    expect(
      targets.some(({ file }) => ['disabled', 'unsupported', 'runtime'].includes(file.name))
    ).toBe(false);
  });

  test('checking and failure preserve the successful payload and timestamp', () => {
    const original = successfulSnapshot(quota(25, now + hour), now);
    const checking = checkingSnapshot(original, { status: 'loading' });
    expect(checking.status).toBe('success');
    expect(checking.refreshing).toBe(true);
    const failed = failedSnapshot(checking, { status: 'error', error: '429', errorStatus: 429 });
    expect(failed).toMatchObject({
      status: 'success',
      stale: true,
      refreshing: false,
      checkedAt: now,
      errorStatus: 429,
    });
    expect(failed).toHaveProperty('windows', original.windows);
    expect(successfulSnapshot(quota(20, now + hour), now + 1)).toMatchObject({
      stale: false,
      refreshing: false,
      checkedAt: now + 1,
    });
    expect(failedSnapshot(undefined, { status: 'error', error: 'offline' }).status).toBe('error');
  });

  test('account allowances stay independent on a fixed percent scale with one reset', () => {
    const model = buildAccountSeries(
      entries,
      (entry) => (entry === entries[0] ? quota(20, now + hour) : quota(80, now + 2 * hour)),
      'weekly',
      now,
      now + 7 * 24 * hour,
      numbers
    );
    const [a] = model.accounts;
    expect(model.data).toEqual([]);
    expect(model.series[0].points).toEqual([
      { timestamp: now, value: 20 },
      { timestamp: now + hour, value: 20 },
      { timestamp: now + hour, value: 100 },
      { timestamp: now + 7 * 24 * hour, value: 100 },
    ]);
    expect(model.series[1].points).toEqual([
      { timestamp: now, value: 80 },
      { timestamp: now + 2 * hour, value: 80 },
      { timestamp: now + 2 * hour, value: 100 },
      { timestamp: now + 7 * 24 * hour, value: 100 },
    ]);
    expect(a.pool.points.filter((point) => point.restored > 0)).toHaveLength(1);
    expect(
      model.series.every(
        (series) =>
          series.interpolation === 'stepAfter' &&
          series.strokeDasharray &&
          series.marker === 'first'
      )
    ).toBe(true);
    const reversed = buildAccountSeries(
      [...entries].reverse(),
      () => quota(20, now + hour),
      'weekly',
      now,
      now + 24 * hour,
      numbers
    );
    expect(reversed.series.find((series) => series.id === a.id)?.number).toBe(
      model.series[0].number
    );
  });

  test('unknown, failed, unlimited and expired quotas are absent rather than zero', () => {
    for (const state of [undefined, { status: 'error' }, quota(10, now - hour)] as (
      QuotaCardState | undefined
    )[]) {
      const model = buildAccountSeries(entries, () => state, 'weekly', now, now + hour, numbers);
      expect(model.series).toHaveLength(0);
      expect(model.data).toEqual([]);
    }
  });

  test('unlimited allowances never acquire a finite plotted percentage', () => {
    const copilotEntries = classifyQuotaFiles([{ name: 'copilot', provider: 'github-copilot' }]);
    const unlimited = {
      status: 'success' as const,
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
    };
    const model = buildAccountSeries(
      copilotEntries,
      () => unlimited,
      'weekly',
      now,
      now + hour,
      new Map()
    );
    expect(model.accounts[0].remaining).toBeNull();
    expect(model.series).toEqual([]);
  });

  test('session chooses the provider session window without pretending the weekly allowance resets in five hours', () => {
    const state = {
      status: 'success' as const,
      windows: [
        {
          id: 'five-hour',
          label: '5-hour',
          usedPercent: 80,
          resetAtMs: now + hour,
          periodHours: 5,
        },
        {
          id: 'seven-day',
          label: 'Weekly',
          usedPercent: 30,
          resetAtMs: now + 24 * hour,
          periodHours: 168,
        },
      ],
    };
    const session = buildAccountSeries(
      entries,
      () => state,
      'session',
      now,
      now + 5 * hour,
      numbers
    );
    const weekly = buildAccountSeries(
      entries,
      () => state,
      'weekly',
      now,
      now + 7 * 24 * hour,
      numbers
    );
    expect(session.accounts[0].remaining).toBe(20);
    expect(session.accounts[0].window?.label).toBe('5-hour');
    expect(weekly.accounts[0].remaining).toBe(70);
    expect(weekly.accounts[0].window?.label).toBe('Weekly');
  });

  test('stale snapshots retain values but never project a reset', () => {
    const model = buildAccountSeries(
      entries,
      () => ({ ...quota(20, now + hour), stale: true }),
      'weekly',
      now,
      now + 24 * hour,
      numbers
    );
    expect(model.accounts[0].remaining).toBe(20);
    expect(model.accounts[0].pool.points.some((point) => point.restored > 0)).toBe(false);
  });

  test('a monthly reset outside the selected horizon does not acquire a weekly reset', () => {
    const model = buildAccountSeries(
      entries,
      () => quota(20, now + 30 * 24 * hour, 720),
      'weekly',
      now,
      now + 7 * 24 * hour,
      numbers
    );
    expect(model.accounts[0].pool.points.every((point) => point.remaining === 20)).toBe(true);
  });

  test('view changes cannot trigger entry checks and automatic checks use the batch loader', () => {
    const source = readFileSync('src/features/quota/QuotaPage.tsx', 'utf8');
    const autoStart = source.indexOf('const targets = resolveQuotaEntryCheck(');
    const snapshot = { sessionGeneration: 1, filesGeneration: 1, hasError: false, disabled: false };
    expect(resolveQuotaEntryCheck(null, true, snapshot, entries)).toBeNull();
    expect(resolveQuotaEntryCheck(null, false, snapshot, entries)).toEqual(entries);
    expect(resolveQuotaEntryCheck(1, false, snapshot, [...entries].reverse())).toBeNull();
    expect(resolveQuotaEntryCheck(null, false, snapshot, entries.slice(0, 1))).toHaveLength(1);
    expect(
      resolveQuotaEntryCheck(
        1,
        false,
        { ...snapshot, sessionGeneration: 2, filesGeneration: 2 },
        entries
      )
    ).toEqual(entries);
    expect(
      resolveQuotaEntryCheck(null, false, { ...snapshot, hasError: true }, entries)
    ).toBeNull();
    expect(source).toContain('checkedGeneration.current = sessionGeneration');
    expect(source).toContain('await loadQuota(targets)');
    expect(source).not.toContain('useDevinQuotaAutoLoad(');
    expect(autoStart).toBeGreaterThan(0);
    const autoEffect = source.slice(
      autoStart,
      source.indexOf('const pendingRefreshRef', autoStart)
    );
    for (const view of ['pageItems', 'filteredEntries', 'search', 'sortMode'])
      expect(autoEffect).not.toContain(view);
  });
});
