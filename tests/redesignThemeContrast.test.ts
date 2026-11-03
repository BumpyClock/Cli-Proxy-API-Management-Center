import { describe, expect, test } from 'bun:test';
import { compile } from 'sass';

const { css } = compile('src/styles/themes.scss');
const declarations = (selector: string) => {
  const body = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)].find(
    (match) => match[1].trim() === selector
  )?.[2];
  if (!body) throw new Error(`Missing theme ${selector}`);
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()])
  );
};
const base = declarations(':root');
const themes = {
  light: base,
  white: { ...base, ...declarations('[data-theme=white]') },
  dark: { ...base, ...declarations('[data-theme=dark]') },
};
const luminance = (color: string) => {
  if (!/^#[\da-f]{6}$/i.test(color)) throw new Error(`Expected a six-digit color, got ${color}`);
  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const contrast = (foreground: string, background: string) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
};

describe('redesign semantic color roles', () => {
  for (const [name, tokens] of Object.entries(themes)) {
    test(`${name} primary actions retain readable foregrounds`, () => {
      expect(
        contrast(tokens['--primary-color'], tokens['--primary-contrast'])
      ).toBeGreaterThanOrEqual(7);
      expect(contrast(tokens['--error-color'], tokens['--danger-contrast'])).toBeGreaterThanOrEqual(
        4.5
      );
    });

    test(`${name} body text and focus indicators remain readable across surfaces`, () => {
      for (const surface of ['--bg-primary', '--bg-secondary', '--bg-tertiary', '--sidebar-bg']) {
        expect(contrast(tokens['--text-primary'], tokens[surface])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens['--text-secondary'], tokens[surface])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens['--focus-ring'], tokens[surface])).toBeGreaterThanOrEqual(3);
      }
      for (const surface of ['--bg-primary', '--bg-tertiary']) {
        expect(contrast(tokens['--text-tertiary'], tokens[surface])).toBeGreaterThanOrEqual(4.5);
      }
    });

    test(`${name} chart strokes remain visible and warnings differ from failures`, () => {
      for (let index = 1; index <= 6; index += 1) {
        expect(contrast(tokens[`--chart-${index}`], tokens['--bg-primary'])).toBeGreaterThanOrEqual(
          3
        );
      }
      expect(tokens['--warning-color']).not.toBe(tokens['--error-color']);
      for (const role of ['--warning-color', '--error-color', '--success-color']) {
        expect(contrast(tokens[role], tokens['--bg-primary'])).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
