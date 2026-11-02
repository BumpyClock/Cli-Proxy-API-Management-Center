import { describe, expect, test } from 'bun:test';
import { buildPoolLane, buildQuotaPool, quotaPoolPath } from '@/features/quota/quotaPoolModel';
import type { CopilotQuotaState } from '@/types';
import type { TimelineLane } from '@/features/quota/quotaTimelineModel';

const now = Date.parse('2026-11-01T12:00:00Z');
const hour = 3_600_000;
const lane = (remaining: number | null, reset: number | null): TimelineLane => ({
  name: 'fixture',
  displayName: 'Fixture account',
  provider: 'claude',
  anchorMs: reset,
  periodHours: 168,
  remaining,
  limits: [],
  resetCredits: [],
});

describe('provider quota overview', () => {
  test('Copilot contributes premium quota without inventing a monthly duration', () => {
    const quota: CopilotQuotaState = {
      status: 'success',
      data: {
        plan: 'individual',
        resetAtMs: now + hour,
        resources: [
          {
            id: 'premium_interactions',
            remainingPercent: 73,
            remaining: 219,
            entitlement: 300,
            unlimited: false,
          },
          { id: 'chat', remainingPercent: null, remaining: 0, entitlement: 0, unlimited: true },
        ],
      },
    };
    const input = {
      name: 'copilot',
      displayName: 'Copilot',
      provider: 'github-copilot' as const,
      quota,
    };
    const result = buildPoolLane(input);
    expect(result.periodHours).toBeNull();
    expect(result.remaining).toBe(73);
    expect(
      buildQuotaPool([result], now, now + 800 * hour).points.filter((p) => p.restored > 0)
    ).toEqual([{ atMs: now + hour, remaining: 100, restored: 27 }]);
    expect(buildPoolLane({ ...input, quota: { status: 'loading' } }).remaining).toBeNull();
    const unlimited: CopilotQuotaState = {
      ...quota,
      data: {
        ...quota.data!,
        resources: [
          {
            id: 'premium_interactions',
            remainingPercent: null,
            remaining: null,
            entitlement: null,
            unlimited: true,
          },
        ],
      },
    };
    expect(
      buildQuotaPool([buildPoolLane({ ...input, quota: unlimited })], now, now + hour).remaining
    ).toBeNull();
  });

  test('sums only measured account equivalents, not missing accounts', () => {
    const pool = buildQuotaPool(
      [lane(75, now + hour), lane(40, now + 2 * hour), lane(null, null)],
      now,
      now + 24 * hour
    );
    expect(pool.remaining).toBe(115);
    expect(pool.capacity).toBe(200);
    expect(pool.measuredCount).toBe(2);
    expect(pool.nextResetAtMs).toBe(now + hour);
    expect(pool.nextResetGain).toBe(25);
  });

  test('merges simultaneous resets without counting the same remaining quota twice', () => {
    const pool = buildQuotaPool([lane(20, now + hour), lane(50, now + hour)], now, now + 2 * hour);
    expect(pool.nextResetGain).toBe(130);
    expect(pool.points).toEqual([
      { atMs: now, remaining: 70, restored: 0 },
      { atMs: now + hour, remaining: 70, restored: 0 },
      { atMs: now + hour, remaining: 200, restored: 130 },
      { atMs: now + 2 * hour, remaining: 200, restored: 0 },
    ]);
  });

  test('never fabricates burn, history, recurring resets, or an exhaustion time', () => {
    const pool = buildQuotaPool([lane(30, now + hour)], now, now + 400 * hour);
    expect(pool.points[0]).toEqual({ atMs: now, remaining: 30, restored: 0 });
    expect(pool.points.filter((point) => point.restored > 0)).toHaveLength(1);
    expect(pool.points[pool.points.length - 1].remaining).toBe(100);
  });

  test('expired windows do not keep displaying their old percentage', () => {
    const pool = buildQuotaPool([lane(25, now), lane(80, now - hour)], now, now + hour);
    expect(pool.remaining).toBeNull();
    expect(pool.measuredCount).toBe(0);
    expect(pool.points).toEqual([]);
  });

  test('zero remaining is a measured, exhausted account rather than missing data', () => {
    const pool = buildQuotaPool([lane(0, now + hour)], now, now + 2 * hour);
    expect(pool.remaining).toBe(0);
    expect(pool.capacity).toBe(100);
    expect(pool.nextResetGain).toBe(100);
  });

  test('a reset outside the visible range stays outside the chart', () => {
    const pool = buildQuotaPool([lane(50, now + 10 * hour)], now, now + hour);
    expect(pool.nextResetAtMs).toBe(now + 10 * hour);
    expect(pool.points.every((point) => point.restored === 0)).toBe(true);
    expect(quotaPoolPath(pool, now, now + hour, 100, 100)).toBe('M0.00,50.00 L100.00,50.00');
  });

  test('path starts at the snapshot, leaving past time unrecorded', () => {
    const pool = buildQuotaPool([lane(50, now + hour)], now, now + 2 * hour);
    expect(quotaPoolPath(pool, now - 2 * hour, now + 2 * hour, 100, 100)).toBe(
      'M50.00,50.00 L75.00,50.00 L75.00,0.00 L100.00,0.00'
    );
    expect(quotaPoolPath(pool, now - 3 * hour, now - hour, 100, 100)).toBe('');
  });

  test('future navigation clips the leading segment without inventing a new reset', () => {
    const pool = buildQuotaPool([lane(50, now + hour)], now, now + 5 * hour);
    expect(quotaPoolPath(pool, now + 2 * hour, now + 5 * hour, 100, 100)).toBe(
      'M0.00,0.00 L100.00,0.00'
    );
  });
});
