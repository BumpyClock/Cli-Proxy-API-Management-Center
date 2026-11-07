import { describe, expect, test } from 'bun:test';
import {
  estimateLabelWidth,
  isDayStart,
  layoutTimeAxis,
  plotAreaWidth,
  timeTickUnit,
  timeToX,
  type TimeAxisOptions,
} from '@/components/ui/TimeSeriesChart.model';
import { quotaTickFormat } from '@/features/quota/quotaChartFormat';

const hour = 3_600_000;
const day = 24 * hour;
// 11:39 PM local, as in the round-5 quota screenshots: the reset three days later sits 21
// minutes before a midnight, and neither domain edge is a midnight.
const start = new Date(2026, 10, 6, 23, 39).getTime();
const week = [start, start + 7 * day] as const;
const session = [start, start + 5 * hour] as const;
const reset = start + 3 * day;
// The overhang the chart allows: under the y-axis gutter on the left, into the right margin.
const OVERHANG = { start: 16, end: 12 };

/** Labels as the chart prints them: a day for day ticks and midnights, else a clock time. */
function labeller(language: string, domain: readonly [number, number]) {
  const format = quotaTickFormat(language);
  return (at: number) =>
    format(at, timeTickUnit(domain) === 'day' || isDayStart(at) ? 'day' : 'hour');
}

function layout(
  domain: readonly [number, number],
  container: number,
  language = 'en',
  options: TimeAxisOptions = {}
) {
  const label = labeller(language, domain);
  const plot = plotAreaWidth(container);
  const axis = layoutTimeAxis(domain, plot, (at) => estimateLabelWidth(label(at)), {
    overhang: OVERHANG,
    ...options,
  });
  const boxes = axis.ticks.map((at) => {
    const x = timeToX(at, domain, 0, plot);
    const half = estimateLabelWidth(label(at)) / 2;
    return [x - half, x + half] as const;
  });
  return { ...axis, plot, labels: axis.ticks.map(label), boxes };
}

const midnight = (y: number, m: number, d: number) => new Date(y, m, d).getTime();

// Chart container widths measured in the browser: Quota beside the list at 1440, Quota and
// the dashboard on a 390 phone, and the full-width dashboard card at 1440.
const LAYOUTS = { quota1440: 720, phone390: 326, dashboard1440: 1060 };

describe('time axis: day bands', () => {
  for (const [name, container] of Object.entries(LAYOUTS)) {
    for (const language of ['en', 'zh-CN', 'ru']) {
      test(`${name} ${language}: centred labels clear each other and stay inside the plot`, () => {
        const axis = layout(week, container, language);
        expect(axis.ticks.length).toBeGreaterThanOrEqual(3);
        axis.boxes.slice(1).forEach((box, index) => {
          expect(box[0]).toBeGreaterThanOrEqual(axis.boxes[index][1] + 12);
        });
        expect(axis.boxes[0][0]).toBeGreaterThanOrEqual(-OVERHANG.start);
        expect(axis.boxes.at(-1)![1]).toBeLessThanOrEqual(axis.plot + OVERHANG.end);
        // One stride in calendar days; a partial edge day only moves its own centre.
        const dayOf = (at: number) => new Date(at).setHours(0, 0, 0, 0);
        const steps = new Set(
          axis.ticks
            .slice(1)
            .map((at, index) => Math.round((dayOf(at) - dayOf(axis.ticks[index])) / day))
        );
        expect(steps.size).toBe(1);
      });
    }
  }

  test('every whole day of the Quota week is labelled, and the exact edges are not ticks', () => {
    const axis = layout(week, LAYOUTS.quota1440);
    expect(axis.labels).toEqual([
      'Nov 7',
      'Nov 8',
      'Nov 9',
      'Nov 10',
      'Nov 11',
      'Nov 12',
      'Nov 13',
    ]);
    expect(axis.ticks).not.toContain(week[0]);
    expect(axis.ticks).not.toContain(week[1]);
  });

  test('each label sits at the centre of the day it names, between two midnight rules', () => {
    const axis = layout(week, LAYOUTS.dashboard1440);
    expect(axis.rules).toEqual([7, 8, 9, 10, 11, 12, 13].map((d) => midnight(2026, 10, d)));
    axis.ticks.forEach((at) => {
      const dayStart = new Date(at).setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart).setDate(new Date(dayStart).getDate() + 1);
      const visibleStart = Math.max(dayStart, week[0]);
      const visibleEnd = Math.min(dayEnd, week[1]);
      expect(at).toBe((visibleStart + visibleEnd) / 2);
    });
  });

  test('a reset at 11:39 PM falls in the band labelled with its own day, not the next', () => {
    const axis = layout(week, LAYOUTS.quota1440);
    const band = axis.ticks.findIndex((at) => new Date(at).getDate() === new Date(reset).getDate());
    expect(axis.labels[band]).toBe('Nov 9');
    const nextMidnight = axis.rules.find((rule) => rule > reset)!;
    expect(new Date(nextMidnight).getDate()).toBe(10);
    expect(reset).toBeLessThan(nextMidnight);
    expect(reset).toBeGreaterThan(axis.ticks[band]);
  });

  test('the 21-minute sliver of Nov 6 is ruled off but too narrow to be named', () => {
    const axis = layout(week, LAYOUTS.dashboard1440);
    expect(axis.labels).not.toContain('Nov 6');
    expect(axis.rules[0]).toBe(midnight(2026, 10, 7));
  });

  test('a phone plot labels every other day at one stride and keeps every midnight rule', () => {
    const axis = layout(week, LAYOUTS.phone390);
    expect(axis.labels).toEqual(['Nov 7', 'Nov 9', 'Nov 11', 'Nov 13']);
    expect(axis.rules).toHaveLength(7);
  });

  test('a plot too narrow for any stride prints no day labels rather than overlapping ones', () => {
    expect(layout([start, start + 120 * day], 300).ticks).toEqual([]);
  });
});

describe('time axis: hours', () => {
  test('the 5-hour window labels each whole hour; the midnight names the new day', () => {
    const axis = layout(session, LAYOUTS.quota1440);
    expect(axis.ticks.map((at) => new Date(at).getHours())).toEqual([0, 1, 2, 3, 4]);
    expect(axis.labels[0]).toBe('Nov 7');
    expect(axis.labels[1]).toMatch(/^1:00\s?AM$/);
    expect(axis.rules).toEqual(axis.ticks);
  });

  test('a phone 5-hour window keeps one even two-hour stride', () => {
    const axis = layout(session, LAYOUTS.phone390);
    expect(axis.ticks.map((at) => new Date(at).getHours())).toEqual([0, 2, 4]);
  });

  test('the request-flow window ticks at whole hours with its clock labels', () => {
    const from = new Date(2026, 10, 6, 20, 20).getTime();
    const flow = [from, from + 200 * 60_000] as const;
    const axis = layoutTimeAxis(flow, plotAreaWidth(1060), () => estimateLabelWidth('11:00 PM'));
    expect(axis.unit).toBe('hour');
    expect(axis.ticks.map((at) => new Date(at).getHours())).toEqual([21, 22, 23]);
  });
});

describe('time axis: daily points', () => {
  test('zone-less daily buckets tick on their UTC midnights, edges when their label fits', () => {
    const first = Date.UTC(2026, 10, 1);
    const daily = [first, first + 6 * day] as const;
    const axis = layoutTimeAxis(daily, plotAreaWidth(1060), () => estimateLabelWidth('Nov 10'), {
      zone: 'UTC',
      days: 'points',
      overhang: OVERHANG,
    });
    const midnights = Array.from({ length: 7 }, (_, index) => first + index * day);
    expect(axis.ticks).toEqual(midnights.slice(1, -1));
    expect(axis.rules).toEqual(midnights.slice(1, -1));
    const wide = layoutTimeAxis(daily, plotAreaWidth(1060), () => 20, {
      zone: 'UTC',
      days: 'points',
      overhang: OVERHANG,
    });
    expect(wide.ticks).toEqual(midnights);
  });
});

describe('label width', () => {
  test('CJK labels are measured about one em per glyph at the 13px axis size', () => {
    expect(estimateLabelWidth('11月6日')).toBeGreaterThan(estimateLabelWidth('Nov 6'));
    expect(estimateLabelWidth('11月6日')).toBeCloseTo(13 * 2 + 13 * 0.55 * 3, 5);
  });
});
