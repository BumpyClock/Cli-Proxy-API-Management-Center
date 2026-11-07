import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { compileString } from 'sass';
import { claudeToResource } from '@/features/providers/adapters';
import { ProviderCategoryList } from '@/features/providers/components/ProviderCategoryList';
import type { ProviderGroup } from '@/features/providers/types';
import { createTestI18n, productionLocales } from './helpers/locales';

const i18n = await createTestI18n();
const groups: ProviderGroup[] = [
  { id: 'claude', resources: [claudeToResource({ apiKey: 'fixture-private-key' }, 0)] },
  { id: 'gemini', resources: [] },
];
const scssPath = 'src/features/providers/components/ProviderCategoryList.module.scss';

describe('providers Not configured row', () => {
  test('is an in-place disclosure that says what picking a provider does', () => {
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(ProviderCategoryList, { groups, activeBrand: 'claude', onSelect: () => {} })
      )
    );
    const details = markup.slice(markup.indexOf('<details'), markup.indexOf('</details>'));
    const summary = details.slice(details.indexOf('<summary'), details.indexOf('</summary>'));
    // No trailing navigation-style chevron icon; the shared disclosure chevron is CSS.
    expect(summary).not.toContain('<svg');
    expect(details).toContain('Select a provider to add its first key.');
    expect(details.indexOf('</summary>')).toBeLessThan(details.indexOf('Select a provider'));
    for (const [locale, messages] of Object.entries(productionLocales)) {
      expect(messages.redesign.providers.notConfiguredHint, locale).toBeTruthy();
    }
  });

  test('uses the shared disclosure mixin with a 44px row', () => {
    const scss = readFileSync(scssPath, 'utf8');
    expect(scss).toMatch(/\.summary \{\s*@include disclosure-summary;/);
    const css = compileString(`@use 'src/styles/variables' as *;\n${scss}`, {
      loadPaths: [process.cwd()],
      url: pathToFileURL(scssPath),
    }).css;
    expect(css).toMatch(/\.summary::before \{[^}]*transform: rotate\(-45deg\);/);
    expect(css).toMatch(/\.summary \{[^}]*display: flex;[^}]*min-height: 44px;/);
    expect(css).toMatch(/\.summaryHint \{[^}]*font-size: 13px;/);
  });
});
