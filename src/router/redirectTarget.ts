/**
 * Where to return after the login screen. ProtectedRoute stores the full location, so a reload
 * on a filtered or deep-linked route (e.g. `?provider=claude`) lands back on the same view.
 */
export function redirectTargetFrom(state: unknown, fallback = '/'): string {
  if (typeof state !== 'object' || state === null || !('from' in state)) return fallback;
  const from = (state as { from?: unknown }).from;
  if (typeof from !== 'object' || from === null) return fallback;
  const { pathname, search, hash } = from as {
    pathname?: unknown;
    search?: unknown;
    hash?: unknown;
  };
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname === '/login') {
    return fallback;
  }
  const query = typeof search === 'string' && search.startsWith('?') ? search : '';
  const fragment = typeof hash === 'string' && hash.startsWith('#') ? hash : '';
  return `${pathname}${query}${fragment}`;
}
