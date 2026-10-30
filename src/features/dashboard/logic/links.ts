import { buildAuthFilesHref } from '@/features/authFiles/deepLink';
import type { ProviderHealth } from '../types';

/** Dashboard provider ids (backend provider keys) mapped to AI Providers brands. */
const PROVIDER_BRANDS: Record<string, string> = {
  gemini: 'gemini',
  'gemini-interactions': 'interactions',
  interactions: 'interactions',
  codex: 'codex',
  meta: 'meta',
  xai: 'xai',
  claude: 'claude',
  vertex: 'vertex',
  openai: 'openaiCompatibility',
  'openai-compatibility': 'openaiCompatibility',
};

/**
 * AI Providers opened on the provider's brand. API-key providers outside the built-in
 * brands are OpenAI-compatible entries named by the operator.
 */
export function providerSettingsHref(providerId: string): string {
  const brand =
    PROVIDER_BRANDS[providerId] ?? (providerId === 'unknown' ? null : 'openaiCompatibility');
  return brand ? `/ai-providers?brand=${encodeURIComponent(brand)}` : '/ai-providers';
}

/** Logs filtered to lines mentioning the provider. */
export function providerLogsHref(providerId: string): string {
  return providerId && providerId !== 'unknown'
    ? `/logs?search=${encodeURIComponent(providerId)}`
    : '/logs';
}

/** Provider row target: its credentials on the auth files page, or provider settings for API keys. */
export function providerHref(provider: ProviderHealth): string {
  return provider.credentials.total > 0
    ? buildAuthFilesHref({ provider: provider.id, status: 'all' })
    : providerSettingsHref(provider.id);
}

/** Link to the failing credentials of one provider, narrowed to a single file when possible. */
export function providerCredentialsHref(provider: ProviderHealth): string {
  const evidence =
    provider.problemCredentials.length > 0
      ? provider.problemCredentials
      : provider.limitedCredentials;
  const only = evidence.length === 1 ? evidence[0] : null;
  return buildAuthFilesHref({
    provider: provider.id,
    status: provider.problemCredentials.length > 0 ? 'problem' : 'all',
    search: only?.name,
  });
}
