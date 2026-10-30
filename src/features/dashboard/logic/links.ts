import { buildAuthFilesHref } from '@/features/authFiles/deepLink';
import type { ProviderHealth } from '../types';

/** Provider row target: its credentials on the auth files page, or provider settings for API keys. */
export function providerHref(provider: ProviderHealth): string {
  return provider.credentials.total > 0
    ? buildAuthFilesHref({ provider: provider.id, status: 'all' })
    : '/ai-providers';
}

/** Link to the failing credentials of one provider, narrowed to a single file when possible. */
export function providerCredentialsHref(provider: ProviderHealth): string {
  const only = provider.problemCredentials.length === 1 ? provider.problemCredentials[0] : null;
  return buildAuthFilesHref({
    provider: provider.id,
    status: provider.problemCredentials.length > 0 ? 'problem' : 'all',
    search: only?.name,
  });
}
