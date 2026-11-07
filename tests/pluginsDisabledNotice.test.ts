import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compileString } from 'sass';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import {
  PluginNotice,
  PluginsDisabledNotice,
  PluginTrustNotice,
} from '@/features/plugins/components/PluginNotices';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n('en');
const render = (element: ReactElement) =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(MemoryRouter, null, element))
  );
const tone = (html: string) => html.match(/data-tone="([^"]*)"/)?.[1];

describe('plugin notice severities', () => {
  test('the plugins.enabled blocker renders differently from a calm hint', () => {
    const blocker = render(
      createElement(PluginsDisabledNotice, {
        message: i18n.t('plugin_store.global_disabled_hint'),
      })
    );
    const hint = render(createElement(PluginNotice, null, 'Restart required'));
    expect(tone(blocker)).toBe('blocking');
    expect(tone(hint)).toBe('info');
    expect(blocker).toContain('href="/config?field=pluginsEnabled"');
    expect(blocker).toContain(i18n.t('plugin_management.open_plugins_setting'));
  });

  test('the disabled blocker and the trust advisory keep separate severities', () => {
    const trust = render(createElement(PluginTrustNotice));
    const disabled = render(
      createElement(PluginsDisabledNotice, {
        message: i18n.t('plugin_store.global_disabled_hint'),
      })
    );
    expect(tone(trust)).toBe('security');
    expect(tone(disabled)).toBe('blocking');
    // Only the trust warning is announced as a note; the blocker is ordinary content.
    expect(trust).toContain('role="note"');
    expect(disabled).not.toContain('role=');
  });

  test('the blocker is styled above the advisory: tinted, bordered and accented', () => {
    const css = compileString(
      `@use 'src/styles/variables' as *;\n${readFileSync(
        'src/features/plugins/components/PluginNotices.module.scss',
        'utf8'
      )}`,
      { url: new URL('../src/features/plugins/components/PluginNotices.module.scss', import.meta.url), loadPaths: [process.cwd()] }
    ).css;
    const block = (name: string) =>
      css.slice(css.indexOf(`.${name} {`), css.indexOf('}\n', css.indexOf(`.${name} {`)));
    expect(block('blocking')).toContain('background: var(--warning-bg)');
    expect(block('blocking')).toContain('border-left: 4px solid var(--warning-color)');
    expect(block('security')).not.toContain('--warning');
  });

  test('the store shows the blocker before the trust advisory, which always renders', () => {
    const store = readFileSync('src/features/plugins/PluginStorePage.tsx', 'utf8');
    const blocker = store.indexOf(
      "<PluginsDisabledNotice message={t('plugin_store.global_disabled_hint')} />"
    );
    expect(blocker).toBeGreaterThan(-1);
    expect(store.indexOf('<PluginTrustNotice />')).toBeGreaterThan(blocker);
  });
});
