import type { PluginListEntry } from '@/types';
import { getPluginTitle, resolvePluginAssetURL } from '@/features/plugins/pluginResources';

export interface PluginOAuthProviderCard {
  kind: 'plugin';
  id: string;
  title: string;
  icon: string;
}

export const buildPluginOAuthProviderCards = (
  plugins: readonly PluginListEntry[],
  apiBase: string,
  builtInProviderIds: ReadonlySet<string>
): PluginOAuthProviderCard[] => {
  const seenProviders = new Set(builtInProviderIds);
  return plugins.flatMap((plugin) => {
    if (!plugin.supportsOAuth || !plugin.effectiveEnabled) return [];
    const providers = plugin.oauthProviders?.length
      ? plugin.oauthProviders
      : plugin.oauthProvider
        ? [plugin.oauthProvider]
        : [];
    const pluginTitle = getPluginTitle(plugin);
    const pluginLogo = plugin.logo || plugin.metadata?.logo || '';
    return providers.flatMap((provider) => {
      if (seenProviders.has(provider)) return [];
      seenProviders.add(provider);
      const entry = plugin.oauthProviderEntries?.find((item) => item.identifier === provider);
      return [
        {
          kind: 'plugin' as const,
          id: provider,
          title: entry?.name || pluginTitle,
          icon: resolvePluginAssetURL(entry?.logo || pluginLogo, apiBase),
        },
      ];
    });
  });
};
