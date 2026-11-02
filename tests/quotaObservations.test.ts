import { describe, expect, test } from 'bun:test';
import { getQuotaObservations, QUOTA_PROVIDER_DATA } from '@/features/quota/providers/registry';
import { selectQuotaWindow } from '@/features/quota/providers/observations';
import { QUOTA_TAB_ORDER } from '@/features/quota/constants';
import { buildTimelineLane } from '@/features/quota/quotaTimelineModel';
import { buildQuotaPool } from '@/features/quota/quotaPoolModel';
import { collectQuotaRowInstants } from '@/features/quota/resetSchedule';
import { normalizeCopilotQuota } from '@/services/api/copilot';

const now = Date.UTC(2099, 0, 1);
const reset = now + 86_400_000;

describe('provider-owned quota observations', () => {
  test('every registered provider supplies the shared contract and idle/error states contribute nothing', () => {
    expect(Object.keys(QUOTA_PROVIDER_DATA).sort()).toEqual([...QUOTA_TAB_ORDER].sort());
    for (const provider of QUOTA_TAB_ORDER) {
      for (const quota of [
        undefined,
        { status: 'loading' as const },
        { status: 'error' as const },
      ]) {
        expect(getQuotaObservations(provider, quota)).toEqual({
          windows: [],
          limits: [],
          resetCredits: [],
        });
      }
    }
  });

  test('one Copilot observation feeds pooling and recovery without inventing recurring geometry', () => {
    const quota = QUOTA_PROVIDER_DATA['github-copilot'].buildSuccessState(
      normalizeCopilotQuota({
        quota_reset_date: new Date(reset).toISOString(),
        quota_snapshots: {
          premium_interactions: { entitlement: 100, remaining: 25, unlimited: false },
          chat: { unlimited: true },
          completions: {},
        },
      })
    );
    const observations = getQuotaObservations('github-copilot', quota);
    expect(observations.windows.map((window) => window.id)).toEqual([
      'premium_interactions',
      'chat',
      'completions',
    ]);
    expect(observations.windows[1]).toMatchObject({
      remainingPercent: null,
      unlimited: true,
      recovers: false,
    });
    expect(observations.windows[2]).toMatchObject({
      remainingPercent: null,
      unlimited: null,
      recovers: false,
    });
    const chosen = selectQuotaWindow(observations);
    if (!chosen) throw new Error('Expected premium observation');
    expect(buildQuotaPool([chosen], now, reset).remaining).toBe(25);
    expect(collectQuotaRowInstants('github-copilot', quota)).toEqual([
      { rowId: 'premium_interactions', atMs: reset, kind: 'window' },
    ]);
    expect(
      buildTimelineLane({
        name: 'fixture',
        displayName: 'Fixture',
        provider: 'github-copilot',
        quota,
      }).anchorMs
    ).toBeNull();
  });

  test('known Copilot allowance with no reset stays measurable without projected resets', () => {
    const quota = QUOTA_PROVIDER_DATA['github-copilot'].buildSuccessState(
      normalizeCopilotQuota({
        quota_snapshots: {
          premium_interactions: { entitlement: 100, remaining: 25, unlimited: false },
        },
      })
    );
    const chosen = selectQuotaWindow(getQuotaObservations('github-copilot', quota));
    if (!chosen) throw new Error('Expected undated premium allowance');
    const pool = buildQuotaPool([chosen], now, reset);
    expect(pool.remaining).toBe(25);
    expect(pool.nextResetAtMs).toBeNull();
    expect(pool.points.every((point) => point.restored === 0)).toBe(true);
    expect(collectQuotaRowInstants('github-copilot', quota)).toEqual([]);
  });

  test('shared selector preserves account-window priority over a longer model-specific quota', () => {
    const quota = QUOTA_PROVIDER_DATA.codex.buildSuccessState({
      windows: [
        {
          id: 'weekly',
          label: 'Weekly',
          usedPercent: 75,
          resetAtMs: reset,
          periodHours: 168,
          resetLabel: '',
        },
        {
          id: 'model',
          label: 'Model',
          usedPercent: 5,
          resetAtMs: reset - 100,
          periodHours: 240,
          resetLabel: '',
        },
      ],
    });
    const chosen = selectQuotaWindow(getQuotaObservations('codex', quota), 336);
    expect(chosen?.id).toBe('weekly');
    expect(chosen?.remainingPercent).toBe(25);
  });

  test('metadata retains resets without a duration for recovery but not recurring timelines', () => {
    const quota = QUOTA_PROVIDER_DATA.meta.buildSuccessState({
      windows: [{ id: 'window', usedPercent: 50, resetAt: reset / 1000 }],
    });
    expect(getQuotaObservations('meta', quota).windows[0]).toMatchObject({
      resetAtMs: reset,
      periodHours: null,
      remainingPercent: 50,
    });
    expect(collectQuotaRowInstants('meta', quota)).toEqual([
      { rowId: 'window', atMs: reset, kind: 'window' },
    ]);
    expect(
      buildTimelineLane({ name: 'fixture', displayName: 'Fixture', provider: 'meta', quota })
        .anchorMs
    ).toBeNull();
  });
});
