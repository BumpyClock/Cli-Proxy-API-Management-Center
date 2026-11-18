import { oauthApi, pluginsApi, type BuiltInOAuthProvider } from '@/services/api';
import { buildPluginOAuthProviderCards, type PluginOAuthProviderCard } from './pluginOAuthEntries';
import {
  KIMI_CHINESE_AFFILIATE_URL,
  KIMI_INTERNATIONAL_AFFILIATE_URL,
} from '@/features/providers/kimi';
import iconMeta from '@/assets/icons/meta.svg';
import iconCodex from '@/assets/icons/codex.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconAntigravity from '@/assets/icons/antigravity.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconKimiDark from '@/assets/icons/kimi-dark.svg';
import iconGrok from '@/assets/icons/grok.svg';
import iconGrokDark from '@/assets/icons/grok-dark.svg';
import iconDevin from '@/assets/icons/devin.svg';
import iconDevinDark from '@/assets/icons/devin-dark.svg';
import iconCopilot from '@/assets/icons/github-copilot.svg';
import iconIFlow from '@/assets/icons/iflow.svg';
import iconQoder from '@/assets/icons/qoder.svg';

export type CallbackMode = 'standard' | 'xai' | 'devin' | 'kiro';

export interface OAuthMethod {
  value: string;
  label: string;
  callback?: CallbackMode;
}

interface OAuthCapabilities {
  callback?: CallbackMode;
  cancellable?: boolean;
  methods?: [OAuthMethod, ...OAuthMethod[]];
  credentialImport?: 'gitlab' | 'iflow';
}

interface BuiltInOAuthProviderCard extends OAuthCapabilities {
  kind: 'builtin';
  id: BuiltInOAuthProvider;
  titleKey: string;
  icon: string | { light: string; dark: string };
  familyTitleKey?: string;
}

interface PlusOAuthProviderCard extends OAuthCapabilities {
  kind: 'plus';
  id: string;
  title: string;
  icon: string;
}

export type OAuthProviderCard =
  BuiltInOAuthProviderCard | PlusOAuthProviderCard | (PluginOAuthProviderCard & OAuthCapabilities);

export const PROVIDERS: BuiltInOAuthProviderCard[] = [
  {
    kind: 'builtin',
    id: 'meta',
    titleKey: 'auth_login.meta_oauth_title',
    icon: iconMeta,
  },
  {
    kind: 'builtin',
    id: 'kimi',
    titleKey: 'auth_login.kimi_oauth_title',
    familyTitleKey: 'auth_login.family_kimi',
    icon: { light: iconKimiDark, dark: iconKimiLight },
  },
  {
    kind: 'builtin',
    id: 'kimi-ai',
    titleKey: 'auth_login.kimi_ai_oauth_title',
    familyTitleKey: 'auth_login.family_kimi',
    icon: { light: iconKimiDark, dark: iconKimiLight },
  },
  {
    kind: 'builtin',
    id: 'codex',
    callback: 'standard',
    titleKey: 'auth_login.codex_oauth_title',
    icon: iconCodex,
  },
  {
    kind: 'builtin',
    id: 'anthropic',
    callback: 'standard',
    titleKey: 'auth_login.anthropic_oauth_title',
    icon: iconClaude,
  },
  {
    kind: 'builtin',
    id: 'antigravity',
    callback: 'standard',
    titleKey: 'auth_login.antigravity_oauth_title',
    icon: iconAntigravity,
  },
  {
    kind: 'builtin',
    id: 'xai',
    callback: 'xai',
    titleKey: 'auth_login.xai_oauth_title',
    icon: { light: iconGrok, dark: iconGrokDark },
  },
  {
    kind: 'builtin',
    id: 'devin',
    callback: 'devin',
    cancellable: true,
    titleKey: 'auth_login.devin_oauth_title',
    icon: { light: iconDevin, dark: iconDevinDark },
  },
];

const PLUS_PROVIDERS: PlusOAuthProviderCard[] = [
  {
    kind: 'plus',
    cancellable: true,
    id: 'github-copilot',
    title: 'GitHub Copilot',
    icon: iconCopilot,
  },
  { kind: 'plus', cancellable: true, id: 'cursor', title: 'Cursor', icon: '' },
  {
    kind: 'plus',
    cancellable: true,
    id: 'gitlab',
    title: 'GitLab Duo',
    icon: '',
    callback: 'standard',
    credentialImport: 'gitlab',
  },
  {
    kind: 'plus',
    cancellable: true,
    id: 'iflow',
    title: 'iFlow',
    icon: iconIFlow,
    callback: 'standard',
    credentialImport: 'iflow',
  },
  { kind: 'plus', cancellable: true, id: 'kilo', title: 'Kilo Code', icon: '' },
  {
    kind: 'plus',
    cancellable: true,
    id: 'kiro',
    title: 'Kiro',
    icon: '',
    methods: [
      { value: 'aws', label: 'AWS Builder ID' },
      { value: 'google', label: 'Google', callback: 'kiro' },
      { value: 'github', label: 'GitHub', callback: 'kiro' },
    ],
  },
  { kind: 'plus', cancellable: true, id: 'qoder', title: 'Qoder', icon: iconQoder },
];

export const KIMI_SIGN_UP_URLS: Partial<Record<BuiltInOAuthProvider, string>> = {
  kimi: KIMI_CHINESE_AFFILIATE_URL,
  'kimi-ai': KIMI_INTERNATIONAL_AFFILIATE_URL,
};
const BUILTIN_PROVIDER_IDS = new Set<string>(PROVIDERS.map((provider) => provider.id));

export async function loadOAuthProviderCards(apiBase: string, signal: AbortSignal) {
  const [plugins, plus] = await Promise.allSettled([
    pluginsApi.list(),
    oauthApi.listPlusProviders(signal),
  ]);
  if (plugins.status === 'rejected') return { cards: PROVIDERS, failed: true };

  const pluginCards = buildPluginOAuthProviderCards(
    plugins.value.plugins,
    apiBase,
    BUILTIN_PROVIDER_IDS
  );
  const plusCards =
    plus.status === 'fulfilled'
      ? PLUS_PROVIDERS.filter(
          ({ id }) => plus.value.includes(id) && !pluginCards.some((plugin) => plugin.id === id)
        )
      : [];
  const cards: OAuthProviderCard[] = [
    ...PROVIDERS,
    ...plusCards,
    ...pluginCards.map((plugin) => ({ ...plugin, callback: 'standard' as const })),
  ];
  return { cards, failed: plus.status === 'rejected' };
}
