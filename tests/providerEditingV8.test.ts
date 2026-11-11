import { afterEach, describe, expect, test } from 'bun:test';
import { configResponse } from './fixtures/managementV8';
import { apiClient } from '@/services/api/client';
import { providersApi, type ProviderFamily } from '@/services/api/providers';
import { normalizeProviderGroups } from '@/services/api/transformers';
import type { OpenAIProviderConfig, ProviderKeyConfig } from '@/types';

const originalGetRaw = apiClient.getRaw;
const originalPut = apiClient.put;
afterEach(() => {
  apiClient.getRaw = originalGetRaw;
  apiClient.put = originalPut;
});

function backend(family: ProviderFamily, group: Record<string, unknown>) {
  let stored = structuredClone(group);
  const writes: unknown[] = [];
  apiClient.getRaw = async () =>
    configResponse({
      routing: { cooldown: { 'disable-cooling': true } },
      'api-keys': { [family]: [structuredClone(stored)] },
    });
  apiClient.put = (async (path: string, value: unknown) => {
    expect(path).toBe(`/config/api-keys/${family}`);
    writes.push(value);
    stored = structuredClone((value as Record<string, unknown>[])[0]);
  }) as typeof apiClient.put;
  return { group: () => stored, writes };
}
const row = (group: Record<string, unknown>) =>
  (normalizeProviderGroups([group]) as ProviderKeyConfig[])[0];
const key = (group: Record<string, unknown>) => (group.keys as Record<string, unknown>[])[0];
const openai = (group: Record<string, unknown>) =>
  (normalizeProviderGroups([group], true) as OpenAIProviderConfig[])[0];

const keyApis = [
  ['gemini', providersApi.updateGeminiKey],
  ['interactions', providersApi.updateInteractionsKey],
  ['codex', providersApi.updateCodexConfig],
  ['meta', providersApi.updateMetaConfig],
  ['xai', providersApi.updateXAIConfig],
  ['claude', providersApi.updateClaudeConfig],
] as const;

describe('v8 weight clearing', () => {
  for (const [family, update] of keyApis) {
    test.each([undefined, null, 4])(
      `${family} clearing weight %s restores default routing weight without changing group policy`,
      async (weight) => {
        const original = {
          'api-key': 'fixture-key',
          priority: 3,
          ...(weight === undefined ? {} : { weight }),
        };
        const sibling = { 'api-key': 'fixture-sibling', weight: 2 };
        const group = {
          name: 'fixture',
          weight: 9,
          priority: 7,
          future: 'keep',
          keys: [original, sibling],
        };
        const b = backend(family, group);
        const config = row(b.group());
        await update(config.apiKey, config.baseUrl, {
          ...config,
          weight: undefined,
          priority: undefined,
        });
        expect(b.group()).toEqual({
          ...group,
          keys: [{ ...original, weight: 1, priority: 0 }, sibling],
        });
      }
    );

    test(`${family} retains explicit zero as an exclusion override`, async () => {
      const group = { name: 'fixture', weight: 9, keys: [{ 'api-key': 'fixture-key', weight: 4 }] };
      const b = backend(family, group);
      const config = row(b.group());
      await update(config.apiKey, config.baseUrl, { ...config, weight: 0 });
      expect(b.group()).toEqual({ ...group, keys: [{ 'api-key': 'fixture-key', weight: 0 }] });
    });
  }

  test('clearing a local weight without group inheritance removes the override', async () => {
    const b = backend('codex', {
      name: 'fixture',
      keys: [{ 'api-key': 'fixture-key', weight: 4 }],
    });
    const config = row(b.group());
    await providersApi.updateCodexConfig(config.apiKey, config.baseUrl, {
      ...config,
      weight: undefined,
    });
    expect(key(b.group())).toEqual({ 'api-key': 'fixture-key' });
  });
});

describe('v8 cooling overrides', () => {
  for (const [family, update] of keyApis) {
    test(`${family} persists explicit false instead of inheriting disabled global cooling`, async () => {
      const b = backend(family, {
        name: 'fixture',
        keys: [{ 'api-key': 'fixture-key', 'disable-cooling': true }],
      });
      const config = row(b.group());
      await update(config.apiKey, config.baseUrl, { ...config, disableCooling: false });
      expect(key(b.group())['disable-cooling']).toBe(false);
      const current = row(b.group());
      await update(current.apiKey, current.baseUrl, { ...current, weight: 7 });
      expect(key(b.group())).toEqual({
        'api-key': 'fixture-key',
        'disable-cooling': false,
        weight: 7,
      });
    });

    test.each([undefined, null])(
      `${family} preserves absent/null inheritance (%s)`,
      async (value) => {
        const rawKey = {
          'api-key': 'fixture-key',
          ...(value === undefined ? {} : { 'disable-cooling': value }),
        };
        const b = backend(family, { name: 'fixture', keys: [rawKey] });
        const config = row(b.group());
        await update(config.apiKey, config.baseUrl, { ...config, weight: 7 });
        expect(key(b.group())).toEqual({ ...rawKey, weight: 7 });
      }
    );
  }

  test('OpenAI group false overrides the global setting and survives unrelated edits', async () => {
    const b = backend('openai-compatibility', {
      name: 'fixture',
      'base-url': 'https://example.invalid',
      'disable-cooling': true,
      keys: [{ 'api-key': 'fixture-key' }],
    });
    const config = openai(b.group());
    await providersApi.updateOpenAIProvider(config.name, { ...config, disableCooling: false });
    expect(b.group()['disable-cooling']).toBe(false);
    const current = openai(b.group());
    await providersApi.updateOpenAIProvider(current.name, { ...current, priority: 3 });
    expect(b.group()['disable-cooling']).toBe(false);
  });

  test('explicit false can override global cooling even without a previous per-key value', async () => {
    const b = backend('codex', { name: 'fixture', keys: [{ 'api-key': 'fixture-key' }] });
    const config = row(b.group());
    await providersApi.updateCodexConfig(config.apiKey, undefined, {
      ...config,
      disableCooling: false,
    });
    expect(key(b.group())['disable-cooling']).toBe(false);
  });
});

describe('v8 credential row identity', () => {
  test.each([false, true])(
    'same-looking credential replacement preserves hidden metadata only with retained identity (%s)',
    async (retained) => {
      const original = { 'api-key': 'fixture-key', 'connection-pool': { enabled: true } };
      const group = { name: 'fixture', 'base-url': 'https://example.invalid', keys: [original] };
      const b = backend('openai-compatibility', group);
      const config = openai(b.group());
      await providersApi.updateOpenAIProvider(config.name, {
        ...config,
        apiKeyEntries: retained ? config.apiKeyEntries : [{ apiKey: 'fixture-key' }],
      });
      expect(b.group()).toEqual({
        ...group,
        keys: retained ? [original] : [{ 'api-key': 'fixture-key' }],
      });
      expect(JSON.stringify(b.writes)).not.toContain('sourceIndex');
    }
  );

  test('identical visible credentials retain their own hidden metadata when reordered', async () => {
    const first = { 'api-key': 'fixture-key', 'connection-pool': { enabled: true } };
    const second = { 'api-key': 'fixture-key', 'connection-pool': { enabled: false } };
    const b = backend('openai-compatibility', {
      name: 'fixture',
      'base-url': 'https://example.invalid',
      keys: [first, second],
    });
    const config = openai(b.group());
    await providersApi.updateOpenAIProvider(config.name, {
      ...config,
      apiKeyEntries: config.apiKeyEntries.toReversed(),
    });
    expect(b.group().keys).toEqual([second, first]);
  });

  test('repeated identity cannot bypass validation when serialized credentials are unchanged', async () => {
    const credential = { 'api-key': 'fixture-key' };
    const b = backend('openai-compatibility', {
      name: 'fixture',
      'base-url': 'https://example.invalid',
      keys: [credential, credential],
    });
    const config = openai(b.group());
    await expect(
      providersApi.updateOpenAIProvider(config.name, {
        ...config,
        apiKeyEntries: [config.apiKeyEntries[0], config.apiKeyEntries[0]],
      })
    ).rejects.toThrow();
    expect(b.writes).toHaveLength(0);
  });
});

describe('v8 model row identity', () => {
  const originalModel = {
    name: 'old',
    alias: 'public',
    'display-name': 'Keep me',
    'max-context-length': 1234,
    'force-mapping': true,
    'is-compat': true,
    'support-configuration-update': false,
    thinking: { levels: ['high'] },
  };

  test.each([false, true])(
    'rename preserves metadata on key/inherited models (%s)',
    async (inherited) => {
      const group = {
        name: 'fixture',
        ...(inherited ? { models: [originalModel] } : {}),
        keys: [{ 'api-key': 'fixture-key', models: inherited ? null : [originalModel] }],
      };
      const b = backend('codex', group);
      const config = row(b.group());
      await providersApi.updateCodexConfig(config.apiKey, undefined, {
        ...config,
        models: [{ ...config.models![0], name: 'new', alias: 'renamed', thinking: undefined }],
      });
      const metadata: Record<string, unknown> = { ...originalModel };
      delete metadata.thinking;
      expect(key(b.group()).models).toEqual([{ ...metadata, name: 'new', alias: 'renamed' }]);
      if (inherited) expect(b.group().models).toEqual([originalModel]);
      expect(JSON.stringify(b.writes)).not.toContain('sourceIndex');
    }
  );

  test('same-name aliases keep their own metadata through reorder, rename and deletion', async () => {
    const a = { name: 'shared', alias: 'a', 'display-name': 'A', 'is-compat': true };
    const bModel = { name: 'shared', alias: 'b', 'display-name': 'B', 'max-context-length': 42 };
    const b = backend('codex', {
      name: 'fixture',
      keys: [{ 'api-key': 'fixture-key', models: [a, bModel] }],
    });
    const config = row(b.group());
    await providersApi.updateCodexConfig(config.apiKey, undefined, {
      ...config,
      models: [{ ...config.models![1], name: 'renamed' }, config.models![0]],
    });
    expect(key(b.group()).models).toEqual([{ ...bModel, name: 'renamed' }, a]);
    const current = row(b.group());
    await providersApi.updateCodexConfig(current.apiKey, undefined, {
      ...current,
      models: [current.models![0]],
    });
    expect(key(b.group()).models).toEqual([{ ...bModel, name: 'renamed' }]);
  });

  test('OpenAI model rename retains raw metadata and new models do not inherit it', async () => {
    const b = backend('openai-compatibility', {
      name: 'fixture',
      'base-url': 'https://example.invalid',
      models: [originalModel],
      keys: [{ 'api-key': 'fixture-key' }],
    });
    const config = openai(b.group());
    await providersApi.updateOpenAIProvider(config.name, {
      ...config,
      models: [
        { name: 'fresh', alias: 'fresh' },
        { ...config.models![0], name: 'new' },
      ],
    });
    expect(b.group().models).toEqual([
      { name: 'fresh', alias: 'fresh' },
      { ...originalModel, name: 'new' },
    ]);
    expect(JSON.stringify(b.writes)).not.toContain('sourceIndex');
  });

  test('replacing a removed row with a new identical-looking model does not inherit metadata', async () => {
    const b = backend('codex', {
      name: 'fixture',
      keys: [{ 'api-key': 'fixture-key', models: [originalModel] }],
    });
    const config = row(b.group());
    await providersApi.updateCodexConfig(config.apiKey, undefined, {
      ...config,
      // A new form row contains only the fields the user enters, not a clone of
      // the deleted row's now-editable advanced properties.
      models: [
        {
          name: originalModel.name,
          alias: originalModel.alias,
          thinking: originalModel.thinking,
          sourceIndex: null,
        },
      ],
    });
    expect(key(b.group()).models).toEqual([
      {
        name: originalModel.name,
        alias: originalModel.alias,
        thinking: originalModel.thinking,
      },
    ]);
  });

  test('identical visible models retain their metadata when reordered', async () => {
    const a = { name: 'shared', alias: 'shared', 'display-name': 'A' };
    const bModel = { name: 'shared', alias: 'shared', 'display-name': 'B' };
    const b = backend('codex', {
      name: 'fixture',
      keys: [{ 'api-key': 'fixture-key', models: [a, bModel] }],
    });
    const config = row(b.group());
    await providersApi.updateCodexConfig(config.apiKey, undefined, {
      ...config,
      models: [config.models![1], config.models![0]],
    });
    expect(key(b.group()).models).toEqual([bModel, a]);
  });

  test('duplicate model identities reject the save', async () => {
    const b = backend('codex', {
      name: 'fixture',
      keys: [{ 'api-key': 'fixture-key', models: [originalModel] }],
    });
    const config = row(b.group());
    await expect(
      providersApi.updateCodexConfig(config.apiKey, undefined, {
        ...config,
        models: [config.models![0], { ...config.models![0], name: 'other' }],
      })
    ).rejects.toThrow();
    expect(b.writes).toHaveLength(0);
  });

  test.each([-1, 99])('invalid model identity %s rejects the save', async (sourceIndex) => {
    const b = backend('codex', {
      name: 'fixture',
      keys: [{ 'api-key': 'fixture-key', models: [originalModel] }],
    });
    const config = row(b.group());
    await expect(
      providersApi.updateCodexConfig(config.apiKey, undefined, {
        ...config,
        models: [{ ...config.models![0], sourceIndex, name: 'new' }],
      })
    ).rejects.toThrow();
    expect(b.writes).toHaveLength(0);
  });

  test('Vertex same-name alias survives thinking edits and adding other models', async () => {
    const model = { name: 'm', alias: 'm', thinking: { levels: ['high'] } };
    const b = backend('vertex', {
      name: 'fixture',
      keys: [{ 'api-key': 'fixture-key', models: [model] }],
    });
    const config = row(b.group());
    expect(config.models![0].alias).toBe('m');
    await providersApi.updateVertexConfig(config.apiKey, undefined, {
      ...config,
      models: [{ ...config.models![0], thinking: { levels: ['low'] } }],
    });
    const changed = { ...model, thinking: { levels: ['low'] } };
    expect(key(b.group()).models).toEqual([changed]);
    const current = row(b.group());
    await providersApi.updateVertexConfig(current.apiKey, undefined, {
      ...current,
      models: [...current.models!, { name: 'new', alias: 'other' }],
    });
    expect(key(b.group()).models).toEqual([changed, { name: 'new', alias: 'other' }]);
    expect(JSON.stringify(b.writes)).not.toContain('sourceIndex');
  });
});
