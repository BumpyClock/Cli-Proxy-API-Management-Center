import type { ParsedLogLine } from './logTypes';

export const LOG_STRUCTURED_COLUMNS = [
  'status',
  'latency',
  'method',
  'path',
  'client',
  'source',
] as const;
export type LogStructuredColumn = (typeof LOG_STRUCTURED_COLUMNS)[number];

const hasColumnValue = (line: ParsedLogLine, column: LogStructuredColumn): boolean => {
  switch (column) {
    case 'status':
      return typeof line.statusCode === 'number';
    case 'latency':
      return Boolean(line.latency);
    case 'method':
      return Boolean(line.method);
    case 'path':
      return Boolean(line.path);
    case 'client':
      return Boolean(line.ip);
    case 'source':
      return Boolean(line.source);
  }
};

/**
 * Structured columns with a value in at least one loaded line. Decided across the whole loaded
 * set (not the rows on screen) so columns do not appear and vanish while scrolling.
 */
export const resolveStructuredColumns = (lines: readonly ParsedLogLine[]): LogStructuredColumn[] =>
  LOG_STRUCTURED_COLUMNS.filter((column) => lines.some((line) => hasColumnValue(line, column)));

type Track = { track: string; minPx: number };

const STRUCTURED_TRACKS: Record<LogStructuredColumn, Track> = {
  status: { track: '48px', minPx: 48 },
  // Fits the `Latency (ms)` header; values are right-aligned tabular numbers.
  latency: { track: '96px', minPx: 96 },
  method: { track: '64px', minPx: 64 },
  path: { track: 'minmax(160px, 1fr)', minPx: 160 },
  client: { track: '120px', minPx: 120 },
  source: { track: 'minmax(120px, 160px)', minPx: 120 },
};

const MIN_TIMESTAMP_CH = 8;
const MAX_TIMESTAMP_CH = 36;
const LEVEL_CH = 6;
const MESSAGE_MIN_PX = 240;
const COLUMN_GAP_PX = 16;
// 10px padding each side plus the 3px severity border.
const ROW_PADDING_PX = 23;

export type LogGrid = {
  /** Shared `grid-template-columns` for the header and every row, so cells stay aligned. */
  template: string;
  /** Narrowest list width before the panel scrolls horizontally. */
  minWidth: string;
};

/** Monospace columns: CJK and other wide glyphs take two `ch`. */
const displayWidthCh = (text: string): number => {
  let width = 0;
  for (const char of text) width += (char.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1;
  return width;
};

/**
 * Time | Level | visible structured columns | Message. Time width follows the longest displayed
 * stamp; `timeText` returns what the Time cell shows (the raw stamp when omitted).
 */
export const buildLogGrid = (
  columns: readonly LogStructuredColumn[],
  lines: readonly ParsedLogLine[],
  timeText: (line: ParsedLogLine) => string = (line) => line.timestamp ?? ''
): LogGrid => {
  const longestTimestamp = lines.reduce(
    (longest, line) => Math.max(longest, displayWidthCh(timeText(line))),
    0
  );
  const timeCh = Math.min(Math.max(longestTimestamp, MIN_TIMESTAMP_CH), MAX_TIMESTAMP_CH);
  const structured = columns.map((column) => STRUCTURED_TRACKS[column]);
  const template = [
    `${timeCh}ch`,
    `${LEVEL_CH}ch`,
    ...structured.map(({ track }) => track),
    `minmax(${MESSAGE_MIN_PX}px, 2fr)`,
  ].join(' ');
  const fixedPx =
    structured.reduce((sum, { minPx }) => sum + minPx, 0) +
    MESSAGE_MIN_PX +
    (structured.length + 2) * COLUMN_GAP_PX +
    ROW_PADDING_PX;
  return { template, minWidth: `calc(${timeCh + LEVEL_CH}ch + ${fixedPx}px)` };
};
