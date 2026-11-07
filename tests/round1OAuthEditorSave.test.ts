import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { compileString } from 'sass';
import { OAuthAliasMappingRow } from '@/features/authFiles/components/OAuthAliasMappingRow';
import { OAuthEditorProviderCard } from '@/features/authFiles/components/OAuthEditorProviderCard';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
const render = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
const noop = () => {};

const pages = [
  ['src/pages/AuthFilesOAuthExcludedEditPage.tsx', 'oauth_excluded'],
  ['src/pages/AuthFilesOAuthModelAliasEditPage.tsx', 'oauth_model_alias'],
] as const;

describe('OAuth editor save gating', () => {
  for (const [path, prefix] of pages) {
    test(`${prefix}: one provider predicate drives Save and the requirement under Provider`, () => {
      const source = readFileSync(path, 'utf8');
      expect(source.match(/const providerMissing = !resolvedProviderKey;/g)).toHaveLength(1);
      expect(source).toMatch(/const canSave =\s*!providerMissing &&/);
      expect(source).toContain('const showProviderRequirement = editorReady && providerMissing;');
      expect(source).toMatch(
        /const handleSave = useCallback\(async \(\) => \{\s*if \(providerMissing\) return;/
      );
      // The requirement renders under the Provider field and again beside Save, which it describes.
      expect(source).toContain(
        'requirementId={showProviderRequirement ? providerRequirementId : undefined}'
      );
      expect(source).toMatch(
        /disabled=\{!canSave\}\s*aria-describedby=\{showProviderRequirement \? saveReasonId : undefined\}/
      );
      expect(source).toMatch(
        new RegExp(
          `showProviderRequirement\\s*\\? \\{ id: saveReasonId, text: t\\('${prefix}\\.provider_required'\\) \\}`
        )
      );
      // No parallel provider checks remain.
      expect(source).not.toMatch(/normalizeProviderKey\(provider\)\s*;?\s*\n\s*if \(!/);
      expect(source).not.toContain('!provider.trim()');
      expect(source).not.toContain('resolvedProviderKey ? (');
      // The requirement appears only in the Save bar, never as a model-section placeholder.
      expect(source.match(new RegExp(`${prefix}\\.provider_required`, 'g'))).toHaveLength(1);
      expect(source).not.toContain('models_need_provider');
    });
  }

  test('alias catalog hint only describes the loaded catalog, never the missing provider', () => {
    const source = readFileSync('src/pages/AuthFilesOAuthModelAliasEditPage.tsx', 'utf8');
    expect(source).not.toContain('oauth_model_alias.provider_hint');
    expect(source).toMatch(
      /\{!providerMissing && \(\s*<div className=\{bodyStyles\.catalogHint\}>/
    );
  });

  test('Save is one verb and the new copy exists in every locale', () => {
    for (const locale of [en, zhCN, zhTW, ru]) {
      for (const section of [locale.oauth_excluded, locale.oauth_model_alias]) {
        expect(section.save).not.toContain('/');
        expect(section.provider_required.length).toBeGreaterThan(0);
        // Retired with the intro copy and the duplicate model-section placeholder.
        expect('provider_hint' in section).toBe(false);
        expect('models_need_provider' in section).toBe(false);
      }
      expect(locale.oauth_model_alias.source_model_input_placeholder).not.toBe(
        locale.oauth_model_alias.alias_name_placeholder
      );
      expect(locale.oauth_model_alias.alias_input_placeholder).not.toBe(
        locale.oauth_model_alias.alias_placeholder
      );
    }
  });
});

describe('OAuth editor controls', () => {
  test('alias inputs keep labels but use distinct placeholders', () => {
    const markup = render(
      createElement(OAuthAliasMappingRow, {
        entry: { name: '', alias: '', fork: true },
        index: 0,
        options: [],
        disabled: false,
        canRemove: true,
        onChange: noop,
        onRemove: noop,
      })
    );
    expect(markup).toContain(`>${en.oauth_model_alias.alias_name_placeholder}</label>`);
    expect(markup).toContain(`>${en.oauth_model_alias.alias_placeholder}</label>`);
    expect(markup).toContain(
      `placeholder="${en.oauth_model_alias.source_model_input_placeholder}"`
    );
    expect(markup).toContain(`placeholder="${en.oauth_model_alias.alias_input_placeholder}"`);
    expect(markup).not.toContain(`placeholder="${en.oauth_model_alias.alias_placeholder}"`);
    expect(markup).toContain('aria-label="Delete alias mapping 1"');
    const onlyRow = render(
      createElement(OAuthAliasMappingRow, {
        entry: { name: '', alias: '', fork: true },
        index: 0,
        options: [],
        disabled: false,
        canRemove: false,
        onChange: noop,
        onRemove: noop,
      })
    );
    expect(onlyRow).not.toContain('Delete alias mapping');
  });

  test('provider chips mirror the typed provider as a pressed state', () => {
    const markup = render(
      createElement(OAuthEditorProviderCard, {
        provider: 'Claude',
        options: ['codex', 'claude'],
        onChange: noop,
        disabled: false,
        translationPrefix: 'oauth_model_alias',
      })
    );
    const pressed = markup.match(/<button[^>]*aria-pressed="true"[^>]*>/g) ?? [];
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).not.toContain('disabled');
    expect(markup.match(/aria-pressed="false"/g)).toHaveLength(1);
  });

  test('step badges share an inset, the selected chip is emphasized and delete is legible', () => {
    const css = compileString(
      `@use 'src/styles/variables' as *;\n${readFileSync(
        'src/features/authFiles/components/OAuthEditor.module.scss',
        'utf8'
      )}`,
      {
        loadPaths: [process.cwd()],
        url: new URL(
          '../src/features/authFiles/components/OAuthEditor.module.scss',
          import.meta.url
        ),
      }
    ).css;
    const block = (selector: string) =>
      css.match(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]+)\\}`))?.[1] ?? '';
    expect(block('.providerSection')).toContain('padding: 16px');
    expect(block('.editorHeader')).toContain('padding: 16px');
    expect(css).not.toMatch(/\.providerSection\s*\{[^}]*padding:\s*24px/);
    expect(block('.providerOptionActive')).toContain('font-weight: 600');
    expect(block('.removeMapping')).toContain('color: var(--text-secondary)');
    expect(block('.providerRequirement')).toContain('color: var(--text-secondary)');
    expect(block('.providerRequirement')).toContain('font-size: 13px');
  });
});
