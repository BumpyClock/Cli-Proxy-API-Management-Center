// Synthetic Management API fixtures for local browser audits. Mirrors the council capture
// harness so audits and captures see the same state. Never reaches a real backend: every
// non-origin request is aborted and every /v8/management call is fulfilled locally.
import { stringify } from 'yaml';

const MODELS = ['claude-sonnet-4-5', 'gpt-5.2-codex', 'gemini-2.5-pro'];

export function buildFixtures(now = Date.now()) {
  const files = ['claude', 'codex', 'gemini'].flatMap((provider) =>
    [1, 2].map((n) => ({
      name: `${provider}-workspace-${n}.json`,
      provider,
      type: provider,
      auth_index: `${provider}-${n}`,
      id: `${provider}-${n}`,
      label: `${provider[0].toUpperCase()}${provider.slice(1)} workspace ${n}`,
      status: 'active',
      disabled: false,
      unavailable: false,
      created_at: new Date(now - 86400000 * 12).toISOString(),
      updated_at: new Date(now - 300000).toISOString(),
      email: `workspace-${n}@example.test`,
    }))
  );
  const usageModels = Object.fromEntries(
    MODELS.map((name, k) => {
      const details = Array.from({ length: 160 }, (_, i) => ({
        timestamp: new Date(now - ((159 - i) * 270000 + k * 10000 + 1000)).toISOString(),
        latency_ms: 350 + ((i * 137) % 1800),
        source: files[k * 2].name,
        auth_index: files[k * 2].auth_index,
        failed: i % 49 === 0,
        tokens: { input_tokens: 1200 + i * 3, output_tokens: 250 + i, total_tokens: 1450 + i * 4 },
      }));
      return [
        name,
        {
          total_requests: details.length,
          total_tokens: details.reduce((s, d) => s + d.tokens.total_tokens, 0),
          details,
        },
      ];
    })
  );
  const config = {
    'config-version': 8,
    server: { port: 8317 },
    access: { 'api-keys': ['local-fixture-key'] },
    observability: {
      usage: { 'usage-statistics-enabled': true },
      logs: { 'request-log': true, debug: false, 'logging-to-file': true },
    },
    routing: { strategy: 'round-robin' },
    'api-keys': {
      gemini: [
        {
          name: 'gemini-fixture',
          keys: [
            {
              'api-key': 'fixture-gemini',
              prefix: 'workspace',
              models: [{ name: 'gemini-2.5-pro', alias: '' }],
            },
          ],
        },
      ],
      claude: [
        {
          name: 'claude-fixture',
          keys: [
            {
              'api-key': 'fixture-claude',
              models: [{ name: 'claude-sonnet-4-5', alias: '' }],
            },
          ],
        },
      ],
      codex: [
        {
          name: 'codex-fixture',
          keys: [
            {
              'api-key': 'fixture-codex',
              models: [{ name: 'gpt-5.2-codex', alias: '' }],
            },
          ],
        },
      ],
      'openai-compatibility': [],
    },
    oauth: {
      'excluded-models': { claude: ['claude-legacy'] },
      'model-alias': { codex: [{ name: 'gpt-5.2-codex', alias: 'code', fork: true }] },
    },
  };
  const quotaBody = JSON.stringify({
    five_hour: { utilization: 22, resets_at: new Date(now + 7200000).toISOString() },
    seven_day: { utilization: 38, resets_at: new Date(now + 259200000).toISOString() },
    rate_limit: {
      primary_window: {
        used_percent: 22,
        reset_at: Math.floor((now + 7200000) / 1000),
        limit_window_seconds: 18000,
      },
      secondary_window: {
        used_percent: 38,
        reset_at: Math.floor((now + 259200000) / 1000),
        limit_window_seconds: 604800,
      },
    },
  });
  const routes = {
    '/config': config,
    '/credentials': () => ({ files, observed_at: new Date().toISOString() }),
    '/config/observability/usage/usage-statistics-enabled': true,
    '/usage': {
      statistics_enabled: true,
      usage: {
        total_requests: 480,
        success_count: 468,
        failure_count: 12,
        total_tokens: 848640,
        apis: {
          'local-fixture-key': { total_requests: 480, total_tokens: 848640, models: usageModels },
        },
      },
    },
    '/config/access/api-keys': ['local-fixture-key'],
    '/observability/usage/api-keys': () => ({
      keys: [],
      usage: {},
      observed_at: new Date().toISOString(),
    }),
    '/plugins': { plugins: [] },
    '/plugins/store': { plugins: [], sources: [], errors: [] },
    '/observability/logs': {
      lines: [
        '2026-10-20T09:42:10Z INFO Management API ready',
        '2026-10-20T09:42:12Z INFO Provider pool synchronized',
        '2026-10-20T09:42:18Z INFO Request completed model=claude-sonnet-4-5 status=200 duration=842ms',
      ],
      'latest-timestamp': 0,
    },
    '/config/oauth/excluded-models': config.oauth['excluded-models'],
    '/config/oauth/model-alias': config.oauth['model-alias'],
    '/requests/api-call': { status_code: 200, header: {}, body: quotaBody },
    '/server/latest-version': { 'latest-version': 'v8.0.63' },
  };
  return { routes, models: MODELS };
}

export async function installFixtures(context, origin, overrides = {}) {
  const { routes, models } = buildFixtures();
  Object.assign(routes, overrides);
  await context.route('**/*', async (route) => {
    let url;
    try {
      url = new URL(route.request().url());
    } catch {
      return route.abort();
    }
    if (url.origin !== origin) return route.abort();
    const endpoint = url.pathname.split('/v8/management')[1];
    if (endpoint === undefined && url.pathname !== '/v1/models') return route.continue();
    if (endpoint === '/config.yaml') {
      return route.fulfill({
        status: 200,
        contentType: 'text/yaml',
        headers: { etag: '"fixture"' },
        body: '# SYNTHETIC V8 CONFIGURATION\n' + stringify(routes['/config']),
      });
    }
    let body;
    let status = 200;
    if (url.pathname === '/v1/models') {
      body = { data: models.map((id) => ({ id, object: 'model', owned_by: 'fixture' })) };
    } else {
      const entry = routes[endpoint];
      const value = typeof entry === 'function' ? entry() : entry;
      if (value && typeof value === 'object' && '__status' in value) {
        status = value.__status;
        body = value.body ?? {};
      } else {
        if (value === undefined) status = 404;
        body = value ?? { error: 'not_found' };
      }
    }
    return route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'x-cpa-version': '8.0.63', 'x-cpa-support-plugin': 'true', etag: '"fixture"' },
      body: JSON.stringify(body),
    });
  });
}

export async function login(page, origin) {
  await page.goto(origin);
  await page.evaluate(async () => {
    const { useLanguageStore } = await import('/src/stores/useLanguageStore.ts');
    useLanguageStore.getState().setLanguage('en');
  });
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
    await useAuthStore.getState().login({
      apiBase: location.origin,
      managementKey: 'local-fixture-not-secret',
      rememberPassword: true,
    });
  });
}

export async function gotoRoute(page, origin, route) {
  await page.goto(`${origin}/#${route}`);
  await page.reload();
  await page.waitForFunction(
    (r) =>
      location.hash === `#${r}` &&
      document.querySelector('main h1') &&
      (r === '/' ||
        !r.startsWith('/') ||
        document.querySelector('main h1').textContent !== 'Dashboard'),
    route,
    { timeout: 15000 }
  );
  await page.waitForTimeout(800);
}
