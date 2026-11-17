import { apiClient } from './client';
import { guardConfigConnection, readConfigResource } from './configValue';
import { isRecord } from '@/utils/helpers';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';

type OauthMap = Record<string, unknown>;
const writes = new Map<string, Promise<void>>();

export function oauthProviderKey(provider: string): string {
  const key = normalizeOAuthProviderKey(provider);
  if (!key) throw new Error('Invalid OAuth provider');
  return key;
}

export function oauthProviderEntries(map: OauthMap, key: string) {
  return Object.entries(map).filter(([provider]) => normalizeOAuthProviderKey(provider) === key);
}

export function replaceOauthProvider(map: OauthMap, key: string, value?: unknown): void {
  for (const [provider] of oauthProviderEntries(map, key)) delete map[provider];
  if (value !== undefined) {
    Object.defineProperty(map, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
}

async function readOauthMap(path: string) {
  const { value, replace } = await readConfigResource(path, {});
  if (!isRecord(value)) throw new Error('Invalid OAuth configuration map');
  return { value, replace };
}

// Each path is one replacement resource, even when edits target different providers.
export function updateOauthMap(path: string, update: (map: OauthMap) => boolean): Promise<void> {
  const assertConnection = guardConfigConnection();
  const queueKey = `${apiClient.getConnectionRevision()}:${path}`;
  const pending = (writes.get(queueKey) ?? Promise.resolve()).then(async () => {
    assertConnection();
    const resource = await readOauthMap(path);
    const next = { ...resource.value };
    if (update(next)) await resource.replace(next);
  });
  const settled = pending.then(
    () => undefined,
    () => undefined
  );
  writes.set(queueKey, settled);
  void settled.then(() => {
    if (writes.get(queueKey) === settled) writes.delete(queueKey);
  });
  return pending;
}

export async function editOauthMap<T>(
  path: string,
  normalize: (map: OauthMap) => Record<string, T[]>,
  serialize: (entries: T[], provider: string, original: unknown[]) => unknown[]
) {
  const assertConnection = guardConfigConnection();
  const { value: baseline } = await readOauthMap(path);
  return {
    values: normalize(baseline),
    async save(provider: string, entries: T[]): Promise<void> {
      assertConnection();
      const key = oauthProviderKey(provider);
      const original = JSON.stringify(oauthProviderEntries(baseline, key));
      await updateOauthMap(path, (map) => {
        const current = oauthProviderEntries(map, key);
        if (JSON.stringify(current) !== original) {
          throw Object.assign(new Error('precondition_failed'), {
            status: 412,
            apiCode: 'precondition_failed',
          });
        }
        const next = serialize(
          entries,
          key,
          current.map(([, value]) => value)
        );
        if (next.length === 0 && current.length === 0) return false;
        replaceOauthProvider(map, key, next.length ? next : undefined);
        return true;
      });
    },
  };
}
