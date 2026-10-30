import type { TFunction } from 'i18next';
import { cooldownReasonKey } from '@/features/authFiles/cooldowns';
import { resolveTimeZoneLabel } from '@/utils/time/timezone';
import type { CredentialRow } from '../types';
import { credentialRetryAt } from '../logic/fleet';
import { ageParts, formatInstant } from '../logic/time';

/** "just now", "15s ago", "3m ago". */
export function formatAge(t: TFunction, sinceMs: number, nowMs: number): string {
  const { unit, value } = ageParts(sinceMs, nowMs);
  switch (unit) {
    case 'now':
      return t('dashboard.age_now');
    case 'second':
      return t('dashboard.age_seconds', { count: value });
    case 'minute':
      return t('dashboard.age_minutes', { count: value });
    case 'hour':
      return t('dashboard.age_hours', { count: value });
    default:
      return t('dashboard.age_days', { count: value });
  }
}

/** Compact duration for countdowns: "45s", "12m", "10h 7m", "2d 4h". */
export function formatDuration(t: TFunction, totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return t('dashboard.duration_s', { s: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('dashboard.duration_m', { m: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0
      ? t('dashboard.duration_h', { h: hours })
      : t('dashboard.duration_hm', { h: hours, m: rest });
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0
    ? t('dashboard.duration_d', { d: days })
    : t('dashboard.duration_dh', { d: days, h: restHours });
}

const DASH = '—';

/** `850 ms`, `1.2 s`, `14 s`. */
export function formatLatency(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

/**
 * Why a credential is limited and when it recovers, as separate lines:
 * "5 models cooling down (Model not supported · HTTP 404)" and
 * "retries in 10h 6m (11:06 GMT-7)".
 */
export function credentialRecoveryLines(
  t: TFunction,
  row: CredentialRow,
  nowMs: number,
  locale?: string
): string[] {
  const lines: string[] = [];
  if (row.cooldown) {
    const scope = row.cooldown.credentialWide
      ? t('dashboard.cooldown_credential')
      : t('dashboard.cooldown_models', { count: row.cooldown.modelCount });
    const cause = [
      row.cooldown.reason ? t(cooldownReasonKey(row.cooldown.reason)) : null,
      row.cooldown.httpStatus ? `HTTP ${row.cooldown.httpStatus}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(cause ? `${scope} (${cause})` : scope);
  }
  const retryAt = credentialRetryAt(row);
  if (retryAt !== null && retryAt > nowMs && row.state !== 'disabled') {
    lines.push(
      t('dashboard.retry_in', {
        duration: formatDuration(t, (retryAt - nowMs) / 1000),
        time: `${formatInstant(retryAt, nowMs, locale)} ${resolveTimeZoneLabel(new Date(retryAt))}`,
      })
    );
  }
  return lines;
}
