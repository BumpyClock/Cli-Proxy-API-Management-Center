import { describe, expect, mock, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createTestI18n } from './helpers/locales';
import { useQuotaStore } from '@/stores';

mock.module('../src/features/authFiles/components/AuthFileQuota.module.scss', () => ({
  default: new Proxy({}, { get: (_, key) => String(key) }),
}));

const { AuthFileQuotaSection } =
  await import('@/features/authFiles/components/AuthFileQuotaSection');

describe('compact quota summary', () => {
  test('epoch reset never renders a stray zero', async () => {
    const initial = useQuotaStore.getInitialState();
    const saved = { ...initial };
    Object.assign(initial, {
      claudeQuota: {
        'epoch.json': {
          status: 'success',
          windows: [
            { id: 'weekly', label: 'Weekly', usedPercent: 50, resetAtMs: 0, periodHours: 168 },
          ],
        },
      },
    });
    try {
      const i18n = await createTestI18n();
      const markup = renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(AuthFileQuotaSection, {
            file: { name: 'epoch.json', provider: 'claude' },
            quotaType: 'claude',
            disableControls: false,
            compact: true,
          })
        )
      );
      const summary = markup.split('<summary')[1].split('</summary>')[0];
      expect(summary).not.toMatch(/>0(?:<|$)/);
      expect(summary).not.toContain('<time');
    } finally {
      Object.assign(initial, saved);
    }
  });
});
