import { expect, spyOn, test } from 'bun:test';
import i18next from 'i18next';
import { getErrorMessage } from '@/utils/helpers';
import { createTestI18n } from './helpers/locales';

for (const language of ['en', 'zh-CN', 'zh-TW', 'ru'] as const) {
  for (const [apiCode, key] of [
    ['precondition_failed', 'common.config_changed'],
    ['config_etag_unavailable', 'common.config_version_unavailable'],
  ] as const) {
    test(`${language} explains ${apiCode} without exposing the transport code`, async () => {
      const localized = await createTestI18n(language);
      const message = localized.t(key);
      const translate = spyOn(i18next, 't').mockReturnValue(message);
      try {
        const error = Object.assign(new Error(apiCode), { apiCode });
        expect(getErrorMessage(error)).toBe(message);
        expect(translate).toHaveBeenCalledWith(key);
        expect(message).not.toBe(key);
        expect(message).not.toContain(apiCode);
      } finally {
        translate.mockRestore();
      }
    });
  }
}

test('ordinary errors retain their original message', () => {
  expect(getErrorMessage(new Error('ordinary failure'), 'fallback')).toBe('ordinary failure');
});
