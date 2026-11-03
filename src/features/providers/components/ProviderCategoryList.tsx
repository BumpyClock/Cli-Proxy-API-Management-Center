import { useTranslation } from 'react-i18next';
import { PROVIDER_LOGOS } from '../brandLogos';
import type { ProviderBrand, ProviderGroup } from '../types';
import styles from './ProviderCategoryList.module.scss';

interface ProviderCategoryListProps {
  groups: ProviderGroup[];
  activeBrand: ProviderBrand;
  onSelect: (brand: ProviderBrand) => void;
}

export function ProviderCategoryList({ groups, activeBrand, onSelect }: ProviderCategoryListProps) {
  const { t } = useTranslation();

  const configured = groups.filter((group) => group.resources.length > 0);
  const unconfigured = groups.filter((group) => group.resources.length === 0);

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
                <span className={styles.itemTitle}>
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

  return (
    <div className={styles.stack}>
      {configured.length > 0 && (
        <aside className={styles.aside}>
          <h2 className={styles.eyebrow}>{t('redesign.providers.configured')}</h2>
          {renderGroups(configured)}
        </aside>
      )}
      {unconfigured.length > 0 && (
        <aside className={styles.aside}>
          <h2 className={styles.eyebrow}>{t('providersPage.status.notConfigured')}</h2>
          {renderGroups(unconfigured)}
        </aside>
      )}
    </div>
  );
}
