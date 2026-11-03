import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compile, compileString } from 'sass';

const moduleCss = (path: string) =>
  compileString(`@use 'src/styles/variables.scss' as *;\n${readFileSync(path, 'utf8')}`, {
    url: new URL(`../${path}`, import.meta.url),
    loadPaths: [process.cwd()],
  }).css;

function declarations(css: string, selector: string, media?: string) {
  const matches: Record<string, string>[] = [];
  const stack: string[] = [];
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@charset [^;]+;/g, '');
  for (const token of source.matchAll(/([^{}]+)\{|([^{}]+)\}|\}/g)) {
    if (token[1] !== undefined) {
      stack.push(token[1].trim());
    } else {
      const rule = stack.pop();
      if (!rule || token[2] === undefined) continue;
      if (
        !rule
          .split(',')
          .map((item) => item.trim())
          .includes(selector)
      )
        continue;
      if (media ? stack.at(-1) !== `@media ${media}` : stack.length !== 0) continue;
      matches.push(
        Object.fromEntries(
          [...token[2].matchAll(/([\w-]+):\s*([^;]+);/g)].map((match) => [
            match[1],
            match[2].trim(),
          ])
        )
      );
    }
  }
  return matches;
}

describe('responsive accessibility styles', () => {
  test('reserves action content and cell padding without expanding the fixed table', () => {
    const page = moduleCss('src/features/authFiles/AuthFilesPage.module.scss');
    const card = moduleCss('src/features/authFiles/components/AuthFileCard.module.scss');
    expect(declarations(page, '.table th:last-child')[0].width).toBe('94px');
    expect(declarations(page, '.table th:nth-child(2)')[0].width).toBe('calc(29% - 94px)');
    expect(declarations(card, '.rowActions')[0]['min-width']).toBe('70px');
    expect(declarations(card, '.row > td')[0].padding).toBe('16px 12px');
    expect(94 - 2 * 12).toBeGreaterThanOrEqual(70);
  });

  test('keeps narrow table headings visually hidden rather than display none', () => {
    const css = moduleCss('src/features/authFiles/AuthFilesPage.module.scss');
    const heading = declarations(css, '.table thead', '(max-width: 1100px)')[0];
    expect(heading).toMatchObject({
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      'clip-path': 'inset(50%)',
    });
    expect(heading.display).not.toBe('none');
    expect(
      declarations(css, '.table thead th:first-child label', '(max-width: 1100px)')[0].display
    ).toBe('none');
  });

  test('enlarges row actions and header controls for coarse pointers at all widths', () => {
    const card = moduleCss('src/features/authFiles/components/AuthFileCard.module.scss');
    for (const selector of ['.actions :global(.btn)', '.rowActions summary']) {
      expect(declarations(card, selector, '(pointer: coarse)')[0]).toMatchObject({
        'min-width': '44px',
        'min-height': '44px',
      });
    }
    const layout = compile('src/styles/layout.scss').css;
    expect(declarations(layout, ':root')[0]['--floating-control-size']).toBe('32px');
    expect(declarations(layout, ':root', '(pointer: coarse)')[0]['--floating-control-size']).toBe(
      '44px'
    );
    expect(declarations(layout, '.main-header .sidebar-toggle-floating')[0]).toMatchObject({
      width: 'var(--floating-control-size)',
      height: 'var(--floating-control-size)',
    });
  });

  test('wraps rail labels, retains badge space and clears fixed header', () => {
    const tabs = moduleCss('src/features/config/components/ConfigTabs.module.scss');
    const page = moduleCss('src/features/config/ConfigPage.module.scss');
    expect(declarations(tabs, '.tab')[0]['white-space']).toBe('normal');
    expect(declarations(tabs, '.tabLabel')[0]).toMatchObject({
      'min-width': '0',
      'overflow-wrap': 'anywhere',
    });
    expect(declarations(tabs, '.tabBadge')[0]['flex-shrink']).toBe('0');
    expect(declarations(page, '.tabsRow')[0].top).toBe('calc(var(--header-height) + 16px)');
    // Hidden creates a nested scroll container and prevents sticky rails following .content.
    const layout = compile('src/styles/layout.scss').css;
    expect(declarations(layout, '.main-content')[0]['overflow-x']).toBe('clip');
    expect(declarations(page, '.tabsRow', '(max-width: 900px)')[0].position).toBe('static');
  });

  test('disabled inputs and textareas have a distinguishable state', () => {
    const css = compile('src/styles/components.scss').css;
    for (const selector of ['.input:disabled', 'textarea:disabled']) {
      expect(declarations(css, selector)[0]).toMatchObject({
        opacity: '0.6',
        cursor: 'not-allowed',
      });
    }
  });
});
