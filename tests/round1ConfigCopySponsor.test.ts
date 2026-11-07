import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createTestI18n, productionLocales } from './helpers/locales';

const i18n = await createTestI18n();
const source = (path: string) => readFileSync(path, 'utf8');

describe('round 1 config copy', () => {
  test('API key helper explains the client task in every locale, not page styling', () => {
    for (const [locale, messages] of Object.entries(productionLocales)) {
      const hint = messages.config_management.visual.api_keys.hint;
      expect(hint, locale).not.toMatch(
        /API Key Management|API 密钥管理|API 金鑰管理|управления API/
      );
      expect(hint.length, locale).toBeGreaterThan(10);
    }
    expect(i18n.t('config_management.visual.api_keys.hint')).toMatch(/client/i);
  });
});

describe('round 1 config layout', () => {
  test('common toggles use the paired grid so four cards never end in a 3+1 orphan', () => {
    const section = source('src/features/config/components/sections/SectionCommon.tsx');
    expect(section).toMatch(/<FieldGrid pairs>\s*<DebugToggle/);
    const scss = source('src/features/config/components/fields/Field.module.scss');
    expect(scss).toMatch(
      /\.fieldGridPairs \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/
    );
  });

  test('header reload uses the shared RefreshButton with a scoped label', () => {
    const header = source('src/features/config/components/ConfigHeader.tsx');
    expect(header).toContain('<RefreshButton');
    expect(header).toContain("t('config_management.reload_config')");
    expect(i18n.t('config_management.reload_config')).toBe('Reload config');
  });
});
