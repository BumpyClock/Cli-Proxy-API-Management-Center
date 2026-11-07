import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { SPONSORS } from '@/features/config/sponsors';
import { APIKEY_FUN_AFFILIATE_URL, APIKEY_FUN_DISPLAY_NAME } from '@/features/providers/sponsor';
import { OptionalResources } from '@/pages/SystemPage';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n('en');
const markup = renderToStaticMarkup(
  createElement(I18nextProvider, { i18n }, createElement(OptionalResources))
);
const escape = (url: string) => url.replaceAll('&', '&amp;');
const anchors = [...markup.matchAll(/<a [^>]*>/g)].map((match) => match[0]);

describe('System optional resources', () => {
  test('renders a headed section labeled Sponsored', () => {
    expect(markup).toMatch(/<section[^>]*aria-labelledby="system-optional-resources"/);
    expect(markup).toMatch(/<h2 id="system-optional-resources"[^>]*>Optional resources<\/h2>/);
    expect(markup).toContain('>Sponsored</span>');
  });

  test('links exactly the existing sponsors, no new promotions', () => {
    const expected = [...SPONSORS.map((sponsor) => sponsor.url), APIKEY_FUN_AFFILIATE_URL];
    expect(anchors).toHaveLength(expected.length);
    for (const url of expected) expect(markup).toContain(`href="${escape(url)}"`);
    for (const sponsor of SPONSORS) expect(markup).toContain(sponsor.name);
    expect(markup).toContain(APIKEY_FUN_DISPLAY_NAME);
  });

  test('every link opens a new tab, says so, and is marked sponsored', () => {
    for (const anchor of anchors) {
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain('rel="noopener noreferrer sponsored"');
    }
    expect(markup.split('(opens in a new tab)')).toHaveLength(anchors.length + 1);
  });
});
