import { describe, expect, test } from 'bun:test';
import { createElement, type ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfigHeader } from '@/features/config/components/ConfigHeader';
import { ProxyUrlField } from '@/features/config/components/fields/sharedFields';
import { DEFAULT_VISUAL_VALUES } from '@/types/visualConfig';
import { SPONSORS } from '@/features/config/sponsors';
import { createTestI18n, localeParityIssues, productionLocales } from './helpers/locales';

const i18n = await createTestI18n();
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));

describe('config presentation', () => {
  test('header exposes one heading, real metadata, and reload action', () => {
    const markup = render(
      createElement(ConfigHeader, {
        meta: [
          { key: 'fields', labelKey: 'config_management.meta_fields', count: 61, tone: 'muted' },
        ],
        reloadDisabled: true,
        reloading: true,
        onReload: () => {},
      })
    );
    expect(markup.match(/<h1[ >]/g)).toHaveLength(1);
    expect(markup).toContain(i18n.t('config_management.title'));
    expect(markup).toContain('61');
    expect(markup).toMatch(/<button[^>]*disabled=""/);
    expect(markup).toContain(i18n.t('config_management.reload'));
  });

  test('proxy field keeps sponsor links outside the input label', () => {
    const markup = render(
      createElement(ProxyUrlField, {
        values: DEFAULT_VISUAL_VALUES,
        disabled: false,
        onChange: () => {},
      })
    );
    const label = markup.match(/<label[\s\S]*?<\/label>/)?.[0];
    expect(label).toContain(i18n.t('config_management.visual.sections.network.proxy_url'));
    expect(label).not.toContain('<a');
    for (const sponsor of SPONSORS.slice(0, 1)) {
      expect(markup).toContain(sponsor.url.replaceAll('&', '&amp;'));
      expect(markup).toContain('noopener noreferrer sponsored');
    }
  });

  test('shipped settings translations expose matching nonempty leaves and interpolation', () => {
    expect(localeParityIssues(productionLocales, ['redesign.settings'])).toEqual([]);
  });
});
