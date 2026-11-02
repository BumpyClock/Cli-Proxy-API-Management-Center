import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/PageHeader';
import styles from './QuotaHeader.module.scss';

export type QuotaHeaderProps = {
  totalCount: number;
  loadedCount: number;
  attentionCount: number;
  refreshing: boolean;
  disableControls: boolean;
  onRefreshAll: () => void;
};

/** Page title, snapshot coverage, and the explicit batch refresh action. */
export function QuotaHeader(props: QuotaHeaderProps) {
  const { totalCount, loadedCount, attentionCount, refreshing, disableControls, onRefreshAll } =
    props;
  const { t } = useTranslation();
  return (
    <PageHeader
      title={t('quota_management.title')}
      meta={
        <p className={styles.meta} data-reveal>
          <span className={styles.metaTotal}>
            {t('quota_management.meta_credentials', { count: totalCount })}
          </span>
          <span className={styles.metaDot} aria-hidden="true">
            ·
          </span>
          <span className={loadedCount > 0 ? styles.metaLoaded : styles.metaMuted}>
            {t('quota_management.meta_loaded', { count: loadedCount })}
          </span>
          {attentionCount > 0 && (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span className={styles.metaAttention}>
                {t('quota_management.meta_attention', { count: attentionCount })}
              </span>
            </>
          )}
        </p>
      }
      actions={
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={onRefreshAll}
            disabled={disableControls || refreshing}
            aria-label={t('quota_management.refresh_all_credentials')}
            title={t('quota_management.refresh_all_credentials')}
          >
            <IconRefreshCw
              size={16}
              aria-hidden="true"
              className={refreshing ? styles.spinning : undefined}
            />
            <span className={styles.refreshLabel}>
              {t('quota_management.refresh_all_credentials')}
            </span>
          </button>
        </div>
      }
    />
  );
}
