import { afterEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { parseKimiQuotaUrl, resolveKimiQuotaUrl } from '@/services/api/kimiQuota';
import { apiCallApi, authFilesApi, type ApiCallRequest } from '@/services/api';
import { KIMI_CONFIG } from '@/features/quota/providers/kimi/data';
import { KIMI_AI_USAGE_URL, KIMI_USAGE_URL, isKimiFile } from '@/utils/quota';
import { useQuotaStore } from '@/stores/useQuotaStore';
import type { AuthFileItem } from '@/types';

const file: AuthFileItem = { name: 'kimi-ai.json', provider: 'kimi-ai', authIndex: '1' };
const t = ((key: string) => key) as TFunction;
const originalDownload = authFilesApi.downloadText;
const originalRequest = apiCallApi.request;

afterEach(() => {
  authFilesApi.downloadText = originalDownload;
  apiCallApi.request = originalRequest;
  useQuotaStore.getState().clearQuotaCache();
});

describe('Kimi quota domain resolution', () => {
  for (const provider of ['kimi', 'kimi-ai', 'KIMI_AI']) {
    test(`classifies ${provider} as a Kimi quota account`, () => {
      expect(isKimiFile({ ...file, provider })).toBe(true);
    });
  }

  const cases: [string, Record<string, unknown>, Partial<AuthFileItem>, string][] = [
    [
      'China domain beats international filename/type',
      { domain: 'com', type: 'kimi-ai' },
      {},
      KIMI_USAGE_URL,
    ],
    [
      'international domain beats China base URL',
      { domain: 'ai', base_url: 'https://api.kimi.com' },
      {},
      KIMI_AI_USAGE_URL,
    ],
    [
      'unknown explicit domain normalizes to China',
      { domain: 'unknown', base_url: 'https://api.kimi.ai' },
      {},
      KIMI_USAGE_URL,
    ],
    [
      'China base URL beats credential type',
      { base_url: 'https://api.kimi.com', type: 'kimi-ai' },
      {},
      KIMI_USAGE_URL,
    ],
    [
      'international base URL beats provider',
      { base_url: 'https://api.kimi.ai', type: 'kimi' },
      { provider: 'kimi' },
      KIMI_AI_USAGE_URL,
    ],
    ['legacy base URL is accepted', { 'base-url': 'https://api.kimi.com' }, {}, KIMI_USAGE_URL],
    [
      'canonical null base URL beats legacy key',
      { base_url: null, 'base-url': 'https://api.kimi.com', type: 'kimi-ai' },
      {},
      KIMI_AI_USAGE_URL,
    ],
    ['credential type beats provider', { type: 'kimi' }, {}, KIMI_USAGE_URL],
    ['provider beats filename', {}, { provider: 'kimi' }, KIMI_USAGE_URL],
    ['filename is final fallback', {}, { provider: undefined, type: undefined }, KIMI_AI_USAGE_URL],
    [
      'lookalike hosts never receive credentials',
      { base_url: 'https://api.kimi.ai.evil.test', type: 'kimi' },
      {},
      KIMI_USAGE_URL,
    ],
    [
      'URL path does not determine domain',
      { base_url: 'https://example.test/kimi.ai', type: 'kimi' },
      {},
      KIMI_USAGE_URL,
    ],
  ];
  for (const [name, credential, overrides, expected] of cases) {
    test(name, () => {
      expect(parseKimiQuotaUrl(JSON.stringify(credential), { ...file, ...overrides })).toBe(
        expected
      );
    });
  }

  for (const text of ['secret invalid JSON', '[]', 'null', '42']) {
    test('invalid downloaded credentials fail without including their contents', () => {
      expect(() => parseKimiQuotaUrl(text, file)).toThrow('Invalid Kimi credential');
    });
  }

  test('downloads each time instead of caching credential contents', async () => {
    let downloads = 0;
    authFilesApi.downloadText = async () =>
      JSON.stringify({ domain: ++downloads === 1 ? 'ai' : 'com' });
    expect(await resolveKimiQuotaUrl(file)).toBe(KIMI_AI_USAGE_URL);
    expect(await resolveKimiQuotaUrl(file)).toBe(KIMI_USAGE_URL);
    expect(downloads).toBe(2);
  });

  for (const provider of ['kimi', 'kimi-ai']) {
    test(`dispatches ${provider} quota to its fixed usage host`, async () => {
      authFilesApi.downloadText = async () => JSON.stringify({ type: provider });
      const requests: ApiCallRequest[] = [];
      apiCallApi.request = async (request) => {
        requests.push(request);
        return {
          statusCode: 200,
          header: {},
          bodyText: '',
          body: { usages: { limit_month_total: { used_ratio: 0.25 } } },
        };
      };
      const rows = await KIMI_CONFIG.fetchQuota({ ...file, provider }, t);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(provider === 'kimi-ai' ? KIMI_AI_USAGE_URL : KIMI_USAGE_URL);
      expect(requests[0]?.authIndex).toBe('1');
      expect(rows[0]?.used).toBe(25);
    });
  }

  test('download failure never dispatches quota and does not expose credential errors', async () => {
    authFilesApi.downloadText = async () => {
      throw new Error('secret credential');
    };
    let dispatched = false;
    apiCallApi.request = async () => {
      dispatched = true;
      throw new Error('unexpected dispatch');
    };
    await expect(KIMI_CONFIG.fetchQuota(file, t)).rejects.toThrow('kimi_quota.domain_unavailable');
    expect(dispatched).toBe(false);
  });

  test('runtime-only credentials fail without downloading or dispatching', async () => {
    let downloads = 0;
    let requests = 0;
    authFilesApi.downloadText = async () => {
      downloads += 1;
      return '{}';
    };
    apiCallApi.request = async () => {
      requests += 1;
      throw new Error('unexpected dispatch');
    };
    await expect(KIMI_CONFIG.fetchQuota({ ...file, runtimeOnly: true }, t)).rejects.toThrow(
      'kimi_quota.domain_unavailable'
    );
    expect(downloads).toBe(0);
    expect(requests).toBe(0);
  });

  test('usage HTTP failures preserve their status', async () => {
    authFilesApi.downloadText = async () => '{"domain":"ai"}';
    apiCallApi.request = async () => ({
      statusCode: 429,
      header: {},
      bodyText: '{"error":"rate limited"}',
      body: { error: 'rate limited' },
    });
    try {
      await KIMI_CONFIG.fetchQuota(file, t);
      throw new Error('Expected usage failure');
    } catch (error) {
      expect(error).toMatchObject({ status: 429 });
    }
  });

  test('connection change during usage fetch rejects the old response', async () => {
    authFilesApi.downloadText = async () => '{"domain":"ai"}';
    let finish!: () => void;
    let dispatched!: () => void;
    const started = new Promise<void>((resolve) => {
      dispatched = resolve;
    });
    apiCallApi.request = () => {
      dispatched();
      return new Promise((resolve) => {
        finish = () => resolve({ statusCode: 200, header: {}, bodyText: '', body: {} });
      });
    };
    const pending = KIMI_CONFIG.fetchQuota(file, t);
    await started;
    useQuotaStore.getState().clearQuotaCache();
    finish();
    await expect(pending).rejects.toThrow('kimi_quota.stale_request');
  });

  for (const invalidate of ['connection', 'credential']) {
    test(`${invalidate} change during credential download prevents quota dispatch`, async () => {
      let complete!: (text: string) => void;
      authFilesApi.downloadText = () =>
        new Promise((resolve) => {
          complete = resolve;
        });
      let dispatched = false;
      apiCallApi.request = async () => {
        dispatched = true;
        throw new Error('unexpected dispatch');
      };
      const pending = KIMI_CONFIG.fetchQuota(file, t);
      useQuotaStore
        .getState()
        .clearQuotaCache(invalidate === 'credential' ? [file.name] : undefined);
      complete('{"domain":"ai"}');
      await expect(pending).rejects.toThrow('kimi_quota.stale_request');
      expect(dispatched).toBe(false);
    });
  }
});
