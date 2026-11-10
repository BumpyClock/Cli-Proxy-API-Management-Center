import { apiClient } from './client';
import type { UsageResponse } from '@/types/usage';

const USAGE_TIMEOUT_MS = 60 * 1000;
const USAGE_FLAG_TIMEOUT_MS = 15 * 1000;

const readStatisticsFlag = (payload: unknown): boolean | null =>
  typeof payload === 'boolean' ? payload : null;

export const usageApi = {
  async getUsage(): Promise<UsageResponse> {
    try {
      return await apiClient.get<UsageResponse>('/usage', { timeout: USAGE_TIMEOUT_MS });
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
        // Original v8 has no Plus snapshot endpoint. Never consume the destructive usage queue.
        return { supported: false };
      }
      throw error;
    }
  },
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
