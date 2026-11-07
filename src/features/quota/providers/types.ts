/**
 * 额度提供商数据层契约。
 *
 * data.ts 模块只做「取数 + 状态构造」：不 import React、不 import SCSS，
 * 因此可以被 bun:test 纯逻辑测试直接消费。渲染由同目录的 *QuotaBody 组件承担。
 */

import type { TFunction } from 'i18next';
import type { QuotaObservations } from './observations';
import type {
  AntigravityQuotaState,
  AuthFileItem,
  ClaudeQuotaState,
  CodexQuotaState,
  CopilotQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  QoderQuotaState,
  PluginQuotaState,
  XaiQuotaState,
} from '@/types';

export type QuotaUpdater<T> = T | ((prev: T) => T);

export type QuotaProviderType =
  | 'antigravity'
  | 'claude'
  | 'codex'
  | 'github-copilot'
  | 'devin'
  | 'kimi'
  | 'meta'
  | 'qoder'
  | 'plugin'
  | 'xai';

/** useQuotaStore 的结构契约（storeSelector/storeSetter 依赖）。 */
export interface QuotaStore {
  antigravityQuota: Record<string, AntigravityQuotaState>;
  claudeQuota: Record<string, ClaudeQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  copilotQuota: Record<string, CopilotQuotaState>;
  devinQuota: Record<string, DevinQuotaState>;
  kimiQuota: Record<string, KimiQuotaState>;
  metaQuota: Record<string, MetaQuotaState>;
  qoderQuota: Record<string, QoderQuotaState>;
  pluginQuota: Record<string, PluginQuotaState>;
  xaiQuota: Record<string, XaiQuotaState>;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setClaudeQuota: (updater: QuotaUpdater<Record<string, ClaudeQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setCopilotQuota: (updater: QuotaUpdater<Record<string, CopilotQuotaState>>) => void;
  setDevinQuota: (updater: QuotaUpdater<Record<string, DevinQuotaState>>) => void;
  setKimiQuota: (updater: QuotaUpdater<Record<string, KimiQuotaState>>) => void;
  setMetaQuota: (updater: QuotaUpdater<Record<string, MetaQuotaState>>) => void;
  setQoderQuota: (updater: QuotaUpdater<Record<string, QoderQuotaState>>) => void;
  setXaiQuota: (updater: QuotaUpdater<Record<string, XaiQuotaState>>) => void;
  setPluginQuota: (updater: QuotaUpdater<Record<string, PluginQuotaState>>) => void;
  clearQuotaCache: () => void;
}

export interface QuotaCardState {
  status: 'idle' | 'loading' | 'success' | 'error';
  error?: string;
  errorStatus?: number;
  refreshing?: boolean;
  stale?: boolean;
  checkedAt?: number;
}

export interface QuotaProviderData<TState extends QuotaCardState, TData> {
  type: QuotaProviderType;
  i18nPrefix: string;
  filterFn: (file: AuthFileItem) => boolean;
  /** Explicit provider request. Some providers historically include inference here. */
  fetchQuota: (file: AuthFileItem, t: TFunction) => Promise<TData>;
  /** Whether this credential exposes an allowance to ordinary observation. */
  canObserve?: (file: AuthFileItem) => boolean;
  /** Override explicit requests with a non-generative read, or require a fresh auth-file list. */
  observation?:
    | { source: 'auth-files' }
    | { source: 'remote'; read: (file: AuthFileItem, t: TFunction) => Promise<TData> };
  healthTest?: {
    run: (file: AuthFileItem, t: TFunction) => Promise<TData>;
    labelKey: string;
    labelFallback: string;
  };
  resetQuota?: (file: AuthFileItem, t: TFunction) => Promise<TData>;
  canResetQuota?: (quota: TState) => boolean;
  getObservations: (state: TState) => QuotaObservations;
  storeSelector: (state: QuotaStore) => Record<string, TState>;
  storeSetter: keyof QuotaStore;
  buildLoadingState: () => TState;
  buildSuccessState: (data: TData) => TState;
  buildErrorState: (message: string, status?: number) => TState;
}
