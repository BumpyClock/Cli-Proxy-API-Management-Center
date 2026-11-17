import { create } from 'zustand';
import { apiClient } from '@/services/api/client';
import { guardConfigConnection } from '@/services/api/configValue';

const usePluginMutationStore = create<{ active: { revision: number } | null }>(() => ({
  active: null,
}));

export function usePluginMutationBusy(): boolean {
  return usePluginMutationStore(
    (state) => state.active?.revision === apiClient.getConnectionRevision()
  );
}

export function beginPluginMutation(revision = apiClient.getConnectionRevision()) {
  if (
    apiClient.getConnectionRevision() !== revision ||
    usePluginMutationStore.getState().active?.revision === revision
  ) {
    return null;
  }
  const active = { revision };
  const assertConnection = guardConfigConnection();
  usePluginMutationStore.setState({ active });
  return {
    assertConnection,
    release() {
      if (usePluginMutationStore.getState().active === active) {
        usePluginMutationStore.setState({ active: null });
      }
    },
  };
}
