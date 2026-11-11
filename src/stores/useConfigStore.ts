/**
 * 配置状态管理
 * 从原项目 src/core/config-service.js 迁移
 */

import { create } from 'zustand';
import type { Config } from '@/types';
import { configApi } from '@/services/api/config';
import { CACHE_EXPIRY_MS } from '@/utils/constants';

interface ConfigCache {
  data: Config;
  timestamp: number;
}

interface ConfigState {
  config: Config | null;

  // 操作
  fetchConfig: (forceRefresh?: boolean) => Promise<Config>;
  setRequestLog: (enabled: boolean) => void;
  invalidateCache: () => void;
  clearCache: () => void;
  isCacheValid: () => boolean;
}

let configRequestToken = 0;
let inFlightConfigRequest: { id: number; promise: Promise<Config> } | null = null;
let fullConfigCache: ConfigCache | null = null;

const isFullCacheValid = () =>
  fullConfigCache !== null && Date.now() - fullConfigCache.timestamp < CACHE_EXPIRY_MS;

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,

  fetchConfig: async (forceRefresh = false) => {
    // 检查缓存
    if (!forceRefresh && fullConfigCache && isFullCacheValid()) {
      return fullConfigCache.data;
    }

    // 同一时刻合并多个 /config 请求（如 StrictMode 或多个页面同时触发）
    if (inFlightConfigRequest) {
      return inFlightConfigRequest.promise;
    }

    const requestId = (configRequestToken += 1);
    try {
      const requestPromise = configApi.getConfig();
      inFlightConfigRequest = { id: requestId, promise: requestPromise };
      const data = await requestPromise;

      // 如果在请求过程中连接已被切换/登出，则忽略旧请求的结果，避免覆盖新会话的状态
      if (requestId !== configRequestToken) {
        return data;
      }

      fullConfigCache = { data, timestamp: Date.now() };
      set({ config: data });
      return data;
    } finally {
      if (inFlightConfigRequest?.id === requestId) {
        inFlightConfigRequest = null;
      }
    }
  },

  setRequestLog: (requestLog) => {
    set((state) => ({ config: { ...state.config, requestLog } }));
    get().invalidateCache();
  },

  invalidateCache: () => {
    fullConfigCache = null;
    configRequestToken += 1;
    inFlightConfigRequest = null;
  },

  clearCache: () => {
    get().invalidateCache();
    set({ config: null });
  },

  isCacheValid: () => isFullCacheValid(),
}));
