import { apiClient } from './client';
import type { UsageResponse } from '@/types/usage';

const USAGE_TIMEOUT_MS = 60 * 1000;
const USAGE_FLAG_TIMEOUT_MS = 15 * 1000;

const readStatisticsFlag = (payload: unknown): boolean | null =>
  typeof payload === 'boolean' ? payload : null;

export const usageApi = {
  async getUsage(): Promise<UsageResponse> {
    try {
      return await apiClient.get<UsageResponse>('/observability/usage/snapshot', {
        timeout: USAGE_TIMEOUT_MS,
      });
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
        return { supported: false };
      }
      throw error;
    }
  },
  exportUsage: async () => {
    const data = await apiClient.get<ArrayBuffer>('/observability/usage/export', {
      responseType: 'arraybuffer',
      timeout: USAGE_TIMEOUT_MS,
    });
    return new Blob([data], { type: 'application/json' });
  },
  importUsage: (backup: Blob) =>
    apiClient.post<{ added: number }>('/observability/usage/import', backup, {
      timeout: USAGE_TIMEOUT_MS,
    }),
  /**
   * Whether the server records per-request usage statistics. Null when the backend
   * does not expose the flag (older or upstream servers answer 404).
   */
  getStatisticsEnabled: async (): Promise<boolean | null> => {
    try {
      const payload = await apiClient.get<unknown>(
        '/config/observability/usage/usage-statistics-enabled',
        {
          timeout: USAGE_FLAG_TIMEOUT_MS,
        }
      );
      return readStatisticsFlag(payload);
    } catch (error: unknown) {
      const status = (error as { status?: unknown } | null)?.status;
      if (status === 404) return null;
      throw error;
    }
  },
};
