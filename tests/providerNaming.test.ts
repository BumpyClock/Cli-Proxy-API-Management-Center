import { describe, expect, test } from 'bun:test';
import { productionLocales } from './helpers/locales';

// Naming rule: the product is "Claude" wherever a provider or credential is named (backend key
// `claude`, OAuth id `anthropic`). "Anthropic" stays only where it names the company account
// or the Anthropic-compatible API protocol and its config.
describe('Claude provider naming', () => {
  test('OAuth Login names the Claude row and mentions the Anthropic account', () => {
    const login = productionLocales.en.auth_login;
    expect(login.anthropic_oauth_title).toBe('Claude OAuth');
    expect(login.anthropic_oauth_button).toBe('Log in with Claude');
    expect(login.anthropic_oauth_hint).toContain('Anthropic account');
    for (const [locale, messages] of Object.entries(productionLocales)) {
      const row = messages.auth_login;
      expect(row.anthropic_oauth_title, locale).toBe('Claude OAuth');
      expect(row.anthropic_oauth_button, locale).toContain('Claude');
      expect(row.anthropic_oauth_button, locale).not.toContain('Anthropic');
      expect(row.anthropic_oauth_start_error, locale).toContain('Claude OAuth');
      expect(row.anthropic_oauth_hint, locale).toContain('Anthropic');
    }
  });

  test('provider and credential labels say Claude', () => {
    for (const [locale, messages] of Object.entries(productionLocales)) {
      expect(messages.providersPage.providerNames.claude, locale).toBe('Claude');
      expect(messages.auth_files.filter_claude, locale).toBe('Claude');
    }
  });

  test('Anthropic remains the protocol name for Anthropic-compatible routes', () => {
    const sponsor = productionLocales.en.providersPage.sponsor;
    expect(sponsor.protocols.anthropic).toBe('Anthropic');
    expect(sponsor.protocolModels.anthropic).toBe('Anthropic models');
    expect(sponsor.protocolSummary).toContain('Anthropic / OpenAI');
  });
});
