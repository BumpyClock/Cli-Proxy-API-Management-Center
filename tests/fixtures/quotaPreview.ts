/** Local UI verification only. Every credential and quota below is synthetic. */
import type { UsageResponse } from '../../src/types/usage';

const port = 8318;
const files = [
  ...Array.from({ length: 3 }, (_, i) => ({
    name: `mock-claude-${i + 1}.json`,
    type: 'claude',
    auth_index: `claude-${i + 1}`,
    email: `mock-${i + 1}@example.invalid`,
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    name: `mock-codex-${i + 1}.json`,
    type: 'codex',
    auth_index: `codex-${i + 1}`,
  })),
  { name: 'mock-copilot.json', type: 'github-copilot', auth_index: 'copilot-1' },
  { name: 'mock-qoder.json', type: 'qoder', auth_index: 'qoder-1' },
];
let qoderUsed = 10;
let failedAccounts: string[] = [];
let delayMs = 0;
let usageEnabled: boolean | null = true;
let usageFails = false;
const counts: Record<string, number> = {};
const reset = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const sampleUsage: UsageResponse = {
  usage: {
    total_requests: 42,
    success_count: 40,
    failure_count: 2,
    total_tokens: 18500,
    requests_by_day: { [day(-2)]: 10, [day(-1)]: 14, [day(0)]: 18 },
    tokens_by_day: { [day(-2)]: 4000, [day(-1)]: 6500, [day(0)]: 8000 },
    apis: {
      'mock-client-key-not-a-secret': {
        total_requests: 42,
        total_tokens: 18500,
        failure_count: 2,
        models: {
          'mock-model': {
            total_requests: 42,
            total_tokens: 18500,
            failure_count: 2,
            details: [
              { timestamp: new Date().toISOString(), latency_ms: 350, failed: false },
              { timestamp: new Date().toISOString(), latency_ms: 700, failed: true },
            ],
          },
        },
      },
    },
  },
};

Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(req) {
    const origin = req.headers.get('Origin') ?? '';
    const headers = {
      'Access-Control-Allow-Origin': ['http://127.0.0.1:5173', 'http://127.0.0.1:4173'].includes(
        origin
      )
        ? origin
        : 'http://127.0.0.1:5173',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'X-Cpa-Support-Plugin': 'false',
    };
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
    if (req.method === 'OPTIONS') return new Response(null, { headers });
    const url = new URL(req.url);
    const path = url.pathname.replace('/v0/management', '');
    if (!path.startsWith('/__mock/')) counts[path] = (counts[path] ?? 0) + 1;
    if (path === '/__mock/requests') return json(counts);
    if (path === '/__mock/state' && req.method === 'POST') {
      const body: unknown = await req.json();
      if (!body || typeof body !== 'object') return json({ error: 'Invalid mock state' }, 400);
      if ('failedAccounts' in body) {
        if (
          !Array.isArray(body.failedAccounts) ||
          !body.failedAccounts.every((v) => typeof v === 'string')
        )
          return json({ error: 'Expected mock account IDs' }, 400);
        failedAccounts = body.failedAccounts;
      }
      if ('delayMs' in body) {
        if (typeof body.delayMs !== 'number' || body.delayMs < 0 || body.delayMs > 3000)
          return json({ error: 'Expected delay between 0 and 3000 ms' }, 400);
        delayMs = body.delayMs;
      }
      if ('usageEnabled' in body) {
        if (body.usageEnabled !== null && typeof body.usageEnabled !== 'boolean')
          return json({ error: 'Expected boolean or null' }, 400);
        usageEnabled = body.usageEnabled;
      }
      if ('usageFails' in body) {
        if (typeof body.usageFails !== 'boolean') return json({ error: 'Expected boolean' }, 400);
        usageFails = body.usageFails;
      }
      return json({ mock: true });
    }
    if (path === '/__mock/qoder' && req.method === 'POST') {
      const { used } = (await req.json()) as { used?: number };
      if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || used > 100)
        return json({ error: 'Expected used between 0 and 100' }, 400);
      qoderUsed = used;
      return json({ used });
    }
    if (req.method !== 'GET' && path !== '/api-call')
      return json({ error: 'Read-only mock preview' }, 405);
    if (path === '/config')
      return json({
        'mock-data': true,
        'api-keys': ['mock-preview-key'],
        'logging-to-file': true,
        'request-log': true,
        ...(usageEnabled === null ? {} : { 'usage-statistics-enabled': usageEnabled }),
      });
    if (path === '/config.yaml')
      return new Response(
        '# MOCK DATA ONLY\nlogging-to-file: true\nrequest-log: true\nrequest-retry: 3\n' +
          (usageEnabled === null ? '' : `usage-statistics-enabled: ${usageEnabled}\n`),
        { headers }
      );
    if (path === '/oauth-excluded-models') return json({ 'oauth-excluded-models': {} });
    if (path === '/oauth-model-alias') return json({ 'oauth-model-alias': {} });
    if (path === '/request-log') return json({ 'request-log': true });
    if (path === '/logging-to-file') return json({ 'logging-to-file': true });
    if (path === '/request-error-logs') return json({ files: [] });
    if (path === '/logs')
      return json({
        lines: url.searchParams.get('cursor')
          ? []
          : [
              '[2026-11-02 11:00:00] [info] [mock] GET /v1/models 200 12ms',
              '[2026-11-02 11:01:00] [warn] [mock] GET /v1/chat/completions 429 25ms',
              '[2026-11-02 11:02:00] [info] [mock] mock-account quota check complete',
            ],
        'next-cursor': 'mock-static',
        'latest-timestamp': 1793635320,
      });
    if (path === '/api-keys') return json({ 'api-keys': ['mock-preview-key'] });
    if (path === '/api-key-usage') return json({});
    if (path === '/v1/models')
      return json({ data: [{ id: 'mock-model', object: 'model', owned_by: 'mock' }] });
    if (path === '/usage-statistics-enabled')
      return json(usageEnabled === null ? {} : { 'usage-statistics-enabled': usageEnabled });
    if (path === '/usage')
      return usageFails ? json({ error: 'Mock snapshot unavailable' }, 503) : json(sampleUsage);
    if (path === '/auth-files')
      return json({
        observed_at: new Date().toISOString(),
        files: files.map((file, index) => ({
          ...file,
          status: 'active',
          recent_requests: Array.from({ length: 20 }, (_, bucket) => ({
            success: (bucket + index) % 7,
            failed: bucket === 10 && index === 0 ? 1 : 0,
          })),
          ...(file.type === 'qoder' ? { usage: { used: qoderUsed, total: 100 } } : {}),
        })),
      });
    if (path === '/copilot-quota') {
      if (delayMs) await Bun.sleep(delayMs);
      if (failedAccounts.includes('copilot-1')) return json({ error: 'Mock quota failure' }, 503);
      if (url.searchParams.get('auth_index') !== 'copilot-1')
        return json({ error: 'Wrong mock credential' }, 400);
      return json({
        copilot_plan: 'individual',
        quota_reset_date: reset(120),
        quota_snapshots: {
          premium_interactions: {
            entitlement: 300,
            remaining: 219,
            percent_remaining: 73,
            unlimited: false,
          },
          chat: { unlimited: true, entitlement: 0, remaining: 0, percent_remaining: 100 },
          completions: { unlimited: true, entitlement: 0, remaining: 0, percent_remaining: 100 },
        },
      });
    }
    if (path === '/api-call' && req.method === 'POST') {
      const payload = (await req.json()) as { url?: string; authIndex?: string };
      if (delayMs) await Bun.sleep(delayMs);
      if (payload.authIndex && failedAccounts.includes(payload.authIndex))
        return json({ status_code: 503, header: {}, body: '{"error":"Mock quota failure"}' });
      const index = Number(payload.authIndex?.split('-').pop() ?? 1);
      let body: unknown;
      if (payload.url?.includes('usage') && payload.authIndex?.startsWith('claude')) {
        body = {
          five_hour: { utilization: 12 + index * 6, resets_at: reset(1 + index) },
          seven_day: { utilization: 15 + index * 8, resets_at: reset(20 + index * 22) },
        };
      } else if (payload.url?.includes('profile')) {
        body = {
          account: { has_claude_max: true },
          organization: { rate_limit_tier: 'default_claude_max_5x' },
        };
      } else if (payload.url?.includes('usage') && payload.authIndex?.startsWith('codex')) {
        body = {
          plan_type: 'pro',
          rate_limit: {
            primary_window: {
              used_percent: 8 + index * 5,
              limit_window_seconds: 18_000,
              reset_at: Date.now() / 1000 + 7200,
            },
            secondary_window: {
              used_percent: 10 + index * 9,
              limit_window_seconds: 604_800,
              reset_at: Date.now() / 1000 + (32 + index * 10) * 3600,
            },
          },
        };
      } else {
        body = {};
      }
      return json({ status_code: 200, header: {}, body: JSON.stringify(body) });
    }
    if (path === '/plugins') return json({ plugins: [] });
    return json({ error: `No mock response for ${path}` }, 404);
  },
});
console.log(`MOCK DATA ONLY. Quota preview API on http://127.0.0.1:${port}`);
