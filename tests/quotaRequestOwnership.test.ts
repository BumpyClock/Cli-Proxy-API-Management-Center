import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '@/i18n';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';
import { useQuotaActions } from '@/features/quota/hooks/useQuotaActions';
import { QUOTA_ADAPTERS } from '@/features/quota/providers';
import { useQuotaStore } from '@/stores/useQuotaStore';
import type { AuthFileItem } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function consumer() {
  let hooks!: {
    batch: ReturnType<typeof useQuotaBatchLoader>;
    actions: ReturnType<typeof useQuotaActions>;
  };
  function Capture() {
    hooks = { batch: useQuotaBatchLoader(), actions: useQuotaActions(false) };
    return null;
  }
  // Each render creates independent hook closures, as route unmount/re-entry does.
  renderToStaticMarkup(createElement(Capture));
  return hooks;
}

const adapter = QUOTA_ADAPTERS.claude;
const originalFetch = adapter.fetchQuota;
const originalHealth = adapter.healthTest;
const originalDevinFetch = QUOTA_ADAPTERS.devin.fetchQuota;
const originalNow = Date.now;
const file: AuthFileItem = { name: 'owned.json', provider: 'claude' };
const targets = [{ type: 'claude' as const, file }];
const data = (usedPercent: number) => ({
  windows: [{ id: 'weekly', label: 'Weekly', usedPercent, resetLabel: '' }],
});
const cached = () => useQuotaStore.getState().claudeQuota[file.name];
const started = () => Promise.resolve();

beforeEach(() => useQuotaStore.getState().clearQuotaCache());
afterEach(() => {
  adapter.fetchQuota = originalFetch;
  adapter.healthTest = originalHealth;
  QUOTA_ADAPTERS.devin.fetchQuota = originalDevinFetch;
  Date.now = originalNow;
  useQuotaStore.getState().clearQuotaCache();
});

describe('shared quota request ownership', () => {
  test('two route hook instances join one read, including unmount/re-entry closures', async () => {
    const response = deferred<unknown>();
    let calls = 0;
    adapter.fetchQuota = () => {
      calls += 1;
      return response.promise;
    };
    const first = consumer();
    const oldRoute = first.batch.loadQuota(targets);
    await started();
    const second = consumer();
    const newRoute = second.batch.loadQuota(targets);
    await started();
    expect(calls).toBe(1);
    Date.now = () => 10_000;
    response.resolve(data(80));
    const results = await Promise.all([oldRoute, newRoute]);
    expect(results.map((result) => result?.success)).toEqual([1, 1]);
    expect(cached()).toMatchObject({
      status: 'success',
      checkedAt: 10_000,
      stale: false,
      refreshing: false,
      windows: [{ usedPercent: 80 }],
    });
  });

  for (const first of ['batch', 'individual'] as const) {
    test(`${first} and the other consumer join the same observational read`, async () => {
      const response = deferred<unknown>();
      let calls = 0;
      adapter.fetchQuota = () => {
        calls += 1;
        return response.promise;
      };
      const a = consumer();
      const b = consumer();
      const batch = () => a.batch.loadQuota(targets);
      const individual = () => b.actions.refreshQuota(file, adapter);
      const one = first === 'batch' ? batch() : individual();
      await started();
      const two = first === 'batch' ? individual() : batch();
      await started();
      expect(calls).toBe(1);
      response.resolve(data(75));
      await Promise.all([one, two]);
      expect(cached().windows[0].usedPercent).toBe(75);
    });
  }

  for (const outcome of ['success', 'failure'] as const) {
    test(`superseded ${outcome} cannot replace a newer explicit observation or its timestamp`, async () => {
      const old = deferred<unknown>();
      const current = deferred<unknown>();
      adapter.fetchQuota = () => old.promise;
      adapter.healthTest = { run: () => current.promise, labelKey: 'test', labelFallback: 'test' };
      const a = consumer();
      const b = consumer();
      const older = a.batch.loadQuota(targets);
      await started();
      const newer = b.actions.testHealth(file, adapter);
      await started();
      Date.now = () => 20_000;
      current.resolve(data(80));
      await newer;
      const accepted = cached();
      Date.now = () => 30_000;
      if (outcome === 'success') old.resolve(data(10));
      else old.reject(new Error('stale failure'));
      await older;
      expect(cached()).toBe(accepted);
      expect(cached()).toMatchObject({ checkedAt: 20_000, stale: false });
      expect(cached().windows[0].usedPercent).toBe(80);
    });
  }

  for (const invalidation of ['file', 'session'] as const) {
    for (const outcome of ['success', 'failure'] as const) {
      test(`${invalidation} invalidation rejects old ${outcome} while a new consumer can read`, async () => {
        const old = deferred<unknown>();
        const current = deferred<unknown>();
        let calls = 0;
        adapter.fetchQuota = () => (++calls === 1 ? old.promise : current.promise);
        const older = consumer().batch.loadQuota(targets);
        await started();
        useQuotaStore.getState().clearQuotaCache(invalidation === 'file' ? [file.name] : undefined);
        const newer = consumer().actions.refreshQuota(file, adapter);
        await started();
        expect(calls).toBe(2);
        Date.now = () => 40_000;
        current.resolve(data(90));
        await newer;
        const accepted = cached();
        Date.now = () => 50_000;
        if (outcome === 'success') old.resolve(data(10));
        else old.reject(new Error('invalid generation'));
        await older;
        expect(cached()).toBe(accepted);
        expect(cached()).toMatchObject({ checkedAt: 40_000, stale: false });
      });
    }
  }

  test('file invalidation does not discard unrelated outcomes in the same batch', async () => {
    const slow = deferred<unknown>();
    const fast = deferred<unknown>();
    adapter.fetchQuota = (target) => (target.name === file.name ? slow.promise : fast.promise);
    const other = { name: 'other.json', provider: 'claude' };
    const run = consumer().batch.loadQuota([...targets, { type: 'claude', file: other }]);
    await started();
    useQuotaStore.getState().clearQuotaCache([file.name]);
    fast.resolve(data(45));
    await fast.promise;
    await started();
    expect(useQuotaStore.getState().claudeQuota[other.name].status).toBe('loading');
    expect(cached()).toBeUndefined();
    slow.resolve(data(5));
    await run;
    expect(useQuotaStore.getState().claudeQuota[other.name].windows[0].usedPercent).toBe(45);
    expect(cached()).toBeUndefined();
  });

  test('distinct identities in one file remain concurrent and retain independent completion times', async () => {
    const slow = deferred<unknown>();
    const fast = deferred<unknown>();
    const first = { name: 'shared.json', provider: 'devin', authIndex: 'first' };
    const second = { ...first, authIndex: 'second' };
    let calls = 0;
    QUOTA_ADAPTERS.devin.fetchQuota = (target) => {
      calls += 1;
      return target.authIndex === 'first' ? slow.promise : fast.promise;
    };
    const run = consumer().batch.loadQuota([
      { type: 'devin', file: first },
      { type: 'devin', file: second },
    ]);
    await started();
    expect(calls).toBe(2);
    Date.now = () => 1000;
    fast.resolve({ windows: [], plan: 'second' });
    await fast.promise;
    await started();
    expect(useQuotaStore.getState().devinQuota[getQuotaCacheKey(second)].status).toBe('loading');
    expect(useQuotaStore.getState().devinQuota[getQuotaCacheKey(first)].status).toBe('loading');
    Date.now = () => 2000;
    slow.resolve({ windows: [], plan: 'first' });
    await run;
    expect(useQuotaStore.getState().devinQuota[getQuotaCacheKey(first)]).toMatchObject({
      checkedAt: 2000,
    });
    expect(useQuotaStore.getState().devinQuota[getQuotaCacheKey(second)]).toMatchObject({
      checkedAt: 1000,
    });
  });

  test('500 cached accounts publish two immutable provider snapshots with linear copied entries', async () => {
    const files = Array.from({ length: 500 }, (_, i) => ({
      name: `account-${i}.json`,
      provider: 'claude',
    }));
    const seed = Object.fromEntries(
      files.map((item) => [
        item.name,
        {
          status: 'success' as const,
          ...data(10),
          checkedAt: 1,
        },
      ])
    );
    useQuotaStore.getState().setClaudeQuota(seed);
    const responses = files.map(() => deferred<unknown>());
    let calls = 0;
    adapter.fetchQuota = () => responses[calls++].promise;
    const snapshots: Array<typeof seed> = [];
    let copiedEntries = 0;
    const unsubscribe = useQuotaStore.subscribe((state, previous) => {
      if (state.claudeQuota === previous.claudeQuota) return;
      copiedEntries += Object.keys(previous.claudeQuota).length;
      snapshots.push(state.claudeQuota as typeof seed);
    });
    try {
      const run = consumer().batch.loadQuota(files.map((item) => ({ type: 'claude', file: item })));
      await started();
      expect(calls).toBe(500);
      expect(snapshots).toHaveLength(1);
      expect(seed[files[0].name].windows[0].usedPercent).toBe(10);
      for (let i = 499; i >= 0; i--) {
        responses[i].resolve(data(i % 100));
        await started();
      }
      const result = await run;
      expect(result?.success).toBe(500);
      expect(snapshots).toHaveLength(2);
      expect(copiedEntries).toBe(1000);
      expect(snapshots[0]).not.toBe(snapshots[1]);
      expect(snapshots[0][files[1].name]).toMatchObject({ refreshing: true });
      expect(snapshots[1][files[1].name].windows[0].usedPercent).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  test('provider groups settle independently and an unrelated row refresh stays prompt', async () => {
    const slow = deferred<unknown>();
    const fast = deferred<unknown>();
    const row = deferred<unknown>();
    const other = { name: 'other.json', provider: 'claude' };
    const devin = { name: 'devin.json', provider: 'devin' };
    adapter.fetchQuota = (target) => (target.name === file.name ? slow.promise : row.promise);
    QUOTA_ADAPTERS.devin.fetchQuota = () => fast.promise;
    const run = consumer().batch.loadQuota([...targets, { type: 'devin', file: devin }]);
    await started();
    const rowRun = consumer().actions.refreshQuota(other, adapter);
    await started();
    fast.resolve({ windows: [], plan: 'fast' });
    row.resolve(data(70));
    await rowRun;
    await started();
    expect(useQuotaStore.getState().devinQuota[getQuotaCacheKey(devin)]).toMatchObject({
      plan: 'fast',
    });
    expect(useQuotaStore.getState().claudeQuota[other.name].windows[0].usedPercent).toBe(70);
    expect(cached().status).toBe('loading');
    slow.resolve(data(20));
    await run;
  });

  for (const invalidation of ['file', 'session', 'new-owner'] as const) {
    test(`queued batch outcome cannot publish after ${invalidation}`, async () => {
      const first = deferred<unknown>();
      const second = deferred<unknown>();
      const newer = deferred<unknown>();
      const other = { name: 'slow.json', provider: 'claude' };
      adapter.fetchQuota = (target) => (target.name === file.name ? first.promise : second.promise);
      adapter.healthTest = { run: () => newer.promise, labelKey: 'test', labelFallback: 'test' };
      const run = consumer().batch.loadQuota([...targets, { type: 'claude', file: other }]);
      await started();
      first.resolve(data(10));
      await first.promise;
      await started();
      let replacement: Promise<unknown> | undefined;
      if (invalidation === 'new-owner') {
        replacement = consumer().actions.testHealth(file, adapter);
        await started();
        newer.resolve(data(90));
        await replacement;
      } else {
        useQuotaStore.getState().clearQuotaCache(invalidation === 'file' ? [file.name] : undefined);
      }
      const accepted = cached();
      second.resolve(data(20));
      await run;
      expect(cached()).toBe(accepted);
      if (invalidation === 'new-owner') expect(cached().windows[0].usedPercent).toBe(90);
    });
  }

  test('checking and failed reads keep the successful payload and successful observation time', async () => {
    useQuotaStore.getState().setClaudeQuota({
      [file.name]: { status: 'success', ...data(60), checkedAt: 1234 },
    });
    const response = deferred<unknown>();
    adapter.fetchQuota = () => response.promise;
    const run = consumer().actions.refreshQuota(file, adapter);
    await started();
    expect(cached()).toMatchObject({
      checkedAt: 1234,
      refreshing: true,
      windows: [{ usedPercent: 60 }],
    });
    response.reject(new Error('offline'));
    await run;
    expect(cached()).toMatchObject({
      checkedAt: 1234,
      refreshing: false,
      stale: true,
      error: 'offline',
    });
    expect(cached().windows[0].usedPercent).toBe(60);
  });
});
