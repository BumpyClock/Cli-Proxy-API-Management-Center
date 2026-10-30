import type { RecentRequestBucket } from '@/utils/recentRequests';
import { TRAFFIC_BUCKET_MS, type TimedBucket } from '../types';

/**
 * Place server buckets on an absolute timeline.
 *
 * The backend returns 20 epoch-aligned 10-minute buckets that always end with the
 * bucket containing "now" on the server. Its labels ("13:50-14:00") are formatted in
 * the server's local timezone, which can be hours away from the viewer, so they are
 * ignored here. `anchorMs` is the server observation time (`observed_at`) when known,
 * otherwise the local receipt time.
 */
export function alignBuckets(buckets: RecentRequestBucket[], anchorMs: number): TimedBucket[] {
  const count = buckets.length;
  if (count === 0 || !Number.isFinite(anchorMs)) return [];
  const newestStart = Math.floor(anchorMs / TRAFFIC_BUCKET_MS) * TRAFFIC_BUCKET_MS;
  return buckets.map((bucket, index) => {
    const startMs = newestStart - (count - 1 - index) * TRAFFIC_BUCKET_MS;
    return {
      startMs,
      endMs: startMs + TRAFFIC_BUCKET_MS,
      success: bucket.success,
      failed: bucket.failed,
      partial: index === count - 1,
    };
  });
}

export type AgeUnit = 'now' | 'second' | 'minute' | 'hour' | 'day';

export interface AgeParts {
  unit: AgeUnit;
  value: number;
}

/**
 * Coarse age of a past instant. Seconds step in fives so a ticking label does not
 * flicker every second.
 */
export function ageParts(sinceMs: number, nowMs: number): AgeParts {
  const elapsed = Math.max(0, nowMs - sinceMs);
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 5) return { unit: 'now', value: 0 };
  if (seconds < 60) return { unit: 'second', value: Math.floor(seconds / 5) * 5 };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { unit: 'minute', value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hour', value: hours };
  return { unit: 'day', value: Math.floor(hours / 24) };
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** 24-hour `HH:mm` in the browser's timezone. */
export function formatClock(ms: number, locale?: string): string {
  if (!Number.isFinite(ms)) return '-';
  const key = locale ?? '';
  let formatter = clockFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
    } catch {
      formatter = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
    }
    clockFormatters.set(key, formatter);
  }
  return formatter.format(ms);
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `HH:mm` for instants on the viewer's current day, `MM/DD HH:mm` (locale order) otherwise,
 * so a retry ten hours away is never mistaken for one later today.
 */
export function formatInstant(ms: number, nowMs: number, locale?: string): string {
  if (!Number.isFinite(ms)) return '-';
  const sameDay = new Date(ms).toDateString() === new Date(nowMs).toDateString();
  if (sameDay) return formatClock(ms, locale);
  const key = locale ?? '';
  let formatter = dateTimeFormatters.get(key);
  if (!formatter) {
    const options: Intl.DateTimeFormatOptions = {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    };
    try {
      formatter = new Intl.DateTimeFormat(locale, options);
    } catch {
      formatter = new Intl.DateTimeFormat(undefined, options);
    }
    dateTimeFormatters.set(key, formatter);
  }
  return formatter.format(ms);
}

/** `13:40-13:50` in the browser's timezone. */
export function formatClockRange(startMs: number, endMs: number, locale?: string): string {
  return `${formatClock(startMs, locale)}–${formatClock(endMs, locale)}`;
}

/**
 * Translate a server timestamp into the local clock using the server observation
 * time, so a skewed browser clock cannot shift a retry deadline.
 */
export function serverInstantToLocal(
  instantMs: number,
  observedAtMs: number | null,
  receivedAtMs: number
): number {
  if (!Number.isFinite(instantMs)) return Number.NaN;
  if (observedAtMs === null || !Number.isFinite(observedAtMs)) return instantMs;
  return receivedAtMs + (instantMs - observedAtMs);
}
