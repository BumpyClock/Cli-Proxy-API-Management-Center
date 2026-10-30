import { useTranslation } from 'react-i18next';
import type { SourceFreshness } from '../logic/freshness';
import styles from './StatusPills.module.scss';

export type ChipTone = 'good' | 'warning' | 'critical' | 'idle' | 'neutral';

interface StatusChipProps {
  tone: ChipTone;
  children: React.ReactNode;
  className?: string;
}

/** Text chip for a state. Color reinforces the label; it never carries meaning alone. */
export function StatusChip({ tone, children, className }: StatusChipProps) {
  return (
    <span className={[styles.chip, styles[`chip_${tone}`], className].filter(Boolean).join(' ')}>
      <i className={styles.chipDot} aria-hidden="true" />
      {children}
    </span>
  );
}

const FRESHNESS_TONE: Record<SourceFreshness, ChipTone> = {
  live: 'good',
  pending: 'neutral',
  stale: 'warning',
  failed: 'critical',
};

interface FreshnessBadgeProps {
  freshness: SourceFreshness;
}

/**
 * "Live" only while the data is younger than three polling intervals. Otherwise it says
 * "Stale" or "Not updating" so old numbers are never presented as current.
 */
export function FreshnessBadge({ freshness }: FreshnessBadgeProps) {
  const { t } = useTranslation();
  return (
    <span
      className={[styles.badge, styles[`chip_${FRESHNESS_TONE[freshness]}`]].join(' ')}
      role="status"
    >
      <i
        className={[styles.badgeDot, freshness === 'live' ? styles.badgeDotLive : '']
          .filter(Boolean)
          .join(' ')}
        aria-hidden="true"
      />
      {t(`dashboard.freshness_${freshness}`)}
    </span>
  );
}
