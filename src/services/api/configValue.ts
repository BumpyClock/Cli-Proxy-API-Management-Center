import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

/** Capture before a read and check before its dependent write. */
export function guardConfigConnection(): () => void {
  const revision = apiClient.getConnectionRevision();
  return () => {
    if (revision !== apiClient.getConnectionRevision()) {
      throw new DOMException('The management connection changed.', 'AbortError');
    }
  };
}

export function configWriteHeaders(etag: unknown): { 'If-Match': string } {
  if (typeof etag !== 'string' || !etag.trim()) {
    throw Object.assign(new Error('config_etag_unavailable'), {
      apiCode: 'config_etag_unavailable',
    });
  }
  return { 'If-Match': etag };
}

export async function readConfigResource(path: string, fallback: unknown) {
  const assertConnection = guardConfigConnection();
  const response = await apiClient.getRaw('/config');
  assertConnection();
  let value: unknown = response.data;
  if (!isRecord(value)) throw new Error('Invalid management configuration');
  for (const part of path.slice('/config'.length).split('/').filter(Boolean)) {
    if (value == null) break;
    if (!isRecord(value)) throw new Error('Invalid configuration resource');
    const key = decodeURIComponent(part);
    value = Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
  }
  const etag: unknown = response.headers.etag;
  return {
    value: value ?? fallback,
    replace(next: unknown): Promise<unknown> {
      assertConnection();
      return apiClient.put(path, next, { headers: configWriteHeaders(etag) });
    },
  };
}

export const isMissingConfigValue = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  error.status === 404 &&
  'apiCode' in error &&
  error.apiCode === 'not_found';

export async function getConfigValue<T>(path: string, fallback: T): Promise<T> {
  try {
    return await apiClient.get<T>(path);
  } catch (error) {
    if (isMissingConfigValue(error)) return fallback;
    throw error;
  }
}
