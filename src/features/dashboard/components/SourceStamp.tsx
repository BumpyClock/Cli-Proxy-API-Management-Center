import { useTranslation } from 'react-i18next';
import type { DashboardSourceId } from '../logic/attention';
import type { SourceFreshness, SourceStatus } from '../logic/freshness';
import { formatAge } from './formatters';
import styles from './SourceStamp.module.scss';

export interface StampEntry {
  id: DashboardSourceId;
  status: SourceStatus;
  freshness: SourceFreshness;
}

interface SourceStampProps {
  /** Every source the section is built from. */
  entries: StampEntry[];
  now: number;
  /** Polling interval, shown when it differs from the page's 15-second default. */
  everyMs?: number;
  className?: string;
}

const DEFAULT_EVERY_MS = 15_000;

/**
 * Age and state of the data behind one section. It never borrows another source's age:
 * a source that has not loaded is named as missing, a failing one shows how old its last
 * good data is, and otherwise the oldest receipt is shown. Text carries the state; colour
 * only reinforces it.
 */
export function SourceStamp({ entries, now, everyMs, className }: SourceStampProps) {
  const { t } = useTranslation();
  const name = (id: DashboardSourceId) => t(`dashboard.source_${id}`);
  const named = entries.length > 1;
  const oldest = (list: StampEntry[]) =>
    list.reduce<number | null>(
      (min, entry) =>
        entry.status.receivedAt === null
          ? min
          : min === null
            ? entry.status.receivedAt
            : Math.min(min, entry.status.receivedAt),
      null
    );

  const missing = entries.filter(
    (entry) => entry.freshness === 'failed' && entry.status.receivedAt === null
  );
  const failing = entries.filter((entry) => entry.freshness === 'failed');
  const stale = entries.filter((entry) => entry.freshness === 'stale');
  const pending = entries.some((entry) => entry.status.receivedAt === null);

  let tone: SourceFreshness = 'live';
  let text: string;
  if (missing.length > 0) {
    tone = 'failed';
    text = named
      ? t('dashboard.stamp_missing_named', {
          sources: missing.map((entry) => name(entry.id)).join(', '),
        })
      : t('dashboard.stamp_failed_empty');
  } else if (failing.length > 0) {
    tone = 'failed';
    const age = formatAge(t, oldest(failing) as number, now);
    text = named
      ? t('dashboard.stamp_failed_named', {
          sources: failing.map((entry) => name(entry.id)).join(', '),
          age,
        })
      : t('dashboard.stamp_failed', { age });
  } else if (pending) {
    tone = 'pending';
    text = t('dashboard.stamp_loading');
  } else if (stale.length > 0) {
    tone = 'stale';
    text = t('dashboard.stamp_stale', { age: formatAge(t, oldest(stale) as number, now) });
  } else {
    text = t('dashboard.updated', { age: formatAge(t, oldest(entries) as number, now) });
  }

  const every =
    everyMs && everyMs !== DEFAULT_EVERY_MS
      ? t('dashboard.stamp_every', { seconds: Math.round(everyMs / 1000) })
      : null;

  return (
    <span className={[styles.stamp, styles[`stamp_${tone}`], className].filter(Boolean).join(' ')}>
      {every ? `${text} · ${every}` : text}
    </span>
  );
}
