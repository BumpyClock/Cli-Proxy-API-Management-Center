import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import { readConfigResource } from '@/services/api/configValue';
import { authFilesApi } from '@/services/api/authFiles';
import { pluginsApi } from '@/services/api/plugins';
import { providersApi } from '@/services/api/providers';
import { configFileApi } from '@/services/api/configFile';
import { parse as parseYaml, stringify } from 'yaml';
import { isRecord } from '@/utils/helpers';

const servers: Array<{ stop(closeActiveConnections?: boolean): void }> = [];
afterEach(() => {
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  for (const server of servers.splice(0)) server.stop(true);
});

function fixture() {
  const config = {
    access: { 'api-keys': ['first', 'second'] },
    'api-keys': {
      meta: [
        {
          name: 'existing',
          'base-url': 'https://existing.invalid',
          keys: [{ 'api-key': 'existing' }],
        },
      ],
    },
    oauth: {
      'excluded-models': { claude: ['old'], codex: ['untouched'] },
      'model-alias': {
        Claude: [{ name: 'claude-old', alias: 'shared', fork: true, 'future-field': 3 }],
        codex: [{ name: 'codex-old', alias: 'Shared', 'force-mapping': true }],
      },
    },
    plugins: { configs: { fixture: { enabled: true, edited: 'old', untouched: 'old' } } },
  };
  let version = 1;
  let acceptedWrites = 0;
  let exposeETag = true;
  let race: (() => void) | undefined;
  const root = '/v8/management/config';
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (!path.startsWith(root)) return new Response('Not found', { status: 404 });
      const isYaml = path === `${root}.yaml`;
      const parts = isYaml
        ? []
        : path.slice(root.length).split('/').filter(Boolean).map(decodeURIComponent);
      const tag = `"${version}"`;
      const headers = exposeETag ? { ETag: tag } : {};
      if (request.method === 'GET') {
        let value: unknown = config;
        for (const part of parts) value = isRecord(value) ? value[part] : undefined;
        if (value === undefined) return Response.json({ error: 'not_found' }, { status: 404 });
        const response = isYaml
          ? new Response(stringify(value), {
              headers: { ...headers, 'Content-Type': 'application/yaml' },
            })
          : Response.json(value, { headers });
        if (race) {
          const run = race;
          race = undefined;
          run();
          version += 1;
        }
        return response;
      }
      const match = request.headers.get('If-Match');
      if (match !== null && match !== tag) {
        return Response.json({ error: 'precondition_failed' }, { status: 412, headers });
      }
      if (isYaml) {
        const next: unknown = parseYaml(await request.text());
        if (!isRecord(next)) return Response.json({ error: 'invalid_config' }, { status: 400 });
        for (const key of Object.keys(config)) Reflect.deleteProperty(config, key);
        Object.assign(config, next);
      } else {
        let parent: Record<string, unknown> = config;
        for (const part of parts.slice(0, -1)) {
          const value = parent[part];
          if (!isRecord(value)) throw new Error(`Invalid fixture path ${path}`);
          parent = value;
        }
        parent[parts.at(-1)!] = await request.json();
      }
      acceptedWrites += 1;
      version += 1;
      return Response.json({ status: 'ok' }, { headers: { ETag: `"${version}"` } });
    },
  });
  servers.push(server);
  apiClient.setConfig({
    apiBase: `http://127.0.0.1:${server.port}`,
    managementKey: 'fixture-only',
  });
  return {
    config,
    writes: () => acceptedWrites,
    race: (change: () => void) => {
      race = change;
    },
    hideETag: () => {
      exposeETag = false;
    },
  };
}

describe('v8 config optimistic concurrency', () => {
  const replaceClientKeys = async () => {
    const keys = await readConfigResource('/config/access/api-keys', []);
    return keys.replace(['first', 'replacement']);
  };
  const cases = [
    {
      name: 'provider families',
      write: () =>
        providersApi.writeFamily({
          family: 'meta',
          type: 'create',
          config: { apiKey: 'new', baseUrl: 'https://new.invalid' },
        }),
      change: (f: ReturnType<typeof fixture>) =>
        f.config['api-keys'].meta.push({
          name: 'concurrent',
          'base-url': 'https://other.invalid',
          keys: [{ 'api-key': 'other' }],
        }),
    },
    {
      name: 'OAuth maps',
      write: () => authFilesApi.deleteOauthExcludedEntry('claude'),
      change: (f: ReturnType<typeof fixture>) => {
        f.config.oauth['excluded-models'].codex = ['concurrent'];
      },
    },
    {
      name: 'client keys',
      write: replaceClientKeys,
      change: (f: ReturnType<typeof fixture>) => f.config.access['api-keys'].push('concurrent'),
    },
    {
      name: 'plugin objects',
      write: () => pluginsApi.patchConfig('fixture', { edited: 'new' }),
      change: (f: ReturnType<typeof fixture>) => {
        f.config.plugins.configs.fixture.untouched = 'concurrent';
      },
    },
  ];
  for (const entry of cases) {
    test(`${entry.name} refuse to overwrite a concurrent writer`, async () => {
      const f = fixture();
      f.race(() => entry.change(f));
      await expect(entry.write()).rejects.toMatchObject({
        status: 412,
        apiCode: 'precondition_failed',
      });
      expect(f.writes()).toBe(0);
    });
  }

  test('simultaneous additions to one OAuth provider preserve both links and existing wire data', async () => {
    const f = fixture();
    await Promise.all([
      authFilesApi.editOauthAliases({
        type: 'add',
        provider: 'CLAUDE',
        model: 'claude-one',
        alias: 'first',
      }),
      authFilesApi.editOauthAliases({
        type: 'add',
        provider: 'claude',
        model: 'claude-two',
        alias: 'second',
      }),
    ]);
    expect(f.writes()).toBe(2);
    expect(f.config.oauth['model-alias']).toEqual({
      claude: [
        { name: 'claude-old', alias: 'shared', fork: true, 'future-field': 3 },
        { name: 'claude-one', alias: 'first', fork: true },
        { name: 'claude-two', alias: 'second', fork: true },
      ],
      codex: [{ name: 'codex-old', alias: 'Shared', 'force-mapping': true }],
    });
  });

  test.each(['rename', 'delete'] as const)(
    'a multi-provider alias %s is atomic and stops on a stale ETag',
    async (type) => {
      const f = fixture();
      const original = structuredClone(f.config.oauth['model-alias']);
      const edit =
        type === 'rename'
          ? { type, alias: 'shared', newAlias: 'renamed' }
          : { type, alias: 'shared' };
      f.race(() => f.config.access['api-keys'].push('concurrent'));
      await expect(authFilesApi.editOauthAliases(edit)).rejects.toMatchObject({
        status: 412,
        apiCode: 'precondition_failed',
      });
      expect(f.writes()).toBe(0);
      expect(f.config.oauth['model-alias']).toEqual(original);

      await authFilesApi.editOauthAliases(edit);
      expect(f.writes()).toBe(1);
      expect(f.config.oauth['model-alias']).toEqual(
        type === 'rename'
          ? {
              claude: [{ ...original.Claude[0], alias: 'renamed' }],
              codex: [{ ...original.codex[0], alias: 'renamed' }],
            }
          : {}
      );
    }
  );

  test('OAuth editor saves cannot overwrite same-provider changes made since opening', async () => {
    const f = fixture();
    const exclusionEditor = await authFilesApi.editOauthExcludedModels();
    const aliasEditor = await authFilesApi.editOauthModelAlias();
    f.config.oauth['excluded-models'].claude.push('concurrent');
    await authFilesApi.editOauthAliases({
      type: 'add',
      provider: 'claude',
      model: 'concurrent',
      alias: 'concurrent',
    });
    await expect(exclusionEditor.save('claude', ['replacement'])).rejects.toMatchObject({
      status: 412,
      apiCode: 'precondition_failed',
    });
    await expect(aliasEditor.save('claude', [])).rejects.toMatchObject({
      status: 412,
      apiCode: 'precondition_failed',
    });
    expect(f.writes()).toBe(1);
    expect(f.config.oauth['excluded-models'].claude).toEqual(['old', 'concurrent']);
    expect((await authFilesApi.getOauthModelAlias()).claude.map((entry) => entry.name)).toEqual([
      'claude-old',
      'concurrent',
    ]);
  });

  test('the alias editor preserves opaque fields only on retained row identities', async () => {
    const f = fixture();
    const editor = await authFilesApi.editOauthModelAlias();
    const original = editor.values.claude[0];
    await editor.save('claude', [{ ...original, alias: 'renamed', original }]);
    expect(f.config.oauth['model-alias']).toEqual({
      claude: [{ name: 'claude-old', alias: 'renamed', fork: true, 'future-field': 3 }],
      codex: [{ name: 'codex-old', alias: 'Shared', 'force-mapping': true }],
    });

    const nextEditor = await authFilesApi.editOauthModelAlias();
    const replacement = { ...nextEditor.values.claude[0] };
    await nextEditor.save('claude', [replacement]);
    expect(f.config.oauth['model-alias']).toEqual({
      claude: [{ name: 'claude-old', alias: 'renamed', fork: true }],
      codex: [{ name: 'codex-old', alias: 'Shared', 'force-mapping': true }],
    });
  });

  test('global edits preserve opaque providers and a full-list editor rejects unreadable rows', async () => {
    const f = fixture();
    const map: Record<string, unknown> = f.config.oauth['model-alias'];
    map.future = { opaque: 1 };
    map.incomplete = [{ name: 'not-shown', raw: true }];
    await authFilesApi.editOauthAliases({ type: 'rename', alias: 'shared', newAlias: 'renamed' });
    const editor = await authFilesApi.editOauthModelAlias();
    for (const provider of ['future', 'incomplete']) {
      await expect(editor.save(provider, [{ name: 'edited', alias: 'edited' }])).rejects.toThrow(
        'Invalid OAuth alias list'
      );
    }
    expect(f.writes()).toBe(1);
    expect(f.config.oauth['model-alias']).toMatchObject({
      future: { opaque: 1 },
      incomplete: [{ name: 'not-shown', raw: true }],
    });
  });

  test('a missing ETag never degrades a dependent write to an unconditional replacement', async () => {
    const f = fixture();
    f.hideETag();
    await expect(replaceClientKeys()).rejects.toMatchObject({
      apiCode: 'config_etag_unavailable',
    });
    expect(f.writes()).toBe(0);
    expect(f.config.access['api-keys']).toEqual(['first', 'second']);
  });

  test('a matching snapshot can update without losing unrelated values', async () => {
    const f = fixture();
    await pluginsApi.patchConfig('fixture', { edited: 'new' });
    expect(f.writes()).toBe(1);
    expect(f.config.plugins.configs.fixture).toEqual({
      enabled: true,
      edited: 'new',
      untouched: 'old',
    });
  });

  test('YAML replacement refuses changes made after its read', async () => {
    const f = fixture();
    f.race(() => {
      f.config.plugins.configs.fixture.untouched = 'concurrent';
    });
    const snapshot = await configFileApi.fetchConfigYaml();
    await expect(
      snapshot.replace(snapshot.content.replace('edited: old', 'edited: new'))
    ).rejects.toMatchObject({ status: 412, apiCode: 'precondition_failed' });
    expect(f.writes()).toBe(0);
    expect(f.config.plugins.configs.fixture.untouched).toBe('concurrent');
  });

  test('YAML writes use the read ETag and preserve unrelated fields', async () => {
    const f = fixture();
    const snapshot = await configFileApi.fetchConfigYaml();
    await snapshot.replace(snapshot.content.replace('edited: old', 'edited: new'));
    expect(f.writes()).toBe(1);
    expect(f.config.plugins.configs.fixture).toEqual({
      enabled: true,
      edited: 'new',
      untouched: 'old',
    });
  });

  for (const reason of ['missing-etag', 'connection-change']) {
    test(`YAML replacement refuses ${reason}`, async () => {
      const f = fixture();
      if (reason === 'missing-etag') f.hideETag();
      const snapshot = await configFileApi.fetchConfigYaml();
      if (reason === 'connection-change')
        apiClient.setConfig({ apiBase: 'http://127.0.0.1:1', managementKey: 'other-fixture' });
      await expect(snapshot.replace(snapshot.content)).rejects.toMatchObject(
        reason === 'missing-etag' ? { apiCode: 'config_etag_unavailable' } : { name: 'AbortError' }
      );
      expect(f.writes()).toBe(0);
    });
  }
});
