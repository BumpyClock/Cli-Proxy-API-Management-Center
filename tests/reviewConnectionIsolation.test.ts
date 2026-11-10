import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { SystemPage } from '@/pages/SystemPage';
import { useAuthFilesOauth } from '@/features/authFiles/hooks/useAuthFilesOauth';
import { apiClient, authFilesApi, configApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n('en');
const mocks: Array<{ mockRestore(): void }> = [];
const configInitial = useConfigStore.getInitialState();
const authInitial = useAuthStore.getInitialState();
const savedConfigInitial = { ...configInitial };
const savedAuthInitial = { ...authInitial };
const version = Object.getOwnPropertyDescriptor(globalThis, '__APP_VERSION__');

beforeEach(() => {
  Object.defineProperty(globalThis, '__APP_VERSION__', { configurable: true, value: 'test' });
  apiClient.setConfig({ apiBase: 'https://first.invalid', managementKey: 'fixture-first' });
  Object.assign(configInitial, { config: { requestLog: true } });
  Object.assign(authInitial, { connectionStatus: 'connected', apiBase: 'https://first.invalid' });
  useConfigStore.setState({ config: { requestLog: true } });
});
afterEach(() => {
  for (const mock of mocks.splice(0)) mock.mockRestore();
  Object.assign(configInitial, savedConfigInitial);
  Object.assign(authInitial, savedAuthInitial);
  useConfigStore.setState(savedConfigInitial);
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  if (version) Object.defineProperty(globalThis, '__APP_VERSION__', version);
  else Reflect.deleteProperty(globalThis, '__APP_VERSION__');
});

function capture<T>(hook: () => T): T {
  let result: T;
  function Harness() {
    result = hook();
    return null;
  }
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(Harness)));
  return result!;
}
function findSave(node: ReactNode): (() => Promise<void>) | undefined {
  if (Array.isArray(node)) return node.map(findSave).find(Boolean);
  if (
    !isValidElement<{ children?: ReactNode; footer?: ReactNode; onClick?: () => Promise<void> }>(
      node
    )
  )
    return undefined;
  if (node.type === Button && node.props.children === 'Save') return node.props.onClick;
  return findSave(node.props.footer) ?? findSave(node.props.children);
}

for (const transition of ['same', 'switch', 'logout'] as const) {
  for (const outcome of ['success', 'failure'] as const) {
    test(`request-log ${outcome} after ${transition} updates only its owning session`, async () => {
      let finish!: () => void;
      let fail!: (error: Error) => void;
      const pending = new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      const update = spyOn(configApi, 'updateRequestLog').mockReturnValue(pending);
      const notify = spyOn(
        useNotificationStore.getInitialState(),
        'showNotification'
      ).mockImplementation(() => {});
      const invalidate = spyOn(configInitial, 'invalidateCache');
      mocks.push(update, notify, invalidate);
      const save = findSave(capture(() => SystemPage()));
      expect(save).toBeDefined();
      const saving = save!();
      expect(useConfigStore.getState().config?.requestLog).toBe(false);
      if (transition === 'switch') {
        apiClient.setConfig({ apiBase: 'https://second.invalid', managementKey: 'fixture-second' });
        useConfigStore.setState({ config: { requestLog: false, debug: true } });
      } else if (transition === 'logout') {
        apiClient.setConfig({ apiBase: '', managementKey: '' });
        useConfigStore.getState().clearCache();
      }
      if (outcome === 'success') finish();
      else fail(new Error('fixture response failure'));
      await saving;
      if (transition === 'same') {
        expect(useConfigStore.getState().config?.requestLog).toBe(outcome === 'failure');
        expect(notify).toHaveBeenCalledTimes(1);
        expect(invalidate).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0);
      } else {
        expect(useConfigStore.getState().config).toEqual(
          transition === 'logout' ? null : { requestLog: false, debug: true }
        );
        expect(notify).not.toHaveBeenCalled();
        expect(invalidate).not.toHaveBeenCalled();
      }
    });
  }
}

for (const reason of ['conflict', 'connection-change'] as const) {
  test(`OAuth exclusion deletion never retries a mutation after ${reason}`, async () => {
    const get = spyOn(authFilesApi, 'getOauthExcludedModels').mockResolvedValue({
      claude: ['old'],
    });
    const write = spyOn(apiClient, 'put').mockResolvedValue({});
    const remove = spyOn(authFilesApi, 'deleteOauthExcludedEntry').mockImplementation(async () => {
      if (reason === 'connection-change')
        apiClient.setConfig({ apiBase: 'https://second.invalid', managementKey: 'fixture-second' });
      throw Object.assign(
        new Error(reason),
        reason === 'conflict' ? { status: 412 } : { code: 'ERR_CANCELED' }
      );
    });
    const confirm = spyOn(
      useNotificationStore.getInitialState(),
      'showConfirmation'
    ).mockImplementation(() => {});
    const notify = spyOn(
      useNotificationStore.getInitialState(),
      'showNotification'
    ).mockImplementation(() => {});
    mocks.push(get, write, remove, confirm, notify);
    const hook = capture(() => useAuthFilesOauth({ viewMode: 'list', files: [] }));
    await hook.loadExcluded();
    hook.deleteExcluded('claude');
    await confirm.mock.calls[0][0].onConfirm();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(reason === 'conflict' ? 1 : 0);
  });
}
