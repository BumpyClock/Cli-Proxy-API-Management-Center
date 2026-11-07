import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createTestI18n, productionLocales } from './helpers/locales';

const systemPage = readFileSync('src/pages/SystemPage.tsx', 'utf8');

describe('round 1 system info copy', () => {
  test('model counts pluralize in English and Russian', async () => {
    const en = await createTestI18n('en');
    expect(en.t('system_info.models_count', { count: 1 })).toBe('1 available model');
    expect(en.t('system_info.models_count', { count: 3 })).toBe('3 available models');

    const ru = await createTestI18n('ru');
    expect(ru.t('system_info.models_count', { count: 1 })).toBe('1 доступная модель');
    expect(ru.t('system_info.models_count', { count: 3 })).toBe('3 доступные модели');
    expect(ru.t('system_info.models_count', { count: 5 })).toBe('5 доступных моделей');

    const zh = await createTestI18n('zh-CN');
    expect(zh.t('system_info.models_count', { count: 1 })).toBe('可用模型 1 个');
  });

  test('fact labels share one convention: no trailing colons', () => {
    for (const [locale, messages] of Object.entries(productionLocales)) {
      for (const label of [
        messages.connection.status,
        messages.footer.version,
        messages.footer.api_version,
        messages.footer.build_date,
      ]) {
        expect(label, locale).not.toMatch(/[:：]\s*$/);
      }
    }
  });

  test('the success count renders once, not as both text and a pill', () => {
    expect(systemPage).toMatch(
      /modelStatus\.type === 'warning' \|\| modelStatus\.type === 'error'/
    );
    expect(systemPage).not.toMatch(/\{modelStatus && \(/);
  });

  test('copy names what it copies and refresh names its scope', () => {
    expect(systemPage).toContain("{t('system_info.copy_details')}");
    expect(systemPage).not.toContain("{t('common.copy')}");
    expect(systemPage).toContain('<RefreshButton');
    expect(systemPage).toContain("label={t('system_info.models_refresh')}");
    // Copied text uses the translated connection status, not the raw store enum.
    expect(systemPage).toContain("`${t('connection.status')}: ${connectionLabel}`");
  });
});
