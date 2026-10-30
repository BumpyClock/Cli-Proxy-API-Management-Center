import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CredentialRow } from '../types';
import type { UsageSourceData } from '../hooks/useDashboardOverview';
import { formatClock } from '../logic/time';
import { summarizeUsage } from '../logic/usage';
import { providerLabel } from '../utils';
import { formatLatency } from './formatters';
import styles from './UsagePanel.module.scss';

interface UsagePanelProps {
  usage: UsageSourceData | null;
  /** Server-clock start of the traffic window. */
  windowStartMs: number;
  windowLabel: string;
  credentialsByIndex: Map<string, CredentialRow>;
}

/** Per-model volume and latency plus the newest failed requests. */
export function UsagePanel({
  usage,
  windowStartMs,
  windowLabel,
  credentialsByIndex,
}: UsagePanelProps) {
  const { t, i18n } = useTranslation();
  const summary = useMemo(
    () => (usage?.enabled ? summarizeUsage(usage.usage, windowStartMs) : null),
    [usage, windowStartMs]
  );

  if (!usage) {
    return <p className={styles.note}>{t('dashboard.usage_loading')}</p>;
  }

  if (usage.enabled === null) {
    return (
      <div className={styles.off}>
        <p className={styles.offTitle}>{t('dashboard.usage_unsupported')}</p>
        <p className={styles.note}>{t('dashboard.usage_unsupported_detail')}</p>
      </div>
    );
  }

  if (!usage.enabled || !summary) {
    return (
      <div className={styles.off}>
        <p className={styles.offTitle}>{t('dashboard.usage_off')}</p>
        <p className={styles.note}>{t('dashboard.usage_off_detail')}</p>
        <Link className={styles.moreLink} to="/config?field=usageStatisticsEnabled">
          {t('dashboard.usage_off_action')} <span aria-hidden="true">→</span>
        </Link>
      </div>
    );
  }

  if (summary.requests === 0) {
    return (
      <div className={styles.off}>
        <p className={styles.note}>{t('dashboard.usage_empty', { window: windowLabel })}</p>
        <Link className={styles.moreLink} to="/usage">
          {t('dashboard.usage_link')} <span aria-hidden="true">→</span>
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.body}>
      <table className={styles.table}>
        <caption className={styles.caption}>
          {t('dashboard.usage_caption', { window: windowLabel })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t('dashboard.usage_col_model')}</th>
            <th scope="col">{t('dashboard.usage_col_requests')}</th>
            <th scope="col">{t('dashboard.usage_col_failed')}</th>
            <th scope="col">p50</th>
            <th scope="col">p95</th>
          </tr>
        </thead>
        <tbody>
          {summary.models.map((row) => (
            <tr key={row.model}>
              <th scope="row" className={styles.model} title={row.model}>
                {row.model}
              </th>
              <td title={row.truncated ? t('dashboard.usage_truncated_hint') : undefined}>
                {row.truncated
                  ? `${row.requests.toLocaleString()}+`
                  : row.requests.toLocaleString()}
              </td>
              <td className={row.failed > 0 ? styles.failed : undefined}>
                {row.failed.toLocaleString()}
              </td>
              <td>{formatLatency(row.p50)}</td>
              <td>{formatLatency(row.p95)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.failures}>
        <h3 className={styles.subTitle}>{t('dashboard.usage_recent_failures')}</h3>
        {summary.failures.length === 0 ? (
          <p className={styles.note}>{t('dashboard.usage_no_failures', { window: windowLabel })}</p>
        ) : (
          <ul className={styles.failureList}>
            {summary.failures.map((failure, index) => {
              const credential = failure.authIndex
                ? credentialsByIndex.get(failure.authIndex)
                : null;
              const who = credential
                ? `${providerLabel(credential.providerId, t('dashboard.provider_unknown'))} · ${
                    credential.identity.primary || credential.name
                  }`
                : null;
              return (
                <li key={`${failure.timeMs}:${failure.model}:${index}`} className={styles.failure}>
                  <span className={styles.failureTime}>
                    {formatClock(failure.timeMs, i18n.language)}
                  </span>
                  <span className={styles.failureModel}>{failure.model}</span>
                  {who && <span className={styles.failureWho}>{who}</span>}
                  <span className={styles.failureLatency}>{formatLatency(failure.latencyMs)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {summary.coverageStartMs !== null && (
        <p className={styles.note}>
          {t('dashboard.usage_coverage', {
            time: formatClock(summary.coverageStartMs, i18n.language),
          })}
        </p>
      )}

      <Link className={styles.moreLink} to="/usage">
        {t('dashboard.usage_link')} <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
