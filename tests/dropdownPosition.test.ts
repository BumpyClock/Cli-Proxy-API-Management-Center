import { describe, expect, test } from 'bun:test';
import { resolveDropdownStyle } from '@/components/ui/dropdownPosition';

describe('anchored dropdown placement', () => {
  test('opens below the field when space is available', () => {
    expect(
      resolveDropdownStyle({ top: 20, bottom: 60, left: 20, width: 200 }, 500, 800, 200)
    ).toMatchObject({ position: 'fixed', top: 66, left: 20, width: 200, maxHeight: 200 });
  });
  test('opens upward near the viewport bottom', () => {
    const style = resolveDropdownStyle(
      { top: 700, bottom: 740, left: 20, width: 200 },
      500,
      768,
      200
    );
    expect(style).toMatchObject({ bottom: 74, maxHeight: 200 });
    expect(style.top).toBeUndefined();
  });
  test('keeps wide fields and their menus inside a narrow viewport', () => {
    expect(
      resolveDropdownStyle({ top: 20, bottom: 60, left: -20, width: 500 }, 320, 800, 200)
    ).toMatchObject({ left: 8, width: 304 });
  });
  test('aligns a right-edge field without horizontal overflow', () => {
    expect(
      resolveDropdownStyle({ top: 20, bottom: 60, left: 470, width: 300 }, 500, 800, 200)
    ).toMatchObject({ left: 192, width: 300 });
  });
  test('never assigns negative menu dimensions in tiny viewports', () => {
    const style = resolveDropdownStyle({ top: 0, bottom: 40, left: 0, width: 200 }, 10, 10, 200);
    expect(style.width).toBe(0);
    expect(style.maxHeight).toBe(0);
  });
});
