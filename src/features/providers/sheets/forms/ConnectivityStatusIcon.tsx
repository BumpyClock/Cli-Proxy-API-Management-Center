import { IconAlertTriangle, IconCheckCircle2, IconLoader2 } from '@/components/ui/icons';
import type { ConnectivityState } from './useConnectivityTest';
import styles from './sharedForm.module.scss';
import { iconSize } from '@/design-system';

export function ConnectivityStatusIcon({ state }: { state: ConnectivityState }) {
  if (state === 'loading') {
    return (
      <span className={`${styles.statusIcon} ${styles.statusIconLoading}`}>
        <IconLoader2 size={iconSize['14']} />
      </span>
    );
  }
  if (state === 'success') {
    return (
      <span className={`${styles.statusIcon} ${styles.statusIconSuccess}`}>
        <IconCheckCircle2 size={iconSize['14']} />
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className={`${styles.statusIcon} ${styles.statusIconError}`}>
        <IconAlertTriangle size={iconSize['14']} />
      </span>
    );
  }
  return null;
}
