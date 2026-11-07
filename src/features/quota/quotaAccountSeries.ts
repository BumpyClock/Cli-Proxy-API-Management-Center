import type { TimeSeriesPoint, TimeSeriesSeries } from '@/components/ui/TimeSeriesChart.types';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import type { QuotaFileEntry } from './logic';
import type { QuotaCardState } from './providers';
import { getQuotaObservations } from './providers/registry';
import { selectQuotaWindow } from './providers/observations';
import { buildQuotaPool } from './quotaPoolModel';
import type { TimelineMode } from './quotaTimelineModel';

export function buildAccountSeries(
  entries: readonly QuotaFileEntry[],
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined,
  mode: TimelineMode,
  now: number,
  end: number,
  numbers: ReadonlyMap<string, number>
) {
  const accounts = entries.map((entry) => {
    const quota = quotaFor(entry);
    const id = `${entry.type}:${getQuotaCacheKey(entry.file)}`;
    const window = selectQuotaWindow(
      getQuotaObservations(entry.type, quota),
      mode === 'session' ? 5 : undefined
    );
    // The provider owns reset semantics. Non-recurring and expired windows do not reset.
    const pool = buildQuotaPool(
      window
        ? [{ ...window, resetAtMs: window.recovers && !quota?.stale ? window.resetAtMs : null }]
        : [],
      now,
      end
    );
    const expired =
      window?.resetAtMs !== null && window?.resetAtMs !== undefined && window.resetAtMs <= now;
    return {
      entry,
      quota,
      id,
      number: numbers.get(id) ?? 1,
      label: getQuotaDisplayName(entry.file),
      window,
      remaining: expired ? null : pool.remaining,
      pool,
    };
  });
  const measured = accounts.filter((account) => account.remaining !== null);
  // Preserve the data/series prop shape. Quota leaves dense data empty and owns its samples
  // per series, so another account's reset never allocates a value for this account.
  const data: TimeSeriesPoint[] = [];
  const series = measured.map(
    ({ id, label, number, pool }) =>
      ({
        id,
        label,
        number,
        color: `var(--chart-${((number - 1) % 6) + 1})`,
        interpolation: 'stepAfter',
        strokeDasharray: ['6 4', '2 4', '8 3 2 3'][(number - 1) % 3],
        marker: 'first',
        points: pool.points.map((point) => ({ timestamp: point.atMs, value: point.remaining })),
      }) satisfies TimeSeriesSeries
  );
  return { accounts, data, series };
}

export interface ResetMarker {
  atMs: number;
  /** Series numbers resetting at this time, ascending. */
  numbers: number[];
  /** Every measured account resets here. */
  all: boolean;
}

/**
 * Future resets that the plotted projections actually step at, merged when they fall
 * within `mergeMs` of each other so their direct labels never overprint.
 */
export function resetMarkers(
  accounts: ReturnType<typeof buildAccountSeries>['accounts'],
  now: number,
  end: number,
  mergeMs: number
): ResetMarker[] {
  const measured = accounts.filter((account) => account.remaining !== null);
  const resets = measured
    .flatMap(({ window, quota, number }) =>
      window?.recovers &&
      !quota?.stale &&
      window.resetAtMs !== null &&
      window.resetAtMs > now &&
      window.resetAtMs <= end
        ? [{ atMs: window.resetAtMs, number }]
        : []
    )
    .sort((a, b) => a.atMs - b.atMs);
  const markers: ResetMarker[] = [];
  resets.forEach((reset) => {
    const previous = markers[markers.length - 1];
    if (previous && reset.atMs - previous.atMs <= mergeMs) previous.numbers.push(reset.number);
    else markers.push({ atMs: reset.atMs, numbers: [reset.number], all: false });
  });
  return markers.map((marker) => {
    const numbers = [...new Set(marker.numbers)].sort((a, b) => a - b);
    return { ...marker, numbers, all: numbers.length === measured.length };
  });
}

export type QuotaAccount = ReturnType<typeof buildAccountSeries>['accounts'][number];

export interface GlanceRow {
  account: QuotaAccount;
  /** Exact reported percentage; null is unknown, never zero. */
  remaining: number | null;
  /** The next reset the projection steps at, or null when none is reported or the value is stale. */
  resetAtMs: number | null;
  stale: boolean;
}

/** Resets shown as the same minute tie, so equal-looking rows keep their series order. */
const resetMinute = (atMs: number | null) => (atMs === null ? Infinity : Math.floor(atMs / 60_000));

/**
 * One row per account for the at-a-glance list: least remaining first, unknown last,
 * ties broken by the sooner reset and then the stable series number.
 */
export function buildGlanceRows(accounts: readonly QuotaAccount[], now: number): GlanceRow[] {
  return accounts
    .map((account) => {
      const { window, quota } = account;
      const stale = Boolean(quota?.stale);
      const resetAtMs =
        window?.recovers && !stale && window.resetAtMs !== null && window.resetAtMs > now
          ? window.resetAtMs
          : null;
      return { account, remaining: account.remaining, resetAtMs, stale };
    })
    .sort(
      (a, b) =>
        (a.remaining ?? Infinity) - (b.remaining ?? Infinity) ||
        resetMinute(a.resetAtMs) - resetMinute(b.resetAtMs) ||
        a.account.number - b.account.number
    );
}
