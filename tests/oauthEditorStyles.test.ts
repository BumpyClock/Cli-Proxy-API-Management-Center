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
      Object.fromEntries([...body.matchAll(/([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]))
  );
}

describe('OAuth editor shared shell styles', () => {
  test('keeps redesigned desktop and narrow spacing, card shape and focus color', () => {
    expect(rules(shared, '.pageContent')).toEqual([
      {
        display: 'flex',
        'flex-direction': 'column',
        gap: '16px',
        padding: '32px',
        'min-width': '0',
        width: '100%',
        'box-sizing': 'border-box',
      },
      { padding: '16px' },
    ]);
    expect(shared).toContain('@media (max-width: 768px)');
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
    expect(rules(shared, '.editorStepNumber')[0]).toMatchObject({ 'border-radius': '6px' });
    expect(rules(shared, '.editorStepNumber')[0].font).toStartWith('12px ');
    expect(rules(shared, '.description')[0]['line-height']).toBe('1.65');
    expect(rules(shared, '.sectionTitle')[0]['font-size']).toBe('15px');
    expect(rules(shared, '.stepNumber')[0]['font-size']).toBe('11px');
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
      'editorStepNumber',
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
    expect(rules(excluded, '.emptyModels')[0].padding).toBe('32px 16px');
    expect(rules(aliases, '.catalogHint')[0].padding).toBe('12px 16px');
    expect(rules(aliases, '.mappingsBody')[0].padding).toBe('12px');
  });
});
