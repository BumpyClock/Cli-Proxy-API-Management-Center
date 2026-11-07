import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { SeriesSwatch } from '@/components/ui/TimeSeriesChart';
import type { SeriesStroke } from '@/components/ui/TimeSeriesChart.model';
import {
  IconAlertTriangle,
  IconInfo,
  IconRefreshCw,
  IconTimer,
  IconX,
} from '@/components/ui/icons';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { GlanceRow, QuotaAccount } from '../quotaAccountSeries';
import { quotaAccountLabel, quotaWindowLabel } from '../quotaChartFormat';
import { QUOTA_PROGRESS_MEDIUM_THRESHOLD } from './QuotaMeter';
import styles from './QuotaGlanceList.module.scss';

/** Row actions on the Quota page. Without them the list is the compact dashboard summary. */
export interface QuotaGlanceControls {
  /** Series hidden in the chart; a row's toggle is pressed while its line is shown. */
  hidden: ReadonlySet<string>;
  onToggle: (seriesId: string) => void;
  canRefresh: (account: QuotaAccount) => boolean;
  onRefresh: (account: QuotaAccount) => void;
}

interface QuotaGlanceListProps {
  id?: string;
  rows: readonly GlanceRow[];
  /** Drawn chart stroke per series id, from resolveSeriesStrokes. Unplotted rows have none. */
  strokes?: ReadonlyMap<string, SeriesStroke>;
  formatTime: (timestamp: number) => string;
  formatPercent: (value: number) => string;
  controls?: QuotaGlanceControls;
  /** 'columns' flows rows into two columns on wide screens. */
  layout?: 'stack' | 'columns';
  className?: string;
}

type StatusTone = 'problem' | 'stale' | 'unknown';

const STATUS_ICONS = {
  low: IconAlertTriangle,
  failed: IconX,
  stale: IconTimer,
  unchecked: IconInfo,
} as const;

const STATUS_TEXT = {
  low: 'redesign.quota.low',
  failed: 'redesign.quota.failed',
  stale: 'redesign.quota.stale',
  unchecked: 'redesign.quota.not_checked',
} as const;

const STATUS_TONE: Record<keyof typeof STATUS_ICONS, StatusTone> = {
  low: 'problem',
  failed: 'problem',
  stale: 'stale',
  unchecked: 'unknown',
};

/**
 * The one per-account list: exact remaining percentage, reset, snapshot state and the
 * stroke each account's line is drawn with. A state that needs attention (low remaining, a
 * failed check, a stale or missing snapshot) is a pill with an icon and words, never colour
 * alone; a healthy row has no pill and a neutral bar. Without `strokes` the rows have no line
 * key, for a list shown without its chart.
 */
export function QuotaGlanceList({
  id,
  rows,
  strokes,
  formatTime,
  formatPercent,
  controls,
  layout = 'stack',
  className,
}: QuotaGlanceListProps) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  return (
    <ul
      id={id}
      className={[styles.list, className].filter(Boolean).join(' ')}
      data-layout={layout}
      aria-label={t('redesign.quota.glance_label')}
    >
      {rows.map(({ account, remaining, resetAtMs, stale }) => {
        const { quota } = account;
        const stroke = strokes?.get(account.id);
        const low = remaining !== null && remaining < QUOTA_PROGRESS_MEDIUM_THRESHOLD;
        const identity = (
          <>
            <span className={styles.number} aria-hidden="true">
              {account.number}
            </span>
            {stroke && (
              <SeriesSwatch
                className={styles.swatch}
                color={stroke.color}
                dash={stroke.dash}
                marker
              />
            )}
            <span className={styles.name}>{account.label}</span>
          </>
        );
        const checking = quota?.refreshing || quota?.status === 'loading';
        const failed = !stale && quota?.status === 'error';
        const snapshotState = failed
          ? 'failed'
          : stale
            ? 'stale'
            : !checking && remaining === null && !quota?.checkedAt
              ? 'unchecked'
              : null;
        const checkLine = checking
          ? t('redesign.quota.checking')
          : !failed && quota?.checkedAt
            ? t('redesign.quota.checked_at', { time: formatTime(quota.checkedAt) })
            : null;
        const pills = [low ? ('low' as const) : null, snapshotState].filter(
          (state): state is keyof typeof STATUS_ICONS => state !== null
        );
        return (
          <li
            key={account.id}
            className={styles.row}
            data-hidden={stroke && !stroke.visible ? 'true' : undefined}
            title={controls ? undefined : quotaAccountLabel(account, t)}
          >
            <div className={styles.head}>
              {controls && stroke ? (
                <button
                  type="button"
                  className={styles.toggle}
                  aria-pressed={!controls.hidden.has(account.id)}
                  aria-label={t('redesign.quota.show_in_chart', {
                    name: `${account.number} · ${quotaAccountLabel(account, t)}`,
                  })}
                  onClick={() => controls.onToggle(account.id)}
                >
                  {identity}
                </button>
              ) : (
                <span className={styles.toggle}>{identity}</span>
              )}
              <span className={styles.value}>
                <strong>
                  {remaining === null
                    ? t('quota_management.pool_unknown')
                    : formatPercent(remaining)}
                </strong>
              </span>
            </div>
            <span className={styles.bar} aria-hidden="true">
              {remaining !== null && (
                <span
                  className={styles.fill}
                  data-tone={low ? 'low' : undefined}
                  style={{ width: `${Math.max(0, Math.min(100, remaining))}%` }}
                />
              )}
            </span>
            <div className={styles.footer}>
              <div className={styles.details}>
                {pills.length > 0 && (
                  <span className={styles.states}>
                    {pills.map((state) => {
                      const Icon = STATUS_ICONS[state];
                      return (
                        <span key={state} className={styles.status} data-state={STATUS_TONE[state]}>
                          <Icon size={13} aria-hidden="true" />
                          {t(STATUS_TEXT[state])}
                        </span>
                      );
                    })}
                  </span>
                )}
                <span className={styles.meta}>
                  {/* A stale snapshot has no reset projection; its pill says why. */}
                  {[
                    getTypeLabel(t, account.entry.type),
                    quotaWindowLabel(account, t),
                    stale
                      ? null
                      : resetAtMs !== null
                        ? t('redesign.quota.resets', { time: formatTime(resetAtMs) })
                        : t('redesign.quota.no_reset'),
                  ]
                    .filter(Boolean)
                    .map((part, index) => (
                      <Fragment key={index}>
                        {index > 0 && ' · '}
                        <span className={styles.part}>{part}</span>
                      </Fragment>
                    ))}
                </span>
                {controls && checkLine && <span className={styles.meta}>{checkLine}</span>}
                {controls && quota?.error && <span className={styles.error}>{quota.error}</span>}
              </div>
              {controls && (
                <button
                  type="button"
                  className={styles.refresh}
                  disabled={!controls.canRefresh(account) || checking}
                  onClick={() => controls.onRefresh(account)}
                  aria-label={t('redesign.quota.refreshAccount', { name: account.label })}
                >
                  <IconRefreshCw size={15} aria-hidden="true" />
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
