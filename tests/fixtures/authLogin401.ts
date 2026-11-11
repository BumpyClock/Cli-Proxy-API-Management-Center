import assert from 'node:assert/strict';

let server: ReturnType<typeof Bun.serve> | undefined;
try {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      location: new URL('https://management.invalid/management.html'),
    }),
  });
  const items = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
    },
  });
  const { useAuthStore } = await import('../../src/stores/useAuthStore');
  const { apiClient } = await import('../../src/services/api/client');
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => Response.json({ error: 'invalid management key' }, { status: 401 }),
  });
  const credentials = {
    apiBase: `http://127.0.0.1:${server.port}`,
    managementKey: 'fixture-wrong-key',
  };
  let failure: unknown;
  try {
    await useAuthStore.getState().login(credentials);
  } catch (error) {
    failure = error;
  }
  assert(
    failure instanceof Error && 'status' in failure && failure.status === 401,
    'Login must preserve the original HTTP 401.'
  );
  assert.equal(useAuthStore.getState().connectionStatus, 'error');
  assert.equal(useAuthStore.getState().isAuthenticated, false);
  console.log('PASS wrong-key login retains a visible 401 failure');

  useAuthStore.setState({ ...credentials, isAuthenticated: true, connectionStatus: 'connected' });
  const revision = apiClient.getConnectionRevision();
  try {
    await apiClient.get('/config');
  } catch {
    /* Expected fixture 401. */
  }
  assert.equal(useAuthStore.getState().isAuthenticated, false);
  assert.equal(useAuthStore.getState().connectionStatus, 'disconnected');
  assert(apiClient.getConnectionRevision() > revision);
  console.log('PASS authenticated-session 401 still logs out and clears transport');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Integrated 401 regression failed.');
  process.exitCode = 1;
} finally {
  server?.stop(true);
}
