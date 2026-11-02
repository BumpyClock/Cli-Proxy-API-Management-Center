import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import i18n from '@/i18n';
import type { AuthFileItem, CopilotQuotaState } from '@/types';
import { normalizeCopilotQuota } from '@/services/api/copilot';
import { COPILOT_CONFIG } from '@/features/quota/providers/copilot/data';
import { CopilotQuotaBody } from '@/features/quota/providers/copilot/CopilotQuotaBody';
import { QUOTA_ADAPTERS, getQuotaMap, getQuotaSetter } from '@/features/quota/providers';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import { QUOTA_TAB_ORDER } from '@/features/quota/constants';
import {
  buildTabCounts,
  classifyQuotaFiles,
  filterEntriesByTab,
  sortQuotaEntries,
} from '@/features/quota/logic';
import { isQuotaTabId } from '@/features/quota/uiState';
import { collectQuotaRowInstants, nextRecoveryMs } from '@/features/quota/resetSchedule';
import { buildTimelineLane, laneHasWindow } from '@/features/quota/quotaTimelineModel';
import {
  getAuthFileIcon,
  getTypeLabel,
  QUOTA_PROVIDER_TYPES,
} from '@/features/authFiles/constants';
import { resolveAuthFileQuotaType } from '@/features/authFiles/logic';
import { resolveAuthProvider, formatInstantShort } from '@/utils/quota';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useQuotaStore,
} from '@/stores/useQuotaStore';
import { copilotQuotaResponse } from './fixtures/copilotQuota';

const file: AuthFileItem = {
  name: 'copilot-fixture.json',
  provider: 'github-copilot',
  authIndex: 'selected-index',
};
const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'copilot-test-host'
);
const snapshot = (): CopilotQuotaState =>
  COPILOT_CONFIG.buildSuccessState(normalizeCopilotQuota(copilotQuotaResponse));
const render = (quota: CopilotQuotaState) =>
  renderToStaticMarkup(createElement(CopilotQuotaBody, { quota, classes }));

afterEach(() => useQuotaStore.getState().clearQuotaCache());

describe('Copilot quota registration and lifecycle', () => {
  test.each(['github-copilot', 'copilot', 'github', ' GitHub_Copilot '])(
    'classifies %s consistently across quota and auth-file surfaces',
    (provider) => {
      const credential = { ...file, provider };
      expect(resolveAuthProvider(credential)).toBe('github-copilot');
      expect(COPILOT_CONFIG.filterFn(credential)).toBe(true);
      expect(resolveAuthFileQuotaType(credential, 'all')).toBe('github-copilot');
      expect(resolveAuthFileQuotaType(credential, 'github-copilot')).toBe('github-copilot');
      expect(resolveAuthFileQuotaType(credential, 'codex')).toBeNull();
      expect(getAuthFileIcon(provider, 'light')).toBeTruthy();
      expect(getAuthFileIcon(provider, 'dark')).toBeTruthy();
      expect(getTypeLabel(i18n.t.bind(i18n), provider)).toBe('GitHub Copilot');
    }
  );

  test('registers tab, persisted tab, filter counts and adapter using canonical provider key', () => {
    expect(QUOTA_PROVIDER_TYPES.has('github-copilot')).toBe(true);
    expect(QUOTA_TAB_ORDER).toContain('github-copilot');
    expect(isQuotaTabId('github-copilot')).toBe(true);
    const entries = classifyQuotaFiles([file, { name: 'other.json', provider: 'codex' }]);
    expect(buildTabCounts(entries)['github-copilot']).toBe(1);
    expect(filterEntriesByTab(entries, 'github-copilot')).toEqual([
      { file, type: 'github-copilot' },
    ]);
    const adapter = QUOTA_ADAPTERS['github-copilot'];
    expect(adapter.i18nPrefix).toBe('copilot_quota');
    expect(adapter.Body).toBe(CopilotQuotaBody);
    expect(adapter.resetQuota).toBeUndefined();
  });

  test('excludes disabled and runtime-only credentials without changing other providers', () => {
    const entries = classifyQuotaFiles([
      file,
      { ...file, name: 'disabled.json', disabled: true },
      { ...file, name: 'runtime.json', runtimeOnly: true },
      { ...file, name: 'legacy-runtime.json', runtime_only: 'true' },
      { ...file, name: 'unsupported.json', provider: 'gemini' },
    ]);
    expect(entries).toEqual([{ file, type: 'github-copilot' }]);
    expect(COPILOT_CONFIG.filterFn({ name: 'type-only.json', type: 'copilot' })).toBe(true);
  });

  test('uses registered setter/selector and clears only requested files', () => {
    const adapter = QUOTA_ADAPTERS['github-copilot'];
    const quota = snapshot();
    getQuotaSetter(adapter)(() => ({ [file.name]: quota, 'other.json': quota }));
    expect(getQuotaMap(adapter)[file.name]).toBe(quota);
    const pending = captureQuotaCacheGeneration(file.name);
    const otherPending = captureQuotaCacheGeneration('other.json');
    useQuotaStore.getState().clearQuotaCache([file.name]);
    expect(getQuotaMap(adapter)[file.name]).toBeUndefined();
    expect(getQuotaMap(adapter)['other.json']).toBe(quota);
    expect(
      commitIfQuotaCacheCurrent(pending, () => {
        throw new Error('stale commit');
      })
    ).toBe(false);
    expect(commitIfQuotaCacheCurrent(otherPending, () => {})).toBe(true);
    useQuotaStore.getState().clearQuotaCache();
    expect(getQuotaMap(adapter)).toEqual({});
    expect(
      commitIfQuotaCacheCurrent(otherPending, () => {
        throw new Error('old session');
      })
    ).toBe(false);
  });

  test('adapter states do not retain stale successful quota while loading or on error', () => {
    expect(COPILOT_CONFIG.buildLoadingState()).toEqual({ status: 'loading' });
    expect(COPILOT_CONFIG.buildErrorState('unsupported', 404)).toEqual({
      status: 'error',
      error: 'unsupported',
      errorStatus: 404,
    });
  });
});

describe('Copilot quota rendering', () => {
  test('renders premium interactions, unlimited chat, completions, plan, counts and reset', () => {
    const quota = snapshot();
    const markup = render(quota);
    expect(markup).toContain('individual');
    for (const id of ['premium_interactions', 'chat', 'completions']) {
      expect(markup).toContain(i18n.t(`copilot_quota.${id}`));
    }
    expect(markup).toContain(i18n.t('copilot_quota.unlimited'));
    expect(markup).toContain(
      i18n.t('copilot_quota.remaining_count', {
        remaining: '225',
        entitlement: '300',
      })
    );
    expect(markup.match(/role="meter"/g)).toHaveLength(2);
    expect(markup).toContain('aria-valuenow="75"');
    expect(markup).toContain('aria-valuenow="80"');
    expect(markup).toContain('width:75%');
    expect(markup).not.toContain('width:100%');
    expect(markup).not.toContain('0 / 0');
    expect(markup).toContain(i18n.t('copilot_quota.reset'));
    expect(markup).toContain(formatInstantShort(quota.data!.resetAtMs!, i18n.resolvedLanguage));
    expect(markup).toContain('quotaResetRelative');
    expect(markup).not.toContain('not-for-display');
  });

  test('unknown quotas show neither exhausted meters nor fabricated counts/reset', () => {
    const markup = render(COPILOT_CONFIG.buildSuccessState(normalizeCopilotQuota({})));
    expect(markup.split(i18n.t('copilot_quota.unknown')).length - 1).toBe(3);
    expect(markup).not.toContain('role="meter"');
    expect(markup).not.toContain('width:');
    expect(markup).not.toContain('quotaAmount');
    expect(markup).not.toContain('quotaResetRelative');
    expect(markup).not.toContain(i18n.t('copilot_quota.unlimited'));
  });

  test('explicit exhaustion renders zero remaining while partial counts keep missing entitlement unknown', () => {
    const quota = COPILOT_CONFIG.buildSuccessState(
      normalizeCopilotQuota({
        quota_snapshots: {
          premium_interactions: { entitlement: 300, remaining: 0, percent_remaining: 0 },
          chat: { remaining: 7 },
        },
      })
    );
    const markup = render(quota);
    expect(markup).toContain('aria-valuenow="0"');
    expect(markup).toContain(
      i18n.t('copilot_quota.remaining_count', {
        remaining: '0',
        entitlement: '300',
      })
    );
    expect(markup).toContain(
      i18n.t('copilot_quota.remaining_count', {
        remaining: '7',
        entitlement: i18n.t('copilot_quota.unknown'),
      })
    );
    expect(markup.match(/role="meter"/g)).toHaveLength(1);
  });

  test('unlimited quota never renders percentage, counts or reset recovery as a finite allowance', () => {
    const quota = COPILOT_CONFIG.buildSuccessState(
      normalizeCopilotQuota({
        quota_reset_date: '2099-12-01',
        quota_snapshots: {
          premium_interactions: {
            unlimited: true,
            entitlement: 0,
            remaining: 0,
            percent_remaining: 0,
          },
        },
      })
    );
    const markup = render(quota);
    expect(markup).toContain(i18n.t('copilot_quota.unlimited'));
    expect(markup).not.toContain('role="meter"');
    expect(markup).not.toContain('quotaAmount');
    expect(collectQuotaRowInstants('github-copilot', quota)).toEqual([]);
  });

  test('uses caller-provided compact class contract rather than importing a stylesheet', () => {
    const compact = bindQuotaClasses(
      Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, `compact-${key}`])),
      'compact-test-host'
    );
    const adapter = QUOTA_ADAPTERS['github-copilot'];
    const markup = renderToStaticMarkup(
      createElement(adapter.Body, { quota: snapshot(), classes: compact })
    );
    expect(markup).toContain('class="compact-quotaRow"');
    expect(markup).toContain('class="compact-quotaBar"');
    expect(markup).toContain('aria-valuenow="75"');
  });

  test('provides complete localized quota and provider labels in all four locales', () => {
    const english = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru']) {
      const messages = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
      expect(messages.auth_files['filter_github-copilot']).toBe('GitHub Copilot');
      expect(Object.keys(messages.copilot_quota).sort()).toEqual(
        Object.keys(english.copilot_quota).sort()
      );
      for (const message of Object.values(messages.copilot_quota)) {
        expect(typeof message).toBe('string');
        expect(message).toBeTruthy();
      }
    }
  });
});

describe('Copilot quota reset scheduling', () => {
  test('sorts consumed finite capacity by reset without projecting an invented monthly period', () => {
    const quota = snapshot();
    const atMs = Date.UTC(2099, 11, 1);
    expect(collectQuotaRowInstants('github-copilot', quota)).toEqual([
      { rowId: 'premium_interactions', atMs, kind: 'window' },
      { rowId: 'completions', atMs, kind: 'window' },
    ]);
    expect(nextRecoveryMs('github-copilot', quota, atMs - 1)).toBe(atMs);
    expect(nextRecoveryMs('github-copilot', quota, atMs)).toBeNull();
    const entries = classifyQuotaFiles([{ ...file, name: 'unknown.json' }, file]);
    expect(
      sortQuotaEntries(entries, 'soonest', (entry) =>
        nextRecoveryMs(entry.type, entry.file.name === file.name ? quota : undefined, atMs - 1)
      )[0].file.name
    ).toBe(file.name);
    expect(
      laneHasWindow(
        buildTimelineLane({
          name: file.name,
          displayName: file.name,
          provider: 'github-copilot',
          quota,
        })
      )
    ).toBe(false);
  });

  test('unknown, full, unlimited, failed or missing reset data is not a recovery event', () => {
    for (const quota of [
      { status: 'error' as const },
      COPILOT_CONFIG.buildLoadingState(),
      COPILOT_CONFIG.buildSuccessState(normalizeCopilotQuota({ quota_reset_date: '2099-12-01' })),
      COPILOT_CONFIG.buildSuccessState(
        normalizeCopilotQuota({ quota_snapshots: { chat: { remaining: 0, entitlement: 10 } } })
      ),
      COPILOT_CONFIG.buildSuccessState(
        normalizeCopilotQuota({
          quota_reset_date: '2099-12-01',
          quota_snapshots: { chat: { percent_remaining: 100 } },
        })
      ),
    ]) {
      expect(collectQuotaRowInstants('github-copilot', quota)).toEqual([]);
    }
  });
});
