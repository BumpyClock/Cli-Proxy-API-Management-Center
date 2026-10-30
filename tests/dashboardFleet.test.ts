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
    const reason = readableStatusReason('upstream failed '.repeat(30));
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
    expect(codex.credentials).toEqual({
      total: 2,
      serving: 1,
      problems: 0,
      disabled: 1,
      limited: 0,
    });
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

  test('marks a provider limited when a serving credential has models cooling down', () => {
    const normalized = normalizeAuthFilesResponse(
      {
        observed_at: OBSERVED_AT,
        files: [
          {
            name: 'xai-team.json',
            type: 'xai',
            status: 'active',
            recent_requests: buckets({ 18: [6, 0] }),
            cooldowns: [
              {
                scope: 'model',
                model_key: 'grok-4-heavy',
                reason: 'quota',
                retry_at: new Date(OBSERVED_MS + 1_500_000).toISOString(),
                remaining_seconds: 1500,
                http_status: 429,
              },
            ],
          },
        ],
      } as unknown as AuthFilesResponse,
      RECEIVED_MS
    );
    const model = buildFleetModel({
      authFiles: normalized.files,
      observedAtMs: OBSERVED_MS,
      authFilesReceivedAt: RECEIVED_MS,
      keyUsage: null,
      keyUsageReceivedAt: null,
    });
    const xai = model.providers[0];
    expect(xai).toMatchObject({ id: 'xai', status: 'limited' });
    expect(xai.credentials).toMatchObject({ serving: 1, problems: 0, limited: 1 });
    expect(xai.limitedCredentials[0].cooldown).toMatchObject({
      modelCount: 1,
      reason: 'quota',
      httpStatus: 429,
    });
    const attention = buildAttention(model.providers, []);
    expect(attention).toHaveLength(1);
    expect(attention[0]).toMatchObject({ key: 'provider:xai', severity: 'warning' });
  });

  test('treats a small sample where every request failed as degraded', () => {
    const model = buildFleetModel({
      authFiles: [],
      observedAtMs: OBSERVED_MS,
      authFilesReceivedAt: RECEIVED_MS,
      keyUsage: {
        claude: { 'base|key': { success: 0, failed: 2, recent_requests: buckets({ 18: [0, 2] }) } },
      },
      keyUsageReceivedAt: RECEIVED_MS,
    });
    expect(model.providers[0]).toMatchObject({
      id: 'claude',
      trafficFailing: true,
      status: 'degraded',
    });
  });

  test('keeps the health of a file credential that mirrors a usage API key, counting traffic once', () => {
    const normalized = normalizeAuthFilesResponse(
      {
        observed_at: OBSERVED_AT,
        files: [
          {
            name: 'plugin-key.json',
            type: 'claude',
            account_type: 'api_key',
            account: 'sk-ant-mirrored',
            status: 'error',
            unavailable: true,
            recent_requests: buckets({ 18: [0, 3] }),
          },
        ],
      } as unknown as AuthFilesResponse,
      RECEIVED_MS
    );
    const model = buildFleetModel({
      authFiles: normalized.files,
      observedAtMs: OBSERVED_MS,
      authFilesReceivedAt: RECEIVED_MS,
      keyUsage: {
        claude: {
          'base|sk-ant-mirrored': {
            success: 0,
            failed: 3,
            recent_requests: buckets({ 18: [0, 3] }),
          },
        },
      },
      keyUsageReceivedAt: RECEIVED_MS,
    });
    const claude = model.providers[0];
    expect(claude.credentials).toMatchObject({ total: 1, problems: 1 });
    expect(claude.independentApiKeys).toBe(0);
    expect(claude.status).toBe('down');
    expect(model.traffic.failed).toBe(3);
    expect(JSON.stringify(model)).not.toContain('sk-ant-mirrored');
  });

  test('aligns auth and usage snapshots taken on either side of a bucket boundary', () => {
    // observed_at is still in 05:50Z, but both snapshots were built after 06:00Z (UTC+8 labels).
    const observedAt = Date.UTC(2026, 9, 30, 5, 59, 59, 950);
    const labelled = (newestStartUtc: number, filled: Record<number, [number, number]>) =>
      Array.from({ length: 20 }, (_, index) => {
        const start = newestStartUtc - (19 - index) * 10 * MINUTE + 8 * 60 * MINUTE;
        const date = new Date(start);
        const hh = String(date.getUTCHours()).padStart(2, '0');
        const mm = String(date.getUTCMinutes()).padStart(2, '0');
        const [success, failed] = filled[index] ?? [0, 0];
        return { time: `${hh}:${mm}-x`, success, failed };
      });
    const newest = Date.UTC(2026, 9, 30, 6, 0);
    const normalized = normalizeAuthFilesResponse(
      {
        observed_at: new Date(observedAt).toISOString(),
        files: [
          {
            name: 'codex.json',
            type: 'codex',
            status: 'active',
            recent_requests: labelled(newest, { 19: [5, 0] }),
          },
        ],
      } as unknown as AuthFilesResponse,
      observedAt
    );
    const model = buildFleetModel({
      authFiles: normalized.files,
      observedAtMs: observedAt,
      authFilesReceivedAt: observedAt,
      keyUsage: {
        claude: {
          'base|key': { success: 2, failed: 0, recent_requests: labelled(newest, { 19: [2, 0] }) },
        },
      },
      // A browser clock four minutes slow must not shift the usage buckets.
      keyUsageReceivedAt: observedAt - 4 * MINUTE,
    });
    const last = model.traffic.buckets[model.traffic.buckets.length - 1];
    expect(new Date(last.startMs).toISOString()).toBe('2026-10-30T06:00:00.000Z');
    expect(last).toMatchObject({ success: 7, failed: 0, partial: true });
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
    expect(verdict).toEqual({
      kind: 'down',
      tone: 'critical',
      count: 1,
      providerId: 'meta',
      stale: false,
    });
  });

  test('says an outage was last reported when credentials stopped updating', () => {
    const { providers, traffic } = buildLiveModel();
    const verdict = deriveVerdict({
      connectionStatus: 'connected',
      attention: buildAttention(providers, sources({ credentials: 'failed' })),
      primaryFreshness: 'failed',
      hasData: true,
      trafficTotal: traffic.total,
    });
    expect(verdict).toMatchObject({ kind: 'down', providerId: 'meta', stale: true });
  });

  test('an outage seen in fresh credentials stays current when only traffic stopped', () => {
    const { providers, traffic } = buildLiveModel();
    const evidence = (credentialsLive: boolean, trafficLive: boolean) => ({
      credentials: {
        receivedAt: RECEIVED_MS - (credentialsLive ? 0 : 120_000),
        live: credentialsLive,
      },
      traffic: { receivedAt: RECEIVED_MS - (trafficLive ? 0 : 60_000), live: trafficLive },
    });
    const verdict = (credentialsLive: boolean, trafficLive: boolean) =>
      deriveVerdict({
        connectionStatus: 'connected',
        attention: buildAttention(providers, sources(trafficLive ? {} : { traffic: 'failed' })),
        primaryFreshness: credentialsLive && trafficLive ? 'live' : 'failed',
        hasData: true,
        trafficTotal: traffic.total,
        evidence: evidence(credentialsLive, trafficLive),
      });
    // Muse's outage comes from its credential file: stale traffic does not age it.
    expect(verdict(true, false)).toMatchObject({ kind: 'down', providerId: 'meta', stale: false });
    expect(verdict(false, true)).toMatchObject({ kind: 'down', providerId: 'meta', stale: true });
  });

  test('an unusable credential is not an outage while API keys are still unknown', () => {
    const normalized = normalizeAuthFilesResponse(authPayload(), RECEIVED_MS);
    const cold = buildFleetModel({
      authFiles: normalized.files,
      observedAtMs: OBSERVED_MS,
      authFilesReceivedAt: RECEIVED_MS,
      keyUsage: null,
      keyUsageReceivedAt: null,
    });
    const meta = cold.providers.find((provider) => provider.id === 'meta');
    expect(meta).toMatchObject({ status: 'unknown', apiKeysKnown: false });
    const attention = buildAttention(cold.providers, sources({ traffic: 'failed' }));
    expect(attention.find((item) => item.key === 'provider:meta')?.severity).toBe('warning');
    const verdict = deriveVerdict({
      connectionStatus: 'connected',
      attention,
      primaryFreshness: 'failed',
      hasData: true,
      trafficTotal: cold.traffic.total,
    });
    expect(verdict.kind).toBe('unknown');
  });

  test('loaded traffic decides: no key means down, an independent key means degraded', () => {
    // Known credential-only provider: loaded traffic lists no Muse key.
    const { providers } = buildLiveModel();
    expect(providers.find((provider) => provider.id === 'meta')?.status).toBe('down');
    // Same unusable credential, plus a Muse API key that still serves.
    const normalized = normalizeAuthFilesResponse(authPayload(), RECEIVED_MS);
    const withKey = buildFleetModel({
      authFiles: normalized.files,
      observedAtMs: OBSERVED_MS,
      authFilesReceivedAt: RECEIVED_MS,
      keyUsage: {
        ...keyUsage,
        meta: {
          'https://api.meta.example|meta-key': {
            success: 6,
            failed: 0,
            recent_requests: buckets({ 14: [6, 0] }),
          },
        },
      },
      keyUsageReceivedAt: RECEIVED_MS + 150,
    });
    expect(withKey.providers.find((provider) => provider.id === 'meta')?.status).toBe('degraded');
  });

  test('lists a credentials gap ahead of the provider issues it undermines', () => {
    const { providers } = buildLiveModel();
    const keys = buildAttention(providers, sources({ credentials: 'failed', usage: 'failed' })).map(
      (item) => item.key
    );
    expect(keys).toEqual([
      'source:credentials',
      'provider:meta',
      'provider:claude',
      'source:usage',
    ]);
  });

  test('does not count stale issues as current', () => {
    const { providers, traffic } = buildLiveModel();
    const withoutOutage = providers.filter((provider) => provider.status !== 'down');
    const verdict = deriveVerdict({
      connectionStatus: 'connected',
      attention: buildAttention(withoutOutage, sources({ traffic: 'stale' })),
      primaryFreshness: 'stale',
      hasData: true,
      trafficTotal: traffic.total,
    });
    expect(verdict.kind).toBe('unknown');
  });

  test('never claims health from usage activity when current credentials saw no traffic', () => {
    const base = { attention: [], primaryFreshness: 'live' as const, hasData: true };
    const kind = (trafficTotal: number, otherScopeActivity: boolean) =>
      deriveVerdict({ ...base, connectionStatus: 'connected', trafficTotal, otherScopeActivity })
        .kind;
    expect(kind(0, true)).toBe('idle_other_scope');
    expect(kind(0, false)).toBe('idle');
    expect(kind(12, true)).toBe('good');
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
