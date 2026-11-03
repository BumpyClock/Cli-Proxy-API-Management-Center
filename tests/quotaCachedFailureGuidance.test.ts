import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolveQuotaErrorMessage } from '../src/utils/quota/errors';
import { createTestI18n } from './helpers/locales';

describe('cached quota failure guidance', () => {
  for (const language of ['en', 'zh-CN', 'zh-TW', 'ru'] as const) {
    for (const [status, key] of [
      [403, 'common.quota_check_credential'],
      [404, 'common.quota_update_required'],
    ] as const) {
      test(`${language} resolves actionable guidance for ${status}`, async () => {
        const i18n = await createTestI18n(language);
        const message = resolveQuotaErrorMessage(i18n.t, status, 'Raw upstream error');
        expect(message).toBe(i18n.t(key));
        expect(message).not.toBe(key);
        expect(message).not.toBe('Raw upstream error');
      });
    }
  }

  test('cached warning wiring uses the same resolved message as the ordinary failure', () => {
    // Source contract only; this does not exercise browser rendering.
    const source = readFileSync(
      new URL('../src/features/quota/components/QuotaCard.tsx', import.meta.url),
      'utf8'
    );
    expect(source).toContain("{t('redesign.quota.stale')} · {errorMessage}");
    expect(source).not.toContain('· {quota.error}');
  });
});
