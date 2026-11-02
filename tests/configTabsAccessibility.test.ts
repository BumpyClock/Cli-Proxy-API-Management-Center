import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { ConfigTabs } from '@/features/config/components/ConfigTabs';

const noop = () => {};

describe('ConfigTabs accessibility', () => {
  test('announces validation errors and unsaved changes in the tab name', () => {
    const markup = renderToStaticMarkup(
      createElement(ConfigTabs, {
        active: 'common',
        errorCounts: { streaming: 2 },
        dirtyTabs: new Set(['streaming']),
        onChange: noop,
      })
    );
    const accessibleLabel = [
      i18n.t('config_management.visual.sections.streaming.title'),
      i18n.t('config_management.meta_errors', { count: 2 }),
      i18n.t('config_management.status_dirty_short'),
    ].join(', ');

    expect(markup).toContain(`aria-label="${accessibleLabel}"`);
  });
});

test('mobile picker retains every section, active selection, and dirty/error evidence', () => {
  const markup = renderToStaticMarkup(
    createElement(ConfigTabs, {
      active: 'logging',
      errorCounts: { streaming: 2 },
      dirtyTabs: new Set(['streaming']),
      onChange: noop,
    })
  );
  expect(markup.match(/<option /g)).toHaveLength(8);
  expect(markup).toContain('<option value="logging" selected=""');
  expect(markup).toContain(i18n.t('config_management.meta_errors', { count: 2 }));
  expect(markup).toContain('aria-orientation="vertical"');
});

test('saving disables both section navigation controls', () => {
  const markup = renderToStaticMarkup(
    createElement(ConfigTabs, {
      active: 'common',
      errorCounts: {},
      dirtyTabs: new Set(),
      disabled: true,
      onChange: noop,
    })
  );
  expect(markup).toMatch(/<select[^>]*disabled=""/);
  expect(markup.match(/<button[^>]*disabled=""/g)).toHaveLength(8);
});
