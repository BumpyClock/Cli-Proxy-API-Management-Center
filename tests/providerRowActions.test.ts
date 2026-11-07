import { describe, expect, test } from 'bun:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import {
  ProviderRowActionItems,
  ProviderRowActions,
} from '@/features/providers/components/ProviderRowActions';
import { menuFocusTarget } from '@/utils/menuFocus';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
const noop = () => {};

describe('provider row Actions menu', () => {
  test('the trigger shows "Actions", names the resource and starts closed', () => {
    const markup = render(
      createElement(ProviderRowActions, {
        name: 'sk-***abcd',
        onView: noop,
        onEdit: noop,
        onDelete: noop,
      })
    );
    expect(markup).toContain('aria-label="Actions for sk-***abcd"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('<span>Actions</span>');
    expect(markup).not.toContain('role="menu"');
  });

  const items = (disableMutations: boolean) =>
    render(
      createElement(ProviderRowActionItems, {
        disableMutations,
        onView: noop,
        onEdit: noop,
        onDelete: noop,
      })
    );

  test('three labelled items in order, delete set apart by a separator', () => {
    const markup = items(false);
    const labels = [...markup.matchAll(/role="menuitem"[^>]*>[\s\S]*?<\/svg>([^<]+)</g)].map(
      (match) => match[1]
    );
    expect(labels).toEqual(['View details', 'Edit', 'Delete']);
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(3);
    expect(markup.indexOf('role="separator"')).toBeLessThan(markup.indexOf('Delete'));
    expect(markup.indexOf('role="separator"')).toBeGreaterThan(markup.indexOf('Edit'));
    expect(markup).not.toContain('disabled');
  });

  test('while mutations are blocked, Edit and Delete are disabled but View stays available', () => {
    const markup = items(true);
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).toMatch(/role="menuitem" tabindex="-1"><span>[\s\S]*?View details/);
  });
});

describe('menu focus movement', () => {
  test('arrows wrap both ways; Home and End jump; other keys are ignored', () => {
    expect(menuFocusTarget('ArrowDown', -1, 3)).toBe(0);
    expect(menuFocusTarget('ArrowDown', 2, 3)).toBe(0);
    expect(menuFocusTarget('ArrowUp', 0, 3)).toBe(2);
    expect(menuFocusTarget('ArrowUp', -1, 3)).toBe(2);
    expect(menuFocusTarget('Home', 2, 3)).toBe(0);
    expect(menuFocusTarget('End', 0, 3)).toBe(2);
    expect(menuFocusTarget('Enter', 1, 3)).toBeNull();
    expect(menuFocusTarget('ArrowDown', -1, 0)).toBeNull();
  });
});
