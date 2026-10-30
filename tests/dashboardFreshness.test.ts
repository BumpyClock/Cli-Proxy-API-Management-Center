import { describe, expect, test } from 'bun:test';
import {
  classifyFreshness,
  oldestReceipt,
  staleAfterMs,
  worstFreshness,
} from '../src/features/dashboard/logic/freshness';
import {
  ageParts,
  alignBuckets,
  formatClock,
  formatInstant,
  inferServerOffsetMinutes,
  labelStartMinutes,
  labelToBucketStart,
  serverInstantToLocal,
} from '../src/features/dashboard/logic/time';

const MINUTE = 60_000;

describe('alignBuckets', () => {
  test('ends at the bucket containing the anchor, ignoring server-local labels', () => {
    // 05:58:37Z sits in the 05:50-06:00 UTC bucket even though the server labels it 13:50-14:00.
    const anchor = Date.UTC(2026, 9, 30, 5, 58, 37);
    const timed = alignBuckets(
      [
        { time: '13:40-13:50', success: 2, failed: 1 },
        { time: '13:50-14:00', success: 5, failed: 0 },
      ],
      anchor
    );

    expect(timed.map((bucket) => new Date(bucket.startMs).toISOString())).toEqual([
      '2026-10-30T05:40:00.000Z',
      '2026-10-30T05:50:00.000Z',
    ]);
    expect(timed[1].endMs - timed[1].startMs).toBe(10 * MINUTE);
    expect(timed.map((bucket) => bucket.partial)).toEqual([false, true]);
    expect(timed[0]).toMatchObject({ success: 2, failed: 1 });
  });

  test('returns nothing without buckets or a usable anchor', () => {
    expect(alignBuckets([], Date.now())).toEqual([]);
    expect(alignBuckets([{ success: 1, failed: 0 }], Number.NaN)).toEqual([]);
  });
});

describe('server label alignment', () => {
  const observedAt = Date.UTC(2026, 9, 30, 5, 58, 37);

  test('parses bucket label starts', () => {
    expect(labelStartMinutes('13:50-14:00')).toBe(830);
    expect(labelStartMinutes('9:05-9:15')).toBe(545);
    expect(labelStartMinutes('label-3')).toBeNull();
    expect(labelStartMinutes(undefined)).toBeNull();
  });

  test('infers the server offset from the newest label', () => {
    expect(inferServerOffsetMinutes(830, observedAt)).toBe(480); // UTC+8
    expect(inferServerOffsetMinutes(22 * 60 + 50, observedAt)).toBe(1020); // UTC-7, modulo a day
    expect(inferServerOffsetMinutes(11 * 60 + 35, observedAt)).toBe(345); // UTC+5:45
  });

  test('removes the one-bucket error when a snapshot crossed a boundary after the anchor', () => {
    // The anchor sits in 05:50Z, but the snapshot was built in 06:00Z (label 14:00 at UTC+8).
    expect(inferServerOffsetMinutes(14 * 60, Date.UTC(2026, 9, 30, 5, 59, 59, 900))).toBe(480);
    // UTC+5:45 with the same race still resolves to 345.
    expect(inferServerOffsetMinutes(11 * 60 + 45, observedAt)).toBe(345);
  });

  test('maps a label to the absolute bucket nearest the anchor, across midnight', () => {
    expect(new Date(labelToBucketStart(830, 480, observedAt)).toISOString()).toBe(
      '2026-10-30T05:50:00.000Z'
    );
    // 23:50 at UTC+8 is 15:50Z the previous UTC day; an anchor shortly after maps back to it.
    expect(
      new Date(labelToBucketStart(23 * 60 + 50, 480, Date.UTC(2026, 9, 29, 15, 55))).toISOString()
    ).toBe('2026-10-29T15:50:00.000Z');
  });

  test('aligns a snapshot by its label even when the anchor is a bucket behind', () => {
    const anchor = Date.UTC(2026, 9, 30, 5, 59, 59, 900);
    const timed = alignBuckets(
      [
        { time: '13:50-14:00', success: 1, failed: 0 },
        { time: '14:00-14:10', success: 2, failed: 0 },
      ],
      anchor,
      480
    );
    expect(timed.map((bucket) => new Date(bucket.startMs).toISOString())).toEqual([
      '2026-10-30T05:50:00.000Z',
      '2026-10-30T06:00:00.000Z',
    ]);
  });
});

describe('ageParts', () => {
  const now = 1_000_000_000;

  test('treats the first five seconds as now', () => {
    expect(ageParts(now - 4_999, now)).toEqual({ unit: 'now', value: 0 });
  });

  test('steps seconds in fives so labels do not flicker', () => {
    expect(ageParts(now - 7_000, now)).toEqual({ unit: 'second', value: 5 });
    expect(ageParts(now - 59_999, now)).toEqual({ unit: 'second', value: 55 });
  });

  test('switches to minutes, hours, and days', () => {
    expect(ageParts(now - 3 * MINUTE, now)).toEqual({ unit: 'minute', value: 3 });
    expect(ageParts(now - 125 * MINUTE, now)).toEqual({ unit: 'hour', value: 2 });
    expect(ageParts(now - 50 * 60 * MINUTE, now)).toEqual({ unit: 'day', value: 2 });
  });

  test('never reports a negative age for a skewed clock', () => {
    expect(ageParts(now + 30_000, now)).toEqual({ unit: 'now', value: 0 });
  });
});

describe('formatClock', () => {
  test('uses a 24-hour clock', () => {
    const label = formatClock(new Date(2026, 0, 1, 15, 4).getTime(), 'en-US');
    expect(label).toBe('15:04');
  });
});

describe('formatInstant', () => {
  test('shows only the clock for instants later today', () => {
    const now = new Date(2026, 0, 1, 8, 0).getTime();
    expect(formatInstant(new Date(2026, 0, 1, 18, 5).getTime(), now, 'en-US')).toBe('18:05');
  });

  test('adds the date for instants on another day', () => {
    const now = new Date(2026, 0, 1, 22, 0).getTime();
    const label = formatInstant(new Date(2026, 0, 2, 9, 30).getTime(), now, 'en-US');
    expect(label).toContain('01/02');
    expect(label).toContain('09:30');
  });
});

describe('serverInstantToLocal', () => {
  test('shifts a server deadline by the observed clock gap', () => {
    const observedAt = Date.UTC(2026, 9, 30, 6, 0, 0);
    const receivedAt = observedAt - 90_000; // the browser clock runs 90s behind
    const retryAt = observedAt + 10 * MINUTE;
    expect(serverInstantToLocal(retryAt, observedAt, receivedAt)).toBe(receivedAt + 10 * MINUTE);
  });

  test('falls back to the raw instant without a server clock', () => {
    expect(serverInstantToLocal(123, null, 999)).toBe(123);
  });
});

describe('classifyFreshness', () => {
  const interval = 15_000;
  const now = 10_000_000;

  test('is pending before the first response', () => {
    expect(classifyFreshness({ receivedAt: null, error: null, loading: true }, interval, now)).toBe(
      'pending'
    );
  });

  test('is live within three intervals and stale after', () => {
    expect(
      classifyFreshness({ receivedAt: now - 44_000, error: null, loading: false }, interval, now)
    ).toBe('live');
    expect(
      classifyFreshness(
        { receivedAt: now - staleAfterMs(interval) - 1, error: null, loading: false },
        interval,
        now
      )
    ).toBe('stale');
  });

  test('reports failure even while last-good data is still recent', () => {
    expect(
      classifyFreshness(
        { receivedAt: now - 1_000, error: 'timeout', loading: false },
        interval,
        now
      )
    ).toBe('failed');
  });
});

describe('freshness helpers', () => {
  test('worstFreshness ranks failed above stale above pending above live', () => {
    expect(worstFreshness([])).toBe('live');
    expect(worstFreshness(['live', 'pending'])).toBe('pending');
    expect(worstFreshness(['stale', 'pending', 'live'])).toBe('stale');
    expect(worstFreshness(['stale', 'failed'])).toBe('failed');
  });

  test('oldestReceipt waits for every source', () => {
    expect(
      oldestReceipt([
        { receivedAt: 5, error: null, loading: false },
        { receivedAt: 3, error: null, loading: false },
      ])
    ).toBe(3);
    expect(
      oldestReceipt([
        { receivedAt: 5, error: null, loading: false },
        { receivedAt: null, error: null, loading: true },
      ])
    ).toBeNull();
  });
});
