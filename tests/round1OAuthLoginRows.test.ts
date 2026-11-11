import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { compileString } from 'sass';
import { OAuthPage } from '@/pages/OAuthPage';
import {
  KIMI_CHINESE_AFFILIATE_URL,
  KIMI_INTERNATIONAL_AFFILIATE_URL,
} from '@/features/providers/kimi';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });

const markup = renderToStaticMarkup(
  createElement(
    I18nextProvider,
    { i18n },
    createElement(MemoryRouter, null, createElement(OAuthPage))
  )
);
const rows = [...markup.matchAll(/<article\b[\s\S]*?<\/article>/g)].map(([row]) => row);
const BUILTIN = ['meta', 'kimi', 'kimi_ai', 'codex', 'anthropic', 'antigravity', 'xai', 'devin'];

describe('OAuth Login provider rows', () => {
  const REGION_VARIANTS = new Set(['kimi', 'kimi_ai']);

  test('every row reads icon, name, description, then its actions', () => {
    expect(rows).toHaveLength(BUILTIN.length);
    rows.forEach((row, index) => {
      const key = BUILTIN[index];
      const visibleName = REGION_VARIANTS.has(key)
        ? i18n.t(`auth_login.${key}_region`)
        : i18n.t(`auth_login.${key}_oauth_title`);
      const body = row.slice(row.indexOf('>') + 1);
      const title = body.indexOf(visibleName);
      const hint = body.indexOf(i18n.t(`auth_login.${key}_oauth_hint`));
      const action = body.indexOf(i18n.t(`auth_login.${key}_oauth_button`));
      expect(body.indexOf('<img')).toBeLessThan(title);
      expect(title).toBeGreaterThan(-1);
      expect(hint).toBeGreaterThan(title);
      expect(action).toBeGreaterThan(hint);
      if (REGION_VARIANTS.has(key)) {
        expect(row).toContain(`aria-label="${i18n.t(`auth_login.${key}_oauth_title`)}"`);
      } else {
        const labelledBy = row.match(/aria-labelledby="([^"]+)"/)?.[1];
        expect(row).toContain(`id="${labelledBy}"`);
      }
    });
  });

  test('Kimi China and International carry distinct visible region badges', () => {
    const china = i18n.t('auth_login.kimi_region');
    const international = i18n.t('auth_login.kimi_ai_region');
    expect(china).not.toBe(international);
    expect(rows[1]).toContain(china);
    expect(rows[1]).not.toContain(international);
    expect(rows[2]).toContain(international);
    expect(rows[2]).not.toContain(china);
  });

  test('provider rows share one action emphasis instead of a primary per row', () => {
    expect(markup).not.toContain('btn-primary');
  });

  test('primary actions share one "Log in with" verb in every locale', () => {
    const patterns: [typeof en, string, string][] = [
      [en, 'Log in with ', ''],
      [zhCN, '使用 ', '登录'],
      [zhTW, '使用 ', '登入'],
      [ru, 'Войти через ', ''],
    ];
    for (const [locale, prefix, suffix] of patterns) {
      for (const key of [...BUILTIN, 'plugin']) {
        const label = (locale.auth_login as Record<string, string>)[`${key}_oauth_button`];
        expect(label.startsWith(prefix)).toBe(true);
        expect(label.endsWith(suffix)).toBe(true);
      }
    }
    expect(markup).not.toMatch(/Start \w+ Login/);
    expect(markup).toContain('Log in with Kimi China');
    expect(markup).toContain('Log in with Kimi International');
  });

  test('Kimi sign-up is a labelled external link, quieter than Log in, inside the action group', () => {
    const expected: [number, string, string][] = [
      [1, KIMI_CHINESE_AFFILIATE_URL, 'Create account for Kimi China (opens in a new tab)'],
      [
        2,
        KIMI_INTERNATIONAL_AFFILIATE_URL,
        'Create account for Kimi International (opens in a new tab)',
      ],
    ];
    for (const [index, href, label] of expected) {
      const link = rows[index].match(/<a\b[^>]*>[\s\S]*?<\/a>/)?.[0] ?? '';
      expect(link).toContain(`href="${href}"`);
      expect(link).toContain('target="_blank"');
      expect(link).toContain('rel="noopener noreferrer"');
      expect(link).toContain('btn btn-ghost');
      expect(link).toContain(`aria-label="${label}"`);
      expect(link).toContain(i18n.t('auth_login.kimi_sign_up_button'));
      expect(link).toContain('<svg');
      expect(rows[index].indexOf(link)).toBeGreaterThan(
        rows[index].indexOf(i18n.t(`auth_login.${BUILTIN[index]}_oauth_button`))
      );
    }
    expect(rows.filter((row) => row.includes('<a '))).toHaveLength(2);
  });

  test('idle rows render no empty flow container', () => {
    for (const row of rows) {
      expect(row).not.toContain('status-badge');
      expect(row).not.toContain('<input');
    }
  });

  test('actions keep one slot: row end on wide screens, stacked below the copy on phones', () => {
    const css = compileString(
      `@use 'src/styles/variables' as *;\n${readFileSync('src/pages/OAuthPage.module.scss', 'utf8')}`,
      {
        loadPaths: [process.cwd()],
        url: new URL('../src/pages/OAuthPage.module.scss', import.meta.url),
      }
    ).css;
    expect(css).toMatch(
      /\.providerRow\s*\{[^}]*grid-template-columns:\s*24px minmax\(0, 1fr\) auto/
    );
    expect(css).toMatch(/\.rowActions\s*\{[^}]*justify-content:\s*flex-end/);
    const phone = css.slice(css.indexOf('@media (max-width: 640px)'));
    expect(phone).toMatch(/\.providerRow\s*\{[^}]*grid-template-columns:\s*24px minmax\(0, 1fr\)/);
    expect(phone).toMatch(
      /\.rowActions\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*flex-direction:\s*column/
    );
    expect(css).not.toContain('card-header');
  });
});
