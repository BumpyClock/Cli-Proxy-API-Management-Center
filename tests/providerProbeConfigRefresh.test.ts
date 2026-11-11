import { afterEach, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useProviderWorkbench } from '@/features/providers/useProviderWorkbench';
import { resolveProbeProxyUrl } from '@/features/providers/sheets/forms/probeProxy';
import { configApi } from '@/services/api/config';
import { useConfigStore } from '@/stores/useConfigStore';
import type { Config } from '@/types';

const mocks: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const mock of mocks.splice(0)) mock.mockRestore();
  useConfigStore.getState().clearCache();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function captureWorkbench() {
  let result!: ReturnType<typeof useProviderWorkbench>;
  function Harness() {
    result = useProviderWorkbench();
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return result;
}

for (const freshFirst of [false, true]) {
  test(`provider refresh cannot publish an invalidated snapshot, fresh first ${freshFirst}`, async () => {
    useConfigStore.getState().clearCache();
    const initial = deferred<Config>();
    const fresh = deferred<Config>();
    mocks.push(
      spyOn(configApi, 'getConfig')
        .mockReturnValueOnce(initial.promise)
        .mockReturnValueOnce(fresh.promise)
    );
    const refetch = captureWorkbench().refetch();
    useConfigStore.getState().clearCache();
    const refreshed = useConfigStore.getState().fetchConfig(true);
    const next: Config = {
      proxyUrl: 'http://current-proxy.test',
      vertexApiKeys: [{ apiKey: 'fixture-current-key', baseUrl: 'https://current-provider.test' }],
      openaiCompatibility: [
        { name: 'current-provider', baseUrl: 'https://current-provider.test', apiKeyEntries: [] },
      ],
    };
    try {
      if (freshFirst) {
        fresh.resolve(next);
        await refreshed;
      }
      initial.resolve({ proxyUrl: 'http://old-proxy.test', vertexApiKeys: [] });
      await refetch;
      expect(useConfigStore.getState().config).toEqual(freshFirst ? next : null);
    } finally {
      initial.resolve({ proxyUrl: 'http://old-proxy.test' });
      fresh.resolve(next);
      await Promise.all([refetch, refreshed]);
    }
    expect(useConfigStore.getState().config).toEqual(next);
    expect(resolveProbeProxyUrl('')).toBe('http://current-proxy.test');
    expect(resolveProbeProxyUrl('direct')).toBe('direct');
  });
}
