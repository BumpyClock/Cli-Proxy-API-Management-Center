import { describe, expect, test } from 'bun:test';
import {
  listSourceFiles,
  scanRepository,
  scanScssText,
  scanTsFiles,
  scanTsText,
  type Violation,
} from '../scripts/design-tokens/guard';

const rules = (violations: Violation[]) => violations.map((v) => v.rule);

describe('design token drift guard', () => {
  test('scans every stylesheet and TS/TSX module under src', () => {
    const files = listSourceFiles('.');
    expect(files.filter((f) => f.endsWith('.scss')).length).toBeGreaterThan(90);
    expect(files.filter((f) => f.endsWith('.tsx')).length).toBeGreaterThan(140);
    // Only the authored registry and generated output are excluded.
    expect(files).not.toContain('src/design-system/tokens.ts');
    expect(files).toContain('src/design-system/index.ts');
    expect(files).toContain('src/styles/variables.scss');
  });

  test('the source tree has no raw design values', () => {
    const violations = scanRepository('.').map((v) => `${v.file}:${v.line} [${v.rule}] ${v.text}`);
    expect(violations).toEqual([]);
  });
});

describe('SCSS rules catch injected violations', () => {
  const scss = (body: string) => rules(scanScssText('src/probe.module.scss', body));

  test.each([
    ['raw colour', '.a { color: #fff; }', 'raw-color'],
    ['named colour', '.a { color: RebeccaPurple; }', 'raw-color'],
    ['raw rgba', '.a { background: rgba(0, 0, 0, 0.4); }', 'raw-color'],
    ['raw tint alpha', '.a { background: rgba($color-base-white, 0.2); }', 'raw-opacity'],
    ['raw slash alpha', '.a { color: rgb(var(--channels) / 25%); }', 'raw-tint'],
    [
      'raw mix weight',
      '.a { color: color-mix(in srgb, var(--info-color) 10%, transparent); }',
      'raw-tint',
    ],
    ['raw spacing', '.a { padding: 12px; }', 'raw-space'],
    ['raw negative spacing', '.a { margin: 0 -6px; }', 'raw-space'],
    ['raw size', '.a { min-height: 44px; }', 'raw-size'],
    ['raw font size', '.a { font-size: 13px; }', 'raw-fontSize'],
    ['raw font family', '.a { font-family: Arial, sans-serif; }', 'raw-fontFamily'],
    ['raw font weight', '.a { font-weight: 600; }', 'raw-fontWeight'],
    ['raw line height', '.a { line-height: 1.4; }', 'raw-lineHeight'],
    ['raw radius', '.a { border-radius: 8px; }', 'raw-radius'],
    ['raw border width', '.a { border: 1px solid var(--border-color); }', 'raw-borderWidth'],
    ['raw shadow', '.a { box-shadow: 0 1px 2px var(--x); }', 'raw-shadow'],
    ['raw z-index', '.a { z-index: 10; }', 'raw-z'],
    ['raw opacity', '.a { opacity: 0.6; }', 'raw-opacity'],
    ['raw duration', '.a { transition: color 200ms ease; }', 'raw-duration'],
    ['raw easing', '.a { transition: color $duration-200 ease-out; }', 'raw-easing'],
    ['raw delay', '.a { animation: x $duration-200 $ease-out 40ms; }', 'raw-delay'],
    [
      'raw keyframe distance',
      '@keyframes k { from { transform: translateY(8px); } }',
      'raw-distance',
    ],
    ['raw keyframe scale', '@keyframes k { from { transform: scale(0.97); } }', 'raw-scale'],
    ['raw blur', '.a { backdrop-filter: blur(4px); }', 'raw-blur'],
    ['raw media query', '@media (max-width: 768px) { .a { color: red; } }', 'raw-media'],
    ['local Sass token', '$gap: 4px;\n.a { gap: $gap; }', 'local-sass-token'],
    ['theme fallback literal', '.a { color: var(--text-primary, #333); }', 'var-fallback'],
    ['unclassified property', '.a { font: 12px $font-family-mono; }', 'raw-unclassified'],
    ['raw mixin argument', '.a { @include fade(28px); }', 'raw-include'],
    ['declaration after a comment', '.a { /* note */ padding: 3px; }', 'raw-space'],
  ])('%s', (_name: string, body: string, rule: string) => {
    expect(scss(body)).toContain(rule);
  });

  test('structural values and token references pass', () => {
    expect(
      scss(
        [
          '.a { margin: 0; width: 100%; flex: 1 1 0; grid-template-columns: 1fr auto; }',
          '.b { padding: $space-12 (-$space-4); color: var(--text-primary); opacity: 1; }',
          '.c { transition: color $duration-hover $ease-out; transform: translateX(-50%); }',
          '.d { background: color-mix(in srgb, var(--info-color) $tint-0-1, transparent); }',
          '.e { border: $border-width-1 solid rgba($color-legacy-warning, $opacity-0-2); }',
          '@media (max-width: #{$breakpoint-mobile}), (pointer: coarse) { .f { z-index: 1; } }',
          '.g { transform: rotate(180deg); top: var(--content-center-x, 50%); }',
          '.h { font-family: $font-family-mono; } .i { font-family: inherit; }',
        ].join('\n')
      )
    ).toEqual([]);
  });
});

describe('TS rules catch injected violations', () => {
  const tsx = (body: string, file = 'src/probe.tsx') => rules(scanTsText(file, body));

  test.each([
    ['inline colour', "const c = '#c65746';", 'ts-color-literal'],
    [
      'named style colour',
      "const a = <div style={{ color: 'rebeccapurple' }} />;",
      'ts-style-literal',
    ],
    ['named SVG colour', 'const a = <svg><text fill="blue" /></svg>;', 'ts-visual-attr'],
    ['inline rgba', "const shadow = 'rgba(0, 0, 0, 0.2)';", 'ts-color-literal'],
    [
      'style mix weight',
      "const a = <div style={{ color: 'color-mix(in srgb, var(--info-color) 10%, transparent)' }} />;",
      'ts-style-literal',
    ],
    ['style object spacing', 'const a = <div style={{ padding: 12 }} />;', 'ts-style-literal'],
    ['style object string', "const a = <div style={{ margin: '1rem 0' }} />;", 'ts-style-literal'],
    ['style object z-index', 'const a = <div style={{ zIndex: 1000 }} />;', 'ts-style-literal'],
    ['icon size', 'const a = <IconX size={18} />;', 'ts-visual-attr'],
    ['SVG text weight', 'const a = <svg><text fontWeight={600} /></svg>;', 'ts-visual-attr'],
    ['SVG text family', 'const a = <svg><text fontFamily="Arial" /></svg>;', 'ts-visual-attr'],
    ['style font family', "const a = <div style={{ fontFamily: 'Arial' }} />;", 'ts-style-literal'],
    ['DOM font family', "el.style.fontFamily = 'Arial';", 'ts-style-literal'],
    ['DOM font property', "el.style.setProperty('font-family', 'Arial');", 'ts-style-literal'],
    ['chart stroke', 'const a = <Line strokeWidth={2.5} />;', 'ts-visual-attr'],
    ['conditional stroke', 'const a = <Line strokeWidth={on ? 2.5 : 2} />;', 'ts-visual-attr'],
    [
      'indirect style const',
      'const PAD = 12;\nconst a = <div style={{ padding: PAD }} />;',
      'ts-style-literal',
    ],
    ['named visual constant', 'const MENU_OFFSET = 6;', 'ts-visual-constant'],
    ['named size constant', 'const ICON_SIZE = 18;', 'ts-visual-constant'],
    [
      'motion duration',
      'animate(el, { opacity: [0, 1] }, { duration: 0.28 });',
      'ts-motion-literal',
    ],
    [
      'motion ease string',
      "animate(el, { opacity: [0, 1] }, { ease: 'linear' });",
      'ts-motion-literal',
    ],
    ['transform distance', "el.style.transform = 'translateY(56px)';", 'ts-style-literal'],
    ['media query', "useMediaQuery('(max-width: 768px)');", 'ts-media-literal'],
    ['inline timer', 'window.setTimeout(close, 350);', 'ts-inline-timer'],
    ['css var fallback', "const c = 'var(--viz-success, var(--x))';", 'ts-var-fallback'],
  ])('%s', (_name: string, body: string, rule: string) => {
    expect(tsx(body)).toContain(rule);
  });

  test('token references, geometry and business numbers pass', () => {
    expect(
      tsx(
        [
          "import { duration, iconSize, space } from '@/design-system';",
          "const a = <IconX size={iconSize['18']} style={{ padding: space['12'], opacity: 1 }} />;",
          '<svg width={size} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>;',
          'const REQUEST_TIMEOUT_MS = 30_000;',
          'const PAGE_SIZE = 20;',
          'window.setTimeout(focus, 0);',
          "window.setTimeout(close, duration['modal-exit']);",
        ].join('\n')
      )
    ).toEqual([]);
  });

  test('SVG presentation attributes are artwork only in icon glyph files', () => {
    const body = '<svg><path d="M0 0" fillOpacity="0.12" /></svg>;';
    expect(tsx(body, 'src/components/ui/icons.tsx')).toEqual([]);
    expect(tsx(body, 'src/features/x/Chart.tsx')).toContain('ts-visual-attr');
  });

  test('an allow marker exempts exactly the next statement', () => {
    const body = [
      '// design-tokens: allow offscreen buffer, never rendered',
      "el.style.left = '-9999px';",
      "el.style.top = '-9999px';",
    ].join('\n');
    expect(scanTsText('src/probe.ts', body).map((v) => v.line)).toEqual([3]);
  });
});

test('an allow marker on a return covers that JSX tree, not the next statement', () => {
  const body = [
    'function Probe() {',
    '// design-tokens: allow offscreen measurement tree',
    'return (',
    '<div style={{ padding: 12 }} />',
    ');',
    '}',
    'const next = <div style={{ padding: 12 }} />;',
  ].join('\n');
  expect(scanTsText('src/probe.tsx', body).map((v) => v.line)).toEqual([7]);
});

describe('TS rules resolve values across modules', () => {
  /** A miniature registry and adapter barrel, so alias chains really end in the registry. */
  const designSystem = {
    'src/design-system/tokens.ts': [
      "export const space = { '4': 4, '12': 12 } as const;",
      'export const duration = { fast: 120 } as const;',
      "export const distance = { '6': 6 } as const;",
      'export const breakpoint = { mobile: 768 } as const;',
    ].join('\n'),
    'src/design-system/index.ts': [
      "import { breakpoint, distance, duration, space } from './tokens';",
      'export { breakpoint, distance, duration, space };',
      'export const px = (value: number) => `${value}px`;',
      'export const media = { mobile: `(max-width: ${breakpoint.mobile}px)` } as const;',
      "export const bar = { hiddenOffset: distance['6'], enter: { duration: duration.fast } };",
    ].join('\n'),
  };
  const scan = (files: Record<string, string>, target = 'src/probe.tsx') =>
    scanTsFiles({ ...designSystem, ...files }, [target]);
  const rulesOf = (files: Record<string, string>) => rules(scan(files));

  test.each([
    [
      'imported const in a style value',
      {
        'src/a.ts': 'export const foo = 12;',
        'src/probe.tsx': "import { foo } from './a';\n<div style={{ padding: foo }} />;",
      },
      'ts-style-literal',
    ],
    [
      'imported const through the @/ alias and a renamed barrel re-export',
      {
        'src/lib/a.ts': 'export const foo = 12;',
        'src/lib/index.ts': "export { foo as gap } from './a';",
        'src/probe.tsx': "import { gap } from '@/lib';\n<div style={{ gap }} />;",
      },
      'ts-style-literal',
    ],
    [
      'star re-export and a namespace import',
      {
        'src/lib/a.ts': "export const inset = '12px';",
        'src/lib/index.ts': "export * from './a';",
        'src/probe.tsx': "import * as lib from './lib';\n<div style={{ top: lib.inset }} />;",
      },
      'ts-style-literal',
    ],
    [
      'imported style object',
      {
        'src/styles.ts': 'export const card = { padding: 12 };',
        'src/probe.tsx': "import { card } from './styles';\n<div style={card} />;",
      },
      'ts-style-literal',
    ],
    [
      'property of an imported style map, spread into a style',
      {
        'src/styles.ts': "export const styles = { card: { margin: '1rem' } } as const;",
        'src/probe.tsx':
          "import { styles } from './styles';\n<div style={{ ...styles.card, opacity: 1 }} />;",
      },
      'ts-style-literal',
    ],
    [
      'indexed imported array',
      {
        'src/sizes.ts': 'export const sizes = [16, 20];',
        'src/probe.tsx': "import { sizes } from './sizes';\n<Icon size={sizes[1]} />;",
      },
      'ts-visual-attr',
    ],
    [
      'destructured imported object',
      {
        'src/pad.ts': 'export const pad = { x: 6 };',
        'src/probe.tsx':
          "import { pad } from './pad';\nconst { x } = pad;\n<div style={{ paddingLeft: x }} />;",
      },
      'ts-style-literal',
    ],
    [
      'imported animation duration',
      {
        'src/motion.ts': 'export const fade = 0.28;',
        'src/probe.tsx':
          "import { fade } from './motion';\nanimate(el, { opacity: [0, 1] }, { duration: fade });",
      },
      'ts-motion-literal',
    ],
    [
      'imported animate options object',
      {
        'src/motion.ts': 'export const options = { duration: 0.28 };',
        'src/probe.tsx':
          "import { options } from './motion';\nanimate(el, { opacity: [0, 1] }, options);",
      },
      'ts-motion-literal',
    ],
    [
      'named query source built from an imported breakpoint',
      {
        'src/bp.ts': 'export const MOBILE_BP = 768;',
        'src/queries.ts':
          "import { MOBILE_BP } from './bp';\nexport const QUERY = `(max-width: ${MOBILE_BP}px)`;",
        'src/probe.tsx': "import { QUERY } from './queries';\nuseMediaQuery(QUERY);",
      },
      'ts-media-literal',
    ],
    [
      'imported default export used as a chart attribute',
      {
        'src/height.ts': 'export default 240;',
        'src/probe.tsx': "import h from './height';\n<Chart height={h} />;",
      },
      'ts-visual-attr',
    ],
    [
      'imported const in an imperative style write',
      {
        'src/a.ts': "export const shift = 'translateY(8px)';",
        'src/probe.tsx': "import { shift } from './a';\nel.style.transform = shift;",
      },
      'ts-style-literal',
    ],
    [
      'raw fallback after a nullish default',
      { 'src/probe.tsx': 'const a = <Icon size={props.size ?? 16} />;' },
      'ts-visual-attr',
    ],
    [
      'same-file conditional behind a const',
      { 'src/probe.tsx': 'const w = on ? 30 : 24;\n<svg width={w} />;' },
      'ts-visual-attr',
    ],
  ])('%s', (_name: string, files: Record<string, string>, rule: string) => {
    expect(rulesOf(files)).toContain(rule);
  });

  test('a violation names the module that owns the raw value', () => {
    const [violation] = scan({
      'src/a.ts': 'export const foo = 12;',
      'src/probe.tsx': "import { foo } from './a';\n<div style={{ padding: foo }} />;",
    });
    expect(violation).toMatchObject({ file: 'src/probe.tsx', line: 2, rule: 'ts-style-literal' });
    expect(violation.text).toContain('= 12 @ src/a.ts:1');
  });

  test('canonical token references through the barrel and derived adapters pass', () => {
    expect(
      rulesOf({
        'src/probe.tsx': [
          "import { bar, duration, media, px, space } from '@/design-system';",
          "import * as tokens from './design-system/tokens';",
          "const pad = space['12'];",
          'const { hiddenOffset } = bar;',
          "<div style={{ padding: pad, margin: px(space['4']), top: hiddenOffset }} />;",
          "<div style={{ gap: tokens.space['4'], left: `${space['4']}px` }} />;",
          'animate(el, { opacity: [0, 1] }, { duration: bar.enter.duration });',
          'animate(el, { opacity: [0, 1] }, { duration: duration[key] });',
          'useMediaQuery(media.mobile);',
        ].join('\n'),
      })
    ).toEqual([]);
  });

  test('imported business values outside visual boundaries pass', () => {
    expect(
      rulesOf({
        'src/constants.ts': [
          'export const PAGE_SIZE = 20;',
          'export const POLL_INTERVAL_MS = 5_000;',
          'export const retries = 3;',
        ].join('\n'),
        'src/probe.tsx': [
          "import { PAGE_SIZE, POLL_INTERVAL_MS, retries } from './constants';",
          "import { thing } from 'some-package';",
          'const page = rows.slice(0, PAGE_SIZE);',
          'window.setTimeout(poll, POLL_INTERVAL_MS);',
          'const attempts = { count: retries };',
          '<div style={{ width: thing }} data-page={PAGE_SIZE} />;',
        ].join('\n'),
      })
    ).toEqual([]);
  });

  test('an allow marker on a declaration does not exempt its consumers', () => {
    const violations = scan({
      'src/view.ts': [
        '// design-tokens: allow viewBox units, not rendered px',
        'export const VIEW = 100;',
        'export const OTHER = 12;',
      ].join('\n'),
      'src/probe.tsx': [
        "import { OTHER, VIEW } from './view';",
        '<Chart height={VIEW} />;',
        '<Chart height={OTHER} />;',
      ].join('\n'),
    });
    expect(violations.map((v) => v.line)).toEqual([2, 3]);
  });

  test('an allow marker covers a whole multi-line statement and no further', () => {
    const body = [
      '// design-tokens: allow offscreen buffer, never rendered',
      'const a = <div style={{',
      '  left: -9999,',
      '}} />;',
      'const b = <div style={{ left: -9999 }} />;',
    ].join('\n');
    expect(scanTsText('src/probe.tsx', body).map((v) => v.line)).toEqual([5]);
  });

  test('the registry is loaded for resolution but never scanned', () => {
    const violations = scanTsFiles(designSystem);
    expect(violations.map((v) => v.file)).not.toContain('src/design-system/tokens.ts');
    expect(violations).toEqual([]);
  });
});
