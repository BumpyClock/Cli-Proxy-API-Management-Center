/**
 * Generates the Sass adapters for src/design-system/tokens.ts.
 *
 *   bun run tokens         write src/design-system/generated/* when they differ
 *   bun run tokens:check   exit 1 when the checked-in output is stale
 *
 * The Vite plugin in vite.config.ts calls `writeGeneratedFiles` on dev-server start, on every
 * registry edit in dev, and at build start. tests/designTokens.test.ts compares the
 * checked-in files with `renderGeneratedFiles` in memory.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Tokens = typeof import('../../src/design-system/tokens.ts').tokens;

export const GENERATED_DIR = 'src/design-system/generated';
export const GENERATED_FILES = {
  tokens: `${GENERATED_DIR}/_tokens.scss`,
  themes: `${GENERATED_DIR}/_themes.scss`,
} as const;

const HEADER = [
  '// GENERATED FILE. Do not edit.',
  '// Source: src/design-system/tokens.ts. Regenerate with `bun run tokens`.',
  '',
].join('\n');

type Scalar = number | string;

const length = (value: Scalar, unit: string) =>
  typeof value === 'number' ? `${value}${unit}` : value;

/** Percentage adapter for the canonical unitless opacity scale. */
export const tintSteps = (values: Record<string, number>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, `${Number((value * 100).toFixed(6))}%`])
  );

const scalarGroups = (
  t: Tokens
): Array<{ prefix: string; values: Record<string, Scalar>; unit: string }> => [
  { prefix: 'font-size', values: t.fontSize, unit: 'px' },
  { prefix: 'line-height', values: t.lineHeight, unit: '' },
  { prefix: 'letter-spacing', values: t.letterSpacing, unit: 'em' },
  { prefix: 'font-weight', values: t.fontWeight, unit: '' },
  { prefix: 'space', values: t.space, unit: 'px' },
  { prefix: 'size', values: t.size, unit: 'px' },
  { prefix: 'radius', values: t.radius, unit: 'px' },
  { prefix: 'border-width', values: t.borderWidth, unit: 'px' },
  { prefix: 'blur', values: t.blur, unit: 'px' },
  { prefix: 'opacity', values: t.opacity, unit: '' },
  { prefix: 'tint', values: tintSteps(t.opacity), unit: '' },
  { prefix: 'z', values: t.z, unit: '' },
  { prefix: 'breakpoint', values: t.breakpoint, unit: 'px' },
  { prefix: 'breakpoint-height', values: t.breakpointHeight, unit: 'px' },
  { prefix: 'duration', values: t.duration, unit: 'ms' },
  { prefix: 'delay', values: t.delay, unit: 'ms' },
  { prefix: 'distance', values: t.distance, unit: 'px' },
  { prefix: 'motion-scale', values: t.motionScale, unit: '' },
];

const flattenColors = (
  prefix: string,
  value: unknown,
  out: Array<[string, string]>
): Array<[string, string]> => {
  if (typeof value === 'string') out.push([prefix, value]);
  else if (value && typeof value === 'object')
    for (const [key, child] of Object.entries(value)) flattenColors(`${prefix}-${key}`, child, out);
  return out;
};

export function renderTokensScss(t: Tokens): string {
  const lines: string[] = [
    HEADER,
    '// Sass variables only: this partial is injected into every module and emits no CSS.',
    '',
  ];
  const section = (title: string) => lines.push('', `// ${title}`);

  section('Font families');
  for (const [key, value] of Object.entries(t.fontFamily))
    lines.push(`$font-family-${key}: ${value};`);

  for (const group of scalarGroups(t)) {
    section(group.prefix);
    for (const [key, value] of Object.entries(group.values))
      lines.push(`$${group.prefix}-${key}: ${length(value, group.unit)};`);
  }

  section('easing');
  for (const [key, value] of Object.entries(t.easing))
    if ('css' in value) lines.push(`$ease-${key}: ${value.css};`);

  section('transition presets');
  for (const [key, value] of Object.entries(t.transition))
    lines.push(
      `$transition-${key}: ${t.duration[value.duration]}ms ${t.easing[value.easing].css};`
    );

  section('shadow');
  // Sass cannot parse rec2100 colour spaces, so composite values that use them stay strings.
  for (const [key, value] of Object.entries(t.shadow))
    lines.push(`$shadow-${key}: ${value.includes('rec2100') ? `#{'${value}'}` : value};`);

  section('static palette (theme colours are custom properties in _themes.scss)');
  // Provider badges are a TS-only palette.
  const sassPalette = Object.fromEntries(
    Object.entries(t.palette).filter(([group]) => group !== 'provider')
  );
  for (const [name, value] of flattenColors('color', sassPalette, []))
    lines.push(`$${name}: ${value};`);

  return `${lines.join('\n')}\n`;
}

const customProperties = (values: Record<string, string>, indent = '  ') =>
  Object.entries(values).map(([key, value]) => `${indent}--${key}: ${value};`);

export function renderThemesScss(t: Tokens): string {
  const { light, ...overrides } = t.themes;
  const lines: string[] = [HEADER, ':root {', ...customProperties(light), '}'];
  for (const [name, values] of Object.entries(overrides)) {
    lines.push('', `[data-theme='${name}'] {`, ...customProperties(values), '}');
  }
  lines.push(
    '',
    `@media (max-width: ${t.breakpoint.mobile}px),`,
    '  (prefers-reduced-motion: reduce),',
    '  (prefers-reduced-transparency: reduce) {',
    '  :root {',
    ...customProperties(t.opaqueGlass, '    '),
    '  }',
    '}'
  );
  return `${lines.join('\n')}\n`;
}

export function renderGeneratedFiles(t: Tokens): Record<string, string> {
  return {
    [GENERATED_FILES.tokens]: renderTokensScss(t),
    [GENERATED_FILES.themes]: renderThemesScss(t),
  };
}

/** Writes files whose content changed; returns the paths written. */
export function writeGeneratedFiles(root: string, t: Tokens): string[] {
  const written: string[] = [];
  for (const [file, content] of Object.entries(renderGeneratedFiles(t))) {
    const target = path.join(root, file);
    let current: string | null;
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      current = null;
    }
    if (current === content) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    written.push(file);
  }
  return written;
}

export function staleGeneratedFiles(root: string, t: Tokens): string[] {
  return Object.entries(renderGeneratedFiles(t))
    .filter(([file, content]) => {
      try {
        return readFileSync(path.join(root, file), 'utf8') !== content;
      } catch {
        return true;
      }
    })
    .map(([file]) => file);
}

if (import.meta.main ?? process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const { tokens } = await import('../../src/design-system/tokens.ts');
  if (process.argv.includes('--check')) {
    const stale = staleGeneratedFiles(root, tokens);
    if (stale.length > 0) {
      console.error(`Design token output is stale: ${stale.join(', ')}. Run \`bun run tokens\`.`);
      process.exit(1);
    }
    console.log('Design token output is up to date.');
  } else {
    const written = writeGeneratedFiles(root, tokens);
    console.log(written.length ? `Wrote ${written.join(', ')}` : 'Design token output unchanged.');
  }
}
