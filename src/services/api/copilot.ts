import type { CopilotQuotaData, CopilotQuotaResource } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { apiClient } from './client';

export class CopilotQuotaError extends Error {
  constructor(public readonly code: 'missing_auth_index' | 'invalid_response') {
    super(code);
    this.name = 'CopilotQuotaError';
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const nonnegativeNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export function normalizeCopilotQuota(payload: unknown): CopilotQuotaData {
  const source = asRecord(payload);
  if (!source) throw new CopilotQuotaError('invalid_response');
  const snapshots = asRecord(source.quota_snapshots);
  const resources = (['premium_interactions', 'chat', 'completions'] as const).map(
    (id): CopilotQuotaResource => {
      let raw = asRecord(snapshots?.[id]);
      // Go serializes an omitted QuotaDetail as an unidentified, all-zero struct.
      if (
        raw?.quota_id === '' &&
        raw.entitlement === 0 &&
        raw.overage_count === 0 &&
        raw.overage_permitted === false &&
        raw.percent_remaining === 0 &&
        raw.quota_remaining === 0 &&
        raw.remaining === 0 &&
        raw.unlimited === false
      ) {
        raw = null;
      }
      const entitlement = nonnegativeNumber(raw?.entitlement);
      const remaining =
        nonnegativeNumber(raw?.remaining) ?? nonnegativeNumber(raw?.quota_remaining);
      const unlimited = typeof raw?.unlimited === 'boolean' ? raw.unlimited : null;
      const percent = nonnegativeNumber(raw?.percent_remaining);
      const remainingPercent =
        unlimited === true
          ? null
          : percent !== null && percent <= 100
            ? percent
            : remaining !== null && entitlement !== null && entitlement > 0
              ? Math.min(100, (remaining / entitlement) * 100)
              : null;
      return { id, remainingPercent, remaining, entitlement, unlimited };
    }
  );
  const reset = typeof source.quota_reset_date === 'string' ? source.quota_reset_date.trim() : '';
  // Validate the source calendar independently of timezone conversion; Date.parse rolls Feb 30.
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(reset);
  let resetAtMs: number | null = null;
  if (parts) {
    const [, year, month, day] = parts.map(Number);
    const calendar = new Date(0);
    calendar.setUTCFullYear(year, month - 1, day);
    if (
      calendar.getUTCFullYear() === year &&
      calendar.getUTCMonth() === month - 1 &&
      calendar.getUTCDate() === day
    ) {
      const parsed = Date.parse(reset);
      if (Number.isFinite(parsed) && parsed > 0) resetAtMs = parsed;
    }
  }
  return {
    plan:
      (typeof source.copilot_plan === 'string' && source.copilot_plan.trim()) ||
      (typeof source.access_type_sku === 'string' && source.access_type_sku.trim()) ||
      null,
    resetAtMs,
    resources,
  };
}

export const copilotApi = {
  async getQuota(authIndex: unknown): Promise<CopilotQuotaData> {
    const index = normalizeAuthIndex(authIndex);
    // The backend defaults to another credential when the index is absent.
    if (index === null) throw new CopilotQuotaError('missing_auth_index');
    const payload = await apiClient.get<unknown>('/copilot-quota', {
      params: { auth_index: index },
    });
    return normalizeCopilotQuota(payload);
  },
};
