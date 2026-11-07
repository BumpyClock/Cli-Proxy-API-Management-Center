import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import { pluginsApi } from '@/services/api/plugins';
import { oauthApi } from '@/services/api/oauth';
import { buildPluginOAuthProviderCards } from '@/pages/pluginOAuthEntries';
import { createOAuthAttempts } from '@/pages/oauthAttempts';

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

const apiBase = 'https://proxy.example';
const builtIns = new Set(['codex', 'anthropic', 'meta']);
const rawPlugin = (overrides: Record<string, unknown> = {}) => ({
  id: 'multi-login',
  supports_oauth: true,
  registered: true,
  enabled: true,
  effective_enabled: true,
  oauth_provider: 'portal-a',
  logo: '/plugins/multi-login/logo.svg',
  metadata: { name: 'Multi login' },
  ...overrides,
});
const loadPlugins = async (entries: Array<Record<string, unknown>>) => {
  const spy = spyOn(apiClient, 'get').mockResolvedValue({
    plugins_enabled: true,
    plugins: entries,
  });
  spies.push(spy);
  return (await pluginsApi.list()).plugins;
};

const multiPlugin = () =>
  rawPlugin({
    oauth_providers: ['portal-a', 'portal-b'],
    oauth_provider_entries: [
      { identifier: 'portal-a', name: 'Portal A', logo: '/plugins/multi-login/a.svg' },
      { identifier: 'portal-b', name: 'Portal B', logo: 'https://portal.example/b.svg' },
    ],
  });

describe('plugin OAuth entry normalization', () => {
  test('keeps current single-provider and legacy plugin-id login working', async () => {
    const legacy = rawPlugin({ id: 'legacy-login' });
    delete (legacy as Record<string, unknown>).oauth_provider;
    const plugins = await loadPlugins([rawPlugin(), legacy]);
    expect(plugins[0].oauthProvider).toBe('portal-a');
    expect(plugins[0].oauthProviders).toBeUndefined();
    expect(plugins[0].oauthProviderEntries).toBeUndefined();
    expect(plugins[1].oauthProvider).toBe('legacy-login');
    expect(buildPluginOAuthProviderCards(plugins, apiBase, builtIns)).toEqual([
      {
        kind: 'plugin',
        id: 'portal-a',
        title: 'Multi login',
        icon: 'https://proxy.example/plugins/multi-login/logo.svg',
      },
      {
        kind: 'plugin',
        id: 'legacy-login',
        title: 'Multi login',
        icon: 'https://proxy.example/plugins/multi-login/logo.svg',
      },
    ]);
  });

  test('does not manufacture a login when the backend explicitly publishes an empty provider', async () => {
    const plugins = await loadPlugins([rawPlugin({ oauth_provider: '' })]);
    expect(plugins[0].oauthProvider).toBeUndefined();
    expect(buildPluginOAuthProviderCards(plugins, apiBase, builtIns)).toEqual([]);
  });

  test('renders every declared portal using its entry-specific name and logo', async () => {
    const plugins = await loadPlugins([multiPlugin()]);
    expect(plugins[0].oauthProvider).toBe('portal-a');
    expect(plugins[0].oauthProviders).toEqual(['portal-a', 'portal-b']);
    expect(buildPluginOAuthProviderCards(plugins, apiBase, builtIns)).toEqual([
      {
        kind: 'plugin',
        id: 'portal-a',
        title: 'Portal A',
        icon: 'https://proxy.example/plugins/multi-login/a.svg',
      },
      {
        kind: 'plugin',
        id: 'portal-b',
        title: 'Portal B',
        icon: 'https://portal.example/b.svg',
      },
    ]);
  });

  test('normalizes and deduplicates declared identifiers and drops undeclared metadata', async () => {
    const plugins = await loadPlugins([
      rawPlugin({
        oauth_providers: [' Portal-A ', 'portal-a', 'muse', 'bad/path', '', null, 'portal-b'],
        oauth_provider_entries: [
          { identifier: 'PORTAL-A', name: ' A ' },
          { identifier: 'portal-a', name: 'duplicate' },
          { identifier: 'portal-c', name: 'undeclared' },
          { identifier: 'bad/path', name: 'invalid' },
          { identifier: 'portal-b' },
          'invalid-entry',
        ],
      }),
    ]);
    expect(plugins[0].oauthProviders).toEqual(['portal-a', 'meta', 'portal-b']);
    expect(plugins[0].oauthProviderEntries).toEqual([
      { identifier: 'portal-a', name: 'A' },
      { identifier: 'portal-b' },
    ]);
  });

  test('ignores entry metadata when plural capability is not advertised', async () => {
    const plugins = await loadPlugins([
      rawPlugin({ oauth_provider_entries: [{ identifier: 'portal-b', name: 'Not declared' }] }),
    ]);
    expect(plugins[0].oauthProviderEntries).toBeUndefined();
    expect(
      buildPluginOAuthProviderCards(plugins, apiBase, builtIns).map((card) => card.id)
    ).toEqual(['portal-a']);
  });

  test('falls back to plugin title and logo when entry display metadata is missing', async () => {
    const plugins = await loadPlugins([
      rawPlugin({
        oauth_providers: ['portal-a', 'portal-b'],
        oauth_provider_entries: [{ identifier: 'portal-b', name: '  ', logo: '  ' }],
      }),
    ]);
    expect(
      buildPluginOAuthProviderCards(plugins, apiBase, builtIns).map(({ title, icon }) => ({
        title,
        icon,
      }))
    ).toEqual([
      { title: 'Multi login', icon: 'https://proxy.example/plugins/multi-login/logo.svg' },
      { title: 'Multi login', icon: 'https://proxy.example/plugins/multi-login/logo.svg' },
    ]);
  });

  test('decodes Go escaped names and logos exactly once without parsing HTML', async () => {
    const plugins = await loadPlugins([
      rawPlugin({
        oauth_providers: ['portal-a', 'portal-b'],
        oauth_provider_entries: [
          {
            identifier: 'portal-a',
            name: '  A &amp; B &lt;portal&gt; &#34;quoted&#34; &#39;single&#39;  ',
            logo: 'https://portal.example/logo.svg?a=1&amp;b=2',
          },
          {
            identifier: 'portal-b',
            name: '&amp;lt;literal&amp;gt; &quot;unchanged&quot;',
            logo: '/logo.svg?q=&amp;amp;',
          },
        ],
      }),
    ]);
    const cards = buildPluginOAuthProviderCards(plugins, apiBase, builtIns);
    expect(cards[0].title).toBe('A & B <portal> "quoted" \'single\'');
    expect(cards[0].icon).toBe('https://portal.example/logo.svg?a=1&b=2');
    expect(cards[1].title).toBe('&lt;literal&gt; &quot;unchanged&quot;');
    expect(cards[1].icon).toBe('https://proxy.example/logo.svg?q=&amp;');
  });

  test('hides unsupported and disabled plugins and protects built-in and duplicate entries', async () => {
    const plugins = await loadPlugins([
      rawPlugin({ supports_oauth: false, oauth_providers: ['unsupported'] }),
      rawPlugin({ effective_enabled: false, oauth_providers: ['disabled'] }),
      rawPlugin({ oauth_providers: ['codex', 'portal-a', 'portal-b'] }),
      rawPlugin({ id: 'duplicate', oauth_providers: ['portal-b', 'portal-c'] }),
    ]);
    expect(
      buildPluginOAuthProviderCards(plugins, apiBase, builtIns).map((card) => card.id)
    ).toEqual(['portal-a', 'portal-b', 'portal-c']);
  });
});

describe('plugin OAuth entry dispatch and attempt identity', () => {
  test('starts each portal with its own management endpoint', async () => {
    const plugins = await loadPlugins([multiPlugin()]);
    spies.splice(0).forEach((spy) => spy.mockRestore());
    const start = spyOn(apiClient, 'get').mockResolvedValue({ state: 'login-state' });
    spies.push(start);
    const cards = buildPluginOAuthProviderCards(plugins, apiBase, builtIns);
    for (const card of cards) await oauthApi.startAuth(card.id);
    expect(start.mock.calls.map(([path]) => path)).toEqual([
      '/portal-a-auth-url',
      '/portal-b-auth-url',
    ]);
  });

  test('a new attempt for one portal preserves the other portal login and timer', async () => {
    const plugins = await loadPlugins([multiPlugin()]);
    const cards = buildPluginOAuthProviderCards(plugins, apiBase, builtIns);
    let timer = 0;
    const tasks = new Map<number, () => void>();
    const attempts = createOAuthAttempts({
      setTimeout: (callback) => {
        tasks.set(++timer, callback);
        return timer;
      },
      clearTimeout: (id) => tasks.delete(id),
    });
    const first = attempts.begin(cards[0].id);
    first.schedule(() => {}, 3000);
    const second = attempts.begin(cards[1].id);
    second.schedule(() => {}, 3000);
    expect(tasks.size).toBe(2);
    const next = attempts.begin(cards[0].id);
    expect(first.isCurrent()).toBe(false);
    expect(first.signal.aborted).toBe(true);
    expect(second.isCurrent()).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(next.isCurrent()).toBe(true);
    expect(tasks.size).toBe(1);
    attempts.invalidateAll();
    expect(tasks.size).toBe(0);
  });
});
