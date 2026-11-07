/**
 * Quota windows timeline: lane derivation and window projection.
 *
 * Pure functions over board entries — no React, no clock of its own (`now` is
 * always passed in), so every case here is directly testable.
 *
 * The chart answers one question the cards can't: *when does capacity come
 * back, and does it come back all at once?* Four credentials all resetting on
 * the same evening is a very different situation from four staggered across a
 * week, and no per-card percentage shows that.
 */

import { DAY_MS, HOUR_MS } from '@/utils/time/durations';
import type { QuotaCardState, QuotaProviderType } from './providers/types';
import { getQuotaObservations } from './providers/registry';
import {
  selectQuotaWindow,
  type QuotaLimitObservation,
  type QuotaResetCreditObservation,
} from './providers/observations';

export { DAY_MS, HOUR_MS };

/** Weekly view spans a fortnight; the session view zooms to three days. */
export type TimelineMode = 'weekly' | 'session';

export const TIMELINE_SPAN_DAYS: Record<TimelineMode, number> = {
  weekly: 14,
  session: 3,
};

/** The rolling window the session view projects, in hours. */
const SESSION_PERIOD_HOURS = 5;

export type TimelineLimit = QuotaLimitObservation;
export type TimelineResetCredit = QuotaResetCreditObservation;

/** A reset-credit expiry projected onto the visible span. */
export interface TimelineResetCreditMark extends TimelineResetCredit {
  leftPercent: number;
}

/** One credential's row in the chart. */
export interface TimelineLane {
  name: string;
  displayName: string;
  provider: QuotaProviderType;
  /** Instant a window boundary falls on; all other boundaries derive from it. */
  anchorMs: number | null;
  /** Window length in hours. */
  periodHours: number | null;
  /** Remaining percent reported for the window ending at `anchorMs`. */
  remaining: number | null;
  limits: TimelineLimit[];
  resetCredits: TimelineResetCredit[];
}

/** One drawn bar: a single window occurrence within the visible span. */
export interface TimelineWindow {
  startMs: number;
  endMs: number;
  /** Fractions of the span, 0..100, already clipped to the visible range. */
  leftPercent: number;
  widthPercent: number;
  state: 'past' | 'live' | 'next';
  /** Remaining percent only when this is the API-reported current window. */
  remaining: number | null;
}

/**
 * Every window boundary of `periodMs` aligned to `anchorMs`, covering
 * [fromMs, toMs].
 *
 * The anchor is a known *reset* instant, so windows are projected backwards and
 * forwards from it by whole periods. Both directions matter: the visible span
 * usually starts before the current window opened, and the point of the chart
 * is what's coming.
 */
export function windowsIn(
  anchorMs: number,
  periodMs: number,
  fromMs: number,
  toMs: number
): { startMs: number; endMs: number }[] {
  if (!Number.isFinite(anchorMs) || !(periodMs > 0)) return [];
  if (!(toMs > fromMs)) return [];

  // Guard against a pathological period (a bad payload) turning this into a
  // multi-million-iteration loop.
  const maxWindows = Math.ceil((toMs - fromMs) / periodMs) + 2;
  if (maxWindows > 1000) return [];

  let end = anchorMs + Math.ceil((fromMs - anchorMs) / periodMs) * periodMs;
  const out: { startMs: number; endMs: number }[] = [];
  while (end - periodMs < toMs) {
    out.push({ startMs: end - periodMs, endMs: end });
    end += periodMs;
  }
  return out;
}

/** Start of the local day containing `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Start of the local week (Sunday) containing `ms`. */
export function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

/**
 * Visible span for a mode and offset.
 *
 * Weekly steps a week at a time from the containing Sunday; session steps a day
 * at a time from today. Uses date arithmetic rather than adding fixed
 * millisecond counts so a DST transition inside the span doesn't shift every
 * subsequent day by an hour.
 */
export function timelineSpan(
  mode: TimelineMode,
  offset: number,
  now: number
): { startMs: number; endMs: number; days: number } {
  const days = TIMELINE_SPAN_DAYS[mode];
  const base = new Date(mode === 'weekly' ? startOfWeek(now) : startOfDay(now));
  base.setDate(base.getDate() + offset * (mode === 'weekly' ? 7 : 1));
  base.setHours(0, 0, 0, 0);
  const startMs = base.getTime();

  const end = new Date(startMs);
  end.setDate(end.getDate() + days);
  end.setHours(0, 0, 0, 0);

  return { startMs, endMs: end.getTime(), days };
}

/** Local calendar boundaries, weighted by elapsed time to match bar positions. */
export function timelineCells(
  mode: TimelineMode,
  span: { startMs: number; days: number }
): { at: number; durationMs: number }[] {
  const perDay = mode === 'session' ? 4 : 1;
  const boundary = (index: number) => {
    const date = new Date(span.startMs);
    date.setDate(date.getDate() + Math.floor(index / perDay));
    date.setHours((index % perDay) * (24 / perDay), 0, 0, 0);
    return date.getTime();
  };

  return Array.from({ length: span.days * perDay }, (_, index) => {
    const at = boundary(index);
    return { at, durationMs: boundary(index + 1) - at };
  });
}

/**
 * Project one lane's windows onto a span, clipped and positioned.
 *
 * Windows falling entirely outside the span are dropped rather than returned
 * with a zero width, so a caller can treat an empty result as "nothing to draw".
 */
export function projectLane(
  lane: TimelineLane,
  spanStartMs: number,
  spanEndMs: number,
  now: number,
  mode: TimelineMode
): TimelineWindow[] {
  const periodHours = lane.periodHours;
  if (lane.anchorMs === null || !periodHours) return [];
  if (mode === 'session' && periodHours !== SESSION_PERIOD_HOURS) return [];

  const span = spanEndMs - spanStartMs;
  if (span <= 0) return [];

  const toPercent = (ms: number) => ((ms - spanStartMs) / span) * 100;

  return windowsIn(lane.anchorMs, periodHours * HOUR_MS, spanStartMs, spanEndMs)
    .map((window): TimelineWindow | null => {
      const left = Math.max(0, toPercent(window.startMs));
      const right = Math.min(100, toPercent(window.endMs));
      if (right <= 0 || left >= 100 || right <= left) return null;

      const state: TimelineWindow['state'] =
        window.endMs <= now ? 'past' : window.startMs <= now ? 'live' : 'next';

      return {
        startMs: window.startMs,
        endMs: window.endMs,
        leftPercent: left,
        widthPercent: right - left,
        state,
        // `lane.remaining` belongs to the current payload window ending at the
        // anchor. Once that reset passes, projected windows must not reuse it.
        remaining: state === 'live' && window.endMs === lane.anchorMs ? lane.remaining : null,
      };
    })
    .filter((window): window is TimelineWindow => window !== null);
}

/** Project unexpired reset-credit expiry instants onto the visible span. */
export function projectResetCredits(
  lane: TimelineLane,
  spanStartMs: number,
  spanEndMs: number,
  now: number
): TimelineResetCreditMark[] {
  const span = spanEndMs - spanStartMs;
  if (span <= 0) return [];

  return lane.resetCredits
    .filter(
      (credit) =>
        credit.expiresAtMs > now &&
        credit.expiresAtMs >= spanStartMs &&
        credit.expiresAtMs < spanEndMs
    )
    .map((credit) => ({
      ...credit,
      leftPercent: ((credit.expiresAtMs - spanStartMs) / span) * 100,
    }));
}

/**
 * Whether a lane has anything to draw, in any mode.
 *
 * Without an anchor no bar can be projected at any span or zoom, so the row
 * would be permanently blank. The card grid above already enumerates every
 * credential, so a blank row here adds no information — it just makes the
 * chart taller and the real lanes harder to compare against each other.
 *
 * Note this is about the lane, not the current view: an anchored lane whose
 * windows fall outside the visible span still gets a row, and says so.
 */
export function laneHasWindow(lane: TimelineLane): boolean {
  return lane.anchorMs !== null;
}

/* ------------------------------------------------------------------ lanes */

export interface TimelineLaneInput {
  name: string;
  displayName: string;
  provider: QuotaProviderType;
  quota: QuotaCardState | undefined;
  /**
   * Longest window period worth drawing, in hours — normally the visible span.
   * A window longer than the whole view can't show a boundary, and a much
   * shorter one degenerates into slivers.
   */
  maxPeriodHours?: number;
}

/** Recurring timelines require a reported reset and duration; unknown periods stay unprojected. */
export function buildTimelineLane(input: TimelineLaneInput): TimelineLane {
  const { name, displayName, provider, quota, maxPeriodHours } = input;
  const observations = getQuotaObservations(provider, quota);
  const recurring = {
    ...observations,
    windows: observations.windows.filter(
      (window) => window.periodHours !== null && window.resetAtMs !== null
    ),
  };
  const chosen = selectQuotaWindow(recurring, maxPeriodHours);
  return {
    name,
    displayName,
    provider,
    anchorMs: chosen?.resetAtMs ?? null,
    periodHours: chosen?.periodHours ?? null,
    remaining: chosen?.remainingPercent ?? null,
    limits: chosen ? observations.limits : [],
    resetCredits: chosen ? observations.resetCredits : [],
  };
}
