import { describe, expect, test } from 'bun:test';
import { resolveFloatingMenuPosition } from '@/hooks/useFloatingMenuPosition';

const viewport = { width: 390, height: 600 };
const menu = { width: 220, height: 230 };

describe('floating row menus', () => {
  test('opens below a trigger when the whole menu fits', () => {
    expect(
      resolveFloatingMenuPosition({ top: 50, bottom: 82, right: 350 }, menu, viewport)
    ).toEqual({ top: 88, right: 40, maxHeight: 504 });
  });

  test('flips above the last row rather than clipping its last action', () => {
    expect(
      resolveFloatingMenuPosition({ top: 540, bottom: 572, right: 350 }, menu, viewport)
    ).toEqual({ bottom: 66, right: 40, maxHeight: 526 });
  });

  test('clamps both horizontal edges for narrow screens and offscreen anchors', () => {
    const left = resolveFloatingMenuPosition({ top: 50, bottom: 82, right: 100 }, menu, viewport);
    const right = resolveFloatingMenuPosition({ top: 50, bottom: 82, right: 500 }, menu, viewport);
    expect(left.right).toBe(162);
    expect(right.right).toBe(8);
  });

  test('an oversized menu scrolls in the larger available space', () => {
    const style = resolveFloatingMenuPosition(
      { top: 200, bottom: 244, right: 350 },
      { ...menu, height: 800 },
      viewport
    );
    expect(style).toEqual({ top: 250, right: 40, maxHeight: 342 });
  });

  test('offscreen anchors cannot produce a negative scroll region', () => {
    for (const top of [-200, 900]) {
      const style = resolveFloatingMenuPosition(
        { top, bottom: top + 44, right: 350 },
        menu,
        viewport
      );
      expect(Number(style.maxHeight)).toBeGreaterThanOrEqual(0);
      expect(Number(style.maxHeight)).toBeLessThanOrEqual(584);
    }
  });
});
