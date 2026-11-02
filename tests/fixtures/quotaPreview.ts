/** Local UI verification only. Every credential and quota below is synthetic. */
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
const reset = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const headers = {
  'Access-Control-Allow-Origin': 'http://127.0.0.1:5173',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'X-Cpa-Support-Plugin': 'false',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers });
    const url = new URL(req.url);
    const path = url.pathname.replace('/v0/management', '');
    if (path === '/config') return json({ 'mock-data': true });
    if (path === '/__mock/qoder' && req.method === 'POST') {
      const { used } = (await req.json()) as { used?: number };
      if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || used > 100)
        return json({ error: 'Expected used between 0 and 100' }, 400);
      qoderUsed = used;
      return json({ used });
    }
    if (path === '/auth-files')
      return json({
        files: files.map((file) =>
          file.type === 'qoder' ? { ...file, usage: { used: qoderUsed, total: 100 } } : file
        ),
      });
    if (path === '/copilot-quota') {
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
