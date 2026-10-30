import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatPercent } from '@/utils/format';
import type { ProviderHealth, ProviderStatus } from '../types';
import { providerHref } from '../logic/links';
import { providerLabel } from '../utils';
import { Meter } from './Meter';
import { Sparkline } from './Sparkline';
import { StatusChip, type ChipTone } from './StatusPills';
import styles from './ProviderHealthList.module.scss';

const DASH = '—';

const STATUS_TONE: Record<ProviderStatus, ChipTone> = {
  down: 'critical',
  degraded: 'warning',
  healthy: 'good',
  idle: 'idle',
};

interface ProviderHealthListProps {
  providers: ProviderHealth[];
}

/** One row per provider, worst first, with window traffic and credential health. */
export function ProviderHealthList({ providers }: ProviderHealthListProps) {
  const { t } = useTranslation();
  const unknownLabel = t('dashboard.provider_unknown');

  if (providers.length === 0) {
    return <p className={styles.empty}>{t('dashboard.fleet_empty')}</p>;
  }

  return (
    <ul className={styles.list}>
      {providers.map((provider) => {
        const name = providerLabel(provider.id, unknownLabel);
        const enabled = provider.credentials.total - provider.credentials.disabled;
        const meta = [
          enabled > 0
            ? t('dashboard.fleet_credentials_serving', {
                serving: provider.credentials.serving,
                total: enabled,
              })
            : null,
          provider.credentials.disabled > 0
            ? t('dashboard.fleet_credentials_disabled', { count: provider.credentials.disabled })
            : null,
          provider.apiKeys > 0 ? t('dashboard.fleet_api_keys', { count: provider.apiKeys }) : null,
        ].filter(Boolean);
        const failing = provider.status === 'down' || provider.status === 'degraded';

        return (
          <li key={provider.id} className={styles.row}>
            <div className={styles.identity}>
              <div className={styles.nameLine}>
                <Link
                  to={providerHref(provider)}
                  className={styles.name}
                  aria-label={t('dashboard.fleet_open_named', { provider: name })}
                >
                  {name}
                </Link>
                <StatusChip tone={STATUS_TONE[provider.status]}>
                  {t(`dashboard.provider_status_${provider.status}`)}
                </StatusChip>
              </div>
              {meta.length > 0 && <span className={styles.meta}>{meta.join(' · ')}</span>}
            </div>
            <Sparkline
              points={provider.buckets.map((bucket) => bucket.success + bucket.failed)}
              color={failing ? 'var(--viz-failure)' : undefined}
              ariaLabel={t('dashboard.fleet_spark_label', { provider: name })}
              className={styles.spark}
            />
            <div className={styles.numbers}>
              <span className={styles.total}>{provider.window.total.toLocaleString()}</span>
              <span
                className={[
                  styles.totalLabel,
                  failing && provider.window.failed > 0 ? styles.failedLabel : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {provider.window.failed > 0
                  ? t('dashboard.fleet_failed', { count: provider.window.failed })
                  : t('dashboard.fleet_requests')}
              </span>
            </div>
            <div className={styles.rate}>
              <span className={styles.rateValue}>
                {provider.window.successRate === null
                  ? DASH
                  : formatPercent(provider.window.successRate)}
              </span>
              <Meter
                value={provider.window.successRate}
                ariaLabel={t('dashboard.fleet_rate_label', { provider: name })}
                className={styles.meter}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
