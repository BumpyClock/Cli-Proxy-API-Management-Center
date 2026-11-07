import { describe, expect, test } from 'bun:test';
import { productionLocales } from './helpers/locales';

describe('login field labels', () => {
  test('share one convention with Current URL: no trailing colon in any locale', () => {
    for (const [locale, messages] of Object.entries(productionLocales)) {
      for (const label of [
        messages.login.connection_current,
        messages.login.management_key_label,
        messages.login.custom_connection_label,
        messages.login.remember_password_label,
      ]) {
        expect(label, locale).toBeTruthy();
        expect(label, locale).not.toMatch(/[:：]\s*$/);
      }
    }
  });

  test('the remember checkbox names the management key, not a password', () => {
    expect(productionLocales.en.login.remember_password_label).toBe('Remember management key');
    for (const [locale, messages] of Object.entries(productionLocales)) {
      const key = messages.login.management_key_label.toLocaleLowerCase();
      const remember = messages.login.remember_password_label.toLocaleLowerCase();
      expect(remember, locale).toContain(key);
      // The storage caveat stays beside the checkbox.
      expect(messages.redesign.settings.rememberHint, locale).toBeTruthy();
    }
  });
});
