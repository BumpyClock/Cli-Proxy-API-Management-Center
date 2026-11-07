import type { ParsedLogLine } from './hooks/logTypes';
import type { LogStructuredColumn } from './hooks/logColumns';
import { formatLatencyMs, parseLatencyMs, type LogTimeFormatter } from './hooks/logFormat';
import styles from './LogsPage.module.scss';

const LEVEL_CLASS: Record<NonNullable<ParsedLogLine['level']>, string> = {
  trace: styles.levelTrace,
  debug: styles.levelDebug,
  info: styles.levelInfo,
  warn: styles.levelWarn,
  error: styles.levelError,
  fatal: styles.levelError,
};

const statusClass = (code: number): string => {
  if (code >= 200 && code < 300) return styles.statusSuccess;
  if (code >= 300 && code < 400) return styles.statusInfo;
  if (code >= 400 && code < 500) return styles.statusWarn;
  return styles.statusError;
};

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

function LatencyCell({ latency, locale }: { latency?: string; locale?: string }) {
  if (!latency) return <span className={cx(styles.cell, styles.latency)} />;
  const ms = parseLatencyMs(latency);
  if (ms === null) return <span className={cx(styles.cell, styles.latency)}>{latency}</span>;
  // The desktop header carries the unit; phones hide the header, so the unit shows inline there.
  return (
    <span className={cx(styles.cell, styles.latency)} title={latency}>
      {formatLatencyMs(ms, locale)}
      <span className={styles.latencyUnit}> ms</span>
    </span>
  );
}

function StructuredCell({
  line,
  column,
  locale,
}: {
  line: ParsedLogLine;
  column: LogStructuredColumn;
  locale?: string;
}) {
  switch (column) {
    case 'status':
      return (
        <span
          className={cx(
            styles.cell,
            styles.statusCell,
            typeof line.statusCode === 'number' && statusClass(line.statusCode)
          )}
        >
          {line.statusCode ?? ''}
        </span>
      );
    case 'latency':
      return <LatencyCell latency={line.latency} locale={locale} />;
    case 'method':
      return <span className={cx(styles.cell, styles.methodCell)}>{line.method ?? ''}</span>;
    case 'path':
      return (
        <span className={cx(styles.cell, styles.path)} title={line.path}>
          {line.path ?? ''}
        </span>
      );
    case 'client':
      return <span className={cx(styles.cell, styles.client)}>{line.ip ?? ''}</span>;
    case 'source':
      return (
        <span className={cx(styles.cell, styles.source)} title={line.source}>
          {line.source ?? ''}
        </span>
      );
  }
}

/**
 * One cell per grid track (empty cells keep alignment on desktop; mobile hides them), so the
 * header and every row share the template from `buildLogGrid`.
 */
export function LogRowCells({
  line,
  columns,
  formatTime,
  locale,
}: {
  line: ParsedLogLine;
  columns: readonly LogStructuredColumn[];
  formatTime?: LogTimeFormatter;
  locale?: string;
}) {
  const time = formatTime?.(line.timestamp);
  return (
    <>
      <span className={cx(styles.cell, styles.timestamp)}>
        {time ? (
          <time dateTime={time.iso} title={time.iso}>
            {time.text}
          </time>
        ) : (
          (line.timestamp ?? '')
        )}
      </span>
      <span className={cx(styles.cell, styles.levelCell, line.level && LEVEL_CLASS[line.level])}>
        {line.level ? line.level.toUpperCase() : ''}
      </span>
      {columns.map((column) => (
        <StructuredCell key={column} line={line} column={column} locale={locale} />
      ))}
      <span className={cx(styles.cell, styles.message)}>
        {line.requestId && (
          <span className={styles.requestIdBadge} title={line.requestId}>
            {line.requestId}
          </span>
        )}
        {line.message}
      </span>
    </>
  );
}
