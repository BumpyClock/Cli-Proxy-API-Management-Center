import { describe, expect, test } from 'bun:test';
import { createElement, type ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfigHeader } from '@/features/config/components/ConfigHeader';
import { SectionCommon } from '@/features/config/components/sections/SectionCommon';
import { SectionNetwork } from '@/features/config/components/sections/SectionNetwork';
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
    // RefreshButton keeps focus while busy: aria-disabled instead of native disabled.
    expect(markup).toMatch(/<button[^>]*aria-disabled="true"/);
    expect(markup).toMatch(/<button[^>]*aria-busy="true"/);
    expect(markup).toContain(i18n.t('config_management.reloading_config'));
  });

  test('idle header reload names its scope', () => {
    const markup = render(
      createElement(ConfigHeader, {
        meta: [],
        reloadDisabled: false,
        reloading: false,
        onReload: () => {},
      })
    );
    expect(markup).toContain(i18n.t('config_management.reload_config'));
    expect(markup).not.toContain('aria-disabled');
  });

  test('config sections that hold proxy settings render no sponsored links', () => {
    for (const Section of [SectionCommon, SectionNetwork]) {
      const markup = render(
        createElement(Section, {
          values: DEFAULT_VISUAL_VALUES,
          disabled: false,
          onChange: () => {},
        })
      );
      expect(markup).toContain(i18n.t('config_management.visual.sections.network.proxy_url'));
      expect(markup).not.toContain('sponsored');
      for (const sponsor of SPONSORS) {
        expect(markup).not.toContain(sponsor.name);
        expect(markup).not.toContain(sponsor.url.replaceAll('&', '&amp;'));
      }
    }
  });

  test('shipped settings translations expose matching nonempty leaves and interpolation', () => {
    expect(localeParityIssues(productionLocales, ['redesign.settings'])).toEqual([]);
  });
});
