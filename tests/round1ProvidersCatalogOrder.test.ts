import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { compileString } from 'sass';
import { claudeToResource } from '@/features/providers/adapters';
import { ProviderCategoryList } from '@/features/providers/components/ProviderCategoryList';
import { shouldExpandUnconfigured } from '@/features/providers/workbenchLayout';
import type { ProviderBrand, ProviderGroup } from '@/features/providers/types';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();
const configured: ProviderGroup = {
  id: 'claude',
  resources: [claudeToResource({ apiKey: 'fixture-private-key' }, 0)],
};
const catalog: ProviderGroup[] = [
  { id: 'gemini', resources: [] },
  configured,
  { id: 'openaiCompatibility', resources: [] },
];

const render = (groups: ProviderGroup[], activeBrand: ProviderBrand) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(ProviderCategoryList, {
        groups,
        activeBrand,
        onSelect: () => {},
        detail: createElement('section', { 'data-detail': 'selected' }, 'Selected detail'),
      })
    )
  );

describe('provider catalog one-column order', () => {
  test('reads configured list, then the selected detail, then not-configured providers', () => {
    const markup = render(catalog, 'claude');
    // Anchor on the catalog buttons (their titles), not the phone picker's <option> text.
    const claude = markup.indexOf('title="Claude"');
    const detail = markup.indexOf('data-detail="selected"');
    const notConfigured = markup.search(/<h2[^>]*>Not configured<\/h2>/);
    const gemini = markup.indexOf('title="Gemini"');
    expect(claude).toBeGreaterThan(-1);
    expect(claude).toBeLessThan(detail);
    expect(detail).toBeLessThan(notConfigured);
    expect(notConfigured).toBeLessThan(gemini);
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).not.toContain('fixture-private-key');
  });

  test('not-configured providers are a native disclosure with a visible count', () => {
    const markup = render(catalog, 'claude');
    expect(markup).toMatch(/<details[^>]*>\s*<summary/);
    expect(markup).toMatch(/<summary[^>]*><h2[^>]*>Not configured<\/h2><span[^>]*>2<\/span>/);
  });

  test('collapses at every width while a configured provider is selected', () => {
    expect(shouldExpandUnconfigured({ configuredCount: 1, activeIsConfigured: true })).toBe(false);
    expect(shouldExpandUnconfigured({ configuredCount: 3, activeIsConfigured: true })).toBe(false);
    // Nothing configured: the catalog is the setup path.
    expect(shouldExpandUnconfigured({ configuredCount: 0, activeIsConfigured: false })).toBe(true);
    // The selected provider is in the not-configured group, so it must stay visible.
    expect(shouldExpandUnconfigured({ configuredCount: 1, activeIsConfigured: false })).toBe(true);
  });

  test('the server-rendered disclosure starts collapsed when a configured provider is selected', () => {
    expect(render(catalog, 'claude')).not.toMatch(/<details[^>]*\bopen=""/);
    expect(render(catalog, 'gemini')).toMatch(/<details[^>]*\bopen=""/);
  });

  test('with nothing configured the detail leads straight into the open catalog', () => {
    const markup = render([{ id: 'gemini', resources: [] }], 'gemini');
    expect(markup).not.toContain('Configured<');
    expect(markup.indexOf('data-detail="selected"')).toBeLessThan(
      markup.search(/<h2[^>]*>Not configured<\/h2>/)
    );
    expect(markup).toMatch(/<details[^>]*\bopen=""/);
  });

  test('long provider names keep the full name as a tooltip instead of an ellipsis-only label', () => {
    const markup = render(catalog, 'claude');
    expect(markup).toContain('title="OpenAI Compatible"');
  });
});

describe('provider catalog desktop grid', () => {
  const path = 'src/features/providers/components/ProviderCategoryList.module.scss';
  const css = compileString(
    `@use 'src/styles/variables.scss' as *;\n${readFileSync(path, 'utf8')}`,
    {
      url: new URL(`../${path}`, import.meta.url),
      loadPaths: [process.cwd()],
    }
  ).css;

  test('two columns at 1000px keep the catalog beside the detail', () => {
    const desktop = css.split('@media (min-width: 1000px)')[1] ?? '';
    expect(desktop).toContain('grid-template-columns: 240px minmax(0, 1fr)');
    expect(desktop).toMatch(/grid-template-areas:\s*"configured detail"\s*"unconfigured detail"/);
    expect(desktop).toMatch(/\.detailArea\s*\{\s*grid-area: detail;/);
  });

  test('item titles wrap to two lines rather than truncating on one', () => {
    const itemTitle = css.match(/\.itemTitle\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(itemTitle).not.toContain('white-space: nowrap');
    expect(itemTitle).toContain('-webkit-line-clamp: 2');
  });
});
