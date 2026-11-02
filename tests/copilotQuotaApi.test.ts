import { describe, expect, spyOn, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import { copilotApi, CopilotQuotaError, normalizeCopilotQuota } from '@/services/api/copilot';
import { COPILOT_CONFIG } from '@/features/quota/providers/copilot/data';
import i18n from '@/i18n';
import { copilotQuotaResponse } from './fixtures/copilotQuota';

const t = i18n.t.bind(i18n);

describe('Copilot quota Management API', () => {
  test.each([' index/with+symbols ', 0, 17])(
    'sends explicit credential index %p',
    async (index) => {
      const get = spyOn(apiClient, 'get').mockResolvedValue(copilotQuotaResponse);
      try {
        const data = await copilotApi.getQuota(index);
        expect(get).toHaveBeenCalledWith('/copilot-quota', {
          params: { auth_index: String(index).trim() },
        });
        expect(data.plan).toBe('individual');
        expect(data.resources[0].remainingPercent).toBe(75);
      } finally {
        get.mockRestore();
      }
    }
  );

  test.each([undefined, null, '', '  ', false, NaN, Infinity, {}])(
    'rejects missing/invalid index %p without invoking backend fallback',
    async (index) => {
      const get = spyOn(apiClient, 'get').mockResolvedValue(copilotQuotaResponse);
      try {
        await expect(copilotApi.getQuota(index)).rejects.toBeInstanceOf(CopilotQuotaError);
        expect(get).not.toHaveBeenCalled();
      } finally {
        get.mockRestore();
      }
    }
  );

  test.each([undefined, null, '', '  '])('adapter rejects missing identity %p', async (index) => {
    const get = spyOn(apiClient, 'get').mockResolvedValue(copilotQuotaResponse);
    try {
      await expect(
        COPILOT_CONFIG.fetchQuota({ name: 'copilot.json', authIndex: index }, t)
      ).rejects.toThrow(t('copilot_quota.missing_auth_index'));
      expect(get).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
    }
  });

  test('adapter uses selected file index, including legacy auth_index', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue(copilotQuotaResponse);
    try {
      await COPILOT_CONFIG.fetchQuota({ name: 'copilot.json', authIndex: 'chosen' }, t);
      expect(get).toHaveBeenLastCalledWith('/copilot-quota', {
        params: { auth_index: 'chosen' },
      });
      await COPILOT_CONFIG.fetchQuota({ name: 'legacy.json', auth_index: 'legacy-index' }, t);
      expect(get).toHaveBeenLastCalledWith('/copilot-quota', {
        params: { auth_index: 'legacy-index' },
      });
    } finally {
      get.mockRestore();
    }
  });

  test('preserves backend error/status and translates malformed response errors', async () => {
    const error = Object.assign(new Error('not supported'), { status: 404 });
    const get = spyOn(apiClient, 'get').mockRejectedValue(error);
    try {
      await expect(COPILOT_CONFIG.fetchQuota({ name: 'a', authIndex: 'a' }, t)).rejects.toBe(error);
      get.mockResolvedValue(null);
      await expect(COPILOT_CONFIG.fetchQuota({ name: 'a', authIndex: 'a' }, t)).rejects.toThrow(
        t('copilot_quota.invalid_response')
      );
    } finally {
      get.mockRestore();
    }
  });
});

describe('Copilot quota normalization', () => {
  test('whitelists display data and normalizes premium, unlimited chat and count-only completions', () => {
    expect(normalizeCopilotQuota(copilotQuotaResponse)).toEqual({
      plan: 'individual',
      resetAtMs: Date.UTC(2099, 11, 1),
      resources: [
        {
          id: 'premium_interactions',
          remainingPercent: 75,
          remaining: 225,
          entitlement: 300,
          unlimited: false,
        },
        { id: 'chat', remainingPercent: null, remaining: 0, entitlement: 0, unlimited: true },
        {
          id: 'completions',
          remainingPercent: 80,
          remaining: 1600,
          entitlement: 2000,
          unlimited: false,
        },
      ],
    });
    expect(JSON.stringify(normalizeCopilotQuota(copilotQuotaResponse))).not.toContain(
      'not-for-display'
    );
  });

  test('keeps absent and malformed fields unknown, never zero or full quota', () => {
    for (const payload of [
      {},
      { quota_snapshots: null },
      { quota_snapshots: { chat: [], completions: {}, premium_interactions: null } },
      {
        quota_snapshots: {
          premium_interactions: {
            entitlement: '',
            remaining: false,
            percent_remaining: -1,
            unlimited: 'true',
          },
        },
      },
    ]) {
      const data = normalizeCopilotQuota(payload);
      expect(data.plan).toBeNull();
      expect(data.resetAtMs).toBeNull();
      expect(data.resources).toHaveLength(3);
      for (const resource of data.resources) {
        expect(resource.remainingPercent).toBeNull();
        expect(resource.remaining).toBeNull();
        expect(resource.entitlement).toBeNull();
        expect(resource.unlimited).toBeNull();
      }
    }
  });

  test('recognizes backend zero-value missing snapshots without hiding explicitly identified zero allowances', () => {
    const empty = {
      entitlement: 0,
      overage_count: 0,
      overage_permitted: false,
      percent_remaining: 0,
      quota_id: '',
      quota_remaining: 0,
      remaining: 0,
      unlimited: false,
    };
    const data = normalizeCopilotQuota({
      quota_snapshots: {
        chat: empty,
        premium_interactions: { ...empty, quota_id: 'premium_interactions' },
      },
    });
    expect(data.resources[0].remainingPercent).toBe(0);
    expect(data.resources[0].unlimited).toBe(false);
    expect(data.resources[1].remainingPercent).toBeNull();
    expect(data.resources[1].remaining).toBeNull();
  });

  test('preserves exhausted quotas and does not infer unlimited from zero entitlement', () => {
    const data = normalizeCopilotQuota({
      quota_snapshots: {
        premium_interactions: {
          entitlement: 300,
          remaining: 0,
          percent_remaining: 0,
          unlimited: false,
        },
        chat: { entitlement: 0, remaining: 0 },
        completions: { entitlement: 100, quota_remaining: 25 },
      },
    });
    expect(data.resources[0].remainingPercent).toBe(0);
    expect(data.resources[1].remainingPercent).toBeNull();
    expect(data.resources[1].unlimited).toBeNull();
    expect(data.resources[2].remainingPercent).toBe(25);
  });

  test('uses explicit valid percentage, rejects invalid percentages and supports fractional counts', () => {
    const data = normalizeCopilotQuota({
      quota_snapshots: {
        premium_interactions: { entitlement: 10, remaining: 3.5, percent_remaining: 30 },
        chat: { percent_remaining: 101 },
        completions: { percent_remaining: Infinity, remaining: -1 },
      },
    });
    expect(data.resources[0].remaining).toBe(3.5);
    expect(data.resources[0].remainingPercent).toBe(30);
    expect(data.resources[1].remainingPercent).toBeNull();
    expect(data.resources[2].remainingPercent).toBeNull();
    expect(data.resources[2].remaining).toBeNull();
  });

  test('normalizes plan/SKU and reset date without inventing a missing reset', () => {
    expect(
      normalizeCopilotQuota({ copilot_plan: ' pro ', quota_reset_date: '2099-12-01T04:30:00Z' })
    ).toMatchObject({ plan: 'pro', resetAtMs: Date.UTC(2099, 11, 1, 4, 30) });
    expect(
      normalizeCopilotQuota({ copilot_plan: '', access_type_sku: ' copilot_business ' }).plan
    ).toBe('copilot_business');
    for (const reset of [null, 0, '', 'invalid', '12/01/2099']) {
      expect(normalizeCopilotQuota({ quota_reset_date: reset }).resetAtMs).toBeNull();
    }
  });

  test.each([null, [], 'invalid', 3].map((payload) => ({ payload })))(
    'rejects invalid response root %p',
    ({ payload }) => {
      expect(() => normalizeCopilotQuota(payload)).toThrow(CopilotQuotaError);
    }
  );
});
