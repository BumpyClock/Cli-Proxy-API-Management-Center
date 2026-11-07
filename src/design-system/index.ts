/**
 * TS/TSX adapters over the token registry. Import design values from here, never inline them.
 *
 * Units: `duration`/`delay` are milliseconds (timers, CSS strings); `motionSeconds` converts for
 * motion/mini, which takes seconds. Lengths are px numbers; `px()` formats them for styles.
 */
import {
  blur,
  borderWidth,
  chart,
  breakpoint,
  delay,
  distance,
  duration,
  easing,
  fontSize,
  fontWeight,
  iconSize,
  iconStroke,
  lineHeight,
  motion,
  motionScale,
  opacity,
  palette,
  radius,
  shadow,
  size,
  space,
  themePreview,
  themes,
  tokens,
  z,
} from './tokens';

export {
  blur,
  borderWidth,
  chart,
  breakpoint,
  delay,
  distance,
  duration,
  easing,
  fontSize,
  fontWeight,
  iconSize,
  iconStroke,
  lineHeight,
  motion,
  motionScale,
  opacity,
  palette,
  radius,
  shadow,
  size,
  space,
  themePreview,
  themes,
  tokens,
  z,
};

export type DurationKey = keyof typeof duration;
export type EasingKey = keyof typeof easing;
export type ThemeProperty = keyof (typeof themes)['light'];

export const px = (value: number) => `${value}px`;

/** motion/mini takes seconds; the registry stores milliseconds. */
export const motionSeconds = (key: DurationKey) => duration[key] / 1000;

type PowerEasingKey = {
  [K in EasingKey]: (typeof easing)[K] extends { power: unknown } ? K : never;
}[EasingKey];

/** JS easing function for a registry curve that defines a `power` form. */
export function easingFunction(key: PowerEasingKey): (progress: number) => number {
  const { direction, exponent } = easing[key].power;
  return direction === 'out'
    ? (progress) => 1 - (1 - progress) ** exponent
    : (progress) => progress ** exponent;
}

/** `var(--<name>)` for a theme custom property, typed against the registry. */
export const cssVar = (name: ThemeProperty) => `var(--${name})`;

/** matchMedia strings built from the same breakpoints the Sass media queries use. */
export const media = {
  mobile: `(max-width: ${breakpoint.mobile}px)`,
  aboveMobile: `(min-width: ${breakpoint.mobile + 1}px)`,
  wide: `(min-width: ${breakpoint.wide}px)`,
  chartCompact: `(max-width: ${breakpoint['600']}px)`,
} as const;

export type ProviderColorSet = {
  light: { bg: string; text: string; border?: string };
  dark: { bg: string; text: string; border?: string };
};

type ProviderTone = { bg: string; text: string; border?: { color: string; style: string } };

const providerTone = (tone: ProviderTone) => ({
  bg: tone.bg,
  text: tone.text,
  ...(tone.border
    ? { border: `${borderWidth['1']}px ${tone.border.style} ${tone.border.color}` }
    : {}),
});

/** Provider badge colours keyed by provider, with `border` as a CSS shorthand. */
export const providerColors: Record<string, ProviderColorSet> = Object.fromEntries(
  Object.entries(palette.provider).map(([key, value]) => [
    key,
    { light: providerTone(value.light), dark: providerTone(value.dark) },
  ])
);

/** Ordered model-mapping diagram colours. */
export const diagramColors: readonly string[] = Object.values(palette.diagram);

type MotionTiming = { readonly duration: DurationKey; readonly easing: EasingKey };

/** motion/mini `{ duration, ease }` options for a registry timing. */
export function motionTiming(timing: MotionTiming): {
  duration: number;
  ease: 'linear' | ((progress: number) => number);
} {
  const curve = easing[timing.easing];
  if ('power' in curve) {
    return {
      duration: motionSeconds(timing.duration),
      ease: easingFunction(timing.easing as PowerEasingKey),
    };
  }
  if (timing.easing !== 'linear') {
    throw new Error(`Easing "${timing.easing}" has no JS form; add a power curve or use linear.`);
  }
  return { duration: motionSeconds(timing.duration), ease: timing.easing };
}

/** Shared enter/exit choreography of the floating save bar and the batch action bar. */
export const actionBarMotion = {
  enter: motionTiming(motion.actionBar.enter),
  exit: motionTiming(motion.actionBar.exit),
  reducedEnter: motionTiming(motion.actionBar.reducedEnter),
  reducedExit: motionTiming(motion.actionBar.reducedExit),
  /** Vertical travel below the resting position. */
  hiddenOffset: distance[motion.actionBar.hiddenOffset],
} as const;
