import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { compileString } from 'sass';
import { claudeToResource, geminiToResource } from '@/features/providers/adapters';
import { ProviderCategoryList } from '@/features/providers/components/ProviderCategoryList';
import { ProviderHeaderCard } from '@/features/providers/components/ProviderHeaderCard';
import { ProviderResourceTable } from '@/features/providers/components/ProviderResourceTable';
import { ProviderResourceToolbar } from '@/features/providers/components/ProviderResourceToolbar';
import { getProviderHealth } from '@/features/providers/workbenchLayout';
import type { ProviderGroup, ProviderSortBy, SortDir } from '@/features/providers/types';
import type { ProviderRecentUsageMap } from '@/components/providers/utils';
import { buildRecentRequestCompositeKey } from '@/utils/recentRequests';
import { isoTitle } from '@/utils/format';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));

const compile = (path: string) =>
  compileString(`@use 'src/styles/variables.scss' as *;\n${readFileSync(path, 'utf8')}`, {
    url: new URL(`../${path}`, import.meta.url),
    loadPaths: [process.cwd()],
  }).css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Body of the first rule whose selector list includes `selector` inside the given block. */
const ruleBody = (css: string, selector: string) => {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((item) => item.trim());
    if (selectors.includes(selector)) return match[2];
  }
  return '';
};
/** Everything after the first `@media query`, so every block for that query is searched. */
const mediaBlock = (css: string, query: string) => css.split(`@media ${query}`).slice(1).join('\n');

describe('sort direction control', () => {
  const toolbar = (sortBy: ProviderSortBy, sortDir: SortDir) =>
    render(
      createElement(ProviderResourceToolbar, {
        sortBy,
        sortDir,
        onSortBy: () => {},
        onSortDir: () => {},
        availableModels: [],
        selectedModels: new Set<string>(),
        onSelectedModelsChange: () => {},
      })
    );

  test('shows a visible direction word and names the field it sorts', () => {
    const asc = toolbar('name', 'asc');
    expect(asc).toContain('aria-label="Sort direction for Name: Ascending"');
    expect(asc).toContain('data-sort-dir="asc"');
    expect(asc).toMatch(/<span>A–Z<\/span><\/button>/);
    const desc = toolbar('priority', 'desc');
    expect(desc).toContain('aria-label="Sort direction for Priority: Descending"');
    expect(desc).toMatch(/<span>High–low<\/span><\/button>/);
  });

  test('the sort select is named by the visible "Sort by" label', () => {
    const markup = toolbar('name', 'asc');
    const id = markup.match(/<span[^>]*id="([^"]+)"[^>]*>Sort by<\/span>/)?.[1];
    expect(id).toBeDefined();
    expect(markup).toContain(`aria-labelledby="${id}"`);
  });

  test('never squeezes, is 32px on desktop and 44px on phones and touch', () => {
    const css = compile('src/features/providers/components/ProviderResourceToolbar.module.scss');
    const dir = ruleBody(css, '.dirBtn');
    expect(dir).toContain('flex: none');
    expect(dir).toContain('height: 32px');
    const touch = mediaBlock(css, '(max-width: 768px), (pointer: coarse)');
    expect(ruleBody(touch, '.dirBtn')).toContain('height: 44px');
    expect(ruleBody(touch, '.dirBtn')).toContain('min-width: 44px');
  });
});

describe('provider status cell', () => {
  test('health has three states and failing follows the status bar low band', () => {
    expect(getProviderHealth(true, { success: 0, failure: 9 })).toBe('disabled');
    expect(getProviderHealth(false, null)).toBe('active');
    expect(getProviderHealth(false, { success: 0, failure: 0 })).toBe('active');
    expect(getProviderHealth(false, { success: 1, failure: 3 })).toBe('failing');
    expect(getProviderHealth(false, { success: 9, failure: 1 })).toBe('active');
  });

  const claude = claudeToResource({ apiKey: 'fixture-private-key' }, 0);
  const gemini = geminiToResource({ apiKey: 'fixture-gemini-secret', excludedModels: ['*'] }, 1);
  const table = (usageByProvider: ProviderRecentUsageMap) =>
    render(
      createElement(ProviderResourceTable, {
        resources: [claude, gemini],
        usageByProvider,
        onView: () => {},
        onEdit: () => {},
        onDelete: () => {},
        onToggleDisabled: () => {},
      })
    );

  test('no requests: one health word and "No recent requests", no pills or empty bar', () => {
    const markup = table(new Map());
    expect(markup).toContain('data-health="active"');
    expect(markup).toContain('data-health="disabled"');
    expect(markup.match(/No recent requests/g)).toHaveLength(2);
    expect(markup).not.toMatch(/Success:|Failure:/);
    expect(markup).not.toContain('statusBlock');
  });

  test('failing requests show the failing word, a compact figure and the bar', () => {
    const usage: ProviderRecentUsageMap = new Map([
      [
        'claude',
        new Map([
          [
            buildRecentRequestCompositeKey(claude.baseUrl, claude.apiKey),
            {
              success: 1,
              failed: 3,
              recentRequests: [{ success: 1, failed: 3 }],
            },
          ],
        ]),
      ],
    ]);
    const markup = table(usage);
    expect(markup).toContain('data-health="failing"');
    expect(markup).toContain('>Failing<');
    expect(markup).toContain('1 ok · 3 failed');
  });

  test('backend totals without bucket history still show the figure, without a bar', () => {
    const usage: ProviderRecentUsageMap = new Map([
      [
        'claude',
        new Map([
          [
            buildRecentRequestCompositeKey(claude.baseUrl, claude.apiKey),
            { success: 1000, failed: 2, recentRequests: [] },
          ],
        ]),
      ],
    ]);
    const markup = table(usage);
    expect(markup).toContain('1000 ok · 2 failed');
    expect(markup.match(/No recent requests/g)).toHaveLength(1);
    expect(markup).not.toContain('statusBlock');
  });

  test('the row Actions trigger is 32px on desktop and 44px on phones and touch', () => {
    // The leading @charset would otherwise read as part of the first selector.
    const css = compile('src/features/providers/components/ProviderRowActions.module.scss').replace(
      /@charset [^;]+;/,
      ''
    );
    expect(ruleBody(css, '.trigger')).toContain('min-height: 32px');
    const touch = mediaBlock(css, '(max-width: 768px), (pointer: coarse)');
    expect(ruleBody(touch, '.trigger')).toContain('min-height: 44px');
  });
});

describe('provider catalog phone picker', () => {
  const groups: ProviderGroup[] = [
    { id: 'claude', resources: [claudeToResource({ apiKey: 'fixture-private-key' }, 0)] },
    { id: 'gemini', resources: [] },
  ];
  const markup = render(
    createElement(ProviderCategoryList, {
      groups,
      activeBrand: 'claude',
      onSelect: () => {},
      detail: createElement('section', { 'data-detail': 'selected' }),
    })
  );

  test('a labeled native select lists configured and not-configured providers before detail', () => {
    const select = markup.match(/<select[\s\S]*?<\/select>/)?.[0] ?? '';
    const id = select.match(/id="([^"]+)"/)?.[1];
    expect(markup).toContain(`for="${id}"`);
    expect(markup).toMatch(new RegExp(`<label[^>]*for="${id}"[^>]*>Provider</label>`));
    expect(select).toContain('<optgroup label="Configured">');
    expect(select).toContain('<optgroup label="Not configured">');
    expect(select).toMatch(/<option value="claude" selected="">Claude · 1\/1 active<\/option>/);
    expect(markup.indexOf('<select')).toBeLessThan(markup.indexOf('data-detail="selected"'));
  });

  test('phones hide the configured list and show the picker; desktop is the reverse', () => {
    const css = compile('src/features/providers/components/ProviderCategoryList.module.scss');
    expect(ruleBody(css, '.pickerArea')).toContain('display: none');
    const phone = mediaBlock(css, '(max-width: 640px)');
    expect(ruleBody(phone, '.configuredArea')).toContain('display: none');
    expect(ruleBody(phone, '.pickerArea')).toContain('display: flex');
    expect(ruleBody(css, '.picker')).toContain('min-height: 44px');
  });
});

describe('provider page metadata', () => {
  const fetchedAt = '2026-11-06T20:32:00Z';
  const header = (updatedAt: string | null) =>
    render(
      createElement(ProviderHeaderCard, {
        totalActive: 3,
        totalResources: 3,
        providerFamilies: 3,
        updatedAt,
        onRefresh: () => {},
        onNew: () => {},
      })
    );

  test('one summary line, then the update time as a <time> carrying the exact instant', () => {
    const markup = header(fetchedAt);
    expect(markup.match(/aria-hidden="true">·<\/span>/g)).toHaveLength(1);
    expect(markup).toContain('3/3 active across 3 providers');
    expect(markup).toContain(
      `<time dateTime="${isoTitle(fetchedAt)}" title="${isoTitle(fetchedAt)}">`
    );
    expect(markup).toMatch(/Updated Nov 6, 2026/);
    expect(markup.indexOf('3/3 active')).toBeLessThan(markup.indexOf('<time'));
  });

  test('the summary pluralizes a single provider', () => {
    const markup = render(
      createElement(ProviderHeaderCard, {
        totalActive: 1,
        totalResources: 2,
        providerFamilies: 1,
        updatedAt: fetchedAt,
        onRefresh: () => {},
        onNew: () => {},
      })
    );
    expect(markup).toContain('1/2 active across 1 provider<');
  });

  test('before the first load it says so without a fake timestamp', () => {
    const markup = header(null);
    expect(markup).toContain('Not loaded');
    expect(markup).not.toContain('<time');
  });
});
