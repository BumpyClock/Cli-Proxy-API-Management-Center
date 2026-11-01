import { describe, expect, test } from 'bun:test';
import {
  createPoller,
  PollTimeoutError,
  type PollerOptions,
} from '../src/features/dashboard/logic/poller';

/** Deterministic timers and clock for driving a poller without a browser. */
function createHarness() {
  let current = 1_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const harness = {
    hidden: false,
    now: () => current,
    setTimer: (callback: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: current + ms, callback });
      return id;
    },
    clearTimer: (id: unknown) => {
      timers.delete(id as number);
    },
    pendingDelays: () =>
      [...timers.values()].map((timer) => timer.at - current).sort((a, b) => a - b),
    /** Advance the clock, firing due timers in order and letting promises settle. */
    async advance(ms: number) {
      const target = current + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        current = due[1].at;
        due[1].callback();
        await flush();
      }
      current = target;
      await flush();
    },
  };
  return harness;
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

function setup(overrides: Partial<PollerOptions<number>> = {}) {
  const harness = createHarness();
  const calls: Array<{ signal: AbortSignal; request: Deferred<number> }> = [];
  const poller = createPoller<number>({
    load: (signal) => {
      const request = deferred<number>();
      calls.push({ signal, request });
      return request.promise;
    },
    intervalMs: 15_000,
    timeoutMs: 20_000,
    now: harness.now,
    setTimer: harness.setTimer,
    clearTimer: harness.clearTimer,
    isHidden: () => harness.hidden,
    ...overrides,
  });
  return { harness, calls, poller };
}

describe('createPoller', () => {
  test('loads at once, then every interval after each success', async () => {
    const { harness, calls, poller } = setup();
    poller.start();
    expect(calls).toHaveLength(1);
    expect(poller.getSnapshot().loading).toBe(true);

    calls[0].request.resolve(1);
    await flush();
    expect(poller.getSnapshot()).toMatchObject({ data: 1, error: null, loading: false });
    expect(harness.pendingDelays()).toEqual([15_000]);

    await harness.advance(14_999);
    expect(calls).toHaveLength(1);
    await harness.advance(1);
    expect(calls).toHaveLength(2);
  });

  test('a slow response keeps the stated cadence from the attempt start', async () => {
    const { harness, calls, poller } = setup();
    poller.start();
    await harness.advance(5_000);
    calls[0].request.resolve(1);
    await flush();
    // Started at 0, answered at 5 s: the next attempt is due at 15 s, not 20 s.
    expect(harness.pendingDelays()).toEqual([10_000]);
    await harness.advance(10_000);
    expect(calls).toHaveLength(2);
  });

  test('a very slow response still leaves a third of an interval before the next attempt', async () => {
    const { harness, calls, poller } = setup();
    poller.start();
    await harness.advance(14_000);
    calls[0].request.resolve(1);
    await flush();
    expect(harness.pendingDelays()).toEqual([5_000]);
  });

  test('a slow failure keeps the stated cadence from the attempt start', async () => {
    const { harness, calls, poller } = setup();
    poller.start();
    await harness.advance(5_000);
    calls[0].request.reject(new Error('503'));
    await flush();
    expect(harness.pendingDelays()).toEqual([10_000]);
    await harness.advance(10_000);
    expect(calls).toHaveLength(2);
  });

  test('keeps last good data on failure and waits a full interval before retrying', async () => {
    const { harness, calls, poller } = setup();
    poller.start();
    calls[0].request.resolve(7);
    await flush();
    await harness.advance(15_000);
    calls[1].request.reject(new Error('503 auth manager unavailable'));
    await flush();

    expect(poller.getSnapshot()).toMatchObject({ data: 7, error: '503 auth manager unavailable' });
    expect(harness.pendingDelays()).toEqual([15_000]);
  });

  test('hiding and returning does not skip the failure backoff', async () => {
    const { harness, calls, poller } = setup();
    poller.start();
    calls[0].request.reject(new Error('down'));
    await flush();

    harness.hidden = true;
    poller.resume();
    expect(harness.pendingDelays()).toEqual([]);

    await harness.advance(1_000);
    harness.hidden = false;
    poller.resume();
    expect(calls).toHaveLength(1);
    expect(harness.pendingDelays()).toEqual([14_000]);
  });

  test('pauses while hidden and polls on return when due', async () => {
    const { harness, calls, poller } = setup();
    harness.hidden = true;
    poller.start();
    expect(calls).toHaveLength(0);

    harness.hidden = false;
    poller.resume();
    expect(calls).toHaveLength(1);
  });

  test('a manual refresh shares the attempt in flight and resets the schedule', async () => {
    const { harness, calls, poller } = setup();
    poller.start();
    const manual = poller.refresh();
    expect(calls).toHaveLength(1);

    calls[0].request.resolve(3);
    await expect(manual).resolves.toBe(3);
    await harness.advance(10_000);
    const second = poller.refresh();
    expect(calls).toHaveLength(2);
    calls[1].request.resolve(4);
    await second;
    expect(harness.pendingDelays()).toEqual([15_000]);
  });

  test('a stalled request times out, aborts, and records the failure', async () => {
    const { harness, calls, poller } = setup();
    poller.start();
    await harness.advance(20_000);

    expect(calls[0].signal.aborted).toBe(true);
    expect(poller.getSnapshot()).toMatchObject({ loading: false });
    expect(poller.getSnapshot().error).toBe(new PollTimeoutError(20_000).message);
    // The cadence slot (15 s after the start) has passed: a third of an interval follows.
    expect(harness.pendingDelays()).toEqual([5_000]);
  });

  test('ignores a response that settles after stop, even across a restart', async () => {
    const { calls, poller } = setup();
    poller.start();
    poller.stop();
    expect(calls[0].signal.aborted).toBe(true);

    poller.start();
    expect(calls).toHaveLength(2);
    calls[0].request.resolve(111);
    await flush();
    expect(poller.getSnapshot().data).toBeNull();

    calls[1].request.resolve(222);
    await flush();
    expect(poller.getSnapshot().data).toBe(222);
  });

  test('refresh rejects when the poller is not running', async () => {
    const { poller } = setup();
    await expect(poller.refresh()).rejects.toThrow('Not connected');
  });

  test('notifies subscribers with a new snapshot on every change', async () => {
    const { calls, poller } = setup();
    let notified = 0;
    const unsubscribe = poller.subscribe(() => {
      notified += 1;
    });
    const before = poller.getSnapshot();
    poller.start();
    calls[0].request.resolve(5);
    await flush();
    unsubscribe();
    expect(notified).toBe(2);
    expect(poller.getSnapshot()).not.toBe(before);
  });
});
