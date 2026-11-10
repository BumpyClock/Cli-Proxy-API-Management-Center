import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { apiClient } from '@/services/api/client';
import { apiCallApi, type ApiCallRequest } from '@/services/api/apiCall';
import { modelsApi } from '@/services/api/models';
import {
  useConnectivityTest,
  type UseConnectivityTestArgs,
} from '@/features/providers/sheets/forms/useConnectivityTest';
import { useModelDiscovery } from '@/features/providers/sheets/forms/useModelDiscovery';

const mocks: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const mock of mocks.splice(0)) mock.mockRestore();
});
const response = { status_code: 200, body: { data: [{ id: 'test-model' }] } };
const success = { statusCode: 200, header: {}, bodyText: '', body: { data: [] } };
const messages = {
  baseUrlRequired: 'base required',
  endpointInvalid: 'invalid endpoint',
  apiKeyRequired: 'key required',
  modelRequired: 'model required',
  timeout: () => 'timeout',
  requestFailed: 'failed',
};
const args: UseConnectivityTestArgs = {
  brand: 'codex',
  baseUrl: 'https://upstream.test/v1',
  apiKey: 'fixture-key',
  proxyUrl: ' socks5://proxy.test:1080 ',
  models: [{ name: 'fixture-model', alias: '' }],
  formHeaders: [],
};
function captureHook<T>(hook: () => T): T {
  let result: T;
  function Harness() {
    result = hook();
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return result!;
}

describe('model discovery explicit proxy', () => {
  for (const method of [
    'fetchV1ModelsViaApiCall',
    'fetchModelsViaApiCall',
    'fetchClaudeModelsViaApiCall',
    'fetchGeminiModelsViaApiCall',
  ] as const) {
    test.each([' socks5://proxy.test:1080 ', ' direct ', '  ', undefined])(
      `${method} forwards normalized proxy %s`,
      async (proxy) => {
        const post = spyOn(apiClient, 'post').mockResolvedValue(response);
        mocks.push(post);
        const models = await modelsApi[method](
          'https://upstream.test',
          undefined,
          {},
          ' auth ',
          proxy
        );
        expect(models.map((model) => model.name)).toEqual(['test-model']);
        expect(post.mock.calls[0][1]).toMatchObject({
          authIndex: 'auth',
          proxy_url: proxy?.trim() || undefined,
          method: 'GET',
        });
      }
    );
  }

  test('preserves proxy across Gemini pagination', async () => {
    const post = spyOn(apiClient, 'post')
      .mockResolvedValueOnce({
        status_code: 200,
        body: { models: [{ name: 'models/first' }], nextPageToken: 'next' },
      })
      .mockResolvedValueOnce({ status_code: 200, body: { models: [{ name: 'models/second' }] } });
    mocks.push(post);
    const models = await modelsApi.fetchGeminiModelsViaApiCall(
      'https://upstream.test',
      undefined,
      {},
      'auth',
      ' direct '
    );
    expect(models.map((model) => model.name)).toEqual(['first', 'second']);
    expect(post.mock.calls.map((call) => (call[1] as ApiCallRequest).proxy_url)).toEqual([
      'direct',
      'direct',
    ]);
  });

  for (const method of ['fetchClaudeModelsViaApiCall', 'fetchGeminiModelsViaApiCall'] as const) {
    test(`${method} isolates different proxies and shares equivalent requests`, async () => {
      let release!: (value: typeof response) => void;
      const pending = new Promise<typeof response>((resolve) => {
        release = resolve;
      });
      const post = spyOn(apiClient, 'post').mockReturnValue(pending);
      mocks.push(post);
      const requests = [
        modelsApi[method]('https://upstream.test', 'fixture', {}, 'auth', ' http://a.test '),
        modelsApi[method]('https://upstream.test', 'fixture', {}, 'auth', 'http://b.test'),
        modelsApi[method]('https://upstream.test', 'fixture', {}, 'auth', 'http://a.test'),
      ];
      try {
        expect(post).toHaveBeenCalledTimes(2);
      } finally {
        release(response);
        await Promise.all(requests);
      }
      await modelsApi[method]('https://upstream.test', 'fixture', {}, 'auth', 'http://a.test');
      expect(post).toHaveBeenCalledTimes(3);
    });
  }
});

describe('provider probes use editable proxy settings', () => {
  test.each(['codex', 'meta', 'xai', 'gemini', 'interactions', 'claude'] as const)(
    '%s connection test forwards the form proxy',
    async (brand) => {
      const request = spyOn(apiCallApi, 'request').mockResolvedValue(success);
      mocks.push(request);
      const hook = captureHook(() => useConnectivityTest({ ...args, brand }, messages));
      if (brand === 'claude') await hook.runClaude();
      else if (brand === 'gemini' || brand === 'interactions') await hook.runGemini();
      else await hook.runCodex();
      expect(request.mock.calls[0][0].proxy_url).toBe('socks5://proxy.test:1080');
    }
  );

  test('OpenAI batch tests retain each key proxy, including direct and blank', async () => {
    const request = spyOn(apiCallApi, 'request').mockResolvedValue(success);
    mocks.push(request);
    const hook = captureHook(() =>
      useConnectivityTest(
        {
          ...args,
          brand: 'openaiCompatibility',
          apiKeyEntries: [' http://one.test:8080 ', 'direct', ''].map((proxyUrl) => ({
            apiKey: 'fixture',
            proxyUrl,
          })),
        },
        messages
      )
    );
    await hook.runOpenAIAllKeys();
    expect(request.mock.calls.map(([payload]) => payload.proxy_url)).toEqual([
      'http://one.test:8080',
      'direct',
      undefined,
    ]);
  });

  test.each(['codex', 'meta', 'xai', 'gemini', 'interactions', 'claude'] as const)(
    '%s discovery forwards the form proxy',
    async (brand) => {
      const request = spyOn(apiCallApi, 'request').mockResolvedValue(success);
      mocks.push(request);
      await captureHook(() => useModelDiscovery({ ...args, brand })).fetch();
      expect(request.mock.calls[0][0].proxy_url).toBe('socks5://proxy.test:1080');
    }
  );

  test('unauthenticated OpenAI discovery retry retains the selected key proxy', async () => {
    const requests: ApiCallRequest[] = [];
    const request = spyOn(apiCallApi, 'request').mockImplementation(async (payload) => {
      requests.push(payload);
      return requests.length === 1 ? { ...success, statusCode: 401 } : success;
    });
    mocks.push(request);
    await captureHook(() =>
      useModelDiscovery({
        ...args,
        brand: 'openaiCompatibility',
        apiKeyEntries: [{ apiKey: 'fixture', proxyUrl: ' direct ' }],
      })
    ).fetch();
    expect(requests.map((payload) => payload.proxy_url)).toEqual(['direct', 'direct']);
    expect(requests[1].header).toBeUndefined();
    expect(requests[1].authIndex).toBeUndefined();
  });
});
