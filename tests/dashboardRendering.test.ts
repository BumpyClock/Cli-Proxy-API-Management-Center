import { describe, expect, test } from 'bun:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../src/i18n/index';
import { normalizeAuthFilesResponse } from '../src/services/api/authFiles';
import type { AuthFilesResponse } from '../src/types/authFile';
import { AttentionPanel } from '../src/features/dashboard/components/AttentionPanel';
import { Meter } from '../src/features/dashboard/components/Meter';
import { CredentialList } from '../src/features/dashboard/components/CredentialList';
import { ProviderHealthList } from '../src/features/dashboard/components/ProviderHealthList';
import { UsagePanel } from '../src/features/dashboard/components/UsagePanel';
import { buildAttention } from '../src/features/dashboard/logic/attention';
import { buildFleetModel } from '../src/features/dashboard/logic/fleet';
import { summarizeUsage } from '../src/features/dashboard/logic/usage';
import { providerSettingsHref } from '../src/features/dashboard/logic/links';
import { SourceStamp } from '../src/features/dashboard/components/SourceStamp';

const NOW = Date.parse('2026-10-30T06:00:00.000Z');
const LOCALES = ['en', 'zh-CN', 'zh-TW', 'ru'];

const buckets = (filled: Record<number, [number, number]> = {}) =>
  Array.from({ length: 20 }, (_, index) => {
    const [success, failed] = filled[index] ?? [0, 0];
    return { success, failed };
  });

const model = () => {
  const payload = {
    observed_at: new Date(NOW).toISOString(),
    files: [
      {
        name: 'meta-ops.json',
        type: 'meta',
        email: 'ops@example.com',
        status: 'error',
        status_message: '{"error":{"message":"The requested model was not found."}}',
        unavailable: true,
        auth_index: '2',
        next_retry_after: new Date(NOW + 3_600_000).toISOString(),
        recent_requests: buckets({ 12: [1, 5] }),
        // Five models: more than the inline limit, so the "+N more" disclosure renders.
        cooldowns: ['muse-large', 'muse-small', 'muse-vision', 'muse-audio', 'muse-code'].map(
          (model) => ({
            scope: 'model',
            model_key: model,
            reason: 'model_not_supported',
            retry_at: new Date(NOW + 3_600_000).toISOString(),
            remaining_seconds: 3600,
            http_status: 404,
          })
        ),
      },
      {
        name: 'codex-dev.json',
        type: 'codex',
        email: 'dev@example.com',
        status: 'active',
        auth_index: '1',
        recent_requests: buckets({ 18: [40, 1] }),
        cooldowns: [],
      },
    ],
  } as unknown as AuthFilesResponse;
  const normalized = normalizeAuthFilesResponse(payload, NOW);
  return buildFleetModel({
    authFiles: normalized.files,
    observedAtMs: NOW,
    authFilesReceivedAt: NOW,
    keyUsage: {
      claude: { 'base|key': { success: 0, failed: 4, recent_requests: buckets({ 13: [0, 4] }) } },
    },
    keyUsageReceivedAt: NOW,
  });
};

const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, element));

const expectTranslated = (markup: string) => {
  expect(markup).not.toMatch(/dashboard\.[a-z_]+/);
  expect(markup).not.toContain('{{');
};

const decodeEntities = (text: string) =>
  text
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/**
 * WCAG 2.5.3: a control's accessible name starts with its visible label, so voice
 * control can target the words on screen.
 */
const expectLabelInName = (markup: string) => {
  let checked = 0;
  for (const match of markup.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const ariaLabel = /aria-label="([^"]*)"/.exec(match[2])?.[1];
    const visible = decodeEntities(match[3].replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!ariaLabel || !visible) continue;
    checked += 1;
    expect(decodeEntities(ariaLabel).toLowerCase().startsWith(visible.toLowerCase())).toBe(true);
  }
  expect(checked).toBeGreaterThan(0);
};

describe('dashboard components render translated, actionable markup', () => {
  test('attention panel names the failing credential and links to it', async () => {
    await i18n.changeLanguage('en');
    const fleet = model();
    const items = buildAttention(fleet.providers, [
      { id: 'usage', freshness: 'failed', error: 'Network Error', receivedAt: NOW - 120_000 },
    ]);
    const markup = render(
      createElement(AttentionPanel, {
        items,
        checkedCredentials: 2,
        checkedProviders: 3,
        primaryFreshness: 'live',
        primaryReceivedAt: NOW,
        windowLabel: '3h 20m',
        now: NOW,
        onRetry: async () => undefined,
      })
    );
    expect(markup).toContain('Muse (Meta)');
    expect(markup).toContain('The requested model was not found.');
    expect(markup).toContain(
      '/auth-files?provider=meta&amp;status=problem&amp;search=meta-ops.json'
    );
    expect(markup).toContain('Open Claude settings');
    expect(markup).toContain('/ai-providers?brand=claude');

    // Stale API-key traffic: only the item built on it states that age.
    const staleTraffic = render(
      createElement(AttentionPanel, {
        items,
        evidence: {
          credentials: { receivedAt: NOW - 5_000, live: true },
          traffic: { receivedAt: NOW - 60_000, live: false },
        },
        checkedCredentials: 2,
        checkedProviders: 3,
        primaryFreshness: 'stale',
        primaryReceivedAt: NOW - 60_000,
        windowLabel: '3h 20m',
        now: NOW,
        onRetry: async () => undefined,
      })
    );
    const itemFor = (name: string) =>
      staleTraffic.split('<li').find((chunk) => chunk.includes(`>${name}<`)) ?? '';
    expect(itemFor('Claude')).toContain('as of');
    expect(itemFor('Muse (Meta)')).not.toContain('as of');
    expect(markup).toContain('/logs?search=claude');
    expect(markup).toContain('API keys don&#x27;t report a failure reason');
    expect(markup).toContain('Network Error');
    expectTranslated(markup);
  });

  for (const lng of LOCALES) {
    test(`every section renders without raw keys in ${lng}`, async () => {
      await i18n.changeLanguage(lng);
      const fleet = model();
      const items = buildAttention(fleet.providers, [
        { id: 'credentials', freshness: 'stale', error: null, receivedAt: NOW - 600_000 },
      ]);
      const credentialsByIndex = new Map(
        fleet.credentials!.rows.map((row) => [row.authIndex ?? '', row])
      );
      const usage = {
        enabled: true,
        usage: {
          total_requests: 2,
          apis: {
            client: {
              models: {
                'gpt-5.5': {
                  details: [
                    { timestamp: new Date(NOW - 60_000).toISOString(), latency_ms: 900 },
                    {
                      timestamp: new Date(NOW - 30_000).toISOString(),
                      latency_ms: 2500,
                      failed: true,
                      auth_index: '1',
                    },
                  ],
                },
              },
            },
          },
        },
      };
      const markup = [
        render(
          createElement(AttentionPanel, {
            items,
            checkedCredentials: 2,
            checkedProviders: 3,
            primaryFreshness: 'stale',
            primaryReceivedAt: NOW - 600_000,
            windowLabel: '3h 20m',
            now: NOW,
            onRetry: async () => undefined,
          })
        ),
        render(createElement(ProviderHealthList, { providers: fleet.providers })),
        render(createElement(CredentialList, { credentials: fleet.credentials, now: NOW })),
        render(
          createElement(UsagePanel, {
            usage,
            summary: summarizeUsage(usage.usage, NOW - 200 * 60_000, NOW),
            windowLabel: '3h 20m',
            credentialsByIndex,
          })
        ),
        render(
          createElement(UsagePanel, {
            usage: { enabled: false, usage: null },
            summary: null,
            windowLabel: '3h 20m',
            credentialsByIndex,
          })
        ),
      ].join('\n');
      expectTranslated(markup);
      expectLabelInName(markup);
      expect(markup).toMatch(/aria-expanded="false"/);
      expect(markup).toContain('ops@example.com');
      expect(markup).toContain('gpt-5.5');
    });
  }

  test('a success rate is a meter; no rate is text, not indeterminate progress', () => {
    const measured = renderToStaticMarkup(
      createElement(Meter, { value: 96.2, ariaLabel: 'Codex success rate' })
    );
    expect(measured).toContain('role="meter"');
    expect(measured).toContain('aria-valuenow="96.2"');
    const none = renderToStaticMarkup(
      createElement(Meter, { value: null, ariaLabel: 'Idle success rate' })
    );
    expect(none).not.toContain('role=');
    expect(none).toContain('aria-hidden="true"');
  });

  test('every dashboard key exists in all four locales', () => {
    const reference = i18n.getResource('en', 'translation', 'dashboard') as Record<string, string>;
    const baseKeys = new Set(Object.keys(reference).map((key) => key.replace(/_(one|other)$/, '')));
    for (const lng of LOCALES) {
      const local = i18n.getResource(lng, 'translation', 'dashboard') as Record<string, string>;
      for (const key of baseKeys) {
        const present = [key, `${key}_one`, `${key}_other`, `${key}_few`, `${key}_many`].some(
          (candidate) => typeof local[candidate] === 'string'
        );
        if (!present) throw new Error(`${lng} is missing dashboard.${key}`);
      }
    }
  });

  test('source stamps name what is missing instead of borrowing another age', async () => {
    await i18n.changeLanguage('en');
    const stamp = (entries: Parameters<typeof SourceStamp>[0]['entries'], everyMs?: number) =>
      renderToStaticMarkup(createElement(SourceStamp, { entries, now: NOW, everyMs }));
    const ok = { receivedAt: NOW - 20_000, error: null, loading: false };
    const missing = { receivedAt: null, error: '503', loading: false };
    expect(
      stamp([
        { id: 'credentials', status: missing, freshness: 'failed' },
        { id: 'traffic', status: ok, freshness: 'live' },
      ])
    ).toContain('Couldn&#x27;t load credentials');
    expect(
      stamp([{ id: 'config', status: { ...ok, error: 'timeout' }, freshness: 'failed' }])
    ).toContain('Not updating · data from 20s ago');
    expect(stamp([{ id: 'models', status: ok, freshness: 'live' }], 60_000)).toContain(
      'Updated 20s ago · every 60s'
    );
  });

  test('provider settings links open the provider brand', () => {
    expect(providerSettingsHref('claude')).toBe('/ai-providers?brand=claude');
    expect(providerSettingsHref('openai-compatibility')).toBe(
      '/ai-providers?brand=openaiCompatibility'
    );
    expect(providerSettingsHref('openrouter')).toBe('/ai-providers?brand=openaiCompatibility');
    expect(providerSettingsHref('unknown')).toBe('/ai-providers');
  });
});
