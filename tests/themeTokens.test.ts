import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// A var() that names an undefined custom property silently resolves to its fallback (or to
// nothing), so a theme token typo ships light-theme hex into dark mode. Every referenced
// property must be declared in a stylesheet or set at runtime from a component.
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

const sources = files('src').filter((path) => /\.(scss|css|tsx|ts)$/.test(path));
const defined = new Set<string>();
const referenced = new Map<string, string>();
for (const path of sources) {
  const text = readFileSync(path, 'utf8');
  for (const match of text.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(match[1]);
  // Runtime-set properties: style={{ '--x': ... }} or style.setProperty('--x', ...).
  for (const match of text.matchAll(/['"`](--[a-z0-9-]+)['"`]/gi)) defined.add(match[1]);
  for (const match of text.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    if (!referenced.has(match[1])) referenced.set(match[1], path);
  }
}

describe('theme tokens', () => {
  test('every var() reference names a declared custom property', () => {
    const undefinedRefs = [...referenced]
      // Template prefixes such as `var(--chart-${n})` are resolved at runtime.
      .filter(([name]) => !name.endsWith('-') && !defined.has(name))
      .map(([name, path]) => `${name} (${path})`);
    expect(undefinedRefs).toEqual([]);
  });
});
