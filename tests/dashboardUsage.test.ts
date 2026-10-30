import { describe, expect, test } from 'bun:test';
import { percentile, summarizeUsage } from '../src/features/dashboard/logic/usage';
import type { UsageSnapshot } from '../src/types/usage';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 30, 5, minute)).toISOString();
const WINDOW_START = Date.UTC(2026, 9, 30, 5, 10);

const snapshot: UsageSnapshot = {
  total_requests: 7,
  apis: {
    'sk-client-secret': {
      models: {
        'gpt-5.5': {
          details: [
            { timestamp: at(5), latency_ms: 900, tokens: { total_tokens: 10 } },
            { timestamp: at(12), latency_ms: 1200, tokens: { total_tokens: 100 } },
            { timestamp: at(20), latency_ms: 800, tokens: { total_tokens: 50 } },
            {
              timestamp: at(30),
              latency_ms: 4000,
              tokens: { total_tokens: 0 },
              failed: true,
              auth_index: '7',
            },
          ],
        },
        'claude-opus': {
          details: [
            { timestamp: at(25), latency_ms: 2000, tokens: { total_tokens: 300 } },
            { timestamp: at(40), latency_ms: 0, failed: true, auth_index: '' },
          ],
        },
      },
    },
  },
};

describe('percentile', () => {
  test('uses nearest rank', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([10], 0.95)).toBe(10);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
  });
});

describe('summarizeUsage', () => {
  test('counts only requests inside the window', () => {
    const summary = summarizeUsage(snapshot, WINDOW_START);
    expect(summary.requests).toBe(5);
    expect(summary.failed).toBe(2);
    expect(summary.tokens).toBe(450);
  });

  test('ranks models by volume with latency percentiles', () => {
    const summary = summarizeUsage(snapshot, WINDOW_START);
    expect(summary.models).toEqual([
      {
        model: 'gpt-5.5',
        requests: 3,
        failed: 1,
        tokens: 150,
        p50: 1200,
        p95: 4000,
        truncated: false,
      },
      {
        model: 'claude-opus',
        requests: 2,
        failed: 1,
        tokens: 300,
        p50: 2000,
        p95: 2000,
        truncated: false,
      },
    ]);
  });

  test('lists failures newest first and skips missing latency', () => {
    const summary = summarizeUsage(snapshot, WINDOW_START);
    expect(summary.failures).toEqual([
      { timeMs: Date.parse(at(40)), model: 'claude-opus', authIndex: null, latencyMs: null },
      { timeMs: Date.parse(at(30)), model: 'gpt-5.5', authIndex: '7', latencyMs: 4000 },
    ]);
  });

  test('marks a model whose retained details start inside the window', () => {
    const busy: UsageSnapshot = {
      apis: {
        client: {
          models: {
            // 1,001 requests, 1,000 retained: the oldest kept detail is inside the window.
            busy: {
              total_requests: 1001,
              details: Array.from({ length: 1000 }, (_, i) => ({
                timestamp: new Date(Date.UTC(2026, 9, 30, 5, 30) + i * 1000).toISOString(),
              })),
            },
            // An idle model with an old detail must not hide the busy model's gap.
            idle: { total_requests: 1, details: [{ timestamp: at(0) }] },
          },
        },
      },
    };
    const summary = summarizeUsage(busy, WINDOW_START);
    expect(summary.coverageStartMs).toBe(Date.UTC(2026, 9, 30, 5, 30));
    expect(summary.models.find((row) => row.model === 'busy')?.truncated).toBe(true);
  });

  test('does not flag retention when the dropped details are older than the window', () => {
    const summary = summarizeUsage(
      {
        apis: {
          client: {
            models: {
              m: { total_requests: 10, details: [{ timestamp: at(5) }, { timestamp: at(20) }] },
            },
          },
        },
      },
      WINDOW_START
    );
    expect(summary.coverageStartMs).toBeNull();
    expect(summary.models[0].truncated).toBe(false);
  });

  test('handles a missing snapshot', () => {
    expect(summarizeUsage(null, WINDOW_START)).toEqual({
      requests: 0,
      failed: 0,
      tokens: 0,
      models: [],
      failures: [],
      coverageStartMs: null,
    });
  });

  test('never carries client API keys into the summary', () => {
    expect(JSON.stringify(summarizeUsage(snapshot, WINDOW_START))).not.toContain(
      'sk-client-secret'
    );
  });
});
