import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { compileString } from 'sass';
import { claudeToResource, geminiToResource } from '@/features/providers/adapters';
import { ProviderResourceTable } from '@/features/providers/components/ProviderResourceTable';
import { PROVIDER_TABLE_COLUMN_WIDTHS } from '@/features/providers/workbenchLayout';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();
const TABLE_SCSS = 'src/features/providers/components/ProviderResourceTable.module.scss';

const css = compileString(
  `@use 'src/styles/variables.scss' as *;\n${readFileSync(TABLE_SCSS, 'utf8')}`,
  { url: new URL(`../${TABLE_SCSS}`, import.meta.url), loadPaths: [process.cwd()] }
).css;

/** Merged declarations of every rule listing `selector`, at top level or directly in `media`. */
function rule(selector: string, media?: string): Record<string, string> {
  const merged: Record<string, string> = {};
  const stack: string[] = [];
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@charset [^;]+;/g, '');
  for (const token of source.matchAll(/([^{}]+)\{|([^{}]+)\}|\}/g)) {
    if (token[1] !== undefined) {
      stack.push(token[1].trim());
      continue;
    }
    const current = stack.pop();
    if (!current || token[2] === undefined) continue;
    if (
      !current
        .split(',')
        .map((item) => item.trim())
        .includes(selector)
    )
      continue;
    if (media ? stack.at(-1) !== `@media ${media}` : stack.length !== 0) continue;
    for (const match of token[2].matchAll(/([\w-]+):\s*([^;]+);/g)) {
      merged[match[1]] = match[2].trim();
    }
  }
  return merged;
}

const px = (value: string | undefined) => Number.parseFloat(value ?? 'NaN');
const fixedWidths = PROVIDER_TABLE_COLUMN_WIDTHS.filter((w): w is number => w !== null);
const BASE_URL_FLOOR = 120;
/** Table space beside the 240px catalog at a 1440px viewport, measured from providers-1440.png. */
const TABLE_SPACE_AT_1440 = 757;

const render = (resources: ReturnType<typeof claudeToResource>[]) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(ProviderResourceTable, {
        resources,
        onView: () => {},
        onEdit: () => {},
        onDelete: () => {},
        onToggleDisabled: () => {},
      })
    )
  );

describe('provider resource table column budget', () => {
  test('six columns, one flexible (Base URL), fixed widths fit the 1440 table space', () => {
    expect(PROVIDER_TABLE_COLUMN_WIDTHS).toHaveLength(6);
    expect(PROVIDER_TABLE_COLUMN_WIDTHS[1]).toBeNull();
    const total = fixedWidths.reduce((sum, w) => sum + w, 0) + BASE_URL_FLOOR;
    expect(total).toBeLessThanOrEqual(TABLE_SPACE_AT_1440);
    // Below the budget the table scrolls in its container instead of squeezing cells together.
    expect(px(rule('.providerTable')['min-width'])).toBe(total);
    expect(rule('.providerTable')['table-layout']).toBe('fixed');
  });

  test('sticky actions are opaque, divided and never translucent over Status', () => {
    const cell = rule('.providerTable tbody td.actionsCell');
    expect(cell.position).toBe('sticky');
    expect(cell.background).toBe('var(--bg-primary)');
    expect(cell['border-left']).toContain('var(--border-color)');
    expect(rule('.providerTable .actionsHead').background).toContain('var(--bg-primary)');
    expect(rule('.providerTable tbody td.actionsCellSelected').background).toContain(
      'var(--bg-primary)'
    );
    expect(rule('.providerTable tbody tr:hover .actionsCell').background).toContain(
      'var(--bg-primary)'
    );
  });

  test('prefix, base URL and status content truncate inside their own cells', () => {
    for (const selector of ['.chip', '.baseUrl', '.statusText']) {
      const declarations = rule(selector);
      expect(declarations.overflow).toBe('hidden');
      expect(declarations['text-overflow']).toBe('ellipsis');
    }
    expect(rule('.chip')['max-width']).toBe('100%');
    expect(rule('.statusCell')['max-width']).toBe('100%');
  });
});

describe('provider resource rows', () => {
  const claude = claudeToResource(
    { apiKey: 'fixture-private-key', prefix: 'workspace-team-routing-prefix' },
    0
  );
  const gemini = geminiToResource({ apiKey: 'fixture-gemini-secret', excludedModels: ['*'] }, 1);
  const markup = render([claude, gemini]);

  test('each row has one labelled Actions menu trigger naming its resource', () => {
    for (const resource of [claude, gemini]) {
      const name = resource.apiKeyPreview ?? '';
      expect(name).not.toBe('');
      expect(markup).toContain(`aria-label="Actions for ${name}"`);
    }
    expect(markup.match(/aria-haspopup="menu"/g)).toHaveLength(2);
    expect(markup.match(/<span>Actions<\/span>/g)).toHaveLength(2);
    // Closed by default; no icon-only row buttons remain.
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('role="menu"');
    expect(markup).not.toContain('aria-label="View ');
    expect(markup).toContain(`aria-label="Disable ${claude.apiKeyPreview}"`);
    expect(markup).toContain(`aria-label="Enable ${gemini.apiKeyPreview}"`);
  });

  test('the full prefix stays available when it truncates', () => {
    expect(markup).toContain('title="workspace-team-routing-prefix"');
    expect(markup).toContain('>workspace-team-routing-prefix</span>');
  });

  test('the enable switch sits with the status it controls, not in the actions cluster', () => {
    const statusIndex = markup.indexOf('Active');
    const switchIndex = markup.indexOf(`aria-label="Disable ${claude.apiKeyPreview}"`);
    const actionsIndex = markup.indexOf(`aria-label="Actions for ${claude.apiKeyPreview}"`);
    expect(switchIndex).toBeGreaterThan(-1);
    expect(switchIndex).toBeLessThan(statusIndex);
    expect(statusIndex).toBeLessThan(actionsIndex);
  });

  test('never renders raw secrets or translation keys', () => {
    expect(markup).not.toContain('fixture-private-key');
    expect(markup).not.toContain('fixture-gemini-secret');
    expect(markup).not.toContain('redesign.providers.');
  });
});
