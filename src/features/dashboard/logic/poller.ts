/**
 * React-free polling state machine for one dashboard data source.
 *
 * One poller instance serves one connection scope. A new scope gets a new instance, so
 * a response that belongs to an earlier scope can never reach the current view. Within
 * an instance, every start/stop cycle has its own run id, which makes StrictMode's
 * start-stop-start sequence safe as well.
 *
 * Timers, the clock, and page visibility are injectable so tests drive the schedule
 * without a browser.
 */

export interface PollerState<T> {
  data: T | null;
  /** Local receipt time of the last successful load. */
  receivedAt: number | null;
  /** Message from the latest failed attempt; cleared by the next success. */
  error: string | null;
  loading: boolean;
}

export type PollerLoad<T> = (signal: AbortSignal) => Promise<T>;

export interface PollerOptions<T> {
  /** Load the source. Honour the signal where possible; a timeout aborts it. */
  load?: PollerLoad<T>;
  intervalMs: number;
  /** Upper bound for one attempt, so a stalled request cannot block polling forever. */
  timeoutMs: number;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  isHidden?: () => boolean;
  describeError?: (error: unknown) => string;
}

export interface Poller<T> {
  /** Begin polling. The first load starts at once unless the page is hidden. */
  start(): void;
  /** Stop polling, abort the attempt in flight, and ignore anything still settling. */
  stop(): void;
  /** Load now, sharing an attempt already in flight. Rejects when not running. */
  refresh(): Promise<T>;
  /** Visibility, focus, or network change: poll if due, or pause while hidden. */
  resume(): void;
  /** Replace the loader, e.g. when the closure that builds the request changes. */
  setLoad(load: PollerLoad<T>): void;
  subscribe(listener: () => void): () => void;
  /** Referentially stable between changes, as `useSyncExternalStore` requires. */
  getSnapshot(): PollerState<T>;
}

export class PollTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'PollTimeoutError';
  }
}

export const EMPTY_POLLER_STATE: PollerState<never> = Object.freeze({
  data: null,
  receivedAt: null,
  error: null,
  loading: false,
});

const defaultDescribe = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'Request failed';

export function createPoller<T>(options: PollerOptions<T>): Poller<T> {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const isHidden = options.isHidden ?? (() => false);
  const describe = options.describeError ?? defaultDescribe;

  const listeners = new Set<() => void>();
  let load: PollerLoad<T> | null = options.load ?? null;
  let state: PollerState<T> = EMPTY_POLLER_STATE;
  let runId = 0;
  let running = false;
  let timer: unknown = null;
  let inFlight: { runId: number; promise: Promise<T>; abort: () => void } | null = null;
  /** Earliest time the scheduler may poll again; survives hide/show and failures. */
  let nextAttemptAt = 0;

  const emit = (patch: Partial<PollerState<T>>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };

  const clear = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const schedule = () => {
    clear();
    if (!running || isHidden()) return;
    timer = setTimer(tick, Math.max(0, nextAttemptAt - now()));
  };

  const attempt = (): Promise<T> => {
    if (inFlight && inFlight.runId === runId) return inFlight.promise;

    const attemptRun = runId;
    const controller = new AbortController();
    let timeoutId: unknown = null;
    emit({ loading: true });

    const bounded = new Promise<T>((resolve, reject) => {
      timeoutId = setTimer(() => {
        controller.abort();
        reject(new PollTimeoutError(options.timeoutMs));
      }, options.timeoutMs);
      if (!load) {
        reject(new Error('No loader configured'));
        return;
      }
      load(controller.signal).then(resolve, reject);
    });

    const settle = () => {
      if (timeoutId !== null) clearTimer(timeoutId);
      if (inFlight?.promise === promise) inFlight = null;
    };

    const promise = bounded.then(
      (data) => {
        settle();
        if (attemptRun === runId && running) {
          const receivedAt = now();
          nextAttemptAt = receivedAt + options.intervalMs;
          emit({ data, receivedAt, error: null, loading: false });
          schedule();
        }
        return data;
      },
      (error: unknown) => {
        settle();
        if (attemptRun === runId && running) {
          nextAttemptAt = now() + options.intervalMs;
          emit({ error: describe(error), loading: false });
          schedule();
        }
        throw error;
      }
    );

    inFlight = { runId: attemptRun, promise, abort: () => controller.abort() };
    return promise;
  };

  function tick() {
    timer = null;
    if (!running || isHidden()) return;
    if (now() < nextAttemptAt) {
      schedule();
      return;
    }
    attempt().catch(() => undefined);
  }

  return {
    start() {
      if (running) return;
      running = true;
      runId += 1;
      tick();
    },
    stop() {
      if (!running) return;
      running = false;
      runId += 1;
      clear();
      if (inFlight) {
        inFlight.abort();
        inFlight = null;
      }
      if (state.loading) emit({ loading: false });
    },
    refresh() {
      if (!running) return Promise.reject(new Error('Not connected'));
      return attempt();
    },
    resume() {
      if (!running) return;
      if (isHidden()) {
        clear();
        return;
      }
      const busy = inFlight !== null && inFlight.runId === runId;
      if (timer === null && !busy) tick();
    },
    setLoad(next) {
      load = next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return state;
    },
  };
}
