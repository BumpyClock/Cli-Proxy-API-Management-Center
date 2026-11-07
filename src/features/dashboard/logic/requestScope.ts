import type { SourceStatus } from './freshness';

/**
 * What the Requests total actually sums. It adds two sources: credential files
 * (`auth-files` recent requests) and provider keys (`api-key-usage`). A source counts once
 * it has answered at least once; a later failure keeps its last answer, which the source
 * stamp marks as stale.
 */
export type RequestScope =
  | { kind: 'all' }
  | { kind: 'none' }
  | {
      kind: 'credentialFilesOnly' | 'providerKeysOnly';
      /** Why the other source is missing from the total. */
      missing: 'failed' | 'loading';
    };

export interface RequestScopeSources {
  credentials: SourceStatus;
  traffic: SourceStatus;
}

const included = (source: SourceStatus) => source.receivedAt !== null;
const missingReason = (source: SourceStatus): 'failed' | 'loading' =>
  source.error !== null ? 'failed' : 'loading';

export function deriveRequestScope({ credentials, traffic }: RequestScopeSources): RequestScope {
  if (included(credentials) && included(traffic)) return { kind: 'all' };
  if (included(credentials))
    return { kind: 'credentialFilesOnly', missing: missingReason(traffic) };
  if (included(traffic)) return { kind: 'providerKeysOnly', missing: missingReason(credentials) };
  return { kind: 'none' };
}

export interface RequestScopeLabel {
  /** What the total covers, e.g. "current credentials" or "credential files only". */
  scopeKey: string;
  /** The source left out and why; null when nothing is left out. */
  missingKey: string | null;
}

/** Translation keys for the scope phrase, or null when nothing is counted yet. */
export function requestScopeLabel(scope: RequestScope): RequestScopeLabel | null {
  switch (scope.kind) {
    case 'all':
      return { scopeKey: 'dashboard.scope_all', missingKey: null };
    case 'credentialFilesOnly':
      return {
        scopeKey: 'dashboard.scope_credential_files_only',
        missingKey: `dashboard.scope_missing_provider_keys_${scope.missing}`,
      };
    case 'providerKeysOnly':
      return {
        scopeKey: 'dashboard.scope_provider_keys_only',
        missingKey: `dashboard.scope_missing_credential_files_${scope.missing}`,
      };
    case 'none':
      return null;
  }
}
