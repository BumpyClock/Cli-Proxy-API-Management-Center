import { parseTimestamp } from '@/utils/timestamp';

export type LogTimeDisplay = {
  /** Short human time for the structured table ("Oct 20, 09:42:10"). */
  text: string;
  /** Exact instant for `<time dateTime>`. */
  iso: string;
};

export type LogTimeFormatter = (timestamp: string | undefined) => LogTimeDisplay | null;

/**
 * Structured rows show month, day and a 24-hour time with seconds (the year only when it is not
 * the current one); the raw view keeps the original stamp. Unparseable stamps return null so the
 * caller falls back to the original text.
 */
export const createLogTimeFormatter = (locale?: string, now = new Date()): LogTimeFormatter => {
  const base: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  };
  const sameYear = new Intl.DateTimeFormat(locale, base);
  const otherYear = new Intl.DateTimeFormat(locale, { ...base, year: 'numeric' });
  const currentYear = now.getFullYear();
  return (timestamp) => {
    if (!timestamp) return null;
    const date = parseTimestamp(timestamp);
    if (!date) return null;
    const format = date.getFullYear() === currentYear ? sameYear : otherYear;
    return { text: format.format(date), iso: date.toISOString() };
  };
};

const LATENCY_PART_REGEX = /(\d+(?:\.\d+)?)(µs|us|ms|s|m)/gi;
const UNIT_MS: Record<string, number> = { µs: 0.001, us: 0.001, ms: 1, s: 1000, m: 60000 };

/** Milliseconds for a Go-style duration such as `842ms`, `1.5s` or `1m2.3s`; null otherwise. */
export const parseLatencyMs = (latency: string | undefined): number | null => {
  if (!latency) return null;
  const compact = latency.replace(/\s+/g, '');
  let total = 0;
  let consumed = 0;
  for (const match of compact.matchAll(LATENCY_PART_REGEX)) {
    total += Number(match[1]) * UNIT_MS[match[2].toLowerCase()];
    consumed += match[0].length;
  }
  return consumed === compact.length && consumed > 0 ? total : null;
};

/** Number for the `Latency (ms)` column: two decimals under 10ms, one under 100ms, else whole. */
export const formatLatencyMs = (ms: number, locale?: string): string => {
  const maximumFractionDigits = ms < 10 ? 2 : ms < 100 ? 1 : 0;
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(ms);
};
