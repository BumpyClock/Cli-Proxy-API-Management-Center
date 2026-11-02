/** Provider-owned observations shared by recovery ordering and quota projections. */
export interface QuotaWindowObservation {
  id: string;
  label: string;
  remainingPercent: number | null;
  resetAtMs: number | null;
  periodHours: number | null;
  unlimited: boolean | null;
  preferredFor: 'session' | 'weekly' | null;
  recovers: boolean;
}

export interface QuotaResetCreditObservation {
  id: string;
  grantedAtMs: number | null;
  expiresAtMs: number;
}

export interface QuotaLimitObservation {
  label: string;
  remaining: number;
}

export interface QuotaObservations {
  windows: QuotaWindowObservation[];
  limits: QuotaLimitObservation[];
  resetCredits: QuotaResetCreditObservation[];
}

/** Normalize optional provider window metadata once, before consumers select a window. */
export function observeWindow(
  input: Pick<
    QuotaWindowObservation,
    'id' | 'label' | 'remainingPercent' | 'resetAtMs' | 'periodHours'
  > &
    Partial<Pick<QuotaWindowObservation, 'unlimited' | 'preferredFor' | 'recovers'>>
): QuotaWindowObservation {
  return {
    unlimited: false,
    preferredFor: null,
    recovers: true,
    ...input,
    remainingPercent:
      input.remainingPercent !== null && Number.isFinite(input.remainingPercent)
        ? Math.min(100, Math.max(0, input.remainingPercent))
        : null,
    resetAtMs:
      input.resetAtMs !== null && Number.isFinite(input.resetAtMs) ? input.resetAtMs : null,
    periodHours:
      input.periodHours !== null && Number.isFinite(input.periodHours) && input.periodHours > 0
        ? input.periodHours
        : null,
  };
}

export function observeQuota(
  windows: QuotaWindowObservation[],
  resetCredits: QuotaResetCreditObservation[] = [],
  limits: QuotaLimitObservation[] = windows.flatMap((window) =>
    window.remainingPercent === null
      ? []
      : [{ label: window.label, remaining: window.remainingPercent }]
  )
): QuotaObservations {
  return { windows, limits, resetCredits };
}

export const XAI_WEEKLY_ROW_ID = 'xai:weekly';

/** Preserve card-row identity even when a legacy reset-credit payload omits its id. */
export function resetCreditRowId(
  credit: { id?: string; expiresAt?: string },
  index: number
): string {
  return credit.id || `${credit.expiresAt}-${index}`;
}

/** Longest reported reset window fitting the span; earliest reset breaks ties. */
export function pickLaneWindow<
  T extends { resetAtMs?: number | null; periodHours?: number | null },
>(windows: readonly T[], maxPeriodHours?: number): T | null {
  const usable = windows.filter(
    (window) => window.resetAtMs != null && Number.isFinite(window.resetAtMs)
  );
  if (!usable.length) return null;
  const periodOf = (window: T) =>
    window.periodHours != null && window.periodHours > 0 ? window.periodHours : 0;
  const fitting =
    maxPeriodHours === undefined
      ? usable
      : usable.filter((window) => periodOf(window) <= maxPeriodHours);
  return (fitting.length ? fitting : usable).reduce((best, window) => {
    const difference = periodOf(window) - periodOf(best);
    return difference > 0 ||
      (difference === 0 && (window.resetAtMs ?? Infinity) < (best.resetAtMs ?? Infinity))
      ? window
      : best;
  });
}

/** Snapshot selection also supports non-recurring allowances with no reported reset. */
export function selectQuotaWindow(
  observations: QuotaObservations,
  maxPeriodHours?: number
): QuotaWindowObservation | null {
  const preferredFor = maxPeriodHours !== undefined && maxPeriodHours <= 5 ? 'session' : 'weekly';
  const preferred = observations.windows.find(
    (window) =>
      window.preferredFor === preferredFor &&
      (window.resetAtMs !== null || window.periodHours === null) &&
      (window.periodHours === null ||
        maxPeriodHours === undefined ||
        window.periodHours <= maxPeriodHours)
  );
  return (
    preferred ??
    pickLaneWindow(observations.windows, maxPeriodHours) ??
    observations.windows.find((window) => window.periodHours === null) ??
    null
  );
}
