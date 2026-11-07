import type { TFunction } from 'i18next';
import type { CredentialHealth } from '../types';

/**
 * Line under the Credential files value. The value already states how many serve, so the
 * line lists only exceptions and is empty when there are none.
 */
export function credentialsVitalLine(
  credentials: Pick<CredentialHealth, 'total' | 'limited' | 'problems' | 'disabled'>,
  t: TFunction
): string {
  if (credentials.total === 0) return t('dashboard.vitals_credentials_none');
  return [
    // "including N limited" qualifies the serving count, so it comes first.
    credentials.limited > 0
      ? t('dashboard.vitals_credentials_limited', { count: credentials.limited })
      : null,
    credentials.problems > 0
      ? t('dashboard.vitals_credentials_problems', { count: credentials.problems })
      : null,
    credentials.disabled > 0
      ? t('dashboard.vitals_credentials_disabled', { count: credentials.disabled })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
