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

  test('unrelated accounts commit independently, including during a file invalidation', async () => {
    const slow = deferred<unknown>();
    const fast = deferred<unknown>();
    adapter.fetchQuota = (target) => (target.name === file.name ? slow.promise : fast.promise);
    const other = { name: 'other.json', provider: 'claude' };
    const run = consumer().batch.loadQuota([...targets, { type: 'claude', file: other }]);
    await started();
    useQuotaStore.getState().clearQuotaCache([file.name]);
    fast.resolve(data(45));
    // Let the independent credential commit before the slow request finishes.
    await fast.promise;
    await started();
    expect(useQuotaStore.getState().claudeQuota[other.name].windows[0].usedPercent).toBe(45);
    expect(cached()).toBeUndefined();
    slow.resolve(data(5));
    await run;
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
    expect(useQuotaStore.getState().devinQuota[getQuotaCacheKey(second)]).toMatchObject({
      status: 'success',
      plan: 'second',
      checkedAt: 1000,
    });
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
