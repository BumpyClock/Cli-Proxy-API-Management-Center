import {
  hasAuthFileStatusWarning,
  isProblemAuthFile,
  normalizeProviderKey,
} from '@/features/authFiles/constants';
import { summarizeCooldowns } from '@/features/authFiles/cooldowns';
import { deriveAuthFileIdentity } from '@/features/authFiles/identity';
import type { AuthFileItem } from '@/types/authFile';
import {
  normalizeRecentRequestAuthIndex,
  normalizeRecentRequestUsageEntry,
  type ApiKeyUsageResponse,
  type RecentRequestBucket,
} from '@/utils/recentRequests';
import { parseTimestampMs } from '@/utils/timestamp';
import {
  TRAFFIC_BUCKET_MINUTES,
  TRAFFIC_BUCKET_MS,
  type CredentialCooldown,
  type CredentialHealth,
  type CredentialRow,
  type CredentialState,
  type ProviderHealth,
  type ProviderStatus,
  type TimedBucket,
  type TrafficCounts,
  type TrafficWindow,
} from '../types';
import {
  alignBuckets,
  inferServerOffsetMinutes,
  labelStartMinutes,
  serverInstantToLocal,
} from './time';
import { readableStatusReason } from './statusMessage';

/** Backend window: 20 buckets of 10 minutes. */
export const WINDOW_BUCKETS = 20;
/** Below this success rate a provider with enough traffic counts as failing. */
export const DEGRADED_SUCCESS_RATE = 80;
/** Minimum requests before a success rate is trusted. */
export const MIN_REQUESTS_FOR_RATE = 3;

export interface FleetInput {
  authFiles: AuthFileItem[] | null;
  /** Server clock at the time the auth-file list was built. */
  observedAtMs: number | null;
  authFilesReceivedAt: number | null;
  keyUsage: ApiKeyUsageResponse | null;
  keyUsageReceivedAt: number | null;
}

export interface FleetModel {
  traffic: TrafficWindow;
  providers: ProviderHealth[];
  credentials: CredentialHealth | null;
}

const EMPTY_COUNTS: TrafficCounts = { success: 0, failed: 0, total: 0, successRate: null };

export function countsOf(buckets: Array<{ success: number; failed: number }>): TrafficCounts {
  let success = 0;
  let failed = 0;
  buckets.forEach((bucket) => {
    success += bucket.success;
    failed += bucket.failed;
  });
  const total = success + failed;
  return { success, failed, total, successRate: total > 0 ? (success / total) * 100 : null };
}

const providerIdOfAuthFile = (file: AuthFileItem): string => {
  const candidate = normalizeProviderKey(String(file.type ?? file.provider ?? ''));
  return candidate && candidate !== 'empty' ? candidate : 'unknown';
};

const normalizeUsageProvider = (value: string): string => {
  const key = value.trim().toLowerCase();
  return key || 'unknown';
};

/** `api-key-usage` keys look like `<baseUrl>|<apiKey>`. The key never leaves this module. */
const apiKeyFromCompositeKey = (compositeKey: string): string => {
  const separatorIndex = compositeKey.indexOf('|');
  return separatorIndex < 0 ? '' : compositeKey.slice(separatorIndex + 1).trim();
};

/** Sum buckets that share a start time and keep the newest `WINDOW_BUCKETS` slots. */
function mergeTimedBuckets(groups: TimedBucket[][], newestStart: number | null): TimedBucket[] {
  if (newestStart === null) return [];
  const byStart = new Map<number, { success: number; failed: number }>();
  groups.forEach((group) =>
    group.forEach((bucket) => {
      const slot = byStart.get(bucket.startMs) ?? { success: 0, failed: 0 };
      slot.success += bucket.success;
      slot.failed += bucket.failed;
      byStart.set(bucket.startMs, slot);
    })
  );
  return Array.from({ length: WINDOW_BUCKETS }, (_, index) => {
    const startMs = newestStart - (WINDOW_BUCKETS - 1 - index) * TRAFFIC_BUCKET_MS;
    const slot = byStart.get(startMs);
    return {
      startMs,
      endMs: startMs + TRAFFIC_BUCKET_MS,
      success: slot?.success ?? 0,
      failed: slot?.failed ?? 0,
      partial: index === WINDOW_BUCKETS - 1,
    };
  });
}

function buildTrafficWindow(buckets: TimedBucket[]): TrafficWindow {
  if (buckets.length === 0) {
    return {
      ...EMPTY_COUNTS,
      buckets: [],
      peakTotal: 0,
      peakIndex: -1,
      windowMinutes: 0,
      startMs: null,
      endMs: null,
    };
  }
  let peakTotal = 0;
  let peakIndex = -1;
  buckets.forEach((bucket, index) => {
    const total = bucket.success + bucket.failed;
    if (total > peakTotal) {
      peakTotal = total;
      peakIndex = index;
    }
  });
  return {
    ...countsOf(buckets),
    buckets,
    peakTotal,
    peakIndex,
    windowMinutes: buckets.length * TRAFFIC_BUCKET_MINUTES,
    startMs: buckets[0].startMs,
    endMs: buckets[buckets.length - 1].endMs,
  };
}

function summarizeCredentialCooldown(file: AuthFileItem): CredentialCooldown | null {
  const snapshot = file.cooldownSnapshot;
  if (!snapshot || !snapshot.records || snapshot.records.length === 0) return null;
  const summary = summarizeCooldowns(snapshot, snapshot.receivedAtMs);
  if (summary.modelCount === 0 && !summary.credentialWide) return null;

  const reasonCounts = new Map<string, number>();
  summary.rows
    .filter((row) => row.remainingSeconds > 0)
    .forEach((row) =>
      reasonCounts.set(row.record.reason, (reasonCounts.get(row.record.reason) ?? 0) + 1)
    );
  const reason =
    Array.from(reasonCounts.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    )[0]?.[0] ?? null;
  const httpStatus =
    summary.rows.find((row) => row.record.reason === reason && row.record.httpStatus)?.record
      .httpStatus ?? null;

  const models = summary.rows
    .filter(
      (row) => row.remainingSeconds > 0 && row.record.scope === 'model' && row.record.modelKey
    )
    .map((row) => row.record.modelKey as string);

  return {
    modelCount: summary.modelCount,
    models: Array.from(new Set(models)),
    credentialWide: summary.credentialWide,
    reason,
    httpStatus,
    earliestSeconds: summary.earliestSeconds,
    receivedAtMs: snapshot.receivedAtMs,
  };
}

function credentialStateOf(
  file: AuthFileItem,
  cooldown: CredentialCooldown | null
): CredentialState {
  const status = typeof file.status === 'string' ? file.status.trim().toLowerCase() : '';
  if (file.disabled === true || status === 'disabled') return 'disabled';
  if (file.unavailable === true) return 'unavailable';
  if (status === 'error') return 'error';
  if (hasAuthFileStatusWarning(file)) return 'warning';
  if (cooldown) return 'cooling';
  return 'serving';
}

const CREDENTIAL_STATE_ORDER: Record<CredentialState, number> = {
  unavailable: 0,
  error: 1,
  warning: 2,
  cooling: 3,
  serving: 4,
  disabled: 5,
};

export function compareCredentialRows(a: CredentialRow, b: CredentialRow): number {
  return (
    CREDENTIAL_STATE_ORDER[a.state] - CREDENTIAL_STATE_ORDER[b.state] ||
    b.window.total - a.window.total ||
    a.identity.primary.localeCompare(b.identity.primary)
  );
}

const PROVIDER_STATUS_ORDER: Record<ProviderStatus, number> = {
  down: 0,
  degraded: 1,
  limited: 2,
  healthy: 3,
  idle: 4,
};

/**
 * Traffic is failing when every request in the window failed, however few, or when at
 * least `MIN_REQUESTS_FOR_RATE` requests succeeded less than 80% of the time and the
 * newest active bucket has not recovered.
 */
export function isTrafficFailing(window: TrafficCounts, recovered: boolean): boolean {
  if (window.success === 0 && window.failed > 0) return true;
  return (
    window.total >= MIN_REQUESTS_FOR_RATE &&
    window.successRate !== null &&
    window.successRate < DEGRADED_SUCCESS_RATE &&
    !recovered
  );
}

/**
 * Provider verdict, in priority order:
 * - down: every enabled credential needs attention and no independent API key can serve.
 * - degraded: some credentials need attention, or traffic is failing.
 * - limited: everything serves, but some models are cooling down on some credentials.
 * - idle: no requests in the window.
 */
export function providerStatusOf(provider: Omit<ProviderHealth, 'status'>): ProviderStatus {
  const enabled = provider.credentials.total - provider.credentials.disabled;
  if (enabled > 0 && provider.credentials.serving === 0 && provider.independentApiKeys === 0) {
    return 'down';
  }
  if (provider.credentials.problems > 0 || provider.trafficFailing) return 'degraded';
  if (provider.credentials.limited > 0) return 'limited';
  if (provider.window.total === 0) return 'idle';
  return 'healthy';
}

interface ProviderAccumulator {
  credentials: CredentialRow[];
  apiKeys: number;
  /** Auth files that are the same credential as an API key already counted from usage. */
  mirroredApiKeys: number;
  groups: TimedBucket[][];
}

/**
 * Build the traffic window, provider health, and credential rows.
 *
 * Traffic comes from two non-overlapping sources: `api-key-usage` (API keys inlined in
 * the config) and `auth-files` (file and runtime credentials). Plugin credentials could
 * appear in both; those auth files keep their health row but their traffic is counted once.
 */
export function buildFleetModel(input: FleetInput): FleetModel {
  const authAnchor = input.observedAtMs ?? input.authFilesReceivedAt;
  // Usage has no server clock of its own. Shift the auth-file server clock by the gap
  // between the two receipts, or fall back to the local receipt time.
  const usageAnchor =
    input.keyUsageReceivedAt === null
      ? authAnchor
      : input.observedAtMs !== null && input.authFilesReceivedAt !== null
        ? input.observedAtMs + (input.keyUsageReceivedAt - input.authFilesReceivedAt)
        : input.keyUsageReceivedAt;

  // Server bucket labels pin each snapshot to the right absolute bucket once the server's
  // UTC offset is known. Prefer the auth-file clock (`observed_at`); fall back to usage.
  const firstLabelled = (groups: Array<RecentRequestBucket[]>) =>
    groups.find(
      (group) => group.length > 0 && labelStartMinutes(group[group.length - 1].time) !== null
    );
  const authGroups = (input.authFiles ?? []).map((file) => file.recentRequests ?? []);
  const usageGroups = Object.values(input.keyUsage ?? {}).flatMap((entries) =>
    entries && typeof entries === 'object' && !Array.isArray(entries)
      ? Object.values(entries).map(
          (entry) => normalizeRecentRequestUsageEntry(entry).recentRequests
        )
      : []
  );
  const authSample = authAnchor === null ? undefined : firstLabelled(authGroups);
  const usageSample = usageAnchor === null ? undefined : firstLabelled(usageGroups);
  const serverOffset = authSample
    ? inferServerOffsetMinutes(
        labelStartMinutes(authSample[authSample.length - 1].time) as number,
        authAnchor as number
      )
    : usageSample
      ? inferServerOffsetMinutes(
          labelStartMinutes(usageSample[usageSample.length - 1].time) as number,
          usageAnchor as number
        )
      : null;

  const align = (buckets: RecentRequestBucket[], anchor: number | null): TimedBucket[] =>
    anchor === null ? [] : alignBuckets(buckets, anchor, serverOffset);

  // The window ends at the newest bucket any snapshot reached.
  const newestCandidates = [
    ...authGroups.map((group) => align(group, authAnchor)),
    ...usageGroups.map((group) => align(group, usageAnchor)),
  ]
    .filter((group) => group.length > 0)
    .map((group) => group[group.length - 1].startMs);
  const anchors = [authAnchor, usageAnchor].filter(
    (value): value is number => value !== null && Number.isFinite(value)
  );
  const newestStart =
    newestCandidates.length > 0
      ? Math.max(...newestCandidates)
      : anchors.length > 0
        ? Math.floor(Math.max(...anchors) / TRAFFIC_BUCKET_MS) * TRAFFIC_BUCKET_MS
        : null;

  const accumulators = new Map<string, ProviderAccumulator>();
  const allGroups: TimedBucket[][] = [];
  const apiKeysFromUsage = new Set<string>();

  const accumulatorFor = (providerId: string): ProviderAccumulator => {
    let accumulator = accumulators.get(providerId);
    if (!accumulator) {
      accumulator = { credentials: [], apiKeys: 0, mirroredApiKeys: 0, groups: [] };
      accumulators.set(providerId, accumulator);
    }
    return accumulator;
  };

  if (input.keyUsage && typeof input.keyUsage === 'object') {
    Object.entries(input.keyUsage).forEach(([provider, entries]) => {
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return;
      const accumulator = accumulatorFor(normalizeUsageProvider(provider));
      Object.entries(entries).forEach(([compositeKey, rawEntry]) => {
        const apiKey = apiKeyFromCompositeKey(compositeKey);
        if (apiKey) apiKeysFromUsage.add(apiKey);
        accumulator.apiKeys += 1;
        const entry = normalizeRecentRequestUsageEntry(rawEntry);
        const timed = align(entry.recentRequests, usageAnchor);
        if (timed.length > 0) {
          accumulator.groups.push(timed);
          allGroups.push(timed);
        }
      });
    });
  }

  const rows: CredentialRow[] = [];
  (input.authFiles ?? []).forEach((file) => {
    const accountType = String(file.account_type ?? '')
      .trim()
      .toLowerCase();
    const account = String(file.account ?? '').trim();
    // The same credential as an API key already counted from usage: keep its health,
    // but do not count its traffic twice.
    const mirrorsApiKey =
      accountType === 'api_key' && Boolean(account) && apiKeysFromUsage.has(account);

    const providerId = providerIdOfAuthFile(file);
    const timed = align(file.recentRequests ?? [], authAnchor);
    const cooldown = summarizeCredentialCooldown(file);
    const nextRetryRaw = parseTimestampMs(file['next_retry_after']);
    const receivedAt = input.authFilesReceivedAt ?? Date.now();
    const windowBuckets = mergeTimedBuckets([timed], newestStart);

    const row: CredentialRow = {
      name: String(file.name ?? ''),
      authIndex: normalizeRecentRequestAuthIndex(file.authIndex ?? file['auth_index']),
      providerId,
      identity: deriveAuthFileIdentity(file),
      state: credentialStateOf(file, cooldown),
      problem: isProblemAuthFile(file),
      reason: readableStatusReason(file.statusMessage ?? file['status_message']),
      cooldown,
      nextRetryAtMs: Number.isFinite(nextRetryRaw)
        ? serverInstantToLocal(nextRetryRaw, input.observedAtMs, receivedAt)
        : null,
      window: countsOf(windowBuckets),
    };
    rows.push(row);

    const accumulator = accumulatorFor(providerId);
    accumulator.credentials.push(row);
    if (mirrorsApiKey) {
      accumulator.mirroredApiKeys += 1;
    } else if (timed.length > 0) {
      accumulator.groups.push(timed);
      allGroups.push(timed);
    }
  });

  const providers: ProviderHealth[] = Array.from(accumulators.entries())
    .map(([id, accumulator]) => {
      const buckets = mergeTimedBuckets(accumulator.groups, newestStart);
      const window = countsOf(buckets);
      const lastActive =
        [...buckets].reverse().find((bucket) => bucket.success + bucket.failed > 0) ?? null;
      const recovered =
        lastActive !== null &&
        (lastActive.success / (lastActive.success + lastActive.failed)) * 100 >=
          DEGRADED_SUCCESS_RATE;
      const trafficFailing = isTrafficFailing(window, recovered);
      const sortedCredentials = [...accumulator.credentials].sort(compareCredentialRows);
      const disabled = sortedCredentials.filter((row) => row.state === 'disabled').length;
      const problems = sortedCredentials.filter((row) => row.problem).length;
      const base = {
        id,
        credentials: {
          total: sortedCredentials.length,
          serving: sortedCredentials.length - disabled - problems,
          problems,
          disabled,
          limited: sortedCredentials.filter((row) => row.state === 'cooling').length,
        },
        apiKeys: accumulator.apiKeys,
        independentApiKeys: Math.max(0, accumulator.apiKeys - accumulator.mirroredApiKeys),
        window,
        trafficFailing,
        buckets,
        lastActive,
        recovered,
        problemCredentials: sortedCredentials.filter((row) => row.problem),
        limitedCredentials: sortedCredentials.filter((row) => row.state === 'cooling'),
      };
      return { ...base, status: providerStatusOf(base) };
    })
    .sort(
      (a, b) =>
        PROVIDER_STATUS_ORDER[a.status] - PROVIDER_STATUS_ORDER[b.status] ||
        b.window.total - a.window.total ||
        a.id.localeCompare(b.id)
    );

  const sortedRows = [...rows].sort(compareCredentialRows);
  const disabled = sortedRows.filter((row) => row.state === 'disabled').length;
  const problems = sortedRows.filter((row) => row.problem).length;

  return {
    traffic: buildTrafficWindow(mergeTimedBuckets(allGroups, newestStart)),
    providers,
    credentials: input.authFiles
      ? {
          total: sortedRows.length,
          serving: sortedRows.length - disabled - problems,
          problems,
          disabled,
          limited: sortedRows.filter((row) => row.state === 'cooling').length,
          rows: sortedRows,
        }
      : null,
  };
}

/** Local instant at which a credential is expected to serve again, if known. */
export function credentialRetryAt(row: CredentialRow): number | null {
  if (row.nextRetryAtMs !== null && Number.isFinite(row.nextRetryAtMs)) return row.nextRetryAtMs;
  if (row.cooldown && row.cooldown.earliestSeconds > 0) {
    return row.cooldown.receivedAtMs + row.cooldown.earliestSeconds * 1000;
  }
  return null;
}
