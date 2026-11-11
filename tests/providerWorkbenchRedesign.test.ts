import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { OAuthPage } from '@/pages/OAuthPage';
import { ProviderCategoryList } from '@/features/providers/components/ProviderCategoryList';
import { claudeToResource } from '@/features/providers/adapters';
import { readProvidersWorkbenchUiState, resolveProviderBrand } from '@/features/providers/uiState';
import type { ProviderGroup } from '@/features/providers/types';
import { createTestI18n, localeParityIssues, productionLocales } from './helpers/locales';

const i18n = await createTestI18n();
const resource = claudeToResource({ apiKey: 'fixture-private-key' }, 0);
const groups: ProviderGroup[] = [
  { id: 'gemini', resources: [] },
  { id: 'claude', resources: [resource] },
  { id: 'fennoAI', resources: [] },
];

describe('provider workbench configured-first presentation', () => {
  test('shipped provider translations have key and interpolation parity', () => {
    expect(localeParityIssues(productionLocales, ['redesign.providers'])).toEqual([]);
  });

  test('opens a configured family on first visit, preserving explicit and fixed choices', () => {
    expect(readProvidersWorkbenchUiState().activeBrand).toBeNull();
    expect(resolveProviderBrand(groups, null)).toBe('claude');
    expect(resolveProviderBrand(groups, 'gemini')).toBe('gemini');
    expect(resolveProviderBrand(groups, 'meta')).toBe('claude');
    expect(resolveProviderBrand(groups, 'claude', 'apikeyFun')).toBe('apikeyFun');
    expect(resolveProviderBrand([{ id: 'gemini', resources: [] }], null)).toBe('gemini');
  });

  test('lists configured families first and preserves sponsor families with neutral empty labels', () => {
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(ProviderCategoryList, {
          groups,
          activeBrand: 'claude',
          onSelect: () => {},
        })
      )
    );
    expect(markup.indexOf('Claude')).toBeLessThan(markup.indexOf('Gemini'));
    expect(markup).toContain('FennoAI');
    expect(markup).toContain('Not configured');
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).not.toContain('fixture-private-key');
    expect(markup).not.toContain('redesign.providers.');
  });
});

test('OAuth list keeps all built-in login choices and the JSON import without starting sessions', () => {
  const markup = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(MemoryRouter, null, createElement(OAuthPage))
    )
  );
  expect(markup.match(/<h1\b/g)).toHaveLength(1);
  for (const provider of [
    'meta',
    'kimi',
    'kimi_ai',
    'codex',
    'anthropic',
    'antigravity',
    'xai',
    'devin',
  ]) {
    expect(markup).toContain(i18n.t(`auth_login.${provider}_oauth_title`));
    expect(markup).toContain(i18n.t(`auth_login.${provider}_oauth_button`));
  }
  expect(markup).not.toContain(i18n.t('auth_login.qoder_oauth_button'));
  expect(markup).toContain(i18n.t('vertex_import.import_button'));
  expect(markup).toContain('type="file"');
  expect(markup.indexOf(i18n.t('auth_login.meta_oauth_title'))).toBeLessThan(
    markup.indexOf(i18n.t('auth_login.kimi_oauth_title'))
  );
  expect(markup).not.toContain('auth_login.');
});
