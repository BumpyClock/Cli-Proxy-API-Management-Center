import type { AuthFileIdentity } from '@/features/authFiles/identity';

/** Minutes covered by one bucket (the backend uses 10 minutes x 20 buckets). */
export const TRAFFIC_BUCKET_MINUTES = 10;
export const TRAFFIC_BUCKET_MS = TRAFFIC_BUCKET_MINUTES * 60_000;

/** One 10-minute bucket placed on an absolute timeline. */
export interface TimedBucket {
  /** Epoch ms of the bucket start (server buckets are epoch-aligned). */
  startMs: number;
  endMs: number;
  success: number;
  failed: number;
  /** The newest bucket is still filling. */
  partial: boolean;
}

export interface TrafficCounts {
  success: number;
  failed: number;
  total: number;
  /** 0-100, or null when there were no requests. */
  successRate: number | null;
}

/** Aggregated traffic window across every credential. */
export interface TrafficWindow extends TrafficCounts {
  buckets: TimedBucket[];
  /** Largest bucket total, for the chart axis. */
  peakTotal: number;
  /** Index of the peak bucket, -1 without data. */
  peakIndex: number;
  windowMinutes: number;
  /** Start of the oldest bucket and end of the newest, or null without data. */
  startMs: number | null;
  endMs: number | null;
}

export type CredentialState =
  'serving' | 'cooling' | 'warning' | 'error' | 'unavailable' | 'disabled';

export interface CredentialCooldown {
  /** Models with an active model-scoped cooldown. */
  modelCount: number;
  /** The whole credential is cooling down. */
  credentialWide: boolean;
  /** Most common reason code, e.g. `model_not_supported`. */
  reason: string | null;
  httpStatus: number | null;
  /** Seconds until the earliest cooldown ends, measured from `receivedAtMs`. */
  earliestSeconds: number;
  receivedAtMs: number;
}

/** One auth-file credential, reduced to what the dashboard shows. */
export interface CredentialRow {
  /** Auth file name, used for deep links into the auth files page. */
  name: string;
  /** Backend auth index, used to attribute usage records to this credential. */
  authIndex: string | null;
  providerId: string;
  identity: AuthFileIdentity;
  state: CredentialState;
  /** Needs operator action (unavailable, error, or an unhealthy status message). */
  problem: boolean;
  /** Human-readable reason derived from the status message, or null. */
  reason: string | null;
  cooldown: CredentialCooldown | null;
  /** Local-clock instant of the next retry, corrected for server clock skew. */
  nextRetryAtMs: number | null;
  window: TrafficCounts;
}

export type ProviderStatus = 'down' | 'degraded' | 'healthy' | 'idle';

/** One provider row: window traffic plus credential health. */
export interface ProviderHealth {
  id: string;
  /** Auth-file credentials grouped under this provider. */
  credentials: {
    total: number;
    serving: number;
    problems: number;
    disabled: number;
  };
  /** API-key credentials reported by `api-key-usage`. */
  apiKeys: number;
  window: TrafficCounts;
  buckets: TimedBucket[];
  /** Newest bucket that saw traffic, or null when idle for the whole window. */
  lastActive: TimedBucket | null;
  /** The newest active bucket succeeded at least 80% of the time. */
  recovered: boolean;
  status: ProviderStatus;
  /** Credentials that need attention, worst first. */
  problemCredentials: CredentialRow[];
}

/** Credential health totals. */
export interface CredentialHealth {
  total: number;
  serving: number;
  problems: number;
  disabled: number;
  rows: CredentialRow[];
}

export interface DashboardCounts {
  clientApiKeys: number | null;
  providerKeys: number | null;
  credentials: number | null;
  models: number | null;
}
