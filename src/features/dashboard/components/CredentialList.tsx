import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { buildAuthFilesHref } from '@/features/authFiles/deepLink';
import type { CredentialHealth, CredentialRow, CredentialState } from '../types';
import { providerLabel } from '../utils';
import { redactSecrets } from '../logic/redact';
import { credentialRecoveryLines } from './formatters';
import { StatusText, type StatusTone } from './StatusText';
import styles from './CredentialList.module.scss';

const DEFAULT_LIMIT = 8;

/** Problems get a status word; serving and disabled read as plain text. */
const STATE_TONE: Partial<Record<CredentialState, StatusTone>> = {
  unavailable: 'critical',
  error: 'critical',
  warning: 'warning',
  cooling: 'warning',
};

interface CredentialListProps {
  credentials: CredentialHealth | null;
  /** Load state of the credentials source, to tell loading, failed, and empty apart. */
  loadError: string | null;
  now: number;
  onRetry: () => void;
  retrying: boolean;
  limit?: number;
}

function CredentialDetail({ row, now }: { row: CredentialRow; now: number }) {
  const { t, i18n } = useTranslation();
  const lines = credentialRecoveryLines(t, row, now, i18n.language);
  if (!row.reason && lines.length === 0) return null;
  return (
    <span className={styles.detail}>
      {row.reason && <span className={styles.reason}>{row.reason}</span>}
      {lines.map((line) => (
        <span key={line} className={styles.detailMeta}>
          {line}
        </span>
      ))}
    </span>
  );
}

/** Every credential with its state, reason, recovery time, and window traffic. */
export function CredentialList({
  credentials,
  loadError,
  now,
  onRetry,
  retrying,
  limit = DEFAULT_LIMIT,
}: CredentialListProps) {
  const { t } = useTranslation();

  if (!credentials) {
    if (loadError) {
      return (
        <div className={styles.loadError} role="alert">
          <p className={styles.loadErrorTitle}>{t('dashboard.credentials_load_failed')}</p>
          <p className={styles.loadErrorDetail}>{redactSecrets(loadError)}</p>
          <button type="button" className={styles.retry} onClick={onRetry} disabled={retrying}>
            {retrying ? t('dashboard.refreshing') : t('dashboard.action_retry')}
          </button>
        </div>
      );
    }
    return <p className={styles.empty}>{t('dashboard.health_loading')}</p>;
  }
  if (credentials.total === 0) {
    return (
      <div className={styles.emptyBlock}>
        <p className={styles.empty}>{t('dashboard.health_empty')}</p>
        <Link className={styles.footerLink} to="/oauth">
          {t('dashboard.action_add_oauth')} <span aria-hidden="true">→</span>
        </Link>
      </div>
    );
  }

  const rows = credentials.rows.slice(0, limit);
  const segments = [
    { key: 'serving', value: credentials.serving, className: styles.segmentServing },
    { key: 'problems', value: credentials.problems, className: styles.segmentProblem },
    { key: 'disabled', value: credentials.disabled, className: styles.segmentDisabled },
  ];

  return (
    <div className={styles.wrapper}>
      <div className={styles.summary}>
        <div className={styles.bar} aria-hidden="true">
          {segments
            .filter((segment) => segment.value > 0)
            .map((segment) => (
              <span
                key={segment.key}
                className={`${styles.segment} ${segment.className}`}
                style={{ flexGrow: segment.value }}
              />
            ))}
        </div>
        <ul className={styles.legend}>
          <li>
            <i className={`${styles.legendKey} ${styles.segmentServing}`} aria-hidden="true" />
            {t('dashboard.health_serving')}
            <b>{credentials.serving.toLocaleString()}</b>
          </li>
          <li>
            <i className={`${styles.legendKey} ${styles.segmentProblem}`} aria-hidden="true" />
            {t('dashboard.health_problems')}
            <b>{credentials.problems.toLocaleString()}</b>
          </li>
          <li>
            <i className={`${styles.legendKey} ${styles.segmentDisabled}`} aria-hidden="true" />
            {t('dashboard.health_disabled')}
            <b>{credentials.disabled.toLocaleString()}</b>
          </li>
        </ul>
      </div>

      <ul className={styles.list}>
        {rows.map((row) => (
          <li
            key={`${row.name}:${row.identity.primary}`}
            className={[
              styles.row,
              STATE_TONE[row.state] ? styles[`row_${STATE_TONE[row.state]}`] : '',
              row.state === 'disabled' ? styles.rowDisabled : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className={styles.identity}>
              <span className={styles.provider}>
                {providerLabel(row.providerId, t('dashboard.provider_unknown'))}
              </span>
              <Link
                className={[styles.name, row.identity.kind === 'fileName' ? styles.mono : '']
                  .filter(Boolean)
                  .join(' ')}
                to={buildAuthFilesHref({ provider: row.providerId, search: row.name })}
                title={row.identity.fullName}
              >
                {row.identity.primary || row.name}
              </Link>
            </div>
            <div className={styles.state}>
              {STATE_TONE[row.state] ? (
                <StatusText tone={STATE_TONE[row.state] as StatusTone}>
                  {t(`dashboard.credential_state_${row.state}`)}
                </StatusText>
              ) : (
                <span
                  className={[
                    styles.plainState,
                    row.state === 'disabled' ? styles.disabledState : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {t(`dashboard.credential_state_${row.state}`)}
                </span>
              )}
              <CredentialDetail row={row} now={now} />
            </div>
            <span className={styles.window}>
              <span aria-hidden="true" className={styles.chevron}>
                ›
              </span>
              {row.window.total === 0
                ? t('dashboard.credential_window_idle')
                : t('dashboard.credential_window', {
                    success: row.window.success.toLocaleString(),
                    failed: row.window.failed.toLocaleString(),
                  })}
            </span>
          </li>
        ))}
      </ul>

      <Link className={styles.footerLink} to={buildAuthFilesHref({ status: 'all' })}>
        {credentials.total > rows.length
          ? t('dashboard.health_view_all', { count: credentials.total })
          : t('dashboard.health_link')}{' '}
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
