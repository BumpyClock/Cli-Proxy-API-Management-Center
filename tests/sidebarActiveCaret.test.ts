import { describe, expect, test } from 'bun:test';
import { compile } from 'sass';

describe('active sidebar drawer styling', () => {
  test('compiled active caret rule follows the selected foreground instead of the background', () => {
    const { css } = compile('src/styles/layout.scss');
    expect(css).toMatch(/\.sidebar \.nav-item\.active \.nav-drawer-caret\s*\{\s*color: inherit;/);
    expect(css).toMatch(
      /\.sidebar \.nav-item\.active\s*\{[^}]*background: var\(--bg-hover\);[^}]*color: var\(--text-primary\);/
    );
  });
});
