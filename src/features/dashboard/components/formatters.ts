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

const MAX_MODEL_NAMES = 3;

/**
 * Why a credential is limited and when that may change, as separate lines:
 * "1 model cooling down: grok-4-heavy (Quota restriction · HTTP 429)" and
 * "Cooldown ends in 24m (08:28 GMT-7); recovery isn't guaranteed".
 *
 * A credential-level `next_retry_after` is when the router may use it again; model
 * cooldowns only say when the restriction expires. Neither promises recovery.
 */
export function credentialRecoveryLines(
  t: TFunction,
  row: CredentialRow,
  nowMs: number,
  locale?: string
): string[] {
  const lines: string[] = [];
  const cause = row.cooldown
    ? [
        row.cooldown.reason ? t(cooldownReasonKey(row.cooldown.reason)) : null,
        row.cooldown.httpStatus ? `HTTP ${row.cooldown.httpStatus}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  if (row.cooldown) {
    let scope: string;
    if (row.cooldown.credentialWide) {
      scope = t('dashboard.cooldown_credential');
    } else if (row.cooldown.models.length > 0) {
      const shown = row.cooldown.models.slice(0, MAX_MODEL_NAMES);
      const extra = row.cooldown.models.length - shown.length;
      scope = t('dashboard.cooldown_models_named', {
        count: row.cooldown.modelCount,
        models: extra > 0 ? `${shown.join(', ')} +${extra}` : shown.join(', '),
      });
    } else {
      scope = t('dashboard.cooldown_models', { count: row.cooldown.modelCount });
    }
    lines.push(cause ? `${scope} (${cause})` : scope);
  }

  if (row.state === 'disabled') return lines;
  const at = (ms: number) =>
    `${formatInstant(ms, nowMs, locale)} ${resolveTimeZoneLabel(new Date(ms))}`;
  if (row.nextRetryAtMs !== null && row.nextRetryAtMs > nowMs) {
    lines.push(
      t('dashboard.eligible_in', {
        duration: formatDuration(t, (row.nextRetryAtMs - nowMs) / 1000),
        time: at(row.nextRetryAtMs),
      })
    );
  } else if (row.cooldown && row.cooldown.earliestSeconds > 0) {
    const endsAt = credentialRetryAt(row);
    if (endsAt !== null && endsAt > nowMs) {
      lines.push(
        t('dashboard.cooldown_ends_in', {
          duration: formatDuration(t, (endsAt - nowMs) / 1000),
          time: at(endsAt),
        })
      );
    }
  }
  return lines;
}
