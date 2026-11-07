import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compile } from 'sass';
import { Button } from '@/components/ui/Button';

const css = compile('src/styles/components.scss', { loadPaths: [process.cwd()] }).css;
const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)}`));
  return { body: match?.[1] ?? '', index: match?.index ?? -1 };
};

describe('shared Button disabled state', () => {
  const disabled = rule('.btn:disabled:not([aria-busy=true])');

  test('every variant goes neutral: light fill, muted text, visible outline', () => {
    expect(disabled.body).toContain('background-color: var(--bg-tertiary)');
    expect(disabled.body).toContain('color: var(--text-tertiary)');
    expect(disabled.body).toContain('border-color: var(--control-outline)');
    expect(rule('.btn:disabled').body).toContain('cursor: not-allowed');
  });

  test('the disabled rule follows the variant hovers so a hovered primary stays neutral', () => {
    for (const hover of [
      '.btn.btn-primary:hover',
      '.btn.btn-danger:hover',
      '.btn.btn-ghost:hover',
    ]) {
      const { index } = rule(hover);
      expect(index, hover).toBeGreaterThan(-1);
      expect(index, hover).toBeLessThan(disabled.index);
    }
  });

  test('ghost stays chromeless and dims; a loading button keeps its variant and only dims', () => {
    const ghost = rule('.btn.btn-ghost:disabled:not([aria-busy=true])').body;
    expect(ghost).toContain('background: transparent');
    expect(ghost).toContain('border-color: transparent');
    expect(ghost).toContain('opacity: 0.6');
    expect(rule('.btn[aria-busy=true]:disabled').body).toContain('opacity: 0.75');
  });

  test('loading marks the button busy as well as disabled', () => {
    const busy = renderToStaticMarkup(createElement(Button, { loading: true }, 'Save'));
    expect(busy).toContain('disabled=""');
    expect(busy).toContain('aria-busy="true"');
    const blocked = renderToStaticMarkup(createElement(Button, { disabled: true }, 'Save'));
    expect(blocked).toContain('disabled=""');
    expect(blocked).not.toContain('aria-busy');
  });
});
