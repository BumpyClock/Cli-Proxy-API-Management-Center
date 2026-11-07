import { describe, expect, test } from 'bun:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import {
  QuickStartAccountLink,
  QuickStartOptionalKey,
} from '@/features/providers/components/SponsorQuickStartPanel';
import { APIKEY_FUN_AFFILIATE_URL, APIKEY_FUN_DASHBOARD_URL } from '@/features/providers/sponsor';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
const escaped = (url: string) => url.replaceAll('&', '&amp;');

describe('Quick Start APIKEY.FUN entry', () => {
  test('when not configured it is a plain optional step: no promotion, logo or sign-up link', () => {
    const markup = render(
      createElement(QuickStartOptionalKey, { titleId: 'k', disabled: false, onAdd: () => {} })
    );
    expect(markup).toContain('APIKEY.FUN key (optional)');
    expect(markup).toContain('Add APIKEY.FUN key');
    expect(markup).toContain('btn-secondary');
    expect(markup).not.toContain(escaped(APIKEY_FUN_AFFILIATE_URL));
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('Sponsored');
    expect(markup).not.toContain('Register');
  });

  test('during key entry the affiliate "Get a key" link is quiet and labelled sponsored', () => {
    const markup = render(createElement(QuickStartAccountLink, { configured: false }));
    expect(markup).toContain(`href="${escaped(APIKEY_FUN_AFFILIATE_URL)}"`);
    expect(markup).toContain('rel="noopener noreferrer sponsored"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('<span>Get a key</span>');
    expect(markup).toContain('>Sponsored</span>');
    expect(markup).toContain('(opens in a new tab)');
    expect(markup).not.toContain('btn');
  });

  test('once configured it links only to the account dashboard', () => {
    const markup = render(createElement(QuickStartAccountLink, { configured: true }));
    expect(markup).toContain(`href="${APIKEY_FUN_DASHBOARD_URL}"`);
    expect(markup).not.toContain(escaped(APIKEY_FUN_AFFILIATE_URL));
    expect(markup).not.toContain('sponsored');
    expect(markup).toContain('<span>Dashboard</span>');
  });
});
