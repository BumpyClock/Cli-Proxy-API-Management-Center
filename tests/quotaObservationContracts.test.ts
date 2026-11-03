import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '@/i18n';
import { useQuotaActions } from '@/features/quota/hooks/useQuotaActions';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';
import { classifyQuotaFiles } from '@/features/quota/logic';
import { QUOTA_ADAPTERS } from '@/features/quota/providers';
import { resolveQuotaEntryCheck } from '@/features/quota/refreshScope';
import { apiCallApi, authFilesApi, type ApiCallRequest, type ApiCallResult } from '@/services/api';
import { useQuotaStore } from '@/stores/useQuotaStore';
import type { AuthFileItem, AuthFilesResponse } from '@/types';
import { XAI_API_CHAT_URL, XAI_API_ME_URL } from '@/utils/quota';

function consumer() {
  let hooks!: {
    batch: ReturnType<typeof useQuotaBatchLoader>;
    actions: ReturnType<typeof useQuotaActions>;
  };
  function Capture() {
    hooks = { batch: useQuotaBatchLoader(), actions: useQuotaActions(false) };
    return null;
  }
  renderToStaticMarkup(createElement(Capture));
  return hooks;
}

const originalRequest = apiCallApi.request;
const originalList = authFilesApi.list;
const originalNow = Date.now;
const response = (statusCode: number, body: unknown): ApiCallResult => ({
  statusCode,
  body,
  bodyText: JSON.stringify(body),
  header: {},
});

beforeEach(() => useQuotaStore.getState().clearQuotaCache());
afterEach(() => {
  apiCallApi.request = originalRequest;
  authFilesApi.list = originalList;
  Date.now = originalNow;
  useQuotaStore.getState().clearQuotaCache();
});

describe('provider-owned non-generative observations', () => {
  for (const route of ['Dashboard', 'Quota']) {
    for (const mode of ['paid', 'free-billing-failure']) {
      test(`${route} entry and re-entry never generate inference for ${mode} xAI`, async () => {
        const requests: ApiCallRequest[] = [];
        apiCallApi.request = async (payload) => {
          requests.push(payload);
          return response(403, { error: 'billing unavailable' });
        };
        const file: AuthFileItem = {
          name: 'xai.json',
          provider: 'xai',
          authIndex: 'xai:1',
          ...(mode === 'paid' ? { using_api: true, prefix: 'paid' } : {}),
        };
        const generation = useQuotaStore.getState().cacheGeneration;
        for (let entry = 0; entry < 2; entry += 1) {
          const targets = resolveQuotaEntryCheck(
            null,
            false,
            {
              sessionGeneration: generation,
              filesGeneration: generation,
              hasError: false,
              disabled: false,
            },
            classifyQuotaFiles([file])
          );
          expect(targets).toHaveLength(mode === 'paid' ? 0 : 1);
          const result = await consumer().batch.loadQuota(targets!);
          if (mode !== 'paid') expect(result?.failed).toBe(1);
          expect(requests.every((request) => request.method === 'GET')).toBe(true);
          expect(requests.some((request) => request.url === XAI_API_CHAT_URL)).toBe(false);
          expect(useQuotaStore.getState().xaiQuota[file.name]?.checkedAt).toBeUndefined();
        }
        expect(requests).toHaveLength(mode === 'paid' ? 0 : 4);
      });
    }
  }

  test('mixed paid and observable xAI targets report skips separately from real failures', async () => {
    apiCallApi.request = async () => response(403, { error: 'billing unavailable' });
    const paid = {
      name: 'paid.json',
      provider: 'xai',
      authIndex: 'paid',
      using_api: true,
      prefix: 'paid',
    };
    const free = { name: 'free.json', provider: 'xai', authIndex: 'free' };
    const entries = classifyQuotaFiles([paid, free]);
    const generation = useQuotaStore.getState().cacheGeneration;
    const targets = resolveQuotaEntryCheck(
      null,
      false,
      {
        sessionGeneration: generation,
        filesGeneration: generation,
        hasError: false,
        disabled: false,
      },
      entries
    );
    expect(targets?.map(({ file }) => file.name)).toEqual(['free.json']);
    const result = await consumer().batch.loadQuota(entries);
    expect(result).toMatchObject({ success: 0, failed: 1, skipped: 1 });
    expect(useQuotaStore.getState().xaiQuota['paid.json']).toBeUndefined();
    expect(useQuotaStore.getState().xaiQuota['free.json']).toMatchObject({
      status: 'error',
      errorStatus: 403,
    });
  });

  test('explicit health action still sends the deliberate one-token paid inference test', async () => {
    const requests: ApiCallRequest[] = [];
    apiCallApi.request = async (payload) => {
      requests.push(payload);
      return response(
        200,
        payload.url === XAI_API_ME_URL ? { user_id: 'fixture' } : { choices: [] }
      );
    };
    const file = {
      name: 'paid.json',
      provider: 'xai',
      authIndex: 'xai:2',
      using_api: true,
      prefix: 'paid',
    };
    Date.now = () => 6000;
    await consumer().actions.testHealth(file, QUOTA_ADAPTERS.xai);
    const chat = requests.find((request) => request.method === 'POST');
    expect(chat?.url).toBe(XAI_API_CHAT_URL);
    expect(JSON.parse(chat!.data!)).toEqual({
      model: 'grok-4.5',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false,
    });
    expect(QUOTA_ADAPTERS.xai.healthTest?.labelFallback).toContain('may incur charges');
    const accepted = useQuotaStore.getState().xaiQuota[file.name];
    expect(accepted).toMatchObject({
      status: 'success',
      checkedAt: 6000,
      billing: { mode: 'paid-health', userId: 'fixture' },
    });
    const generation = useQuotaStore.getState().cacheGeneration;
    const targets = resolveQuotaEntryCheck(
      null,
      false,
      {
        sessionGeneration: generation,
        filesGeneration: generation,
        hasError: false,
        disabled: false,
      },
      classifyQuotaFiles([file])
    );
    expect(targets).toEqual([]);
    const result = await consumer().batch.loadQuota(classifyQuotaFiles([file]));
    expect(result).toMatchObject({ success: 0, failed: 0, skipped: 1 });
    await consumer().actions.refreshQuota(file, QUOTA_ADAPTERS.xai);
    expect(useQuotaStore.getState().xaiQuota[file.name]).toBe(accepted);
    expect(requests).toHaveLength(2);
  });

  test('manual quota observation cannot enter the free-billing health fallback either', async () => {
    const requests: ApiCallRequest[] = [];
    apiCallApi.request = async (payload) => {
      requests.push(payload);
      return response(403, { error: 'billing unavailable' });
    };
    await consumer().actions.refreshQuota(
      { name: 'free.json', provider: 'xai', authIndex: 'xai:3' },
      QUOTA_ADAPTERS.xai
    );
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });
});

const qoder: AuthFileItem = {
  name: 'qoder.json',
  provider: 'qoder',
  authIndex: 'old-identity',
  usage: { used: 10, total: 100 },
};
const qoderState = () => useQuotaStore.getState().qoderQuota[qoder.name];
function seedQoder() {
  useQuotaStore.getState().setQoderQuota({
    [qoder.name]: { status: 'success', checkedAt: 1000, usage: { used: 10, total: 100 } },
  });
}

describe('snapshot-backed observations', () => {
  test('per-account refresh reads auth-files first and resolves current identity and usage', async () => {
    seedQoder();
    let resolveList!: (value: AuthFilesResponse) => void;
    let calls = 0;
    authFilesApi.list = () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveList = resolve;
      });
    };
    const run = consumer().actions.refreshQuota(qoder, QUOTA_ADAPTERS.qoder);
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(qoderState()).toMatchObject({ checkedAt: 1000, refreshing: true, usage: { used: 10 } });
    Date.now = () => 2000;
    resolveList({
      files: [
        { name: 'other.json', provider: 'qoder', usage: { used: 1, total: 100 } },
        { ...qoder, authIndex: 'current-identity', usage: { used: 90, total: 100 } },
      ],
    });
    await run;
    expect(qoderState()).toMatchObject({
      checkedAt: 2000,
      stale: false,
      refreshing: false,
      usage: { used: 90, total: 100 },
    });
    expect(qoder.usage).toEqual({ used: 10, total: 100 });
  });

  test('failed list keeps old Qoder data stale and never advances successful time', async () => {
    seedQoder();
    authFilesApi.list = async () => {
      throw new Error('list unavailable');
    };
    Date.now = () => 5000;
    await consumer().actions.refreshQuota(qoder, QUOTA_ADAPTERS.qoder);
    expect(qoderState()).toMatchObject({
      checkedAt: 1000,
      stale: true,
      refreshing: false,
      usage: { used: 10, total: 100 },
      error: 'list unavailable',
    });
  });

  test('Dashboard manual batch refresh re-reads authoritative snapshots despite unchanged props', async () => {
    let calls = 0;
    authFilesApi.list = async () => ({
      files: [{ ...qoder, usage: { used: ++calls * 30, total: 100 } }],
    });
    const targets = classifyQuotaFiles([qoder]);
    const dashboard = consumer();
    Date.now = () => 3000;
    await dashboard.batch.loadQuota(targets);
    expect(qoderState()).toMatchObject({ checkedAt: 3000, usage: { used: 30 } });
    Date.now = () => 4000;
    await dashboard.batch.loadQuota(targets);
    expect(calls).toBe(2);
    expect(qoderState()).toMatchObject({ checkedAt: 4000, usage: { used: 60 } });
    expect(qoder.usage).toEqual({ used: 10, total: 100 });
    authFilesApi.list = async () => {
      throw new Error('manual list unavailable');
    };
    Date.now = () => 5000;
    const failed = await dashboard.batch.loadQuota(targets);
    expect(failed?.failed).toBe(1);
    expect(qoderState()).toMatchObject({ checkedAt: 4000, stale: true, usage: { used: 60 } });
  });

  test('file invalidation prevents a new observation from joining an old list read', async () => {
    const resolvers: Array<(value: AuthFilesResponse) => void> = [];
    authFilesApi.list = () => new Promise((resolve) => resolvers.push(resolve));
    const older = consumer().actions.refreshQuota(qoder, QUOTA_ADAPTERS.qoder);
    await Promise.resolve();
    useQuotaStore.getState().clearQuotaCache([qoder.name]);
    const newer = consumer().actions.refreshQuota(qoder, QUOTA_ADAPTERS.qoder);
    await Promise.resolve();
    expect(resolvers).toHaveLength(2);
    Date.now = () => 2000;
    resolvers[1]({ files: [{ ...qoder, usage: { used: 90, total: 100 } }] });
    await newer;
    const accepted = qoderState();
    Date.now = () => 3000;
    resolvers[0]({ files: [{ ...qoder, usage: { used: 10, total: 100 } }] });
    await older;
    expect(qoderState()).toBe(accepted);
    expect(qoderState()).toMatchObject({ checkedAt: 2000, usage: { used: 90 } });
  });

  test('concurrent snapshot accounts share list read, not credential commits', async () => {
    let resolveList!: (value: AuthFilesResponse) => void;
    let calls = 0;
    authFilesApi.list = () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveList = resolve;
      });
    };
    const other = { ...qoder, name: 'other.json' };
    const a = consumer().batch.loadQuota(classifyQuotaFiles([qoder]));
    const b = consumer().actions.refreshQuota(other, QUOTA_ADAPTERS.qoder);
    await Promise.resolve();
    expect(calls).toBe(1);
    useQuotaStore.getState().clearQuotaCache([qoder.name]);
    resolveList({
      files: [
        { ...qoder, usage: { used: 90, total: 100 } },
        { ...other, usage: { used: 40, total: 100 } },
      ],
    });
    await Promise.all([a, b]);
    expect(qoderState()).toBeUndefined();
    expect(useQuotaStore.getState().qoderQuota[other.name]).toMatchObject({ usage: { used: 40 } });
  });

  for (const invalidation of ['file', 'session']) {
    for (const outcome of ['success', 'failure']) {
      test(`${invalidation} invalidation rejects a late Qoder list ${outcome}`, async () => {
        const lists: {
          resolve: (value: AuthFilesResponse) => void;
          reject: (error: Error) => void;
        }[] = [];
        authFilesApi.list = () =>
          new Promise((resolve, reject) => {
            lists.push({ resolve, reject });
          });
        const older = consumer().batch.loadQuota(classifyQuotaFiles([qoder]));
        await Promise.resolve();
        useQuotaStore
          .getState()
          .clearQuotaCache(invalidation === 'file' ? [qoder.name] : undefined);
        const newer = consumer().actions.refreshQuota(qoder, QUOTA_ADAPTERS.qoder);
        await Promise.resolve();
        expect(lists).toHaveLength(2);
        Date.now = () => 7000;
        lists[1].resolve({ files: [{ ...qoder, usage: { used: 90, total: 100 } }] });
        await newer;
        const accepted = qoderState();
        Date.now = () => 8000;
        if (outcome === 'success') lists[0].resolve({ files: [qoder] });
        else lists[0].reject(new Error('old list failure'));
        await older;
        expect(qoderState()).toBe(accepted);
        expect(qoderState()).toMatchObject({ checkedAt: 7000, stale: false, usage: { used: 90 } });
      });
    }
  }

  for (const change of ['removed', 'disabled', 'provider-changed']) {
    test(`a ${change} snapshot credential cannot re-certify the click-time usage`, async () => {
      seedQoder();
      authFilesApi.list = async () => ({
        files:
          change === 'removed'
            ? []
            : [
                {
                  ...qoder,
                  ...(change === 'disabled' ? { disabled: true } : { provider: 'claude' }),
                },
              ],
      });
      await consumer().actions.refreshQuota(qoder, QUOTA_ADAPTERS.qoder);
      expect(qoderState()).toMatchObject({ checkedAt: 1000, stale: true, usage: { used: 10 } });
    });
  }
});
