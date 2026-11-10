import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import type { AxiosAdapter } from 'axios';
import type { TFunction } from 'i18next';
import { apiClient, apiCallApi, authFilesApi } from '@/services/api';
import { useAuthStore } from '@/stores/useAuthStore';
import { CODEX_CONFIG } from '@/features/quota/providers/codex/data';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const mocks: Array<{ mockRestore(): void }> = [];
beforeEach(() => {
  const items = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
      clear: () => items.clear(),
    },
  });
  apiClient.setConfig({ apiBase: 'https://gateway.test', managementKey: 'fixture-only' });
});
afterEach(() => {
  for (const mock of mocks.splice(0)) mock.mockRestore();
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('logout removes transport credentials and invalidates the active connection', async () => {
  const revision = apiClient.getConnectionRevision();
  useAuthStore.getState().logout();
  expect(apiClient.getConnectionRevision()).toBeGreaterThan(revision);
  const adapter: AxiosAdapter = async (config) => {
    expect(config.headers.Authorization).toBeUndefined();
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  };
  await apiClient.get('/config', { adapter });
});

test('logout during redemption prevents a later cooldown write', async () => {
  const request = spyOn(apiCallApi, 'request').mockImplementation(async () => {
    useAuthStore.getState().logout();
    return { statusCode: 200, body: { code: 'reset' }, bodyText: '', header: {} };
  });
  const clear = spyOn(authFilesApi, 'resetCooldown').mockResolvedValue({
    status: 'ok',
    auth_index: 'fixture-index',
    models: [],
  });
  mocks.push(request, clear);
  await expect(
    CODEX_CONFIG.resetQuota!(
      { name: 'fixture.json', type: 'codex', auth_index: 'fixture-index' },
      ((key: string) => key) as TFunction
    )
  ).rejects.toThrow('codex_quota.reset_cooldown_failed');
  expect(clear).not.toHaveBeenCalled();
});
