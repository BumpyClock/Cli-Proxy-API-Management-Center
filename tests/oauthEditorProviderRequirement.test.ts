import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { compileString } from 'sass';
import { OAuthEditorProviderCard } from '@/features/authFiles/components/OAuthEditorProviderCard';
import { OAUTH_EDITOR_ACTIONS_HEIGHT_VAR } from '@/features/authFiles/components/OAuthEditorActions';
import { createTestI18n, productionLocales } from './helpers/locales';

const i18n = await createTestI18n();
const wrap = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
const renderCard = (provider: string, requirementId?: string) =>
  wrap(
    createElement(OAuthEditorProviderCard, {
      provider,
      options: ['codex', 'claude'],
      onChange: () => {},
      disabled: false,
      translationPrefix: 'oauth_model_alias',
      requirementId,
    })
  );
const editorCss = compileString(
  `@use 'src/styles/variables' as *;\n${readFileSync(
    'src/features/authFiles/components/OAuthEditor.module.scss',
    'utf8'
  )}`,
  {
    url: new URL('../src/features/authFiles/components/OAuthEditor.module.scss', import.meta.url),
    loadPaths: [process.cwd()],
  }
).css.replace(/\s+/g, ' ');

describe('OAuth editor provider requirement', () => {
  test('the requirement renders under the Provider field with the id Save references', () => {
    const markup = renderCard('', 'provider-requirement');
    const message = i18n.t('oauth_model_alias.provider_required');
    const requirement = markup.match(/<p id="provider-requirement"[^>]*>(.*?)<\/p>/)?.[1] ?? '';
    expect(requirement).toContain(message);
    // Field first, then the requirement, then the optional shortcuts.
    expect(markup.indexOf('<input')).toBeLessThan(markup.indexOf('id="provider-requirement"'));
    expect(markup.indexOf('id="provider-requirement"')).toBeLessThan(markup.indexOf('<details'));
    expect(markup.split(message)).toHaveLength(2);
    // The field itself is described by the requirement, not only the Save button.
    expect(markup).toMatch(/<input[^>]*aria-describedby="provider-requirement"/);
  });

  test('a chosen provider removes the requirement and shows the provider in the heading', () => {
    const markup = renderCard('claude');
    expect(markup).not.toContain(i18n.t('oauth_model_alias.provider_required'));
    expect(markup).not.toContain('aria-describedby');
    const heading = markup.slice(0, markup.indexOf('<input'));
    expect(heading).toContain(`${i18n.t('redesign.authFiles.selectedProvider')}: </span>`);
  });

  test('the provider step has no intro paragraph, so the mapping fields sit near the top', () => {
    const markup = renderCard('');
    expect(markup.slice(0, markup.indexOf('<input'))).not.toContain('<p');
    for (const messages of Object.values(productionLocales)) {
      expect('provider_hint' in messages.oauth_model_alias).toBe(false);
      expect('provider_hint' in messages.oauth_excluded).toBe(false);
    }
  });

  test('requirement text meets the 13px explanatory floor', () => {
    expect(editorCss).toMatch(/\.providerRequirement \{[^}]*font-size: 13px;/);
  });

  test('page content reserves room for the floating Back/Save bar', () => {
    expect(editorCss).toMatch(
      new RegExp(
        `\\.pageContent \\{[^}]*--oauth-editor-bar-room: calc\\( var\\(${OAUTH_EDITOR_ACTIONS_HEIGHT_VAR}, 0px\\) \\+ 28px[^}]*padding-bottom: var\\(--oauth-editor-bar-room\\);`
      )
    );
  });

  test('focus and scrollIntoView stop above the Save bar in both page scrollers', () => {
    const actionsCss = compileString(
      `@use 'src/styles/variables' as *;\n${readFileSync(
        'src/features/authFiles/components/OAuthEditorActions.module.scss',
        'utf8'
      )}`,
      {
        url: new URL(
          '../src/features/authFiles/components/OAuthEditorActions.module.scss',
          import.meta.url
        ),
        loadPaths: [process.cwd()],
      }
    ).css.replace(/\s+/g, ' ');
    expect(actionsCss).toMatch(
      new RegExp(
        `:global\\(html\\):has\\(\\.container\\), :global\\(html\\):has\\(\\.container\\) :global\\(\\.content\\) \\{ scroll-padding-bottom: calc\\(var\\(${OAUTH_EDITOR_ACTIONS_HEIGHT_VAR}, 0px\\) \\+ 28px \\+ env\\(safe-area-inset-bottom, 0px\\)\\); \\}`
      )
    );
  });

  test('the provider field, requirement and shortcuts form one bounded group', () => {
    expect(editorCss).toMatch(/\.providerFields \{[^}]*max-width: 680px;/);
    expect(editorCss).not.toContain('.providerRow');
    expect(editorCss).not.toContain('.providerChooser');
  });

  test('Add alias sits in the Model aliases heading, not after the last row', () => {
    const source = readFileSync('src/pages/AuthFilesOAuthModelAliasEditPage.tsx', 'utf8');
    const header = source.slice(
      source.indexOf('<div className={styles.editorHeader}>'),
      source.indexOf('<div className={bodyStyles.mappingsBody}>')
    );
    expect(header).toContain("t('oauth_model_alias.add_alias')");
    expect(header.indexOf("t('oauth_model_alias.alias_label')")).toBeLessThan(
      header.indexOf("t('oauth_model_alias.add_alias')")
    );
    expect(source.match(/oauth_model_alias\.add_alias/g)).toHaveLength(1);
  });

  test('"Keep original" uses the field-label style of its neighbours', () => {
    // Bun loads SCSS modules without class maps, so check the wiring in source.
    expect(
      readFileSync('src/features/authFiles/components/OAuthAliasMappingRow.tsx', 'utf8')
    ).toMatch(/label=\{t\('oauth_model_alias\.alias_fork_label'\)\}[^/]*labelVariant="field"/);
    expect(readFileSync('src/components/ui/ToggleSwitch.tsx', 'utf8')).toContain(
      "labelVariant === 'field' ? styles.fieldLabel : ''"
    );
    const toggleCss = compileString(
      `@use 'src/styles/variables' as *;\n${readFileSync('src/components/ui/ToggleSwitch.module.scss', 'utf8')}`,
      { loadPaths: [process.cwd()] }
    ).css.replace(/\s+/g, ' ');
    expect(toggleCss).toMatch(/\.fieldLabel \.label \{[^}]*font-size: 13px; font-weight: 500;/);
    expect(editorCss).toMatch(/\.modelField label \{[^}]*font-size: 13px; font-weight: 500;/);
  });
});
