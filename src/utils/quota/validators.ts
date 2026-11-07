/**
 * Validation and type checking functions for quota management.
 */

import type { AuthFileItem } from '@/types';

export function resolveAuthProvider(file: AuthFileItem): string {
  const raw = file.provider ?? file.type ?? '';
  const key = String(raw).trim().toLowerCase().replace(/_/g, '-');
  if (key === 'x-ai' || key === 'grok') return 'xai';
  if (key === 'kimi-ai') return 'kimi';
  if (key === 'copilot' || key === 'github') return 'github-copilot';
  return key;
}

export function isAntigravityFile(file: AuthFileItem): boolean {
  return resolveAuthProvider(file) === 'antigravity';
}

export function isClaudeFile(file: AuthFileItem): boolean {
  return resolveAuthProvider(file) === 'claude';
}

export function isCodexFile(file: AuthFileItem): boolean {
  return resolveAuthProvider(file) === 'codex';
}

export function isCopilotFile(file: AuthFileItem): boolean {
  return resolveAuthProvider(file) === 'github-copilot';
}

export function isDevinFile(file: AuthFileItem): boolean {
  return resolveAuthProvider(file) === 'devin';
}

export function isKimiFile(file: AuthFileItem): boolean {
  return resolveAuthProvider(file) === 'kimi';
}

export function isQoderFile(file: AuthFileItem): boolean {
  return resolveAuthProvider(file) === 'qoder';
}

export function isXaiFile(file: AuthFileItem): boolean {
  return resolveAuthProvider(file) === 'xai';
}

export function isDisabledAuthFile(file: AuthFileItem): boolean {
  const raw = (file as { disabled?: unknown }).disabled;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
}

/** Only use advertised generic quotas when no built-in adapter owns this provider. */
export function isPluginQuotaFile(file: AuthFileItem): boolean {
  const supported = file.supportsQuota ?? file['supports_quota'];
  if (supported !== true && supported !== 'true' && supported !== '1') return false;
  return ![
    'antigravity',
    'claude',
    'codex',
    'github-copilot',
    'devin',
    'kimi',
    'meta',
    'qoder',
    'xai',
  ].includes(resolveAuthProvider(file));
}
