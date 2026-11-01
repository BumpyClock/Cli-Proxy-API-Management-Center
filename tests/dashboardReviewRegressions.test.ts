import { describe, expect, test } from 'bun:test';
import i18n from '../src/i18n/index';
import { authFileProviderId } from '../src/features/authFiles/constants';
import { buildFleetModel } from '../src/features/dashboard/logic/fleet';
import { credentialRecovery } from '../src/features/dashboard/components/formatters';
import { providerHref } from '../src/features/dashboard/logic/links';
import { parseAuthFilesDeepLink } from '../src/features/authFiles/deepLink';
import {
  applyProviderBrandDeepLink,
  type ProvidersWorkbenchUiState,
} from '../src/features/providers/uiState';
import type { AuthFileItem } from '../src/types/authFile';
import type { CredentialRow } from '../src/features/dashboard/types';

const NOW = Date.parse('2026-10-30T06:00:00Z');

const credential = (): CredentialRow => {
  const fleet = buildFleetModel({
    authFiles: [{ name: 'test.json', type: 'codex', status: 'active' }],
    observedAtMs: NOW,
    authFilesReceivedAt: NOW,
    keyUsage: {},
    keyUsageReceivedAt: NOW,
  });
  return fleet.credentials!.rows[0];
};

describe('dashboard review regressions', () => {
  test('unknown-provider links match missing, blank, and empty auth-file types', () => {
    const files: AuthFileItem[] = [
      { name: 'missing.json' },
      { name: 'blank.json', type: '' },
      { name: 'empty.json', type: 'empty' },
      { name: 'known.json', type: 'codex' },
    ];
    const fleet = buildFleetModel({
      authFiles: files,
      observedAtMs: NOW,
      authFilesReceivedAt: NOW,
      keyUsage: {},
      keyUsageReceivedAt: NOW,
    });
    const provider = fleet.providers.find((item) => item.id === 'unknown')!;
    const href = providerHref(provider);
    const link = parseAuthFilesDeepLink(new URLSearchParams(href.split('?')[1]));
    expect(link?.provider).toBe('unknown');
    expect(
      files.filter((file) => authFileProviderId(file) === link?.provider).map((f) => f.name)
    ).toEqual(['missing.json', 'blank.json', 'empty.json']);
    expect(provider.credentials.total).toBe(3);
    expect(authFileProviderId({ name: 'alias.json', provider: 'Grok' })).toBe('xai');
  });

  test('provider links remove conflicting filters only for their destination brand', () => {
    const state: ProvidersWorkbenchUiState = {
      activeBrand: 'codex',
      filtersByBrand: {
        claude: { filter: 'hidden', selectedModels: ['absent'], sortBy: 'name', sortDir: 'desc' },
        codex: { filter: 'keep', selectedModels: ['keep'], sortBy: 'name', sortDir: 'asc' },
      },
    };
    const next = applyProviderBrandDeepLink(state, 'claude');
    expect(next.activeBrand).toBe('claude');
    expect(next.filtersByBrand.claude).toEqual({
      filter: '',
      selectedModels: [],
      sortBy: 'name',
      sortDir: 'desc',
    });
    expect(next.filtersByBrand.codex).toBe(state.filtersByBrand.codex);
    expect(state.filtersByBrand.claude?.filter).toBe('hidden');
    expect(applyProviderBrandDeepLink(next, 'claude')).toEqual(next);
  });

  test('a past credential retry does not hide a future model cooldown', async () => {
    await i18n.changeLanguage('en');
    const row = credential();
    row.nextRetryAtMs = NOW - 60_000;
    row.cooldown = {
      modelCount: 1,
      models: ['gpt-test'],
      credentialWide: false,
      reason: 'quota_exceeded',
      httpStatus: 429,
      earliestSeconds: 120,
      receivedAtMs: NOW,
    };
    const info = credentialRecovery(i18n.t.bind(i18n), row, NOW);
    expect(info.deadline).toContain('2m');
    expect(info.deadline?.toLowerCase()).toContain('cooldown');
    expect(credentialRecovery(i18n.t.bind(i18n), row, NOW + 120_000).deadline).toBeNull();
  });

  test('future credential eligibility still takes precedence over model cooldowns', async () => {
    await i18n.changeLanguage('en');
    const row = credential();
    row.nextRetryAtMs = NOW + 300_000;
    row.cooldown = {
      modelCount: 1,
      models: ['gpt-test'],
      credentialWide: false,
      reason: 'quota_exceeded',
      httpStatus: 429,
      earliestSeconds: 120,
      receivedAtMs: NOW,
    };
    expect(credentialRecovery(i18n.t.bind(i18n), row, NOW).deadline).toContain('5m');
    row.state = 'disabled';
    expect(credentialRecovery(i18n.t.bind(i18n), row, NOW).deadline).toBeNull();
  });
});
