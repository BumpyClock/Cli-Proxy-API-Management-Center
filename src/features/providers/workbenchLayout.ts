import type { ProviderResource } from './types';

/**
 * Column budget for the ~760px of table space beside the 240px catalog at 1440px.
 * Base URL (null) takes the remainder; the table's min-width (SCSS) is this sum plus a
 * 120px Base URL floor, so narrower containers scroll instead of colliding.
 */
export const PROVIDER_TABLE_COLUMN_WIDTHS: ReadonlyArray<number | null> = [
  124,
  null,
  108,
  112,
  164,
  124,
];

/** Visible, non-secret name for a resource, used in row action labels. */
export const getResourceActionName = (resource: ProviderResource): string =>
  resource.name ?? resource.apiKeyPreview ?? resource.identifier ?? '';

/**
 * Not-configured providers start collapsed at every width while a configured provider is
 * selected. With nothing configured, or a not-configured provider selected, the catalog is the
 * setup path and stays open.
 */
export function shouldExpandUnconfigured(options: {
  configuredCount: number;
  activeIsConfigured: boolean;
}): boolean {
  return options.configuredCount === 0 || !options.activeIsConfigured;
}

export interface QuickStartStep {
  to: string;
  labelKey: string;
  destinationKey: string;
}

/** The general setup sequence. Each step opens the existing route that completes it. */
export const QUICK_START_STEPS: ReadonlyArray<QuickStartStep> = [
  {
    to: '/ai-providers',
    labelKey: 'redesign.providers.setupProvider',
    destinationKey: 'nav.ai_providers',
  },
  { to: '/oauth', labelKey: 'redesign.providers.setupOAuth', destinationKey: 'nav.oauth' },
  {
    to: '/config?field=apiKeys',
    labelKey: 'redesign.providers.setupClient',
    destinationKey: 'nav.config_management',
  },
  {
    to: '/usage',
    labelKey: 'redesign.providers.setupUsage',
    destinationKey: 'nav.usage_statistics',
  },
];

export type ProviderHealth = 'active' | 'disabled' | 'failing';

/** Matches the status bar's low-rate band (`statusRateLow`), so the word and colour agree. */
export const FAILING_SUCCESS_RATE = 50;

/**
 * One health word per resource. Disabled wins; an enabled resource is failing only when its
 * recent window has requests and fewer than half succeeded. Failure counts stay visible either way.
 */
export function getProviderHealth(
  disabled: boolean,
  recent: { success: number; failure: number } | null
): ProviderHealth {
  if (disabled) return 'disabled';
  if (!recent) return 'active';
  const total = recent.success + recent.failure;
  if (total === 0) return 'active';
  return (recent.success / total) * 100 < FAILING_SUCCESS_RATE ? 'failing' : 'active';
}
