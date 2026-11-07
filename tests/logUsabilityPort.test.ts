import { describe, expect, test } from 'bun:test';
import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { LogsOptions } from '@/pages/LogsPage';
import { shouldExitLogFullscreen } from '@/pages/hooks/logFullscreen';
import { buildLogPathOptions, normalizeLogPathFilters } from '@/pages/hooks/useLogFilters';
import { parseLogLine } from '@/pages/hooks/logParsing';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();
await i18n.changeLanguage('en');
i18n.addResource('en', 'translation', 'logs.wrap_lines', 'Wrap long lines');

const line = (path: string) => parseLogLine(`2026-11-07T12:00:00Z INFO GET ${path} status=200`);

describe('persistent log path selections', () => {
  test('a selected path remains removable when a search leaves no matching records', () => {
    expect(buildLogPathOptions([], ['/v1/messages'])).toEqual([{ path: '/v1/messages', count: 0 }]);
  });

  test('a selected path outside the twelve most common paths keeps its actual count', () => {
    const popular = Array.from({ length: 12 }, (_, index) => `/popular-${index}`);
    const parsed = [...popular.flatMap((path) => [line(path), line(path)]), line('/selected')];
    const options = buildLogPathOptions(parsed, ['/selected']);
    expect(options).toHaveLength(13);
    expect(options.at(-1)).toEqual({ path: '/selected', count: 1 });
    expect(buildLogPathOptions(parsed, [])).toHaveLength(12);
  });

  test('a selected popular path appears once', () => {
    expect(buildLogPathOptions([line('/v1/messages')], ['/v1/messages'])).toEqual([
      { path: '/v1/messages', count: 1 },
    ]);
  });

  test('legacy quoted selections match the unquoted parsed path and deduplicate', () => {
    expect(normalizeLogPathFilters(['"/v1/messages"', '/v1/messages', '/v1/models'])).toEqual([
      '/v1/messages',
      '/v1/models',
    ]);
  });
});

describe('nested Escape priority in fullscreen logs', () => {
  test('a handled Escape leaves fullscreen active', () => {
    expect(shouldExitLogFullscreen({ key: 'Escape', defaultPrevented: true }, false)).toBe(false);
    expect(shouldExitLogFullscreen({ key: 'Escape', defaultPrevented: false }, false)).toBe(true);
  });

  test('an open modal retains priority and unrelated keys never exit', () => {
    expect(shouldExitLogFullscreen({ key: 'Escape', defaultPrevented: false }, true)).toBe(false);
    expect(shouldExitLogFullscreen({ key: 'Enter', defaultPrevented: false }, false)).toBe(false);
  });
});

describe('log wrapping display control', () => {
  test('Options exposes a named wrapping switch and includes it in changed settings', () => {
    const noop = () => {};
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(LogsOptions, {
          open: true,
          onOpenChange: noop,
          triggerRef: createRef<HTMLButtonElement>(),
          display: { hideManagementLogs: true, showRawLogs: false, wrapLogs: true },
          onHideManagementLogsChange: noop,
          onShowRawLogsChange: noop,
          onWrapLogsChange: noop,
          fullscreen: false,
          downloadDisabled: false,
          clearDisabled: false,
          onDownload: noop,
          onEnterFullscreen: noop,
          onClear: noop,
        })
      )
    );
    expect(markup).toContain('Wrap long lines');
    expect(markup.match(/role="switch"/g)).toHaveLength(3);
    expect(markup).toContain('1 setting changed');
  });
});
