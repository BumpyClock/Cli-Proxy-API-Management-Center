import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import { apiKeysApi } from '@/services/api/apiKeys';
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
    oauth: { 'excluded-models': { claude: ['old'], codex: ['untouched'] } },
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
  const cases = [
    {
      name: 'provider families',
      write: () => providersApi.createMetaConfig({ apiKey: 'new', baseUrl: 'https://new.invalid' }),
      change: (f: ReturnType<typeof fixture>) =>
        f.config['api-keys'].meta.push({
          name: 'concurrent',
          'base-url': 'https://other.invalid',
          keys: [{ 'api-key': 'other' }],
        }),
    },
    {
      name: 'OAuth maps',
      write: () => authFilesApi.saveOauthExcludedModels('claude', ['new']),
      change: (f: ReturnType<typeof fixture>) => {
        f.config.oauth['excluded-models'].codex = ['concurrent'];
      },
    },
    {
      name: 'client keys',
      write: () => apiKeysApi.update(1, 'replacement'),
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

  test('a missing ETag never degrades a dependent write to an unconditional replacement', async () => {
    const f = fixture();
    f.hideETag();
    await expect(apiKeysApi.update(1, 'replacement')).rejects.toThrow();
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
