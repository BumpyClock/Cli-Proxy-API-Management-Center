/**
 * Minimal SCSS statement scanner shared by the token codemod and the drift guard.
 *
 * It does not build a full SCSS AST. It masks comments, strings and `#{}` interpolation so that
 * braces and semicolons inside them cannot be mistaken for structure, then reports:
 * - every declaration (`prop: value;`, including `--custom` and `$sass` declarations) with the
 *   chain of enclosing block preludes, so callers know when they are inside `@keyframes`;
 * - every `@media` / `@include` / `@container` prelude.
 * Offsets index the original text, so callers can rewrite values in place.
 */

export interface ScssDeclaration {
  prop: string;
  value: string;
  /** Offset of the first value character in the original text. */
  valueStart: number;
  valueEnd: number;
  line: number;
  /** Enclosing block preludes, outermost first (selectors and at-rules). */
  blocks: string[];
}

export interface ScssAtRule {
  name: string;
  prelude: string;
  preludeStart: number;
  preludeEnd: number;
  line: number;
}

export interface ScssScan {
  declarations: ScssDeclaration[];
  atRules: ScssAtRule[];
}

const MASK = '\uE000';

/** Replace comments, strings and interpolation bodies with mask characters of equal length. */
export function maskScss(text: string): string {
  const out = text.split('');
  let i = 0;
  const fill = (from: number, to: number, keepNewlines = true) => {
    for (let k = from; k < to; k += 1) {
      if (!(keepNewlines && out[k] === '\n')) out[k] = MASK;
    }
  };
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      fill(i, stop);
      i = stop;
    } else if (ch === '/' && next === '/' && text[i - 1] !== ':') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      fill(i, stop);
      i = stop;
    } else if (ch === '"' || ch === "'") {
      let k = i + 1;
      while (k < text.length && text[k] !== ch) k += text[k] === '\\' ? 2 : 1;
      fill(i + 1, k);
      i = k + 1;
    } else if (ch === '#' && next === '{') {
      let depth = 1;
      let k = i + 2;
      while (k < text.length && depth > 0) {
        if (text[k] === '{') depth += 1;
        else if (text[k] === '}') depth -= 1;
        k += 1;
      }
      // Keep `#` visible so callers still see an interpolation; mask the braces and body.
      fill(i + 1, k);
      i = k;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

const lineAt = (text: string, offset: number) => {
  let line = 1;
  for (let k = 0; k < offset; k += 1) if (text.charCodeAt(k) === 10) line += 1;
  return line;
};

export function scanScss(text: string): ScssScan {
  const masked = maskScss(text);
  const declarations: ScssDeclaration[] = [];
  const atRules: ScssAtRule[] = [];
  const stack: string[] = [];
  let statementStart = 0;

  const lineCache: number[] = [];
  let line = 1;
  for (let k = 0; k <= text.length; k += 1) {
    lineCache.push(line);
    if (text.charCodeAt(k) === 10) line += 1;
  }

  const handleStatement = (start: number, end: number, opensBlock: boolean) => {
    const raw = masked.slice(start, end);
    // Leading comments are masked, so skip mask characters as well as whitespace.
    const lead = /^[\s\uE000]*/.exec(raw)![0].length;
    const body = raw.slice(lead).trim();
    if (!body) return;
    const absStart = start + lead;
    if (body.startsWith('@')) {
      const m = /^@([\w-]+)\s*/.exec(body);
      if (m) {
        const preludeStart = absStart + m[0].length;
        const preludeEnd = absStart + body.length;
        atRules.push({
          name: m[1],
          prelude: text.slice(preludeStart, preludeEnd),
          preludeStart,
          preludeEnd,
          line: lineCache[absStart],
        });
      }
      return;
    }
    if (opensBlock) return;
    const m = /^(\$?-{0,2}[A-Za-z_][\w-]*)\s*:(?!:)\s*/.exec(body);
    if (!m) return;
    const valueStart = absStart + m[0].length;
    let valueEnd = absStart + body.length;
    // Drop a trailing `!default` / `!important` from the reported value boundaries? Keep it;
    // callers treat flags as keywords.
    while (valueEnd > valueStart && /\s/.test(text[valueEnd - 1])) valueEnd -= 1;
    declarations.push({
      prop: m[1],
      value: text.slice(valueStart, valueEnd),
      valueStart,
      valueEnd,
      line: lineCache[absStart],
      blocks: [...stack],
    });
  };

  for (let k = 0; k < masked.length; k += 1) {
    const ch = masked[k];
    if (ch === '{') {
      // Preludes come from the masked text so comments never leak into block context.
      const prelude = masked.slice(statementStart, k).replace(/\uE000+/g, ' ');
      handleStatement(statementStart, k, true);
      stack.push(prelude.replace(/\s+/g, ' ').trim());
      statementStart = k + 1;
    } else if (ch === '}') {
      handleStatement(statementStart, k, false);
      stack.pop();
      statementStart = k + 1;
    } else if (ch === ';') {
      handleStatement(statementStart, k, false);
      statementStart = k + 1;
    }
  }
  return { declarations, atRules };
}

export const insideKeyframes = (decl: ScssDeclaration) =>
  decl.blocks.some((block) => /^@(-webkit-)?keyframes\b/.test(block));

export { lineAt };
