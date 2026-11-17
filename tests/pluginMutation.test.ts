import { expect, test } from 'bun:test';
import { beginPluginMutation } from '@/features/plugins/pluginMutation';
import { apiClient } from '@/services/api/client';

test('only one plugin mutation can start on a connection until its owner releases it', () => {
  const first = beginPluginMutation();
  expect(first).not.toBeNull();
  try {
    expect(beginPluginMutation()).toBeNull();
  } finally {
    first?.release();
  }
  const retry = beginPluginMutation();
  expect(retry).not.toBeNull();
  retry?.release();
});

test('a stale plugin mutation or confirmation cannot block or release the new connection', () => {
  apiClient.setConfig({ apiBase: 'https://old.invalid', managementKey: 'fixture' });
  const previousRevision = apiClient.getConnectionRevision();
  const previous = beginPluginMutation();
  apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'fixture' });
  const current = beginPluginMutation();
  try {
    expect(current).not.toBeNull();
    expect(beginPluginMutation(previousRevision)).toBeNull();
    expect(() => previous?.assertConnection()).toThrow('The management connection changed.');
    previous?.release();
    expect(beginPluginMutation()).toBeNull();
  } finally {
    current?.release();
    previous?.release();
    apiClient.setConfig({ apiBase: '', managementKey: '' });
  }
});
