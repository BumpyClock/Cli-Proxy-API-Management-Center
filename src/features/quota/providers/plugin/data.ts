import type { TFunction } from 'i18next';
import type { AuthFileItem, PluginQuotaGroup, PluginQuotaMetric, PluginQuotaState } from '@/types';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores/useAuthStore';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { isRecord } from '@/utils/helpers';
import { isDisabledAuthFile, isPluginQuotaFile } from '@/utils/quota/validators';
import { observeQuota, observeWindow } from '../observations';
import type { QuotaProviderData } from '../types';

type PluginQuotaData = Pick<PluginQuotaState, 'groups' | 'subscription' | 'summary'>;
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function normalizePluginQuotaSummary(value: unknown): PluginQuotaMetric[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const key = text(entry.key);
    const label = text(entry.label);
    if (!key || !label || typeof entry.value !== 'number' || !Number.isFinite(entry.value)) {
      return [];
    }
    const format =
      entry.format === 'currency' || entry.format === 'number' ? entry.format : undefined;
    const currency = /^[A-Z]{3}$/.test(text(entry.currency)) ? text(entry.currency) : undefined;
    return [
      { key, label, value: entry.value, format, currency, unit: text(entry.unit) || undefined },
    ];
  });
}

/** Generic backend buckets contain no duration; never apply provider-specific window guesses. */
export function normalizePluginQuota(value: unknown): PluginQuotaData {
  const payload = isRecord(value) ? value : {};
  const subscription = isRecord(payload.subscription) ? payload.subscription : {};
  const groups: PluginQuotaGroup[] = Array.isArray(payload.groups)
    ? payload.groups.flatMap((entry, groupIndex) => {
        if (!isRecord(entry) || !Array.isArray(entry.buckets)) return [];
        const buckets = entry.buckets.flatMap((bucket, index) => {
          if (!isRecord(bucket)) return [];
          const fraction = bucket.remainingFraction ?? bucket.remaining_fraction;
          const reset = text(bucket.resetTime ?? bucket.reset_time);
          const resetAtMs = reset ? Date.parse(reset) : NaN;
          return [
            {
              id: `group-${groupIndex}:bucket-${index}`,
              label: text(bucket.window),
              description: text(bucket.description),
              remainingPercent:
                typeof fraction === 'number' && Number.isFinite(fraction)
                  ? Math.round(Math.max(0, Math.min(1, fraction)) * 100)
                  : null,
              resetAtMs: Number.isFinite(resetAtMs) ? resetAtMs : null,
            },
          ];
        });
        return buckets.length
          ? [
              {
                id: `group-${groupIndex}`,
                label: text(entry.displayName ?? entry.display_name),
                buckets,
              },
            ]
          : [];
      })
    : [];
  return {
    groups,
    subscription:
      text(subscription.tierName ?? subscription.tier_name) ||
      text(subscription.plan) ||
      text(subscription.tierId ?? subscription.tier_id) ||
      null,
    summary: normalizePluginQuotaSummary(payload.summary),
  };
}

export async function fetchPluginQuota(file: AuthFileItem, t: TFunction): Promise<PluginQuotaData> {
  if (
    !useAuthStore.getState().supportsPlugin ||
    !isPluginQuotaFile(file) ||
    isDisabledAuthFile(file)
  ) {
    throw new Error(t('plugin_quota.unavailable'));
  }
  const authIndex = normalizeAuthIndex(file.authIndex ?? file.auth_index);
  if (!authIndex) throw new Error(t('plugin_quota.missing_auth_index'));
  const provider = text(file.quotaProvider);
  return normalizePluginQuota(
    await apiClient.post<unknown>('/quota/fetch', {
      ...(provider ? { provider } : {}),
      auth_index: authIndex,
    })
  );
}

export const PLUGIN_CONFIG: QuotaProviderData<PluginQuotaState, PluginQuotaData> = {
  type: 'plugin',
  i18nPrefix: 'plugin_quota',
  filterFn: (file) => isPluginQuotaFile(file) && !isDisabledAuthFile(file),
  canObserve: () => useAuthStore.getState().supportsPlugin,
  fetchQuota: fetchPluginQuota,
  getObservations: (state) =>
    observeQuota(
      state.groups.flatMap((group) =>
        group.buckets.map((bucket) =>
          observeWindow({
            id: bucket.id,
            label: bucket.label || group.label || 'plugin_quota.limit',
            remainingPercent: bucket.remainingPercent,
            resetAtMs: bucket.resetAtMs,
            periodHours: null,
          })
        )
      )
    ),
  storeSelector: (state) => state.pluginQuota,
  storeSetter: 'setPluginQuota',
  buildLoadingState: () => ({ status: 'loading', groups: [], subscription: null, summary: [] }),
  buildSuccessState: (data) => ({ status: 'success', ...data }),
  buildErrorState: (error, errorStatus) => ({
    status: 'error',
    groups: [],
    subscription: null,
    summary: [],
    error,
    errorStatus,
  }),
};
