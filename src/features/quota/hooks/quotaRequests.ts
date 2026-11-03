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
import {
  getQuotaSetter,
  QUOTA_ADAPTERS,
  type QuotaAdapter,
  type QuotaCardState,
} from '../providers';
import type { QuotaFileEntry } from '../logic';
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

type SnapshotUpdate = (previous: QuotaCardState | undefined) => QuotaCardState;
interface OwnedRequest {
  key: string;
  cacheKey: string;
  request: PendingRequest;
  file: AuthFileItem;
  operation: QuotaOperation;
  resolve: (result: QuotaRequestResult) => void;
}
interface Outcome {
  owner: OwnedRequest;
  result: QuotaRequestResult;
  update?: SnapshotUpdate;
}

function isCurrent(owner: OwnedRequest) {
  return (
    pending.get(owner.key) === owner.request &&
    commitIfQuotaCacheCurrent(owner.request.generation, () => {})
  );
}

function publish(
  adapter: QuotaAdapter,
  updates: { owner: OwnedRequest; update: SnapshotUpdate }[]
) {
  if (!updates.some(({ owner }) => isCurrent(owner))) return;
  getQuotaSetter(adapter)((previous) => {
    let next: typeof previous | undefined;
    for (const { owner, update } of updates) {
      if (!isCurrent(owner)) continue;
      next ??= { ...previous };
      next[owner.cacheKey] = update(next[owner.cacheKey]);
    }
    return next ?? previous;
  });
}

async function runGroup(adapter: QuotaAdapter, owners: OwnedRequest[], t: TFunction) {
  publish(
    adapter,
    owners.map((owner) => ({
      owner,
      update: (previous) => checkingSnapshot(previous, adapter.buildLoadingState()),
    }))
  );

  // Wait for reads, not public request promises: those resolve only after publication.
  const outcomes = await Promise.all(
    owners.map(async (owner): Promise<Outcome> => {
      try {
        if (!isCurrent(owner)) return { owner, result: { status: 'superseded' } };
        let currentFile = owner.file;
        if (owner.operation === 'observe' && adapter.observation?.source === 'auth-files') {
          const snapshot = await readCurrentAuthFiles();
          const match = snapshot.files.find(
            (candidate) =>
              getQuotaCacheKey(candidate) === owner.cacheKey && adapter.filterFn(candidate)
          );
          if (!match) throw new Error(t(`${adapter.i18nPrefix}.empty_data`));
          currentFile = match;
        }
        if (!isCurrent(owner)) return { owner, result: { status: 'superseded' } };
        const read = {
          observe:
            adapter.observation?.source === 'remote'
              ? adapter.observation.read
              : adapter.fetchQuota,
          'health-test': adapter.healthTest?.run,
          reset: adapter.resetQuota,
        }[owner.operation];
        if (!read) throw new Error(t('common.unknown_error'));
        const data = await read(currentFile, t);
        const checkedAt = Date.now();
        const state = adapter.buildSuccessState(data);
        return {
          owner,
          result: { status: 'success', checkedAt },
          update: () => successfulSnapshot(state, checkedAt),
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : t('common.unknown_error');
        const state = adapter.buildErrorState(message, getStatusFromError(error));
        return {
          owner,
          result: { status: 'error', message },
          update: (previous) => failedSnapshot(previous, state),
        };
      }
    })
  );

  const applicable = outcomes.filter((outcome) => outcome.update && isCurrent(outcome.owner));
  publish(
    adapter,
    applicable.map(({ owner, update }) => ({ owner, update: update! }))
  );
  for (const { owner, result } of outcomes) {
    const current = isCurrent(owner);
    if (pending.get(owner.key) === owner.request) pending.delete(owner.key);
    owner.resolve(current ? result : { status: 'superseded' });
  }
}

function ownRequest(
  file: AuthFileItem,
  adapter: QuotaAdapter,
  operation: QuotaOperation,
  owners: OwnedRequest[]
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
  )
    return existing.promise;

  let resolve!: (result: QuotaRequestResult) => void;
  const promise = new Promise<QuotaRequestResult>((done) => {
    resolve = done;
  });
  const request = { generation: captureQuotaCacheGeneration(file.name), operation, promise };
  pending.set(key, request);
  owners.push({ key, cacheKey, request, file, operation, resolve });
  return promise;
}

/** One commit owner for batch, row, auth-file, health-test and reset requests. */
export function requestQuota(
  file: AuthFileItem,
  adapter: QuotaAdapter,
  t: TFunction,
  operation: QuotaOperation = 'observe'
): Promise<QuotaRequestResult> {
  const owners: OwnedRequest[] = [];
  const result = ownRequest(file, adapter, operation, owners);
  if (owners.length) void Promise.resolve().then(() => runGroup(adapter, owners, t));
  return result;
}

/** Explicit bulk observations publish once per provider at each phase. */
export function requestQuotaBatch(targets: QuotaFileEntry[], t: TFunction) {
  const groups = new Map<QuotaAdapter, OwnedRequest[]>();
  const results = targets.map(({ file, type }) => {
    const adapter = QUOTA_ADAPTERS[type];
    let owners = groups.get(adapter);
    if (!owners) groups.set(adapter, (owners = []));
    return ownRequest(file, adapter, 'observe', owners);
  });
  for (const [adapter, owners] of groups) {
    if (owners.length) void Promise.resolve().then(() => runGroup(adapter, owners, t));
  }
  return Promise.all(results);
}
