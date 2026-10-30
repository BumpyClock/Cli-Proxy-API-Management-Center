import { describe, expect, test } from 'bun:test';
import { normalizeAuthFilesResponse } from '../src/services/api/authFiles';
import type { AuthFilesResponse } from '../src/types/authFile';
import type { ApiKeyUsageResponse } from '../src/utils/recentRequests';
import { buildAttention, deriveVerdict } from '../src/features/dashboard/logic/attention';
import { buildFleetModel } from '../src/features/dashboard/logic/fleet';
import { readableStatusReason } from '../src/features/dashboard/logic/statusMessage';

const MINUTE = 60_000;
const OBSERVED_AT = '2026-10-30T05:58:37.066Z';
const OBSERVED_MS = Date.parse(OBSERVED_AT);
/** The browser clock runs two seconds behind the server. */
const RECEIVED_MS = OBSERVED_MS - 2_000;

/** 20 buckets; `filled` maps bucket index (0 = oldest) to counts. */
const buckets = (filled: Record<number, [number, number]> = {}) =>
  Array.from({ length: 20 }, (_, index) => {
    const [success, failed] = filled[index] ?? [0, 0];
    return { time: `label-${index}`, success, failed };
  });

const authPayload = (): AuthFilesResponse =>
  ({
    observed_at: OBSERVED_AT,
    files: [
      {
        name: 'codex-1a2b3c4d-dev@example.com-plus.json',
        type: 'codex',
        email: 'dev@example.com',
        status: 'active',
        status_message: '',
        disabled: false,
        unavailable: false,
        success: 313,
        failed: 1,
        auth_index: '1',
        recent_requests: buckets({ 17: [40, 0], 18: [61, 1], 19: [12, 0] }),
        cooldowns: [],
      },
      {
        name: 'meta-ops.json',
        type: 'meta',
        email: 'ops@example.com',
        status: 'error',
        status_message:
          '{"error":{"code":"model_not_found","message":"The requested model was not found.","param":null,"type":"invalid_request_error"}}',
        disabled: false,
        unavailable: true,
        success: 1,
        failed: 5,
        auth_index: '2',
        next_retry_after: '2026-10-31T00:05:04.559+08:00',
        recent_requests: buckets({ 12: [1, 5] }),
        cooldowns: [
          {
            scope: 'model',
            model_key: 'muse-large',
            reason: 'model_not_supported',
            retry_at: '2026-10-30T16:05:04Z',
            remaining_seconds: 36_427,
            http_status: 404,
          },
          {
            scope: 'model',
            model_key: 'muse-small',
            reason: 'model_not_supported',
            retry_at: '2026-10-30T16:05:04Z',
            remaining_seconds: 36_388,
            http_status: 404,
          },
        ],
      },
      {
        name: 'xai-team.json',
        type: 'xai',
        email: 'team@example.com',
        status: 'active',
        disabled: false,
        unavailable: false,
        auth_index: '3',
        recent_requests: buckets({ 15: [11, 0] }),
        cooldowns: [],
      },
      {
        name: 'codex-paused.json',
        type: 'codex',
        status: 'disabled',
        disabled: true,
        unavailable: false,
        auth_index: '4',
        recent_requests: buckets(),
        cooldowns: [],
      },
    ],
  }) as unknown as AuthFilesResponse;

const keyUsage: ApiKeyUsageResponse = {
  claude: {
    'https://api.anthropic.com|sk-ant-secret': {
      success: 0,
      failed: 4,
      recent_requests: buckets({ 13: [0, 4] }),
    },
  },
};

const buildLiveModel = () => {
  const normalized = normalizeAuthFilesResponse(authPayload(), RECEIVED_MS);
  return buildFleetModel({
    authFiles: normalized.files,
    observedAtMs: OBSERVED_MS,
    authFilesReceivedAt: RECEIVED_MS,
    keyUsage,
    keyUsageReceivedAt: RECEIVED_MS + 150,
  });
};

describe('readableStatusReason', () => {
  test('extracts the sentence from a provider JSON error body', () => {
    expect(
      readableStatusReason(
        '{"error":{"code":"model_not_found","message":"The requested model was not found."}}'
      )
    ).toBe('The requested model was not found.');
  });

  test('keeps a text prefix in front of an embedded body', () => {
    expect(readableStatusReason('upstream 429: {"error":{"message":"Rate limited"}}')).toBe(
      'upstream 429: Rate limited'
    );
  });

  test('returns plain messages as-is and drops healthy markers', () => {
    expect(readableStatusReason('  token   expired ')).toBe('token expired');
    expect(readableStatusReason('OK')).toBeNull();
    expect(readableStatusReason('')).toBeNull();
    expect(readableStatusReason(undefined)).toBeNull();
  });

  test('truncates runaway messages', () => {
    const reason = readableStatusReason('x'.repeat(400));
    expect(reason?.length).toBe(180);
    expect(reason?.endsWith('…')).toBe(true);
  });
});

describe('buildFleetModel', () => {
  test('places traffic on absolute time and sums every source', () => {
    const { traffic } = buildLiveModel();
    expect(traffic.buckets).toHaveLength(20);
    expect(new Date(traffic.buckets[19].startMs).toISOString()).toBe('2026-10-30T05:50:00.000Z');
    expect(traffic.buckets[19].partial).toBe(true);
    expect(traffic.endMs! - traffic.startMs!).toBe(200 * MINUTE);
    expect(traffic.success).toBe(40 + 61 + 12 + 1 + 11);
    expect(traffic.failed).toBe(1 + 5 + 4);
    expect(traffic.peakIndex).toBe(18);
  });

  test('uses window counts, not lifetime counters, for provider rates', () => {
    const { providers } = buildLiveModel();
    const codex = providers.find((provider) => provider.id === 'codex')!;
    expect(codex.window).toMatchObject({ success: 113, failed: 1, total: 114 });
    expect(codex.credentials).toEqual({ total: 2, serving: 1, problems: 0, disabled: 1 });
    expect(codex.status).toBe('healthy');
  });

  test('marks a provider down when every enabled credential needs attention', () => {
    const { providers } = buildLiveModel();
    const meta = providers.find((provider) => provider.id === 'meta')!;
    expect(meta.status).toBe('down');
    expect(meta.problemCredentials).toHaveLength(1);
    const credential = meta.problemCredentials[0];
    expect(credential.state).toBe('unavailable');
    expect(credential.reason).toBe('The requested model was not found.');
    expect(credential.identity.primary).toBe('ops@example.com');
    expect(credential.cooldown).toMatchObject({
      modelCount: 2,
      credentialWide: false,
      reason: 'model_not_supported',
      httpStatus: 404,
      earliestSeconds: 36_388,
    });
    // 16:05:04.559Z on the server clock, moved onto the browser clock that runs 2s behind.
    expect(credential.nextRetryAtMs).toBe(Date.parse('2026-10-30T16:05:04.559Z') - 2_000);
  });

  test('flags API-key providers that keep failing without recovering', () => {
    const { providers } = buildLiveModel();
    const claude = providers.find((provider) => provider.id === 'claude')!;
    expect(claude.apiKeys).toBe(1);
    expect(claude.window).toMatchObject({ success: 0, failed: 4, successRate: 0 });
    expect(claude.recovered).toBe(false);
    expect(claude.status).toBe('degraded');
  });

  test('sorts providers by severity, then volume', () => {
    const { providers } = buildLiveModel();
    expect(providers.map((provider) => [provider.id, provider.status])).toEqual([
      ['meta', 'down'],
      ['claude', 'degraded'],
      ['codex', 'healthy'],
      ['xai', 'healthy'],
    ]);
  });

  test('counts credential health and lists problems first', () => {
    const { credentials } = buildLiveModel();
    expect(credentials).toMatchObject({ total: 4, serving: 2, problems: 1, disabled: 1 });
    expect(credentials!.rows.map((row) => row.state)).toEqual([
      'unavailable',
      'serving',
      'serving',
      'disabled',
    ]);
  });

  test('a provider that recovered in its newest active bucket is not degraded', () => {
    const model = buildFleetModel({
      authFiles: [],
      observedAtMs: OBSERVED_MS,
      authFilesReceivedAt: RECEIVED_MS,
      keyUsage: {
        claude: {
          'base|key': {
            success: 5,
            failed: 6,
            recent_requests: buckets({ 10: [0, 6], 18: [5, 0] }),
          },
        },
      },
      keyUsageReceivedAt: RECEIVED_MS,
    });
    expect(model.providers[0]).toMatchObject({ id: 'claude', recovered: true, status: 'healthy' });
  });

  test('never exposes API keys from usage composite keys', () => {
    const serialized = JSON.stringify(buildLiveModel());
    expect(serialized).not.toContain('sk-ant-secret');
  });
});

describe('attention and verdict', () => {
  const sources = (overrides: Partial<Record<string, 'live' | 'failed' | 'stale'>> = {}) =>
    (['credentials', 'traffic', 'config', 'models', 'usage'] as const).map((id) => ({
      id,
      freshness: overrides[id] ?? 'live',
      error: overrides[id] === 'failed' ? 'Network Error' : null,
      receivedAt: RECEIVED_MS,
    }));

  test('lists down providers before degraded ones, then data gaps', () => {
    const { providers } = buildLiveModel();
    const attention = buildAttention(providers, sources({ usage: 'failed' }));
    expect(attention.map((item) => [item.key, item.severity])).toEqual([
      ['provider:meta', 'critical'],
      ['provider:claude', 'warning'],
      ['source:usage', 'warning'],
    ]);
  });

  test('names the provider when exactly one is down', () => {
    const { providers, traffic } = buildLiveModel();
    const verdict = deriveVerdict({
      connectionStatus: 'connected',
      attention: buildAttention(providers, sources()),
      primaryFreshness: 'live',
      hasData: true,
      trafficTotal: traffic.total,
    });
    expect(verdict).toEqual({ kind: 'down', tone: 'critical', count: 1, providerId: 'meta' });
  });

  test('does not claim steady health from stale data', () => {
    const verdict = deriveVerdict({
      connectionStatus: 'connected',
      attention: [],
      primaryFreshness: 'stale',
      hasData: true,
      trafficTotal: 12,
    });
    expect(verdict.kind).toBe('unknown');
  });

  test('reports steady, idle, checking, and offline states', () => {
    const base = { attention: [], primaryFreshness: 'live' as const, hasData: true };
    expect(deriveVerdict({ ...base, connectionStatus: 'connected', trafficTotal: 9 }).kind).toBe(
      'good'
    );
    expect(deriveVerdict({ ...base, connectionStatus: 'connected', trafficTotal: 0 }).kind).toBe(
      'idle'
    );
    expect(
      deriveVerdict({
        ...base,
        connectionStatus: 'connected',
        hasData: false,
        primaryFreshness: 'pending',
        trafficTotal: 0,
      }).kind
    ).toBe('checking');
    expect(deriveVerdict({ ...base, connectionStatus: 'disconnected', trafficTotal: 0 }).kind).toBe(
      'offline'
    );
  });
});
