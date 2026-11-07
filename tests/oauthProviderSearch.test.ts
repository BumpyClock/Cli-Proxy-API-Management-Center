import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { OAuthPage } from '@/pages/OAuthPage';
import { filterOAuthProviders, matchesOAuthProvider } from '@/pages/oauthProviderSearch';
import en from '@/i18n/locales/en.json';

type Row = { id: string; names: string[] };
const ROWS: Row[] = [
  { id: 'kimi', names: ['kimi', 'Kimi China (kimi.com)'] },
  { id: 'kimi-ai', names: ['kimi-ai', 'Kimi International (kimi.ai)'] },
  { id: 'anthropic', names: ['anthropic', 'Claude OAuth', 'Log in with Claude'] },
  { id: 'xai', names: ['xai', 'xAI OAuth'] },
];
const ids = (query: string, pinned: string[] = []) =>
  filterOAuthProviders(
    ROWS,
    query,
    (row) => row.names,
    (row) => pinned.includes(row.id)
  ).map((row) => row.id);

describe('OAuth Login provider search', () => {
  test('an empty or blank query lists every provider in order', () => {
    expect(ids('')).toEqual(['kimi', 'kimi-ai', 'anthropic', 'xai']);
    expect(ids('   ')).toEqual(['kimi', 'kimi-ai', 'anthropic', 'xai']);
  });

  test('matches name, region and domain case-insensitively', () => {
    expect(ids('KIMI')).toEqual(['kimi', 'kimi-ai']);
    expect(ids('china')).toEqual(['kimi']);
    expect(ids('kimi.ai')).toEqual(['kimi-ai']);
    expect(ids('anthr')).toEqual(['anthropic']);
    // The row reads Claude; the backend id still finds it for people who search the company.
    expect(ids('claude')).toEqual(['anthropic']);
  });

  test('every word must match, in any order', () => {
    expect(ids('international kimi')).toEqual(['kimi-ai']);
    expect(ids('kimi anthropic')).toEqual([]);
  });

  test('ignores accents so typed and translated names still meet', () => {
    expect(matchesOAuthProvider(['Qoder OAuth'], 'qöder')).toBe(true);
  });

  test('a provider with a sign-in in progress stays visible under any filter', () => {
    expect(ids('xai', ['kimi'])).toEqual(['kimi', 'xai']);
    expect(ids('nothing-matches', ['anthropic'])).toEqual(['anthropic']);
  });

  test('the page renders a labelled search above the provider list with a status region', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(MemoryRouter, null, createElement(OAuthPage))
      )
    );
    const input = markup.match(/<input[^>]*type="search"[^>]*>/)?.[0] ?? '';
    expect(input).toContain(`aria-label="${en.auth_login.provider_search_label}"`);
    const describedBy = input.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(markup).toMatch(new RegExp(`id="${describedBy}"[^>]*role="status"`));
    expect(markup.indexOf('type="search"')).toBeLessThan(markup.indexOf('<article'));
    // No clear button or empty state until the user types.
    expect(markup).not.toContain(en.auth_login.provider_search_clear);
  });
});
