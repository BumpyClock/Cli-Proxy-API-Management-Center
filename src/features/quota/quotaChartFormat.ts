import type { TFunction } from 'i18next';
import type { TimeTickUnit } from '@/components/ui/TimeSeriesChart.types';
import { getTypeLabel } from '@/features/authFiles/constants';
import { resolveTimeZoneLabel } from '@/utils/time/timezone';
import type { QuotaAccount } from './quotaAccountSeries';

/**
 * The one account identity used by every quota chart, legend and glance row:
 * "Provider · file · window", with a stale mark when the snapshot is retained after a failure.
 */
export function formatQuotaSeriesLabel(parts: {
  provider: string;
  account: string;
  window?: string | null;
  stale?: string | null;
}): string {
  return [parts.provider, parts.account, parts.window, parts.stale].filter(Boolean).join(' · ');
}

export function quotaWindowLabel(account: QuotaAccount, t: TFunction): string | null {
  return account.window ? t(account.window.label, { defaultValue: account.window.label }) : null;
}

export function quotaAccountLabel(account: QuotaAccount, t: TFunction): string {
  return formatQuotaSeriesLabel({
    provider: getTypeLabel(t, account.entry.type),
    account: account.label,
    window: quotaWindowLabel(account, t),
    stale: account.quota?.stale ? t('redesign.quota.stale') : null,
  });
}

/**
 * Chart and reset times omit the zone on every label; callers state it once with
 * `quotaTimeZoneLabel`, the app-wide GMT offset notation.
 */
export function quotaTimeFormat(language: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(language, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Short axis labels: a day ("Nov 9"), or a clock time ("11:00 PM") within the 5-hour window. */
export function quotaTickFormat(
  language: string
): (timestamp: number, unit: TimeTickUnit) => string {
  const day = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' });
  const hour = new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' });
  return (timestamp, unit) => (unit === 'day' ? day : hour).format(timestamp);
}

export function quotaTimeZoneLabel(at: number): string {
  return resolveTimeZoneLabel(new Date(at));
}
