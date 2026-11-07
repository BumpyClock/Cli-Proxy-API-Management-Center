import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { compileString } from 'sass';
import { HostField } from '@/features/config/components/fields/sharedFields';
import { DEFAULT_VISUAL_VALUES } from '@/types/visualConfig';
import { createTestI18n, productionLocales } from './helpers/locales';

const i18n = await createTestI18n();
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
const source = (path: string) => readFileSync(path, 'utf8');
const compile = (path: string) =>
  compileString(`@use 'src/styles/variables.scss' as *;\n${source(path)}`, {
    url: new URL(`../${path}`, import.meta.url),
    loadPaths: [process.cwd()],
  }).css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('config host address', () => {
  test('an unset host defers to the backend instead of asserting a default address', () => {
    const markup = render(
      createElement(HostField, {
        values: { ...DEFAULT_VISUAL_VALUES, host: '' },
        disabled: false,
        onChange: () => {},
      })
    );
    expect(markup).toContain('placeholder="Empty uses the backend default"');
    for (const [locale, messages] of Object.entries(productionLocales)) {
      const placeholder = messages.config_management.visual.sections.server.host_placeholder;
      expect(placeholder, locale).not.toContain('0.0.0.0');
      expect(placeholder.length, locale).toBeGreaterThan(3);
    }
  });
});

describe('config field and nav presentation', () => {
  test('inputs draw their boundary with --border-primary', () => {
    const css = compile('src/features/config/components/fields/Field.module.scss');
    // Plain sass keeps the CSS-module `:global(.input)` wrapper; Vite strips it at build time.
    const input = css.match(/\.fieldsRoot :global\(\.input\) \{([^}]*)\}/)?.[1] ?? '';
    expect(input).toContain('border-color: var(--border-primary)');
  });

  test('only the active section nav item is emphasized', () => {
    const css = compile('src/features/config/components/ConfigTabs.module.scss');
    const tab = css.match(/\n\.tab \{([^}]*)\}/)?.[1] ?? '';
    expect(tab).toContain('font-weight: 400');
    expect(css).toMatch(/\.tabActive \{[^}]*font-weight: 600/);
  });

  test('section icon shares the title row on phones', () => {
    const css = compile('src/features/config/components/SectionCard.module.scss');
    const mobile = css.split('@media (max-width: 768px)').slice(1).join('\n');
    expect(css).toMatch(/grid-template-areas: "badges title" ". description"/);
    expect(mobile).toMatch(/grid-template-areas: "badges title" "description description"/);
  });

  test('Add API Key uses the shared secondary button', () => {
    expect(source('src/features/config/components/blocks/ApiKeysCardEditor.tsx')).toMatch(
      /<Button variant="secondary" size="sm" onClick=\{openAddModal\}/
    );
  });
});
