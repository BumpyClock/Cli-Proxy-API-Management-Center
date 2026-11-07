import type { TFunction } from 'i18next';
import type { ProviderBrand } from './types';

/**
 * Label for the action that creates a resource in `brand`, naming what gets created.
 * OpenAI-compatible resources are whole providers; every other brand creates an API key entry.
 */
export function getProviderCreateLabel(t: TFunction, brand: ProviderBrand): string {
  if (brand === 'openaiCompatibility') {
    return t('redesign.providers.addCompatibleProvider');
  }
  return t('redesign.providers.addKey', { provider: t(`providersPage.providerNames.${brand}`) });
}
