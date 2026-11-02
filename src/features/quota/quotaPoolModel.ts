import type { QuotaWindowObservation } from './providers/observations';

export type PoolQuotaObservation = Pick<
  QuotaWindowObservation,
  'remainingPercent' | 'resetAtMs' | 'unlimited'
>;

export interface QuotaPoolPoint {
  atMs: number;
  remaining: number;
  restored: number;
}

export interface QuotaPool {
  measuredCount: number;
  capacity: number;
  remaining: number | null;
  nextResetAtMs: number | null;
  nextResetGain: number;
  points: QuotaPoolPoint[];
}

/** Equal account equivalents, not transferable credits or plan-weighted capacity.
 * Only the next reported reset is known. No historical usage or repeat resets are inferred.
 */
export function buildQuotaPool(
  observations: readonly PoolQuotaObservation[],
  now: number,
  endMs: number
): QuotaPool {
  const measured = observations.filter(
    (window) =>
      window.unlimited === false &&
      window.remainingPercent !== null &&
      (window.resetAtMs === null || window.resetAtMs > now)
  );
  const capacity = measured.length * 100;
  if (measured.length === 0) {
    return {
      measuredCount: 0,
      capacity: 0,
      remaining: null,
      nextResetAtMs: null,
      nextResetGain: 0,
      points: [],
    };
  }

  const remaining = measured.reduce((sum, window) => sum + (window.remainingPercent ?? 0), 0);
  const resets = new Map<number, number>();
  measured.forEach((window) => {
    if (window.resetAtMs === null || window.resetAtMs <= now) return;
    resets.set(
      window.resetAtMs,
      (resets.get(window.resetAtMs) ?? 0) + 100 - (window.remainingPercent ?? 0)
    );
  });
  const events = [...resets].sort(([a], [b]) => a - b);
  const points: QuotaPoolPoint[] = [{ atMs: now, remaining, restored: 0 }];
  let projected = remaining;
  events.forEach(([atMs, restored]) => {
    if (atMs > endMs) return;
    points.push({ atMs, remaining: projected, restored: 0 });
    projected += restored;
    points.push({ atMs, remaining: projected, restored });
  });
  if (endMs > now) points.push({ atMs: endMs, remaining: projected, restored: 0 });

  return {
    measuredCount: measured.length,
    capacity,
    remaining,
    nextResetAtMs: events[0]?.[0] ?? null,
    nextResetGain: events[0]?.[1] ?? 0,
    points,
  };
}

/** SVG path clipped to the selected date range. Past data is deliberately absent. */
export function quotaPoolPath(
  pool: QuotaPool,
  startMs: number,
  endMs: number,
  width: number,
  height: number
): string {
  if (pool.capacity === 0 || endMs <= startMs || !pool.points.length) return '';
  const points = pool.points;
  if (points[0].atMs >= endMs) return '';
  const x = (at: number) => ((at - startMs) / (endMs - startMs)) * width;
  const y = (value: number) => height - (value / pool.capacity) * height;
  const visible = points.filter((point) => point.atMs >= startMs && point.atMs <= endMs);
  const earlier = points.filter((point) => point.atMs < startMs);
  const before = earlier[earlier.length - 1];
  if (before) visible.unshift({ ...before, atMs: startMs });
  return visible
    .map(
      (point, index) =>
        `${index ? 'L' : 'M'}${x(point.atMs).toFixed(2)},${y(point.remaining).toFixed(2)}`
    )
    .join(' ');
}
