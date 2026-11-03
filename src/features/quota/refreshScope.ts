import type { QuotaTabId } from './constants';
import { canRefreshQuotaAfterList, filterEntriesByTab, type QuotaFileEntry } from './logic';
import { getQuotaDataAdapter } from './providers/registry';

export function observableQuotaEntries(entries: QuotaFileEntry[]): QuotaFileEntry[] {
  return entries.filter(({ file, type }) => getQuotaDataAdapter(type).canObserve?.(file) ?? true);
}

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

/** Resolve against eligible entries from the accepted auth-file snapshot. */
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
  return observableQuotaEntries(filterEntriesByTab(pageItems, intent.scope));
}

/** A route mount checks once per connection; view controls never enter this decision. */
export function resolveQuotaEntryCheck(
  checkedGeneration: number | null,
  loading: boolean,
  snapshot: QuotaRefreshSnapshot,
  entries: QuotaFileEntry[]
): QuotaFileEntry[] | null {
  if (
    loading ||
    checkedGeneration === snapshot.sessionGeneration ||
    !canRefreshQuotaAfterList(
      snapshot.sessionGeneration,
      snapshot.sessionGeneration,
      snapshot.filesGeneration,
      snapshot.hasError,
      snapshot.disabled
    )
  )
    return null;
  return resolveQuotaRefreshTargets(
    { sessionGeneration: snapshot.sessionGeneration, scope: 'all' },
    snapshot,
    entries
  );
}
