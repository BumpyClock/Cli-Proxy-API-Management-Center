import { describe, expect, test } from 'bun:test';
import { selectQuotaWindow } from '@/features/quota/providers/observations';
import { getQuotaObservations } from '@/features/quota/providers/registry';
import { buildTimelineLane } from '@/features/quota/quotaTimelineModel';
import type { ClaudeQuotaState, ClaudeQuotaWindow } from '@/types';

const resetAtMs = Date.UTC(2099, 0, 8);

function window(
  id: string,
  usedPercent: number,
  periodHours: number,
  reset = resetAtMs
): ClaudeQuotaWindow {
  return { id, label: id, usedPercent, periodHours, resetAtMs: reset, resetLabel: '' };
}

function selection(windows: ClaudeQuotaWindow[], maxPeriodHours?: number) {
  const quota: ClaudeQuotaState = { status: 'success', windows };
  return {
    snapshot: selectQuotaWindow(getQuotaObservations('claude', quota), maxPeriodHours),
    timeline: buildTimelineLane({
      name: 'claude.json',
      displayName: 'Claude',
      provider: 'claude',
      quota,
      maxPeriodHours,
    }),
  };
}

describe('Claude account quota selection', () => {
  for (const model of ['seven-day-opus', 'seven-day-sonnet', 'seven-day-fable']) {
    test(`exhausted account beats unused ${model} with an earlier reset`, () => {
      const result = selection([
        window(model, 0, 168, resetAtMs - 1000),
        window('seven-day', 100, 168),
      ]);
      expect(result.snapshot?.id).toBe('seven-day');
      expect(result.snapshot?.remainingPercent).toBe(0);
      expect(result.timeline.remaining).toBe(0);
      expect(result.timeline.anchorMs).toBe(resetAtMs);
    });
  }

  test('session view prefers the five-hour account allowance', () => {
    const result = selection(
      [
        window('model-session', 0, 5, resetAtMs - 1000),
        window('five-hour', 80, 5),
        window('seven-day', 100, 168),
      ],
      5
    );
    expect(result.snapshot?.id).toBe('five-hour');
    expect(result.snapshot?.remainingPercent).toBe(20);
    expect(result.timeline.remaining).toBe(20);
    expect(result.timeline.periodHours).toBe(5);
    expect(result.timeline.anchorMs).toBe(resetAtMs);
  });

  test('weekly view does not select the account session window', () => {
    const result = selection([window('five-hour', 100, 5), window('seven-day', 25, 168)], 336);
    expect(result.snapshot?.id).toBe('seven-day');
    expect(result.timeline.remaining).toBe(75);
    expect(result.timeline.periodHours).toBe(168);
  });

  test('missing account windows retain model-window fallback', () => {
    const result = selection([
      window('seven-day-opus', 50, 168, resetAtMs - 1000),
      window('seven-day-sonnet', 25, 168),
    ]);
    expect(result.snapshot?.id).toBe('seven-day-opus');
    expect(result.timeline.remaining).toBe(50);
    expect(result.timeline.anchorMs).toBe(resetAtMs - 1000);
  });

  test('account windows with no reported period do not displace recurring model quotas', () => {
    const result = selection([
      { ...window('seven-day', 100, 168), periodHours: null },
      window('seven-day-opus', 25, 168),
    ]);
    expect(result.snapshot?.id).toBe('seven-day-opus');
    expect(result.timeline.remaining).toBe(75);
  });

  test('account windows with no reset retain model-window fallback', () => {
    const result = selection([
      { ...window('seven-day', 100, 168), resetAtMs: null },
      window('seven-day-opus', 25, 168),
    ]);
    expect(result.snapshot?.id).toBe('seven-day-opus');
    expect(result.timeline.remaining).toBe(75);
  });
});
