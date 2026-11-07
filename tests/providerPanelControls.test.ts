import { describe, expect, test } from 'bun:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { claudeToResource } from '@/features/providers/adapters';
import { ProviderResourcePanel } from '@/features/providers/components/ProviderResourcePanel';
import type { ProviderGroup } from '@/features/providers/types';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));

const resource = claudeToResource({ apiKey: 'fixture-private-key' }, 0);
const group: ProviderGroup = { id: 'claude', resources: [resource] };
const panel = (filter: string, selectedModels: string[] = []) =>
  render(
    createElement(ProviderResourcePanel, {
      group,
      filter,
      onFilterChange: () => {},
      filteredResources: [resource],
      selectedId: null,
      toolbarControls: {
        sortBy: 'name',
        sortDir: 'asc',
        onSortBy: () => {},
        onSortDir: () => {},
        availableModels: ['claude-sonnet-4-5'],
        selectedModels: new Set(selectedModels),
        onSelectedModelsChange: () => {},
      },
      onView: () => {},
      onEdit: () => {},
      onDelete: () => {},
      onCreate: () => {},
    })
  );

describe('provider panel search, sort and filter on phones', () => {
  test('one labelled disclosure controls the search and sort group, closed by default', () => {
    const markup = panel('');
    const controls = markup.match(
      /aria-controls="([^"]+)"[^>]*><svg[\s\S]*?<span>Search &amp; sort<\/span>/
    );
    expect(controls).not.toBeNull();
    const id = controls?.[1] ?? '';
    expect(markup).toContain(`id="${id}"`);
    expect(markup).toMatch(new RegExp(`aria-expanded="false" aria-controls="${id}"`));
    expect(markup).toMatch(new RegExp(`id="${id}"[^>]*data-open="false"`));
  });

  test('the search field has an accessible name and sort stays in the group', () => {
    const markup = panel('');
    expect(markup).toContain('aria-label="Search keys, URLs, prefixes…"');
    expect(markup).toContain('Sort by');
  });

  test('a search term or model filter is announced on the collapsed control', () => {
    expect(panel('gemini')).toContain('<span>Search &amp; sort (filtered)</span>');
    expect(panel('', ['claude-sonnet-4-5'])).toContain('<span>Search &amp; sort (filtered)</span>');
    expect(panel('   ')).toContain('<span>Search &amp; sort</span>');
  });
});
