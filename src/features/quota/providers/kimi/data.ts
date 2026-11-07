/**
 * Kimi 额度数据层。React-free / SCSS-free。
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, KimiQuotaRow, KimiQuotaState } from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { resolveKimiQuotaUrl } from '@/services/api/kimiQuota';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } from '@/stores/useQuotaStore';
import {
  KIMI_REQUEST_HEADERS,
  parseKimiUsagePayload,
  buildKimiQuotaRows,
  createStatusError,
  isKimiFile,
  isDisabledAuthFile,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { QuotaProviderData } from '../types';
import { observeQuota, observeWindow } from '../observations';

const fetchKimiQuota = async (file: AuthFileItem, t: TFunction): Promise<KimiQuotaRow[]> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('kimi_quota.missing_auth_index'));
  }

  const generation = captureQuotaCacheGeneration(file.name);
  const assertCurrent = () => {
    if (!commitIfQuotaCacheCurrent(generation, () => {})) {
      throw new Error(t('kimi_quota.stale_request'));
    }
  };
  let url: string;
  try {
    url = await resolveKimiQuotaUrl(file);
  } catch {
    assertCurrent();
    throw new Error(t('kimi_quota.domain_unavailable'));
  }
  assertCurrent();

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url,
    header: { ...KIMI_REQUEST_HEADERS },
  });

  assertCurrent();

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseKimiUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('kimi_quota.empty_data'));
  }

  return buildKimiQuotaRows(payload);
};

export const KIMI_CONFIG: QuotaProviderData<KimiQuotaState, KimiQuotaRow[]> = {
  type: 'kimi',
  i18nPrefix: 'kimi_quota',
  filterFn: (file) => isKimiFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchKimiQuota,
  getObservations: (state) =>
    observeQuota(
      (state.rows ?? [])
        .map((row, index) =>
          observeWindow({
            id: row.id || `row-${index}`,
            label: row.id === 'monthly' ? 'kimi_quota.monthly_limit' : (row.label ?? ''),
            remainingPercent:
              row.limit > 0 ? Math.round(((row.limit - row.used) / row.limit) * 100) : null,
            resetAtMs: row.resetAtMs ?? null,
            periodHours: row.periodHours ?? null,
            preferredFor: row.id === 'monthly' ? 'weekly' : null,
          })
        )
        .filter((window) => window.resetAtMs !== null || window.id === 'monthly')
    ),
  storeSelector: (state) => state.kimiQuota,
  storeSetter: 'setKimiQuota',
  buildLoadingState: () => ({ status: 'loading', rows: [] }),
  buildSuccessState: (rows) => ({ status: 'success', rows }),
  buildErrorState: (message, status) => ({
    status: 'error',
    rows: [],
    error: message,
    errorStatus: status,
  }),
};
