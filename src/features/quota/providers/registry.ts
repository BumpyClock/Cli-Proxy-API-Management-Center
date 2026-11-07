import { ANTIGRAVITY_CONFIG } from './antigravity/data';
import { CLAUDE_CONFIG } from './claude/data';
import { CODEX_CONFIG } from './codex/data';
import { COPILOT_CONFIG } from './copilot/data';
import { DEVIN_CONFIG } from './devin/data';
import { KIMI_CONFIG } from './kimi/data';
import { META_CONFIG } from './meta/data';
import { QODER_CONFIG } from './qoder/data';
import { PLUGIN_CONFIG } from './plugin/data';
import { XAI_CONFIG } from './xai/data';
import { observeQuota, type QuotaObservations } from './observations';
import type { QuotaCardState, QuotaProviderData, QuotaProviderType } from './types';

/** React-free registry; each provider owns interpretation of its concrete quota state. */
export const QUOTA_PROVIDER_DATA = {
  antigravity: ANTIGRAVITY_CONFIG,
  claude: CLAUDE_CONFIG,
  codex: CODEX_CONFIG,
  'github-copilot': COPILOT_CONFIG,
  devin: DEVIN_CONFIG,
  kimi: KIMI_CONFIG,
  meta: META_CONFIG,
  qoder: QODER_CONFIG,
  xai: XAI_CONFIG,
  plugin: PLUGIN_CONFIG,
} satisfies Record<QuotaProviderType, { type: QuotaProviderType }>;

/** Erase state/data correlation only where a runtime provider selects its typed adapter. */
export function getQuotaDataAdapter(
  provider: QuotaProviderType
): QuotaProviderData<QuotaCardState, unknown> {
  // SAFETY: provider selects the same concrete state owner that built and cached this quota.
  return QUOTA_PROVIDER_DATA[provider] as unknown as QuotaProviderData<QuotaCardState, unknown>;
}

export function getQuotaObservations(
  provider: QuotaProviderType,
  quota?: QuotaCardState
): QuotaObservations {
  return quota?.status === 'success'
    ? getQuotaDataAdapter(provider).getObservations(quota)
    : observeQuota([]);
}
