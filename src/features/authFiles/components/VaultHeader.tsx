import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IconUpload } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/PageHeader';
import { RefreshButton } from '@/components/ui/RefreshButton';
import styles from './VaultHeader.module.scss';

const PHONE_QUERY = '(max-width: 768px)';
const subscribePhone = (onChange: () => void) => {
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};
const readPhone = () => window.matchMedia(PHONE_QUERY).matches;
const readPhoneOnServer = () => false;

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
  // Phones already show the top bar's refresh, which runs this page's refresh; dropping the
  // duplicate lets Upload share the title row.
  const isPhone = useSyncExternalStore(subscribePhone, readPhone, readPhoneOnServer);

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
          {!isPhone && (
            <RefreshButton
              onClick={onRefresh}
              label={t('auth_files.refresh_credentials')}
              refreshing={refreshing}
              disabled={loading}
            />
          )}
          <Button onClick={onUpload} disabled={disableControls || uploading}>
            {uploading ? <LoadingSpinner size={14} /> : <IconUpload size={15} />}
            {t('auth_files.upload_button')}
          </Button>
        </div>
      }
    />
  );
}
