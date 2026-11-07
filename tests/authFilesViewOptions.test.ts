import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { AuthFilesToolbar } from '@/features/authFiles/components/AuthFilesToolbar';
import { OAuthRulesSummary } from '@/features/authFiles/components/OAuthRulesSummary';
import { countOAuthRules, summarizeViewOptions } from '@/features/authFiles/logic';
import type { ViewOptionsSummary } from '@/features/authFiles/logic';
import type { OAuthConfigLoadError } from '@/features/authFiles/constants';

const noop = () => {};

const renderToolbar = (viewOptions: ViewOptionsSummary) =>
  renderToStaticMarkup(
    createElement(AuthFilesToolbar, {
      search: '',
      onSearchChange: noop,
      statusFilterMode: 'problem',
      statusFilterOptions: [
        { value: 'all', label: 'All' },
        { value: 'enabled', label: 'Enabled' },
        { value: 'disabled', label: 'Disabled' },
        { value: 'problem', label: 'Problem' },
      ],
      onStatusFilterChange: noop,
      sortMode: 'az',
      sortOptions: [
        { value: 'default', label: 'Default' },
        { value: 'az', label: 'A-Z Name' },
      ],
      onSortModeChange: noop,
      pageSizeInput: '9',
      onPageSizeInputChange: noop,
      onPageSizeCommit: noop,
      compactMode: false,
      onCompactModeChange: noop,
      viewOptions,
    })
  );

describe('view options summary', () => {
  test('counts only the options that differ from their defaults', () => {
    expect(summarizeViewOptions({ sortMode: 'default', pageSize: 9, defaultPageSize: 9 })).toEqual({
      sortChanged: false,
      pageSizeChanged: false,
      changedCount: 0,
    });
    expect(summarizeViewOptions({ sortMode: 'az', pageSize: 9, defaultPageSize: 9 })).toEqual({
      sortChanged: true,
      pageSizeChanged: false,
      changedCount: 1,
    });
    // Compact mode has its own default page size (12), so 12 is not a change there.
    expect(
      summarizeViewOptions({ sortMode: 'default', pageSize: 12, defaultPageSize: 12 }).changedCount
    ).toBe(0);
    expect(
      summarizeViewOptions({ sortMode: 'priority', pageSize: 3, defaultPageSize: 9 }).changedCount
    ).toBe(2);
  });

  test('the trigger always shows its text and announces changed options', () => {
    const idle = renderToolbar({ sortChanged: false, pageSizeChanged: false, changedCount: 0 });
    const label = i18n.t('auth_files.display_options_label');
    const trigger = idle.match(/<button[^>]*aria-expanded="false"[^>]*>(.*?)<\/button>/)!;
    expect(trigger[1]).toContain(`<span>${label}</span>`);
    expect(trigger[0]).not.toContain('aria-label=');
    expect(idle).not.toContain(i18n.t('auth_files.view_options_changed', { count: 1 }));

    const changed = renderToolbar({ sortChanged: true, pageSizeChanged: true, changedCount: 2 });
    expect(changed).toContain(i18n.t('auth_files.view_options_changed', { count: 2 }));
    expect(changed).toMatch(/aria-hidden="true">2<\/span>/);
  });

  test('the closed panel is controlled by the trigger and holds a visibly labelled sort', () => {
    const markup = renderToolbar({ sortChanged: true, pageSizeChanged: false, changedCount: 1 });
    const panelId = markup.match(/aria-controls="([^"]+)"/)![1];
    expect(markup).toMatch(new RegExp(`<div id="${panelId}"[^>]*role="group"[^>]*hidden=""`));
    const selectId = markup.match(/<select id="([^"]+)"/)![1];
    expect(markup).toContain(`<label for="${selectId}">${i18n.t('auth_files.sort_label')}</label>`);
    expect(markup).toMatch(/<option value="az" selected="">/);
    expect(markup).toMatch(/<label for="[^"]+">[^<]+<\/label><input[^>]*type="number"/);
  });

  test('the status filter is one labelled group with the current status pressed', () => {
    const markup = renderToolbar({ sortChanged: false, pageSizeChanged: false, changedCount: 0 });
    const group = markup.match(/<div[^>]*role="group"[^>]*>(.*?)<\/div>/)!;
    expect(group[0]).toContain(`aria-label="${i18n.t('auth_files.problem_filter_label')}"`);
    const pressed = [
      ...group[1].matchAll(/aria-pressed="(true|false)"[^>]*>.*?<span[^>]*>([^<]+)/g),
    ];
    expect(pressed.map((m) => [m[2], m[1]])).toEqual([
      ['All', 'false'],
      ['Enabled', 'false'],
      ['Disabled', 'false'],
      ['Problem', 'true'],
    ]);
  });
});

describe('count strings use plural forms', () => {
  const en = i18n.getFixedT('en');
  const ru = i18n.getFixedT('ru');

  test('english singular and plural', () => {
    expect(en('oauth_excluded.model_count', { count: 1 })).toBe('1 model disabled');
    expect(en('oauth_excluded.model_count', { count: 2 })).toBe('2 models disabled');
    expect(en('oauth_model_alias.model_count', { count: 1 })).toBe('1 alias');
    expect(en('oauth_model_alias.model_count', { count: 2 })).toBe('2 aliases');
    expect(en('auth_files.meta_total', { count: 1 })).toBe('1 credential');
    expect(en('auth_files.meta_total', { count: 2 })).toBe('2 credentials');
    expect(en('auth_files.oauth_rules_providers', { count: 1 })).toBe('1 provider');
    expect(en('auth_files.oauth_rules_providers', { count: 2 })).toBe('2 providers');
  });

  test('russian one, few and many forms', () => {
    expect(ru('oauth_excluded.model_count', { count: 1 })).toBe('1 модель отключена');
    expect(ru('oauth_excluded.model_count', { count: 2 })).toBe('2 модели отключены');
    expect(ru('oauth_excluded.model_count', { count: 5 })).toBe('5 моделей отключено');
    expect(ru('oauth_model_alias.model_count', { count: 1 })).toBe('1 псевдоним');
    expect(ru('oauth_model_alias.model_count', { count: 2 })).toBe('2 псевдонима');
    expect(ru('oauth_model_alias.model_count', { count: 5 })).toBe('5 псевдонимов');
    expect(ru('auth_files.oauth_rules_providers', { count: 21 })).toBe('21 провайдер');
  });

  test('chinese locales resolve the count strings', () => {
    for (const lng of ['zh-CN', 'zh-TW']) {
      const t = i18n.getFixedT(lng);
      for (const key of [
        'oauth_excluded.model_count',
        'oauth_model_alias.model_count',
        'auth_files.meta_total',
        'auth_files.oauth_rules_providers',
        'auth_files.view_options_changed',
      ]) {
        expect(t(key, { count: 2 }), `${lng} ${key}`).toContain('2');
        expect(t(key, { count: 2 }), `${lng} ${key}`).not.toBe(key);
      }
    }
  });
});

describe('credentials-tab OAuth rule summary', () => {
  const renderSummary = (
    expanded: boolean,
    excludedError: OAuthConfigLoadError = null,
    aliasError: OAuthConfigLoadError = null
  ) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(OAuthRulesSummary, {
          excluded: { error: excludedError, rules: { claude: ['a', 'b'], codex: ['c'] } },
          aliases: { error: aliasError, rules: { codex: [{ name: 'x', alias: 'y' }] } },
          expanded,
          onExpandedChange: noop,
          children: createElement('p', null, 'provider panels'),
        })
      )
    );

  test('counts providers and rules', () => {
    expect(countOAuthRules({ claude: ['a', 'b'], codex: null, gemini: [] })).toEqual({
      providers: 3,
      rules: 2,
    });
    expect(countOAuthRules({})).toEqual({ providers: 0, rules: 0 });
  });

  test('one line per section with its totals; the section tabs, not this footer, navigate', () => {
    const markup = renderSummary(false);
    expect(markup).not.toContain('<a ');
    const terms = [...markup.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((m) => m[1]);
    expect(terms).toEqual([
      i18n.t('redesign.authFiles.disablement'),
      i18n.t('redesign.authFiles.aliases'),
    ]);
    expect(markup).toContain(
      `${i18n.t('auth_files.oauth_rules_providers', { count: 2 })} · ${i18n.t(
        'oauth_excluded.model_count',
        { count: 3 }
      )}`
    );
    expect(markup).toContain(
      `${i18n.t('auth_files.oauth_rules_providers', { count: 1 })} · ${i18n.t(
        'oauth_model_alias.model_count',
        { count: 1 }
      )}`
    );
  });

  test('the per-provider panels stay behind a disclosure until expanded', () => {
    const collapsed = renderSummary(false);
    expect(collapsed).toMatch(/aria-expanded="false"/);
    expect(collapsed).not.toContain('provider panels');
    expect(collapsed).toContain(i18n.t('auth_files.oauth_rules_show'));

    const expanded = renderSummary(true);
    const controls = expanded.match(/aria-expanded="true" aria-controls="([^"]+)"/)![1];
    expect(expanded).toContain(`<div id="${controls}"`);
    expect(expanded).toContain('provider panels');
    expect(expanded).toContain(i18n.t('auth_files.oauth_rules_hide'));
  });

  test('load states replace the totals instead of showing zero', () => {
    const markup = renderSummary(false, 'unsupported', 'load');
    expect(markup).toContain(i18n.t('oauth_excluded.upgrade_required_title'));
    expect(markup).toContain(i18n.t('notification.refresh_failed'));
    expect(markup).not.toContain(i18n.t('oauth_excluded.model_count', { count: 3 }));
  });
});
