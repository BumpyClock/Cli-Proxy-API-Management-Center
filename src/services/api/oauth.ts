/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';
import {
  isManagementOAuthProviderKey,
  normalizeManagementOAuthProviderKey,
} from '@/utils/providerKeys';

export type BuiltInOAuthProvider =
  'codex' | 'anthropic' | 'antigravity' | 'kimi' | 'kimi-ai' | 'xai' | 'devin' | 'meta';

export interface OAuthStartResponse {
  url?: string;
  state?: string;
  user_code?: string;
  flow?: string;
  expires_in?: number;
}

interface OAuthStatusResponse {
  status: 'ok' | 'wait' | 'error';
  url?: string;
  user_code?: string;
  error?: string;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

export interface OAuthCancelResponse {
  status: 'ok';
  cancelled: boolean;
}

const WEBUI_SUPPORTED = new Set<string>([
  'codex',
  'claude',
  'antigravity',
  'devin',
  'xai',
  'gitlab',
  'iflow',
]);

const normalizeProviderForManagementPath = (provider: string): string => {
  const key = normalizeManagementOAuthProviderKey(provider);
  if (!isManagementOAuthProviderKey(key)) {
    throw new Error('Invalid OAuth provider');
  }
  return key === 'anthropic' ? 'claude' : key;
};

export const oauthApi = {
  listPlusProviders: async (signal?: AbortSignal): Promise<string[]> => {
    try {
      const response = await apiClient.get<{ providers: string[] }>('/oauth/providers', { signal });
      if (!Array.isArray(response.providers)) throw new Error('Invalid OAuth provider list');
      return response.providers;
    } catch (error: unknown) {
      if ((error as { status?: unknown } | null)?.status === 404) return [];
      throw error;
    }
  },

  startAuth: (provider: string, signal?: AbortSignal, method?: string) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    const params: Record<string, string | boolean> = { provider: providerKey };
    if (WEBUI_SUPPORTED.has(providerKey)) {
      params.is_webui = true;
    }
    if (method) params.method = method;
    return apiClient.get<OAuthStartResponse>('/oauth/auth-url', {
      params,
      ...(signal ? { signal } : {}),
    });
  },

  importProviderCredential: (provider: 'gitlab' | 'iflow', secret: string, signal?: AbortSignal) =>
    apiClient.post(
      '/oauth/import',
      provider === 'gitlab' ? { personal_access_token: secret } : { cookie: secret },
      { params: { provider }, signal }
    ),

  getAuthStatus: (state: string, signal?: AbortSignal) =>
    apiClient.get<OAuthStatusResponse>('/oauth/status', {
      params: { state },
      ...(signal ? { signal } : {}),
    }),

  cancelSession: (state: string, signal?: AbortSignal) =>
    apiClient.delete<OAuthCancelResponse>('/oauth/session', {
      params: { state },
      ...(signal ? { signal } : {}),
    }),

  submitCallback: (provider: string, redirectUrl: string, signal?: AbortSignal) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    return apiClient.post<OAuthCallbackResponse>(
      '/oauth/callback',
      { provider: providerKey, redirect_url: redirectUrl },
      signal ? { signal } : undefined
    );
  },
};
