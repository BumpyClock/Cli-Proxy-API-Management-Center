import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IconRefreshCw, IconUpload } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/PageHeader';
import styles from './VaultHeader.module.scss';

export type VaultHeaderProps = {
  totalCount: number;
  activeCount: number;
  problemCount: number;
  loading: boolean;
  refreshing: boolean;
  uploading: boolean;
  disableControls: boolean;
  onUpload: () => void;
  onRefresh: () => void;
};

export function VaultHeader(props: VaultHeaderProps) {
  const {
    totalCount,
    activeCount,
    problemCount,
    loading,
    refreshing,
    uploading,
    disableControls,
    onUpload,
    onRefresh,
  } = props;
  const { t } = useTranslation();

  return (
    <PageHeader
      title={t('auth_files.title')}
      meta={
        <p className={styles.meta}>
          <span className={styles.metaTotal}>
            {t('auth_files.meta_total', { count: totalCount })}
          </span>
          <span className={styles.metaDot} aria-hidden="true">
            ·
          </span>
          <span className={activeCount > 0 ? styles.metaActive : styles.metaMuted}>
            {t('auth_files.meta_active', { count: activeCount })}
          </span>
          {problemCount > 0 && (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span className={styles.metaProblem}>
                {t('auth_files.meta_problem', { count: problemCount })}
              </span>
            </>
          )}
        </p>
      }
      actions={
        <div className={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={loading || refreshing}
          >
            <IconRefreshCw size={14} className={refreshing ? styles.spinning : undefined} />
            {t('common.refresh')}
          </Button>
          <Button size="sm" onClick={onUpload} disabled={disableControls || uploading}>
            {uploading ? <LoadingSpinner size={14} /> : <IconUpload size={15} />}
            {t('auth_files.upload_button')}
          </Button>
        </div>
      }
    />
  );
}
