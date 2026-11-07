import { describe, expect, test } from 'bun:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { HealthStatusRow } from '@/features/dashboard/components/HealthStatusRow';
import type { VerdictKind } from '@/features/dashboard/logic/attention';
import {
  deriveHealthStatus,
  verdictInTitle,
  type HealthStatusInput,
} from '@/features/dashboard/logic/healthStatus';
import { createTestI18n, type TestLanguage } from './helpers/locales';

const NOW = new Date(2026, 10, 6, 22, 33).getTime();
const LOCALES: TestLanguage[] = ['en', 'zh-CN', 'zh-TW', 'ru'];

const input = (overrides: Partial<HealthStatusInput> = {}): HealthStatusInput => ({
  attentionCount: 0,
  verdict: 'good',
  primaryFreshness: 'live',
  primaryReceivedAt: NOW,
  checkedCredentials: 6,
  checkedProviders: 3,
  ...overrides,
});

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

describe('dashboard health status is stated once, from what was checked', () => {
  test('attention items make the attention panel the status', () => {
    for (const verdict of ['down', 'attention', 'unknown', 'checking'] as VerdictKind[]) {
      expect(deriveHealthStatus(input({ attentionCount: 2, verdict })).kind).toBe('attention');
    }
  });

  test('no claim is made while credentials or traffic are still loading', () => {
    expect(deriveHealthStatus(input({ primaryFreshness: 'pending' })).kind).toBe('checking');
    expect(deriveHealthStatus(input({ primaryReceivedAt: null })).kind).toBe('checking');
    // A primary source still settling without an item never reads as healthy.
    expect(deriveHealthStatus(input({ verdict: 'unknown' })).kind).toBe('checking');
    expect(deriveHealthStatus(input({ verdict: 'checking' })).kind).toBe('checking');
    // Nothing configured is only "set up" once both sources answered.
    expect(
      deriveHealthStatus(
        input({ primaryFreshness: 'pending', checkedCredentials: 0, checkedProviders: 0 })
      ).kind
    ).toBe('checking');
  });

  test('a fresh install asks for setup instead of claiming health', () => {
    expect(
      deriveHealthStatus(input({ verdict: 'idle', checkedCredentials: 0, checkedProviders: 0 }))
        .kind
    ).toBe('setup');
  });

  test('quiet verdicts carry what was checked and when', () => {
    expect(deriveHealthStatus(input())).toEqual({
      kind: 'clear',
      checkedAt: NOW,
      credentials: 6,
      providers: 3,
    });
    expect(deriveHealthStatus(input({ verdict: 'idle' })).kind).toBe('idle');
    expect(deriveHealthStatus(input({ verdict: 'idle_other_scope' })).kind).toBe(
      'idle_other_scope'
    );
  });

  test('the row names its scope and never says healthy for an idle window', async () => {
    const i18n = await createTestI18n('en');
    const render = (element: ReactElement) =>
      text(renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element)));
    const row = (verdict: VerdictKind) => {
      const status = deriveHealthStatus(input({ verdict }));
      if (status.kind === 'attention' || status.kind === 'setup') throw new Error(status.kind);
      return render(createElement(HealthStatusRow, { status, windowLabel: '3h 20m', now: NOW }));
    };

    expect(row('good')).toMatch(
      /^No credential or provider problems found Checked 6 credential files and 3 providers at 10:33 PM \S+$/
    );
    expect(row('idle_other_scope')).toMatch(
      /^No requests through current credentials in the last 3h 20m No credential problems found · Checked 6 credential files and 3 providers at 10:33 PM \S+$/
    );
    expect(row('idle')).toMatch(/^No requests in the last 3h 20m No credential problems found/);
    expect(row('checking')).toBe('Checking credentials and traffic…');
    for (const verdict of ['good', 'idle', 'idle_other_scope', 'checking'] as VerdictKind[]) {
      expect(row(verdict)).not.toMatch(/steady|healthy|all systems|connected/i);
    }
  });

  test('every locale renders the row without raw keys', async () => {
    for (const language of LOCALES) {
      const i18n = await createTestI18n(language);
      for (const verdict of ['good', 'idle', 'idle_other_scope', 'checking'] as VerdictKind[]) {
        const status = deriveHealthStatus(input({ verdict, checkedCredentials: 1 }));
        if (status.kind === 'attention' || status.kind === 'setup') throw new Error(status.kind);
        const markup = renderToStaticMarkup(
          createElement(
            I18nextProvider,
            { i18n },
            createElement(HealthStatusRow, { status, windowLabel: '3h 20m', now: NOW })
          )
        );
        expect(markup).not.toMatch(/dashboard\.|\{\{/);
        expect(markup).toContain('id="dashboard-status-title"');
      }
    }
  });

  test('the verdict sentence is stated once on the page', () => {
    const attention = deriveHealthStatus(input({ attentionCount: 2, verdict: 'attention' }));
    // "N issues need attention" is the panel's own title: the page title stays "Dashboard".
    expect(verdictInTitle(true, attention, 'attention')).toBe(false);
    // An outage or unknown health adds what the panel lacks.
    expect(verdictInTitle(true, attention, 'down')).toBe(true);
    expect(verdictInTitle(true, attention, 'unknown')).toBe(true);
    // With the row (or the setup prompt), the title stays "Dashboard".
    for (const verdict of ['good', 'idle', 'idle_other_scope', 'checking'] as VerdictKind[]) {
      expect(verdictInTitle(true, deriveHealthStatus(input({ verdict })), verdict)).toBe(false);
    }
    expect(verdictInTitle(true, { kind: 'setup' }, 'idle')).toBe(false);
    // Disconnected, the headline ("Connecting", "Waiting to connect") is the only status.
    expect(verdictInTitle(false, deriveHealthStatus(input()), 'connecting')).toBe(true);
  });
});
