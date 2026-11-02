import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TimeSeriesChart } from '@/components/ui/TimeSeriesChart';
import { useNow } from '@/hooks/useNow';
import type { ResolvedTheme } from '@/types';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import { DAY_MS, HOUR_MS, type TimelineMode } from '../quotaTimelineModel';
import { buildAccountSeries } from '../quotaAccountSeries';
import styles from './QuotaOverview.module.scss';

interface QuotaOverviewProps {
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  seriesNumbers?: ReadonlyMap<string, number>;
  resolvedTheme: ResolvedTheme;
  disabled: boolean;
  onRefresh: (entries: QuotaFileEntry[]) => void;
  children: ReactNode;
}

export function QuotaOverview({
  entries,
  quotaFor,
  seriesNumbers = new Map(),
  disabled,
  onRefresh,
  children,
}: QuotaOverviewProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const [accounts, setAccounts] = useState(false);
  const [mode, setMode] = useState<TimelineMode>('weekly');
  const end = now + (mode === 'weekly' ? 7 * DAY_MS : 5 * HOUR_MS);
  const model = buildAccountSeries(entries, quotaFor, mode, now, end, seriesNumbers);
  const measured = model.accounts.filter((account) => account.remaining !== null);
  const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleString(i18n.language, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  const percent = (value: number) =>
    `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value)}%`;
  const resetTimes = model.accounts.flatMap(({ window, quota }) =>
    window?.recovers && !quota?.stale && window.resetAtMs !== null && window.resetAtMs > now
      ? [window.resetAtMs]
      : []
  );
  return (
    <div className={styles.overview}>
      <div className={styles.controls}>
        <div className={styles.viewGroup} role="group" aria-label={t('quota_management.pool_view')}>
          <button type="button" aria-pressed={!accounts} onClick={() => setAccounts(false)}>
            {t('quota_management.pool_remaining')}
          </button>
          <button type="button" aria-pressed={accounts} onClick={() => setAccounts(true)}>
            {t('quota_management.pool_accounts')}
          </button>
        </div>
        <div
          className={styles.viewGroup}
          role="group"
          aria-label={t('quota_management.pool_window')}
        >
          {(['weekly', 'session'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {t(`quota_management.windows_mode_${value}`)}
            </button>
          ))}
        </div>
      </div>
      {!accounts && (
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <h2>{t('redesign.quota.remaining')}</h2>
              <p>{t('redesign.quota.assumption')}</p>
            </div>
            <span>
              {t('quota_management.pool_next_reset')} ·{' '}
              {resetTimes.length
                ? formatTime(Math.min(...resetTimes))
                : t('quota_management.pool_unknown')}
            </span>
          </header>
          <TimeSeriesChart
            id="quota-accounts"
            data={model.data}
            series={model.series.map((series, index) => {
              const account = measured[index];
              return {
                ...series,
                label: `${getTypeLabel(t, account.entry.type)} · ${series.label}${account.quota?.stale ? ` · ${t('redesign.quota.stale')}` : ''}`,
              };
            })}
            xDomain={[now, end]}
            yDomain={[0, 100]}
            dataTable={false}
            evidenceId="quota-accounts-breakdown"
            formatX={formatTime}
            formatY={percent}
            ariaLabel={t('redesign.quota.remaining')}
            emptyText={t('quota_management.pool_no_window')}
            height={300}
            className={styles.chart}
          />
          <details className={styles.notes}>
            <summary>{t('redesign.quota.method')}</summary>
            <p>{t('redesign.quota.evidence')}</p>
          </details>
        </section>
      )}
      <section
        id="quota-accounts-breakdown"
        className={styles.panel}
        aria-labelledby="quota-accounts-breakdown-title"
      >
        <header className={styles.panelHeader}>
          <h2 id="quota-accounts-breakdown-title">{t('redesign.quota.breakdown')}</h2>
          <span>{t('redesign.quota.independent')}</span>
        </header>
        <div className={styles.tableScroll} tabIndex={0}>
          <table className={styles.table}>
            <caption>{t('redesign.quota.breakdown')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('redesign.quota.account')}</th>
                <th scope="col">{t('redesign.quota.remaining')}</th>
                <th scope="col">{t('quota_management.pool_next_reset')}</th>
                <th scope="col">{t('redesign.quota.snapshot')}</th>
                <th scope="col">{t('auth_files.quota_refresh_single')}</th>
              </tr>
            </thead>
            <tbody>
              {model.accounts.map(({ id, label, entry, quota, number, window, remaining }) => (
                <tr key={id}>
                  <th scope="row">
                    <span className={styles.number}>{number}</span> {label}
                    <small>
                      {getTypeLabel(t, entry.type)} · {entry.file.name}
                    </small>
                  </th>
                  <td>
                    {remaining === null ? t('quota_management.pool_unknown') : percent(remaining)}
                    <small>{window ? t(window.label, { defaultValue: window.label }) : null}</small>
                  </td>
                  <td>
                    {window?.resetAtMs
                      ? formatTime(window.resetAtMs)
                      : t('quota_management.pool_unknown')}
                  </td>
                  <td>
                    <span
                      className={
                        quota?.stale || quota?.status === 'error' ? styles.warning : undefined
                      }
                    >
                      {quota?.stale
                        ? t('redesign.quota.stale')
                        : quota?.status === 'error'
                          ? t('redesign.quota.failed')
                          : quota?.refreshing || quota?.status === 'loading'
                            ? t('redesign.quota.checking')
                            : quota?.checkedAt
                              ? formatTime(quota.checkedAt)
                              : t('quota_management.pool_unknown')}
                    </span>
                    {quota?.stale && quota.checkedAt && (
                      <small>{formatTime(quota.checkedAt)}</small>
                    )}
                    {quota?.error && <small>{quota.error}</small>}
                  </td>
                  <td>
                    <button
                      type="button"
                      disabled={disabled || quota?.refreshing || quota?.status === 'loading'}
                      onClick={() => onRefresh([entry])}
                      aria-label={t('redesign.quota.refreshAccount', { name: label })}
                    >
                      ↻
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <details className={styles.details} open={accounts}>
        <summary>{t('quota_management.pool_account_details')}</summary>
        {children}
      </details>
    </div>
  );
}
