import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { compileString } from 'sass';
import { OAuthEditorProviderCard } from '@/features/authFiles/components/OAuthEditorProviderCard';
import { createTestI18n, productionLocales } from './helpers/locales';

const i18n = await createTestI18n();
const render = (provider: string) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(OAuthEditorProviderCard, {
        provider,
        options: ['codex', 'claude', 'gemini'],
        onChange: () => {},
        disabled: false,
        translationPrefix: 'oauth_excluded',
      })
    )
  );
const css = compileString(
  `@use 'src/styles/variables' as *;\n${readFileSync(
    'src/features/authFiles/components/OAuthEditor.module.scss',
    'utf8'
  )}`,
  {
    url: new URL('../src/features/authFiles/components/OAuthEditor.module.scss', import.meta.url),
    loadPaths: [process.cwd()],
  }
).css.replace(/\s+/g, ' ');
const pages = [
  ['src/pages/AuthFilesOAuthExcludedEditPage.tsx', 'oauth_excluded'],
  ['src/pages/AuthFilesOAuthModelAliasEditPage.tsx', 'oauth_model_alias'],
] as const;

describe('provider chooser', () => {
  test('the combobox comes first; shortcuts sit in a labelled disclosure', () => {
    const markup = render('');
    expect(markup.indexOf('<input')).toBeLessThan(markup.indexOf('<details'));
    expect(markup).toMatch(
      new RegExp(`<summary>.*${i18n.t('redesign.authFiles.providerShortcuts')}</summary>`)
    );
    expect(markup.match(/aria-pressed="false"/g)).toHaveLength(3);
  });

  test('the shortcut disclosure starts collapsed when the viewport is unknown or a phone', () => {
    expect(render('')).not.toMatch(/<details[^>]*open/);
    const source = readFileSync(
      'src/features/authFiles/components/OAuthEditorProviderCard.tsx',
      'utf8'
    );
    expect(source).toContain("const SHORTCUTS_OPEN_QUERY = '(min-width: 769px)';");
  });

  test('a selected provider stays visible in the step heading with an accessible prefix', () => {
    expect(render('')).not.toContain(i18n.t('redesign.authFiles.selectedProvider'));
    const markup = render('claude');
    const heading = markup.slice(markup.indexOf('<label'), markup.indexOf('<input'));
    expect(heading).toContain(`${i18n.t('redesign.authFiles.selectedProvider')}: </span>`);
    expect(heading).toContain('<span>Claude</span>');
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  test('the shortcut disclosure uses the shared summary; shortcuts are 44px on phones', () => {
    const source = readFileSync(
      'src/features/authFiles/components/OAuthEditor.module.scss',
      'utf8'
    );
    expect(source).toMatch(/\.shortcuts \{\s*> summary \{\s*@include disclosure-summary;/);
    // The mixin draws its own chevron and 44px touch target; no second icon in the summary.
    expect(render('')).toMatch(/<summary>[^<]+<\/summary>/);
    expect(css).toMatch(/\.shortcuts > summary \{[^}]*min-height: 32px;/);
    expect(css).toMatch(
      /@media \(max-width: 768px\), \(pointer: coarse\) \{ \.shortcuts > summary \{ min-height: 44px; \} \}/
    );
    expect(css).toMatch(
      /@media \(max-width: 768px\) \{ \.providerOption \{ min-height: 44px; \} \}/
    );
  });
});

describe('editor headers', () => {
  for (const [path, prefix] of pages) {
    test(`${prefix}: h1 names the destination; the provider goes in meta`, () => {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain(`title={t('${prefix}.title')}`);
      expect(source).toContain(`'${prefix}.meta_editing' : '${prefix}.meta_new'`);
      expect(source).not.toContain(`${prefix}.add_title`);
      expect(source).not.toContain(`${prefix}.edit_title`);
    });

    test(`${prefix}: Back and Save share the floating editor bar, not the page header`, () => {
      const source = readFileSync(path, 'utf8');
      const header = source.slice(
        source.indexOf('<PageHeader'),
        source.indexOf('/>', source.indexOf('<PageHeader'))
      );
      expect(header).not.toContain('actions=');
      expect(header).not.toContain('handleSave');
      const bar = source.slice(
        source.indexOf('<OAuthEditorActions'),
        source.indexOf('</OAuthEditorActions>')
      );
      expect(bar).toMatch(
        /<Button variant="secondary" className=\{styles\.pageBack\} onClick=\{handleBack\}>/
      );
      expect(bar).toMatch(/<Button\s+variant="primary"\s+onClick=\{handleSave\}/);
      expect(bar).not.toContain('size="sm"');
      expect(bar.indexOf('handleBack')).toBeLessThan(bar.indexOf('handleSave'));
    });
  }

  test('h1 copy matches the breadcrumb and section tab labels in every locale', () => {
    for (const [locale, messages] of Object.entries(productionLocales)) {
      expect(messages.oauth_excluded.title, locale).toBe(messages.redesign.authFiles.disablement);
      expect(messages.oauth_model_alias.title, locale).toBe(messages.redesign.authFiles.aliases);
      for (const section of [messages.oauth_excluded, messages.oauth_model_alias]) {
        expect(section.meta_editing, locale).toContain('{{provider}}');
        expect(section.meta_new, locale).toContain('{{provider}}');
        expect('add_title' in section, locale).toBe(false);
      }
    }
  });
});
