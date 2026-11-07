import { useTranslation } from 'react-i18next';
import { IconCheckCircle2, IconInfo, IconLoader2 } from '@/components/ui/icons';
import { resolveTimeZoneLabel } from '@/utils/time/timezone';
import type { HealthStatus } from '../logic/healthStatus';
import { formatInstant } from '../logic/time';
import styles from './HealthStatusRow.module.scss';
import { iconSize } from '@/design-system';

type RowStatus = Exclude<HealthStatus, { kind: 'attention' } | { kind: 'setup' }>;

interface HealthStatusRowProps {
  status: RowStatus;
  /** The Requests window, e.g. "3h 20m". */
  windowLabel: string;
  now: number;
}

const LEAD_KEYS = {
  clear: 'dashboard.hero_verdict_good',
  idle: 'dashboard.hero_verdict_idle',
  idle_other_scope: 'dashboard.hero_verdict_idle_other_scope',
} as const;

/**
 * One line that answers "is anything wrong?" when the attention panel has nothing to list.
 * It names only what was checked (credential files and providers) and when; it never
 * claims health while the primary sources are still loading. An idle window is
 * information, not success: it gets the info icon, never the check.
 */
export function HealthStatusRow({ status, windowLabel, now }: HealthStatusRowProps) {
  const { t, i18n } = useTranslation();

  if (status.kind === 'checking') {
    return (
      <section className={styles.row} aria-labelledby="dashboard-status-title">
        <span className={`${styles.icon} ${styles.icon_checking}`} aria-hidden="true">
          <IconLoader2 size={iconSize['18']} />
        </span>
        <div className={styles.copy}>
          <h2 id="dashboard-status-title" className={styles.lead}>
            {t('dashboard.attention_checking')}
          </h2>
        </div>
      </section>
    );
  }

  const clear = status.kind === 'clear';
  const checked = t('dashboard.status_checked_at', {
    credentials: t('dashboard.status_credential_files', { count: status.credentials }),
    providers: t('dashboard.attention_none_providers', { count: status.providers }),
    time: `${formatInstant(status.checkedAt, now, i18n.language)} ${resolveTimeZoneLabel(
      new Date(status.checkedAt)
    )}`,
  });
  const details = clear ? checked : `${t('dashboard.status_no_credential_problems')} · ${checked}`;

  return (
    <section className={styles.row} aria-labelledby="dashboard-status-title">
      <span
        className={`${styles.icon} ${clear ? styles.icon_clear : styles.icon_idle}`}
        aria-hidden="true"
      >
        {clear ? <IconCheckCircle2 size={iconSize['18']} /> : <IconInfo size={iconSize['18']} />}
      </span>
      <div className={styles.copy}>
        <h2 id="dashboard-status-title" className={styles.lead}>
          {t(LEAD_KEYS[status.kind], { window: windowLabel })}
        </h2>
        <p className={styles.detail}>{details}</p>
      </div>
    </section>
  );
}
