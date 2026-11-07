import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileString } from 'sass';
import { buildLogGrid } from '../src/pages/hooks/logColumns';
import {
  createLogTimeFormatter,
  formatLatencyMs,
  parseLatencyMs,
} from '../src/pages/hooks/logFormat';
import { parseLogLine } from '../src/pages/hooks/logParsing';
import en from '../src/i18n/locales/en.json';
import zhCN from '../src/i18n/locales/zh-CN.json';
import zhTW from '../src/i18n/locales/zh-TW.json';
import ru from '../src/i18n/locales/ru.json';

mock.module('../src/pages/LogsPage.module.scss', () => ({
  default: new Proxy({}, { get: (_, key) => String(key) }),
}));

const { LogRowCells } = await import('../src/pages/LogRowCells');

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const page = readSource('src/pages/LogsPage.tsx');
const css = compileString(
  `@use 'src/styles/variables' as *;\n${readSource('src/pages/LogsPage.module.scss')}`,
  { url: new URL('../src/pages/LogsPage.module.scss', import.meta.url), loadPaths: [process.cwd()] }
).css;
const mobile = [...css.matchAll(/@media \(max-width: 768px\) \{([\s\S]*?)\n\}/g)]
  .map(([, body]) => body)
  .join('\n');

const REQUEST_LINE = parseLogLine(
  '2026-10-20T09:42:18Z INFO Request completed model=claude-sonnet-4-5 status=200 duration=842ms'
);

describe('latency column', () => {
  test('parses Go durations to milliseconds and rejects anything else', () => {
    expect(parseLatencyMs('842ms')).toBe(842);
    expect(parseLatencyMs('1.5s')).toBe(1500);
    expect(parseLatencyMs('1m2.5s')).toBe(62500);
    expect(parseLatencyMs('250µs')).toBeCloseTo(0.25);
    expect(parseLatencyMs('12x')).toBeNull();
    expect(parseLatencyMs(undefined)).toBeNull();
  });

  test('formats tabular numbers with precision that shrinks as values grow', () => {
    expect(formatLatencyMs(0.25, 'en')).toBe('0.25');
    expect(formatLatencyMs(12.34, 'en')).toBe('12.3');
    expect(formatLatencyMs(12345.6, 'en')).toBe('12,346');
  });

  test('cell shows the number, keeps the original duration on hover, and a phone-only unit', () => {
    const html = renderToStaticMarkup(
      createElement(LogRowCells, { line: REQUEST_LINE, columns: ['status', 'latency'] })
    );
    expect(html).toContain(
      '<span class="cell latency" title="842ms">842<span class="latencyUnit"> ms</span></span>'
    );
    expect(css).toMatch(/\.latencyUnit \{\s*display: none;/);
    expect(mobile).toMatch(/\.latencyUnit \{\s*display: inline;/);
  });

  test('header names the unit in every locale and sits in a fixed right-aligned track', () => {
    for (const locale of [en, zhCN, zhTW, ru]) {
      expect(locale.redesign.settings.logColumns.latency).toMatch(/ms|мс/);
    }
    expect(buildLogGrid(['latency'], [REQUEST_LINE]).template).toContain(' 96px ');
    expect(css).toMatch(/\.latency \{\s*justify-self: end;\s*text-align: right;/);
    // 16px between every column so latency never reads as part of the message.
    expect(css).toMatch(/\.logRow,\s*\.columnHeader \{[^}]*gap: 4px 16px;/);
  });
});

describe('structured time', () => {
  test('shows a short human time and keeps the exact instant', () => {
    const format = createLogTimeFormatter('en', new Date('2026-11-06T00:00:00Z'));
    const time = format('2026-10-20T09:42:18Z');
    expect(time?.iso).toBe('2026-10-20T09:42:18.000Z');
    expect(time?.text).toMatch(/^Oct 2[01]\D+\d{2}:42:18$/);
    expect(format('2025-01-02T03:04:05Z')?.text).toContain('2025');
    expect(format('not a time')).toBeNull();
    expect(format(undefined)).toBeNull();
  });

  test('time cell renders <time dateTime> with the ISO title; without a formatter it is raw', () => {
    const format = createLogTimeFormatter('en', new Date('2026-11-06T00:00:00Z'));
    const html = renderToStaticMarkup(
      createElement(LogRowCells, { line: REQUEST_LINE, columns: [], formatTime: format })
    );
    expect(html).toMatch(
      /<time dateTime="2026-10-20T09:42:18.000Z" title="2026-10-20T09:42:18.000Z">Oct 2[01]\D/
    );
    const raw = renderToStaticMarkup(
      createElement(LogRowCells, { line: REQUEST_LINE, columns: [] })
    );
    expect(raw).toContain('2026-10-20T09:42:18Z');
  });

  test('time column width follows the displayed text, counting wide glyphs twice', () => {
    const grid = buildLogGrid([], [REQUEST_LINE], () => '10月20日 09:42:18');
    expect(grid.template.startsWith('17ch ')).toBe(true);
  });

  test('raw view still renders the unmodified buffer', () => {
    expect(page).toContain('{rawVisibleText}');
    expect(page).toContain("filteredLines.join('\\n')");
  });
});

describe('toolbar', () => {
  test('structured filters is a shared secondary button with a visible active count', () => {
    expect(page).toMatch(/<Button\s+variant="secondary"\s+className=\{styles\.filterPanelToggle\}/);
    expect(page).toContain('{structuredFilterCount}');
    expect(page).toContain("t('logs.filter_panel_active_count', { count: structuredFilterCount })");
    expect(css).not.toMatch(/\.filterPanelToggle \{[^}]*color: var\(--text-secondary\)/);
  });

  test('clear always confirms and names its scope', () => {
    expect(page).not.toMatch(/variant="danger"\s/);
    expect(page).toContain("title: t('logs.clear_confirm_title')");
    expect(page).toContain("confirmText: t('logs.clear_button')");
    for (const locale of [en, zhCN, zhTW, ru]) {
      expect(locale.logs.clear_confirm).toContain('main.log');
      expect(locale.logs.clear_confirm_title.length).toBeGreaterThan(0);
    }
  });

  test('routine actions keep short visible labels at every width', () => {
    expect(en.logs.download_button).toBe('Download');
    expect(en.logs.clear_button).toBe('Clear logs');
    expect(en.logs.fullscreen_button).toBe('Full screen');
    expect(css).not.toContain('actionLabel');
    expect(page).not.toMatch(/size="sm"[\s\S]{0,60}(?:downloadLogs|clearLogs|setFullscreenLogs)/);
  });

  test('search uses a short placeholder and keeps a descriptive accessible name', () => {
    expect(en.logs.search_placeholder).toBe('Search logs');
    expect(en.logs.search_label).toBe('Search logs by content or keyword');
    expect(page).toContain("placeholder={t('logs.search_placeholder')}");
    expect(page).toContain("aria-label={t('logs.search_label')}");
  });

  test('switch rows in Options and the header pair get a 44px hit row on phones and touch', () => {
    for (const selector of ['\\.optionsSection > label', '\\.refreshGroup > label']) {
      expect(css).toMatch(
        new RegExp(
          `@media \\(max-width: 768px\\), \\(pointer: coarse\\) \\{\\s*${selector} \\{\\s*min-height: 44px;`
        )
      );
    }
  });
});
