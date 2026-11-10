import { readFile, readdir, writeFile } from 'node:fs/promises';

// Literal route migration only. Payload/schema changes are covered by the v8 API tests.
const routes = new Map([
  [
    'src/utils/constants.ts',
    [
      [
        "export const MANAGEMENT_API_PREFIX = '/v0/management';",
        "export const MANAGEMENT_API_PREFIX = '/v8/management';",
      ],
    ],
  ],
  ['src/services/api/apiCall.ts', [["'/api-call'", "'/requests/api-call'"]]],
  ['src/services/api/apiKeyUsage.ts', [["'/api-key-usage'", "'/observability/usage/api-keys'"]]],
  ['src/services/api/version.ts', [["'/latest-version'", "'/server/latest-version'"]]],
  ['src/services/api/vertex.ts', [["'/vertex/import'", "'/oauth/import?provider=vertex'"]]],
  ['src/services/api/config.ts', [["'/request-log'", "'/config/observability/logs/request-log'"]]],
  [
    'src/services/api/authFiles.ts',
    [
      ["'/auth-files'", "'/credentials'"],
      ["'/auth-files/status'", "'/credentials/status'"],
      ["'/auth-files/fields'", "'/credentials/fields'"],
      ["'/auth-files/refresh'", "'/credentials/refresh'"],
      ["'/reset-quota'", "'/routing/cooldown/reset'"],
      ['`/auth-files/download?', '`/credentials/download?'],
      ['`/auth-files/models?', '`/credentials/models?'],
      ['`/model-definitions/', '`/routing/model-definitions/'],
    ],
  ],
  [
    'src/services/api/logs.ts',
    [
      ["'/logs'", "'/observability/logs'"],
      ["'/request-error-logs'", "'/observability/logs/errors'"],
      ['`/request-error-logs/', '`/observability/logs/errors/'],
      ['`/request-log-by-id/', '`/observability/logs/requests/'],
    ],
  ],
  [
    'src/services/api/oauth.ts',
    [
      ['`/get-auth-status`', '`/oauth/status`'],
      ["'/oauth-session'", "'/oauth/session'"],
      ["'/oauth-callback'", "'/oauth/callback'"],
    ],
  ],
  ['tests/codexQuotaReset.test.ts', [["'/reset-quota'", "'/routing/cooldown/reset'"]]],
  ['tests/devinQuotaLiveApi.test.ts', [["'/api-call'", "'/requests/api-call'"]]],
  ['tests/metaQuotaDcaIntegration.test.ts', [["'/api-call'", "'/requests/api-call'"]]],
  ['tests/authFileManualRefresh.test.ts', [["'/auth-files/refresh'", "'/credentials/refresh'"]]],
  [
    'tests/devinQuotaApi.test.ts',
    [
      ["'/auth-files/refresh'", "'/credentials/refresh'"],
      ["'/auth-files'", "'/credentials'"],
    ],
  ],
  ['tests/oauthRequestCancellation.test.ts', [["'/get-auth-status'", "'/oauth/status'"]]],
  [
    'tests/devinOAuthApi.test.ts',
    [
      ["'/devin-auth-url'", "'/oauth/auth-url'"],
      ["'/get-auth-status'", "'/oauth/status'"],
      ["'/oauth-session'", "'/oauth/session'"],
      ["'/oauth-callback'", "'/oauth/callback'"],
    ],
  ],
]);
const changes = [];
for (const [path, replacements] of routes) {
  const original = await readFile(path, 'utf8');
  let next = original;
  for (const [before, after] of replacements) {
    if (next.includes(before)) next = next.replaceAll(before, after);
    else if (!next.includes(after))
      throw new Error(`Route contract moved unexpectedly in ${path}: ${before}`);
  }
  if (next !== original) changes.push({ path, next });
}
if (process.argv.includes('--apply')) {
  for (const { path, next } of changes) await writeFile(path, next);
  console.log(`Applied v8 routes to ${changes.length} files.`);
} else if (changes.length) {
  console.error(
    `Legacy routes remain in ${changes.map(({ path }) => path).join(', ')}. Run with --apply to migrate.`
  );
  process.exitCode = 1;
} else {
  console.log(`Verified v8 route contracts in ${routes.size} files.`);
}

const legacyRoute =
  /['"`]\/(?:auth-files|reset-quota|api-call|api-keys|api-key-usage|model-definitions|logs|request-log|request-error-logs|request-log-by-id|plugin-store|oauth-excluded-models|oauth-model-alias|oauth-session|oauth-callback|get-auth-status|latest-version|quota\/fetch|vertex\/import|(?:codex|anthropic|antigravity|kimi|kimi-ai|xai|devin|meta)-auth-url)(?=[/'"`?])/;
const modules = (await readdir('src/services/api')).filter((path) => path.endsWith('.ts'));
for (const module of modules) {
  const path = `src/services/api/${module}`;
  const source = await readFile(path, 'utf8');
  if (module !== 'legacyBackendProbe.ts' && source.includes('/v0/management')) {
    throw new Error(`Hardcoded v0 transport outside the diagnostic probe in ${path}`);
  }
  const match = source.match(legacyRoute);
  if (match) throw new Error(`Legacy operational route in ${path}: ${match[0]}`);
}
console.log(
  `Checked ${modules.length} API modules for legacy operational routes. Usage/Copilot extensions and the diagnostic v0 probe remain explicit exceptions.`
);
