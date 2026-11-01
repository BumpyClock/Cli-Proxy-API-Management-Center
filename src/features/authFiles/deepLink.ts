import { normalizeProviderKey } from './constants';
import { isAuthFilesStatusFilterMode, type AuthFilesStatusFilterMode } from './uiState';

/**
 * Links into the auth files page with filters applied, e.g. from a dashboard alert
 * straight to the failing credential. Deep-link values override the persisted filters
 * once on arrival and are then removed from the URL.
 */
export interface AuthFilesDeepLink {
  provider?: string;
  status?: AuthFilesStatusFilterMode;
  search?: string;
}

const MAX_SEARCH_LENGTH = 200;

export function buildAuthFilesHref(link: AuthFilesDeepLink = {}): string {
  const params = new URLSearchParams();
  const provider = link.provider ? normalizeProviderKey(link.provider) : '';
  if (provider && provider !== 'all') params.set('provider', provider);
  if (link.status) params.set('status', link.status);
  const search = link.search?.trim();
  if (search) params.set('search', search.slice(0, MAX_SEARCH_LENGTH));
  const query = params.toString();
  return query ? `/auth-files?${query}` : '/auth-files';
}

/** Null when the URL carries no deep-link parameters. */
export function parseAuthFilesDeepLink(params: URLSearchParams): AuthFilesDeepLink | null {
  const provider = normalizeProviderKey(params.get('provider') ?? '');
  const status = params.get('status');
  const search = (params.get('search') ?? '').trim().slice(0, MAX_SEARCH_LENGTH);

  const link: AuthFilesDeepLink = {};
  if (provider) link.provider = provider;
  if (isAuthFilesStatusFilterMode(status)) link.status = status;
  if (search) link.search = search;
  return Object.keys(link).length > 0 ? link : null;
}

export const AUTH_FILES_DEEP_LINK_KEYS = ['provider', 'status', 'search'] as const;
