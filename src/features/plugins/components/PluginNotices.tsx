import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { IconAlertTriangle, IconChevronRight, IconInfo, IconShield } from '@/components/ui/icons';
import styles from './PluginNotices.module.scss';
import { iconSize } from '@/design-system';

/** Existing Config Panel deep link (ConfigPage reads `?field=` and jumps to the field). */
export const PLUGINS_ENABLED_CONFIG_PATH = '/config?field=pluginsEnabled';
/** Config Panel field that lists the registries the Plugin Store reads. */
export const PLUGIN_STORE_SOURCES_CONFIG_PATH = '/config?field=pluginStoreSources';

/**
 * Severity, highest first. `blocking` stops plugins working until the user acts, and carries the
 * fix; `security` is a standing advisory to weigh before installing; `info` is a calm hint.
 */
export type PluginNoticeTone = 'blocking' | 'security' | 'info';

const TONE_ICONS = {
  blocking: IconAlertTriangle,
  security: IconShield,
  info: IconInfo,
} as const;

/** Groups calm status notices into one surface so they do not stack as separate banners. */
export function PluginNoticeGroup({ children }: { children: ReactNode }) {
  return <div className={styles.group}>{children}</div>;
}

export function PluginNotice({
  children,
  title,
  action,
  tone = 'info',
}: {
  children: ReactNode;
  /** Bold lead sentence, read before the rest of the message. */
  title?: ReactNode;
  action?: ReactNode;
  tone?: PluginNoticeTone;
}) {
  const Icon = TONE_ICONS[tone];
  return (
    <div
      className={[styles.notice, styles[tone]].filter(Boolean).join(' ')}
      data-tone={tone}
      role={tone === 'security' ? 'note' : undefined}
    >
      <Icon size={iconSize['16']} className={styles.icon} aria-hidden="true" />
      <p className={styles.message}>
        {title ? <strong className={styles.title}>{title}</strong> : null}
        {title ? ' ' : null}
        {children}
        {/* Inline after the message: one compact line when it fits, natural wrapping when not. */}
        {action ? <span className={styles.action}>{action}</span> : null}
      </p>
    </div>
  );
}

/** Third-party plugin trust warning. Always shown on the store; never dismissible. */
export function PluginTrustNotice() {
  const { t } = useTranslation();
  return (
    <PluginNotice tone="security" title={t('plugin_store.security_banner_title')}>
      {t('plugin_store.security_banner_text')}
    </PluginNotice>
  );
}

/** `plugins.enabled` is off: say so and link the Config Panel field; never toggles it here. */
export function PluginsDisabledNotice({ message }: { message: string }) {
  const { t } = useTranslation();
  return (
    <PluginNotice
      tone="blocking"
      action={
        <Link className={styles.configLink} to={PLUGINS_ENABLED_CONFIG_PATH}>
          {t('plugin_management.open_plugins_setting')}
          <IconChevronRight size={iconSize['14']} aria-hidden="true" />
        </Link>
      }
    >
      {message}
    </PluginNotice>
  );
}
