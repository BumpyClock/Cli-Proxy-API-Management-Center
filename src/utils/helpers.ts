/**
 * 辅助工具函数
 * 从原项目 src/utils/array.js, dom.js, html.js 迁移
 */

import i18next from 'i18next';

/**
 * 生成唯一 ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 判断是否为普通对象（排除 null 与数组）
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const isRequestCancelled = (error: unknown): boolean =>
  isRecord(error) && (error.name === 'AbortError' || error.code === 'ERR_CANCELED');

/**
 * 从 unknown 错误中提取可读消息
 */
export const getErrorMessage = (error: unknown, fallback = ''): string => {
  const code = isRecord(error) ? error.apiCode : undefined;
  if (code === 'precondition_failed') {
    return i18next.t('common.config_changed') || fallback || code;
  }
  if (code === 'config_etag_unavailable') {
    return i18next.t('common.config_version_unavailable') || fallback || code;
  }
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string') return error || fallback;
  if (isRecord(error) && typeof error.message === 'string') return error.message || fallback;
  return fallback;
};
