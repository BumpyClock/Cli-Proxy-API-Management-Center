import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assertProviderSources, providersApi, type ProviderChange } from '@/services/api/providers';
import { guardConfigConnection } from '@/services/api/configValue';
import { getErrorMessage } from '@/utils/helpers';
import { useAuthStore, useConfigStore } from '@/stores';
import {
  stripDisableAllModelsRule,
  withDisableAllModelsRule,
  withoutDisableAllModelsRule,
} from '@/components/providers/utils';
import type {
  CloakConfig,
  Config,
  GeminiKeyConfig,
  ModelAlias,
  OpenAIProviderConfig,
  ProviderKeyConfig,
} from '@/types';
import {
  apiKeyFunToResource,
  claudeToResource,
  codexToResource,
  fennoAIToResource,
  geminiToResource,
  interactionsToResource,
  metaToResource,
  openaiToResource,
  qiniuCloudToResource,
  kimiToResource,
  vertexToResource,
  xaiToResource,
} from './adapters';
import { PROVIDER_BRAND_ORDER } from './descriptors';
import { buildThinkingFromLevels } from './thinkingLevels';
import type {
  ProviderBrand,
  ProviderEntryFormInput,
  ProviderGroup,
  ProviderResource,
  ProviderSnapshot,
  SponsorKeyEntryInput,
  SponsorProviderBrand,
  SponsorProviderRaw,
  ProviderEditOrigin,
} from './types';
import {
  buildApiKeyFunRaw,
  isApiKeyFunClaudeProvider,
  isApiKeyFunCodexProvider,
  isApiKeyFunOpenAIProvider,
} from './sponsor';
import { buildFennoAIRaw, isFennoAIClaudeProvider, isFennoAICodexProvider } from './fennoAI';
import {
  buildQiniuCloudRaw,
  isQiniuCloudClaudeProvider,
  isQiniuCloudCodexProvider,
  isQiniuCloudGeminiProvider,
  isQiniuCloudOpenAIProvider,
} from './qiniuCloud';
import {
  buildKimiRaw,
  isKimiClaudeProvider,
  isKimiCodexProvider,
  isKimiOpenAIProvider,
} from './kimi';
import {
  getSponsorAggregationConflict,
  getSponsorProviderDefinition,
  isMultiProtocolSponsorBrand,
  sponsorProtocolUrl,
  type SponsorProtocolUrls,
} from './sponsorDefinitions';

export interface UseProviderWorkbenchResult {
  connected: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  errorMessage: string | null;
  snapshot: ProviderSnapshot | null;
  refetch: () => Promise<void>;

  createProvider: (
    brand: ProviderBrand,
    input: ProviderEntryFormInput,
    origin?: ProviderEditOrigin
  ) => Promise<void>;
  updateProvider: (
    resource: ProviderResource,
    input: ProviderEntryFormInput,
    origin?: ProviderEditOrigin
  ) => Promise<void>;
  deleteProvider: (resource: ProviderResource, assertConnection?: () => void) => Promise<void>;
  toggleDisabled: (resource: ProviderResource, disabled: boolean) => Promise<void>;
  mutating: boolean;
  refreshSnapshot: () => void;
}

/* -------------------------------------------------------------------------- */
/* form -> backend config 转换                                                 */
/* -------------------------------------------------------------------------- */

const parseTextList = (text: string): string[] =>
  text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const headersFromEntries = (
  entries: Array<{ key: string; value: string }>
): Record<string, string> => {
  const out: Record<string, string> = {};
  entries.forEach((entry) => {
    const key = entry.key.trim();
    if (!key) return;
    out[key] = entry.value;
  });
  return out;
};

const parseThinkingJson = (value: string | undefined): Record<string, unknown> | undefined => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Thinking config must be a JSON object');
  }
  return parsed as Record<string, unknown>;
};

/**
 * `'*'` 是「该 provider 已停用」的编码，其唯一所有者是 `form.disabled`：
 * 载入时 `stripDisableAllModelsRule` 把它剥进该 flag，保存时仅凭该 flag 重新追加。
 * 因此这里必须过滤掉用户在文本里手打的 `'*'`——排除模型的编辑面永远不该能开关停用。
 * 导出仅为让 tests/providerExcludedModelsDisableRule.test.ts 钉住这个不变量。
 */
export const buildExcludedModels = (
  textValue: string,
  disabled: boolean,
  brand: ProviderBrand
): string[] | undefined => {
  const list = parseTextList(textValue);
  const filtered = list.filter((v) => v !== '*');
  if (brand === 'openaiCompatibility') {
    return filtered.length ? filtered : undefined;
  }
  if (disabled) {
    return withDisableAllModelsRule(filtered);
  }
  return filtered.length ? filtered : undefined;
};

export const resolveFlag = (checked: boolean | undefined, existing: boolean | undefined) =>
  checked === true ? true : existing === undefined ? undefined : false;

const buildModelAliases = (
  models: ProviderEntryFormInput['models'] | undefined,
  includeImage = false
): ModelAlias[] => {
  const rows = (models ?? []).map((m) => ({ ...m, name: m.name.trim() })).filter((m) => m.name);
  return rows.map((m) => {
    const entry: ModelAlias = {
      sourceIndex: m.sourceIndex,
      name: m.name,
      alias: m.alias?.trim() || undefined,
      thinking: m.thinkingLevelsTouched
        ? buildThinkingFromLevels(m.thinkingLevels)
        : parseThinkingJson(m.thinkingJson),
    };
    if (includeImage) {
      entry.image = m.image === true;
    }
    return entry;
  });
};

export const buildProviderKeyConfig = (
  brand: 'gemini' | 'interactions' | 'codex' | 'meta' | 'xai' | 'claude' | 'vertex',
  input: ProviderEntryFormInput,
  existing?: ProviderKeyConfig | GeminiKeyConfig | null
): ProviderKeyConfig | GeminiKeyConfig => {
  const headers = headersFromEntries(input.headers);
  const models = buildModelAliases(input.models, false);
  const excluded = buildExcludedModels(input.excludedModelsText, input.disabled, brand);
  const apiKeyChanged = input.apiKey.trim().length > 0;
  const next: ProviderKeyConfig = {
    source: existing?.source,
    apiKey: apiKeyChanged ? input.apiKey.trim() : (existing?.apiKey ?? ''),
    priority: input.priority,
    weight: input.weight,
    prefix: input.prefix.trim() || undefined,
    baseUrl: input.baseUrl.trim() || undefined,
    proxyUrl: input.proxyUrl.trim() || undefined,
    models: models.length ? models : undefined,
    headers: Object.keys(headers).length ? headers : undefined,
    excludedModels: excluded,
    disableCooling: resolveFlag(input.disableCooling, existing?.disableCooling),
    authIndex: existing?.authIndex,
  };
  if ((brand === 'codex' || brand === 'xai') && input.websockets !== undefined) {
    next.websockets = resolveFlag(input.websockets, (existing as ProviderKeyConfig)?.websockets);
  }
  if (brand === 'claude' && input.cloak) {
    const existingCloak = (existing as ProviderKeyConfig | null | undefined)?.cloak;
    const cloak: CloakConfig = {
      mode: input.cloak.mode.trim() || undefined,
      strictMode: resolveFlag(input.cloak.strictMode, existingCloak?.strictMode),
      sensitiveWords: parseTextList(input.cloak.sensitiveWordsText),
      cacheUserId: input.cloak.cacheUserId === true,
    };
    if (
      existingCloak ||
      cloak.mode ||
      cloak.strictMode !== undefined ||
      cloak.sensitiveWords?.length ||
      cloak.cacheUserId
    ) {
      next.cloak = cloak;
    }
  }
  if (brand === 'claude') {
    next.fingerprintProfile = input.fingerprintProfile?.trim() || undefined;
  }
  return next;
};

export const buildOpenAIConfig = (
  input: ProviderEntryFormInput,
  existing?: OpenAIProviderConfig | null
): OpenAIProviderConfig => {
  const headers = headersFromEntries(input.headers);
  const models = buildModelAliases(input.models, true);
  const apiKeyEntries = (input.apiKeyEntries ?? [])
    .map((entry) => {
      const fallbackApiKey = entry.existingApiKey?.trim() || '';
      return {
        sourceIndex: entry.sourceIndex,
        apiKey: entry.apiKey.trim() || fallbackApiKey,
        proxyUrl: entry.proxyUrl.trim() || undefined,
        weight: entry.weight,
        authIndex: entry.authIndex?.trim() || undefined,
      };
    })
    .filter((entry) => entry.apiKey);

  return {
    ...(existing ?? {}),
    name: input.name.trim(),
    baseUrl: input.baseUrl.trim(),
    prefix: input.prefix.trim() || undefined,
    apiKeyEntries,
    disabled: resolveFlag(input.disabled, existing?.disabled),
    disableCooling: resolveFlag(input.disableCooling, existing?.disableCooling),
    headers: Object.keys(headers).length ? headers : undefined,
    models: models.length ? models : undefined,
    priority: input.priority,
  };
};

const sponsorEntryApiKey = (entry: SponsorKeyEntryInput): string =>
  entry.apiKey.trim() || entry.existingApiKey?.trim() || '';

const buildSponsorOpenAIConfig = (
  entry: SponsorKeyEntryInput,
  providerName: string,
  getProtocolUrls: (value: string | undefined | null) => SponsorProtocolUrls,
  existing?: OpenAIProviderConfig
): OpenAIProviderConfig => {
  const urls = getProtocolUrls(entry.baseUrl);
  const models = buildModelAliases(entry.models, true);
  const apiKey = sponsorEntryApiKey(entry);
  const firstExistingEntry = existing?.apiKeyEntries?.[0];
  const apiKeyEntries = apiKey
    ? [
        {
          ...(entry.existingApiKey ? firstExistingEntry : undefined),
          apiKey,
          proxyUrl: entry.proxyUrl.trim() || undefined,
          weight: entry.weight,
        },
      ]
    : [];

  return {
    ...(existing ?? {}),
    name: providerName,
    baseUrl: urls.openai,
    prefix: entry.prefix.trim() || undefined,
    disabled: resolveFlag(entry.disabled, existing?.disabled),
    disableCooling: resolveFlag(entry.disableCooling, existing?.disableCooling),
    priority: entry.priority,
    apiKeyEntries,
    models: models.length ? models : undefined,
  };
};

const buildSponsorProviderKeyConfig = (
  entry: SponsorKeyEntryInput,
  protocol: 'claude' | 'codex' | 'gemini',
  getProtocolUrls: (value: string | undefined | null) => SponsorProtocolUrls,
  existing?: ProviderKeyConfig
): ProviderKeyConfig => {
  const urls = getProtocolUrls(entry.baseUrl);
  const models = buildModelAliases(entry.models, false);
  const apiKey = sponsorEntryApiKey(entry);
  const excluded = entry.disabled
    ? withDisableAllModelsRule(stripDisableAllModelsRule(existing?.excludedModels))
    : withoutDisableAllModelsRule(existing?.excludedModels);

  return {
    ...(existing ?? {}),
    apiKey,
    baseUrl: sponsorProtocolUrl(urls, protocol),
    proxyUrl: entry.proxyUrl.trim() || undefined,
    prefix: entry.prefix.trim() || undefined,
    priority: entry.priority,
    weight: entry.weight,
    disableCooling: resolveFlag(entry.disableCooling, existing?.disableCooling),
    excludedModels: excluded,
    models: models.length ? models : undefined,
  };
};

const sponsorAggregates = {
  apikeyFun: buildApiKeyFunRaw,
  fennoAI: buildFennoAIRaw,
  qiniuCloud: buildQiniuCloudRaw,
  kimi: buildKimiRaw,
};

const sponsorFamily = {
  openai: 'openai-compatibility',
  gemini: 'gemini',
  codex: 'codex',
  claude: 'claude',
} as const;

const withDisabled = (config: ProviderKeyConfig, disabled: boolean): ProviderKeyConfig => ({
  ...config,
  excludedModels: disabled
    ? withDisableAllModelsRule(config.excludedModels)
    : withoutDisableAllModelsRule(config.excludedModels),
});

type SponsorChange =
  | { type: 'save'; input: ProviderEntryFormInput }
  | { type: 'delete' }
  | { type: 'toggle'; disabled: boolean };

export const writeSponsor = (
  brand: SponsorProviderBrand,
  expected: SponsorProviderRaw | null,
  assertConnection: () => void,
  change: SponsorChange
) => {
  const definition = getSponsorProviderDefinition(brand);
  return providersApi.writeAggregate(
    definition.protocols.map((protocol) => sponsorFamily[protocol]),
    assertConnection,
    (config) => {
      const current = sponsorAggregates[brand](config);
      for (const protocol of definition.protocols) {
        assertProviderSources(current[protocol], expected?.[protocol] ?? []);
      }
      if (change.type === 'save' && getSponsorAggregationConflict(current)) {
        throw new Error('Provider configuration is ambiguous; refresh and try again.');
      }
      const entries =
        change.type === 'save'
          ? (change.input.sponsorKeyEntries ?? []).filter(sponsorEntryApiKey)
          : [];
      const requestedProtocols = new Set(entries.map((entry) => entry.protocol));
      if (
        requestedProtocols.size !== entries.length ||
        entries.some((entry) => !definition.protocols.includes(entry.protocol))
      ) {
        throw new Error('Invalid sponsor provider protocols.');
      }
      return definition.protocols.flatMap((protocol): ProviderChange[] => {
        const family = sponsorFamily[protocol];
        const entry = entries.find((item) => item.protocol === protocol);
        if (protocol === 'openai') {
          const rows = current.openai;
          if (entry) {
            const original = rows[0];
            return [
              {
                type: original ? 'update' : 'create',
                family: 'openai-compatibility',
                config: buildSponsorOpenAIConfig(
                  entry,
                  definition.providerName,
                  definition.getProtocolUrls,
                  original
                ),
              },
            ];
          }
          return rows.map((row) =>
            change.type === 'toggle'
              ? {
                  type: 'update',
                  family: 'openai-compatibility',
                  config: { ...row, disabled: change.disabled },
                }
              : { type: 'delete', family, source: row.source }
          );
        }

        const rows = current[protocol];
        if (entry) {
          const original = rows[0];
          return [
            {
              type: original ? 'update' : 'create',
              family: protocol,
              config: buildSponsorProviderKeyConfig(
                entry,
                protocol,
                definition.getProtocolUrls,
                original
              ),
            },
          ];
        }
        return rows.map((row) =>
          change.type === 'toggle'
            ? { type: 'update', family: protocol, config: withDisabled(row, change.disabled) }
            : { type: 'delete', family, source: row.source }
        );
      });
    }
  );
};

export const buildProviderGroups = (config: Config): ProviderGroup[] =>
  PROVIDER_BRAND_ORDER.reduce<ProviderGroup[]>((groups, brand) => {
    let resources: ProviderResource[];
    switch (brand) {
      case 'gemini':
        resources = (config.geminiApiKeys ?? []).reduce<ProviderResource[]>((out, item, index) => {
          if (!isQiniuCloudGeminiProvider(item)) {
            out.push(geminiToResource(item, index));
          }
          return out;
        }, []);
        break;
      case 'interactions':
        resources = (config.interactionsApiKeys ?? []).map((item, index) =>
          interactionsToResource(item, index)
        );
        break;
      case 'codex':
        resources = (config.codexApiKeys ?? []).reduce<ProviderResource[]>((out, item, index) => {
          if (
            !isApiKeyFunCodexProvider(item) &&
            !isFennoAICodexProvider(item) &&
            !isQiniuCloudCodexProvider(item) &&
            !isKimiCodexProvider(item)
          ) {
            out.push(codexToResource(item, index));
          }
          return out;
        }, []);
        break;
      case 'meta':
        resources = (config.metaApiKeys ?? []).map((item, index) => metaToResource(item, index));
        break;
      case 'xai':
        resources = (config.xaiApiKeys ?? []).map((item, index) => xaiToResource(item, index));
        break;
      case 'claude':
        resources = (config.claudeApiKeys ?? []).reduce<ProviderResource[]>((out, item, index) => {
          if (
            !isApiKeyFunClaudeProvider(item) &&
            !isFennoAIClaudeProvider(item) &&
            !isQiniuCloudClaudeProvider(item) &&
            !isKimiClaudeProvider(item)
          ) {
            out.push(claudeToResource(item, index));
          }
          return out;
        }, []);
        break;
      case 'vertex':
        resources = (config.vertexApiKeys ?? []).map((item, index) =>
          vertexToResource(item, index)
        );
        break;
      case 'openaiCompatibility':
        resources = (config.openaiCompatibility ?? []).reduce<ProviderResource[]>(
          (out, item, index) => {
            if (
              !isApiKeyFunOpenAIProvider(item) &&
              !isQiniuCloudOpenAIProvider(item) &&
              !isKimiOpenAIProvider(item)
            ) {
              out.push(openaiToResource(item, index));
            }
            return out;
          },
          []
        );
        break;
      case 'apikeyFun': {
        const sponsorResource = apiKeyFunToResource(buildApiKeyFunRaw(config));
        resources = sponsorResource ? [sponsorResource] : [];
        break;
      }
      case 'fennoAI': {
        const sponsorResource = fennoAIToResource(buildFennoAIRaw(config));
        resources = sponsorResource ? [sponsorResource] : [];
        break;
      }
      case 'qiniuCloud': {
        const sponsorResource = qiniuCloudToResource(buildQiniuCloudRaw(config));
        resources = sponsorResource ? [sponsorResource] : [];
        break;
      }
      case 'kimi': {
        const sponsorResource = kimiToResource(buildKimiRaw(config));
        resources = sponsorResource ? [sponsorResource] : [];
        break;
      }
      default:
        return groups;
    }
    groups.push({
      id: brand,
      resources,
    });
    return groups;
  }, []);

/* -------------------------------------------------------------------------- */
/* hook                                                                       */
/* -------------------------------------------------------------------------- */

const refreshAfterMutation = (refetch: () => Promise<void>) => {
  useConfigStore.getState().invalidateCache();
  return refetch();
};

export function useProviderWorkbench(): UseProviderWorkbenchResult {
  const connectionStatus = useAuthStore((s) => s.connectionStatus);
  const config = useConfigStore((s) => s.config);
  const fetchConfig = useConfigStore((s) => s.fetchConfig);
  const isCacheValid = useConfigStore((s) => s.isCacheValid);

  const [isPending, setIsPending] = useState<boolean>(() => !isCacheValid());
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mutating, setMutating] = useState<boolean>(false);
  const [fetchedAt, setFetchedAt] = useState<string>(() => new Date().toISOString());

  const hasFetchedRef = useRef(false);

  const connected = connectionStatus === 'connected';

  const refetch = useCallback(async () => {
    setIsFetching(true);
    setErrorMessage(null);
    try {
      // The config store owns full snapshots and discards superseded requests.
      await fetchConfig(true);
      setFetchedAt(new Date().toISOString());
    } catch (err) {
      setErrorMessage(getErrorMessage(err) || 'Failed to load providers');
    } finally {
      setIsPending(false);
      setIsFetching(false);
    }
  }, [fetchConfig]);

  const refreshSnapshot = useCallback(() => {
    setFetchedAt(new Date().toISOString());
  }, []);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    if (!connected) return;
    hasFetchedRef.current = true;
    refetch().catch(() => {});
  }, [connected, refetch]);

  /* ------------------- snapshot 计算 ------------------- */

  const snapshot = useMemo<ProviderSnapshot | null>(() => {
    if (!config) return null;
    return {
      fetchedAt,
      groups: buildProviderGroups(config),
    };
  }, [config, fetchedAt]);

  /* ------------------- mutations ------------------- */

  const runMutation = useCallback(
    async (write: () => Promise<void>) => {
      const assertConnection = guardConfigConnection();
      setMutating(true);
      try {
        await write();
        assertConnection();
        await refreshAfterMutation(refetch);
      } finally {
        setMutating(false);
      }
    },
    [refetch]
  );

  const createProvider: UseProviderWorkbenchResult['createProvider'] = useCallback(
    (brand, input, origin) =>
      runMutation(() => {
        const type = 'create';
        if (isMultiProtocolSponsorBrand(brand)) {
          return writeSponsor(brand, null, origin?.assertConnection ?? guardConfigConnection(), {
            type: 'save',
            input,
          });
        }
        return providersApi.writeFamily(
          brand === 'openaiCompatibility'
            ? { type, family: 'openai-compatibility', config: buildOpenAIConfig(input) }
            : { type, family: brand, config: buildProviderKeyConfig(brand, input) }
        );
      }),
    [runMutation]
  );

  const updateProvider: UseProviderWorkbenchResult['updateProvider'] = useCallback(
    (resource, input, origin) =>
      runMutation(() => {
        const type = 'update';
        const { brand, raw } = resource;
        if (isMultiProtocolSponsorBrand(brand)) {
          return writeSponsor(
            brand,
            raw as SponsorProviderRaw,
            origin?.assertConnection ?? guardConfigConnection(),
            {
              type: 'save',
              input,
            }
          );
        }
        return providersApi.writeFamily(
          brand === 'openaiCompatibility'
            ? {
                type,
                family: 'openai-compatibility',
                config: buildOpenAIConfig(input, raw as OpenAIProviderConfig),
              }
            : {
                type,
                family: brand,
                config: buildProviderKeyConfig(brand, input, raw as ProviderKeyConfig),
              }
        );
      }),
    [runMutation]
  );

  const deleteProvider: UseProviderWorkbenchResult['deleteProvider'] = useCallback(
    (resource, assertConnection = guardConfigConnection()) =>
      runMutation(() => {
        assertConnection();
        const { brand, raw } = resource;
        if (isMultiProtocolSponsorBrand(brand)) {
          return writeSponsor(brand, raw as SponsorProviderRaw, assertConnection, {
            type: 'delete',
          });
        }
        return providersApi.writeFamily({
          type: 'delete',
          family: brand === 'openaiCompatibility' ? 'openai-compatibility' : brand,
          source: (raw as ProviderKeyConfig | OpenAIProviderConfig).source,
        });
      }),
    [runMutation]
  );

  const toggleDisabled: UseProviderWorkbenchResult['toggleDisabled'] = useCallback(
    (resource, disabled) =>
      runMutation(() => {
        const { brand, raw } = resource;
        if (isMultiProtocolSponsorBrand(brand)) {
          return writeSponsor(brand, raw as SponsorProviderRaw, guardConfigConnection(), {
            type: 'toggle',
            disabled,
          });
        }
        return providersApi.writeFamily(
          brand === 'openaiCompatibility'
            ? {
                type: 'update',
                family: 'openai-compatibility',
                config: { ...(raw as OpenAIProviderConfig), disabled },
              }
            : {
                type: 'update',
                family: brand,
                config: withDisabled(raw as ProviderKeyConfig, disabled),
              }
        );
      }),
    [runMutation]
  );

  return {
    connected,
    isPending,
    isFetching,
    isError: Boolean(errorMessage),
    errorMessage,
    snapshot,
    refetch,
    createProvider,
    updateProvider,
    deleteProvider,
    toggleDisabled,
    mutating,
    refreshSnapshot,
  };
}
