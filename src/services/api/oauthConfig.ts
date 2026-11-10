import { apiClient } from './client';
import { guardConfigConnection, readConfigResource } from './configValue';
import { isRecord } from '@/utils/helpers';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';

const writes = new Map<string, Promise<void>>();

// A v8 OAuth map is one replacement resource, even when the UI edits separate providers.
function queueWrite(path: string, write: () => Promise<void>): Promise<void> {
  const assertConnection = guardConfigConnection();
  const queueKey = `${apiClient.getConnectionRevision()}:${path}`;
  const pending = (writes.get(queueKey) ?? Promise.resolve()).then(async () => {
    assertConnection();
    await write();
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

export function updateOauthProviderMap(
  path: string,
  provider: string,
  value?: unknown
): Promise<void> {
  const key = normalizeOAuthProviderKey(provider);
  if (!key) throw new Error('Invalid OAuth provider');
  return queueWrite(path, async () => {
    const resource = await readConfigResource(path, {});
    const current = resource.value;
    if (current != null && !isRecord(current)) throw new Error('Invalid OAuth configuration map');
    const next = Object.fromEntries(
      Object.entries(current ?? {}).filter(([name]) => normalizeOAuthProviderKey(name) !== key)
    );
    if (value !== undefined) {
      Object.defineProperty(next, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    await resource.replace(next);
  });
}
