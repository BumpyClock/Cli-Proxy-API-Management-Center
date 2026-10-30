/**
 * Data freshness for the dashboard's polled sources.
 *
 * A source is "live" only while its last successful response is younger than three
 * polling intervals. Anything else is surfaced, never rendered as healthy.
 */

export type SourceFreshness = 'pending' | 'live' | 'stale' | 'failed';

export interface SourceStatus {
  /** Local receipt time of the last successful response. */
  receivedAt: number | null;
  /** Message from the most recent failed attempt; null after a success. */
  error: string | null;
  loading: boolean;
}

export const STALE_INTERVALS = 3;

export function staleAfterMs(intervalMs: number): number {
  return intervalMs * STALE_INTERVALS;
}

export function classifyFreshness(
  source: SourceStatus,
  intervalMs: number,
  nowMs: number
): SourceFreshness {
  if (source.error) return 'failed';
  if (source.receivedAt === null) return 'pending';
  if (nowMs - source.receivedAt > staleAfterMs(intervalMs)) return 'stale';
  return 'live';
}

const FRESHNESS_RANK: Record<SourceFreshness, number> = {
  live: 0,
  pending: 1,
  stale: 2,
  failed: 3,
};

/** The least trustworthy state among several sources. */
export function worstFreshness(values: SourceFreshness[]): SourceFreshness {
  return values.reduce<SourceFreshness>(
    (worst, value) => (FRESHNESS_RANK[value] > FRESHNESS_RANK[worst] ? value : worst),
    'live'
  );
}

/** Oldest successful receipt among sources, or null if any has never loaded. */
export function oldestReceipt(sources: SourceStatus[]): number | null {
  let oldest: number | null = null;
  for (const source of sources) {
    if (source.receivedAt === null) return null;
    oldest = oldest === null ? source.receivedAt : Math.min(oldest, source.receivedAt);
  }
  return oldest;
}

/**
 * Delay before the next poll. Polls are anchored to the last success so a manual
 * refresh pushes the schedule back instead of causing a duplicate request.
 */
export function nextPollDelay(
  receivedAt: number | null,
  intervalMs: number,
  nowMs: number
): number {
  if (receivedAt === null) return 0;
  const age = nowMs - receivedAt;
  return age >= intervalMs ? 0 : intervalMs - age;
}
