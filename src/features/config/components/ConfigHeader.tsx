import { useTranslation } from 'react-i18next';
import type { HeaderMetaSegment } from '../uiState';
import styles from './ConfigHeader.module.scss';
import { PageHeader } from '@/components/ui/PageHeader';
import { RefreshButton } from '@/components/ui/RefreshButton';

export type ConfigHeaderProps = {
  /** Status segments from uiState.buildHeaderMeta. */
  meta: HeaderMetaSegment[];
  reloadDisabled: boolean;
  reloading: boolean;
  onReload: () => void;
};

/**
 * Config header: title, status meta line and a scoped reload action.
 * Save is not a header action; FloatingSaveBar carries it while the draft is dirty.
 */
export function ConfigHeader({ meta, reloadDisabled, reloading, onReload }: ConfigHeaderProps) {
  const { t } = useTranslation();
  const toneClass: Record<HeaderMetaSegment['tone'], string> = {
    muted: styles.metaMuted,
    warning: styles.metaWarning,
    error: styles.metaError,
    ok: styles.metaOk,
  };

  return (
    <PageHeader
      title={t('config_management.title')}
      meta={
        <span className={styles.meta}>
          {meta.map((segment, index) => (
            // Each dot travels with the segment it introduces, so a wrapped line never ends on one.
            <span
              key={segment.key}
              className={`${styles.segment} ${segment.key === 'save_hint' ? styles.segmentHint : ''}`}
            >
              {index > 0 ? (
                <span className={styles.metaDot} aria-hidden="true">
                  ·
                </span>
              ) : null}
              <span className={toneClass[segment.tone]}>
                {segment.count !== undefined
                  ? t(segment.labelKey, { count: segment.count })
                  : t(segment.labelKey)}
              </span>
            </span>
          ))}
        </span>
      }
      actions={
        <RefreshButton
          onClick={onReload}
          label={t('config_management.reload_config')}
          refreshingLabel={t('config_management.reloading_config')}
          refreshing={reloading}
          disabled={reloadDisabled}
        />
      }
    />
  );
}
