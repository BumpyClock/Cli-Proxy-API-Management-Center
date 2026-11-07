import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import i18n from '@/i18n';
import type { AuthFileItem } from '@/types';
import { getModifiedTimeParts } from '@/features/authFiles/constants';
import { describeRecentRequests } from '@/features/authFiles/logic';
import { AuthFilesToolbar } from '@/features/authFiles/components/AuthFilesToolbar';
import { VaultHeader } from '@/features/authFiles/components/VaultHeader';
import { statusBarDataFromRecentRequests } from '@/utils/recentRequests';
import { formatDateTimeValue } from '@/utils/format';
import { productionLocales } from './helpers/locales';

const noop = () => {};

describe('modification time parts', () => {
  test('accepts seconds or milliseconds and uses the shared one-line metadata format', () => {
    const ms = 1_700_000_000_000;
    for (const modified of [ms / 1000, ms]) {
      const parts = getModifiedTimeParts({ name: 'a.json', modified } as AuthFileItem, 'en');
      expect(parts).toEqual({
        iso: '2023-11-14T22:13:20.000Z',
        label: formatDateTimeValue(ms, 'en'),
      });
    }
  });

  test('returns null instead of a dash for missing or unparseable values', () => {
    expect(getModifiedTimeParts({ name: 'a.json' } as AuthFileItem)).toBeNull();
    expect(getModifiedTimeParts({ name: 'a.json', modtime: 'soon' } as AuthFileItem)).toBeNull();
  });
});

describe('recent request window', () => {
  test('derives the window from the bar buckets and separates idle from active', () => {
    expect(describeRecentRequests(statusBarDataFromRecentRequests([]))).toEqual({
      windowMinutes: 200,
      hasRequests: false,
    });
    expect(
      describeRecentRequests(statusBarDataFromRecentRequests([{ success: 0, failed: 2 }]))
    ).toEqual({ windowMinutes: 200, hasRequests: true });
    expect(describeRecentRequests({ blockDetails: [], totalSuccess: 0, totalFailure: 0 })).toEqual({
      windowMinutes: 0,
      hasRequests: false,
    });
  });
});

describe('credential filter search', () => {
  test('uses a short placeholder and moves wildcard help into an accessible description', () => {
    for (const [locale, { auth_files: messages }] of Object.entries(productionLocales)) {
      expect(messages.search_placeholder.length, locale).toBeLessThanOrEqual(24);
      expect(messages.search_placeholder, locale).not.toContain('*');
      expect(messages.search_hint, locale).toContain('*');
      expect(messages.search_label, locale).toBeTruthy();
    }

    const markup = renderToStaticMarkup(
      createElement(AuthFilesToolbar, {
        search: '',
        onSearchChange: noop,
        statusFilterMode: 'all',
        statusFilterOptions: [{ value: 'all', label: 'All' }],
        onStatusFilterChange: noop,
        sortMode: 'default',
        sortOptions: [{ value: 'default', label: 'Default' }],
        onSortModeChange: noop,
        pageSizeInput: '9',
        onPageSizeInputChange: noop,
        onPageSizeCommit: noop,
        compactMode: false,
        onCompactModeChange: noop,
        viewOptions: { sortChanged: false, pageSizeChanged: false, changedCount: 0 },
      })
    );
    const describedBy = markup.match(/<input[^>]*aria-describedby="([^"]+)"/)![1];
    expect(markup).toContain(`<p id="${describedBy}"`);
    expect(markup).toContain(i18n.t('auth_files.search_hint'));
    expect(markup).toContain(`placeholder="${i18n.t('auth_files.search_placeholder')}"`);
  });

  test('reserves input space for the search icon', () => {
    const css = readFileSync(
      'src/features/authFiles/components/AuthFilesToolbar.module.scss',
      'utf8'
    );
    expect(css).toMatch(/:global\(\.input\) \{[^}]*padding-right: 34px;/);
    expect(css).toMatch(/\.searchField:focus-within \.searchHint \{/);
  });
});

describe('page header actions', () => {
  const render = (refreshing: boolean) =>
    renderToStaticMarkup(
      createElement(VaultHeader, {
        totalCount: 6,
        activeCount: 6,
        problemCount: 0,
        loading: false,
        refreshing,
        uploading: false,
        disableControls: false,
        onUpload: noop,
        onRefresh: noop,
      })
    );

  test('uses the shared RefreshButton and a matching-size upload button', () => {
    const idle = render(false);
    expect(idle).toContain(i18n.t('auth_files.refresh_credentials'));
    expect(idle).not.toContain('btn-sm');
    expect(idle).toContain(i18n.t('auth_files.upload_button'));
    const busy = render(true);
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain(i18n.t('common.refreshing'));
  });
});

describe('quota cell states', () => {
  const source = readFileSync('src/features/authFiles/components/AuthFileQuotaSection.tsx', 'utf8');

  test('names why no value is shown and only emphasises reported values', () => {
    for (const key of ['quotaNotChecked', 'quotaCheckFailed', 'notReported']) {
      expect(source).toContain(`t('redesign.authFiles.${key}')`);
    }
    expect(source).toContain("t('redesign.quota.checking')");
    expect(source).toContain('reported ? styles.summaryValue : styles.summaryMuted');
    const css = readFileSync('src/features/authFiles/components/AuthFileQuota.module.scss', 'utf8');
    expect(css).toMatch(/> summary::-webkit-details-marker \{\s*display: none;/);
    expect(css).toMatch(/\.summaryMuted \{\s*color: var\(--text-secondary\);/);
  });
});
