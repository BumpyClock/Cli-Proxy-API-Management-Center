import type { TFunction } from 'i18next';
import type { MetaQuotaData, MetaQuotaState } from '@/types';
import { apiCallApi } from '@/services/api/apiCall';
import { authFilesApi } from '@/services/api/authFiles';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } from '@/stores/useQuotaStore';
import { isDisabledAuthFile, resolveAuthProvider } from '@/utils/quota';
import type { QuotaProviderData } from '../types';
import { observeQuota, observeWindow } from '../observations';
import { createMetaQuotaFetcher, MetaQuotaError } from './requests';

const fetchMetaQuota = createMetaQuotaFetcher({
  request: (payload) => apiCallApi.request(payload),
  downloadText: (name) => authFilesApi.downloadText(name),
  captureCurrent: (name) => {
    const generation = captureQuotaCacheGeneration(name);
    return () => commitIfQuotaCacheCurrent(generation, () => {});
  },
});

export const META_CONFIG: QuotaProviderData<MetaQuotaState, MetaQuotaData> = {
  type: 'meta',
  i18nPrefix: 'meta_quota',
  filterFn: (file) => resolveAuthProvider(file) === 'meta' && !isDisabledAuthFile(file),
  fetchQuota: async (file, t: TFunction) => {
    try {
      return await fetchMetaQuota(file);
    } catch (error: unknown) {
      if (error instanceof MetaQuotaError) {
        error.message = t(`meta_quota.${error.code}`, { status: error.status });
      }
      throw error;
    }
  },
  getObservations: (state) => {
    const windows = (state.data?.windows ?? []).map((window) =>
      observeWindow({
        id: window.id,
        label: `meta_quota.${window.id}`,
        remainingPercent: window.usedPercent == null ? null : 100 - window.usedPercent,
        resetAtMs: window.resetAt === undefined ? null : window.resetAt * 1000,
        periodHours:
          window.id === 'weekly'
            ? 168
            : window.durationMinutes === undefined
              ? null
              : window.durationMinutes / 60,
        recovers: window.usedPercent !== null && window.usedPercent > 0,
      })
    );
    const limits = windows.flatMap((window) =>
      window.periodHours === null || window.resetAtMs === null || window.remainingPercent === null
        ? []
        : [{ label: window.label, remaining: window.remainingPercent }]
    );
    return observeQuota(windows, [], limits);
  },
  storeSelector: (state) => state.metaQuota,
  storeSetter: 'setMetaQuota',
  buildLoadingState: () => ({ status: 'loading' }),
  buildSuccessState: (data) => ({ status: 'success', data }),
  buildErrorState: (error, errorStatus) => ({
    status: 'error',
    error,
    errorStatus,
  }),
};
