// Repeatable local-only visual evidence. No production requests or real credentials.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [round = '1'] = process.argv.slice(2);
const out = path.resolve(`design-review/council/round-${round}/screenshots`);
await fs.mkdir(out, { recursive: true });
const playwrightPath = process.env.PLAYWRIGHT_MODULE;
if (!playwrightPath) throw new Error('Set PLAYWRIGHT_MODULE to installed playwright-core/index.mjs');
const { chromium } = await import(pathToFileURL(playwrightPath));
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', locale: 'en-US' });
const origin = 'http://127.0.0.1:5173';
const now = Date.now();
const files = ['claude', 'codex', 'gemini'].flatMap((provider) => [1, 2].map((n) => ({
  name: `${provider}-workspace-${n}.json`, provider, type: provider, auth_index: `${provider}-${n}`,
  id: `${provider}-${n}`, label: `${provider === 'claude' ? 'Claude' : provider === 'codex' ? 'Codex' : 'Gemini'} workspace ${n}`,
  status: 'active', disabled: false, unavailable: false, created_at: new Date(now - 86400000 * 12).toISOString(),
  updated_at: new Date(now - 300000).toISOString(), email: `workspace-${n}@example.test`,
}))) ;
const models = ['claude-sonnet-4-5', 'gpt-5.2-codex', 'gemini-2.5-pro'];
const usageModels = Object.fromEntries(models.map((name, k) => {
  const details = Array.from({ length: 160 }, (_, i) => ({
    timestamp: new Date(now - ((159 - i) * 270000 + k * 10000 + 1000)).toISOString(),
    latency_ms: 350 + (i * 137 % 1800), source: files[k * 2].name, auth_index: files[k * 2].auth_index,
    failed: i % 49 === 0, tokens: { input_tokens: 1200 + i * 3, output_tokens: 250 + i, total_tokens: 1450 + i * 4 },
  }));
  return [name, { total_requests: details.length, total_tokens: details.reduce((s, d) => s + d.tokens.total_tokens, 0), details }];
}));
const config = { 'api-keys': ['local-fixture-key'], 'usage-statistics-enabled': true, 'request-log': true,
  'debug': false, 'logging-to-file': true, 'routing': { strategy: 'round-robin' },
  'gemini-api-key': [{ 'api-key': 'fixture-gemini', prefix: 'workspace', models: [{ name: 'gemini-2.5-pro', alias: '' }] }],
  'claude-api-key': [{ 'api-key': 'fixture-claude', models: [{ name: 'claude-sonnet-4-5', alias: '' }] }],
  'codex-api-key': [{ 'api-key': 'fixture-codex', models: [{ name: 'gpt-5.2-codex', alias: '' }] }],
  'openai-compatibility': [], 'oauth-excluded-models': { claude: ['claude-legacy'] },
  'oauth-model-alias': { codex: [{ name: 'gpt-5.2-codex', alias: 'code', fork: true }] },
};
const requests = [];
await context.route('**/*', async (route) => {
  let url;
  try { url = new URL(route.request().url()); } catch { return route.abort(); }
  if (url.origin !== origin) return route.abort();
  const endpoint = url.pathname.split('/v0/management')[1];
  if (endpoint === undefined && url.pathname !== '/v1/models') return route.continue();
  requests.push({ method: route.request().method(), path: endpoint ?? '/v1/models' });
  let body;
  if (url.pathname === '/v1/models') body = { data: models.map(id => ({ id, object: 'model', owned_by: 'fixture' })) };
  else if (endpoint === '/config') body = config;
  else if (endpoint === '/auth-files') body = { files, observed_at: new Date().toISOString() };
  else if (endpoint === '/usage-statistics-enabled') body = { 'usage-statistics-enabled': true };
  else if (endpoint === '/usage') body = { statistics_enabled: true, usage: { total_requests: 480, success_count: 468, failure_count: 12, total_tokens: 848640, apis: { 'local-fixture-key': { total_requests: 480, total_tokens: 848640, models: usageModels } } } };
  else if (endpoint === '/api-keys') body = { 'api-keys': ['local-fixture-key'] };
  else if (endpoint === '/api-key-usage') body = { keys: [], usage: {}, observed_at: new Date().toISOString() };
  else if (endpoint === '/plugins') body = { plugins: [] };
  else if (endpoint === '/plugin-store') body = { plugins: [], sources: [], errors: [] };
  else if (endpoint === '/logs') body = { lines: ['2026-10-20T09:42:10Z INFO Management API ready', '2026-10-20T09:42:12Z INFO Provider pool synchronized', '2026-10-20T09:42:18Z INFO Request completed model=claude-sonnet-4-5 status=200 duration=842ms'], 'latest-timestamp': 0 };
  else if (endpoint === '/config.yaml') return route.fulfill({ status: 200, contentType: 'text/yaml', body: 'port: 8317\nusage-statistics-enabled: true\nrequest-log: true\nrouting:\n  strategy: round-robin\n' });
  else if (endpoint === '/oauth-excluded-models') body = { 'oauth-excluded-models': config['oauth-excluded-models'] };
  else if (endpoint === '/oauth-model-alias') body = { 'oauth-model-alias': config['oauth-model-alias'] };
  else if (endpoint === '/api-call') body = { status_code: 200, header: {}, body: JSON.stringify({ five_hour: { utilization: 22, resets_at: new Date(now + 7200000).toISOString() }, seven_day: { utilization: 38, resets_at: new Date(now + 259200000).toISOString() }, rate_limit: { primary_window: { used_percent: 22, reset_at: Math.floor((now + 7200000) / 1000), limit_window_seconds: 18000 }, secondary_window: { used_percent: 38, reset_at: Math.floor((now + 259200000) / 1000), limit_window_seconds: 604800 } } }) };
  else if (endpoint === '/latest-version') body = { 'latest-version': 'v6.8.0' };
  else body = {};
  return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'x-cpa-version': '6.8.0', 'x-cpa-support-plugin': 'true' }, body: JSON.stringify(body) });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto(origin);
await page.evaluate(async () => {
  const { useLanguageStore } = await import('/src/stores/useLanguageStore.ts');
  useLanguageStore.getState().setLanguage('en');
});
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/login-1440.png` });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: `${out}/login-390.png` });
await page.evaluate(async () => {
  const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
  await useAuthStore.getState().login({ apiBase: location.origin, managementKey: 'local-fixture-not-secret', rememberPassword: true });
});
const routes = [ ['dashboard', '/'], ['quick-start', '/quick-start'], ['providers', '/ai-providers'], ['auth-files', '/auth-files'], ['oauth-excluded', '/auth-files/oauth-excluded'], ['oauth-model-alias', '/auth-files/oauth-model-alias'], ['oauth', '/oauth'], ['quota', '/quota'], ['usage', '/usage'], ['config', '/config'], ['logs', '/logs'], ['system', '/system'], ['plugins', '/plugins'], ['plugin-store', '/plugin-store'] ];
const records = [];
for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
  for (const [name, route] of routes) {
    await page.goto(`${origin}/#${route}`);
    await page.reload();
    await page.waitForFunction(route => location.hash === `#${route}` && document.querySelector('main h1') && (route === '/' || document.querySelector('main h1').textContent !== 'Dashboard'), route, { timeout: 15000 });
    await page.waitForTimeout(800);
    const record = await page.evaluate(() => ({ hash: location.hash, heading: document.querySelector('main h1')?.textContent, overflow: document.documentElement.scrollWidth > innerWidth, chartLines: document.querySelectorAll('path.recharts-line-curve').length }));
    if (!record.heading || record.hash !== `#${route}` || (name !== 'dashboard' && record.heading === 'Dashboard')) throw new Error(`Route identity failed ${name} ${width}: ${JSON.stringify(record)}`);
    await page.screenshot({ path: `${out}/${name}-${width}.png` });
    records.push({ name, width, ...record });
  }
}
await page.setViewportSize({ width: 1440, height: 1000 });
await page.evaluate(async () => { const { useThemeStore } = await import('/src/stores/useThemeStore.ts'); useThemeStore.getState().setTheme('dark'); });
for (const [name, route] of routes.filter(([name]) => ['dashboard', 'providers', 'quota', 'config'].includes(name))) {
  await page.goto(`${origin}/#${route}`); await page.reload();
  await page.waitForFunction(route => location.hash === `#${route}` && document.querySelector('main h1') && (route === '/' || document.querySelector('main h1').textContent !== 'Dashboard'), route, { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}-dark-1440.png` });
}
await fs.writeFile(`${out}/../evidence.json`, JSON.stringify({ round, capturedAt: new Date().toISOString(), note: 'Synthetic local fixtures only. No live backend. API responses are visual fixtures, not backend contract validation. Reduced motion. Viewport-only screenshots. Quota data may be partial for unsupported fixture shapes.', records, errors, requests }, null, 2));
await browser.close();
console.log(JSON.stringify({ out, screenshots: records.length + 6, errors, overflows: records.filter(x => x.overflow) }));
