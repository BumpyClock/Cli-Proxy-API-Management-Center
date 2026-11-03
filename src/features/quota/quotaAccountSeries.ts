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
