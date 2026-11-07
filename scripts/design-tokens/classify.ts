/**
 * Classifies literal design values inside one SCSS declaration value.
 *
 * Shared by the migration codemod (which rewrites hits to registry references) and the drift
 * guard (which fails on any hit). The rules here are the documented allow-list in
 * docs/design-tokens.md: structural values are never hits; everything else that encodes an
 * authored size, colour, layer or motion decision is.
 */

export type TokenCategory =
  | 'color'
  | 'space'
  | 'size'
  | 'fontSize'
  | 'lineHeight'
  | 'letterSpacing'
  | 'fontWeight'
  | 'radius'
  | 'borderWidth'
  | 'shadow'
  | 'blur'
  | 'opacity'
  | 'tint'
  | 'z'
  | 'duration'
  | 'delay'
  | 'easing'
  | 'distance'
  | 'scale';

export interface LiteralHit {
  category: TokenCategory;
  /** Literal text as written, e.g. `12px`, `#fff`, `rgba(0, 0, 0, 0.1)`, `ease-out`. */
  text: string;
  /** Offset inside the declaration value. */
  start: number;
  end: number;
}

const SPACE_PROPS =
  /^(padding|margin|gap|row-gap|column-gap|grid-gap|inset|top|right|bottom|left|scroll-margin|scroll-padding|text-underline-offset|text-indent|outline-offset|border-spacing|background-position|mask-position|-webkit-mask-position|translate)(-.+)?$/;
const SIZE_PROPS =
  /^(width|height|min-width|min-height|max-width|max-height|inline-size|block-size|min-inline-size|max-inline-size|min-block-size|max-block-size|flex|flex-basis|grid-template-columns|grid-template-rows|grid-auto-columns|grid-auto-rows|grid-template|background-size|mask-size|-webkit-mask-size|contain-intrinsic-size|columns|column-width)$/;
const BORDER_WIDTH_PROPS =
  /^(border|border-(top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end)|border(-(top|right|bottom|left|block|inline))?-width|outline|outline-width|column-rule|column-rule-width|stroke-width|text-decoration-thickness|-webkit-text-stroke-width)$/;
const RADIUS_PROPS = /^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/;
const SHADOW_PROPS = /^(box-shadow|text-shadow)$/;
const FILTER_PROPS = /^(filter|backdrop-filter|-webkit-backdrop-filter)$/;
const MOTION_PROPS = /^(transition|animation)(-duration|-delay|-timing-function)?$/;
const TRANSFORM_PROPS = /^(transform|scale|rotate)$/;

/** Custom properties declared in component styles, mapped to the scale their values belong to. */
export const LOCAL_CUSTOM_PROPERTY_CATEGORY: Record<string, TokenCategory> = {
  '--header-height': 'size',
  '--shell-gutter': 'space',
  '--sidebar-panel-width': 'size',
  '--sidebar-collapsed-width': 'size',
  '--sidebar-gap': 'space',
  '--floating-control-size': 'size',
  '--glass-blur': 'blur',
  '--oauth-editor-bar-room': 'space',
};

export function categoryForProperty(prop: string): TokenCategory | 'mixed' | null {
  if (prop.startsWith('--')) return LOCAL_CUSTOM_PROPERTY_CATEGORY[prop] ?? null;
  if (prop === 'font-size') return 'fontSize';
  if (prop === 'line-height') return 'lineHeight';
  if (prop === 'letter-spacing') return 'letterSpacing';
  if (prop === 'font-weight') return 'fontWeight';
  if (prop === 'opacity') return 'opacity';
  if (prop === 'z-index') return 'z';
  if (RADIUS_PROPS.test(prop)) return 'radius';
  if (BORDER_WIDTH_PROPS.test(prop)) return 'borderWidth';
  if (SHADOW_PROPS.test(prop)) return 'shadow';
  if (FILTER_PROPS.test(prop)) return 'blur';
  if (MOTION_PROPS.test(prop)) return 'mixed';
  if (TRANSFORM_PROPS.test(prop)) return 'mixed';
  if (SPACE_PROPS.test(prop)) return 'space';
  if (SIZE_PROPS.test(prop)) return 'size';
  return null;
}

const NUMBER =
  /(?<![\w$.#\uE000-])(?:(?<=[\s(,/*+]|^)-)?(?:\d+\.?\d*|\.\d+)(px|rem|em|ms|s|deg|turn|%|fr|vh|vw|dvh|svh|lvh|ch|ex|x)?(?![\w%.\uE000-])/g;
const HEX = /#[0-9a-fA-F]{3,8}(?![\w-])/g;
const COLOR_FN = /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g;
const EASING =
  /\b(cubic-bezier|steps)\([^)]*\)|(?<![\w-])(ease-in-out|ease-in|ease-out|ease|linear|step-start|step-end)(?![\w-])/g;
const COLOR_NAMES = `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood
cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod
darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon
darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray
dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green
greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon
lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon
lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen
magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy
oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred
papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown
salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen
steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`;
const NAMED_COLOR = new RegExp(
  '(?<![\\w$-])(' + COLOR_NAMES.split(/\s+/).join('|') + ')(?![\\w-])',
  'gi'
);

const matchingParen = (value: string, open: number) => {
  let depth = 0;
  for (let k = open; k < value.length; k += 1) {
    if (value[k] === '(') depth += 1;
    else if (value[k] === ')') {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return value.length - 1;
};

const isStructuralNumber = (text: string, unit: string | undefined) => {
  const numeric = Number.parseFloat(text);
  if (numeric === 0) return true;
  if (!unit) return numeric === 1 || numeric === -1;
  return ['%', 'fr', 'vh', 'vw', 'dvh', 'svh', 'lvh', 'deg', 'turn', 'ch', 'ex', 'x'].includes(
    unit
  );
};

/**
 * Mask spans that never contain literal design values: custom property names inside `var()`,
 * Sass variable names, `env()` names, url() bodies, `attr()` and quoted strings.
 */
function maskValue(value: string): string {
  return value
    .replace(/var\(\s*--[\w-]+/g, (m) => '\uE000'.repeat(m.length))
    .replace(/\$[\w-]+/g, (m) => '\uE000'.repeat(m.length))
    .replace(/--[\w-]+/g, (m) => '\uE000'.repeat(m.length))
    .replace(/url\([^)]*\)/g, (m) => '\uE000'.repeat(m.length))
    .replace(/(["'])(?:\\.|(?!\1).)*\1/g, (m) => '\uE000'.repeat(m.length))
    .replace(/#\{[^}]*\}/g, (m) => '\uE000'.repeat(m.length));
}

export function classifyValue(prop: string, value: string, inKeyframes: boolean): LiteralHit[] {
  const hits: LiteralHit[] = [];
  const masked = maskValue(value);
  const covered: Array<[number, number]> = [];
  const isCovered = (at: number) => covered.some(([a, b]) => at >= a && at < b);
  const category = categoryForProperty(prop);

  // Colours: raw colour functions (all-literal arguments), hex, named colours.
  for (const m of masked.matchAll(COLOR_FN)) {
    const open = m.index + m[0].length - 1;
    const close = matchingParen(value, open);
    const args = masked.slice(open + 1, close);
    covered.push([m.index, close + 1]);
    // A canonical base colour does not make a literal alpha canonical.
    if (/\uE000/.test(args)) {
      const alpha = /(?:,|\/)\s*(-?(?:\d*\.?\d+)%?)\s*$/.exec(args);
      if (alpha) {
        const amount = Number.parseFloat(alpha[1]) / (alpha[1].endsWith('%') ? 100 : 1);
        if (amount !== 0 && amount !== 1) {
          const at = open + 1 + alpha.index + alpha[0].indexOf(alpha[1]);
          hits.push({
            category: alpha[1].endsWith('%') ? 'tint' : 'opacity',
            text: alpha[1],
            start: at,
            end: at + alpha[1].length,
          });
        }
      }
      continue;
    }
    hits.push({
      category: 'color',
      text: value.slice(m.index, close + 1),
      start: m.index,
      end: close + 1,
    });
  }
  for (const m of masked.matchAll(HEX)) {
    if (isCovered(m.index)) continue;
    hits.push({ category: 'color', text: m[0], start: m.index, end: m.index + m[0].length });
  }
  if (
    !/^(transition|animation|will-change|font-family|grid-template-areas|content|counter-reset|list-style)/.test(
      prop
    )
  ) {
    for (const m of masked.matchAll(NAMED_COLOR)) {
      if (isCovered(m.index)) continue;
      hits.push({ category: 'color', text: m[0], start: m.index, end: m.index + m[0].length });
    }
  }
  // Mixing weights are authored colour decisions, not layout percentages.
  for (const m of masked.matchAll(/color-mix\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchingParen(value, open);
    for (const n of masked.slice(open + 1, close).matchAll(NUMBER)) {
      const at = open + 1 + n.index;
      if (n[1] !== '%' || isCovered(at) || [0, 100].includes(Number.parseFloat(n[0]))) continue;
      hits.push({ category: 'tint', text: n[0], start: at, end: at + n[0].length });
    }
    covered.push([m.index, close + 1]);
  }

  // Composite shadows: the whole value is one token.
  if (category === 'shadow') {
    const literal = hits.length > 0 || /\d(px|rem|em)/.test(masked);
    if (literal && !/^\s*none\s*$/.test(value)) {
      return [{ category: 'shadow', text: value.trim(), start: 0, end: value.length }];
    }
    return [];
  }

  if (category === 'mixed' && MOTION_PROPS.test(prop)) {
    for (const m of masked.matchAll(EASING)) {
      covered.push([m.index, m.index + m[0].length]);
      hits.push({ category: 'easing', text: m[0], start: m.index, end: m.index + m[0].length });
    }
    // Per comma-separated item: first time is a duration, second a delay.
    let itemStart = 0;
    let depth = 0;
    const items: Array<[number, number]> = [];
    for (let k = 0; k <= masked.length; k += 1) {
      // Depth comes from the unmasked value: masking hides `var(` but not its `)`.
      const ch = value[k];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      if ((ch === ',' && depth === 0) || k === masked.length) {
        items.push([itemStart, k]);
        itemStart = k + 1;
      }
    }
    // Time values in order, literal or token (`$duration-*`, `$delay-*`, `var(--dur-*)`), so a
    // literal after a token duration is still classified as the delay.
    const TIME_TOKEN = /\$(?:duration|delay)-[\w-]+|var\(\s*--dur-[\w-]+[^)]*\)/g;
    for (const [a, b] of items) {
      const segment = masked.slice(a, b);
      const tokenTimes = [...value.slice(a, b).matchAll(TIME_TOKEN)].map((m) => a + m.index);
      for (const m of segment.matchAll(NUMBER)) {
        const at = a + m.index;
        if (isCovered(at)) continue;
        const unit = m[1];
        if (unit !== 'ms' && unit !== 's') continue;
        const before = tokenTimes.filter((t) => t < at).length;
        const literalBefore = [...segment.slice(0, at - a).matchAll(NUMBER)].filter(
          (n) => n[1] === 'ms' || n[1] === 's'
        ).length;
        const isDelay =
          prop.endsWith('-delay') || (!prop.endsWith('-duration') && before + literalBefore > 0);
        if (Number.parseFloat(m[0]) === 0) continue;
        hits.push({
          category: isDelay ? 'delay' : 'duration',
          text: m[0],
          start: at,
          end: at + m[0].length,
        });
      }
    }
    return hits;
  }

  // Transforms (declarations and keyframe steps): translate distances and scale factors.
  if (
    (category === 'mixed' && TRANSFORM_PROPS.test(prop)) ||
    (inKeyframes && prop === 'transform')
  ) {
    for (const m of masked.matchAll(
      /\b(scale[XYZ3d]*|translate[XYZ3d]*|translate|rotate[XYZ3d]*|skew[XY]?)\(/g
    )) {
      const open = m.index + m[0].length - 1;
      const close = matchingParen(value, open);
      const fn = m[1];
      const args = masked.slice(open + 1, close);
      for (const n of args.matchAll(NUMBER)) {
        const at = open + 1 + n.index;
        if (isStructuralNumber(n[0], n[1])) continue;
        if (fn.startsWith('rotate') || fn.startsWith('skew')) continue;
        if (fn.startsWith('scale') && !n[1]) {
          hits.push({ category: 'scale', text: n[0], start: at, end: at + n[0].length });
        } else if (n[1] === 'px' || n[1] === 'rem' || n[1] === 'em') {
          hits.push({ category: 'distance', text: n[0], start: at, end: at + n[0].length });
        }
      }
      covered.push([m.index, close + 1]);
    }
    if (prop === 'scale' || prop === 'rotate') return hits;
  }

  if (category === 'blur' && !prop.startsWith('--')) {
    for (const m of masked.matchAll(/\bblur\(/g)) {
      const close = matchingParen(value, m.index + 4);
      const inner = masked.slice(m.index + 5, close);
      for (const n of inner.matchAll(NUMBER)) {
        if (isStructuralNumber(n[0], n[1])) continue;
        const at = m.index + 5 + n.index;
        hits.push({ category: 'blur', text: n[0], start: at, end: at + n[0].length });
      }
      covered.push([m.index, close + 1]);
    }
    for (const m of masked.matchAll(/\bdrop-shadow\(/g)) {
      const close = matchingParen(value, m.index + 11);
      hits.push({
        category: 'shadow',
        text: value.slice(m.index, close + 1),
        start: m.index,
        end: close + 1,
      });
      covered.push([m.index, close + 1]);
    }
  }

  const numericCategory: TokenCategory | null =
    category === 'mixed' || (category === 'blur' && !prop.startsWith('--')) ? null : category;
  if (!numericCategory) return hits;

  for (const m of masked.matchAll(NUMBER)) {
    if (isCovered(m.index)) continue;
    const unit = m[1];
    if (isStructuralNumber(m[0], unit)) continue;
    const unitless = !unit;
    if (unitless && !['fontWeight', 'lineHeight', 'opacity', 'z', 'size'].includes(numericCategory))
      continue;
    // `flex: 1 1 240px` grow/shrink factors are structural; only lengths count for size.
    if (unitless && numericCategory === 'size') continue;
    if (unit === 'ms' || unit === 's') continue;
    let hitCategory: TokenCategory = numericCategory;
    // `border: 1px solid`: only the width; in `outline-offset` etc. the scale is space.
    if (numericCategory === 'lineHeight' && unit === 'px') hitCategory = 'lineHeight';
    hits.push({ category: hitCategory, text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return hits;
}
