import type { QuotaTabId } from './constants';
import { canRefreshQuotaAfterList, filterEntriesByTab, type QuotaFileEntry } from './logic';

export interface QuotaRefreshIntent {
  sessionGeneration: number;
  scope: QuotaTabId;
}

interface QuotaRefreshSnapshot {
  sessionGeneration: number;
  filesGeneration: number | null;
  hasError: boolean;
  disabled: boolean;
}

/** Resolve only against the current page recomputed from the accepted auth-file list. */
export function resolveQuotaRefreshTargets(
  intent: QuotaRefreshIntent,
  snapshot: QuotaRefreshSnapshot,
  pageItems: QuotaFileEntry[]
): QuotaFileEntry[] {
  if (
    !canRefreshQuotaAfterList(
      intent.sessionGeneration,
      snapshot.sessionGeneration,
      snapshot.filesGeneration,
      snapshot.hasError,
      snapshot.disabled
    )
  ) {
    return [];
  }
  return filterEntriesByTab(pageItems, intent.scope);
}
