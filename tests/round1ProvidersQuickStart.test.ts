import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { findConfigFieldById } from '@/features/config/searchIndex';
import { ProviderHeaderCard } from '@/features/providers/components/ProviderHeaderCard';
import { QuickStartSteps } from '@/features/providers/components/QuickStartSteps';
import { getProviderCreateLabel } from '@/features/providers/createLabel';
import { QUICK_START_STEPS } from '@/features/providers/workbenchLayout';
import { createTestI18n, localeParityIssues, productionLocales } from './helpers/locales';
import type { TestLanguage } from './helpers/locales';

const i18n = await createTestI18n();
const withProviders = (child: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(MemoryRouter, null, child))
  );

describe('quick start setup steps', () => {
  const markup = withProviders(createElement(QuickStartSteps));

  test('each step is a router link to an existing route, in setup order', () => {
    const hrefs = [...markup.matchAll(/<a[^>]*href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual(['/ai-providers', '/oauth', '/config?field=apiKeys', '/usage']);
    const routes = readFileSync('src/router/MainRoutes.tsx', 'utf8');
    for (const step of QUICK_START_STEPS) {
      expect(routes).toContain(`path: '${step.to.split('?')[0]}'`);
    }
    // The config link opens the existing client API key field, not just the page.
    expect(findConfigFieldById('apiKeys')?.yamlKeys).toEqual(['access', 'api-keys']);
  });

  test('steps show their destination and stay in an ordered list without completion claims', () => {
    expect(markup).toContain('<ol');
    for (const destination of ['AI Providers', 'OAuth Login', 'Config Panel', 'Usage Statistics']) {
      expect(markup).toContain(destination);
    }
    expect(markup).not.toMatch(/complete|done|aria-checked/i);
    expect(markup).not.toContain('redesign.providers.');
    expect(markup).not.toContain('nav.');
  });

  test('the general setup sequence renders before the sponsor panel', () => {
    const page = readFileSync('src/features/providers/ProvidersWorkbenchPage.tsx', 'utf8');
    const body = page.slice(page.lastIndexOf('  return (\n    <div className={styles.page}>'));
    expect(body.indexOf('<QuickStartSteps />')).toBeGreaterThan(-1);
    expect(body.indexOf('<QuickStartSteps />')).toBeLessThan(
      body.indexOf('<SponsorQuickStartPanel')
    );
  });
});

describe('create actions name what they add', () => {
  test('API-key brands, OpenAI-compatible providers and the sponsor get specific labels', async () => {
    expect(getProviderCreateLabel(i18n.t, 'gemini')).toBe('Add Gemini key');
    expect(getProviderCreateLabel(i18n.t, 'apikeyFun')).toBe('Add APIKEY.FUN key');
    expect(getProviderCreateLabel(i18n.t, 'openaiCompatibility')).toBe(
      'Add OpenAI-compatible provider'
    );
    for (const language of Object.keys(productionLocales) as TestLanguage[]) {
      const localized = await createTestI18n(language);
      for (const brand of ['claude', 'openaiCompatibility', 'apikeyFun'] as const) {
        const label = getProviderCreateLabel(localized.t, brand);
        expect(label).not.toContain('redesign.providers.');
        expect(label).not.toContain('{{');
      }
    }
    expect(localeParityIssues(productionLocales, ['redesign.providers'])).toEqual([]);
  });

  test('the header pairs the shared refresh action with the specific create label', () => {
    const header = (isFetching: boolean) =>
      withProviders(
        createElement(ProviderHeaderCard, {
          totalActive: 1,
          totalResources: 1,
          providerFamilies: 1,
          updatedAt: '2026-11-06T20:32:00Z',
          isFetching,
          newLabel: 'Add Claude key',
          onRefresh: () => {},
          onNew: () => {},
        })
      );
    const idle = header(false);
    expect(idle.match(/<h1\b/g)).toHaveLength(1);
    expect(idle).toContain('>Refresh providers</span>');
    expect(idle).toContain('Add Claude key');
    expect(idle).not.toContain('>New<');
    const busy = header(true);
    expect(busy).toContain('aria-busy="true"');
    // Stays focusable while refreshing so keyboard focus is not dropped.
    expect(busy).not.toMatch(/<button[^>]*aria-busy="true"[^>]*\sdisabled=""/);
  });
});
