import { useTranslation } from 'react-i18next';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { AUTH_FILES_SECTIONS, activeAuthFilesSection } from '@/features/authFiles/sections';
import styles from './AuthFilesSectionNav.module.scss';

/**
 * Section navigation. Desktop shows underline links; at 768px and below a labelled native select
 * names the current section and lists every destination, so no section hides behind a scroll.
 */
export function AuthFilesSectionNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = activeAuthFilesSection(pathname);

  return (
    <>
      <nav className={styles.subnav} aria-label={t('redesign.authFiles.sections')}>
        {AUTH_FILES_SECTIONS.map(([to, key]) => (
          <NavLink key={to} to={to} end>
            {t(`redesign.authFiles.${key}`)}
          </NavLink>
        ))}
      </nav>
      <NativeSelect
        className={styles.picker}
        layout="stacked"
        label={t('redesign.authFiles.section')}
        value={active}
        onChange={(to) => navigate(to)}
        options={AUTH_FILES_SECTIONS.map(([to, key]) => ({
          value: to,
          label: t(`redesign.authFiles.${key}`),
        }))}
      />
    </>
  );
}
