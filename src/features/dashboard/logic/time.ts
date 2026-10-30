import type { RecentRequestBucket } from '@/utils/recentRequests';
import { TRAFFIC_BUCKET_MINUTES, TRAFFIC_BUCKET_MS, type TimedBucket } from '../types';

const MINUTES_PER_DAY = 1440;
const DAY_MS = MINUTES_PER_DAY * 60_000;
const LABEL_PATTERN = /^\s*(\d{1,2}):(\d{2})/;

const mod = (value: number, base: number) => ((value % base) + base) % base;

/** Start of a server bucket label such as `13:50-14:00`, in minutes after midnight. */
export function labelStartMinutes(label: string | undefined): number | null {
  const match = label ? LABEL_PATTERN.exec(label) : null;
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/**
 * The server's UTC offset in minutes (modulo one day), inferred from the label of the
 * newest bucket and the server clock that produced it.
 *
 * The newest bucket contains "now" on the server. If the snapshot was built just after a
 * 10-minute boundary that the anchor had not yet crossed, the difference is off by one
 * bucket. Real UTC offsets are multiples of 15 minutes and 10 is not, so exactly one of
 * the two neighbours is valid and the error can be removed.
 */
export function inferServerOffsetMinutes(newestLabelMinutes: number, anchorMs: number): number {
  const anchorBucket = Math.floor(anchorMs / TRAFFIC_BUCKET_MS) * TRAFFIC_BUCKET_MS;
  const utcMinutes = Math.floor(mod(anchorBucket, DAY_MS) / 60_000);
  const raw = mod(newestLabelMinutes - utcMinutes, MINUTES_PER_DAY);
  if (raw % 15 === 0) return raw;
  const corrected = [raw - TRAFFIC_BUCKET_MINUTES, raw + TRAFFIC_BUCKET_MINUTES]
    .map((candidate) => mod(candidate, MINUTES_PER_DAY))
    .find((candidate) => candidate % 15 === 0);
  return corrected ?? raw;
}

/** Absolute start of a labelled bucket, choosing the day closest to the anchor. */
export function labelToBucketStart(
  labelMinutes: number,
  offsetMinutes: number,
  anchorMs: number
): number {
  const utcMinutes = mod(labelMinutes - offsetMinutes, MINUTES_PER_DAY);
  const anchorBucket = Math.floor(anchorMs / TRAFFIC_BUCKET_MS) * TRAFFIC_BUCKET_MS;
  const dayStart = Math.floor(anchorBucket / DAY_MS) * DAY_MS;
  let best = Number.NaN;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const day of [dayStart - DAY_MS, dayStart, dayStart + DAY_MS]) {
    const candidate = day + utcMinutes * 60_000;
    const distance = Math.abs(candidate - anchorBucket);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Place one credential's server buckets on an absolute timeline.
 *
 * The backend returns 20 epoch-aligned 10-minute buckets ending with the bucket that
 * contains "now" on the server, labelled in the server's local timezone. Labels are never
 * displayed. With a known server offset, the newest label pins the timeline exactly, so
 * snapshots taken on either side of a bucket boundary still line up. Without labels or an
 * offset, the bucket containing `anchorMs` (the server observation time when known) is used.
 */
export function alignBuckets(
  buckets: RecentRequestBucket[],
  anchorMs: number,
  offsetMinutes: number | null = null
): TimedBucket[] {
  const count = buckets.length;
  if (count === 0 || !Number.isFinite(anchorMs)) return [];
  const newestLabel = labelStartMinutes(buckets[count - 1].time);
  const newestStart =
    offsetMinutes !== null && newestLabel !== null
      ? labelToBucketStart(newestLabel, offsetMinutes, anchorMs)
      : Math.floor(anchorMs / TRAFFIC_BUCKET_MS) * TRAFFIC_BUCKET_MS;
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
