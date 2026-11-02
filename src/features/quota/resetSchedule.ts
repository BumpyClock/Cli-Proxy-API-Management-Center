import { HOUR_MS } from '@/utils/time/durations';
import type { QuotaCardState, QuotaProviderType } from './providers/types';
import { getQuotaObservations } from './providers/registry';

export interface QuotaRowInstant {
  rowId: string;
  atMs: number;
  kind: 'window' | 'credit';
}

/** Recovery ordering uses every eligible observation, not the timeline's single selected window. */
export function collectQuotaRowInstants(
  provider: QuotaProviderType,
  quota: QuotaCardState | undefined
): QuotaRowInstant[] {
  const observations = getQuotaObservations(provider, quota);
  return [
    ...observations.windows.flatMap<QuotaRowInstant>((window) =>
      window.recovers && window.resetAtMs !== null
        ? [{ rowId: window.id, atMs: window.resetAtMs, kind: 'window' }]
        : []
    ),
    ...observations.resetCredits.map<QuotaRowInstant>((credit) => ({
      rowId: credit.id,
      atMs: credit.expiresAtMs,
      kind: 'credit',
    })),
  ];
}

/** Ignore elapsed instants; break ties on row id so emphasis is deterministic. */
export function pickSoonestRowId(
  instants: readonly QuotaRowInstant[],
  nowMs: number
): string | null {
  let best: QuotaRowInstant | null = null;
  for (const instant of instants) {
    if (instant.atMs <= nowMs) continue;
    if (
      best === null ||
      instant.atMs < best.atMs ||
      (instant.atMs === best.atMs && instant.rowId < best.rowId)
    ) {
      best = instant;
    }
  }
  return best?.rowId ?? null;
}

/** Only the final hour is urgent; exactly one hour remaining is deliberately excluded. */
export function pickUrgentRowId(
  instants: readonly QuotaRowInstant[],
  nowMs: number
): string | null {
  return pickSoonestRowId(
    instants.filter((instant) => instant.atMs - nowMs > 0 && instant.atMs - nowMs < HOUR_MS),
    nowMs
  );
}

export function nextRecoveryMs(
  provider: QuotaProviderType,
  quota: QuotaCardState | undefined,
  nowMs: number
): number | null {
  let best: number | null = null;
  for (const instant of collectQuotaRowInstants(provider, quota)) {
    if (instant.atMs <= nowMs) continue;
    if (best === null || instant.atMs < best) best = instant.atMs;
  }
  return best;
}
