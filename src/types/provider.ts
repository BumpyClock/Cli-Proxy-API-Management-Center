/**
 * AI 提供商相关类型
 * 基于原项目 src/modules/ai-providers.js
 */

export interface ModelAlias {
  /** Persisted model position; null marks a new form row. Never sent to the backend. */
  sourceIndex?: number | null;
  name: string;
  alias?: string;
  priority?: number;
  /** Connectivity-test selection only. v8 has no `test-model` field, so it is never persisted. */
  testModel?: string;
  image?: boolean;
  thinking?: Record<string, unknown>;
}

export interface ApiKeyEntry {
  /** Persisted key position inside its OpenAI-compatible group. Never sent to the backend. */
  sourceIndex?: number;
  apiKey: string;
  proxyUrl?: string;
  weight?: number;
  authIndex?: string;
}

export interface CloakConfig {
  mode?: string;
  strictMode?: boolean;
  sensitiveWords?: string[];
  cacheUserId?: boolean;
}

/**
 * Persisted v8 identity of a provider row. Never derive a group from its endpoint
 * or credential: groups may share both while differing in policy.
 */
export interface ProviderSource {
  /** Complete provider-family list as read, used to detect concurrent changes. */
  groups?: unknown[];
  groupIndex: number;
  /** Position in `group.keys`; absent for OpenAI-compatible groups. */
  keyIndex?: number;
  group: Record<string, unknown>;
}

export interface GeminiKeyConfig {
  source?: ProviderSource;
  apiKey: string;
  priority?: number;
  weight?: number;
  prefix?: string;
  baseUrl?: string;
  proxyUrl?: string;
  models?: ModelAlias[];
  headers?: Record<string, string>;
  excludedModels?: string[];
  disableCooling?: boolean;
  authIndex?: string;
}

export interface ProviderKeyConfig {
  source?: ProviderSource;
  apiKey: string;
  priority?: number;
  weight?: number;
  prefix?: string;
  baseUrl?: string;
  websockets?: boolean;
  proxyUrl?: string;
  headers?: Record<string, string>;
  models?: ModelAlias[];
  excludedModels?: string[];
  disableCooling?: boolean;
  cloak?: CloakConfig;
  fingerprintProfile?: string;
  authIndex?: string;
}

export interface OpenAIProviderConfig {
  source?: ProviderSource;
  name: string;
  prefix?: string;
  baseUrl: string;
  apiKeyEntries: ApiKeyEntry[];
  disabled?: boolean;
  headers?: Record<string, string>;
  models?: ModelAlias[];
  priority?: number;
  disableCooling?: boolean;
  /** Connectivity-test selection only. v8 has no `test-model` field, so it is never persisted. */
  testModel?: string;
  authIndex?: string;
  /** Original index in the backend openai-compatibility group list. */
  sourceIndex?: number;
  [key: string]: unknown;
}
