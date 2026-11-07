/**
 * Design-token drift guard. tests/designTokenGuard.test.ts runs it over all of src/ and fails
 * on any violation; the same functions check injected samples to prove each rule fires.
 *
 * SCSS: every declaration value, `@media` prelude, `@include`/`@mixin` argument and Sass variable
 * declaration. TS/TSX: style and motion boundaries found through the TypeScript AST, never
 * every number in the codebase (business values such as polling intervals stay out of scope).
 * Allowed structural values and the narrow exemptions are documented in docs/design-tokens.md.
 */
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { scanScss, insideKeyframes } from './scss-scanner.ts';
import { classifyValue } from './classify.ts';

export interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

/** Registry-owned files: the authored source and generated output. */
const REGISTRY_SOURCE = 'src/design-system/tokens.ts';
export const REGISTRY_FILES = new Set([
  REGISTRY_SOURCE,
  'src/design-system/generated/_tokens.scss',
  'src/design-system/generated/_themes.scss',
]);

/** The Sass entry that forwards generated variables (it declares no values). */
const SASS_TOKEN_ENTRY = 'src/styles/variables.scss';

const COLOR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|(?<![\w-])(rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(\s*[\d.]/;
const DIMENSION = /(?<![\w$.#-])-?(?:\d+\.?\d*|\.\d+)(px|rem|em|ms|s)(?![\w%-])/g;
const isStructuralDimension = (text: string) => Number.parseFloat(text) === 0;

function rawDimensions(value: string): string[] {
  const masked = value
    .replace(/var\(\s*--[\w-]+/g, ' ')
    .replace(/\$[\w-]+/g, ' ')
    .replace(/--[\w-]+/g, ' ')
    .replace(/#\{[^}]*\}/g, ' ')
    .replace(/(["'])(?:\\.|(?!\1).)*\1/g, ' ');
  return [...masked.matchAll(DIMENSION)].map((m) => m[0]).filter((t) => !isStructuralDimension(t));
}

/** `var(--x, …)` fallbacks let a stylesheet drift from the theme; tokens are always defined. */
const VAR_FALLBACK = /var\(\s*(--[\w-]+)\s*,/g;

/**
 * Custom properties set at runtime on specific elements (inline style or JS), where a fallback is
 * the documented resting value. Their fallbacks must still be structural or tokens.
 */
export const RUNTIME_CUSTOM_PROPERTIES = new Set([
  '--content-center-x',
  '--oauth-editor-actions-height',
  '--config-action-bar-height',
  '--auth-files-action-bar-height',
  '--segment-delay',
  '--meter-index',
  '--card-delay',
  '--bar-delay',
  '--log-grid-min-width',
  '--provider-accent',
]);

export function scanScssText(file: string, text: string): Violation[] {
  const out: Violation[] = [];
  const scan = scanScss(text);
  for (const decl of scan.declarations) {
    if (decl.prop.startsWith('$')) {
      if (file !== SASS_TOKEN_ENTRY)
        out.push({
          file,
          line: decl.line,
          rule: 'local-sass-token',
          text: `${decl.prop}: ${decl.value}`,
        });
      continue;
    }
    for (const m of decl.value.matchAll(VAR_FALLBACK)) {
      if (!RUNTIME_CUSTOM_PROPERTIES.has(m[1]))
        out.push({
          file,
          line: decl.line,
          rule: 'var-fallback',
          text: `${decl.prop}: ${decl.value}`,
        });
    }
    if (
      decl.prop === 'font-family' &&
      /[^,\s]/.test(
        decl.value
          .replace(/\$[\w-]+|var\([^)]*\)/g, '')
          .replace(/\b(inherit|initial|unset|revert|revert-layer)\b/g, '')
      )
    )
      out.push({ file, line: decl.line, rule: 'raw-fontFamily', text: decl.value });
    const hits = classifyValue(decl.prop, decl.value, insideKeyframes(decl));
    for (const hit of hits)
      out.push({
        file,
        line: decl.line,
        rule: `raw-${hit.category}`,
        text: `${decl.prop}: ${hit.text}`,
      });
    if (hits.length === 0) {
      // Catch-all for properties the classifier does not map (e.g. `font` shorthand).
      for (const dim of rawDimensions(decl.value))
        out.push({ file, line: decl.line, rule: 'raw-unclassified', text: `${decl.prop}: ${dim}` });
    }
  }
  for (const at of scan.atRules) {
    if (!['media', 'include', 'mixin', 'container', 'supports'].includes(at.name)) continue;
    const dims = rawDimensions(at.prelude);
    const color = COLOR_LITERAL.test(at.prelude.replace(/#\{[^}]*\}/g, ''));
    if (dims.length > 0 || color)
      out.push({
        file,
        line: at.line,
        rule: `raw-${at.name}`,
        text: `@${at.name} ${at.prelude.trim()}`,
      });
  }
  return out;
}

// -------------------------------------------------------------------------------------------
// TS / TSX
// -------------------------------------------------------------------------------------------

/** React style keys plus Recharts margin keys; numeric values here are px or unitless styles. */
const STYLE_KEYS = new Set([
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'marginInline',
  'marginBlock',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'paddingInline',
  'paddingBlock',
  'gap',
  'rowGap',
  'columnGap',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'borderRadius',
  'borderWidth',
  'border',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
  'outline',
  'outlineOffset',
  'boxShadow',
  'textShadow',
  'zIndex',
  'opacity',
  'transform',
  'transition',
  'animation',
  'animationDuration',
  'animationDelay',
  'transitionDuration',
  'transitionDelay',
  'color',
  'background',
  'backgroundColor',
  'borderColor',
  'fill',
  'stroke',
  'strokeWidth',
  'flexBasis',
  'gridTemplateColumns',
  'gridTemplateRows',
  'translate',
  'scale',
  'filter',
  'backdropFilter',
  'r',
  'fillOpacity',
  'strokeOpacity',
  'strokeDasharray',
]);
/** Visual attributes on JSX elements (components and SVG presentation attributes). */
const VISUAL_ATTRS = new Set([
  'width',
  'height',
  'size',
  'strokeWidth',
  'r',
  'tickMargin',
  'tickSize',
  'fillOpacity',
  'strokeOpacity',
  'strokeDasharray',
  'opacity',
  'barSize',
  'radius',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'fill',
  'stroke',
  'offset',
  'outerRadius',
  'innerRadius',
  'animationDuration',
  'animationBegin',
  'rounded',
  'gap',
]);
/** SVG geometry inside artwork: coordinates, never design tokens. */
const SVG_GEOMETRY_ATTRS = new Set([
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'rx',
  'ry',
  'd',
  'points',
  'viewBox',
  'dx',
  'dy',
  'transform',
  'pathLength',
]);
const MOTION_KEYS = new Set([
  'duration',
  'delay',
  'ease',
  'easing',
  'stiffness',
  'damping',
  'bounce',
  'stagger',
  'repeatDelay',
]);
const STRUCTURAL_STRINGS =
  /^(none|auto|inherit|initial|unset|currentColor|transparent|100%|50%|-50%|0|1|sm|md|lg|xs|xl|small|medium|large|true|false)$/;

const lineOf = (node: ts.Node) => {
  const sf = node.getSourceFile();
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
};

type Literal = { kind: 'number' | 'string'; text: string };

const literalText = (node: ts.Expression): Literal | null => {
  if (isTokenKey(node)) return null;
  if (ts.isNumericLiteral(node)) return { kind: 'number', text: node.text };
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  )
    return { kind: 'number', text: `-${node.operand.text}` };
  if (ts.isStringLiteralLike(node)) return { kind: 'string', text: node.text };
  return null;
};

/** A literal that encodes a design value: non-structural number, unit string or colour. */
function isDesignLiteral(lit: Literal): boolean {
  if (lit.kind === 'number') return !['0', '1', '-1'].includes(lit.text);
  if (STRUCTURAL_STRINGS.test(lit.text.trim())) return false;
  if (classifyValue('color', lit.text, false).length > 0) return true;
  if (rawDimensions(lit.text).length > 0) return true;
  // Bare numeric strings in style positions (`r="3.5"`, `strokeDasharray="3 4"`).
  return /^-?[\d.]+( -?[\d.]+)*$/.test(lit.text.trim()) && !/^(0|1)$/.test(lit.text.trim());
}
const isFontLiteral = (lit: Literal) =>
  lit.kind === 'string' &&
  !STRUCTURAL_STRINGS.test(lit.text.trim()) &&
  !/^var\(\s*--[\w-]+\s*\)$/.test(lit.text.trim());
const isColorLiteral = (lit: Literal) =>
  lit.kind === 'string' && classifyValue('color', lit.text, false).length > 0;
const isMediaLiteral = (lit: Literal) =>
  lit.kind === 'string' ? rawDimensions(lit.text).length > 0 : isDesignLiteral(lit);
const isMotionNumber = (lit: Literal) => lit.kind === 'number' && !['0', '1'].includes(lit.text);
const isMotionLiteral = (lit: Literal) => lit.kind === 'string' || lit.text !== '0';

const isSvgPrimitive = (tag: string) => /^[a-z]/.test(tag);
/**
 * Constants whose names declare a visual or motion role must take their value from the registry.
 * Business names (timeouts, polling, page sizes, thresholds) are outside the registry.
 */
const VISUAL_CONSTANT_NAME =
  /(^|_)(DURATION|DELAY|STAGGER|BUDGET|EASE|EASING|OFFSET|RADIUS|FONT|STROKE|DASH|MARGIN|GAP|PADDING|WIDTH|HEIGHT|DISTANCE|SCALE|OPACITY|SHADOW|COLOR|COLORS|Z_INDEX|BLUR|SPACING|SIZE)(_|$)/;
const BUSINESS_CONSTANT_NAME =
  /(TIMEOUT|INTERVAL|PAGE_SIZE|FILE_SIZE|LIMIT|COUNT|THRESHOLD|STALE|EXPIRY|_CH$|_MINUTES|_HOURS)/;
/** Inside an `<svg>`, child element sizes (`rect width`, `circle r`) are viewBox geometry. */
const SVG_CHILD_GEOMETRY_ATTRS = new Set(['width', 'height', 'r']);
/** Icon glyph files: presentation attributes on SVG children are artwork. */
export const ARTWORK_FILES = new Set([
  'src/components/ui/icons.tsx',
  'src/components/layout/headerIcons.tsx',
]);
/** `// design-tokens: allow <reason>` before a statement exempts that one statement. */
const ALLOW_MARKER = /\/\/\s*design-tokens:\s*allow\s+\S/;

/** `space['4']`: string keys into token objects are names, not values. */
const isTokenKey = (node: ts.Node) =>
  ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node;

/**
 * True when the marker sits in the leading comments of the innermost statement containing
 * `node` (or of a node between it and that statement). The scope never extends past one statement.
 */
function isAllowed(node: ts.Node): boolean {
  const text = node.getSourceFile().text;
  for (let n: ts.Node = node; !ts.isSourceFile(n); n = n.parent) {
    const comments = ts.getLeadingCommentRanges(text, n.getFullStart()) ?? [];
    if (comments.some((c) => ALLOW_MARKER.test(text.slice(c.pos, c.end)))) return true;
    if (ts.isStatement(n) || ts.isClassElement(n)) return false;
  }
  return false;
}

const propertyKey = (name: ts.PropertyName): string | undefined => {
  if (ts.isComputedPropertyName(name)) {
    const e = name.expression;
    return ts.isStringLiteralLike(e) || ts.isNumericLiteral(e) ? e.text : undefined;
  }
  return ts.isPrivateIdentifier(name) ? undefined : name.text;
};

// -------------------------------------------------------------------------------------------
// Cross-module value resolution
// -------------------------------------------------------------------------------------------

/** Resolution ended in the registry: the value is canonical and there is nothing to report. */
const TRUSTED = Symbol('trusted');
type Resolved = ts.Expression | typeof TRUSTED;

const fileOf = (sf: ts.SourceFile) => sf.fileName.replace(/^\//, '');

/** `./x`, `../x` and `@/x` (→ `src/x`) only; packages stay unresolved and therefore opaque. */
function resolveSpecifier(files: Map<string, string>, from: string, spec: string) {
  let base: string;
  if (spec.startsWith('@/')) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith('./') || spec.startsWith('../'))
    base = path.posix.join(path.posix.dirname(from), spec);
  else return undefined;
  return ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
    .map((ext) => base + ext)
    .find((candidate) => /\.tsx?$/.test(candidate) && files.has(candidate));
}

/** One program over an in-memory file map, rooted at a virtual `/`. No lib, no packages. */
function createProgram(files: Map<string, string>): ts.Program {
  const key = (fileName: string) => fileName.replace(/^\//, '');
  const host: ts.CompilerHost = {
    getSourceFile: (fileName, languageVersion) => {
      const text = files.get(key(fileName));
      if (text === undefined) return undefined;
      const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      return ts.createSourceFile(fileName, text, languageVersion, true, kind);
    },
    getDefaultLibFileName: () => '/lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (fileName) => files.has(key(fileName)),
    readFile: (fileName) => files.get(key(fileName)),
    resolveModuleNameLiterals: (literals, containingFile) =>
      literals.map((literal) => {
        const target = resolveSpecifier(files, key(containingFile), literal.text);
        return {
          resolvedModule: target
            ? {
                resolvedFileName: `/${target}`,
                extension: target.endsWith('x') ? ts.Extension.Tsx : ts.Extension.Ts,
              }
            : undefined,
        };
      }),
  };
  return ts.createProgram({
    rootNames: [...files.keys()].map((f) => `/${f}`),
    options: {
      noLib: true,
      types: [],
      noEmit: true,
      allowImportingTsExtensions: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
    },
    host,
  });
}

/**
 * Follows a value expression to what it statically evaluates to: `const` initialisers, imports
 * and barrel re-exports, enum members, default exports, destructuring, and property, element and
 * array accesses with literal keys. Anything else (calls, `let`, parameters, dynamic keys on
 * non-registry objects) is returned as-is and treated as opaque.
 */
function createResolver(checker: ts.TypeChecker) {
  const unwrap = (input: ts.Expression) => {
    let e = input;
    while (
      ts.isAsExpression(e) ||
      ts.isSatisfiesExpression(e) ||
      ts.isParenthesizedExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isTypeAssertionExpression(e)
    )
      e = e.expression;
    return e;
  };
  const isConst = (decl: ts.VariableDeclaration) =>
    ts.isVariableDeclarationList(decl.parent) &&
    (decl.parent.flags & ts.NodeFlags.BlockScoped) === ts.NodeFlags.Const;

  const fromSymbol = (input: ts.Symbol | undefined, depth: number): Resolved | undefined => {
    if (!input) return undefined;
    const symbol = input.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(input) : input;
    const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!decl) return undefined;
    if (REGISTRY_FILES.has(fileOf(decl.getSourceFile()))) return TRUSTED;
    if (ts.isSourceFile(decl)) return undefined;
    if (ts.isVariableDeclaration(decl))
      return decl.initializer && isConst(decl) ? value(decl.initializer, depth + 1) : undefined;
    if (ts.isEnumMember(decl) && decl.initializer) return value(decl.initializer, depth + 1);
    if (ts.isExportAssignment(decl)) return value(decl.expression, depth + 1);
    if (ts.isBindingElement(decl)) return fromBinding(decl, depth);
    return undefined;
  };

  const fromBinding = (decl: ts.BindingElement, depth: number): Resolved | undefined => {
    const pattern = decl.parent;
    const root = pattern.parent;
    if (decl.dotDotDotToken || !ts.isVariableDeclaration(root) || !root.initializer) return;
    if (!isConst(root)) return undefined;
    const source = value(root.initializer, depth + 1);
    if (source === TRUSTED) return TRUSTED;
    const key = ts.isObjectBindingPattern(pattern)
      ? propertyKey(decl.propertyName ?? (decl.name as ts.Identifier))
      : String(pattern.elements.indexOf(decl));
    const found = key === undefined ? undefined : member(source, key, depth);
    return found ?? (decl.initializer ? value(decl.initializer, depth + 1) : undefined);
  };

  const member = (obj: ts.Expression, key: string, depth: number): Resolved | undefined => {
    if (ts.isObjectLiteralExpression(obj)) {
      for (const prop of [...obj.properties].reverse()) {
        if (ts.isSpreadAssignment(prop)) {
          const spread = value(prop.expression, depth + 1);
          if (spread === TRUSTED) return TRUSTED;
          if (!ts.isObjectLiteralExpression(spread)) return undefined;
          const found = member(spread, key, depth + 1);
          if (found !== undefined) return found;
          continue;
        }
        if (!prop.name || propertyKey(prop.name) !== key) continue;
        if (ts.isPropertyAssignment(prop)) return value(prop.initializer, depth + 1);
        if (ts.isShorthandPropertyAssignment(prop))
          return fromSymbol(checker.getShorthandAssignmentValueSymbol(prop), depth + 1);
        return undefined;
      }
      return undefined;
    }
    if (ts.isArrayLiteralExpression(obj) && /^\d+$/.test(key)) {
      const index = Number(key);
      const before = obj.elements.slice(0, index + 1);
      const element = obj.elements[index];
      if (!element || before.some(ts.isSpreadElement) || ts.isOmittedExpression(element)) return;
      return value(element, depth + 1);
    }
    return undefined;
  };

  const value = (input: ts.Expression, depth = 0): Resolved => {
    const expr = unwrap(input);
    if (depth > 16) return expr;
    if (ts.isIdentifier(expr)) {
      const shorthand = ts.isShorthandPropertyAssignment(expr.parent) && expr.parent.name === expr;
      const symbol = shorthand
        ? checker.getShorthandAssignmentValueSymbol(expr.parent)
        : checker.getSymbolAtLocation(expr);
      return fromSymbol(symbol, depth) ?? expr;
    }
    if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
      const target = value(expr.expression, depth + 1);
      if (target === TRUSTED) return TRUSTED;
      let key: string | undefined;
      if (ts.isPropertyAccessExpression(expr)) key = expr.name.text;
      else {
        const arg = value(expr.argumentExpression, depth + 1);
        if (arg !== TRUSTED && (ts.isStringLiteralLike(arg) || ts.isNumericLiteral(arg)))
          key = arg.text;
      }
      const found = key === undefined ? undefined : member(target, key, depth);
      if (found !== undefined) return found;
      // Namespace imports (`import * as m`) and enums: follow the member symbol itself.
      if (ts.isPropertyAccessExpression(expr))
        return fromSymbol(checker.getSymbolAtLocation(expr.name), depth) ?? expr;
      return expr;
    }
    return expr;
  };

  /** Every object literal an expression can evaluate to, across conditionals and fallbacks. */
  const objectsOf = (input: ts.Expression, depth = 0): ts.ObjectLiteralExpression[] => {
    const r = value(input);
    if (r === TRUSTED || depth > 8) return [];
    if (ts.isObjectLiteralExpression(r)) return [r];
    if (ts.isConditionalExpression(r))
      return [...objectsOf(r.whenTrue, depth + 1), ...objectsOf(r.whenFalse, depth + 1)];
    if (isFallback(r)) return [...objectsOf(r.left, depth + 1), ...objectsOf(r.right, depth + 1)];
    return [];
  };

  /** The first raw literal an expression can evaluate to, or undefined when it is canonical. */
  const findRaw = (
    input: ts.Expression,
    test: (lit: Literal) => boolean,
    depth = 0
  ): ts.Node | undefined => {
    const r = value(input);
    if (r === TRUSTED || depth > 8) return undefined;
    const lit = literalText(r);
    if (lit) return test(lit) ? r : undefined;
    if (ts.isTemplateExpression(r)) {
      const parts = [r.head.text, ...r.templateSpans.map((s) => s.literal.text)];
      if (parts.some((p) => rawDimensions(p).length > 0 || COLOR_LITERAL.test(p))) return r;
      for (const span of r.templateSpans) {
        const hit = findRaw(span.expression, isDesignLiteral, depth + 1);
        if (hit) return hit;
      }
      return undefined;
    }
    if (ts.isConditionalExpression(r))
      return findRaw(r.whenTrue, test, depth + 1) ?? findRaw(r.whenFalse, test, depth + 1);
    if (isFallback(r)) return findRaw(r.left, test, depth + 1) ?? findRaw(r.right, test, depth + 1);
    return undefined;
  };

  return { value, objectsOf, findRaw };
}

const isFallback = (e: ts.Expression): e is ts.BinaryExpression =>
  ts.isBinaryExpression(e) &&
  (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
    e.operatorToken.kind === ts.SyntaxKind.BarBarToken);

type Resolver = ReturnType<typeof createResolver>;

// -------------------------------------------------------------------------------------------
// TS / TSX boundaries
// -------------------------------------------------------------------------------------------

function scanTsSource(sf: ts.SourceFile, { findRaw, objectsOf }: Resolver): Violation[] {
  const file = fileOf(sf);
  const out: Violation[] = [];
  const oneLine = (node: ts.Node) => node.getText().replace(/\s+/g, ' ');
  /** Reports at `site` in this file; `origin` is where the raw value lives, when elsewhere. */
  const report = (site: ts.Node, rule: string, origin?: ts.Node) => {
    if (isAllowed(site)) return;
    let text = oneLine(site).slice(0, 120);
    const inside =
      origin &&
      origin.getSourceFile() === sf &&
      origin.getStart() >= site.getStart() &&
      origin.end <= site.end;
    if (origin && !inside) {
      const where = `${fileOf(origin.getSourceFile())}:${lineOf(origin)}`;
      text += ` = ${oneLine(origin).slice(0, 60)} @ ${where}`;
    }
    out.push({ file, line: lineOf(site), rule, text });
  };

  const checkStyleObject = (
    obj: ts.ObjectLiteralExpression,
    site: ts.Node,
    anyKey = false,
    seen = new Set<ts.Node>()
  ) => {
    if (seen.has(obj)) return;
    seen.add(obj);
    const local = obj.getSourceFile() === sf;
    for (const prop of obj.properties) {
      const at = local ? prop : site;
      if (ts.isSpreadAssignment(prop)) {
        for (const spread of objectsOf(prop.expression)) checkStyleObject(spread, at, anyKey, seen);
        continue;
      }
      if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue;
      const key = propertyKey(prop.name) ?? '';
      const init = ts.isPropertyAssignment(prop) ? prop.initializer : prop.name;
      const nested = objectsOf(init);
      if (nested.length > 0) {
        for (const inner of nested) checkStyleObject(inner, at, anyKey, seen);
        continue;
      }
      if (!key.startsWith('--') && !anyKey && !STYLE_KEYS.has(key)) continue;
      const hit = findRaw(init, key === 'fontFamily' ? isFontLiteral : isDesignLiteral);
      if (hit) report(at, 'ts-style-literal', hit);
      // String literals buried in calls inside a template or conditional value.
      if (ts.isTemplateExpression(init) || ts.isConditionalExpression(init)) {
        init.forEachChild(function walk(child) {
          const inner = ts.isExpression(child) ? literalText(child) : null;
          if (inner && inner.kind === 'string' && isDesignLiteral(inner))
            report(child, 'ts-style-literal');
          child.forEachChild(walk);
        });
      }
    }
  };

  const checkMotionObject = (obj: ts.ObjectLiteralExpression, site: ts.Node) => {
    const local = obj.getSourceFile() === sf;
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue;
      const init = ts.isPropertyAssignment(prop) ? prop.initializer : prop.name;
      const hit = findRaw(init, isMotionNumber);
      if (hit) report(local ? prop : site, 'ts-motion-literal', hit);
    }
  };

  const isStringNode = (node: ts.Node): node is ts.StringLiteralLike | ts.TemplateLiteralLikeNode =>
    ts.isStringLiteralLike(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node);

  const visit = (node: ts.Node) => {
    // 0. Named visual constants with literal values.
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      if (
        /^[A-Z][A-Z0-9_]+$/.test(name) &&
        VISUAL_CONSTANT_NAME.test(name) &&
        !BUSINESS_CONSTANT_NAME.test(name)
      ) {
        const hit = findRaw(node.initializer, isDesignLiteral);
        if (hit) report(node, 'ts-visual-constant', hit);
        for (const obj of objectsOf(node.initializer)) checkStyleObject(obj, node, true);
      }
    }
    // 1. Colour literals anywhere in strings.
    if (isStringNode(node) && COLOR_LITERAL.test(node.text)) {
      if (!ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent))
        report(node, 'ts-color-literal');
    }
    // 2. CSS var fallbacks in strings.
    if (isStringNode(node) && /var\(\s*--[\w-]+\s*,/.test(node.text)) {
      report(node, 'ts-var-fallback');
    }
    // 3. JSX style objects and visual attributes.
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sf);
      const element = node.parent.parent as ts.JsxOpeningLikeElement;
      const tag = element.tagName.getText(sf);
      const expr = ts.isJsxExpression(node.initializer)
        ? node.initializer.expression
        : ts.isStringLiteral(node.initializer)
          ? node.initializer
          : undefined;
      if (expr) {
        for (const obj of objectsOf(expr)) checkStyleObject(obj, node);
        const svgChild = isSvgPrimitive(tag) && tag !== 'svg';
        const geometry =
          isSvgPrimitive(tag) &&
          (SVG_GEOMETRY_ATTRS.has(name) || (svgChild && SVG_CHILD_GEOMETRY_ATTRS.has(name)));
        const artwork = svgChild && ARTWORK_FILES.has(file);
        if (VISUAL_ATTRS.has(name) && !geometry && !artwork) {
          const colourOnly = name === 'fill' || name === 'stroke';
          const hit = findRaw(
            expr,
            colourOnly ? isColorLiteral : name === 'fontFamily' ? isFontLiteral : isDesignLiteral
          );
          if (hit) report(node, 'ts-visual-attr', hit);
        }
      }
    }
    // 4. Objects typed as CSSProperties.
    if (
      ts.isVariableDeclaration(node) &&
      node.type &&
      /CSSProperties/.test(node.type.getText(sf)) &&
      node.initializer
    ) {
      for (const obj of objectsOf(node.initializer)) checkStyleObject(obj, node);
    }
    // 5. Imperative style writes: `el.style.x = '…'`, `style.setProperty('--x', '…')`.
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      /\.style\.\w+$/.test(node.left.getText(sf))
    ) {
      const hit = findRaw(
        node.right,
        /\.fontFamily$/.test(node.left.getText(sf)) ? isFontLiteral : isDesignLiteral
      );
      if (hit) report(node, 'ts-style-literal', hit);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      if (/\.setProperty$/.test(callee) && node.arguments[1]) {
        const key = node.arguments[0];
        const font = key && ts.isStringLiteralLike(key) && key.text === 'font-family';
        const hit = findRaw(node.arguments[1], font ? isFontLiteral : isDesignLiteral);
        if (hit) report(node, 'ts-style-literal', hit);
      }
      // 6. Media queries, including named or imported query strings.
      if (/(^|\.)matchMedia$|^useMediaQuery$/.test(callee) && node.arguments[0]) {
        const hit = findRaw(node.arguments[0], isMediaLiteral);
        if (hit) report(node, 'ts-media-literal', hit);
      }
      // 7. Animation calls: keyframe values and options.
      if (/^animate$|\.animate$/.test(callee)) {
        for (const arg of node.arguments.slice(1))
          for (const obj of objectsOf(arg)) checkMotionObject(obj, node);
      }
      // 8. Inline timer delays must be named (a token or a business constant), so no resolution.
      if (/^(window\.)?setTimeout$/.test(callee) && node.arguments[1]) {
        const lit = literalText(node.arguments[1]);
        if (lit && lit.kind === 'number' && lit.text !== '0')
          report(node.arguments[1], 'ts-inline-timer');
      }
    }
    // 9. Motion option keys anywhere.
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const key = propertyKey(node.name) ?? '';
      if (MOTION_KEYS.has(key)) {
        const init = ts.isPropertyAssignment(node) ? node.initializer : node.name;
        const hit = findRaw(init, isMotionLiteral);
        if (hit) report(node, 'ts-motion-literal', hit);
      }
    }
    // 10. String literals carrying CSS units inside translate/scale templates or media strings.
    if (
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isStringLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const t = node.text;
      if (
        /\b(translate[XYZ3d]*|scale[XY]?|rotate)\([^)]*\d(px|rem|em)?/.test(t) &&
        rawDimensions(t).length > 0
      )
        report(node, 'ts-transform-literal');
      if (/\((max|min)-(width|height):\s*\d/.test(t)) report(node, 'ts-media-literal');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * Scans TS/TSX modules as one program so values imported from other modules (relative or `@/`,
 * through barrels) are resolved at visual boundaries. `files` maps repo-relative paths to source;
 * registry files are loaded for resolution but never scanned.
 */
export function scanTsFiles(
  files: Record<string, string>,
  targets = Object.keys(files).filter((f) => !REGISTRY_FILES.has(f))
): Violation[] {
  const program = createProgram(new Map(Object.entries(files)));
  const resolver = createResolver(program.getTypeChecker());
  const seen = new Set<string>();
  return targets
    .flatMap((file) => scanTsSource(program.getSourceFile(`/${file}`)!, resolver))
    .filter((v) => {
      // De-duplicate overlapping rules on the same node.
      const key = `${v.file}|${v.line}|${v.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function scanTsText(file: string, text: string): Violation[] {
  return scanTsFiles({ [file]: text });
}

export function listSourceFiles(root: string): string[] {
  return readdirSync(path.join(root, 'src'), { recursive: true })
    .map(String)
    .map((f) => `src/${f.split(path.sep).join('/')}`)
    .filter((f) => /\.(scss|ts|tsx)$/.test(f) && !f.endsWith('.d.ts') && !REGISTRY_FILES.has(f))
    .sort();
}

export function scanRepository(root: string): Violation[] {
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
  const files = listSourceFiles(root);
  const scss = files.filter((f) => f.endsWith('.scss'));
  const tsTargets = files.filter((f) => !f.endsWith('.scss'));
  const tsFiles = Object.fromEntries(
    [...tsTargets, REGISTRY_SOURCE].map((f) => [f, read(f)] as const)
  );
  return [
    ...scss.flatMap((file) => scanScssText(file, read(file))),
    ...scanTsFiles(tsFiles, tsTargets),
  ];
}
