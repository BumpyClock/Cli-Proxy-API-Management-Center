import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import en from '../src/i18n/locales/en.json';
import zhCN from '../src/i18n/locales/zh-CN.json';
import zhTW from '../src/i18n/locales/zh-TW.json';
import ru from '../src/i18n/locales/ru.json';
import { TimeSeriesChart, type TimeSeriesChartProps } from '../src/components/ui/TimeSeriesChart';
import { TimeSeriesChartTable } from '../src/components/ui/TimeSeriesChartTable';

const props: TimeSeriesChartProps = {
  id: 'test-allowance',
  data: [
    { timestamp: 1000, values: { alpha: 0, beta: null } },
    { timestamp: 2000, values: { alpha: 100, beta: 25 } },
  ],
  series: [
    { id: 'alpha', label: 'Account Alpha', number: 1, color: 'var(--chart-1)', marker: 'first' },
    { id: 'beta', label: 'Account Beta', number: 2, color: 'var(--chart-2)' },
  ],
  xDomain: [1000, 2000],
  yDomain: [0, 100],
  formatX: (value) => `time-${value}`,
  formatY: (value) => `${value}%`,
  ariaLabel: 'Independent account allowances',
  emptyText: 'No reported allowances',
};

const i18n = createInstance();
await i18n.init({
  lng: 'en',
  fallbackLng: false,
  interpolation: { escapeValue: false },
  resources: {
    en: { translation: en },
    'zh-CN': { translation: zhCN },
    'zh-TW': { translation: zhTW },
    ru: { translation: ru },
  },
});
const render = (overrides: Partial<TimeSeriesChartProps> = {}) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(TimeSeriesChart, { ...props, ...overrides })
    )
  );
const expandedEvidence = (overrides: Partial<TimeSeriesChartProps> = {}) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(TimeSeriesChartTable, { ...props, ...overrides })
    )
  );

describe('shared time-series chart', () => {
  test('preserves unknown observations instead of changing them into zero', async () => {
    await i18n.changeLanguage('en');
    const markup = expandedEvidence();
    expect(markup).toContain('<td>0%</td>');
    expect(markup).toContain('<td>Not reported</td>');
    expect(markup).toContain('<td>100%</td>');
    expect(markup).toContain('<td>25%</td>');
    expect(markup.match(/<tr>/g)?.length).toBe(3);
    expect(render()).toContain('<strong>0%</strong>');
    expect(render()).toContain('<strong>25%</strong>');
  });

  test('exposes one keyboard stop and separate switches, without mounting collapsed evidence', async () => {
    await i18n.changeLanguage('en');
    const markup = render();
    expect(markup.match(/tabindex="0"/g)?.length).toBe(1);
    expect(markup.match(/aria-pressed="true"/g)?.length).toBe(2);
    expect(markup).toContain('Account Alpha');
    expect(markup).toContain('Account Beta');
    expect(markup).toContain('aria-describedby="test-allowance-readout"');
    expect(markup).toContain('Home and End');
    expect(markup).toContain('<details');
    expect(markup).not.toContain('<table');
    expect(expandedEvidence()).toContain('<th scope="col">Time</th>');
  });

  test('an explicit legend summary does not replace the actual evidence values', async () => {
    await i18n.changeLanguage('en');
    const series = [{ ...props.series[0], legendValue: '156 total' }];
    expect(render({ series })).toContain('<strong>156 total</strong>');
    const markup = expandedEvidence({ series });
    expect(markup).toContain('<td>0%</td>');
    expect(markup).toContain('<td>100%</td>');
    expect(markup).not.toContain('<td>156');
  });

  test('caller-supplied components and factories do no evidence work while collapsed', () => {
    let mounts = 0;
    const Evidence = () => {
      mounts++;
      return createElement('table', null, createElement('caption', null, 'Exact bucket windows'));
    };
    for (const dataTable of [createElement(Evidence), () => createElement(Evidence)]) {
      const markup = render({ dataTable });
      expect(markup).toContain('<details');
      expect(markup).not.toContain('Exact bucket windows');
      expect(markup).not.toContain('<table');
    }
    let factories = 0;
    render({
      dataTable: () => {
        factories++;
        return createElement(Evidence);
      },
    });
    expect(mounts).toBe(0);
    expect(factories).toBe(0);
  });

  test('existing evidence can replace the entire disclosure, with an accessible association', () => {
    const markup = render({ dataTable: false, evidenceId: 'existing-breakdown' });
    expect(markup).toContain('aria-details="existing-breakdown"');
    expect(markup).not.toContain('<details');
    expect(markup).not.toContain('<table');
  });

  test('unmeasured accounts expose an empty state, not a blank or invented plot', () => {
    for (const overrides of [{ data: [] }, { series: [] }]) {
      const markup = render(overrides);
      expect(markup).toContain('No reported allowances');
      expect(markup).not.toContain('tabindex="0"');
      expect(markup).not.toContain('<table');
    }
  });

  for (const language of ['en', 'zh-CN', 'zh-TW', 'ru']) {
    test(`chart controls and missing values use production ${language} translations`, async () => {
      await i18n.changeLanguage(language);
      const markup = render();
      expect(markup).not.toContain('redesign.chart.');
      expect(markup).not.toContain('{{');
      expect(markup).toContain(i18n.t('redesign.chart.table'));
      expect(expandedEvidence()).toContain(i18n.t('redesign.chart.unreported'));
    });
  }
});
