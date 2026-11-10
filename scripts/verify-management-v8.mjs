// Run only against the disposable backend fixture described in docs/management-v8.md.
import assert from 'node:assert/strict';
import { assertFixtureConfig, fixtureConnection } from './lib/management-v8-fixture.mjs';
import { apiClient } from '../src/services/api/client.ts';
import { configApi } from '../src/services/api/config.ts';
import { apiKeysApi } from '../src/services/api/apiKeys.ts';
import { providersApi } from '../src/services/api/providers.ts';
import { authFilesApi } from '../src/services/api/authFiles.ts';
import { pluginsApi } from '../src/services/api/plugins.ts';
import { usageApi } from '../src/services/api/usage.ts';
import { apiCallApi } from '../src/services/api/apiCall.ts';
import { apiKeyUsageApi } from '../src/services/api/apiKeyUsage.ts';

const passed = (name) => console.log(`PASS ${name}`);
let probe;
let credentialUploaded = false;
const credentialName = 'cpamc-v8-smoke.json';

try {
  const { base, key } = fixtureConnection();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  apiClient.setConfig({ apiBase: base, managementKey: key });
  const initial = await configApi.getConfig();
  assertFixtureConfig(initial.raw);
  assert.equal((await authFilesApi.list()).files.length, 0, 'Refusing existing auth files.');
  passed('native v8 JSON configuration and credential reads');

  await apiKeysApi.update(0, 'cpamc-smoke-client-updated');
  assert((await apiKeysApi.list())[0] === 'cpamc-smoke-client-updated');
  await apiKeysApi.replace(['cpamc-smoke-client-only']);
  await configApi.updateRequestLog(true);
  assert.equal((await configApi.getConfig()).requestLog, true);
  await configApi.updateRequestLog(false);
  passed('bare scalar and ETag-bound client-key writes');

  credentialUploaded = true;
  const upload = await authFilesApi.uploadFiles([
    new File(
      [
        JSON.stringify({
          type: 'codex',
          disabled: true,
          access_token: 'cpamc-smoke-unusable',
          refresh_token: '',
          expired: '2099-01-01T00:00:00Z',
        }),
      ],
      credentialName,
      { type: 'application/json' }
    ),
  ]);
  assert.equal(upload.uploaded, 1);
  await authFilesApi.setStatus(credentialName, true);
  await authFilesApi.patchFields(credentialName, { priority: 7 });
  const credential = (await authFilesApi.list()).files.find((file) => file.name === credentialName);
  assert(credential?.disabled === true && credential.priority === 7);
  const authIndex = credential.authIndex ?? credential.auth_index;
  assert(typeof authIndex === 'string' && authIndex.length > 0);
  await authFilesApi.resetCooldown(authIndex);
  const download = await apiClient.getRaw(`/credentials/download?name=${credentialName}`, {
    responseType: 'text',
  });
  assert.equal(JSON.parse(String(download.data)).priority, 7);
  assert.equal((await authFilesApi.deleteFiles([credentialName])).deleted, 1);
  credentialUploaded = false;
  passed('disabled synthetic credential upload, fields, cooldown, download and deletion');

  await providersApi.createMetaConfig({
    apiKey: 'cpamc-smoke-upstream',
    baseUrl: 'https://provider.invalid/v1',
  });
  let meta = (await configApi.getConfig()).metaApiKeys[0];
  await providersApi.updateMetaConfig(meta.apiKey, meta.baseUrl, { ...meta, weight: 3 });
  meta = (await configApi.getConfig()).metaApiKeys[0];
  assert.equal(meta.weight, 3);
  await providersApi.deleteMetaConfig(meta.apiKey, meta.baseUrl, meta.source);
  assert.equal((await configApi.getConfig()).metaApiKeys.length, 0);
  await providersApi.createOpenAIProvider({
    name: 'cpamc-smoke-openai',
    baseUrl: 'https://provider.invalid/v1',
    apiKeyEntries: [{ apiKey: 'cpamc-smoke-upstream' }],
  });
  let compat = (await providersApi.getOpenAIProviders())[0];
  await providersApi.updateOpenAIProvider(compat.name, 0, { ...compat, priority: 2 });
  compat = (await providersApi.getOpenAIProviders())[0];
  assert.equal(compat.priority, 2);
  await providersApi.deleteOpenAIProvider(0, compat.source);
  assert.equal((await providersApi.getOpenAIProviders()).length, 0);
  passed('native provider-group creation, editing and removal');

  await authFilesApi.saveOauthExcludedModels('claude', ['cpamc-smoke-model']);
  assert.deepEqual((await authFilesApi.getOauthExcludedModels()).claude, ['cpamc-smoke-model']);
  await authFilesApi.deleteOauthExcludedEntry('claude');
  await authFilesApi.saveOauthModelAlias('codex', [
    { name: 'cpamc-smoke-model', alias: 'cpamc-smoke-alias', forceMapping: true },
  ]);
  assert.equal((await authFilesApi.getOauthModelAlias()).codex[0].forceMapping, true);
  await authFilesApi.deleteOauthModelAlias('codex');
  passed('native OAuth whole-map replacements and deletions');

  await pluginsApi.patchConfig('cpamc-v8-smoke', { enabled: false, marker: 'synthetic' });
  await pluginsApi.patchConfig('cpamc-v8-smoke', { marker: null });
  const plugin = await pluginsApi.getConfig('cpamc-v8-smoke');
  assert.equal(plugin.enabled, false);
  assert(!Object.prototype.hasOwnProperty.call(plugin, 'marker'));
  await pluginsApi.list();
  passed('native plugin configuration replacement and cleared-field removal');

  assert.deepEqual(await usageApi.getUsage(), { supported: false });
  assert.equal(await usageApi.getStatisticsEnabled(), true);
  await apiKeyUsageApi.getUsage();
  passed('unsupported usage snapshots and supported API-key activity without queue reads');

  let requests = 0;
  probe = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      requests += 1;
      return Response.json({ marker: 'cpamc-smoke-local-only' });
    },
  });
  const request = { method: 'GET', url: `http://127.0.0.1:${probe.port}/models` };
  let blocked = false;
  try {
    blocked = (await apiCallApi.request(request)).statusCode !== 200;
  } catch (error) {
    blocked = typeof error?.status === 'number' && error.status >= 400;
  }
  assert(
    blocked && requests === 0,
    'The global-proxy baseline must fail before reaching the local target.'
  );
  const result = await apiCallApi.request({ ...request, proxy_url: 'direct' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.marker, 'cpamc-smoke-local-only');
  assert.equal(requests, 1);
  passed('proxy-aware API call bypasses a proven unreachable global proxy with direct');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Native v8 smoke failed.');
  process.exitCode = 1;
} finally {
  if (credentialUploaded) {
    try {
      await authFilesApi.deleteFile(credentialName);
    } catch {
      console.error('Disposable credential cleanup failed. Destroy the fixture sandbox.');
    }
  }
  probe?.stop(true);
  apiClient.setConfig({ apiBase: '', managementKey: '' });
}
