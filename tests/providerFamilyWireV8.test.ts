import { afterEach, describe, expect, test } from 'bun:test';
import { configResponse } from './fixtures/managementV8';
import { apiClient } from '../src/services/api/client';
import { providersApi, type ProviderFamily } from '../src/services/api/providers';
import { normalizeConfigResponse, normalizeProviderGroups } from '../src/services/api/transformers';
import {
  buildOpenAIConfig,
  buildProviderGroups,
  buildProviderKeyConfig,
} from '../src/features/providers/useProviderWorkbench';
import type { ProviderEntryFormInput } from '../src/features/providers/types';
import type { OpenAIProviderConfig, ProviderKeyConfig } from '../src/types';

const originalGetRaw = apiClient.getRaw;
const originalPut = apiClient.put;
afterEach(() => {
  apiClient.getRaw = originalGetRaw;
  apiClient.put = originalPut;
});

type Wire = Record<string, unknown>;

/** A backend that serves one family from GET /config and replaces it on PUT. */
function backend(family: ProviderFamily, groups: Wire[] = [], extra: Wire = {}) {
  let state = structuredClone(groups);
  const writes: Array<{ url: string; data: Wire[] }> = [];
  apiClient.getRaw = async (url) => {
    expect(url).toBe('/config');
    return configResponse({ ...extra, 'api-keys': { [family]: structuredClone(state) } });
  };
  apiClient.put = (async (url: string, data: unknown) => {
    expect(url).toBe(`/config/api-keys/${family}`);
    writes.push({ url, data: structuredClone(data) as Wire[] });
    state = structuredClone(data as Wire[]);
  }) as typeof apiClient.put;
  return { groups: () => state, writes };
}

const rows = (groups: unknown) => normalizeProviderGroups(groups) as ProviderKeyConfig[];
const openaiRows = (groups: unknown) =>
  normalizeProviderGroups(groups, true) as OpenAIProviderConfig[];

const formInput = (overrides: Partial<ProviderEntryFormInput> = {}): ProviderEntryFormInput => ({
  apiKey: '',
  name: '',
  baseUrl: '',
  proxyUrl: '',
  prefix: '',
  disabled: false,
  disableCooling: false,
  models: [],
  headers: [],
  excludedModelsText: '',
  ...overrides,
});

describe('per-family create, update and delete use the v8 group wire shape', () => {
  const cases = [
    {
      family: 'interactions' as const,
      create: providersApi.createInteractionsKey,
      update: providersApi.updateInteractionsKey,
      remove: providersApi.deleteInteractionsKey,
      config: {
        apiKey: 'interactions-new',
        priority: 4,
        weight: 2,
        prefix: 'native',
        baseUrl: 'https://generativelanguage.googleapis.com',
        proxyUrl: 'direct',
        headers: { 'X-Custom': 'value' },
        models: [
          {
            name: 'gemini-3.1-flash-lite',
            alias: 'native-flash',
            thinking: { min: 128, max: 8192, dynamic_allowed: true },
          },
        ],
        excludedModels: ['gemini-2.5-*'],
        disableCooling: true,
      },
      key: {
        'api-key': 'interactions-new',
        priority: 4,
        weight: 2,
        prefix: 'native',
        'proxy-url': 'direct',
        headers: { 'X-Custom': 'value' },
        models: [
          {
            name: 'gemini-3.1-flash-lite',
            alias: 'native-flash',
            thinking: { min: 128, max: 8192, 'dynamic-allowed': true },
          },
        ],
        'excluded-models': ['gemini-2.5-*'],
        'disable-cooling': true,
      },
    },
    {
      family: 'meta' as const,
      create: providersApi.createMetaConfig,
      update: providersApi.updateMetaConfig,
      remove: providersApi.deleteMetaConfig,
      config: {
        apiKey: 'meta-new',
        weight: 4,
        prefix: 'muse',
        baseUrl: 'https://api.meta.ai/v1',
        proxyUrl: 'direct',
        models: [{ name: 'muse-spark-1.3', alias: 'muse-latest' }],
        excludedModels: ['muse-spark-1.1'],
        disableCooling: true,
      },
      key: {
        'api-key': 'meta-new',
        weight: 4,
        prefix: 'muse',
        'proxy-url': 'direct',
        'disable-cooling': true,
        models: [{ name: 'muse-spark-1.3', alias: 'muse-latest' }],
        'excluded-models': ['muse-spark-1.1'],
      },
    },
    {
      family: 'xai' as const,
      create: providersApi.createXAIConfig,
      update: providersApi.updateXAIConfig,
      remove: providersApi.deleteXAIConfig,
      config: {
        apiKey: 'xai-new',
        priority: 3,
        prefix: 'xai',
        baseUrl: 'https://api.x.ai/v1',
        websockets: true,
        proxyUrl: 'direct',
        headers: { 'X-Custom': 'value' },
        models: [
          {
            name: 'grok-4.5',
            alias: 'grok-latest',
            thinking: { levels: ['low', 'high', 'xhigh'] },
          },
        ],
        excludedModels: ['grok-3-*'],
        disableCooling: true,
      },
      key: {
        'api-key': 'xai-new',
        priority: 3,
        prefix: 'xai',
        websockets: true,
        'proxy-url': 'direct',
        headers: { 'X-Custom': 'value' },
        models: [
          {
            name: 'grok-4.5',
            alias: 'grok-latest',
            thinking: { levels: ['low', 'high', 'xhigh'] },
          },
        ],
        'excluded-models': ['grok-3-*'],
        'disable-cooling': true,
      },
    },
  ];

  for (const { family, create, update, remove, config, key } of cases) {
    test(`${family}: create hoists base-url into a new named group and keeps existing groups`, async () => {
      const existing = {
        name: 'existing',
        'base-url': 'https://old.invalid',
        keys: [{ 'api-key': 'old', future: 'keep' }],
      };
      const b = backend(family, [existing]);
      await create(config);
      expect(b.writes).toHaveLength(1);
      expect(b.writes[0].data).toEqual([
        {
          name: 'existing',
          'base-url': 'https://old.invalid',
          keys: [{ 'api-key': 'old', future: 'keep' }],
        },
        { name: `${family}-2`, 'base-url': config.baseUrl, keys: [key] },
      ]);
    });

    test(`${family}: editing one field leaves every other persisted field and group alone`, async () => {
      const group = {
        name: `${family}-1`,
        'base-url': config.baseUrl,
        'request-retry': 2,
        keys: [{ ...key, future: 'keep', auth_index: 'live-index' }, { 'api-key': 'sibling' }],
      };
      const b = backend(family, [group]);
      const row = rows(b.groups())[0];
      expect(row.authIndex).toBe('live-index');
      await update(row.apiKey, row.baseUrl, { ...row, priority: 9 });
      const { auth_index: _responseOnly, ...persistedKey } = group.keys[0] as Wire;
      void _responseOnly;
      expect(b.groups()).toEqual([
        {
          ...group,
          keys: [{ ...persistedKey, priority: 9 }, { 'api-key': 'sibling' }],
        },
      ]);
    });

    test(`${family}: changing the endpoint of a sole key edits its group`, async () => {
      const group = {
        name: `${family}-1`,
        'base-url': 'https://old.invalid',
        keys: [{ 'api-key': 'k' }],
      };
      const b = backend(family, [group]);
      const row = rows(b.groups())[0];
      await update(row.apiKey, row.baseUrl, { ...row, baseUrl: 'https://new.invalid' });
      expect(b.groups()).toEqual([{ ...group, 'base-url': 'https://new.invalid' }]);
    });

    test(`${family}: delete keeps the (now empty) group so its policy is not lost`, async () => {
      const group = { name: `${family}-1`, 'base-url': config.baseUrl, priority: 6, keys: [key] };
      const b = backend(family, [group]);
      const row = rows(b.groups())[0];
      await remove(row.apiKey, row.baseUrl, row.source);
      expect(b.groups()).toEqual([{ ...group, keys: [] }]);
    });
  }
});

describe('endpoint edits never repoint sibling credentials', () => {
  test('changing one key of a shared group moves it into a new group with the same policy', async () => {
    const group = {
      name: 'team',
      'base-url': 'https://shared.invalid',
      priority: 5,
      headers: { A: 'group' },
      keys: [
        { 'api-key': 'first', weight: 1 },
        { 'api-key': 'second', weight: 2 },
        { 'api-key': 'third' },
      ],
    };
    const b = backend('codex', [group, { name: 'other', keys: [{ 'api-key': 'x' }] }]);
    const row = rows(b.groups())[1];
    expect(row.apiKey).toBe('second');
    await providersApi.updateCodexConfig(row.apiKey, row.baseUrl, {
      ...row,
      baseUrl: 'https://moved.invalid',
    });
    expect(b.groups()).toEqual([
      { ...group, keys: [group.keys[0], group.keys[2]] },
      {
        name: 'codex-3',
        'base-url': 'https://moved.invalid',
        priority: 5,
        headers: { A: 'group' },
        keys: [group.keys[1]],
      },
      { name: 'other', keys: [{ 'api-key': 'x' }] },
    ]);
  });
});

describe('response-only and legacy fields never reach the backend', () => {
  test('auth_index is read as authIndex and stripped from every written group and key', async () => {
    const groups = [
      {
        name: 'a',
        auth_index: 'group-live',
        keys: [{ 'api-key': 'one', auth_index: 'live-1', 'auth-index': 'old-1' }],
      },
      { name: 'b', keys: [{ 'api-key': 'two', auth_index: 'live-2', weight: 1 }] },
    ];
    const b = backend('codex', groups);
    const [one, two] = rows(groups);
    expect(one.authIndex).toBe('live-1');
    expect(two.authIndex).toBe('live-2');
    await providersApi.updateCodexConfig(two.apiKey, undefined, { ...two, weight: 3 });
    expect(b.groups()).toEqual([
      { name: 'a', keys: [{ 'api-key': 'one' }] },
      { name: 'b', keys: [{ 'api-key': 'two', weight: 3 }] },
    ]);
  });

  test('a live auth_index that changes between read and write does not make the row stale', async () => {
    const group = { name: 'a', keys: [{ 'api-key': 'one', auth_index: 'before' }] };
    const row = rows([group])[0];
    const b = backend('codex', [{ ...group, keys: [{ 'api-key': 'one', auth_index: 'after' }] }]);
    await providersApi.updateCodexConfig(row.apiKey, undefined, { ...row, weight: 2 });
    expect(b.groups()).toEqual([{ name: 'a', keys: [{ 'api-key': 'one', weight: 2 }] }]);
  });

  test('the retired test-model field is stripped and never serialized', async () => {
    const group = {
      name: 'compat',
      'base-url': 'https://example.invalid',
      'test-model': 'legacy',
      models: [{ name: 'm', 'test-model': 'legacy' }],
      keys: [{ 'api-key': 'fixture', models: [{ name: 'k', 'test-model': 'legacy' }] }],
    };
    const b = backend('openai-compatibility', [group]);
    const current = openaiRows(b.groups())[0];
    expect(current).not.toHaveProperty('testModel');
    await providersApi.updateOpenAIProvider(current.name, {
      ...current,
      testModel: 'm',
      models: [{ ...current.models![0], testModel: 'm' }],
      priority: 2,
    });
    expect(JSON.stringify(b.writes)).not.toContain('test-model');
    expect(b.groups()[0].priority).toBe(2);
  });

  test('model priority is not a backend field and is never written', async () => {
    const b = backend('codex');
    await providersApi.createCodexConfig({
      apiKey: 'fixture',
      models: [{ name: 'm', alias: 'a', priority: 5 }],
    });
    expect(b.groups()[0].keys).toEqual([
      { 'api-key': 'fixture', models: [{ name: 'm', alias: 'a' }] },
    ]);
  });

  test('thinking capabilities are read as snake_case and written back as YAML tags', async () => {
    const group = {
      name: 'v',
      keys: [
        {
          'api-key': 'fixture',
          models: [
            {
              name: 'm',
              alias: 'a',
              thinking: {
                min: 1,
                max: 9,
                'zero-allowed': true,
                'dynamic-allowed': false,
                extra: 1,
              },
            },
          ],
        },
      ],
    };
    const row = rows([group])[0];
    expect(row.models![0].thinking).toEqual({
      min: 1,
      max: 9,
      zero_allowed: true,
      dynamic_allowed: false,
      extra: 1,
    });
    const b = backend('vertex', [group]);
    await providersApi.updateVertexConfig(row.apiKey, undefined, { ...row, priority: 1 });
    expect(b.groups()[0]).toEqual({ ...group, keys: [{ ...group.keys[0], priority: 1 }] });
  });
});

describe('refusing unsafe writes', () => {
  test.each([
    ['family is not a list', { name: 'x' }],
    ['group has no keys list', [{ name: 'x' }]],
  ])('%s: nothing is written', async (_label, malformed) => {
    apiClient.getRaw = async () => configResponse({ 'api-keys': { codex: malformed } });
    let wrote = false;
    apiClient.put = (async () => {
      wrote = true;
    }) as typeof apiClient.put;
    await expect(providersApi.createCodexConfig({ apiKey: 'fixture' })).rejects.toThrow();
    expect(wrote).toBe(false);
  });

  test('a row whose group was edited elsewhere is refused instead of overwritten', async () => {
    const group = { name: 'team', keys: [{ 'api-key': 'fixture', weight: 1 }] };
    const row = rows([group])[0];
    const b = backend('codex', [{ ...group, keys: [{ 'api-key': 'fixture', weight: 9 }] }]);
    await expect(
      providersApi.updateCodexConfig(row.apiKey, undefined, { ...row, priority: 3 })
    ).rejects.toThrow();
    expect(b.writes).toHaveLength(0);
  });

  test('without a source the row must be unambiguous by credential and endpoint', async () => {
    const groups = [
      { name: 'a', 'base-url': 'https://one.invalid', keys: [{ 'api-key': 'same' }] },
      { name: 'b', 'base-url': 'https://one.invalid', keys: [{ 'api-key': 'same' }] },
    ];
    const b = backend('codex', groups);
    await expect(providersApi.deleteCodexConfig('same', 'https://one.invalid')).rejects.toThrow();
    expect(b.writes).toHaveLength(0);
    await providersApi.deleteCodexConfig('same', 'https://one.invalid', rows(groups)[1].source);
    expect(b.groups()[0].keys).toHaveLength(1);
    expect(b.groups()[1].keys).toEqual([]);
  });

  test('a new OpenAI group is added without touching existing groups', async () => {
    const existing = {
      name: 'a',
      'base-url': 'https://a.invalid',
      future: 1,
      keys: [{ 'api-key': 'k' }],
    };
    const b = backend('openai-compatibility', [existing]);
    await providersApi.createOpenAIProvider({
      name: 'b',
      baseUrl: 'https://b.invalid',
      apiKeyEntries: [{ apiKey: 'k2', weight: 3 }],
    });
    expect(b.groups()).toEqual([
      existing,
      { name: 'b', 'base-url': 'https://b.invalid', keys: [{ 'api-key': 'k2', weight: 3 }] },
    ]);
  });
});

describe('workbench form edits do not materialize defaults', () => {
  test('a weight edit on a bare key writes nothing but the weight', async () => {
    const group = {
      name: 'team',
      'base-url': 'https://example.invalid',
      keys: [{ 'api-key': 'fixture' }],
    };
    const b = backend('codex', [group]);
    const row = rows([group])[0];
    const config = buildProviderKeyConfig(
      'codex',
      formInput({ baseUrl: 'https://example.invalid', weight: 5, websockets: false }),
      row
    ) as ProviderKeyConfig;
    await providersApi.updateCodexConfig(row.apiKey, row.baseUrl, config);
    expect(b.groups()).toEqual([{ ...group, keys: [{ 'api-key': 'fixture', weight: 5 }] }]);
    expect(JSON.stringify(b.writes)).not.toMatch(/disable-cooling|websockets|test-model|cloak/);
  });

  test('a Claude key without a cloak block does not gain one', async () => {
    const group = { name: 'c', keys: [{ 'api-key': 'fixture' }] };
    const b = backend('claude', [group]);
    const row = rows([group])[0];
    const config = buildProviderKeyConfig(
      'claude',
      formInput({
        weight: 2,
        cloak: { mode: '', strictMode: false, sensitiveWordsText: '', cacheUserId: false },
      }),
      row
    ) as ProviderKeyConfig;
    await providersApi.updateClaudeConfig(row.apiKey, undefined, config);
    expect(b.groups()).toEqual([{ name: 'c', keys: [{ 'api-key': 'fixture', weight: 2 }] }]);
  });

  test('unchecking cooling overrides an inherited true instead of re-inheriting it', async () => {
    const group = { name: 'c', 'disable-cooling': true, keys: [{ 'api-key': 'fixture' }] };
    const b = backend('codex', [group]);
    const row = rows([group])[0];
    expect(row.disableCooling).toBe(true);
    const config = buildProviderKeyConfig(
      'codex',
      formInput({ disableCooling: false }),
      row
    ) as ProviderKeyConfig;
    await providersApi.updateCodexConfig(row.apiKey, undefined, config);
    expect(b.groups()).toEqual([
      { ...group, keys: [{ 'api-key': 'fixture', 'disable-cooling': false }] },
    ]);
  });

  test('OpenAI edits keep unknown group fields, per-key metadata and model metadata', async () => {
    const group = {
      name: 'compat',
      'base-url': 'https://example.invalid',
      'support-prompt-cache-key': true,
      'request-retry': 3,
      keys: [
        { 'api-key': 'first', weight: 2, custom: 'keep-a' },
        { 'api-key': 'second', 'proxy-url': 'direct', custom: 'keep-b' },
      ],
      models: [
        { name: 'm1', alias: 'one', 'display-name': 'One', 'max-context-length': 7 },
        { name: 'm2', alias: 'two', 'is-compat': true },
      ],
    };
    const b = backend('openai-compatibility', [group]);
    const current = openaiRows([group])[0];
    const config = buildOpenAIConfig(
      formInput({
        name: 'compat',
        baseUrl: 'https://example.invalid',
        disabled: false,
        // the form lists models in a new order and renames one alias
        models: [
          { name: 'm2', alias: 'two', sourceIndex: 1 },
          { name: 'm1', alias: 'uno', sourceIndex: 0 },
        ],
        apiKeyEntries: [
          { apiKey: '', existingApiKey: 'second', proxyUrl: 'direct', sourceIndex: 1 },
          { apiKey: 'rotated', existingApiKey: 'first', proxyUrl: '', weight: 2, sourceIndex: 0 },
          { apiKey: 'brand-new', proxyUrl: '' },
        ],
      }),
      current
    );
    await providersApi.updateOpenAIProvider(current.name, config);
    expect(b.groups()).toEqual([
      {
        ...group,
        models: [group.models[1], { ...group.models[0], alias: 'uno' }],
        keys: [
          group.keys[1],
          { ...group.keys[0], 'api-key': 'rotated' },
          { 'api-key': 'brand-new' },
        ],
      },
    ]);
  });
});

describe('form row identity survives provider writes', () => {
  for (const sourceIndex of [0, null]) {
    test(`${sourceIndex === null ? 'new' : 'renamed'} model does not inherit another row's metadata`, async () => {
      const group = {
        name: 'fixture',
        'base-url': 'https://models.invalid/v1',
        keys: [
          { 'api-key': 'fixture-key', models: [{ name: 'old', 'display-name': 'old display' }] },
        ],
      };
      const server = backend('meta', [group]);
      const original = rows([group])[0];
      const next = buildProviderKeyConfig(
        'meta',
        formInput({
          baseUrl: original.baseUrl,
          models: [{ name: 'replacement', sourceIndex }],
        }),
        original
      );
      await providersApi.updateMetaConfig(original.apiKey, original.baseUrl, next);
      expect((server.groups()[0].keys as Wire[])[0].models).toEqual([
        sourceIndex === null
          ? { name: 'replacement' }
          : { name: 'replacement', 'display-name': 'old display' },
      ]);
    });
  }
});

describe('resources carry their persisted identity', () => {
  test('every row keeps its group snapshot and family list; OpenAI rows keep the group index', () => {
    const config = normalizeConfigResponse({
      'api-keys': {
        codex: [
          { name: 'a', keys: [{ 'api-key': 'one' }, { 'api-key': 'two' }] },
          { name: 'b', keys: [{ 'api-key': 'three' }] },
        ],
        'openai-compatibility': [
          { name: 'x', 'base-url': 'https://x.invalid', keys: [{ 'api-key': 'k' }] },
          { name: 'y', 'base-url': 'https://y.invalid', keys: [{ 'api-key': 'k' }] },
        ],
      },
    });
    const codex = buildProviderGroups(config).find((group) => group.id === 'codex')!.resources;
    expect(
      codex.map((resource) => [resource.source?.groupIndex, resource.source?.keyIndex])
    ).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
    expect(codex[0].source?.groups).toBe(
      (config.raw!['api-keys'] as Record<string, unknown[]>).codex
    );
    const openai = buildProviderGroups(config).find(
      (group) => group.id === 'openaiCompatibility'
    )!.resources;
    expect(openai.map((resource) => resource.source?.groupIndex)).toEqual([0, 1]);
    expect(openai.map((resource) => resource.originalIndex)).toEqual([0, 1]);
    expect(openai[1].source?.keyIndex).toBeUndefined();
  });
});
