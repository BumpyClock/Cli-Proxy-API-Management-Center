import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { CODEX_CONFIG } from '@/features/quota/providers/codex/data';
import { apiCallApi, authFilesApi, apiClient } from '@/services/api';
import { CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL } from '@/utils/quota';

const t = ((key: string) => key) as TFunction;
const file = { name: 'codex-test.json', auth_index: 'test-index', type: 'codex' };
const response = (body: unknown, statusCode = 200) => ({
  statusCode,
  body,
  bodyText: JSON.stringify(body),
  header: {},
});
const reset = () => CODEX_CONFIG.resetQuota!(file, t);
const mocks: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const mock of mocks.splice(0)) mock.mockRestore();
  apiClient.setConfig({ apiBase: '', managementKey: '' });
});

function setup(body: unknown, statusCode = 200) {
  const calls: string[] = [];
  const request = spyOn(apiCallApi, 'request').mockImplementation(async (payload) => {
    if (payload.url === CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL) {
      calls.push('consume');
      return response(body, statusCode);
    }
    calls.push('read');
    return response({});
  });
  const clear = spyOn(authFilesApi, 'resetCooldown').mockImplementation(async () => {
    calls.push('clear');
    return { status: 'ok', auth_index: 'test-index', models: [] };
  });
  mocks.push(request, clear);
  return { calls, request, clear };
}

describe('Codex reset gateway cooldown', () => {
  test.each(['reset', 'already_redeemed'])('clears only after confirmed %s', async (code) => {
    const { calls, clear } = setup({ code, windows_reset: 0 });
    await reset();
    expect(calls.slice(0, 3)).toEqual(['consume', 'clear', 'read']);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith('test-index');
  });

  test.each(['no_credit', 'nothing_to_reset', 'unknown', undefined])(
    'does not clear for %s',
    async (code) => {
      const { calls } = setup({ code });
      await expect(reset()).rejects.toThrow('codex_quota.reset_not_confirmed');
      expect(calls).toEqual(['consume']);
    }
  );

  test('does not clear on HTTP failure', async () => {
    const { calls } = setup({ code: 'reset' }, 503);
    await expect(reset()).rejects.toThrow();
    expect(calls).toEqual(['consume']);
  });

  test('does not clear on transport failure', async () => {
    const { request, clear } = setup({});
    request.mockRejectedValue(new Error('timeout'));
    await expect(reset()).rejects.toThrow('timeout');
    expect(clear).not.toHaveBeenCalled();
  });

  test('cooldown failure does not consume another reset', async () => {
    const { request, clear } = setup({ code: 'reset' });
    clear.mockRejectedValue(new Error('offline'));
    await expect(reset()).rejects.toThrow('codex_quota.reset_cooldown_failed');
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('rejects mismatched cooldown acknowledgements', async () => {
    const { clear } = setup({ code: 'reset' });
    clear.mockRestore();
    const post = spyOn(apiClient, 'post').mockResolvedValue({
      status: 'ok',
      auth_index: 'other-index',
      models: [],
    });
    mocks.push(post);
    await expect(reset()).rejects.toThrow('codex_quota.reset_cooldown_failed');
  });

  test('does not clear a new connection, including switching away and back', async () => {
    const { request, clear } = setup({ code: 'reset' });
    apiClient.setConfig({ apiBase: 'https://original.test', managementKey: 'fixture' });
    request.mockImplementation(async () => {
      apiClient.setConfig({ apiBase: 'https://other.test', managementKey: 'fixture' });
      apiClient.setConfig({ apiBase: 'https://original.test', managementKey: 'fixture' });
      return response({ code: 'reset' });
    });
    await expect(reset()).rejects.toThrow('codex_quota.reset_cooldown_failed');
    expect(clear).not.toHaveBeenCalled();
  });

  test('uses the backend cooldown reset endpoint and auth index', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue({
      status: 'ok',
      auth_index: 'test-index',
      models: [],
    });
    mocks.push(post);
    await authFilesApi.resetCooldown('test-index');
    expect(post).toHaveBeenCalledWith('/reset-quota', { auth_index: 'test-index' });
  });
});
