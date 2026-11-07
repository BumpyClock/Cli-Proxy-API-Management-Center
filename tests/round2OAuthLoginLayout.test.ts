import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compileString } from 'sass';

const css = compileString(
  `@use 'src/styles/variables' as *;\n${readFileSync('src/pages/OAuthPage.module.scss', 'utf8')}`,
  {
    loadPaths: [process.cwd()],
    url: new URL('../src/pages/OAuthPage.module.scss', import.meta.url),
  }
).css;
const phone = css.slice(css.indexOf('@media (max-width: 640px)'));

describe('round 2 OAuth login rows on phones', () => {
  test('icon sits beside the name; description and actions share the full row width', () => {
    expect(phone).toMatch(/\.rowCopy \{\s*display: contents;/);
    expect(phone).toMatch(/\.rowTitle \{\s*grid-column: 2;/);
    expect(phone).toMatch(/\.rowCopy \.cardHint \{\s*grid-column: 1\s*\/\s*-1;/);
    expect(phone).toMatch(/\.rowActions \{\s*grid-column: 1\s*\/\s*-1;/);
    expect(phone).toMatch(/\.rowFlow \{\s*grid-column: 1\s*\/\s*-1;/);
  });

  test('one wrapping rule for every action group: one line on wide screens, stacked on phones', () => {
    // Label length must not decide whether a row wraps (Kimi China vs International).
    expect(css).toMatch(/\.rowActions \{[^}]*display: flex;[^}]*flex-wrap: nowrap;/);
    expect(phone).toMatch(/\.rowActions \{[^}]*flex-direction: column;/);
  });
});
