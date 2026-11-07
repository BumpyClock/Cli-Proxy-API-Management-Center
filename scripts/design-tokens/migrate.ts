/// <reference types="node" />

/**
 * One-shot, rerunnable codemod that rewrites literal design values in src/**\/*.scss into
 * references to the generated registry variables.
 *
 *   bun scripts/design-tokens/migrate.ts          rewrite files, report unmapped literals
 *   bun scripts/design-tokens/migrate.ts --dry    report only
 *
 * Idempotent: a second run finds nothing to rewrite. Any literal without a registry entry is
 * reported with file:line and left untouched, so the guard test keeps failing until the
 * registry gains the token.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokens } from '../../src/design-system/tokens.ts';
import { scanScss, insideKeyframes } from './scss-scanner.ts';
import { classifyValue, type LiteralHit, type TokenCategory } from './classify.ts';
import { canonicalColor, normalizeCss } from './css-normalize.ts';
import { tintSteps } from './generate.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dry = process.argv.includes('--dry');

/** Generated or registry-owned files the codemod never touches. */
export const EXCLUDED_SCSS = new Set([
  'src/styles/variables.scss',
  'src/styles/themes.scss',
  'src/design-system/generated/_tokens.scss',
  'src/design-system/generated/_themes.scss',
]);

const LEGACY_RENAMES: Record<string, string> = {
  '$primary-color': '$color-legacy-primary',
  '$success-color': '$color-legacy-success',
  '$warning-color': '$color-legacy-warning',
  '$error-color': '$color-legacy-error',
  '$gray-400': '$color-legacy-gray-400',
  '$spacing-xs': '$space-4',
  '$spacing-sm': '$space-8',
  '$spacing-md': '$space-16',
  '$spacing-lg': '$space-24',
  '$spacing-xl': '$space-32',
  '$spacing-2xl': '$space-48',
  '$radius-sm': '$radius-4',
  '$radius-md': '$radius-8',
  '$radius-lg': '$radius-12',
  '$radius-full': '$radius-9999',
  '$font-family': '$font-family-sans',
  '$font-mono': '$font-family-mono',
};

const isValueKey = (key: string) => /^\d[\d-]*(px|em|rem)?$/.test(key);

/** value text -> sass variable, preferring value-keyed steps over role names. */
function reverse(prefix: string, values: Record<string, number | string>, unit: string) {
  const map = new Map<string, string>();
  const entries = Object.entries(values).sort(
    ([a], [b]) => Number(isValueKey(b)) - Number(isValueKey(a))
  );
  for (const [key, value] of entries) {
    const text = typeof value === 'number' ? `${value}${unit}` : value;
    if (!map.has(text)) map.set(text, `$${prefix}-${key}`);
  }
  return map;
}

const SCALES: Partial<Record<TokenCategory, Map<string, string>>> = {
  fontSize: reverse('font-size', tokens.fontSize, 'px'),
  lineHeight: reverse('line-height', tokens.lineHeight, ''),
  letterSpacing: reverse('letter-spacing', tokens.letterSpacing, 'em'),
  fontWeight: reverse('font-weight', tokens.fontWeight, ''),
  space: reverse('space', tokens.space, 'px'),
  size: reverse('size', tokens.size, 'px'),
  radius: reverse('radius', tokens.radius, 'px'),
  borderWidth: reverse('border-width', tokens.borderWidth, 'px'),
  blur: reverse('blur', tokens.blur, 'px'),
  opacity: reverse('opacity', tokens.opacity, ''),
  tint: reverse('tint', tintSteps(tokens.opacity), ''),
  z: reverse('z', tokens.z, ''),
  duration: reverse('duration', tokens.duration, 'ms'),
  delay: reverse('delay', tokens.delay, 'ms'),
  distance: reverse('distance', tokens.distance, 'px'),
  scale: reverse('motion-scale', tokens.motionScale, ''),
};

const EASING = new Map<string, string>();
for (const [key, value] of Object.entries(tokens.easing))
  if ('css' in value) EASING.set(normalizeCss(value.css), `$ease-${key}`);

const SHADOWS = new Map<string, string>();
for (const [key, value] of Object.entries(tokens.shadow))
  SHADOWS.set(normalizeCss(value), `$shadow-${key}`);

/** rgb triple -> palette variable. */
const PALETTE = new Map<string, string>();
/** Exact-text palette entries that are not sRGB hex/rgb (Display P3). */
const PALETTE_EXACT = new Map<string, string>();
const walkPalette = (prefix: string, value: unknown) => {
  if (typeof value === 'string' && value.startsWith('color(')) {
    PALETTE_EXACT.set(normalizeCss(value), prefix);
  } else if (typeof value === 'string') {
    const rgb = canonicalColor(value)?.rgb;
    if (rgb && !PALETTE.has(rgb)) PALETTE.set(rgb, prefix);
  } else if (value && typeof value === 'object')
    for (const [key, child] of Object.entries(value)) walkPalette(`${prefix}-${key}`, child);
};
for (const [group, value] of Object.entries(tokens.palette)) {
  if (group !== 'provider' && group !== 'theme-surface-icon') walkPalette(`$color-${group}`, value);
}

const LEGACY_COLOR_VALUES: Record<string, string> = {
  '$primary-color': tokens.palette.legacy.primary,
  '$color-legacy-primary': tokens.palette.legacy.primary,
  '$success-color': tokens.palette.legacy.success,
  '$color-legacy-success': tokens.palette.legacy.success,
  '$warning-color': tokens.palette.legacy.warning,
  '$color-legacy-warning': tokens.palette.legacy.warning,
  '$error-color': tokens.palette.legacy.error,
  '$color-legacy-error': tokens.palette.legacy.error,
};

/** Resolve Sass colour expressions to CSS so composite values can match registry strings. */
const resolveSassColors = (value: string) =>
  value
    .replace(/#\{'([^']*)'\}/g, '$1')
    .replace(/rgba\((\$[\w-]+),\s*([\d.]+)\)/g, (m, name: string, alpha: string) => {
      const hex = LEGACY_COLOR_VALUES[name];
      if (!hex) return m;
      const c = canonicalColor(hex)!;
      return `rgba(${c.rgb}, ${alpha})`;
    });

/** Custom properties defined on :root by the generated themes or global layout styles. */
const GLOBAL_CUSTOM_PROPERTIES = new Set<string>([
  ...Object.keys(tokens.themes.light).map((k) => `--${k}`),
  '--header-height',
  '--shell-gutter',
  '--sidebar-panel-width',
  '--sidebar-collapsed-width',
  '--sidebar-active-width',
  '--sidebar-gap',
  '--floating-control-size',
]);

/** Remove `var(--x, fallback)` fallbacks for always-defined properties. */
export function stripGlobalFallbacks(value: string): string {
  let out = '';
  let k = 0;
  while (k < value.length) {
    const m = /var\(\s*(--[\w-]+)\s*,/y;
    m.lastIndex = k;
    const hit = value.startsWith('var(', k) ? m.exec(value) : null;
    if (hit && GLOBAL_CUSTOM_PROPERTIES.has(hit[1])) {
      let depth = 1;
      let j = k + 4;
      while (j < value.length && depth > 0) {
        if (value[j] === '(') depth += 1;
        else if (value[j] === ')') depth -= 1;
        j += 1;
      }
      out += `var(${hit[1]})`;
      k = j;
    } else {
      out += value[k];
      k += 1;
    }
  }
  return out;
}

interface Unmapped {
  file: string;
  line: number;
  category: string;
  text: string;
  prop: string;
}
const unmapped: Unmapped[] = [];
let rewrites = 0;

function replacementFor(hit: LiteralHit, prop: string, inCustomProperty: boolean): string | null {
  const wrap = (name: string) => (inCustomProperty ? `#{${name}}` : name);
  if (hit.category === 'color') {
    const exact = PALETTE_EXACT.get(normalizeCss(hit.text));
    if (exact) return wrap(exact);
    const c = canonicalColor(hit.text);
    if (!c) return null;
    const name = PALETTE.get(c.rgb);
    if (!name) return null;
    if (c.alpha === 1) return wrap(name);
    const alpha = SCALES.opacity?.get(String(c.alpha));
    return alpha ? wrap(`rgba(${name}, ${alpha})`) : null;
  }
  if (hit.category === 'easing') return EASING.get(normalizeCss(hit.text)) ?? null;
  if (hit.category === 'shadow') {
    const name = SHADOWS.get(normalizeCss(resolveSassColors(hit.text)));
    return name ? wrap(name) : null;
  }
  const scale = SCALES[hit.category];
  if (!scale) return null;
  let text = hit.text;
  const negative = text.startsWith('-');
  if (negative) text = text.slice(1);
  if (hit.category === 'duration' || hit.category === 'delay') {
    const ms = text.endsWith('ms') ? Number.parseFloat(text) : Number.parseFloat(text) * 1000;
    text = `${Number(ms.toFixed(3))}ms`;
  }
  if (/^\./.test(text)) text = `0${text}`;
  const name = scale.get(text);
  if (!name) return null;
  if (prop === 'z-index' && negative) return null;
  return wrap(negative ? `(-${name})` : name);
}

function rewriteMediaPrelude(prelude: string): string {
  return prelude.replace(
    /\((max|min)-(width|height):\s*(\d+(?:\.\d+)?)px\)/g,
    (m, bound: string, axis: string, raw: string) => {
      const value = Number(raw);
      const table = axis === 'width' ? tokens.breakpoint : tokens.breakpointHeight;
      const prefix = axis === 'width' ? 'breakpoint' : 'breakpoint-height';
      const entries = Object.entries(table).sort(
        ([a], [b]) => Number(isValueKey(a)) - Number(isValueKey(b))
      );
      const exact = entries.find(([, v]) => v === value);
      if (exact) return `(${bound}-${axis}: #{$${prefix}-${exact[0]}})`;
      const above = bound === 'min' && entries.find(([, v]) => v + 1 === value);
      if (above) return `(${bound}-${axis}: #{$${prefix}-${above[0]} + 1px})`;
      return m;
    }
  );
}

export function migrateScss(file: string, text: string): string {
  let out = text;
  for (const [from, to] of Object.entries(LEGACY_RENAMES)) {
    out = out.replace(new RegExp(`\\${from}(?![\\w-])`, 'g'), to);
  }
  // Media queries first (they never overlap declarations).
  for (const at of [...scanScss(out).atRules].reverse()) {
    if (at.name !== 'media') continue;
    const next = rewriteMediaPrelude(at.prelude);
    if (next !== at.prelude) {
      out = out.slice(0, at.preludeStart) + next + out.slice(at.preludeEnd);
      rewrites += 1;
    }
  }
  const declarations = scanScss(out).declarations;
  for (const decl of [...declarations].reverse()) {
    let value = stripGlobalFallbacks(decl.value);
    const hits = classifyValue(decl.prop, value, insideKeyframes(decl));
    const inCustomProperty = decl.prop.startsWith('--');
    for (const hit of [...hits].sort((a, b) => b.start - a.start)) {
      const replacement = replacementFor(hit, decl.prop, inCustomProperty);
      if (replacement === null) {
        unmapped.push({
          file,
          line: decl.line,
          category: hit.category,
          text: hit.text.replace(/\s+/g, ' '),
          prop: decl.prop,
        });
        continue;
      }
      value = value.slice(0, hit.start) + replacement + value.slice(hit.end);
      rewrites += 1;
    }
    if (value !== decl.value)
      out = out.slice(0, decl.valueStart) + value + out.slice(decl.valueEnd);
  }
  return out;
}

export const listScssFiles = (): string[] =>
  readdirSync(path.join(root, 'src'), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.scss'))
    .map((f) => `src/${f}`)
    .filter((f) => !EXCLUDED_SCSS.has(f))
    .sort();

if (import.meta.main) {
  let changedFiles = 0;
  for (const file of listScssFiles()) {
    const text = readFileSync(path.join(root, file), 'utf8');
    const next = migrateScss(file, text);
    if (next !== text) {
      changedFiles += 1;
      if (!dry) writeFileSync(path.join(root, file), next);
    }
  }
  const byCategory = new Map<string, Unmapped[]>();
  for (const u of unmapped) byCategory.set(u.category, [...(byCategory.get(u.category) ?? []), u]);
  for (const [category, list] of byCategory) {
    console.log(`\n== unmapped ${category} (${list.length})`);
    for (const u of list) console.log(`  ${u.file}:${u.line} ${u.prop}: ${u.text}`);
  }
  console.log(
    `\n${dry ? 'would rewrite' : 'rewrote'} ${rewrites} literals in ${changedFiles} files; unmapped ${unmapped.length}`
  );
}
