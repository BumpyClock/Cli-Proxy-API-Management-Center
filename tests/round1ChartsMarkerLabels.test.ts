import { describe, expect, test } from 'bun:test';
import {
  edgeAnchor,
  formatSeriesNumbers,
  groupCoincidentMarkers,
} from '@/components/ui/TimeSeriesChart.model';

describe('coincident marker labels', () => {
  test('four series at the same point print one range label, not four stacked numbers', () => {
    const groups = groupCoincidentMarkers(
      [4, 2, 3, 1].map((number) => ({ id: `account-${number}`, number, x: 58, y: 120 }))
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].text).toBe('1–4');
    expect(groups[0].numbers).toEqual([1, 2, 3, 4]);
    expect(groups[0].ids).toEqual(['account-1', 'account-2', 'account-3', 'account-4']);
    expect(groups[0]).toMatchObject({ x: 58, y: 120 });
  });

  test('two coincident zero markers share "1,2" instead of overprinting', () => {
    const groups = groupCoincidentMarkers([
      { id: 'success', number: 1, x: 900, y: 200 },
      { id: 'failed', number: 2, x: 900, y: 200 },
    ]);
    expect(groups.map((group) => group.text)).toEqual(['1,2']);
  });

  test('a non-contiguous set uses a list and markers apart keep separate labels', () => {
    const groups = groupCoincidentMarkers([
      { id: 'a', number: 1, x: 100, y: 50 },
      { id: 'b', number: 2, x: 400, y: 50 },
      { id: 'c', number: 3, x: 104, y: 56 },
    ]);
    expect(groups.map((group) => group.text).sort()).toEqual(['1,3', '2']);
    const near = groups.find((group) => group.text === '1,3');
    expect(near?.y).toBe(50);
    expect(near?.x).toBe(102);
  });

  test('grouping is transitive across a chain of near neighbours', () => {
    const groups = groupCoincidentMarkers(
      [0, 10, 20].map((x, index) => ({ id: `s${index}`, number: index + 1, x, y: 0 }))
    );
    expect(groups.map((group) => group.text)).toEqual(['1–3']);
  });

  test('hidden series are simply absent, so the shared label shrinks', () => {
    const groups = groupCoincidentMarkers([
      { id: 'a', number: 1, x: 10, y: 10 },
      { id: 'c', number: 3, x: 10, y: 10 },
      { id: 'd', number: 4, x: 10, y: 10 },
    ]);
    expect(groups[0].text).toBe('1,3,4');
  });

  test('number formatting compresses runs of three or more only', () => {
    expect(formatSeriesNumbers([5, 1, 2, 3])).toBe('1–3,5');
    expect(formatSeriesNumbers([2, 1])).toBe('1,2');
    expect(formatSeriesNumbers([7])).toBe('7');
    expect(formatSeriesNumbers([1, 1, 2, 3, 4])).toBe('1–4');
  });
});

describe('axis label anchoring', () => {
  test('marker labels at a plot edge anchor inward', () => {
    expect(edgeAnchor(58, 58, 1000, 12)).toBe('start');
    expect(edgeAnchor(995, 58, 1000, 12)).toBe('end');
    expect(edgeAnchor(500, 58, 1000, 12)).toBe('middle');
  });
});
