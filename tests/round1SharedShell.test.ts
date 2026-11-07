import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { compile, compileString } from 'sass';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
const compileModule = (path: string) =>
  compileString(`@use 'src/styles/variables.scss' as *;\n${readFileSync(path, 'utf8')}`, {
    url: new URL(`../${path}`, import.meta.url),
    loadPaths: [process.cwd()],
  }).css;
const ruleBody = (css: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]+)}`))?.[1] ?? '';
};

describe('RefreshButton', () => {
  test('defaults to a visible, labeled Refresh action', () => {
    const html = render(createElement(RefreshButton, { onClick: () => {} }));
    expect(html).toContain('<span>Refresh</span>');
    expect(html).toContain('type="button"');
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('disabled=""');
  });

  test('stays focusable while busy and announces the busy label', () => {
    const html = render(
      createElement(RefreshButton, { onClick: () => {}, label: 'Reload config', refreshing: true })
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('<span>Refreshing…</span>');
    expect(html).not.toContain('disabled=""');
  });

  test('renders full and compact scope labels for wide and narrow screens', () => {
    const html = render(
      createElement(RefreshButton, {
        onClick: () => {},
        label: 'Refresh all credentials',
        compactLabel: 'Refresh all',
      })
    );
    expect(html).toMatch(/<span[^>]*>Refresh all credentials<\/span>/);
    expect(html).toMatch(/<span[^>]*>Refresh all<\/span>/);
    const css = compileModule('src/components/ui/RefreshButton.module.scss');
    expect(css).toMatch(/@media \(max-width: 768px\)[^@]*\.fullLabel \{\s*display: none;/);
  });
});

describe('shared shell styles', () => {
  test('the off-screen skip link casts no shadow until it is focused', () => {
    const css = compile('src/styles/layout.scss').css;
    expect(ruleBody(css, '.skip-link')).toContain('box-shadow: none');
    const focus = ruleBody(css, '.skip-link:focus, .skip-link:focus-visible');
    expect(focus).toContain('transform: none');
    expect(focus).toMatch(/box-shadow: 0 8px 24px/);
  });

  test('button icon and label children keep a gap and get 44px targets on phones', () => {
    const css = compile('src/styles/components.scss').css;
    expect(ruleBody(css, '.btn > span')).toContain('gap: 6px');
    expect(css).toMatch(
      /@media \(max-width: 768px\), \(pointer: coarse\) \{\s*\.btn, \.btn\.btn-sm \{\s*min-width: 44px;\s*min-height: 44px;/
    );
  });

  test('page roots inherit the shell gutter instead of adding their own', () => {
    const providers = compileModule('src/features/providers/ProvidersWorkbenchPage.module.scss');
    expect(ruleBody(providers, '.page')).not.toContain('padding');
  });

  test('empty states stack their action under the copy on phones', () => {
    const css = compile('src/styles/components.scss').css;
    expect(css).toMatch(
      /@media \(max-width: 600px\) \{\s*\.empty-state \{\s*flex-direction: column;/
    );
  });
});

describe('ToggleSwitch', () => {
  test('exposes switch semantics and an optional tooltip', () => {
    const html = render(
      createElement(ToggleSwitch, {
        checked: true,
        onChange: () => {},
        ariaLabel: 'Auto refresh',
        title: 'Auto refresh',
      })
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('title="Auto refresh"');
    expect(html).toContain('checked=""');
  });
});
