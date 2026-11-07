import { useTranslation } from 'react-i18next';
import { Meter } from './Meter';
import type { MeterTone } from '../utils';
import styles from './VitalsStrip.module.scss';

export interface Vital {
  key: string;
  label: string;
  /** The figure, or null when there is none to show (rendered as a muted dash). */
  value: string | null;
  /** Small word after the value, e.g. "serving". */
  unit?: string;
  /** Secondary line: the evidence behind the value. */
  detail?: React.ReactNode;
  /** Exceptions only; healthy vitals stay neutral. */
  tone?: 'warning' | 'critical';
  meter?: { value: number | null; tone: MeterTone; label: string };
}

interface VitalsStripProps {
  items: Vital[];
  ariaLabel: string;
}

/**
 * The page's four vital numbers in one ruled strip, read left to right like a status
 * line. A single surface with dividers instead of a grid of interchangeable cards.
 */
export function VitalsStrip({ items, ariaLabel }: VitalsStripProps) {
  const { t } = useTranslation();
  return (
    <section className={styles.strip} aria-label={ariaLabel}>
      <dl className={styles.list}>
        {items.map((item) => (
          <div
            key={item.key}
            className={[styles.vital, item.tone ? styles[item.tone] : ''].filter(Boolean).join(' ')}
          >
            <dt className={styles.label}>{item.label}</dt>
            {item.value === null ? (
              <dd className={`${styles.value} ${styles.unavailable}`}>
                <span aria-hidden="true">—</span>
                <span className={styles.srOnly}>{t('dashboard.vitals_unavailable')}</span>
              </dd>
            ) : (
              <dd className={styles.value}>
                {item.value}
                {item.unit && <span className={styles.unit}> {item.unit}</span>}
              </dd>
            )}
            {item.meter && (
              <dd className={styles.meterRow}>
                <Meter
                  value={item.meter.value}
                  tone={item.meter.tone}
                  ariaLabel={item.meter.label}
                  className={styles.meter}
                />
              </dd>
            )}
            {item.detail && <dd className={styles.detail}>{item.detail}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}
