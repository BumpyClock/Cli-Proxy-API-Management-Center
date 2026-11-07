import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { Card } from '@/components/ui/Card';
import { IconCheck, IconInfo, IconNetwork } from '@/components/ui/icons';
import { useThemeStore } from '@/stores';
import { getAuthFileIcon, getTypeLabel, normalizeProviderKey } from '../constants';
import styles from './OAuthEditor.module.scss';
import { iconSize, media } from '@/design-system';

interface OAuthEditorProviderCardProps {
  provider: string;
  options: string[];
  onChange: (provider: string) => void;
  disabled: boolean;
  translationPrefix: 'oauth_excluded' | 'oauth_model_alias';
  /**
   * When set, the provider is still missing: the requirement renders under the field with this
   * id, so the page's Save button can reference the same text with aria-describedby.
   */
  requirementId?: string;
}

/** Phones start with the shortcut list collapsed so the model editor stays near the top. */
const SHORTCUTS_OPEN_QUERY = media.aboveMobile;
const shortcutsOpenByDefault = () =>
  typeof window !== 'undefined' && window.matchMedia?.(SHORTCUTS_OPEN_QUERY).matches === true;

/** Icon and label of the chosen provider, shown in the step headings. */
export function OAuthProviderChip({ provider }: { provider: string }) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const key = normalizeProviderKey(provider);
  if (!key) return null;
  const icon = getAuthFileIcon(key, resolvedTheme);
  return (
    <span className={styles.providerChip}>
      <span className={styles.srOnly}>{t('redesign.authFiles.selectedProvider')}: </span>
      {icon ? <img src={icon} alt="" /> : <IconNetwork size={iconSize['14']} aria-hidden="true" />}
      <span>{getTypeLabel(t, provider.trim())}</span>
    </span>
  );
}

export function OAuthEditorProviderCard({
  provider,
  options,
  onChange,
  disabled,
  translationPrefix,
  requirementId,
}: OAuthEditorProviderCardProps) {
  const { t } = useTranslation();
  const id = useId();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const [shortcutsOpen, setShortcutsOpen] = useState(shortcutsOpenByDefault);
  const selectedKey = normalizeProviderKey(provider);

  return (
    <Card className={styles.settingsCard}>
      <div className={styles.providerSection}>
        <div className={styles.providerHeading}>
          <span className={styles.stepNumber} aria-hidden="true">
            01
          </span>
          <label className={styles.sectionTitle} htmlFor={id}>
            {t(`${translationPrefix}.provider_label`)}
          </label>
          {selectedKey && <OAuthProviderChip provider={provider} />}
        </div>
        <div className={styles.providerFields}>
          <AutocompleteInput
            id={id}
            placeholder={t(`${translationPrefix}.provider_placeholder`)}
            value={provider}
            onChange={onChange}
            options={options}
            disabled={disabled}
            ariaDescribedBy={requirementId}
            wrapperClassName={styles.providerControl}
          />
          {requirementId && (
            <p id={requirementId} className={styles.providerRequirement}>
              <IconInfo size={iconSize['14']} aria-hidden="true" />
              <span>{t(`${translationPrefix}.provider_required`)}</span>
            </p>
          )}
          {options.length > 0 && (
            <details
              className={styles.shortcuts}
              open={shortcutsOpen}
              onToggle={(event) => setShortcutsOpen(event.currentTarget.open)}
            >
              <summary>{t('redesign.authFiles.providerShortcuts')}</summary>
              <div
                className={styles.providerOptions}
                role="group"
                aria-label={t('redesign.authFiles.providerShortcuts')}
              >
                {options.map((option) => {
                  const active = selectedKey === normalizeProviderKey(option);
                  const icon = getAuthFileIcon(option, resolvedTheme);
                  return (
                    <button
                      key={option}
                      type="button"
                      className={`${styles.providerOption} ${active ? styles.providerOptionActive : ''}`}
                      aria-pressed={active}
                      onClick={() => {
                        onChange(option);
                        // On phones, fold the list again so the model editor moves up into view.
                        if (!shortcutsOpenByDefault()) setShortcutsOpen(false);
                      }}
                      disabled={disabled}
                    >
                      {icon ? (
                        <img src={icon} alt="" />
                      ) : (
                        <IconNetwork size={iconSize['16']} aria-hidden="true" />
                      )}
                      <span>{getTypeLabel(t, option)}</span>
                      <IconCheck
                        size={iconSize['14']}
                        className={styles.providerCheck}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      </div>
    </Card>
  );
}
