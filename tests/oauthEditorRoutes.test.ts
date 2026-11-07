import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AuthFilesOAuthExcludedEditPage } from '@/pages/AuthFilesOAuthExcludedEditPage';
import { AuthFilesOAuthModelAliasEditPage } from '@/pages/AuthFilesOAuthModelAliasEditPage';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();

const pageSources = {
  oauth_excluded: readFileSync('src/pages/AuthFilesOAuthExcludedEditPage.tsx', 'utf8'),
  oauth_model_alias: readFileSync('src/pages/AuthFilesOAuthModelAliasEditPage.tsx', 'utf8'),
};

describe('OAuth editor route shells', () => {
  test('Save waits for the loaded baseline in both editors', () => {
    for (const source of Object.values(pageSources)) {
      expect(source).toMatch(/const canSave =[^;]*baselineReady &&/);
      expect(source).toContain('disabled={!canSave}');
    }
  });

  for (const { path, Page, prefix } of [
    {
      path: '/auth-files/oauth-excluded',
      Page: AuthFilesOAuthExcludedEditPage,
      prefix: 'oauth_excluded',
    },
    {
      path: '/auth-files/oauth-model-alias',
      Page: AuthFilesOAuthModelAliasEditPage,
      prefix: 'oauth_model_alias',
    },
  ]) {
    test(`${path} keeps its page heading, guidance and disabled save during initial load`, () => {
      const router = createMemoryRouter([{ path, element: createElement(Page) }], {
        initialEntries: [`${path}?provider=long-custom-provider-with-many-models`],
      });
      try {
        const markup = renderToStaticMarkup(
          createElement(I18nextProvider, { i18n }, createElement(RouterProvider, { router }))
        );
        expect(markup.match(/<h1\b/g)).toHaveLength(1);
        expect(markup).toMatch(new RegExp(`<h1[^>]*>${i18n.t(`${prefix}.title`)}</h1>`));
        expect(markup).toContain(i18n.t(`${prefix}.editor_description`));
        expect(markup).toContain('role="status"');
        expect(markup).toContain(i18n.t('common.loading'));
        // Back and Save portal into document.body (OAuthEditorActions), so the server render
        // has neither; Save stays disabled until the baseline loads (canSave needs baselineReady).
        expect(markup).not.toContain('<span>Back</span>');
        expect(markup).not.toContain(`${prefix}.`);
      } finally {
        router.dispose();
      }
    });
  }
});
