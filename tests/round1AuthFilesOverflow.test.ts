import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { compileString } from 'sass';
import i18n from '@/i18n';
import { overflowEdges, scrollLeftToReveal } from '@/features/authFiles/overflowEdges';
import { AuthFilesSectionNav } from '@/features/authFiles/components/AuthFilesSectionNav';
import { ProviderTabs } from '@/features/authFiles/components/ProviderTabs';

const compiled = (path: string) =>
  compileString(`@use 'src/styles/variables.scss' as *;\n${readFileSync(path, 'utf8')}`, {
    url: new URL(`../${path}`, import.meta.url),
    loadPaths: [process.cwd()],
  }).css.replace(/\s+/g, ' ');

describe('overflow edge geometry', () => {
  test('reports which side hides items, tolerating sub-pixel overflow', () => {
    expect(overflowEdges({ scrollLeft: 0, scrollWidth: 401, clientWidth: 400 })).toBe('none');
    expect(overflowEdges({ scrollLeft: 0, scrollWidth: 600, clientWidth: 400 })).toBe('end');
    expect(overflowEdges({ scrollLeft: 100, scrollWidth: 600, clientWidth: 400 })).toBe('both');
    expect(overflowEdges({ scrollLeft: 199, scrollWidth: 600, clientWidth: 400 })).toBe('start');
  });

  test('scrolls a hidden item clear of the fade and leaves visible items alone', () => {
    const strip = { scrollLeft: 0, scrollWidth: 800, clientWidth: 300 };
    expect(scrollLeftToReveal({ offsetLeft: 40, offsetWidth: 80 }, strip, 28)).toBeNull();
    expect(scrollLeftToReveal({ offsetLeft: 500, offsetWidth: 100 }, strip, 28)).toBe(328);
    expect(
      scrollLeftToReveal({ offsetLeft: 10, offsetWidth: 80 }, { ...strip, scrollLeft: 400 }, 28)
    ).toBe(0);
    expect(scrollLeftToReveal({ offsetLeft: 760, offsetWidth: 40 }, strip, 28)).toBe(500);
  });
});

describe('discoverable section and provider strips', () => {
  test('section nav keeps three links and a labelled select naming the same routes', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/auth-files'] },
        createElement(AuthFilesSectionNav)
      )
    );
    expect(markup).toContain(`aria-label="${i18n.t('redesign.authFiles.sections')}"`);
    expect(markup.match(/<a /g)).toHaveLength(3);
    expect(markup).toMatch(/<a aria-current="page"[^>]*href="\/auth-files"/);
    for (const key of ['credentials', 'disablement', 'aliases']) {
      expect(markup).toContain(i18n.t(`redesign.authFiles.${key}`));
    }
    const selectId = markup.match(/<select id="([^"]+)"/)![1];
    expect(markup).toContain(`<label for="${selectId}">${i18n.t('redesign.authFiles.section')}`);
    expect(markup.match(/<option /g)).toHaveLength(3);
  });

  test('provider filter: one pressed segment, a fade hook, and a labelled select per provider', () => {
    const markup = renderToStaticMarkup(
      createElement(ProviderTabs, {
        types: ['all', 'claude', 'codex'],
        counts: { all: 2, claude: 1, codex: 1 },
        active: 'all',
        resolvedTheme: 'light',
        onChange: () => {},
      })
    );
    expect(markup).toContain(`aria-label="${i18n.t('auth_files.provider_filter_label')}"`);
    expect(markup).toContain('data-overflow="none"');
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    const selectId = markup.match(/<select id="([^"]+)"/)![1];
    expect(markup).toContain(
      `<label for="${selectId}">${i18n.t('auth_files.provider_select_label')}`
    );
    expect(markup.match(/<option /g)).toHaveLength(3);
    expect(markup).toContain(`${i18n.t('auth_files.filter_all')} (2)`);
  });

  test('the provider strip fades whichever edge hides providers', () => {
    const css = compiled('src/features/authFiles/components/ProviderTabs.module.scss');
    expect(css).toContain('scroll-padding-inline: 28px');
    for (const edge of ['start', 'end', 'both']) {
      expect(css).toMatch(new RegExp(`\\[data-overflow=${edge}\\] \\{[^}]*mask-image:`));
    }
  });

  test('the credentials page renders the section nav beside the provider filter', () => {
    const page = readFileSync('src/features/authFiles/AuthFilesPage.tsx', 'utf8');
    expect(page).toContain('<AuthFilesSectionNav />');
    expect(page.indexOf('<AuthFilesSectionNav />')).toBeLessThan(page.indexOf('<ProviderTabs'));
  });
});
