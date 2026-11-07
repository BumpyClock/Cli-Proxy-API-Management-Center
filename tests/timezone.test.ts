import { expect, test } from 'bun:test';

test('date-label fixtures run in UTC even when the host sets TZ', () => {
  expect(process.env.TZ).toBe('UTC');
  expect(new Date(2026, 0, 15).toISOString()).toBe('2026-01-15T00:00:00.000Z');
});
