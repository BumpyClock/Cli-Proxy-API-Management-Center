import { describe, expect, test } from 'bun:test';
import { buildKimiQuotaRows } from '@/utils/quota';
import { getQuotaObservations } from '@/features/quota/providers/registry';
import { selectQuotaWindow } from '@/features/quota/providers/observations';
import { buildTimelineLane } from '@/features/quota/quotaTimelineModel';
import { buildAccountSeries } from '@/features/quota/quotaAccountSeries';

const reset = Date.UTC(2099, 1, 1);
const resetTime = new Date(reset).toISOString();

describe('Kimi monthly allowance', () => {
  test('keeps session rows before the monthly ratio without inventing a fixed period', () => {
    const rows = buildKimiQuotaRows({
      limits: [{ used: 1, limit: 100, window: { duration: 5, timeUnit: 'hour' } }],
      usages: { limit_month_total: { used_ratio: '0.42', reset_time: resetTime } },
    });
    expect(rows.map((row) => row.id)).toEqual(['limit-0', 'monthly']);
    expect(rows[1]).toMatchObject({
      used: 42,
      limit: 100,
      labelKey: 'kimi_quota.monthly_limit',
      resetAtMs: reset,
      periodHours: null,
    });
  });

  for (const ratio of [0, 1, -1, 2]) {
    test(`normalizes the ${ratio} monthly ratio to a valid quota`, () => {
      const rows = buildKimiQuotaRows({ usages: { limit_month_total: { used_ratio: ratio } } });
      expect(rows[0]?.used).toBe(ratio <= 0 ? 0 : 100);
      expect(rows[0]?.periodHours).toBeNull();
    });
  }

  for (const ratio of [undefined, '', 'invalid', Number.NaN, Number.POSITIVE_INFINITY]) {
    test(`ignores unusable monthly ratio ${String(ratio)}`, () => {
      expect(buildKimiQuotaRows({ usages: { limit_month_total: { used_ratio: ratio } } })).toEqual(
        []
      );
    });
  }

  for (const reset_time of [resetTime, undefined, 'invalid']) {
    test(`monthly snapshot remains measurable with reset ${String(reset_time)}`, () => {
      const rows = buildKimiQuotaRows({
        limits: [
          {
            used: 1,
            limit: 100,
            resetAt: resetTime,
            window: { duration: 5, timeUnit: 'hour' },
          },
        ],
        usages: { limit_month_total: { used_ratio: 0.42, reset_time } },
      });
      const quota = { status: 'success' as const, rows };
      const observations = getQuotaObservations('kimi', quota);
      expect(selectQuotaWindow(observations)?.id).toBe('monthly');
      expect(selectQuotaWindow(observations)?.label).toBe('kimi_quota.monthly_limit');
      expect(selectQuotaWindow(observations)?.remainingPercent).toBe(58);
      expect(selectQuotaWindow(observations, 5)?.id).toBe('limit-0');
      const { accounts } = buildAccountSeries(
        [{ type: 'kimi', file: { name: 'kimi.json', provider: 'kimi' } }],
        () => quota,
        'weekly',
        reset - 60_000,
        reset + 60_000,
        new Map()
      );
      expect(accounts[0]?.remaining).toBe(58);
      expect(accounts[0]?.window?.periodHours).toBeNull();
      const lane = buildTimelineLane({
        provider: 'kimi',
        name: 'kimi.json',
        displayName: 'Kimi',
        quota: { status: 'success', rows: rows.filter((row) => row.id === 'monthly') },
      });
      expect(lane.anchorMs).toBeNull();
      expect(lane.periodHours).toBeNull();
    });
  }
});
