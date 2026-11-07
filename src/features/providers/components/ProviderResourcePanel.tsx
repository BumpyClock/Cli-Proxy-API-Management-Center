import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconExternalLink,
  IconPlus,
  IconSearch,
  IconSlidersHorizontal,
} from '@/components/ui/icons';
import type { ProviderRecentUsageMap } from '@/components/providers/utils';
import { PROVIDER_LOGOS } from '../brandLogos';
import { getKimiAffiliateUrl } from '../kimi';
import { getSponsorProviderDefinition } from '../sponsorDefinitions';
import { getProviderCreateLabel } from '../createLabel';
import type { ProviderGroup, ProviderResource } from '../types';
import { ProviderResourceTable } from './ProviderResourceTable';
import { ProviderResourceToolbar } from './ProviderResourceToolbar';
import type { ProviderSortBy, SortDir } from '../types';
import styles from './ProviderResourcePanel.module.scss';
import { iconSize } from '@/design-system';

export interface ProviderPanelControls {
  sortBy: ProviderSortBy;
  sortDir: SortDir;
  onSortBy: (value: ProviderSortBy) => void;
  onSortDir: (value: SortDir) => void;
  availableModels: ReadonlyArray<string>;
  selectedModels: ReadonlySet<string>;
  onSelectedModelsChange: (next: Set<string>) => void;
}

interface ProviderResourcePanelProps {
  group: ProviderGroup;
  filter: string;
  onFilterChange: (value: string) => void;
  filteredResources: ProviderResource[];
  selectedId: string | null;
  disableMutations?: boolean;
  usageByProvider?: ProviderRecentUsageMap;
  toolbarControls?: ProviderPanelControls;
  onView: (resource: ProviderResource) => void;
  onEdit: (resource: ProviderResource) => void;
  onDelete: (resource: ProviderResource) => void;
  onToggleDisabled?: (resource: ProviderResource, disabled: boolean) => void;
  onCreate: () => void;
  /** Root element, so a deep link can scroll the selected brand into view. */
  panelRef?: React.Ref<HTMLElement>;
}

export function ProviderResourcePanel({
  group,
  filter,
  onFilterChange,
  filteredResources,
  selectedId,
  disableMutations,
  usageByProvider,
  toolbarControls,
  onView,
  onEdit,
  onDelete,
  onToggleDisabled,
  onCreate,
  panelRef,
}: ProviderResourcePanelProps) {
  const { t, i18n } = useTranslation();
  const controlsId = useId();
  const [controlsOpen, setControlsOpen] = useState(false);
  const logo = PROVIDER_LOGOS[group.id];
  const providerTitle = t(`providersPage.providerNames.${group.id}`);
  const registrationUrl =
    group.id === 'kimi'
      ? getKimiAffiliateUrl(i18n.resolvedLanguage ?? i18n.language)
      : group.id === 'fennoAI' || group.id === 'qiniuCloud'
        ? getSponsorProviderDefinition(group.id).affiliateUrl
        : null;
  const registrationLabel = t(
    group.id === 'kimi' ? 'providersPage.sponsor.registerNow' : 'providersPage.sponsor.registerLink'
  );
  // Phones fold search, sort and filter behind one control; its label says when they narrow
  // the list, so hidden state never explains missing rows.
  const narrowed = filter.trim() !== '' || (toolbarControls?.selectedModels.size ?? 0) > 0;
  const controlsLabel = narrowed
    ? t('providersPage.toolbar.controlsNarrowed')
    : t('providersPage.toolbar.controls');
  const logoClassName = [
    styles.logo,
    logo?.themeSurface ? styles.logoThemeSurface : '',
    logo?.darkSrc ? styles.logoThemeLight : '',
    logo?.invertOnDark ? styles.logoInvertOnDark : '',
  ]
    .filter(Boolean)
    .join(' ');
  const darkLogoClassName = [
    styles.logo,
    logo?.themeSurface ? styles.logoThemeSurface : '',
    styles.logoThemeDark,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={styles.panel} ref={panelRef} tabIndex={-1}>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <div className={styles.titleRow}>
            {logo ? (
              <>
                <img src={logo.src} alt="" aria-hidden="true" className={logoClassName} />
                {logo.darkSrc ? (
                  <img src={logo.darkSrc} alt="" aria-hidden="true" className={darkLogoClassName} />
                ) : null}
              </>
            ) : null}
            <h2 className={styles.title}>{providerTitle}</h2>
            <button
              type="button"
              className={styles.controlsToggle}
              aria-expanded={controlsOpen}
              aria-controls={controlsId}
              data-narrowed={narrowed || undefined}
              onClick={() => setControlsOpen((open) => !open)}
            >
              <IconSlidersHorizontal size={iconSize['16']} aria-hidden="true" />
              <span>{controlsLabel}</span>
            </button>
          </div>
          {registrationUrl ? (
            <>
              <a
                className={styles.sponsorLink}
                href={registrationUrl}
                target="_blank"
                rel="noreferrer"
              >
                <span className={styles.sponsorLinkText}>{registrationLabel}</span>
                <IconExternalLink className={styles.sponsorLinkIcon} size={iconSize['14']} />
              </a>
              {group.id === 'kimi' ? (
                <p className={styles.kimiPromo}>{t('providersPage.sponsor.kimiPromo')}</p>
              ) : null}
            </>
          ) : null}
        </div>
        <div id={controlsId} className={styles.controls} data-open={controlsOpen}>
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon} aria-hidden="true">
              <IconSearch size={iconSize['16']} />
            </span>
            <input
              type="search"
              className={styles.searchInput}
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              placeholder={t('providersPage.table.filterPlaceholder')}
              aria-label={t('providersPage.table.filterPlaceholder')}
            />
          </div>
          {toolbarControls ? (
            <div className={styles.toolbarRow}>
              <ProviderResourceToolbar
                key={group.id}
                sortBy={toolbarControls.sortBy}
                sortDir={toolbarControls.sortDir}
                onSortBy={toolbarControls.onSortBy}
                onSortDir={toolbarControls.onSortDir}
                availableModels={toolbarControls.availableModels}
                selectedModels={toolbarControls.selectedModels}
                onSelectedModelsChange={toolbarControls.onSelectedModelsChange}
              />
            </div>
          ) : null}
        </div>
      </div>

      {filteredResources.length === 0 ? (
        <div className={styles.empty}>
          <div>{t('providersPage.table.empty')}</div>
          <div className={styles.emptyAction}>
            <button type="button" className={styles.emptyActionButton} onClick={onCreate}>
              <IconPlus size={iconSize['16']} />
              <span>{getProviderCreateLabel(t, group.id)}</span>
            </button>
          </div>
        </div>
      ) : (
        <ProviderResourceTable
          resources={filteredResources}
          selectedId={selectedId}
          disableMutations={disableMutations}
          usageByProvider={usageByProvider}
          onView={onView}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleDisabled={onToggleDisabled}
        />
      )}
    </section>
  );
}
