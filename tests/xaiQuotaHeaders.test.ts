import { afterEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { XAI_CONFIG } from '@/features/quota/providers/xai/data';
import { apiCallApi, type ApiCallRequest } from '@/services/api';
import { XAI_BILLING_MONTHLY_URL, XAI_BILLING_WEEKLY_URL } from '@/utils/quota';

const t = ((key: string) => key) as TFunction;
const originalRequest = apiCallApi.request;

afterEach(() => {
  apiCallApi.request = originalRequest;
});

describe('Grok quota request identity', () => {
  test('sends version 1.0.70 in both billing headers and user-agent segments', async () => {
    const requests: ApiCallRequest[] = [];
    apiCallApi.request = async (request) => {
      requests.push(request);
      const body = { config: { monthlyLimit: { val: 10000 }, used: { val: 1000 } } };
      return { statusCode: 200, header: {}, body, bodyText: JSON.stringify(body) };
    };

    await XAI_CONFIG.fetchQuota(
      { name: 'xai.json', authIndex: 'xai:fixture', user_id: 'fixture-user' },
      t
    );

    expect(requests.map((request) => request.url).sort()).toEqual(
      [XAI_BILLING_WEEKLY_URL, XAI_BILLING_MONTHLY_URL].sort()
    );
    for (const request of requests) {
      expect(request.authIndex).toBe('xai:fixture');
      expect(request.header).toEqual({
        Authorization: 'Bearer $TOKEN$',
        'x-xai-token-auth': 'xai-grok-cli',
        'x-grok-client-version': '1.0.70',
        accept: '*/*',
        'user-agent': 'grok-pager/1.0.70 grok-shell/1.0.70 (macos; aarch64)',
        'x-userid': 'fixture-user',
      });
    }
  });
});
