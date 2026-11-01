import type { UsageSnapshot } from '@/types/usage';
import { parseTimestampMs } from '@/utils/timestamp';

export interface UsageModelSummary {
  model: string;
  requests: number;
  failed: number;
  tokens: number;
  /** Median and 95th percentile latency in ms, or null without samples. */
  p50: number | null;
  p95: number | null;
  /** Older requests for this model were dropped by retention, so counts are a floor. */
  truncated: boolean;
}

export interface UsageFailure {
  timeMs: number;
  model: string;
  authIndex: string | null;
  latencyMs: number | null;
}

export interface UsageSummary {
  requests: number;
  failed: number;
  tokens: number;
  models: UsageModelSummary[];
  failures: UsageFailure[];
  /** Complete coverage across API/model sources starts here; the window end means none. */
  coverageStartMs: number | null;
}

const numberOf = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Nearest-rank percentile of an ascending list. */
export function percentile(sortedAscending: number[], quantile: number): number | null {
  if (sortedAscending.length === 0) return null;
  const rank = Math.ceil(quantile * sortedAscending.length);
  const index = Math.min(sortedAscending.length - 1, Math.max(0, rank - 1));
  return sortedAscending[index];
}

interface ModelAccumulator {
  requests: number;
  failed: number;
  tokens: number;
  latencies: number[];
  truncated: boolean;
}

/**
 * Per-model volume, latency, and recent failures inside the half-open window
 * `windowStartMs <= timestamp < windowEndMs`.
 *
 * Request details are retained in memory up to a backend limit per API and model. When a
 * model's retained details start after the window does, its counts are a floor:
 * the row is marked truncated and `coverageStartMs` reports the latest such start, so the
 * panel can say so instead of under-reporting silently.
 */
export function summarizeUsage(
  usage: UsageSnapshot | null | undefined,
  windowStartMs: number,
  windowEndMs: number,
  limits: { models?: number; failures?: number } = {}
): UsageSummary {
  const modelLimit = limits.models ?? 6;
  const failureLimit = limits.failures ?? 6;
  const byModel = new Map<string, ModelAccumulator>();
  const failures: UsageFailure[] = [];
  let coverageStartMs: number | null = null;

  const accumulatorFor = (model: string): ModelAccumulator => {
    let accumulator = byModel.get(model);
    if (!accumulator) {
      accumulator = { requests: 0, failed: 0, tokens: 0, latencies: [], truncated: false };
      byModel.set(model, accumulator);
    }
    return accumulator;
  };

  Object.values(usage?.apis ?? {}).forEach((api) => {
    Object.entries(api?.models ?? {}).forEach(([model, snapshot]) => {
      const details = snapshot?.details ?? [];
      let oldestRetainedMs = Number.POSITIVE_INFINITY;

      details.forEach((detail) => {
        const timeMs = parseTimestampMs(detail?.timestamp);
        if (!Number.isFinite(timeMs)) return;
        oldestRetainedMs = Math.min(oldestRetainedMs, timeMs);
        if (timeMs < windowStartMs || timeMs >= windowEndMs) return;

        const accumulator = accumulatorFor(model);
        accumulator.requests += 1;
        accumulator.tokens += numberOf(detail?.tokens?.total_tokens);
        const latency = numberOf(detail?.latency_ms);
        if (latency > 0) accumulator.latencies.push(latency);
        if (detail?.failed) {
          accumulator.failed += 1;
          failures.push({
            timeMs,
            model,
            authIndex:
              typeof detail.auth_index === 'string' && detail.auth_index ? detail.auth_index : null,
            latencyMs: latency > 0 ? latency : null,
          });
        }
      });

      // Retention can remove the entire historical window, not only its first samples.
      const dropped = numberOf(snapshot?.total_requests) > details.length;
      if (dropped && oldestRetainedMs > windowStartMs) {
        accumulatorFor(model).truncated = true;
        const coverageStart = Math.min(oldestRetainedMs, windowEndMs);
        coverageStartMs =
          coverageStartMs === null ? coverageStart : Math.max(coverageStartMs, coverageStart);
      }
    });
  });

  const models = Array.from(byModel.entries())
    .filter(([, accumulator]) => accumulator.requests > 0)
    .map(([model, accumulator]) => {
      const sorted = [...accumulator.latencies].sort((a, b) => a - b);
      return {
        model,
        requests: accumulator.requests,
        failed: accumulator.failed,
        tokens: accumulator.tokens,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        truncated: accumulator.truncated,
      };
    })
    .sort(
      (a, b) => b.requests - a.requests || b.tokens - a.tokens || a.model.localeCompare(b.model)
    );

  return {
    requests: models.reduce((sum, row) => sum + row.requests, 0),
    failed: models.reduce((sum, row) => sum + row.failed, 0),
    tokens: models.reduce((sum, row) => sum + row.tokens, 0),
    models: models.slice(0, modelLimit),
    failures: failures.sort((a, b) => b.timeMs - a.timeMs).slice(0, failureLimit),
    coverageStartMs,
  };
}
