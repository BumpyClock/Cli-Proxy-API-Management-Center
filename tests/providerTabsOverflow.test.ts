import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import i18n from '@/i18n';
import { ProviderTabs } from '@/features/authFiles/components/ProviderTabs';

const quotaStyles = readFileSync('src/features/quota/QuotaPage.module.scss', 'utf8');

const render = (types: string[], counts: Record<string, number>, active: string) =>
  renderToStaticMarkup(
    createElement(ProviderTabs, {
      types,
      counts,
      active,
      resolvedTheme: 'light',
      onChange: () => {},
    })
  );

describe('provider filter overflow', () => {
  test('desktop strip is one labelled single-select group that reports its overflow edge', () => {
    const markup = render(
      ['all', 'claude', 'codex', 'gemini'],
      { all: 6, claude: 2, codex: 2, gemini: 2 },
      'codex'
    );
    const group = markup.match(/<div[^>]*role="group"[^>]*>/)![0];
    expect(group).toContain(`aria-label="${i18n.t('auth_files.provider_filter_label')}"`);
    expect(group).toContain('data-overflow="none"');
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup.match(/aria-pressed="(true|false)"/g)).toHaveLength(4);
  });

  test('phones get a labelled select listing every provider with its count, so none wraps', () => {
    const markup = render(['all', 'claude', 'gemini'], { all: 3, claude: 2, gemini: 1 }, 'gemini');
    const selectId = markup.match(/<select id="([^"]+)"/)![1];
    expect(markup).toContain(
      `<label for="${selectId}">${i18n.t('auth_files.provider_select_label')}</label>`
    );
    const options = [...markup.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)];
    expect(options.map((m) => m[1])).toEqual(['all', 'claude', 'gemini']);
    expect(options[0][2]).toBe(`${i18n.t('auth_files.filter_all')} (3)`);
    expect(options[2][2]).toMatch(/\(1\)$/);
    expect(markup).toMatch(/<option value="gemini" selected="">/);
  });

  test('wheel scrolling uses a cancellable local listener that is removed on unmount', () => {
    const source = readFileSync('src/features/authFiles/components/ProviderTabs.tsx', 'utf8');
    expect(source).toContain("strip.addEventListener('wheel', onWheel, { passive: false })");
    expect(source).toContain("strip.removeEventListener('wheel', onWheel)");
  });

  test('allocates remaining quota toolbar width without shrinking the sort control', () => {
    expect(quotaStyles).toMatch(/> :first-child\s*\{\s*flex: 1 1 auto;\s*min-width: 0;/);
    expect(quotaStyles).toMatch(/\.sort\s*\{\s*flex: 0 0 auto;/);
  });
});
