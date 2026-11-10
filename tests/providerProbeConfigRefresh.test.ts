import { afterEach, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useProviderWorkbench } from '@/features/providers/useProviderWorkbench';
import { resolveProbeProxyUrl } from '@/features/providers/sheets/forms/probeProxy';
import { providersApi } from '@/services/api';
import { configApi } from '@/services/api/config';
import { useConfigStore } from '@/stores/useConfigStore';
import type { Config, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';

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
  test(`provider refresh cannot restore partial config after invalidation, fresh first ${freshFirst}`, async () => {
    useConfigStore.getState().clearCache();
    const initial = deferred<Config>();
    const fresh = deferred<Config>();
    const vertex = deferred<ProviderKeyConfig[]>();
    const openai = deferred<OpenAIProviderConfig[]>();
    mocks.push(
      spyOn(configApi, 'getConfig')
        .mockReturnValueOnce(initial.promise)
        .mockReturnValueOnce(fresh.promise),
      spyOn(providersApi, 'getVertexConfigs').mockReturnValue(vertex.promise),
      spyOn(providersApi, 'getOpenAIProviders').mockReturnValue(openai.promise)
    );
    const refetch = captureWorkbench().refetch();
    initial.resolve({ proxyUrl: 'http://old-proxy.test', vertexApiKeys: [] });
    await initial.promise;
    await Promise.resolve();
    expect(useConfigStore.getState().config?.proxyUrl).toBe('http://old-proxy.test');

    useConfigStore.getState().clearCache();
    const refreshed = useConfigStore.getState().fetchConfig(true);
    const next: Config = {
      proxyUrl: 'http://current-proxy.test',
      vertexApiKeys: [],
      openaiCompatibility: [],
    };
    try {
      if (freshFirst) {
        fresh.resolve(next);
        await refreshed;
      }
      vertex.resolve([{ apiKey: 'fixture-old-key', baseUrl: 'https://old-provider.test' }]);
      openai.resolve([{ name: 'old-provider', baseUrl: 'https://old-provider.test' }]);
      await refetch;
      expect(useConfigStore.getState().config).toEqual(freshFirst ? next : null);
    } finally {
      fresh.resolve(next);
      await refreshed;
    }
    expect(resolveProbeProxyUrl('')).toBe('http://current-proxy.test');
    expect(resolveProbeProxyUrl('direct')).toBe('direct');
  });
}
