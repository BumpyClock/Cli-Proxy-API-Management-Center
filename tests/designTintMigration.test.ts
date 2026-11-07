import { describe, expect, test } from 'bun:test';
import { compileString } from 'sass';
import { tokens } from '@/design-system/tokens';
import { renderTokensScss } from '../scripts/design-tokens/generate';
import { migrateScss } from '../scripts/design-tokens/migrate';
import { scanScssText } from '../scripts/design-tokens/guard';

const compile = (source: string) => compileString(renderTokensScss(tokens) + source).css;

describe('canonical colour composition', () => {
  test.each([
    ['rgba($color-base-white, 0.2)', '$opacity-0-2'],
    ['rgb(var(--channels) / 25%)', '$tint-0-25'],
    ['color-mix(in srgb, var(--info-color) 10%, transparent)', '$tint-0-1'],
    [
      'color-mix(in srgb, color-mix(in srgb, var(--info-color) 20%, var(--warning-color)) 35%, var(--bg-primary))',
      '$tint-0-35',
    ],
    ['rgba(255, 255, 255, 0.2)', '$opacity-0-2'],
  ])('migrates %s without changing rendered CSS', (value, expected) => {
    const source = '.probe { color: ' + value + '; }';
    const migrated = migrateScss('src/probe.module.scss', source);
    expect(migrated).toContain(expected);
    expect(compile(migrated)).toBe(compile(source));
    expect(migrateScss('src/probe.module.scss', migrated)).toBe(migrated);
    expect(scanScssText('src/probe.module.scss', migrated)).toEqual([]);
  });

  test('one opacity edit changes both unitless alpha and percentage adapters', () => {
    const edited = {
      ...tokens,
      opacity: { ...tokens.opacity, '0-2': 0.37 },
    } as unknown as typeof tokens;
    const css = compileString(
      renderTokensScss(edited) +
        '.probe { opacity: $opacity-0-2; color: color-mix(in srgb, var(--info-color) $tint-0-2, transparent); }'
    ).css;
    expect(css).toContain('opacity: 0.37');
    expect(css).toContain('var(--info-color) 37%');
  });
});
