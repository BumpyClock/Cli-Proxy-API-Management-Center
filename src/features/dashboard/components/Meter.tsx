import { formatPercent } from '@/utils/format';
import { toneForSuccessRate, type MeterTone } from '../utils';
import styles from './Meter.module.scss';

const TONE_COLORS: Record<MeterTone, string> = {
  good: 'var(--viz-success, #10b981)',
  warning: 'var(--amber-color)',
  critical: 'var(--viz-failure, #c65746)',
  idle: 'var(--text-quaternary)',
};

interface MeterProps {
  /** 0 to 100; null means no requests in the window (the caller states that in text). */
  value: number | null;
  tone?: MeterTone;
  ariaLabel: string;
  className?: string;
}

/**
 * Thin meter: the fill carries severity and the track is a faded step of the same colour,
 * so the state reads along the whole bar. A rate is exposed as role="meter"; with no rate
 * the bar is decorative and hidden from assistive technology.
 */
export function Meter({ value, tone, ariaLabel, className }: MeterProps) {
  const resolvedTone = tone ?? toneForSuccessRate(value);
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div
      className={[styles.track, className].filter(Boolean).join(' ')}
      style={{ '--meter-fill': TONE_COLORS[resolvedTone] } as React.CSSProperties}
      {...(value === null
        ? { 'aria-hidden': true }
        : {
            role: 'meter',
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': Number(clamped.toFixed(1)),
            'aria-valuetext': formatPercent(clamped),
            'aria-label': ariaLabel,
          })}
    >
      <div className={styles.fill} style={{ width: `${clamped}%` }} />
    </div>
  );
}
