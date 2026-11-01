import { apiClient } from './client';
import type { UsageResponse } from '@/types/usage';

const USAGE_TIMEOUT_MS = 60 * 1000;
const USAGE_FLAG_TIMEOUT_MS = 15 * 1000;

const readStatisticsFlag = (payload: unknown): boolean | null => {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as Record<string, unknown>)['usage-statistics-enabled'];
  return typeof value === 'boolean' ? value : null;
};

export const usageApi = {
  getUsage: () => apiClient.get<UsageResponse>('/usage', { timeout: USAGE_TIMEOUT_MS }),
  /**
   * Whether the server records per-request usage statistics. Null when the backend
   * does not expose the flag (older or upstream servers answer 404).
   */
  getStatisticsEnabled: async (): Promise<boolean | null> => {
    try {
      const payload = await apiClient.get<unknown>('/usage-statistics-enabled', {
        timeout: USAGE_FLAG_TIMEOUT_MS,
      });
      return readStatisticsFlag(payload);
    } catch (error: unknown) {
      const status = (error as { status?: unknown } | null)?.status;
      if (status === 404) return null;
      throw error;
    }
  },
};
