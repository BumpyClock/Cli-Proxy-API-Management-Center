import type { AntigravityQuotaBucket } from '@/types';

const LABEL_KEYS = new Map<string, string>([
  ['weekly limit', 'weekly_limit'],
  ['daily limit', 'daily_limit'],
  ['5 hour limit', 'five_hour_limit'],
  ['5-hour limit', 'five_hour_limit'],
  ['five hour limit', 'five_hour_limit'],
  ['five-hour limit', 'five_hour_limit'],
  ['monthly limit', 'monthly_limit'],
]);
const WINDOW_KEYS = new Map<string, string>([
  ['5h', 'five_hour_limit'],
  ['five-hour', 'five_hour_limit'],
  ['five_hour', 'five_hour_limit'],
  ['daily', 'daily_limit'],
  ['day', 'daily_limit'],
  ['weekly', 'weekly_limit'],
  ['week', 'weekly_limit'],
  ['monthly', 'monthly_limit'],
  ['month', 'monthly_limit'],
]);
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

export function resolveAntigravityBucketLabelKey(label: string, window?: string): string | null {
  const normalized = normalize(label)
    .replace(/\s*(?:-|:)?\s*remaining$/, '')
    .trim();
  return LABEL_KEYS.get(normalized) ?? (window ? WINDOW_KEYS.get(normalize(window)) : null) ?? null;
}

type Bucket = Pick<AntigravityQuotaBucket, 'label' | 'window' | 'remainingFraction'>;

export function shouldShowAntigravityQuotaAvailable(
  bucket: Bucket,
  group: readonly Bucket[]
): boolean {
  if (bucket.remainingFraction !== 1) return false;
  if (resolveAntigravityBucketLabelKey(bucket.label, bucket.window) !== 'five_hour_limit')
    return true;
  // A full short window is still blocked when its shared weekly allowance is exhausted.
  return !group.some(
    (item) =>
      resolveAntigravityBucketLabelKey(item.label, item.window) === 'weekly_limit' &&
      item.remainingFraction <= 0
  );
}
