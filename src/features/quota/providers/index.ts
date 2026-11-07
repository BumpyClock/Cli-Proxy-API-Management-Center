import type { ComponentType } from 'react';
import { useQuotaStore } from '@/stores';
import type { QuotaBodyProps } from '../types';
import type { QuotaCardState, QuotaProviderData, QuotaProviderType } from './types';
import { QUOTA_PROVIDER_DATA } from './registry';
import { AntigravityQuotaBody } from './antigravity/AntigravityQuotaBody';
import { ClaudeQuotaBody } from './claude/ClaudeQuotaBody';
import { CodexQuotaBody } from './codex/CodexQuotaBody';
import { CopilotQuotaBody } from './copilot/CopilotQuotaBody';
import { DevinQuotaBody } from './devin/DevinQuotaBody';
import { KimiQuotaBody } from './kimi/KimiQuotaBody';
import { MetaQuotaBody } from './meta/MetaQuotaBody';
import { QoderQuotaBody } from './qoder/QoderQuotaBody';
import { PluginQuotaBody } from './plugin/PluginQuotaBody';
import { XaiQuotaBody } from './xai/XaiQuotaBody';

export type { QuotaCardState } from './types';

export interface QuotaAdapter extends QuotaProviderData<QuotaCardState, unknown> {
  Body: ComponentType<QuotaBodyProps<QuotaCardState>>;
}

/** Check the concrete data/body pairing before exposing the runtime-selected UI adapter. */
function withBody<TState extends QuotaCardState, TData>(
  data: QuotaProviderData<TState, TData>,
  Body: ComponentType<QuotaBodyProps<NoInfer<TState>>>
): QuotaAdapter {
  // SAFETY: data builders and Body share TState before the provider-selected view erases it.
  return { ...data, Body } as unknown as QuotaAdapter;
}

export const QUOTA_ADAPTERS: Record<QuotaProviderType, QuotaAdapter> = {
  antigravity: withBody(QUOTA_PROVIDER_DATA.antigravity, AntigravityQuotaBody),
  claude: withBody(QUOTA_PROVIDER_DATA.claude, ClaudeQuotaBody),
  codex: withBody(QUOTA_PROVIDER_DATA.codex, CodexQuotaBody),
  'github-copilot': withBody(QUOTA_PROVIDER_DATA['github-copilot'], CopilotQuotaBody),
  devin: withBody(QUOTA_PROVIDER_DATA.devin, DevinQuotaBody),
  kimi: withBody(QUOTA_PROVIDER_DATA.kimi, KimiQuotaBody),
  meta: withBody(QUOTA_PROVIDER_DATA.meta, MetaQuotaBody),
  qoder: withBody(QUOTA_PROVIDER_DATA.qoder, QoderQuotaBody),
  xai: withBody(QUOTA_PROVIDER_DATA.xai, XaiQuotaBody),
  plugin: withBody(QUOTA_PROVIDER_DATA.plugin, PluginQuotaBody),
};

export type QuotaMapUpdater = (
  updater: (prev: Record<string, QuotaCardState>) => Record<string, QuotaCardState>
) => void;

/** Read the matching setter without subscribing to the store. */
export const getQuotaSetter = (adapter: QuotaAdapter): QuotaMapUpdater =>
  // SAFETY: registered storeSetter names the updater for this adapter's concrete quota map.
  useQuotaStore.getState()[adapter.storeSetter] as unknown as QuotaMapUpdater;

export const getQuotaMap = (adapter: QuotaAdapter): Record<string, QuotaCardState> =>
  adapter.storeSelector(useQuotaStore.getState());
