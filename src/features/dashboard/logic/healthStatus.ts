import type { VerdictKind } from './attention';
import type { SourceFreshness } from './freshness';

/**
 * What answers "is anything wrong?" directly under the page header.
 *
 * - attention: the attention panel lists the problems.
 * - setup: nothing is configured yet; the panel offers the first step.
 * - checking: credentials or traffic have not answered yet, so no claim is made.
 * - clear / idle / idle_other_scope: a one-line row states what was checked and when.
 *   Idle states say there was no traffic through current credentials instead of
 *   implying health that traffic would have shown.
 */
export type HealthStatus =
  | { kind: 'attention' }
  | { kind: 'setup' }
  | { kind: 'checking' }
  | {
      kind: 'clear' | 'idle' | 'idle_other_scope';
      checkedAt: number;
      credentials: number;
      providers: number;
    };

export interface HealthStatusInput {
  attentionCount: number;
  verdict: VerdictKind;
  primaryFreshness: SourceFreshness;
  /** Oldest receipt of the credential and traffic sources, or null until both answered. */
  primaryReceivedAt: number | null;
  checkedCredentials: number;
  checkedProviders: number;
}

type CheckScope = Pick<
  HealthStatusInput,
  'primaryFreshness' | 'primaryReceivedAt' | 'checkedCredentials' | 'checkedProviders'
>;

/** Both primary sources have answered and are not loading for the first time. */
export const primaryChecked = ({ primaryFreshness, primaryReceivedAt }: CheckScope): boolean =>
  primaryFreshness !== 'pending' && primaryReceivedAt !== null;

/** A fresh install: everything loaded and there is nothing to check yet. */
export const setupNeeded = (scope: CheckScope): boolean =>
  primaryChecked(scope) && scope.checkedCredentials === 0 && scope.checkedProviders === 0;

export function deriveHealthStatus(input: HealthStatusInput): HealthStatus {
  if (input.attentionCount > 0) return { kind: 'attention' };
  if (!primaryChecked(input) || input.primaryReceivedAt === null) return { kind: 'checking' };
  if (setupNeeded(input)) return { kind: 'setup' };
  const checked = {
    checkedAt: input.primaryReceivedAt,
    credentials: input.checkedCredentials,
    providers: input.checkedProviders,
  };
  switch (input.verdict) {
    case 'good':
      return { kind: 'clear', ...checked };
    case 'idle':
    case 'idle_other_scope':
      return { kind: input.verdict, ...checked };
    default:
      // Anything else without an attention item is a primary source still settling.
      return { kind: 'checking' };
  }
}

/**
 * Whether the page title is the verdict sentence instead of "Dashboard", so the status is
 * stated once. Disconnected, the headline is the only status. Connected, the attention
 * panel or the status row is; the headline then adds only what the panel lacks (an outage,
 * or unknown health) and never repeats its "N issues need attention" title.
 */
export function verdictInTitle(
  connected: boolean,
  status: HealthStatus,
  verdict: VerdictKind
): boolean {
  if (!connected) return true;
  return status.kind === 'attention' && verdict !== 'attention';
}
