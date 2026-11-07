import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { compileString } from 'sass';
import en from '@/i18n/locales/en.json';
import { productionLocales } from './helpers/locales';

const systemPage = readFileSync('src/pages/SystemPage.tsx', 'utf8');
const css = compileString(
  `@use 'src/styles/variables' as *;\n${readFileSync('src/pages/SystemPage.module.scss', 'utf8')}`,
  { loadPaths: [process.cwd()], url: pathToFileURL('src/pages/SystemPage.module.scss') }
).css;

describe('round 2 system page', () => {
  test('connection URL shows once, in the status row, not as page metadata', () => {
    expect(systemPage).not.toMatch(/meta=\{auth\.apiBase/);
    expect(systemPage.match(/\{auth\.apiBase \|\| '-'\}/g)).toHaveLength(1);
  });

  test('actions use the standard secondary button, not the small variant', () => {
    expect(systemPage).not.toMatch(/variant="secondary"\s+size="sm"/);
    expect(systemPage).toMatch(
      /<Button\s+variant="secondary"\s+onClick=\{\(\) => void handleVersionCheck\(\)\}/
    );
  });

  test('build time is human text with the exact instant on a <time> element', () => {
    expect(systemPage).toContain('const buildTimeIso = isoTitle(auth.serverBuildDate);');
    expect(systemPage).toContain('<time dateTime={buildTimeIso} title={buildTimeIso}>');
  });

  test('model groups use the shared disclosure affordance as a full-width row', () => {
    const summary = systemPage.slice(
      systemPage.indexOf('<summary'),
      systemPage.indexOf('</summary>')
    );
    // The chevron is the disclosure mixin's ::before, so the row holds icon, label, count.
    expect(summary).not.toContain('IconChevronRight');
    const order = ['groupIconSlot', 'groupLabel', 'groupCount'].map((name) =>
      summary.indexOf(`styles.${name}`)
    );
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const scss = readFileSync('src/pages/SystemPage.module.scss', 'utf8');
    expect(scss).toMatch(/\.groupSummary \{\s*@include disclosure-summary;/);
    expect(css).toMatch(/\.groupSummary::before \{[^}]*transform: rotate\(-45deg\);/);
    expect(css).toMatch(
      /\.groupSummary:is\(\[open\] > \*\)::before \{\s*transform: rotate\(45deg\);/
    );
    expect(css).toMatch(
      /\.groupSummary:focus-visible \{\s*outline: 2px solid var\(--focus-ring\);/
    );
    // The full-width override comes after the mixin, and the touch target is re-asserted after it.
    const rowAt = css.search(/\.groupSummary \{[^}]*display: flex;[^}]*min-height: 40px;/);
    const touchAfterRow = css
      .slice(rowAt)
      .search(/\(pointer: coarse\) \{\s*\.groupSummary \{\s*min-height: 44px;/);
    expect(rowAt).toBeGreaterThan(0);
    expect(touchAfterRow).toBeGreaterThan(0);
    expect(css).toMatch(/\.container :focus-visible \{\s*outline: 2px solid var\(--focus-ring\);/);
  });

  test('the request logging control says it opens a dialog to configure the setting', () => {
    expect(systemPage).toMatch(
      /<Button variant="secondary" onClick=\{openRequestLogModal\} aria-haspopup="dialog">\s*\{t\('system_info\.request_log_open'\)\}/
    );
    expect(en.system_info.request_log_open).toBe('Configure request logging…');
    for (const [locale, messages] of Object.entries(productionLocales)) {
      expect(messages.system_info.request_log_open, locale).toMatch(/…$/);
    }
  });
});
