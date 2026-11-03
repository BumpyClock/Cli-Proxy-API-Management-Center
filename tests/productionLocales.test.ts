import { describe, expect, test } from 'bun:test';
import { createTestI18n, localeParityIssues, productionLocales } from './helpers/locales';

const sections = [
  'redesign.quota',
  'redesign.chart',
  'redesign.dashboardQuota',
  'redesign.usage',
  'redesign.providers',
  'redesign.authFiles',
  'redesign.settings',
  'xai_quota.test_health',
  'logs.copy_line_accessible',
  'plugin_resource.open_in_new_tab',
];

describe('production locale regression checks', () => {
  test('all shipped redesign messages have matching keys and interpolation variables', () => {
    expect(localeParityIssues(productionLocales, sections)).toEqual([]);
  });

  test('missing required keys fail parity without source changes or fallback masking', async () => {
    const locales = structuredClone(productionLocales);
    const missing = 'redesign.dashboardQuota.coverage';
    Reflect.deleteProperty(locales.ru.redesign.dashboardQuota, 'coverage');
    expect(localeParityIssues(locales, sections)).toEqual([`ru: missing ${missing}`]);

    const i18n = await createTestI18n('ru');
    Reflect.deleteProperty(
      i18n.getResourceBundle('ru', 'translation').redesign.dashboardQuota,
      'coverage'
    );
    expect(i18n.exists(missing)).toBe(false);
    expect(i18n.t(missing)).toBe(missing);
    expect(productionLocales.ru.redesign.dashboardQuota.coverage).toBeTruthy();
  });

  test('missing interpolation variables fail parity in memory', () => {
    const locales = structuredClone(productionLocales);
    locales.ru.redesign.authFiles.actionsFor = 'Actions';
    expect(localeParityIssues(locales, sections)).toEqual([
      'ru: interpolation mismatch redesign.authFiles.actionsFor',
    ]);
  });

  test('nested missing and blank messages are not hidden by their parent section', () => {
    const locales = structuredClone(productionLocales);
    Reflect.deleteProperty(locales['zh-TW'].redesign.settings.logColumns, 'level');
    locales['zh-TW'].redesign.chart.time = ' ';
    expect(localeParityIssues(locales, sections)).toEqual([
      'zh-TW: empty or non-string redesign.chart.time',
      'zh-TW: missing redesign.settings.logColumns.level',
    ]);
  });

  test('isolated instances do not change another instance or the imported bundles', async () => {
    const first = await createTestI18n();
    const second = await createTestI18n();
    first.addResource('en', 'translation', 'redesign.chart.time', 'Changed only in first test');
    expect(first.t('redesign.chart.time')).toBe('Changed only in first test');
    expect(second.t('redesign.chart.time')).toBe(productionLocales.en.redesign.chart.time);
    expect(productionLocales.en.redesign.chart.time).toBe('Time');
  });
});
