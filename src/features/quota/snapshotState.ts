import type { QuotaCardState } from './providers/types';

/** Retain the provider's concrete successful payload while checking or after failure. */
export function checkingSnapshot(
  previous: QuotaCardState | undefined,
  loading: QuotaCardState
): QuotaCardState {
  return previous?.status === 'success' ? { ...previous, refreshing: true } : loading;
}

export function failedSnapshot(
  previous: QuotaCardState | undefined,
  error: QuotaCardState
): QuotaCardState {
  return previous?.status === 'success'
    ? {
        ...previous,
        refreshing: false,
        stale: true,
        error: error.error,
        errorStatus: error.errorStatus,
      }
    : error;
}

export function successfulSnapshot(
  snapshot: QuotaCardState,
  checkedAt = Date.now()
): QuotaCardState {
  return { ...snapshot, refreshing: false, stale: false, checkedAt };
}
