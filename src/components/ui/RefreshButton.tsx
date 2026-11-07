import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from './icons';
import styles from './RefreshButton.module.scss';

export interface RefreshButtonProps {
  onClick: () => void;
  /** Visible label naming the scope, e.g. "Refresh all credentials". Defaults to "Refresh". */
  label?: string;
  /** Shorter label for phones (≤768px), e.g. "Refresh all". The full label stays on wider screens. */
  compactLabel?: string;
  /** Shown while refreshing. Defaults to "Refreshing…". */
  refreshingLabel?: string;
  refreshing?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
}

/**
 * The page-level refresh action: outlined, icon plus visible scope label.
 * While refreshing it stays focusable (aria-disabled) so keyboard focus is not dropped.
 */
export function RefreshButton({
  onClick,
  label,
  compactLabel,
  refreshingLabel,
  refreshing = false,
  disabled = false,
  className,
  title,
}: RefreshButtonProps) {
  const { t } = useTranslation();
  const idleLabel = label ?? t('common.refresh');
  const busyLabel = refreshingLabel ?? t('common.refreshing');
  const blocked = refreshing || disabled;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (blocked) {
      event.preventDefault();
      return;
    }
    onClick();
  };

  return (
    <button
      type="button"
      className={[styles.refresh, className].filter(Boolean).join(' ')}
      onClick={handleClick}
      aria-disabled={blocked || undefined}
      aria-busy={refreshing || undefined}
      title={title}
    >
      <IconRefreshCw
        size={15}
        aria-hidden="true"
        className={refreshing ? styles.spinning : undefined}
      />
      {refreshing || !compactLabel ? (
        <span>{refreshing ? busyLabel : idleLabel}</span>
      ) : (
        <>
          <span className={styles.fullLabel}>{idleLabel}</span>
          <span className={styles.compactLabel}>{compactLabel}</span>
        </>
      )}
    </button>
  );
}
