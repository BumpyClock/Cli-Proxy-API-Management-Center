import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compileString } from 'sass';

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const compileModule = (path: string) =>
  compileString(`@use 'src/styles/variables' as *;\n${readSource(path)}`, {
    url: new URL(`../${path}`, import.meta.url),
    loadPaths: [process.cwd()],
  }).css;
const shared = compileModule('src/features/authFiles/components/OAuthEditor.module.scss');

function rules(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]+)}`, 'g'))].map(
    ([, body]) =>
      Object.fromEntries(
        [...body.matchAll(/([\w-]+):\s*([^;]+);/g)].map((m) => [
          m[1],
          // Custom properties keep source whitespace; compare the value, not the formatting.
          m[2].replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')'),
        ])
      )
  );
}

describe('OAuth editor shared shell styles', () => {
  test('inherits the shell page gutter, card shape and focus color', () => {
    // The layout's .main-content owns page gutters; editors must not add a second, wider inset.
    expect(rules(shared, '.pageContent')).toEqual([
      {
        display: 'flex',
        'flex-direction': 'column',
        gap: '16px',
        'min-width': '0',
        width: '100%',
        // Room for the floating Back/Save bar (OAuthEditorActions): height, offset, clearance.
        '--oauth-editor-bar-room':
          'calc(var(--oauth-editor-actions-height, 0px) + 28px + env(safe-area-inset-bottom, 0px))',
        'padding-bottom': 'var(--oauth-editor-bar-room)',
      },
    ]);
    // An open model list gets its 200px + offset of scroll room below the last row.
    expect(rules(shared, '.pageContent:has(:global(.autocomplete-dropdown))')).toEqual([
      { 'padding-bottom': 'calc(var(--oauth-editor-bar-room) + 216px)' },
    ]);
    expect(rules(shared, '.pageContent > :global(.card)')).toEqual([
      { 'box-shadow': 'none', 'border-radius': '8px' },
    ]);
    expect(rules(shared, '.pageContent :focus-visible')).toEqual([
      { 'outline-color': 'var(--focus-ring)' },
    ]);
    expect(shared.indexOf('.pageContent :focus-visible')).toBeGreaterThan(
      shared.indexOf('.providerOption:focus-visible')
    );
    expect(rules(shared, '.editorHeader')[0]).toMatchObject({
      gap: '12px',
      padding: '16px',
      'flex-wrap': 'wrap',
      'border-bottom': '1px solid var(--border-color)',
    });
    expect(rules(shared, '.loading')[0]).toMatchObject({ padding: '32px', gap: '8px' });
  });

  test('preserves distinct page headings and existing child typography', () => {
    expect(rules(shared, '.editorDescription')[0]).toMatchObject({
      'line-height': '1.5',
      'overflow-wrap': 'anywhere',
    });
    expect(rules(shared, '.editorSectionTitle')[0]).toMatchObject({
      'font-size': '14px',
      'font-weight': '600',
      margin: '0 0 4px',
    });
    // Both steps share one badge (12px metadata floor) and one 14px/600 title size.
    expect(rules(shared, '.editorStepNumber')).toEqual([]);
    expect(rules(shared, '.stepNumber')[0]['font-size']).toBe('12px');
    expect(rules(shared, '.stepNumber')[0].color).toBe('var(--text-secondary)');
    expect(rules(shared, '.sectionTitle')[0]['font-size']).toBe('14px');
    expect(rules(shared, '.sectionTitle')[0]['font-weight']).toBe('600');
    // The provider step dropped its intro paragraph.
    expect(rules(shared, '.description')).toEqual([]);
  });

  test('both pages import one shell owner and keep only unique body rules locally', () => {
    const pages = ['AuthFilesOAuthExcludedEditPage', 'AuthFilesOAuthModelAliasEditPage'];
    const shellClasses = [
      'pageContent',
      'loading',
      'editorDescription',
      'settingsCard',
      'editorHeader',
      'sectionHeading',
      'headingCopy',
      'stepNumber',
      'editorSectionTitle',
    ];
    for (const page of pages) {
      const source = readSource(`src/pages/${page}.tsx`);
      const local = compileModule(`src/pages/${page}.module.scss`);
      expect(source).toContain(
        "import styles from '@/features/authFiles/components/OAuthEditor.module.scss'"
      );
      for (const name of shellClasses) {
        expect(rules(shared, `.${name}`).length).toBeGreaterThan(0);
        expect(rules(local, `.${name}`)).toEqual([]);
      }
    }
    const excluded = compileModule('src/pages/AuthFilesOAuthExcludedEditPage.module.scss');
    const aliases = compileModule('src/pages/AuthFilesOAuthModelAliasEditPage.module.scss');
    expect(rules(excluded, '.editorBody')).toEqual([{ padding: '16px' }]);
    expect(rules(excluded, '.countBadge')[0].padding).toBe('3px 8px');
    // No model-section placeholder: the provider requirement lives in step 01 only.
    expect(rules(excluded, '.emptyModels')).toEqual([]);
    expect(rules(aliases, '.catalogHint')[0].padding).toBe('12px 16px');
    expect(rules(aliases, '.mappingsBody')[0].padding).toBe('12px');
  });
});
