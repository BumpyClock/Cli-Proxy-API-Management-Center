import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AuthFilesOAuthExcludedEditPage } from '@/pages/AuthFilesOAuthExcludedEditPage';
import { AuthFilesOAuthModelAliasEditPage } from '@/pages/AuthFilesOAuthModelAliasEditPage';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();

describe('OAuth editor route shells', () => {
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
        expect(markup).toContain(i18n.t(`${prefix}.add_title`));
        expect(markup).toContain(i18n.t(`${prefix}.editor_description`));
        expect(markup).toContain('role="status"');
        expect(markup).toContain(i18n.t('common.loading'));
        const saveButton = markup.match(/<button[^>]*disabled=""[^>]*>(.*?)<\/button>/)?.[1];
        expect(saveButton).toContain(renderToStaticMarkup(i18n.t(`${prefix}.save`)));
        expect(markup).toContain('<span>Back</span>');
        expect(markup).not.toContain(`${prefix}.`);
      } finally {
        router.dispose();
      }
    });
  }
});
