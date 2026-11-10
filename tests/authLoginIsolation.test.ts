import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import axios from 'axios';
import { resolve } from 'node:path';
import { apiClient } from '@/services/api/client';
import { configApi } from '@/services/api/config';
import { useAuthStore } from '@/stores/useAuthStore';
import { useConfigStore } from '@/stores/useConfigStore';
import type { Config } from '@/types';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const mocks: Array<{ mockRestore(): void }> = [];
const first = { apiBase: 'https://first.invalid', managementKey: 'fixture-first' };
const second = { apiBase: 'https://second.invalid', managementKey: 'fixture-second' };

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      location: new URL('https://management.invalid/management.html'),
    }),
  });
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
  useAuthStore.getState().logout();
});

afterEach(() => {
  for (const mock of mocks.splice(0)) mock.mockRestore();
  useAuthStore.getState().logout();
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

for (const fail of [false, true]) {
  test(`a superseded login cannot publish credentials, config or an error (failure=${fail})`, async () => {
    let release!: () => void;
    const blocked = new Promise<Config>((resolve, reject) => {
      release = () => (fail ? reject(new Error('fixture old failure')) : resolve({ debug: false }));
    });
    const fetch = spyOn(configApi, 'getConfig')
      .mockImplementationOnce(() => blocked)
      .mockResolvedValue({ debug: true });
    mocks.push(fetch);
    const oldLogin = useAuthStore.getState().login(first);
    const newLogin = useAuthStore.getState().login(second);
    const settled = Promise.allSettled([oldLogin, newLogin]);
    release();
    const results = await settled;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(results[0]).toMatchObject({ status: 'rejected', reason: { name: 'AbortError' } });
    expect(results[1].status).toBe('fulfilled');
    expect(useAuthStore.getState()).toMatchObject({
      ...second,
      isAuthenticated: true,
      connectionStatus: 'connected',
    });
    expect(useConfigStore.getState().config).toEqual({ debug: true });
  });
}

test('an old authentication check cannot mark a newer login disconnected', async () => {
  useAuthStore.setState({ ...first, isAuthenticated: true });
  let rejectOld!: (error: Error) => void;
  const blocked = new Promise<Config>((_resolve, reject) => {
    rejectOld = reject;
  });
  const fetch = spyOn(configApi, 'getConfig')
    .mockImplementationOnce(() => blocked)
    .mockResolvedValue({ debug: true });
  mocks.push(fetch);
  const check = useAuthStore.getState().checkAuth();
  const login = useAuthStore.getState().login(second);
  const settled = Promise.allSettled([check, login]);
  rejectOld(new Error('fixture stale check'));
  const results = await settled;
  expect(results[0]).toMatchObject({ status: 'fulfilled', value: false });
  expect(results[1].status).toBe('fulfilled');
  expect(useAuthStore.getState()).toMatchObject({ ...second, connectionStatus: 'connected' });
});

test('a delayed legacy probe belongs only to the login that started it', async () => {
  let entered!: () => void;
  let release!: () => void;
  const probing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<{ data: object }>((resolve) => {
    release = () => resolve({ data: {} });
  });
  const probe = spyOn(axios, 'get').mockImplementationOnce(() => {
    entered();
    return blocked;
  });
  const fetch = spyOn(configApi, 'getConfig')
    .mockRejectedValueOnce({ status: 404 })
    .mockResolvedValue({});
  mocks.push(probe, fetch);
  const oldLogin = useAuthStore.getState().login(first);
  await probing;
  await useAuthStore.getState().login(second);
  release();
  await expect(oldLogin).rejects.toMatchObject({ name: 'AbortError' });
  expect(useAuthStore.getState()).toMatchObject({ ...second, connectionStatus: 'connected' });
  expect(apiClient.getConnectionRevision()).toBeGreaterThan(0);
});

test('real 401 events preserve login failures and invalidate authenticated sessions', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, 'fixtures/authLogin401.ts')],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(stderr).toBe('');
  expect(code).toBe(0);
  expect(stdout).toContain('PASS wrong-key login');
  expect(stdout).toContain('PASS authenticated-session 401');
});
