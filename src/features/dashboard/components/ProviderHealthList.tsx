import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatPercent } from '@/utils/format';
import type { ProviderHealth, ProviderStatus } from '../types';
import { providerHref } from '../logic/links';
import { providerLabel } from '../utils';
import { Meter } from './Meter';
import { Sparkline } from './Sparkline';
import { StatusText } from './StatusText';
import styles from './ProviderHealthList.module.scss';

const DASH = '—';

/** Only exceptions carry a status word; healthy and idle rows let their numbers speak. */
const STATUS_TONE: Partial<Record<ProviderStatus, 'critical' | 'warning'>> = {
  down: 'critical',
  degraded: 'warning',
  limited: 'warning',
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
        const tone = STATUS_TONE[provider.status];
        const failing = provider.status === 'down' || provider.status === 'degraded';

        return (
          <li
            key={provider.id}
            className={[styles.row, tone ? styles[`row_${tone}`] : ''].filter(Boolean).join(' ')}
          >
            <div className={styles.identity}>
              <Link
                to={providerHref(provider)}
                className={styles.name}
                aria-label={t('dashboard.fleet_open_named', { provider: name })}
              >
                {name}
              </Link>
              <span className={styles.meta}>
                {tone && (
                  <StatusText tone={tone} className={styles.metaStatus}>
                    {t(`dashboard.provider_status_${provider.status}`)}
                  </StatusText>
                )}
                {provider.status === 'idle' && meta.length === 0
                  ? t('dashboard.fleet_idle')
                  : meta.join(' · ')}
              </span>
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
            <span aria-hidden="true" className={styles.chevron}>
              ›
            </span>
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
