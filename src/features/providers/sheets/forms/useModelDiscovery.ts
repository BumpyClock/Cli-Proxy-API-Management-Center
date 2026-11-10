import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { modelsApi } from '@/services/api';
import { buildHeaderObject } from '@/utils/headers';
import { getErrorMessage } from '@/utils/helpers';
import { resolveProbeProxyUrl } from './probeProxy';
import type { ModelInfo } from '@/utils/models';
import type { ApiKeyEntryInput, ProviderBrand } from '../../types';

export const MODEL_DISCOVERY_BRANDS: ReadonlyArray<ProviderBrand> = [
  'gemini',
  'interactions',
  'codex',
  'meta',
  'xai',
  'claude',
  'openaiCompatibility',
];

export const isModelDiscoveryBrand = (brand: ProviderBrand): boolean =>
  MODEL_DISCOVERY_BRANDS.includes(brand);

export interface UseModelDiscoveryArgs {
  brand: ProviderBrand;
  baseUrl: string;
  proxyUrl?: string;
  formHeaders: Array<{ key: string; value: string }>;
  apiKeyEntries?: ApiKeyEntryInput[];
  apiKey?: string;
  fallbackApiKey?: string;
  authIndex?: string;
}

export interface UseModelDiscoveryResult {
  available: boolean;
  loading: boolean;
  error: string | null;
  models: ModelInfo[];
  hasFetched: boolean;
  fetch: () => Promise<void>;
  reset: () => void;
}

export function useModelDiscovery(args: UseModelDiscoveryArgs): UseModelDiscoveryResult {
  const {
    brand,
    baseUrl,
    proxyUrl,
    formHeaders,
    apiKeyEntries,
    apiKey,
    fallbackApiKey,
    authIndex,
  } = args;

  const available = isModelDiscoveryBrand(brand);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [hasFetched, setHasFetched] = useState(false);

  const fetch = useCallback(async () => {
    if (!available) return;
    setLoading(true);
    setError(null);
    try {
      const baseHeaders = buildHeaderObject(formHeaders);
      const resolvedAuthIndex = (authIndex ?? '').trim() || undefined;
      const probeProxyUrl = resolveProbeProxyUrl(proxyUrl);
      let next: ModelInfo[] = [];
      if (brand === 'gemini' || brand === 'interactions') {
        const key = (apiKey ?? '').trim() || (fallbackApiKey ?? '').trim();
        next = await modelsApi.fetchGeminiModelsViaApiCall(
          baseUrl,
          key,
          baseHeaders,
          resolvedAuthIndex,
          probeProxyUrl
        );
      } else if (brand === 'codex' || brand === 'meta' || brand === 'xai') {
        const key = (apiKey ?? '').trim() || (fallbackApiKey ?? '').trim();
        next = await modelsApi.fetchV1ModelsViaApiCall(
          baseUrl,
          key,
          baseHeaders,
          resolvedAuthIndex,
          probeProxyUrl
        );
      } else if (brand === 'claude') {
        const key = (apiKey ?? '').trim() || (fallbackApiKey ?? '').trim();
        next = await modelsApi.fetchClaudeModelsViaApiCall(
          baseUrl,
          key,
          baseHeaders,
          resolvedAuthIndex,
          probeProxyUrl
        );
      } else if (brand === 'openaiCompatibility') {
        const entries = apiKeyEntries ?? [];
        const firstEntry =
          entries.find(
            (e) =>
              (e.apiKey ?? '').trim() ||
              (e.existingApiKey ?? '').trim() ||
              (e.authIndex ?? '').trim()
          ) ?? entries[0];
        const entryProxyUrl = resolveProbeProxyUrl(firstEntry?.proxyUrl);
        const entryKey =
          (firstEntry?.apiKey ?? '').trim() || (firstEntry?.existingApiKey ?? '').trim();
        const entryAuthIndex = (firstEntry?.authIndex ?? '').trim() || resolvedAuthIndex;
        try {
          next = await modelsApi.fetchModelsViaApiCall(
            baseUrl,
            entryKey,
            baseHeaders,
            entryAuthIndex,
            entryProxyUrl
          );
        } catch (firstErr) {
          // Some OpenAI-compatible endpoints expose /models without auth, or
          // reject the configured key for the discovery route. Retry once
          // without any auth/headers before surfacing the original error.
          try {
            next = await modelsApi.fetchModelsViaApiCall(
              baseUrl,
              undefined,
              undefined,
              undefined,
              entryProxyUrl
            );
          } catch {
            throw firstErr;
          }
        }
      }
      setModels(next ?? []);
      setHasFetched(true);
    } catch (err) {
      setModels([]);
      setError(getErrorMessage(err) || 'Failed to fetch models');
      setHasFetched(true);
    } finally {
      setLoading(false);
    }
  }, [
    available,
    apiKey,
    apiKeyEntries,
    authIndex,
    baseUrl,
    brand,
    fallbackApiKey,
    formHeaders,
    proxyUrl,
  ]);

  const reset = useCallback(() => {
    setModels([]);
    setError(null);
    setLoading(false);
    setHasFetched(false);
  }, []);

  const inputSignature = useMemo(() => {
    const headerSig = formHeaders.map((h) => `${h.key}:${h.value}`).join('|');
    const entriesSig = (apiKeyEntries ?? [])
      .map(
        (e) =>
          `${e.apiKey ?? ''}::${e.existingApiKey ?? ''}::${e.authIndex ?? ''}::${e.proxyUrl ?? ''}`
      )
      .join('|');
    return [
      baseUrl,
      proxyUrl ?? '',
      apiKey ?? '',
      fallbackApiKey ?? '',
      authIndex ?? '',
      headerSig,
      entriesSig,
    ].join('||');
  }, [apiKey, apiKeyEntries, authIndex, baseUrl, fallbackApiKey, formHeaders, proxyUrl]);

  const lastSignatureRef = useRef(inputSignature);
  useEffect(() => {
    if (lastSignatureRef.current === inputSignature) return;
    lastSignatureRef.current = inputSignature;
    reset();
  }, [inputSignature, reset]);

  return { available, loading, error, models, hasFetched, fetch, reset };
}
