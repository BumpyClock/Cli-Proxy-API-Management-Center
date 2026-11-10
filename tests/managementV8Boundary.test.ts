import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import axios, { type AxiosAdapter } from 'axios';
import { resolve } from 'node:path';
import { apiClient } from '@/services/api/client';
import { apiKeysApi } from '@/services/api/apiKeys';
import { authFilesApi } from '@/services/api/authFiles';
import { configApi } from '@/services/api/config';
import { oauthApi } from '@/services/api/oauth';
import { pluginsApi } from '@/services/api/plugins';
import { getConfigValue } from '@/services/api/configValue';
import { probeLegacyBackend } from '@/services/api/legacyBackendProbe';
import { usageApi } from '@/services/api/usage';
import { normalizeApiBase } from '@/utils/connection';
import { configResponse } from './fixtures/managementV8';

const mocks: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const mock of mocks.splice(0)) mock.mockRestore();
  apiClient.setConfig({ apiBase: '', managementKey: '' });
});

test('the route migration remains idempotent and guards operational API modules', () => {
  const result = Bun.spawnSync([process.execPath, 'scripts/migrations/management-v8.mjs'], {
    cwd: resolve(import.meta.dir, '..'),
  });
  expect(new TextDecoder().decode(result.stderr)).toBe('');
  expect(result.exitCode).toBe(0);
  expect(new TextDecoder().decode(result.stdout)).toContain('legacy operational routes');
});

describe('v8 transport and access keys', () => {
  test.each(['v0', 'v8'])(
    'normalizes explicit %s URLs without changing mount identity',
    async (version) => {
      const input = `https://proxy.test/mount/${version}/management/`;
      expect(normalizeApiBase(input)).toBe('https://proxy.test/mount');
      apiClient.setConfig({ apiBase: input, managementKey: 'fixture-only' });
      const adapter: AxiosAdapter = async (config) => {
        expect(config.baseURL).toBe('https://proxy.test/mount/v8/management');
        expect(config.headers.Authorization).toBe('Bearer fixture-only');
        expect(config.data).toBe('false');
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      };
      await apiClient.put('/config/observability/logs/debug', false, { adapter });
    }
  );

  test('replaces only client access keys when updating an entry', async () => {
    const get = spyOn(apiClient, 'getRaw').mockResolvedValue(
      configResponse({ access: { 'api-keys': ['first', 'second'] } })
    );
    const put = spyOn(apiClient, 'put').mockResolvedValue({});
    mocks.push(get, put);
    await apiKeysApi.update(1, 'replacement');
    expect(get).toHaveBeenCalledWith('/config');
    expect(put).toHaveBeenCalledWith('/config/access/api-keys', ['first', 'replacement'], {
      headers: { 'If-Match': '"fixture"' },
    });
  });

  test('does not turn a missing API route into an empty editable configuration', async () => {
    const get = spyOn(apiClient, 'get').mockRejectedValue({ status: 404 });
    mocks.push(get);
    await expect(getConfigValue('/config/access/api-keys', [])).rejects.toMatchObject({
      status: 404,
    });
    get.mockRejectedValue({ status: 404, apiCode: 'not_found' });
    expect(await getConfigValue('/config/access/api-keys', [])).toEqual([]);
  });

  test('writes request logging as a bare boolean', async () => {
    const put = spyOn(apiClient, 'put').mockResolvedValue({});
    mocks.push(put);
    await configApi.updateRequestLog(false);
    expect(put).toHaveBeenCalledWith('/config/observability/logs/request-log', false);
  });
});

describe('whole-map configuration mutations', () => {
  test('concurrent OAuth provider edits preserve unrelated values and each other', async () => {
    let current: Record<string, unknown> = { future: ['unchanged'], claude: ['old'] };
    const get = spyOn(apiClient, 'getRaw').mockImplementation(async () =>
      configResponse({ oauth: { 'excluded-models': structuredClone(current) } })
    );
    const put = spyOn(apiClient, 'put').mockImplementation(async (_path, value) => {
      current = structuredClone(value as Record<string, unknown>);
      return {};
    });
    mocks.push(get, put);
    await Promise.all([
      authFilesApi.saveOauthExcludedModels('claude', ['new']),
      authFilesApi.saveOauthExcludedModels('codex', ['other']),
    ]);
    expect(current).toEqual({ future: ['unchanged'], claude: ['new'], codex: ['other'] });
    expect(put.mock.calls.every(([path]) => path === '/config/oauth/excluded-models')).toBe(true);
    await authFilesApi.deleteOauthExcludedEntry('claude');
    expect(current).toEqual({ future: ['unchanged'], codex: ['other'] });
  });

  test('connection changes after an OAuth map read prevent the dependent write', async () => {
    apiClient.setConfig({ apiBase: 'https://original.test', managementKey: 'fixture' });
    const get = spyOn(apiClient, 'getRaw').mockImplementation(async () => {
      apiClient.setConfig({ apiBase: 'https://other.test', managementKey: 'fixture' });
      return configResponse({});
    });
    const put = spyOn(apiClient, 'put').mockResolvedValue({});
    mocks.push(get, put);
    await expect(authFilesApi.saveOauthExcludedModels('claude', ['new'])).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });

  test('plugin object edits replace values, delete cleared fields, and retain unrelated fields', async () => {
    const get = spyOn(apiClient, 'getRaw').mockResolvedValue(
      configResponse({
        plugins: {
          configs: {
            fixture: {
              enabled: true,
              untouched: 'keep',
              nested: { old: true },
              remove: 'old',
            },
          },
        },
      })
    );
    const put = spyOn(apiClient, 'put').mockResolvedValue({});
    mocks.push(get, put);
    await pluginsApi.patchConfig('fixture', { nested: { next: true }, remove: null });
    expect(put).toHaveBeenCalledWith(
      '/config/plugins/configs/fixture',
      {
        enabled: true,
        untouched: 'keep',
        nested: { next: true },
      },
      { headers: { 'If-Match': '"fixture"' } }
    );
  });
});

describe('v8 OAuth and absent optional capabilities', () => {
  test('Claude uses the shared OAuth route and retains cancellation signals', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue({ url: 'https://auth.test' });
    const del = spyOn(apiClient, 'delete').mockResolvedValue({ status: 'ok', cancelled: true });
    mocks.push(get, del);
    const signal = new AbortController().signal;
    await oauthApi.startAuth('anthropic', signal);
    expect(get).toHaveBeenCalledWith('/oauth/auth-url', {
      params: { provider: 'claude', is_webui: true },
      signal,
    });
    await oauthApi.cancelSession('fixture-state', signal);
    expect(del).toHaveBeenCalledWith('/oauth/session', {
      params: { state: 'fixture-state' },
      signal,
    });
  });

  test('an absent Plus usage snapshot is unsupported, not an empty or live snapshot', async () => {
    const get = spyOn(apiClient, 'get').mockRejectedValue({ status: 404 });
    mocks.push(get);
    expect(await usageApi.getUsage()).toEqual({ supported: false });
    expect(get.mock.calls.map(([path]) => path)).toEqual(['/usage']);
    get.mockResolvedValue(true);
    expect(await usageApi.getStatisticsEnabled()).toBe(true);
    expect(get.mock.calls.at(-1)?.[0]).toBe('/config/observability/usage/usage-statistics-enabled');
    get.mockRejectedValue({ status: 503 });
    await expect(usageApi.getUsage()).rejects.toMatchObject({ status: 503 });
  });

  test('the v0 probe is diagnostic only and preserves the server mount', async () => {
    const get = spyOn(axios, 'get').mockResolvedValue({ data: {} });
    mocks.push(get);
    expect(await probeLegacyBackend('https://proxy.test/mount/v8/management', 'fixture-only')).toBe(
      true
    );
    expect(get.mock.calls[0][0]).toBe('https://proxy.test/mount/v0/management/config');
    get.mockRejectedValue({ status: 401 });
    expect(await probeLegacyBackend('https://proxy.test', 'fixture-only')).toBe(false);
  });
});
