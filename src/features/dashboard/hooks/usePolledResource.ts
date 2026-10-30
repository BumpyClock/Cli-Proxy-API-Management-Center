import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getErrorMessage } from '@/utils/helpers';
import { nextPollDelay } from '../logic/freshness';

export interface PolledResource<T> {
  data: T | null;
  /** Local receipt time of the last successful load. */
  receivedAt: number | null;
  /** Message from the latest failed attempt; cleared by the next success. */
  error: string | null;
  loading: boolean;
  /** Load now. Resolves with fresh data or rejects with the failure. */
  refresh: () => Promise<T>;
}

interface PolledResourceOptions<T> {
  load: () => Promise<T>;
  intervalMs: number;
  enabled: boolean;
  /**
   * Connection identity. A change discards data and ignores responses still in flight,
   * so one session's numbers can never land in another's view.
   */
  scope: string;
}

interface ResourceState<T> {
  scope: string;
  data: T | null;
  receivedAt: number | null;
  error: string | null;
  loading: boolean;
}

const emptyState = <T>(scope: string): ResourceState<T> => ({
  scope,
  data: null,
  receivedAt: null,
  error: null,
  loading: false,
});

const isDocumentHidden = () =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * Poll a source while the page is visible.
 *
 * - Polls are spaced from the last success, so a manual refresh resets the schedule.
 * - Hidden tabs stop polling. Returning to the tab, regaining focus, or coming back
 *   online refreshes immediately when the data is older than one interval.
 * - Failures keep the last good data and record the error, so the view can show
 *   "stale" rather than silently presenting old numbers as current.
 */
export function usePolledResource<T>({
  load,
  intervalMs,
  enabled,
  scope,
}: PolledResourceOptions<T>): PolledResource<T> {
  const [state, setState] = useState<ResourceState<T>>(() => emptyState<T>(scope));
  const loadRef = useRef(load);
  const scopeRef = useRef(scope);
  const receivedAtRef = useRef<number | null>(null);
  const inFlightRef = useRef<{ scope: string; promise: Promise<T> } | null>(null);
  const scheduleRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const run = useCallback((): Promise<T> => {
    const runScope = scopeRef.current;
    const inFlight = inFlightRef.current;
    if (inFlight && inFlight.scope === runScope) return inFlight.promise;

    setState((previous) => ({
      ...(previous.scope === runScope ? previous : emptyState<T>(runScope)),
      loading: true,
    }));

    const promise = loadRef.current().then(
      (data) => {
        if (scopeRef.current === runScope) {
          const receivedAt = Date.now();
          receivedAtRef.current = receivedAt;
          setState({ scope: runScope, data, receivedAt, error: null, loading: false });
        }
        return data;
      },
      (error: unknown) => {
        if (scopeRef.current === runScope) {
          setState((previous) => ({
            ...(previous.scope === runScope ? previous : emptyState<T>(runScope)),
            error: getErrorMessage(error, 'Request failed'),
            loading: false,
          }));
        }
        throw error;
      }
    );
    const entry = { scope: runScope, promise };
    inFlightRef.current = entry;
    const release = () => {
      if (inFlightRef.current === entry) inFlightRef.current = null;
    };
    promise.then(release, release);
    return promise;
  }, []);

  useEffect(() => {
    scopeRef.current = scope;
    receivedAtRef.current = null;
    if (!enabled) return undefined;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = () => {
      clear();
      if (disposed || isDocumentHidden()) return;
      timer = setTimeout(tick, nextPollDelay(receivedAtRef.current, intervalMs, Date.now()));
    };

    function tick() {
      timer = null;
      if (disposed || isDocumentHidden()) return;
      // A manual refresh may have landed since this timer was set.
      if (nextPollDelay(receivedAtRef.current, intervalMs, Date.now()) > 0) {
        schedule();
        return;
      }
      run()
        .catch(() => undefined)
        .finally(() => {
          if (disposed) return;
          // After a failure, wait a full interval instead of retrying immediately.
          if (receivedAtRef.current === null || Date.now() - receivedAtRef.current >= intervalMs) {
            clear();
            if (!isDocumentHidden()) timer = setTimeout(tick, intervalMs);
            return;
          }
          schedule();
        });
    }

    const resume = () => {
      if (isDocumentHidden()) {
        clear();
        return;
      }
      if (timer === null && !inFlightRef.current) tick();
    };

    scheduleRef.current = schedule;
    tick();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);

    return () => {
      disposed = true;
      clear();
      scheduleRef.current = null;
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
    };
  }, [enabled, intervalMs, run, scope]);

  const refresh = useCallback(async () => {
    try {
      return await run();
    } finally {
      scheduleRef.current?.();
    }
  }, [run]);

  const inScope = state.scope === scope;
  const data = inScope ? state.data : null;
  const receivedAt = inScope ? state.receivedAt : null;
  const error = inScope ? state.error : null;
  const loading = inScope ? state.loading : false;

  return useMemo(
    () => ({ data, receivedAt, error, loading, refresh }),
    [data, receivedAt, error, loading, refresh]
  );
}
