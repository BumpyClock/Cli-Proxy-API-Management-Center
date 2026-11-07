/**
 * Quota constants for API URLs, headers, and theme colors.
 */

import type { TypeColorSet } from '@/types';
import { providerColors } from '@/design-system';

// Theme colors for type badges (palette.provider in the design-token registry).
export const TYPE_COLORS: Record<string, TypeColorSet> = providerColors;

// Antigravity API configuration
export const ANTIGRAVITY_QUOTA_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
];

export const ANTIGRAVITY_CODE_ASSIST_URL =
  'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';

export const ANTIGRAVITY_CLI_VERSION = '1.0.13';
export const ANTIGRAVITY_CLIENT_NAME = 'aidev_client';
export const ANTIGRAVITY_CLIENT_PLATFORM = {
  osType: 'darwin',
  arch: 'arm64',
} as const;

type AntigravityUserAgentOptions = {
  version?: string;
  clientName?: string;
  osType?: string;
  arch?: string;
};

export const buildAntigravityUserAgent = ({
  version = ANTIGRAVITY_CLI_VERSION,
  clientName = ANTIGRAVITY_CLIENT_NAME,
  osType = ANTIGRAVITY_CLIENT_PLATFORM.osType,
  arch = ANTIGRAVITY_CLIENT_PLATFORM.arch,
}: AntigravityUserAgentOptions = {}) =>
  `antigravity/cli/${version} (${clientName}; os_type=${osType}; arch=${arch})`;

export const ANTIGRAVITY_USER_AGENT = buildAntigravityUserAgent();

export const ANTIGRAVITY_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': ANTIGRAVITY_USER_AGENT,
};

// Claude API configuration
export const CLAUDE_PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile';

export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export const CLAUDE_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'anthropic-beta': 'oauth-2025-04-20',
};

export const CLAUDE_USAGE_WINDOW_KEYS = [
  { key: 'five_hour', id: 'five-hour', labelKey: 'claude_quota.five_hour' },
  { key: 'seven_day', id: 'seven-day', labelKey: 'claude_quota.seven_day' },
  {
    key: 'seven_day_oauth_apps',
    id: 'seven-day-oauth-apps',
    labelKey: 'claude_quota.seven_day_oauth_apps',
  },
  { key: 'seven_day_opus', id: 'seven-day-opus', labelKey: 'claude_quota.seven_day_opus' },
  { key: 'seven_day_sonnet', id: 'seven-day-sonnet', labelKey: 'claude_quota.seven_day_sonnet' },
  { key: 'seven_day_cowork', id: 'seven-day-cowork', labelKey: 'claude_quota.seven_day_cowork' },
  { key: 'iguana_necktie', id: 'seven-day-fable', labelKey: 'claude_quota.seven_day_fable' },
] as const;

// Codex API configuration
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
export const CODEX_SUBSCRIPTION_URL = 'https://chatgpt.com/backend-api/subscriptions';
export const CODEX_RATE_LIMIT_RESET_CREDITS_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
export const CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume';

export const CODEX_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)',
};

// Kimi API configuration
export const KIMI_USAGE_URL = 'https://api.kimi.com/coding/v1/usages';

export const KIMI_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
};

// xAI/Grok API configuration
export const XAI_BILLING_WEEKLY_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';
export const XAI_BILLING_MONTHLY_URL = 'https://cli-chat-proxy.grok.com/v1/billing';
export const XAI_API_ME_URL = 'https://api.x.ai/v1/me';
export const XAI_API_CHAT_URL = 'https://api.x.ai/v1/chat/completions';
export const XAI_PAID_HEALTH_MODEL = 'grok-4.5';
export const XAI_GROK_CLIENT_VERSION = '0.2.91';
export const XAI_GROK_USER_AGENT = 'grok-pager/0.2.91 grok-shell/0.2.91 (macos; aarch64)';

export const XAI_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'x-xai-token-auth': 'xai-grok-cli',
  'x-grok-client-version': XAI_GROK_CLIENT_VERSION,
  accept: '*/*',
  'user-agent': XAI_GROK_USER_AGENT,
};

export const XAI_API_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  accept: 'application/json',
};
