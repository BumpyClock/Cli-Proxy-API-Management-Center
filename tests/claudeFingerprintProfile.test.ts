import { afterEach, describe, expect, test } from 'bun:test';
import { claudeToResource } from '../src/features/providers/adapters';
import { apiClient } from '../src/services/api/client';
import { providersApi } from '../src/services/api/providers';
import { normalizeConfigResponse } from '../src/services/api/transformers';
import { configResponse } from './fixtures/managementV8';

const originalGetRaw = apiClient.getRaw;
const originalPut = apiClient.put;
const callerOwnedConfig = {
  apiKey: 'fixture-claude-key',
  baseUrl: 'https://api.anthropic.com',
};

afterEach(() => {
  apiClient.getRaw = originalGetRaw;
  apiClient.put = originalPut;
});

describe('Claude fingerprint profile', () => {
  test('normalizes the v8 key field and exposes the CLI profile resource flag', () => {
    const config = normalizeConfigResponse({
      'api-keys': {
        claude: [
          {
            name: 'fixture',
            'base-url': callerOwnedConfig.baseUrl,
            keys: [
              { 'api-key': callerOwnedConfig.apiKey, 'fingerprint-profile': 'claude-code-cli' },
            ],
          },
        ],
      },
    });
    expect(config.claudeApiKeys).toHaveLength(1);
    expect(config.claudeApiKeys![0]).toMatchObject({
      ...callerOwnedConfig,
      fingerprintProfile: 'claude-code-cli',
    });
    expect(claudeToResource(config.claudeApiKeys![0], 0).flags.claudeCodeCliProfile).toBe(true);
  });

  test('serializes the opt-in profile inside a new v8 Claude group', async () => {
    const calls: Array<{ url: string; data?: unknown }> = [];
    apiClient.getRaw = async () => configResponse({ 'api-keys': { claude: [] } });
    apiClient.put = (async (url: string, data?: unknown) => {
      calls.push({ url, data });
    }) as typeof apiClient.put;
    await providersApi.createClaudeConfig({
      ...callerOwnedConfig,
      fingerprintProfile: 'claude-code-cli',
    });
    expect(calls).toEqual([
      {
        url: '/config/api-keys/claude',
        data: [
          {
            name: 'claude-1',
            'base-url': callerOwnedConfig.baseUrl,
            keys: [
              { 'api-key': callerOwnedConfig.apiKey, 'fingerprint-profile': 'claude-code-cli' },
            ],
          },
        ],
      },
    ]);
  });

  test('clears only the profile while preserving independently configured CCH and unknown fields', async () => {
    const calls: Array<{ url: string; data?: unknown }> = [];
    apiClient.getRaw = async () =>
      configResponse({
        'api-keys': {
          claude: [
            {
              name: 'fixture',
              'base-url': callerOwnedConfig.baseUrl,
              keys: [
                {
                  'api-key': callerOwnedConfig.apiKey,
                  'fingerprint-profile': 'claude-code-cli',
                  'experimental-cch-signing': true,
                  'future-field': 'preserved',
                },
              ],
            },
          ],
        },
      });
    apiClient.put = (async (url: string, data?: unknown) => {
      calls.push({ url, data });
    }) as typeof apiClient.put;
    await providersApi.updateClaudeConfig(
      callerOwnedConfig.apiKey,
      callerOwnedConfig.baseUrl,
      callerOwnedConfig
    );
    expect(calls).toEqual([
      {
        url: '/config/api-keys/claude',
        data: [
          {
            name: 'fixture',
            'base-url': callerOwnedConfig.baseUrl,
            keys: [
              {
                'api-key': callerOwnedConfig.apiKey,
                'experimental-cch-signing': true,
                'future-field': 'preserved',
              },
            ],
          },
        ],
      },
    ]);
  });
});
