import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { getErrorMessage } from '@/utils/helpers';
import { createPoller, EMPTY_POLLER_STATE, type PollerState } from '../logic/poller';
import { redactSecrets } from '../logic/redact';

export interface PolledResource<T> extends PollerState<T> {
  /** Load now. Resolves with fresh data or rejects with the failure. */
  refresh: () => Promise<T>;
}

interface PolledResourceOptions<T> {
  load: (signal: AbortSignal) => Promise<T>;
  intervalMs: number;
  /** Upper bound for one attempt. */
  timeoutMs: number;
  enabled: boolean;
  /**
   * Connection identity. A change creates a fresh poller with empty state, so one
   * session's numbers can never land in another's view.
   */
  scope: string;
}

const isDocumentHidden = () =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';

const noopSubscribe = () => () => {};
const emptySnapshot = () => EMPTY_POLLER_STATE;

/**
 * Poll a source while the page is visible. Scheduling lives in `createPoller`; this hook
 * binds one poller per scope to React and to page visibility, focus, and network events.
 */
export function usePolledResource<T>({
  load,
  intervalMs,
  timeoutMs,
  enabled,
  scope,
}: PolledResourceOptions<T>): PolledResource<T> {
  const poller = useMemo(
    () =>
      enabled
        ? createPoller<T>({
            intervalMs,
            timeoutMs,
            isHidden: isDocumentHidden,
            describeError: (error) =>
              redactSecrets(getErrorMessage(error, 'Request failed')).slice(0, 200),
          })
        : null,
    // `scope` is a dependency on purpose: a new connection gets a new poller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, intervalMs, timeoutMs, scope]
  );

  // Declared before the start effect so the loader is in place for the first poll.
  useEffect(() => {
    poller?.setLoad(load);
  }, [poller, load]);

  useEffect(() => {
    if (!poller) return undefined;
    poller.start();
    const resume = () => poller.resume();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    return () => {
      poller.stop();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
    };
  }, [poller]);

  const state = useSyncExternalStore(
    poller ? poller.subscribe : noopSubscribe,
    poller ? poller.getSnapshot : (emptySnapshot as () => PollerState<T>),
    emptySnapshot as () => PollerState<T>
  ) as PollerState<T>;

  const refresh = useCallback(
    () => (poller ? poller.refresh() : Promise.reject(new Error('Not connected'))),
    [poller]
  );

  return useMemo(() => ({ ...state, refresh }), [state, refresh]);
}
