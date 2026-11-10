import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AxiosError, type AxiosAdapter, type AxiosResponse } from 'axios';
import { apiClient } from '@/services/api/client';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const events: string[] = [];

beforeEach(() => {
  events.length = 0;
  const target = new EventTarget();
  for (const name of ['unauthorized', 'server-version-update', 'server-plugin-support-update']) {
    target.addEventListener(name, () => events.push(name));
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  apiClient.setConfig({ apiBase: 'https://first.invalid', managementKey: 'fixture-first' });
});

afterEach(() => {
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

describe('management transport connection isolation', () => {
  test('a queued write cannot acquire the next connection credentials', async () => {
    let requests = 0;
    const adapter: AxiosAdapter = async (config) => {
      requests += 1;
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };
    const pending = apiClient.put('/config/access/api-keys', ['fixture-client'], { adapter });
    apiClient.setConfig({ apiBase: 'https://second.invalid', managementKey: 'fixture-second' });
    await expect(pending).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(requests).toBe(0);
  });

  test.each([200, 401])(
    'old %s responses cannot update or log out the next session',
    async (status) => {
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const adapter: AxiosAdapter = async (config) => {
        expect(config.baseURL).toBe('https://first.invalid/v8/management');
        expect(config.headers.Authorization).toBe('Bearer fixture-first');
        enter();
        await blocked;
        const response: AxiosResponse = {
          data: { source: 'old' },
          status,
          statusText: String(status),
          config,
          headers: { 'x-cpa-version': 'old', 'x-cpa-support-plugin': 'true' },
        };
        if (status === 401)
          throw new AxiosError('unauthorized', 'ERR_BAD_REQUEST', config, undefined, response);
        return response;
      };
      const pending = apiClient.get('/config', { adapter });
      await entered;
      apiClient.setConfig({ apiBase: 'https://second.invalid', managementKey: 'fixture-second' });
      release();
      await expect(pending).rejects.toMatchObject({ code: 'ERR_CANCELED' });
      expect(events).toEqual([]);
    }
  );

  test('an ABA connection switch invalidates a queued request', async () => {
    let requests = 0;
    const adapter: AxiosAdapter = async (config) => {
      requests += 1;
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };
    const pending = apiClient.get('/config', { adapter });
    apiClient.setConfig({ apiBase: 'https://second.invalid', managementKey: 'fixture-second' });
    apiClient.setConfig({ apiBase: 'https://first.invalid', managementKey: 'fixture-first' });
    await expect(pending).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(requests).toBe(0);
  });
});
