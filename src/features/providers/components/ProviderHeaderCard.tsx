import { useTranslation } from 'react-i18next';
import { formatDateTimeValue, isoTitle } from '@/utils/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { IconPlus } from '@/components/ui/icons';
import styles from './ProviderHeaderCard.module.scss';

interface ProviderHeaderCardProps {
  title?: string;
  totalActive: number;
  totalResources: number;
  providerFamilies: number;
  /** Snapshot fetch time (ISO). Null before the first load. */
  updatedAt: string | null;
  isFetching?: boolean;
  isNewDisabled?: boolean;
  showNewAction?: boolean;
  showSummary?: boolean;
  /** Names what the create action adds, e.g. "Add Gemini key". */
  newLabel?: string;
  variant?: 'quickStart';
  onRefresh: () => void;
  onNew: () => void;
}

export function ProviderHeaderCard({
  title,
  totalActive,
  totalResources,
  providerFamilies,
  updatedAt,
  isFetching = false,
  isNewDisabled = false,
  showNewAction = true,
  showSummary = true,
  newLabel,
  variant,
  onRefresh,
  onNew,
}: ProviderHeaderCardProps) {
  const { t, i18n } = useTranslation();
  const updatedLabel = updatedAt ? formatDateTimeValue(updatedAt, i18n.language) : '';
  const updatedIso = updatedAt ? isoTitle(updatedAt) : '';
  // One summary line; the fetch time follows as secondary text and wraps on its own on phones.
  const metaItems = [
    <span key="summary" className={styles.metaStrong}>
      {t('providersPage.header.summary', {
        active: totalActive,
        total: totalResources,
        count: providerFamilies,
      })}
    </span>,
    updatedLabel ? (
      <time key="updated" dateTime={updatedIso} title={updatedIso}>
        {t('providersPage.header.updatedAt', { time: updatedLabel })}
      </time>
    ) : (
      <span key="updated">{t('providersPage.modelCatalog.notLoaded')}</span>
    ),
  ];
  return (
    <PageHeader
      title={title ?? t('providersPage.header.title')}
      className={variant === 'quickStart' ? styles.quickStartCard : undefined}
      actions={
        <div className={styles.actions}>
          <RefreshButton
            onClick={onRefresh}
            refreshing={isFetching}
            label={t('providersPage.header.refresh')}
          />
          {showNewAction && newLabel ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onNew}
              disabled={isNewDisabled}
            >
              <span>
                <IconPlus size={16} aria-hidden="true" />
                {newLabel}
              </span>
            </button>
          ) : null}
        </div>
      }
      meta={
        showSummary ? (
          <span className={styles.meta}>
            {/* The "·" trails its item inside a no-wrap group, so a wrapped line never starts
                with a separator. */}
            {metaItems.map((item, index) => (
              <span key={item.key} className={styles.metaItem}>
                {item}
                {index < metaItems.length - 1 ? (
                  <span className={styles.metaDot} aria-hidden="true">
                    ·
                  </span>
                ) : null}
              </span>
            ))}
          </span>
        ) : undefined
      }
    />
  );
}
