import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileString } from 'sass';
import { buildLogGrid, resolveStructuredColumns } from '../src/pages/hooks/logColumns';
import { parseLogLine } from '../src/pages/hooks/logParsing';

mock.module('../src/pages/LogsPage.module.scss', () => ({
  default: new Proxy({}, { get: (_, key) => String(key) }),
}));

const { LogRowCells } = await import('../src/pages/LogRowCells');

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const FIXTURE_LINES = [
  '2026-10-20T09:42:10Z INFO Management API ready',
  '2026-10-20T09:42:12Z INFO Provider pool synchronized',
  '2026-10-20T09:42:18Z INFO Request completed model=claude-sonnet-4-5 status=200 duration=842ms',
].map((line) => parseLogLine(line));

const ACCESS_LINE = parseLogLine(
  '[2025-01-02 03:04:05] [a1b2c3d4] [info ] [gin_logger.go:94] 200 |  1.2ms | 127.0.0.1 | GET "/v1/models"'
);

describe('column collapse', () => {
  test('plain lines fall back to Time | Level | Message', () => {
    const plain = FIXTURE_LINES.slice(0, 2);
    expect(resolveStructuredColumns(plain)).toEqual([]);
    expect(buildLogGrid([], plain).template).toBe('20ch 6ch minmax(240px, 2fr)');
  });

  test('a column shows when any loaded line has a value, even if others are empty', () => {
    expect(resolveStructuredColumns(FIXTURE_LINES)).toEqual(['status', 'latency']);
    expect(resolveStructuredColumns([...FIXTURE_LINES, ACCESS_LINE])).toEqual([
      'status',
      'latency',
      'method',
      'path',
      'client',
      'source',
    ]);
  });

  test('every row and the header share one template whose width tracks the longest stamp', () => {
    const grid = buildLogGrid(['status', 'latency'], FIXTURE_LINES);
    expect(grid.template).toBe('20ch 6ch 48px 96px minmax(240px, 2fr)');
    expect(grid.minWidth).toBe('calc(26ch + 471px)');
    const long = parseLogLine('2025-01-02T03:04:05.123456789+08:00 INFO x');
    expect(buildLogGrid([], [long]).template.startsWith('35ch ')).toBe(true);
  });

  test('page decides columns before structured filters so chips never reshape the table', () => {
    const page = readSource('src/pages/LogsPage.tsx');
    expect(page).toContain('resolveStructuredColumns(parsedSearchLines)');
    expect(page).toMatch(/buildLogGrid\(\s*structuredColumns,\s*parsedSearchLines,/);
    expect(page).not.toMatch(
      /resolveStructuredColumns\((?:filteredParsedLines|parsedVisibleLines)/
    );
  });
});

describe('row cells', () => {
  test('renders one cell per track with the message last and no duplicated level', () => {
    const html = renderToStaticMarkup(
      createElement(LogRowCells, { line: FIXTURE_LINES[2], columns: ['status', 'latency'] })
    );
    const cells = [...html.matchAll(/<span class="cell ([^"]*)"[^>]*>([^<]*)<\/span>/g)].map(
      ([, className, text]) => [className.split(' ')[0], text]
    );
    expect(cells).toEqual([
      ['timestamp', '2026-10-20T09:42:18Z'],
      ['levelCell', 'INFO'],
      ['statusCell', '200'],
      ['message', 'Request completed model=claude-sonnet-4-5 status=200 duration=842ms'],
    ]);
    // Latency is a number under the `Latency (ms)` header; the unit span shows only on phones.
    expect(html).toContain(
      '<span class="cell latency" title="842ms">842<span class="latencyUnit"> ms</span></span>'
    );
  });

  test('empty structured values render empty cells so desktop alignment holds', () => {
    const html = renderToStaticMarkup(
      createElement(LogRowCells, { line: FIXTURE_LINES[0], columns: ['status', 'latency'] })
    );
    expect(html).toContain('<span class="cell statusCell"></span>');
    expect(html).toContain('<span class="cell latency"></span>');
    expect(html).not.toContain('Z INFO');
  });

  test('request id sits inside the message cell', () => {
    const html = renderToStaticMarkup(
      createElement(LogRowCells, {
        line: ACCESS_LINE,
        columns: resolveStructuredColumns([ACCESS_LINE]),
      })
    );
    expect(html).toMatch(/class="cell message"><span class="requestIdBadge"[^>]*>a1b2c3d4<\/span>/);
  });
});

describe('mobile layout', () => {
  const css = compileString(
    `@use 'src/styles/variables' as *;\n${readSource('src/pages/LogsPage.module.scss')}`,
    {
      url: new URL('../src/pages/LogsPage.module.scss', import.meta.url),
      loadPaths: [process.cwd()],
    }
  ).css;
  const mobile = [...css.matchAll(/@media \(max-width: 768px\) \{([\s\S]*?)\n\}/g)]
    .map(([, body]) => body)
    .join('\n');

  test('rows stack without horizontal scrolling and the header is hidden', () => {
    expect(mobile).toMatch(/\.logList \{\s*min-width: 0;/);
    expect(mobile).toMatch(/\.columnHeader \{\s*display: none;/);
    expect(mobile).toMatch(/\.logRow \{\s*display: flex;\s*flex-wrap: wrap;/);
    expect(mobile).toMatch(/\.message \{\s*order: 1;\s*flex: 1 1 100%;/);
    expect(mobile).toMatch(/\.cell:empty \{\s*display: none;/);
  });

  test('action labels stay visible on phones instead of collapsing to icons', () => {
    expect(css).not.toContain('.actionLabel');
    expect(mobile).not.toMatch(/\.actionButton \{[^}]*(?:clip|display: none)/);
  });
});

describe('toolbar structure', () => {
  const page = readSource('src/pages/LogsPage.tsx');

  test('display switches and actions are labelled groups', () => {
    expect(page).toMatch(/role="group"\s+aria-label=\{t\('logs\.display_options_group'\)\}/);
    expect(page).toMatch(/role="group" aria-label=\{t\('logs\.actions_group'\)\}/);
  });

  test('refresh and auto refresh are the page-level header pair on the log tab', () => {
    const pair = page.slice(
      page.indexOf('const refreshControls = ('),
      page.indexOf('const handleTabKeyDown')
    );
    expect(pair).toContain('<RefreshButton');
    expect(pair).toContain("label={t('logs.refresh_button')}");
    expect(pair).toContain('<ToggleSwitch');
    expect(pair).toContain('checked={autoRefresh}');
    expect(page).toMatch(/activeTab === 'logs' \? \(\s*refreshControls/);
  });

  test('clear is routed through the confirmation dialog', () => {
    expect(page).toContain('onClear={clearLogs}');
    expect(page).toContain("variant: 'danger',");
  });

  test('structured filters use an ARIA disclosure tied to its panel', () => {
    expect(page).toContain('aria-expanded={structuredFiltersExpanded}');
    expect(page).toContain('aria-controls={structuredFiltersPanelId}');
    expect(page).toContain('id={structuredFiltersPanelId}');
    expect(page).toContain('hidden={!structuredFiltersExpanded}');
  });
});
