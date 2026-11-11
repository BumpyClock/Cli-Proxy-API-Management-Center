import { afterEach, expect, spyOn, test } from 'bun:test';
import { configApi } from '@/services/api/config';
import { useConfigStore } from '@/stores/useConfigStore';
import type { Config } from '@/types';

const mocks: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  useConfigStore.getState().clearCache();
  for (const mock of mocks.splice(0)) mock.mockRestore();
});

test('post-write invalidation retains accepted rows and supersedes pre-write reads', async () => {
  let release!: (value: Config) => void;
  const blocked = new Promise<Config>((resolve) => {
    release = resolve;
  });
  const read = spyOn(configApi, 'getConfig')
    .mockResolvedValueOnce({ apiKeys: ['accepted'] })
    .mockImplementationOnce(() => blocked)
    .mockResolvedValueOnce({ apiKeys: ['after-write'] });
  mocks.push(read);
  await useConfigStore.getState().fetchConfig(true);
  const older = useConfigStore.getState().fetchConfig(true);
  try {
    useConfigStore.getState().invalidateCache();
    expect(useConfigStore.getState().config?.apiKeys).toEqual(['accepted']);
    expect(useConfigStore.getState().isCacheValid()).toBe(false);
    const fresh = useConfigStore.getState().fetchConfig(true);
    release({ apiKeys: ['before-write'] });
    await Promise.all([older, fresh]);
    expect(read).toHaveBeenCalledTimes(3);
    expect(useConfigStore.getState().config?.apiKeys).toEqual(['after-write']);
  } finally {
    release({ apiKeys: ['before-write'] });
    await older;
  }
});

test('session clearing removes accepted configuration as well as its cache', () => {
  useConfigStore.setState({ config: { apiKeys: ['accepted'] } });
  useConfigStore.getState().clearCache();
  expect(useConfigStore.getState().config).toBeNull();
  expect(useConfigStore.getState().isCacheValid()).toBe(false);
});

test('optimistic request-log edits retain other fields and the last server document', () => {
  useConfigStore.setState({
    config: {
      apiKeys: ['old'],
      raw: { access: { 'api-keys': ['old'] }, 'api-keys': { meta: [] } },
    },
  });
  useConfigStore.getState().setRequestLog(true);
  expect(useConfigStore.getState().config?.requestLog).toBe(true);
  expect(useConfigStore.getState().config?.apiKeys).toEqual(['old']);
  expect(useConfigStore.getState().config?.raw).toEqual({
    access: { 'api-keys': ['old'] },
    'api-keys': { meta: [] },
  });
  expect(useConfigStore.getState().isCacheValid()).toBe(false);
});
