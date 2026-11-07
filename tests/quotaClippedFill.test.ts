import { describe, expect, test } from 'bun:test';
import { HOUR_MS, projectLane, type TimelineLane } from '../src/features/quota/quotaTimelineModel';

const atHour = (hours: number) => Date.UTC(2026, 9, 21) + hours * HOUR_MS;

function lane(remaining: number | null): TimelineLane {
  return {
    name: 'claude-account',
    displayName: 'Claude account',
    provider: 'claude',
    anchorMs: atHour(168),
    periodHours: 168,
    remaining,
    limits: [],
    resetCredits: [],
  };
}

function currentWindow(remaining: number | null, startHour = 96, endHour = 336) {
  return projectLane(
    lane(remaining),
    atHour(startHour),
    atHour(endHour),
    atHour(100),
    'weekly'
  ).find((window) => window.state === 'live');
}

describe('quota timeline clipped used fill', () => {
  test('draws no used fill when all reported usage falls before the visible span', () => {
    const window = currentWindow(76);

    expect(window).toBeDefined();
    expect(window?.remaining).toBe(76);
    expect(window?.leftPercent).toBe(0);
    expect(window?.usedFillPercent).toBe(0);
  });

  test('shows only the used portion that intersects the visible bar', () => {
    // 126 used hours minus 96 clipped hours leaves 30 of 72 visible hours.
    expect(currentWindow(25)?.usedFillPercent).toBeCloseTo((30 / 72) * 100, 8);
  });

  test('preserves the reported used percentage for an unclipped window', () => {
    expect(currentWindow(76, 0)?.usedFillPercent).toBeCloseTo(24, 8);
  });

  test('fills the entire visible bar when the span clips the unused tail', () => {
    expect(currentWindow(25, 0, 100)?.usedFillPercent).toBe(100);
  });

  test('draws zero fill for a completely unused account', () => {
    expect(currentWindow(100)?.usedFillPercent).toBe(0);
  });

  test('fills the visible bar for an exhausted account', () => {
    expect(currentWindow(0)?.usedFillPercent).toBe(100);
  });

  test('does not invent usage when the reported remaining percentage is unknown', () => {
    expect(currentWindow(null)?.usedFillPercent).toBeNull();
  });

  test('does not reuse a stale percentage after its reported reset', () => {
    const windows = projectLane(lane(76), atHour(0), atHour(504), atHour(170), 'weekly');

    expect(windows.some((window) => window.state === 'past')).toBe(true);
    expect(windows.some((window) => window.state === 'live')).toBe(true);
    expect(windows.some((window) => window.state === 'next')).toBe(true);
    for (const window of windows) {
      expect(window.remaining).toBeNull();
      expect(window.usedFillPercent).toBeNull();
    }
  });
});
