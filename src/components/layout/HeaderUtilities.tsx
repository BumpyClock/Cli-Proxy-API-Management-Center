import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { LANGUAGE_LABEL_KEYS, LANGUAGE_ORDER } from '@/utils/constants';
import type { Language, Theme } from '@/types';
import { headerIcons } from './headerIcons';

/** Desktop widths that have room for text beside each header utility icon. */
const LABELLED_UTILITIES_QUERY = '(min-width: 1280px)';

type MenuInitialFocus = 'checked' | 'first';

/**
 * Header popover menus: opening focuses the checked item (or the first item); arrow keys,
 * Home, and End move between items; Escape or a selection closes the menu and returns
 * focus to its trigger; pressing outside or tabbing away closes it.
 */
function useMenu(
  open: boolean,
  menuRef: RefObject<HTMLDivElement | null>,
  onClose: () => void,
  initialFocus: MenuInitialFocus = 'checked'
) {
  useEffect(() => {
    if (!open) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []
    );
    const checked =
      initialFocus === 'checked'
        ? items.find((item) => item.getAttribute('aria-checked') === 'true')
        : undefined;
    (checked ?? items[0])?.focus();
  }, [open, menuRef, initialFocus]);

  // Closing by Escape or selection removes the focused item: hand focus back to the trigger.
  const wasOpenRef = useRef(open);
  useEffect(() => {
    if (wasOpenRef.current && !open) {
      const active = document.activeElement;
      const focusLost = !active || active === document.body || menuRef.current?.contains(active);
      if (focusLost) menuRef.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
    }
    wasOpenRef.current = open;
  }, [open, menuRef]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const trigger = menuRef.current?.querySelector<HTMLElement>('[aria-haspopup]');
      if (trigger?.contains(target)) {
        // Let click close the menu before focus restoration, not focusin before click.
        event.preventDefault();
        return;
      }
      if (!menuRef.current?.contains(target)) onClose();
    };
    // Tab or Shift+Tab out of the popover (including back to its trigger) closes it.
    const handleFocusIn = (event: FocusEvent) => {
      const popover = menuRef.current?.querySelector('[role="menu"]');
      if (!popover?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []
      );
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (index === -1) return;
      const target =
        event.key === 'ArrowDown' || event.key === 'ArrowRight'
          ? index + 1
          : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
            ? index - 1
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : null;
      if (target === null) return;
      event.preventDefault();
      items[(target + items.length) % items.length]?.focus();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, menuRef, onClose]);
}

const THEME_CARDS: Array<{
  key: Theme;
  labelKey: string;
  colors: { bg: string; card: string; border: string; text: string; textMuted: string };
}> = [
  {
    key: 'auto',
    labelKey: 'theme.auto',
    colors: {
      bg: 'linear-gradient(135deg, #ffffff 0 50%, #111111 50% 100%)',
      card: 'linear-gradient(135deg, #ffffff 0 50%, #1a1a1a 50% 100%)',
      border: '#bdbdbd',
      text: '#2d2a26',
      textMuted: 'linear-gradient(135deg, #c9c9c9 0 50%, #5a5a5a 50% 100%)',
    },
  },
  {
    key: 'white',
    labelKey: 'theme.white',
    colors: {
      bg: '#ffffff',
      card: '#ffffff',
      border: '#e5e5e5',
      text: '#2d2a26',
      textMuted: '#a29c95',
    },
  },
  {
    key: 'light',
    labelKey: 'theme.light',
    colors: {
      bg: '#faf9f5',
      card: '#f0eee8',
      border: '#e3e1db',
      text: '#2d2a26',
      textMuted: '#a29c95',
    },
  },
  {
    key: 'dark',
    labelKey: 'theme.dark',
    colors: {
      bg: '#151412',
      card: '#1d1b18',
      border: '#3a3530',
      text: '#f6f4f1',
      textMuted: '#9c958d',
    },
  },
];

const themeLabelKey = (theme: Theme) =>
  THEME_CARDS.find((card) => card.key === theme)?.labelKey ?? 'theme.auto';

export interface HeaderUtilitiesProps {
  /** Phones: one labelled Utilities menu replaces the icon cluster. */
  compact: boolean;
  language: Language;
  theme: Theme;
  onLanguageChange: (language: Language) => void;
  onThemeChange: (theme: Theme) => void;
  /** Refetches config, plugin resources, the Auth Files count and the current page's data. */
  onRefresh: () => void;
  onSignOut: () => void;
}

interface UtilitiesMenuListProps {
  language: Language;
  theme: Theme;
  onRefresh: () => void;
  onLanguageSelect: (language: Language) => void;
  onThemeSelect: (theme: Theme) => void;
  onSignOut: () => void;
}

/** Phone Utilities menu items: every item carries visible text and a 44px row. */
export function UtilitiesMenuList({
  language,
  theme,
  onRefresh,
  onLanguageSelect,
  onThemeSelect,
  onSignOut,
}: UtilitiesMenuListProps) {
  const { t } = useTranslation();
  const id = useId();
  const languageHeadingId = `${id}-language`;
  const themeHeadingId = `${id}-theme`;

  return (
    <>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="utilities-menu-item"
        onClick={onRefresh}
      >
        {headerIcons.refresh}
        <span>{t('header.refresh_config_page')}</span>
      </button>
      <div role="separator" className="utilities-menu-separator" />
      <div role="group" aria-labelledby={languageHeadingId}>
        <div id={languageHeadingId} role="presentation" className="utilities-menu-heading">
          {t('language.switch')}
        </div>
        {LANGUAGE_ORDER.map((lang) => (
          <button
            key={lang}
            type="button"
            role="menuitemradio"
            aria-checked={language === lang}
            tabIndex={-1}
            className="utilities-menu-item"
            onClick={() => onLanguageSelect(lang)}
          >
            <span>{t(LANGUAGE_LABEL_KEYS[lang])}</span>
            {language === lang ? (
              <span className="utilities-menu-check" aria-hidden="true">
                ✓
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div role="separator" className="utilities-menu-separator" />
      <div role="group" aria-labelledby={themeHeadingId}>
        <div id={themeHeadingId} role="presentation" className="utilities-menu-heading">
          {t('theme.switch')}
        </div>
        {THEME_CARDS.map((card) => (
          <button
            key={card.key}
            type="button"
            role="menuitemradio"
            aria-checked={theme === card.key}
            tabIndex={-1}
            className="utilities-menu-item"
            onClick={() => onThemeSelect(card.key)}
          >
            <span
              className="utilities-menu-swatch"
              style={{ background: card.colors.bg, borderColor: card.colors.border }}
              aria-hidden="true"
            />
            <span>{t(card.labelKey)}</span>
            {theme === card.key ? (
              <span className="utilities-menu-check" aria-hidden="true">
                ✓
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div role="separator" className="utilities-menu-separator" />
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="utilities-menu-item"
        onClick={onSignOut}
      >
        {headerIcons.logout}
        <span>{t('header.logout')}</span>
      </button>
    </>
  );
}

function PhoneUtilitiesMenu({
  language,
  theme,
  onLanguageChange,
  onThemeChange,
  onRefresh,
  onSignOut,
}: Omit<HeaderUtilitiesProps, 'compact'>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useMenu(open, menuRef, close, 'first');

  const select =
    <T,>(action: (value: T) => void) =>
    (value: T) => {
      action(value);
      setOpen(false);
    };

  return (
    <div className={`utilities-menu ${open ? 'open' : ''}`} ref={menuRef}>
      <Button
        variant="ghost"
        size="sm"
        className="header-utility header-utility-labelled"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {headerIcons.utilities}
        <span className="header-utility-label">{t('header.utilities')}</span>
      </Button>
      {open && (
        <div
          className="notification entering utilities-menu-popover"
          role="menu"
          aria-label={t('header.utilities')}
        >
          <UtilitiesMenuList
            language={language}
            theme={theme}
            onRefresh={() => {
              setOpen(false);
              onRefresh();
            }}
            onLanguageSelect={select(onLanguageChange)}
            onThemeSelect={select(onThemeChange)}
            onSignOut={() => {
              setOpen(false);
              onSignOut();
            }}
          />
        </div>
      )}
    </div>
  );
}

function DesktopUtilities({
  language,
  theme,
  onLanguageChange,
  onThemeChange,
  onRefresh,
  onSignOut,
}: Omit<HeaderUtilitiesProps, 'compact'>) {
  const { t } = useTranslation();
  // Wide screens show each name beside its icon; narrower ones keep the name as a tooltip.
  const showLabels = useMediaQuery(LABELLED_UTILITIES_QUERY);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const languageMenuRef = useRef<HTMLDivElement | null>(null);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const closeLanguageMenu = useCallback(() => setLanguageMenuOpen(false), []);
  const closeThemeMenu = useCallback(() => setThemeMenuOpen(false), []);
  useMenu(languageMenuOpen, languageMenuRef, closeLanguageMenu);
  useMenu(themeMenuOpen, themeMenuRef, closeThemeMenu);

  const languageName = t(LANGUAGE_LABEL_KEYS[language]);
  const themeName = t(themeLabelKey(theme));
  const refreshName = t('header.refresh_config_page');
  const languageTriggerName = t('header.language_current', { language: languageName });
  const themeTriggerName = t('header.theme_current', { theme: themeName });
  const signOutName = t('header.logout');
  const labelledClass = showLabels ? 'header-utility header-utility-labelled' : 'header-utility';

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={labelledClass}
        onClick={onRefresh}
        title={showLabels ? undefined : refreshName}
        aria-label={refreshName}
      >
        {headerIcons.refresh}
        {showLabels ? <span className="header-utility-label">{refreshName}</span> : null}
      </Button>
      <div className={`language-menu ${languageMenuOpen ? 'open' : ''}`} ref={languageMenuRef}>
        <Button
          variant="ghost"
          size="sm"
          className={labelledClass}
          onClick={() => {
            setLanguageMenuOpen((prev) => !prev);
            setThemeMenuOpen(false);
          }}
          title={showLabels ? undefined : languageTriggerName}
          aria-label={languageTriggerName}
          aria-haspopup="menu"
          aria-expanded={languageMenuOpen}
        >
          {headerIcons.language}
          {showLabels ? <span className="header-utility-label">{languageName}</span> : null}
        </Button>
        {languageMenuOpen && (
          <div
            className="notification entering language-menu-popover"
            role="menu"
            aria-label={t('language.switch')}
          >
            {LANGUAGE_ORDER.map((lang) => (
              <button
                key={lang}
                type="button"
                className={`language-menu-option ${language === lang ? 'active' : ''}`}
                onClick={() => {
                  onLanguageChange(lang);
                  setLanguageMenuOpen(false);
                }}
                role="menuitemradio"
                aria-checked={language === lang}
                tabIndex={-1}
              >
                <span>{t(LANGUAGE_LABEL_KEYS[lang])}</span>
                {language === lang ? <span className="language-menu-check">✓</span> : null}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={`theme-menu ${themeMenuOpen ? 'open' : ''}`} ref={themeMenuRef}>
        <Button
          variant="ghost"
          size="sm"
          className={labelledClass}
          onClick={() => {
            setThemeMenuOpen((prev) => !prev);
            setLanguageMenuOpen(false);
          }}
          title={showLabels ? undefined : themeTriggerName}
          aria-label={themeTriggerName}
          aria-haspopup="menu"
          aria-expanded={themeMenuOpen}
        >
          {headerIcons.theme}
          {showLabels ? <span className="header-utility-label">{themeName}</span> : null}
        </Button>
        {themeMenuOpen && (
          <div
            className="notification entering theme-menu-popover"
            role="menu"
            aria-label={t('theme.switch')}
          >
            {THEME_CARDS.map((tc) => (
              <button
                key={tc.key}
                type="button"
                className={`theme-card ${theme === tc.key ? 'active' : ''}`}
                onClick={() => {
                  onThemeChange(tc.key);
                  setThemeMenuOpen(false);
                }}
                role="menuitemradio"
                aria-checked={theme === tc.key}
                tabIndex={-1}
              >
                <div
                  className="theme-card-preview"
                  style={{
                    background: tc.colors.bg,
                    border: `1px solid ${tc.colors.border}`,
                  }}
                >
                  <div
                    className="theme-card-header"
                    style={{
                      background: tc.colors.card,
                      borderBottom: `1px solid ${tc.colors.border}`,
                    }}
                  />
                  <div className="theme-card-body">
                    <div
                      className="theme-card-sidebar"
                      style={{
                        background: tc.colors.card,
                        borderRight: `1px solid ${tc.colors.border}`,
                      }}
                    />
                    <div className="theme-card-content" style={{ background: tc.colors.bg }}>
                      <div
                        className="theme-card-line"
                        style={{ background: tc.colors.textMuted }}
                      />
                      <div
                        className="theme-card-line short"
                        style={{ background: tc.colors.textMuted }}
                      />
                    </div>
                  </div>
                </div>
                <span className="theme-card-label">{t(tc.labelKey)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className={labelledClass}
        onClick={onSignOut}
        title={showLabels ? undefined : signOutName}
        aria-label={signOutName}
      >
        {headerIcons.logout}
        {showLabels ? <span className="header-utility-label">{signOutName}</span> : null}
      </Button>
    </>
  );
}

/** Top-bar utilities: refresh, language, theme and sign out, sharing one set of handlers. */
export function HeaderUtilities({ compact, ...props }: HeaderUtilitiesProps) {
  return compact ? <PhoneUtilitiesMenu {...props} /> : <DesktopUtilities {...props} />;
}
