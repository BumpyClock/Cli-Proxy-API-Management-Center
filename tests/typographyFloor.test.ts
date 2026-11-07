import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Glob } from 'bun';
import { chart, fontSize } from '@/design-system/tokens';

// Metadata, counts, badges, chart labels and log lines share one 12px reading floor. The rendered
// census (tests/visual-audit) found text at 9-11.5px in the sidebar, logs, quota and chart labels.
const FLOOR_PX = 12;

const files = (pattern: string) => [...new Glob(pattern).scanSync({ cwd: 'src' })];

const sizesBelowFloor = (source: string, pattern: RegExp) =>
  [...source.matchAll(pattern)].map((match) => Number(match[1])).filter((size) => size < FLOOR_PX);

describe('typography floor', () => {
  test('no stylesheet sets text below 12px', () => {
    const offenders = files('**/*.scss').flatMap((file) =>
      sizesBelowFloor(readFileSync(`src/${file}`, 'utf8'), /font-size:\s*(\d+(?:\.\d+)?)px/g).map(
        (size) => `${file}: ${size}px`
      )
    );
    expect(offenders).toEqual([]);
  });

  test('no component sets an inline or SVG font size below 12px', () => {
    const offenders = files('**/*.tsx').flatMap((file) =>
      sizesBelowFloor(
        readFileSync(`src/${file}`, 'utf8'),
        // Pixel sizes only: numbers or 'Npx'. Relative em/rem sizes are scaled from a parent.
        /fontSize(?:=\{|:\s*)['"]?(\d+(?:\.\d+)?)(?![\d.]|r?em)/g
      ).map((size) => `${file}: ${size}px`)
    );
    expect(offenders).toEqual([]);
  });

  // Stylesheets and components take sizes from the registry, so the floor applies there too.
  test('the registry type scale and chart labels stay at or above 12px', () => {
    const pixelSizes = Object.values(fontSize).filter((size) => typeof size === 'number');
    expect(pixelSizes.filter((size) => size < FLOOR_PX)).toEqual([]);
    expect(chart.axisFontSize).toBeGreaterThanOrEqual(FLOOR_PX);
    expect(chart.tooltip.fontSize).toBeGreaterThanOrEqual(FLOOR_PX);
  });
});
