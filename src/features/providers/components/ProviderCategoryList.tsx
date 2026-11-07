import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown } from '@/components/ui/icons';
import { PROVIDER_LOGOS } from '../brandLogos';
import type { ProviderBrand, ProviderGroup } from '../types';
import { shouldExpandUnconfigured } from '../workbenchLayout';
import styles from './ProviderCategoryList.module.scss';
import { iconSize } from '@/design-system';

interface ProviderCategoryListProps {
  groups: ProviderGroup[];
  activeBrand: ProviderBrand;
  onSelect: (brand: ProviderBrand) => void;
  /**
   * The selected provider's detail. It sits between the configured and not-configured groups in
   * DOM order, so the one-column layout reads configured list, detail, then the long catalog.
   * Phones swap the configured list for a native provider select, so the detail comes first.
   */
  detail?: ReactNode;
}

export function ProviderCategoryList({
  groups,
  activeBrand,
  onSelect,
  detail,
}: ProviderCategoryListProps) {
  const { t } = useTranslation();
  const pickerId = useId();

  const configured = groups.filter((group) => group.resources.length > 0);
  const unconfigured = groups.filter((group) => group.resources.length === 0);
  const activeIsConfigured = configured.some((group) => group.id === activeBrand);

  const [unconfiguredOpen, setUnconfiguredOpen] = useState(() =>
    shouldExpandUnconfigured({ configuredCount: configured.length, activeIsConfigured })
  );
  // Selecting (or deep-linking to) a not-configured provider must never leave it hidden.
  const [shownBrand, setShownBrand] = useState(activeBrand);
  if (shownBrand !== activeBrand) {
    setShownBrand(activeBrand);
    if (!activeIsConfigured) setUnconfiguredOpen(true);
  }

  const renderGroups = (items: ProviderGroup[]) => (
    <div className={styles.list}>
      {items.map((group) => {
        const active = group.id === activeBrand;
        const total = group.resources.length;
        const activeCount = group.resources.filter((r) => !r.disabled).length;
        const logo = PROVIDER_LOGOS[group.id];
        const itemClass = [styles.item, active ? styles.active : ''].filter(Boolean).join(' ');
        const logoClassName = [
          styles.logo,
          logo?.transparent ? styles.logoTransparent : '',
          logo?.themeSurface ? styles.logoThemeSurface : '',
          logo?.darkSrc ? styles.logoThemeLight : '',
          logo?.invertOnDark ? styles.logoInvertOnDark : '',
        ]
          .filter(Boolean)
          .join(' ');
        const darkLogoClassName = [
          styles.logo,
          logo?.transparent ? styles.logoTransparent : '',
          logo?.themeSurface ? styles.logoThemeSurface : '',
          styles.logoThemeDark,
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={group.id}
            type="button"
            className={itemClass}
            onClick={() => onSelect(group.id)}
            aria-current={active ? 'page' : undefined}
          >
            <span className={styles.itemLeft}>
              {logo ? (
                <>
                  <img src={logo.src} alt="" aria-hidden="true" className={logoClassName} />
                  {logo.darkSrc ? (
                    <img
                      src={logo.darkSrc}
                      alt=""
                      aria-hidden="true"
                      className={darkLogoClassName}
                    />
                  ) : null}
                </>
              ) : null}
              <span className={styles.itemText}>
                <span
                  className={styles.itemTitle}
                  title={t(`providersPage.providerNames.${group.id}`)}
                >
                  {t(`providersPage.providerNames.${group.id}`)}
                </span>
                <span className={styles.itemSubtitle}>
                  {total > 0
                    ? t('providersPage.categories.activeCount', { active: activeCount, total })
                    : t('providersPage.status.notConfigured')}
                </span>
              </span>
            </span>
            <span className={styles.badge}>{total}</span>
          </button>
        );
      })}
    </div>
  );

  const layoutClassName = [styles.workbench, configured.length === 0 ? styles.noConfigured : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={layoutClassName}>
      {configured.length > 0 && (
        <aside className={`${styles.aside} ${styles.configuredArea}`}>
          <h2 className={styles.eyebrow}>{t('redesign.providers.configured')}</h2>
          {renderGroups(configured)}
        </aside>
      )}
      <div className={styles.pickerArea}>
        <label className={styles.pickerLabel} htmlFor={pickerId}>
          {t('providersPage.categories.pickerLabel')}
        </label>
        <span className={styles.pickerWrap}>
          <select
            id={pickerId}
            className={styles.picker}
            value={activeBrand}
            onChange={(event) => onSelect(event.target.value as ProviderBrand)}
          >
            {configured.length > 0 ? (
              <optgroup label={t('redesign.providers.configured')}>
                {configured.map((group) => (
                  <option key={group.id} value={group.id}>
                    {`${t(`providersPage.providerNames.${group.id}`)} · ${t(
                      'providersPage.categories.activeCount',
                      {
                        active: group.resources.filter((r) => !r.disabled).length,
                        total: group.resources.length,
                      }
                    )}`}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {unconfigured.length > 0 ? (
              <optgroup label={t('providersPage.status.notConfigured')}>
                {unconfigured.map((group) => (
                  <option key={group.id} value={group.id}>
                    {t(`providersPage.providerNames.${group.id}`)}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <IconChevronDown
            size={iconSize['16']}
            aria-hidden="true"
            className={styles.pickerChevron}
          />
        </span>
      </div>
      {detail ? <div className={styles.detailArea}>{detail}</div> : null}
      {unconfigured.length > 0 && (
        <details
          className={`${styles.aside} ${styles.unconfiguredArea}`}
          open={unconfiguredOpen}
          onToggle={(event) => setUnconfiguredOpen(event.currentTarget.open)}
        >
          <summary className={styles.summary}>
            <h2 className={styles.summaryTitle}>{t('providersPage.status.notConfigured')}</h2>
            <span className={styles.badge}>{unconfigured.length}</span>
          </summary>
          <p className={styles.summaryHint}>{t('redesign.providers.notConfiguredHint')}</p>
          {renderGroups(unconfigured)}
        </details>
      )}
    </div>
  );
}
