import { afterEach, expect, test } from 'bun:test';
import {
  APIKEY_FUN_CODEX_BASE_URL,
  APIKEY_FUN_STANDARD_BASE_URL,
  buildApiKeyFunRaw,
} from '../src/features/providers/sponsor';
import { writeSponsor } from '../src/features/providers/useProviderWorkbench';
import { apiClient } from '../src/services/api/client';
import { guardConfigConnection } from '../src/services/api/configValue';
import { normalizeConfigResponse } from '../src/services/api/transformers';
import type { ProviderEntryFormInput, SponsorKeyEntryInput } from '../src/features/providers/types';
import { configResponse } from './fixtures/managementV8';

const originalGetRaw = apiClient.getRaw;
const originalPatch = apiClient.patch;
const originalPut = apiClient.put;

afterEach(() => {
  apiClient.getRaw = originalGetRaw;
  apiClient.patch = originalPatch;
  apiClient.put = originalPut;
  apiClient.setConfig({ apiBase: '', managementKey: '' });
});

const sponsorGroup = (name: string, apiKey: string) => ({
  name,
  'base-url': name === 'sponsor-codex' ? APIKEY_FUN_CODEX_BASE_URL : APIKEY_FUN_STANDARD_BASE_URL,
  headers: { 'X-Policy': 'keep' },
  keys: [
    {
      'api-key': apiKey,
      models: [{ name: 'model', alias: 'public', 'display-name': name }],
      auth_index: 'response-only',
    },
  ],
});

const groupMap = () => ({
  codex: [sponsorGroup('sponsor-codex', 'codex-fixture')],
  claude: [sponsorGroup('sponsor-claude', 'claude-fixture')],
  meta: [{ name: 'unrelated', keys: [{ 'api-key': 'meta-fixture' }] }],
});

const input = (...entries: Partial<SponsorKeyEntryInput>[]): ProviderEntryFormInput => ({
  apiKey: '',
  name: '',
  baseUrl: '',
  proxyUrl: '',
  prefix: '',
  disabled: false,
  models: [],
  headers: [],
  excludedModelsText: '',
  sponsorKeyEntries: entries.map((entry) => ({
    protocol: 'codex',
    apiKey: '',
    baseUrl: APIKEY_FUN_STANDARD_BASE_URL,
    proxyUrl: '',
    prefix: '',
    disabled: false,
    models: [],
    ...entry,
  })),
});

const aggregate = (groups: unknown) =>
  buildApiKeyFunRaw(normalizeConfigResponse({ 'api-keys': groups }));

const backend = (groups: object, etag = '"fixture"') => {
  const reads: string[] = [];
  const commits: Array<{ path: string; patch: unknown; ifMatch: unknown }> = [];
  apiClient.getRaw = (async (path: string) => {
    reads.push(path);
    const response = configResponse({ 'api-keys': groups });
    response.headers.etag = etag;
    return response;
  }) as typeof apiClient.getRaw;
  apiClient.patch = (async (path, patch, options) => {
    commits.push({ path, patch, ifMatch: options?.headers?.['If-Match'] });
  }) as typeof apiClient.patch;
  apiClient.put = (async () => {
    throw new Error('Provider aggregate must not issue a PUT.');
  }) as typeof apiClient.put;
  return { reads, commits };
};

test('creates an absent sponsor with one conditional patch, without writing untouched families', async () => {
  const b = backend({ meta: groupMap().meta });
  await writeSponsor('apikeyFun', null, guardConfigConnection(), {
    type: 'save',
    input: input({ apiKey: 'codex-fixture' }, { protocol: 'claude', apiKey: 'claude-fixture' }),
  });

  expect(b.reads).toEqual(['/config']);
  expect(b.commits).toEqual([
    {
      path: '/config/api-keys',
      ifMatch: '"fixture"',
      patch: {
        codex: [
          {
            name: 'codex-1',
            'base-url': `${APIKEY_FUN_STANDARD_BASE_URL}/v1`,
            keys: [{ 'api-key': 'codex-fixture' }],
          },
        ],
        claude: [
          {
            name: 'claude-1',
            'base-url': APIKEY_FUN_STANDARD_BASE_URL,
            keys: [{ 'api-key': 'claude-fixture' }],
          },
        ],
      },
    },
  ]);
});

test('edits a sponsor from its edit-open identities, retaining distinct model metadata', async () => {
  const groups = groupMap();
  const expected = aggregate(groups);
  const b = backend(groups);
  await writeSponsor('apikeyFun', expected, guardConfigConnection(), {
    type: 'save',
    input: input(
      {
        existingApiKey: 'codex-fixture',
        models: [{ sourceIndex: 0, name: 'model', alias: 'retained' }],
      },
      {
        protocol: 'claude',
        existingApiKey: 'claude-fixture',
        models: [{ name: 'model', alias: 'public' }],
      }
    ),
  });

  expect(b.reads).toEqual(['/config']);
  expect(b.commits).toHaveLength(1);
  expect(b.commits[0].patch).toMatchObject({
    codex: [
      {
        keys: [
          {
            'api-key': 'codex-fixture',
            models: [{ name: 'model', alias: 'retained', 'display-name': 'sponsor-codex' }],
          },
        ],
      },
    ],
    claude: [
      { keys: [{ 'api-key': 'claude-fixture', models: [{ name: 'model', alias: 'public' }] }] },
    ],
  });
  expect(JSON.stringify(b.commits)).not.toContain('auth_index');
  expect(JSON.stringify(b.commits)).not.toContain('"display-name":"sponsor-claude"');
});

test.each(['toggle', 'delete'] as const)('%s uses one edit-open aggregate patch', async (type) => {
  const groups = groupMap();
  const b = backend(groups);
  await writeSponsor(
    'apikeyFun',
    aggregate(groups),
    guardConfigConnection(),
    type === 'toggle' ? { type, disabled: true } : { type }
  );
  expect(b.reads).toEqual(['/config']);
  expect(b.commits).toHaveLength(1);
  for (const [family, group] of [
    ['claude', groups.claude[0]],
    ['codex', groups.codex[0]],
  ] as const) {
    expect(b.commits[0].patch).toMatchObject({
      [family]: [
        { headers: group.headers, keys: type === 'delete' ? [] : [{ 'excluded-models': ['*'] }] },
      ],
    });
  }
});

test('neither a stale edit nor a create can restore a credential rotated after opening', async () => {
  const old = groupMap();
  const latest = { ...old, claude: [sponsorGroup('sponsor-claude', 'rotated-claude')] };
  const b = backend(latest);
  const save = { type: 'save', input: input({ apiKey: 'another-codex' }) } as const;
  await expect(
    writeSponsor('apikeyFun', aggregate(old), guardConfigConnection(), save)
  ).rejects.toThrow('changed');
  await expect(writeSponsor('apikeyFun', null, guardConfigConnection(), save)).rejects.toThrow(
    'changed'
  );
  expect(b.commits).toHaveLength(0);
});

test('validates every family and row before issuing any sponsor write', async () => {
  const groups = groupMap();
  const b = backend({ ...groups, claude: [...groups.claude, { name: 'invalid', keys: [null] }] });
  const expected = aggregate(groups);
  await expect(
    writeSponsor('apikeyFun', expected, guardConfigConnection(), { type: 'delete' })
  ).rejects.toThrow('changed');
  expect(b.commits).toHaveLength(0);

  const c = backend(groups);
  await expect(
    writeSponsor('apikeyFun', expected, guardConfigConnection(), {
      type: 'save',
      input: input(
        { existingApiKey: 'codex-fixture', models: [] },
        {
          protocol: 'claude',
          existingApiKey: 'claude-fixture',
          models: [{ sourceIndex: 99, name: 'invalid' }],
        }
      ),
    })
  ).rejects.toThrow('changed');
  expect(c.commits).toHaveLength(0);
});

test('refuses sponsor mutation if opening connection changed or the read lacks an ETag', async () => {
  const groups = groupMap();
  const b = backend(groups, '');
  apiClient.setConfig({ apiBase: 'https://one.invalid', managementKey: 'fixture' });
  const origin = guardConfigConnection();
  apiClient.setConfig({ apiBase: 'https://two.invalid', managementKey: 'fixture' });
  const expected = aggregate(groups);
  const change = { type: 'delete' } as const;
  await expect(writeSponsor('apikeyFun', expected, origin, change)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(b.reads).toHaveLength(0);
  await expect(
    writeSponsor('apikeyFun', expected, guardConfigConnection(), change)
  ).rejects.toMatchObject({ apiCode: 'config_etag_unavailable' });
  expect(b.reads).toEqual(['/config']);
  expect(b.commits).toHaveLength(0);
});

test('a stale backend ETag fails the one patch with no retry or partial recovery', async () => {
  const groups = groupMap();
  const b = backend(groups, '"read-revision"');
  const capture = apiClient.patch;
  apiClient.patch = (async (path, patch, options) => {
    await capture(path, patch, options);
    throw Object.assign(new Error('Configuration changed after read.'), { status: 412 });
  }) as typeof apiClient.patch;

  await expect(
    writeSponsor('apikeyFun', aggregate(groups), guardConfigConnection(), { type: 'delete' })
  ).rejects.toMatchObject({ status: 412 });
  expect(b.reads).toEqual(['/config']);
  expect(b.commits).toHaveLength(1);
  expect(b.commits[0].ifMatch).toBe('"read-revision"');
});

test('an unchanged protocol is excluded from a sponsor edit patch', async () => {
  const groups = groupMap();
  const b = backend(groups);
  await writeSponsor('apikeyFun', aggregate(groups), guardConfigConnection(), {
    type: 'save',
    input: input(
      {
        existingApiKey: 'codex-fixture',
        weight: 3,
        models: [{ sourceIndex: 0, name: 'model', alias: 'public' }],
      },
      {
        protocol: 'claude',
        existingApiKey: 'claude-fixture',
        models: [{ sourceIndex: 0, name: 'model', alias: 'public' }],
      }
    ),
  });

  expect(b.commits).toHaveLength(1);
  expect(Object.keys(b.commits[0].patch as object)).toEqual(['codex']);
});
