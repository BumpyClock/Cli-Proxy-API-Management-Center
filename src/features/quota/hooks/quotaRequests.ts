import type { TFunction } from 'i18next';
import { authFilesApi } from '@/services/api';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useQuotaStore,
} from '@/stores/useQuotaStore';
import type { AuthFileItem } from '@/types';
import { getStatusFromError } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { getQuotaSetter, type QuotaAdapter } from '../providers';
import { checkingSnapshot, failedSnapshot, successfulSnapshot } from '../snapshotState';

export type QuotaOperation = 'observe' | 'health-test' | 'reset';
export type QuotaRequestResult =
  | { status: 'success'; checkedAt: number }
  | { status: 'error'; message: string }
  | { status: 'skipped' }
  | { status: 'superseded' };

type Generation = ReturnType<typeof captureQuotaCacheGeneration>;
interface PendingRequest {
  generation: Generation;
  operation: QuotaOperation;
  promise: Promise<QuotaRequestResult>;
}

// Route lifetimes do not own requests. Every consumer joins this per-credential owner.
const pending = new Map<string, PendingRequest>();
let authFilesRead:
  | {
      generation: Generation;
      fileGenerations: Readonly<Record<string, number>>;
      promise: ReturnType<typeof authFilesApi.list>;
    }
  | undefined;

function readCurrentAuthFiles() {
  if (
    authFilesRead &&
    authFilesRead.fileGenerations === useQuotaStore.getState().fileGenerations &&
    commitIfQuotaCacheCurrent(authFilesRead.generation, () => {})
  ) {
    return authFilesRead.promise;
  }
  const read = {
    generation: captureQuotaCacheGeneration(),
    fileGenerations: useQuotaStore.getState().fileGenerations,
    promise: authFilesApi.list(),
  };
  authFilesRead = read;
  void read.promise
    .finally(() => {
      if (authFilesRead === read) authFilesRead = undefined;
    })
    .catch(() => {});
  return read.promise;
}

/** One commit owner for batch, row, auth-file, health-test and reset requests. */
export function requestQuota(
  file: AuthFileItem,
  adapter: QuotaAdapter,
  t: TFunction,
  operation: QuotaOperation = 'observe'
): Promise<QuotaRequestResult> {
  if (operation === 'observe' && adapter.canObserve?.(file) === false) {
    return Promise.resolve({ status: 'skipped' });
  }
  const cacheKey = getQuotaCacheKey(file);
  const key = `${adapter.type}:${cacheKey}`;
  const existing = pending.get(key);
  if (
    existing &&
    commitIfQuotaCacheCurrent(existing.generation, () => {}) &&
    (operation === 'observe' || existing.operation === operation)
  ) {
    return existing.promise;
  }

  const generation = captureQuotaCacheGeneration(file.name);
  const setQuota = getQuotaSetter(adapter);
  // Defer execution until ownership is installed, including synchronous adapter failures.
  const request: PendingRequest = {
    generation,
    operation,
    promise: Promise.resolve().then(async (): Promise<QuotaRequestResult> => {
      const commit = (write: () => void) =>
        pending.get(key) === request && commitIfQuotaCacheCurrent(generation, write);
      try {
        if (
          !commit(() => {
            setQuota((previous) => ({
              ...previous,
              [cacheKey]: checkingSnapshot(previous[cacheKey], adapter.buildLoadingState()),
            }));
          })
        )
          return { status: 'superseded' };
        let currentFile = file;
        if (operation === 'observe' && adapter.observation?.source === 'auth-files') {
          const snapshot = await readCurrentAuthFiles();
          const match = snapshot.files.find(
            (candidate) => getQuotaCacheKey(candidate) === cacheKey && adapter.filterFn(candidate)
          );
          if (!match) throw new Error(t(`${adapter.i18nPrefix}.empty_data`));
          currentFile = match;
        }
        // A connection/file mutation during the list read also forbids starting the provider read.
        if (!commit(() => {})) return { status: 'superseded' };
        let read: QuotaAdapter['fetchQuota'] | undefined;
        switch (operation) {
          case 'observe':
            read =
              adapter.observation?.source === 'remote'
                ? adapter.observation.read
                : adapter.fetchQuota;
            break;
          case 'health-test':
            read = adapter.healthTest?.run;
            break;
          case 'reset':
            read = adapter.resetQuota;
            break;
        }
        if (!read) throw new Error(t('common.unknown_error'));
        const data = await read(currentFile, t);
        const checkedAt = Date.now();
        if (
          !commit(() => {
            setQuota((previous) => ({
              ...previous,
              [cacheKey]: successfulSnapshot(adapter.buildSuccessState(data), checkedAt),
            }));
          })
        )
          return { status: 'superseded' };
        return { status: 'success', checkedAt };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : t('common.unknown_error');
        if (
          !commit(() => {
            setQuota((previous) => ({
              ...previous,
              [cacheKey]: failedSnapshot(
                previous[cacheKey],
                adapter.buildErrorState(message, getStatusFromError(error))
              ),
            }));
          })
        )
          return { status: 'superseded' };
        return { status: 'error', message };
      } finally {
        if (pending.get(key) === request) pending.delete(key);
      }
    }),
  };
  pending.set(key, request);
  return request.promise;
}
