import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compileString } from 'sass';
import * as registry from '@/design-system/tokens';
import {
  actionBarMotion,
  diagramColors,
  easingFunction,
  media,
  motionSeconds,
  providerColors,
} from '@/design-system';
import {
  GENERATED_FILES,
  renderGeneratedFiles,
  renderThemesScss,
  renderTokensScss,
} from '../scripts/design-tokens/generate';

const { tokens } = registry;
type Tokens = typeof tokens;

const compileModule = (path: string) =>
  compileString(`@use 'src/styles/variables' as *;\n${readFileSync(path, 'utf8')}`, {
    loadPaths: ['.'],
    url: new URL(`file://${process.cwd()}/${path}`),
    silenceDeprecations: ['import'],
  }).css;

/** Declarations of the first rule whose selector matches exactly. */
const ruleBody = (css: string, selector: string) => {
  const match = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1].trim() === selector);
  if (!match) throw new Error(`Missing rule ${selector}`);
  return match[2];
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('design token generation', () => {
  test('checked-in generated files match the registry', () => {
    for (const [file, content] of Object.entries(renderGeneratedFiles(tokens))) {
      expect(readFileSync(file, 'utf8')).toBe(content);
    }
  });

  test('generation is deterministic', () => {
    expect(renderGeneratedFiles(clone(tokens) as Tokens)).toEqual(renderGeneratedFiles(tokens));
  });

  test('the Sass entry forwards the generated partial and declares nothing itself', () => {
    const entry = readFileSync('src/styles/variables.scss', 'utf8');
    expect(entry).toContain("@forward '../design-system/generated/tokens'");
    expect(entry).not.toMatch(/^\s*\$[\w-]+\s*:/m);
    expect(readFileSync('src/styles/themes.scss', 'utf8')).toContain(
      "@use '../design-system/generated/themes'"
    );
    expect(Object.values(GENERATED_FILES)).toEqual([
      'src/design-system/generated/_tokens.scss',
      'src/design-system/generated/_themes.scss',
    ]);
  });

  test('the generated Sass partial emits no CSS when injected into every module', () => {
    const css = compileString(renderTokensScss(tokens)).css.trim();
    expect(css).toBe('');
  });
});

describe('a canonical registry edit reaches every adapter', () => {
  const edited = clone(tokens) as unknown as {
    space: Record<string, number>;
    duration: Record<string, number>;
    themes: { dark: Record<string, string> };
    palette: { diff: Record<string, string> };
    shadow: Record<string, string>;
  };
  edited.space['12'] = 13;
  edited.duration.hover = 175;
  edited.duration['modal-exit'] = 410;
  edited.themes.dark['info-color'] = '#123456';
  edited.palette.diff.add = '#00ff00';
  edited.shadow.menu = '0 1px 2px red';
  const scss = renderTokensScss(edited as unknown as Tokens);
  const themes = renderThemesScss(edited as unknown as Tokens);

  test('Sass variables', () => {
    const css = compileString(
      `${scss}\n.probe { padding: $space-12; color: $color-diff-add; box-shadow: $shadow-menu; animation: x $duration-modal-exit; }`
    ).css;
    expect(css).toContain('padding: 13px');
    expect(css).toContain('color: #00ff00');
    expect(css).toContain('box-shadow: 0 1px 2px red');
    expect(css).toContain('animation: x 410ms');
  });

  test('theme custom properties', () => {
    expect(themes).toContain('--info-color: #123456;');
    expect(themes).toContain('--dur-hover: 160ms;');
    // `--dur-hover` is derived from `duration.hover` inside the registry, so the authored value
    // flows through `themes` when the registry module is evaluated; the clone keeps the old string.
    expect(registry.themes.light['dur-hover']).toBe(`${registry.duration.hover}ms`);
  });

  test('TS adapters read the registry, not copies', () => {
    expect(motionSeconds('modal-exit')).toBe(registry.duration['modal-exit'] / 1000);
    expect(media.mobile).toBe(`(max-width: ${registry.breakpoint.mobile}px)`);
    expect(media.aboveMobile).toBe(`(min-width: ${registry.breakpoint.mobile + 1}px)`);
    expect(diagramColors).toEqual(Object.values(registry.palette.diagram));
    expect(providerColors.xai.light).toEqual({
      bg: registry.palette.provider.xai.light.bg,
      text: registry.palette.provider.xai.light.text,
      border: `${registry.borderWidth['1']}px solid ${registry.palette.provider.xai.light.border.color}`,
    });
    expect(actionBarMotion.enter.duration).toBe(registry.duration['280'] / 1000);
    expect(actionBarMotion.hiddenOffset).toBe(registry.distance['56']);
  });
});

describe('semantic colour palettes', () => {
  const base = registry.themes.light as Record<string, string>;
  const resolved = Object.fromEntries(
    Object.entries(registry.themes).map(([name, values]) => [name, { ...base, ...values }])
  );

  test('every theme override names a base property', () => {
    for (const [name, values] of Object.entries(registry.themes)) {
      const unknown = Object.keys(values).filter((key) => !(key in base));
      expect({ name, unknown }).toEqual({ name, unknown: [] });
    }
  });

  test('every theme resolves the same semantic property set', () => {
    const keys = Object.keys(base).sort();
    for (const values of Object.values(resolved)) expect(Object.keys(values).sort()).toEqual(keys);
  });

  test('every referenced custom property is defined', () => {
    const files = [...new Bun.Glob('src/**/*.{scss,ts,tsx}').scanSync('.')];
    const sources = files.map((file) => readFileSync(file, 'utf8'));
    const defined = new Set(Object.keys(base).map((key) => `--${key}`));
    for (const source of sources) {
      for (const m of source.matchAll(/(--[a-z][\w-]*)\s*:/g)) defined.add(m[1]);
      for (const m of source.matchAll(/['"`](--[a-z][\w-]*)['"`]/g)) defined.add(m[1]);
    }
    const missing = new Set<string>();
    for (const source of sources)
      for (const m of source.matchAll(/var\(\s*(--[a-z][\w-]*)(?=[\s,)])/g))
        if (!defined.has(m[1])) missing.add(m[1]);
    expect([...missing]).toEqual([]);
  });

  test('provider badges define both theme tones for every provider', () => {
    for (const set of Object.values(providerColors)) {
      expect(set.light.bg).toMatch(/^#[\da-f]{6}$/);
      expect(set.dark.text).toMatch(/^#[\da-f]{6}$/);
    }
  });
});

describe('CSS animation timing and JS timers share one token', () => {
  const ms = (value: number) => `${value}ms`;

  test('modal close timer matches the closing animations', () => {
    const css = compileModule('src/styles/components.scss');
    expect(ruleBody(css, '.modal-overlay.modal-overlay-closing')).toContain(ms(registry.duration['modal-exit']));
    expect(ruleBody(css, '.modal.modal-closing')).toContain(ms(registry.duration['modal-exit']));
    expect(readFileSync('src/components/ui/Modal.tsx', 'utf8')).toContain(
      "CLOSE_ANIMATION_DURATION = duration['modal-exit']"
    );
  });

  test('sheet close timer matches the sheet exit animations', () => {
    const css = compileModule('src/components/ui/Sheet/Sheet.module.scss');
    const exits = [...css.matchAll(/animation: sheet-(?:fade|slide)-out (\d+)ms/g)].map((m) => +m[1]);
    expect(exits).toEqual([registry.duration['sheet-exit'], registry.duration['sheet-exit']]);
    expect(readFileSync('src/components/ui/Sheet/Sheet.tsx', 'utf8')).toContain(
      "CLOSE_ANIMATION_DURATION = duration['sheet-exit']"
    );
  });

  test('notification removal waits for the exit transition', () => {
    const css = compileModule('src/components/common/NotificationContainer.module.scss');
    expect(css).toContain(`transition-duration: ${ms(registry.duration['notification-exit'])}`);
    expect(readFileSync('src/components/common/NotificationContainer.tsx', 'utf8')).toContain(
      "EXIT_DURATION_MS = duration['notification-exit']"
    );
  });

  test('field jump highlight timer matches the highlight animation', () => {
    const css = compileModule('src/features/config/components/fields/Field.module.scss');
    expect(css).toContain(`config-field-highlight ${ms(registry.duration['field-highlight'])}`);
    expect(readFileSync('src/features/config/hooks/useFieldJump.ts', 'utf8')).toContain(
      "duration['field-highlight']"
    );
  });

  test('config entrance budget covers the card animation and its delay', () => {
    const css = compileModule('src/features/config/components/SectionCard.module.scss');
    const [, run, wait] = /animation: config-card-in (\d+)ms \S+ (\d+)ms/.exec(css) ?? [];
    expect(Number(run) + Number(wait)).toBeLessThanOrEqual(
      registry.motion.cascade['config-cards'].budget
    );
  });

  test('seconds for motion/mini and milliseconds for CSS describe the same durations', () => {
    for (const key of Object.keys(registry.duration) as Array<keyof typeof registry.duration>) {
      expect(motionSeconds(key) * 1000).toBeCloseTo(registry.duration[key], 9);
    }
  });

  test('JS power curves match their CSS names at the endpoints', () => {
    for (const key of ['out-quart', 'out-cubic', 'in-quad', 'in-cubic'] as const) {
      const curve = easingFunction(key);
      expect(curve(0)).toBe(0);
      expect(curve(1)).toBe(1);
    }
    expect(easingFunction('out-quart')(0.5)).toBeCloseTo(1 - 0.5 ** 4, 12);
    expect(easingFunction('in-cubic')(0.5)).toBeCloseTo(0.5 ** 3, 12);
  });
});

describe('breakpoints', () => {
  test('Sass media queries and matchMedia strings derive from the same breakpoint', () => {
    const css = compileModule('src/components/ui/PageHeader.module.scss');
    expect(css).toContain(`@media ${media.mobile}`);
    expect(css).toContain(`@media ${media.mobile}, (pointer: coarse)`);
  });
});

describe('PageHeader touch target', () => {
  test('small header actions reach the shared touch target on phones and coarse pointers', () => {
    const css = compileModule('src/components/ui/PageHeader.module.scss');
    const block = css.slice(css.indexOf(`@media ${media.mobile}, (pointer: coarse)`));
    expect(block).toContain(`min-height: ${registry.size['touch-target']}px`);
    // The desktop rule stays first, so the touch rule wins on tablets with coarse pointers.
    expect(css.indexOf('min-height: 36px')).toBeLessThan(
      css.indexOf(`@media ${media.mobile}, (pointer: coarse)`)
    );
  });
});

describe('logs request id badge', () => {
  test('uses the semantic info tone in every theme instead of a fixed cyan', () => {
    const css = compileModule('src/pages/LogsPage.module.scss');
    const body = ruleBody(css, '.requestIdBadge');
    expect(body).toContain('color: var(--info-color)');
    expect(body).not.toMatch(/#[\da-f]{3,6}|rgba?\(/i);
    for (const theme of ['light', 'dark'] as const) {
      expect(registry.themes[theme]['info-color']).toMatch(/^#[\da-f]{6}$/);
    }
  });
});
