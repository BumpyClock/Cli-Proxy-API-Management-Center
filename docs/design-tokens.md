# Design tokens

Every colour, length, type, layer, shadow, breakpoint and motion value in the app comes from one authored file: `src/design-system/tokens.ts`. Stylesheets and components reference it. They do not repeat its values. A drift guard rejects raw values at the style and motion boundaries documented below.

This page is for the engineer who changes how the app looks or moves.

## Where things live

- `src/design-system/tokens.ts` is the registry and the only authored source. It is plain data with no imports.
- `src/design-system/index.ts` adapts the registry for TS/TSX. It provides motion seconds, JS easing functions, `matchMedia` strings, `px()`, `cssVar()`, provider badge colours and the shared action-bar choreography.
- `src/design-system/generated/_tokens.scss` holds generated Sass variables. Vite injects them into every SCSS module through `src/styles/variables.scss`, and this partial emits no CSS.
- `src/design-system/generated/_themes.scss` holds generated theme custom properties: `:root` (the default paper theme, `light`), `[data-theme='white']`, `[data-theme='dark']`, and the opaque-glass override for phones, reduced motion and reduced transparency. `src/styles/themes.scss` includes it once.
- `scripts/design-tokens/` holds the generator, the drift guard, the shared SCSS scanner and classifier, and the SCSS migration codemod.

Generated files are checked in, excluded from Prettier, and never edited by hand.

## Commands and enforcement

- `bun run tokens` regenerates the Sass adapters. It writes only files whose content changed.
- `bun run tokens:check` exits 1 when the checked-in output is stale.
- `bun run tokens:migrate` rewrites raw literals in `src/**/*.scss` that already have a registry value. It is idempotent and reports any literal without a token.
- `bun run dev` regenerates on start and after every save of `tokens.ts`. `bun run build` regenerates at build start. Neither adds a build artifact, and the single-file `dist/index.html` is unchanged in shape.
- CI runs `bun run verify`. Its tests fail on stale generated output (`tests/designTokens.test.ts`) and on any raw design value in `src/` (`tests/designTokenGuard.test.ts`).

## Changing tokens

**Change a value.** Edit it in `tokens.ts`. Every Sass variable, theme property and TS adapter that reads it changes. Dev and build regenerate automatically. Run `bun run tokens` before committing if neither ran.

**Add a semantic colour.** Add the property to `themes.light`, and add overrides to `white` and `dark` where they differ. Use it as `var(--name)` in SCSS or `cssVar('name')` in TS. Tests require every override key to exist in `light` and every referenced `var(--…)` to be defined.

**Create a variant of a theme colour.** Prefer a tint of an existing property, such as `color-mix(in srgb, var(--info-color) $tint-0-1, transparent)`. `$tint-0-1` is the percentage adapter of `opacity['0-1']`, not a separately authored value. Use `$opacity-0-1` for `rgba($colour, $opacity-0-1)`. This follows each theme automatically. Add a new theme property only when the variant needs different values per theme.

**Add a scale step.** Add the key and value to the scale whose meaning matches the property. Space for padding, margin, gap and offsets. Size for widths, heights, tracks and controls. Separate scales exist for font size, line height, letter spacing, font weight, radius, border width, blur, opacity, z-index, duration, delay, easing, distance and motion scale. The same number in two scales is two tokens. Do not reuse a spacing step as a font size.

**Name things.** Scale keys are their value (`space['12']` is 12px, `$space-12`). Default units are px for lengths, ms for time, and unitless for weights, opacity and z-index. A unit suffix marks a key in another unit (`'0-25em'`, `lineHeight['20px']`). Decimals use `-` (`'12-5'`). Shared roles get names that callers use instead of the value key: `size['touch-target']`, `duration['modal-exit']`, `z.dropdown`, `breakpoint.mobile`. To change a role everywhere, edit the role.

**Align JS with CSS.** When JS waits for a CSS animation, both sides use the same named duration. For example, `.modal.modal-closing` animates for `$duration-modal-exit`, and `Modal.tsx` closes after `duration['modal-exit']`. The same pairing covers sheets, notifications and the field-jump highlight. motion/mini takes seconds, so use `motionSeconds(key)` or `motionTiming(preset)`. Timers and CSS use milliseconds.

**Negative values.** Write `(-$space-6)` in Sass. Parentheses keep `0 (-$space-6)` a list instead of a subtraction. In TS, negate the number.

## What the guard allows

The guard checks every SCSS declaration value, `@media`, `@include` and `@mixin` prelude, and Sass variable declaration in `src/`. It also checks TS/TSX style and motion boundaries through the TypeScript AST:

- JSX `style` objects and `CSSProperties` objects.
- Visual JSX attributes, such as icon `size`, chart strokes and heights.
- Imperative `el.style` writes and `setProperty` calls.
- `animate()` options, motion option keys and `matchMedia` / `useMediaQuery` strings.
- Inline timer delays, colour strings and `var()` fallbacks.
- Upper-case constants named for a visual role, such as `MENU_OFFSET` or `ENTRANCE_BUDGET_MS`.

At those boundaries the guard follows a value to its source across modules, so moving a literal into a constant or another file does not hide it. All `src` TS/TSX files load into one TypeScript program. Relative and `@/` imports resolve, and so do barrel re-exports (`export { x } from`, `export *`), namespace and default imports, `const` aliases, enum members, destructuring, template spans, conditional and `??` / `||` branches, and property, element and array accesses with statically known keys. Resolution stops at `tokens.ts`, which is trusted. `index.ts` is scanned like any module, and its adapters pass because they read the registry. A violation is reported at the consumer and names the module and line that own the raw value. An allow marker exempts only its own statement, so each consumer of a marked value needs its own marker and reason. Function results (including `px(12)`), `let` bindings, function parameters and their default values, dynamic keys on non-registry objects, and package imports stay opaque and are not checked. Values outside these boundaries, such as a page size passed to `slice()` or a named delay passed to `setTimeout`, are not checked.

Structural values are allowed anywhere:

- `0` in any unit, and unitless `1` / `-1`.
- Layout and artwork percentages, `fr`, `vh` / `vw` / `dvh`, `ch`, and `deg` / `turn` rotations. Colour-composition weights are not layout percentages.
- `auto`, `none`, `inherit`, `currentColor`, `transparent`.
- `translate(-50%)` centring, flex grow and shrink factors, and keyframe percentages.
- Tints of a canonical colour with a canonical alpha or mixing weight. `rgba($colour, $opacity-0-2)` and `color-mix(in srgb, var(--info-color) $tint-0-2, transparent)` share the same opacity source. Raw alpha and mixing weights are rejected; 0 and 100% endpoints remain structural.
- Dynamic geometry computed from the DOM or data. For example, `LoadingSpinner` derives its border from its size.

Business values are not design tokens and stay with their owners. These include polling and retry intervals, request timeouts, quota thresholds, page sizes, the notification dismissal time, flow dwell times and gesture thresholds such as long press. They are not flagged unless their constant name claims a visual role.

The narrow exemptions are these:

- **SVG geometry.** Coordinates and child sizes inside an `<svg>` are viewBox units, not rendered pixels: `x`, `y`, `cx`, `cy`, `d`, `points`, `viewBox`, plus `width`, `height` and `r` on child elements. The outer `<svg>` size is still checked.
- **Icon glyph artwork.** In `src/components/ui/icons.tsx` and `src/components/layout/headerIcons.tsx`, presentation attributes on SVG children are artwork. Icon size and stroke weight still come from `iconSize` and `iconStroke`. Brand logos are SVG assets, not code.
- **Runtime custom properties.** These include `--content-center-x`, the action-bar height variables and per-item delays. JS sets them per element, so their fallback is the resting value. Fallbacks must still be structural or tokens. Every theme property is always defined, so it never takes a fallback.
- **`// design-tokens: allow <reason>`.** This marker exempts only the next statement and must give a reason. Current uses: the offscreen clipboard buffer, the Sparkline viewBox coordinate system, the login and OAuth flow dwell timers, the notification dismissal policy, and the edge-swipe gesture hit zone.

## Known divergences kept on purpose

These differences predate the registry. The migration preserved them as separate tokens instead of folding them together:

- The theme picker swatches (`themePreview`) do not match the live theme colours. The dark swatch is warm brown (`#151412`), while the dark theme is cool grey (`--bg-secondary: #0d0f11`). Deriving swatches from `themes` would make the picker accurate, but it is a visible change.
- `palette.legacy` (for example `$color-legacy-warning: #c65746`) holds the old pre-theme Sass colours. Plugin pages, config search highlights, select, model-picker and diagram focus rings, the shared error box and some Logs and Quota styles still use them. They differ from the theme's semantic colours. These colours are candidates for migration to `var(--warning-color)` and related properties.
- Two pill radii exist: `radius['999']` and `radius['9999']`. Two plan badge palettes also exist: an sRGB palette and a Display P3 palette.

## Intentional changes made with the registry

- On coarse-pointer screens wider than 768px, such as tablets, the small page-header actions now reach the shared 44px touch target. Before, they stayed at 36px because the header rule outranked the global touch rule.
- The Logs request-id badge uses the semantic info tone (`--info-color` with 10% and 25% tints) in every theme. It replaces the fixed cyan `#0891b2`, which had no dark-theme adaptation.

The migration preserves the remaining rendered values, including the older metadata/editor font stacks. A follow-up sweep centralized 244 alpha and mixing weights across 39 stylesheets. All 95 non-generated stylesheet compilations were byte-identical before and after that sweep. The Sass-only forwarding entry was excluded.

Separate PR corrections portal row menus outside clipped route containers, clamp and flip them through one positioning hook, and add real whitespace between human labels and YAML keys. See `docs/workspace-redesign.md` for behavior and deployment notes.
