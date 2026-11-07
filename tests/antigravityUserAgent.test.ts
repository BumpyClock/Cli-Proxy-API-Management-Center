import { afterEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { ANTIGRAVITY_CONFIG } from '@/features/quota/providers/antigravity/data';
import { apiCallApi, type ApiCallRequest } from '@/services/api';
import {
  ANTIGRAVITY_CODE_ASSIST_URL,
  ANTIGRAVITY_QUOTA_URLS,
  buildAntigravityUserAgent,
} from '@/utils/quota';

const t = ((key: string) => key) as TFunction;
const originalRequest = apiCallApi.request;

afterEach(() => {
  apiCallApi.request = originalRequest;
});

describe('Antigravity Hub request identity', () => {
  test('uses Hub format for default and explicit platform overrides', () => {
    expect(buildAntigravityUserAgent()).toBe('antigravity/hub/2.23.0 darwin/arm64');
    expect(buildAntigravityUserAgent({ version: '2.24.0', platform: 'linux/x64' })).toBe(
      'antigravity/hub/2.24.0 linux/x64'
    );
  });

  test('sends Hub headers on both quota and subscription requests', async () => {
    const requests: ApiCallRequest[] = [];
    apiCallApi.request = async (request) => {
      requests.push(request);
      const body =
        request.url === ANTIGRAVITY_CODE_ASSIST_URL
          ? { currentTier: { id: 'free-tier' } }
          : { groups: [{ displayName: 'Models', buckets: [{ remainingFraction: 0.5 }] }] };
      return { statusCode: 200, header: {}, body, bodyText: JSON.stringify(body) };
    };

    await ANTIGRAVITY_CONFIG.fetchQuota(
      { name: 'antigravity.json', authIndex: 'antigravity:fixture', project_id: 'fixture' },
      t
    );

    expect(requests.map((request) => request.url).sort()).toEqual(
      [ANTIGRAVITY_CODE_ASSIST_URL, ANTIGRAVITY_QUOTA_URLS[0]].sort()
    );
    for (const request of requests) {
      expect(request.authIndex).toBe('antigravity:fixture');
      expect(request.header).toEqual({
        Authorization: 'Bearer $TOKEN$',
        'Content-Type': 'application/json',
        'User-Agent': 'antigravity/hub/2.23.0 darwin/arm64',
      });
    }
  });
});
