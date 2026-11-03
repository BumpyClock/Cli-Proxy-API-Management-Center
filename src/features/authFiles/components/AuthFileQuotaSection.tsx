import { useTranslation } from 'react-i18next';
import { useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { isRuntimeOnlyAuthFile, type QuotaProviderType } from '@/features/authFiles/constants';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import { bindQuotaClasses } from '@/features/quota/types';
import { QUOTA_ADAPTERS } from '@/features/quota/providers';
import { getQuotaObservations } from '@/features/quota/providers/registry';
import { selectQuotaWindow } from '@/features/quota/providers/observations';
import { useQuotaActions } from '@/features/quota/hooks/useQuotaActions';
import styles from './AuthFileQuota.module.scss';

const compactQuotaClasses = bindQuotaClasses(styles, 'AuthFileQuota.module.scss');

export type AuthFileQuotaSectionProps = {
  file: AuthFileItem;
  quotaType: QuotaProviderType;
  disableControls: boolean;
  compact?: boolean;
};

export function AuthFileQuotaSection({
  file,
  quotaType,
  disableControls,
  compact = false,
}: AuthFileQuotaSectionProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const adapter = QUOTA_ADAPTERS[quotaType];
  const cacheKey = getQuotaCacheKey(file);
  const quota = useQuotaStore((state) => adapter.storeSelector(state)[cacheKey]);
  const { resettingQuotaName, refreshQuota, resetQuota, testHealth } =
    useQuotaActions(disableControls);
  const resettingQuota = resettingQuotaName === cacheKey;
  const quotaStatus = quota?.status ?? 'idle';
  const runtimeOnly = isRuntimeOnlyAuthFile(file);
  const canRefreshQuota =
    !disableControls && !file.disabled && !runtimeOnly && !resettingQuota && !quota?.refreshing;
  const canObserveQuota = adapter.canObserve?.(file) ?? true;
  const canUseResetQuota = canRefreshQuota && quotaStatus !== 'loading';
  const showResetQuotaAction = quota !== undefined && Boolean(adapter.canResetQuota?.(quota));
  const window = selectQuotaWindow(getQuotaObservations(quotaType, quota));
  const expired =
    window?.resetAtMs !== null && window?.resetAtMs !== undefined && window.resetAtMs <= now;
  const remaining = expired ? null : (window?.remainingPercent ?? null);
  const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleString(i18n.language, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );

  const content = (
    <div className={styles.quotaSection}>
      {(quota?.stale || quota?.refreshing) && (
        <p className={quota.stale ? styles.quotaWarningMessage : styles.quotaMessage}>
          {t(quota.refreshing ? 'redesign.quota.checking' : 'redesign.quota.stale')}
        </p>
      )}
      {quotaStatus === 'loading' ? (
        <div className={styles.quotaMessage}>{t(`${adapter.i18nPrefix}.loading`)}</div>
      ) : quotaStatus === 'idle' && !canObserveQuota ? (
        <div className={styles.quotaMessage}>{t(`${adapter.i18nPrefix}.empty_data`)}</div>
      ) : quotaStatus === 'idle' ? (
        <button
          type="button"
          className={`${styles.quotaMessage} ${styles.quotaMessageAction}`}
          onClick={() => !runtimeOnly && void refreshQuota(file, adapter)}
          disabled={!canRefreshQuota}
        >
          {t(`${adapter.i18nPrefix}.idle`)}
        </button>
      ) : quotaStatus === 'error' ? (
        <div className={styles.quotaError}>
          {t(`${adapter.i18nPrefix}.load_failed`, { message: quotaErrorMessage })}
        </div>
      ) : quota ? (
        <adapter.Body quota={quota} classes={compactQuotaClasses} />
      ) : (
        <div className={styles.quotaMessage}>{t(`${adapter.i18nPrefix}.idle`)}</div>
      )}
      {adapter.healthTest && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => !runtimeOnly && void testHealth(file, adapter)}
          disabled={!canRefreshQuota || quotaStatus === 'loading'}
        >
          {t(adapter.healthTest.labelKey, { defaultValue: adapter.healthTest.labelFallback })}
        </Button>
      )}
      {quota?.checkedAt && (
        <small className={styles.snapshotTime}>
          {t('redesign.quota.snapshot')}{' '}
          <time dateTime={new Date(quota.checkedAt).toISOString()}>
            {formatTime(quota.checkedAt)}
          </time>
        </small>
      )}
      {quotaStatus !== 'idle' && (showResetQuotaAction || quotaType === 'devin') && (
        <div className={styles.quotaCardActions}>
          {adapter.resetQuota && showResetQuotaAction && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={styles.quotaResetCreditButton}
              onClick={() => !runtimeOnly && resetQuota(file, adapter)}
              disabled={!canUseResetQuota}
              loading={resettingQuota}
              title={t('codex_quota.reset_button')}
              aria-label={t('codex_quota.reset_button')}
            >
              {!resettingQuota && <IconRefreshCw size={14} />}
              {t('codex_quota.reset_button')}
            </Button>
          )}
          {quotaType === 'devin' && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={styles.quotaResetCreditButton}
              onClick={() => !runtimeOnly && void refreshQuota(file, adapter)}
              disabled={!canRefreshQuota || quotaStatus === 'loading'}
              loading={quotaStatus === 'loading' || quota?.refreshing}
              title={t('auth_files.quota_refresh_hint')}
            >
              {quotaStatus !== 'loading' && <IconRefreshCw size={14} />}
              {t('auth_files.quota_refresh_single')}
            </Button>
          )}
        </div>
      )}
    </div>
  );

  if (!compact) return content;
  const summary =
    !expired && window?.unlimited
      ? t('redesign.authFiles.quotaUnlimited')
      : remaining === null
        ? t('redesign.authFiles.notReported')
        : t('redesign.authFiles.quotaRemaining', {
            value: new Intl.NumberFormat(i18n.language, {
              style: 'percent',
              maximumFractionDigits: 1,
            }).format(remaining / 100),
          });

  return (
    <details className={styles.quotaDisclosure}>
      <summary
        aria-label={[
          summary,
          quota?.stale ? t('redesign.quota.stale') : '',
          quota?.refreshing ? t('redesign.quota.checking') : '',
          t('redesign.authFiles.quotaDetails', { name: file.name }),
        ]
          .filter(Boolean)
          .join('. ')}
      >
        <span className={styles.summaryValue}>{summary}</span>
        {quota?.stale && <small>{t('redesign.quota.stale')}</small>}
        {quota?.refreshing && <small>{t('redesign.quota.checking')}</small>}
        {window?.recovers && window.resetAtMs !== null && !expired && (
          <small>
            {t('quota_management.pool_next_reset')}{' '}
            <time dateTime={new Date(window.resetAtMs).toISOString()}>
              {formatTime(window.resetAtMs)}
            </time>
          </small>
        )}
      </summary>
      {content}
    </details>
  );
}
