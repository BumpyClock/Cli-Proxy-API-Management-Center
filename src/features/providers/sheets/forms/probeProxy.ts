import { useConfigStore } from '@/stores/useConfigStore';

/** A cleared editor field must not re-inherit the credential's saved proxy. */
export const resolveProbeProxyUrl = (proxyUrl: string | undefined): string | undefined =>
  proxyUrl === undefined
    ? undefined
    : proxyUrl.trim() || useConfigStore.getState().config?.proxyUrl?.trim() || 'direct';
