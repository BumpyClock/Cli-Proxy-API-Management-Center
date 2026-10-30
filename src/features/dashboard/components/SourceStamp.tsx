import { useTranslation } from 'react-i18next';
import type { SourceFreshness, SourceStatus } from '../logic/freshness';
import { oldestReceipt } from '../logic/freshness';
import { formatAge } from './formatters';
import styles from './SourceStamp.module.scss';

interface SourceStampProps {
  /** Every source the section is built from; the oldest receipt is shown. */
  sources: SourceStatus[];
  freshness: SourceFreshness;
  now: number;
  className?: string;
}

/**
 * Age and state of the data behind one section: "Updated 15s ago", "Stale · updated 3m
 * ago", or "Not updating · data from 3m ago". Text carries the state; color only helps.
 */
export function SourceStamp({ sources, freshness, now, className }: SourceStampProps) {
  const { t } = useTranslation();
  const receivedAt =
    oldestReceipt(sources) ?? sources.find((source) => source.receivedAt)?.receivedAt;
  const age = receivedAt ? formatAge(t, receivedAt, now) : null;

  let text: string;
  if (freshness === 'failed') {
    text = age ? t('dashboard.stamp_failed', { age }) : t('dashboard.stamp_failed_empty');
  } else if (freshness === 'stale' && age) {
    text = t('dashboard.stamp_stale', { age });
  } else if (age) {
    text = t('dashboard.updated', { age });
  } else {
    text = t('dashboard.stamp_loading');
  }

  return (
    <span
      className={[styles.stamp, styles[`stamp_${freshness}`], className].filter(Boolean).join(' ')}
    >
      {text}
    </span>
  );
}
