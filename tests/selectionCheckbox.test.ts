import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';

const render = (props: Partial<Parameters<typeof SelectionCheckbox>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(SelectionCheckbox, { checked: false, onChange: () => {}, ...props })
  );

describe('SelectionCheckbox', () => {
  test('is a native checkbox inside its label, so the whole label is the hit area', () => {
    const html = render({ label: 'Remember password' });
    expect(html).toMatch(/^<label[^>]*>[\s\S]*<input[^>]*type="checkbox"[\s\S]*<\/label>$/);
    expect(html).toContain('Remember password');
    // Phrasing content only: a <div> inside <label> is invalid HTML.
    expect(html).not.toContain('<div');
  });

  test('a bare checkbox takes its accessible name from ariaLabel', () => {
    const html = render({ ariaLabel: 'Select auth-1.json', checked: true });
    expect(html).toMatch(/<input[^>]*aria-label="Select auth-1.json"/);
    expect(html).toMatch(/<input[^>]*checked=""/);
    // The check glyph is decorative; the input carries the state.
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  test('disabled reaches the native input', () => {
    expect(render({ disabled: true, ariaLabel: 'Select page' })).toMatch(/<input[^>]*disabled=""/);
  });
});
