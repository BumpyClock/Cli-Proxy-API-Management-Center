import { afterEach, describe, expect, test } from 'bun:test';
import { configResponse } from './fixtures/managementV8';
import { apiClient } from '../src/services/api/client';
import { providersApi } from '../src/services/api/providers';
import { normalizeConfigResponse } from '../src/services/api/transformers';

const originalGetRaw = apiClient.getRaw;
const originalPut = apiClient.put;

afterEach(() => {
  apiClient.getRaw = originalGetRaw;
  apiClient.put = originalPut;
});

describe('provider model thinking config', () => {
  test('serializes thinking overrides for Vertex models', async () => {
    let putData: unknown;
    apiClient.getRaw = async () => configResponse({ 'api-keys': { vertex: [] } });
    apiClient.put = (async (_url: string, data?: unknown) => {
      putData = data;
      return undefined;
    }) as typeof apiClient.put;

    await providersApi.writeFamily({
      family: 'vertex',
      type: 'create',
      config: {
        apiKey: 'vertex-key',
        models: [
          {
            name: 'gemini-3-pro',
            alias: 'vertex-pro',
            thinking: {
              min: 128,
              max: 32768,
              zero_allowed: true,
              dynamic_allowed: true,
            },
          },
        ],
      },
    });

    expect(putData).toEqual([
      {
        name: 'vertex-1',
        keys: [
          {
            'api-key': 'vertex-key',
            models: [
              {
                name: 'gemini-3-pro',
                alias: 'vertex-pro',
                thinking: {
                  min: 128,
                  max: 32768,
                  'zero-allowed': true,
                  'dynamic-allowed': true,
                },
              },
            ],
          },
        ],
      },
    ]);
  });

  test('can clear thinking while preserving unknown model fields', async () => {
    let putData: unknown;
    apiClient.getRaw = async () =>
      configResponse({
        'api-keys': {
          codex: [
            {
              name: 'codex-1',
              'base-url': 'https://example.com',
              keys: [
                {
                  'api-key': 'codex-key',
                  models: [
                    {
                      name: 'gpt-5-codex',
                      alias: 'codex-latest',
                      thinking: { levels: ['low', 'high'] },
                      'future-field': 'preserved',
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
    apiClient.put = (async (_url: string, data?: unknown) => {
      putData = data;
      return undefined;
    }) as typeof apiClient.put;

    const current = normalizeConfigResponse((await apiClient.getRaw('/config')).data)
      .codexApiKeys![0];
    await providersApi.writeFamily({
      family: 'codex',
      type: 'update',
      config: {
        ...current,
        models: [{ ...current.models![0], thinking: undefined }],
      },
    });

    expect(putData).toEqual([
      {
        name: 'codex-1',
        'base-url': 'https://example.com',
        keys: [
          {
            'api-key': 'codex-key',
            models: [
              {
                'future-field': 'preserved',
                name: 'gpt-5-codex',
                alias: 'codex-latest',
              },
            ],
          },
        ],
      },
    ]);
  });
});
