import type { ProviderHealth } from '../types';
import { evidenceAsOf, type EvidenceReceipts } from './evidence';
import type { SourceFreshness } from './freshness';

export type DashboardSourceId = 'credentials' | 'traffic' | 'config' | 'models' | 'usage';

/** Sources the verdict and fleet totals are built from. */
const PRIMARY_SOURCES = new Set<DashboardSourceId>(['credentials', 'traffic']);

export type AttentionSeverity = 'critical' | 'warning';

export interface ProviderAttention {
  kind: 'provider';
  key: string;
  severity: AttentionSeverity;
  provider: ProviderHealth;
}

export interface SourceAttention {
  kind: 'source';
  key: string;
  severity: 'warning';
  source: DashboardSourceId;
  freshness: 'failed' | 'stale';
  error: string | null;
  receivedAt: number | null;
}

export type AttentionItem = ProviderAttention | SourceAttention;

export interface SourceHealth {
  id: DashboardSourceId;
  freshness: SourceFreshness;
  error: string | null;
  receivedAt: number | null;
}

/**
 * Everything the operator should act on, worst first.
 *
 * Providers that are down, degraded, or limited (models cooling down on a credential
 * that still serves) become one item each, carrying their credentials and traffic as
 * evidence. Sources that failed or went stale become items
 * too, because a silent data gap would otherwise read as "all good".
 */
export function buildAttention(
  providers: ProviderHealth[],
  sources: SourceHealth[]
): AttentionItem[] {
  const providerItems: ProviderAttention[] = providers
    .filter(
      (provider) =>
        provider.status === 'down' ||
        provider.status === 'degraded' ||
        provider.status === 'limited'
    )
    .map((provider) => ({
      kind: 'provider',
      key: `provider:${provider.id}`,
      severity: provider.status === 'down' ? 'critical' : 'warning',
      provider,
    }));

  const sourceItems: SourceAttention[] = sources
    .filter(
      (source): source is SourceHealth & { freshness: 'failed' | 'stale' } =>
        source.freshness === 'failed' || source.freshness === 'stale'
    )
    .map((source) => ({
      kind: 'source',
      key: `source:${source.id}`,
      severity: 'warning',
      source: source.id,
      freshness: source.freshness,
      error: source.error,
      receivedAt: source.receivedAt,
    }));

  // A gap in credentials or traffic undermines every other item, so it leads.
  const isPrimary = (item: SourceAttention) => PRIMARY_SOURCES.has(item.source);
  const critical = providerItems.filter((item) => item.severity === 'critical');
  const warning = providerItems.filter((item) => item.severity === 'warning');
  return [
    ...sourceItems.filter(isPrimary),
    ...critical,
    ...warning,
    ...sourceItems.filter((item) => !isPrimary(item)),
  ];
}

export type VerdictKind =
  | 'offline'
  | 'connecting'
  | 'checking'
  | 'down'
  | 'attention'
  | 'unknown'
  | 'idle'
  | 'idle_other_scope'
  | 'good';

export type VerdictTone = 'good' | 'warning' | 'critical' | 'idle';

export interface Verdict {
  kind: VerdictKind;
  tone: VerdictTone;
  /** Issues for `attention`, providers for `down`. */
  count: number;
  /** Set when exactly one provider is down. */
  providerId: string | null;
  /** The verdict rests on data that stopped updating; say "last reported". */
  stale: boolean;
}

export interface VerdictInput {
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error' | string;
  attention: AttentionItem[];
  /** Combined freshness of the credential and traffic sources. */
  primaryFreshness: SourceFreshness;
  /** At least one primary source has delivered data. */
  hasData: boolean;
  /** Requests through credentials listed now, in the window. */
  trafficTotal: number;
  /** Usage statistics saw requests in the same window (they can include removed credentials). */
  otherScopeActivity?: boolean;
  /**
   * Receipts of the sources behind provider evidence. With them, an outage is only "last
   * reported" when the down provider's own evidence stopped updating; without them, when
   * either primary source did.
   */
  evidence?: EvidenceReceipts;
}

/**
 * The headline. It is computed from evidence on the page and never claims health it
 * cannot see: stale or failed sources downgrade "steady" to "unknown".
 */
export function deriveVerdict(input: VerdictInput): Verdict {
  const base = { count: 0, providerId: null, stale: false };
  if (input.connectionStatus === 'connecting')
    return { ...base, kind: 'connecting', tone: 'warning' };
  if (input.connectionStatus !== 'connected') return { ...base, kind: 'offline', tone: 'idle' };
  if (!input.hasData) {
    return input.primaryFreshness === 'failed'
      ? { ...base, kind: 'unknown', tone: 'warning' }
      : { ...base, kind: 'checking', tone: 'idle' };
  }

  const down = input.attention.filter(
    (item): item is Extract<AttentionItem, { kind: 'provider' }> =>
      item.kind === 'provider' && item.severity === 'critical'
  );
  // Credentials or traffic stopped updating: outages are only "last reported", and
  // anything else is unknown rather than counted as current issues.
  const outOfDate = input.primaryFreshness === 'stale' || input.primaryFreshness === 'failed';
  if (down.length > 0) {
    const evidence = input.evidence;
    return {
      kind: 'down',
      tone: 'critical',
      count: down.length,
      providerId: down.length === 1 ? down[0].provider.id : null,
      stale: evidence
        ? down.some((item) => evidenceAsOf(item.provider, evidence) !== null)
        : outOfDate,
    };
  }
  if (outOfDate) return { ...base, kind: 'unknown', tone: 'warning' };
  if (input.attention.length > 0) {
    return {
      kind: 'attention',
      tone: 'warning',
      count: input.attention.length,
      providerId: null,
      stale: false,
    };
  }
  if (input.primaryFreshness !== 'live') return { ...base, kind: 'unknown', tone: 'warning' };
  // Health is only claimed from current-credential traffic. Activity seen only by usage
  // statistics gets a neutral, scoped headline instead of "steady".
  if (input.trafficTotal === 0) {
    return input.otherScopeActivity
      ? { ...base, kind: 'idle_other_scope', tone: 'idle' }
      : { ...base, kind: 'idle', tone: 'idle' };
  }
  return { ...base, kind: 'good', tone: 'good' };
}
