import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { apiClient, authFilesApi } from '@/services/api';
import { getErrorMessage, isRequestCancelled } from '@/utils/helpers';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem, OAuthModelAliasEntry } from '@/types';
import type { AuthFileModelItem, OAuthConfigLoadError } from '@/features/authFiles/constants';
import { normalizeProviderKey } from '@/features/authFiles/constants';
type ViewMode = 'diagram' | 'list';

export type UseAuthFilesOauthResult = {
  excluded: Record<string, string[]>;
  excludedError: OAuthConfigLoadError;
  modelAlias: Record<string, OAuthModelAliasEntry[]>;
  modelAliasError: OAuthConfigLoadError;
  allProviderModels: Record<string, AuthFileModelItem[]>;
  providerList: string[];
  loadExcluded: () => Promise<void>;
  loadModelAlias: () => Promise<void>;
  deleteExcluded: (provider: string) => void;
  deleteModelAlias: (provider: string) => void;
  handleMappingUpdate: (provider: string, sourceModel: string, newAlias: string) => Promise<void>;
  handleDeleteLink: (provider: string, sourceModel: string, alias: string) => void;
  handleToggleFork: (
    provider: string,
    sourceModel: string,
    alias: string,
    fork: boolean
  ) => Promise<void>;
  handleRenameAlias: (oldAlias: string, newAlias: string) => Promise<void>;
  handleDeleteAlias: (aliasName: string) => void;
};

export type UseAuthFilesOauthOptions = {
  viewMode: ViewMode;
  files: AuthFileItem[];
};

export function useAuthFilesOauth(options: UseAuthFilesOauthOptions): UseAuthFilesOauthResult {
  const { viewMode, files } = options;
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();

  const [excluded, setExcluded] = useState<Record<string, string[]>>({});
  const [excludedError, setExcludedError] = useState<OAuthConfigLoadError>('loading');
  const [modelAlias, setModelAlias] = useState<Record<string, OAuthModelAliasEntry[]>>({});
  const [modelAliasError, setModelAliasError] = useState<OAuthConfigLoadError>('loading');
  const [allProviderModels, setAllProviderModels] = useState<Record<string, AuthFileModelItem[]>>(
    {}
  );

  const excludedUnsupportedRef = useRef(false);
  const mappingsUnsupportedRef = useRef(false);
  const excludedReadyRef = useRef(false);
  const modelAliasReadyRef = useRef(false);
  const excludedLoadRequestRef = useRef(0);
  const modelAliasLoadRequestRef = useRef(0);

  useEffect(
    () => () => {
      excludedReadyRef.current = false;
      modelAliasReadyRef.current = false;
      excludedLoadRequestRef.current += 1;
      modelAliasLoadRequestRef.current += 1;
    },
    []
  );

  const providerList = useMemo(() => {
    const providers = new Set<string>();

    Object.keys(modelAlias).forEach((provider) => {
      const key = provider.trim().toLowerCase();
      if (key) providers.add(key);
    });

    files.forEach((file) => {
      if (typeof file.type === 'string') {
        const key = file.type.trim().toLowerCase();
        if (key) providers.add(key);
      }
      if (typeof file.provider === 'string') {
        const key = file.provider.trim().toLowerCase();
        if (key) providers.add(key);
      }
    });
    return Array.from(providers);
  }, [files, modelAlias]);

  useEffect(() => {
    if (viewMode !== 'diagram') return;

    let cancelled = false;

    const loadAllModels = async () => {
      if (providerList.length === 0) {
        if (!cancelled) setAllProviderModels({});
        return;
      }

      const results = await Promise.all(
        providerList.map(async (provider) => {
          try {
            const models = await authFilesApi.getModelDefinitions(provider);
            return { provider, models };
          } catch {
            return { provider, models: [] as AuthFileModelItem[] };
          }
        })
      );

      if (cancelled) return;

      const nextModels: Record<string, AuthFileModelItem[]> = {};
      results.forEach(({ provider, models }) => {
        if (models.length > 0) {
          nextModels[provider] = models;
        }
      });

      setAllProviderModels(nextModels);
    };

    void loadAllModels();

    return () => {
      cancelled = true;
    };
  }, [providerList, viewMode]);

  const loadExcluded = useCallback(async () => {
    const requestId = ++excludedLoadRequestRef.current;
    excludedReadyRef.current = false;
    setExcludedError('loading');
    try {
      const res = await authFilesApi.getOauthExcludedModels();
      if (requestId !== excludedLoadRequestRef.current) return;
      excludedUnsupportedRef.current = false;
      excludedReadyRef.current = true;
      setExcluded(res || {});
      setExcludedError(null);
    } catch (err: unknown) {
      if (requestId !== excludedLoadRequestRef.current) return;
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status?: unknown }).status
          : undefined;

      if (status === 404) {
        setExcluded({});
        setExcludedError('unsupported');
        if (!excludedUnsupportedRef.current) {
          excludedUnsupportedRef.current = true;
          showNotification(t('oauth_excluded.upgrade_required'), 'warning');
        }
        return;
      }
      setExcludedError('load');
    }
  }, [showNotification, t]);

  const loadModelAlias = useCallback(async () => {
    const requestId = ++modelAliasLoadRequestRef.current;
    modelAliasReadyRef.current = false;
    setModelAliasError('loading');
    try {
      const res = await authFilesApi.getOauthModelAlias();
      if (requestId !== modelAliasLoadRequestRef.current) return;
      mappingsUnsupportedRef.current = false;
      modelAliasReadyRef.current = true;
      setModelAlias(res || {});
      setModelAliasError(null);
    } catch (err: unknown) {
      if (requestId !== modelAliasLoadRequestRef.current) return;
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status?: unknown }).status
          : undefined;

      if (status === 404) {
        setModelAlias({});
        setModelAliasError('unsupported');
        if (!mappingsUnsupportedRef.current) {
          mappingsUnsupportedRef.current = true;
          showNotification(t('oauth_model_alias.upgrade_required'), 'warning');
        }
        return;
      }
      setModelAliasError('load');
    }
  }, [showNotification, t]);

  const showLoadRequired = useCallback(() => {
    showNotification(t('notification.refresh_failed'), 'error');
  }, [showNotification, t]);

  const deleteExcluded = useCallback(
    (provider: string) => {
      const providerLabel = provider.trim() || provider;
      const revision = apiClient.getConnectionRevision();
      showConfirmation({
        title: t('oauth_excluded.delete_title', { defaultValue: 'Delete Exclusion' }),
        message: t('oauth_excluded.delete_confirm', { provider: providerLabel }),
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          if (apiClient.getConnectionRevision() !== revision) return;
          if (!excludedReadyRef.current) {
            showLoadRequired();
            return;
          }
          const providerKey = normalizeProviderKey(provider);
          if (!providerKey) {
            showNotification(t('oauth_excluded.provider_required'), 'error');
            return;
          }
          try {
            await authFilesApi.deleteOauthExcludedEntry(providerKey);
            if (apiClient.getConnectionRevision() !== revision) return;
            await loadExcluded();
            if (apiClient.getConnectionRevision() !== revision) return;
            showNotification(t('oauth_excluded.delete_success'), 'success');
          } catch (err: unknown) {
            if (apiClient.getConnectionRevision() !== revision || isRequestCancelled(err)) return;
            const errorMessage = getErrorMessage(err);
            showNotification(`${t('oauth_excluded.delete_failed')}: ${errorMessage}`, 'error');
          }
        },
      });
    },
    [loadExcluded, showConfirmation, showLoadRequired, showNotification, t]
  );

  const mutateModelAlias = useCallback(
    async (
      action: () => Promise<void>,
      operation: 'save' | 'delete' = 'save',
      revision = apiClient.getConnectionRevision()
    ) => {
      if (apiClient.getConnectionRevision() !== revision) return;
      if (!modelAliasReadyRef.current) {
        showLoadRequired();
        return;
      }
      try {
        await action();
        if (apiClient.getConnectionRevision() !== revision) return;
        await loadModelAlias();
        if (apiClient.getConnectionRevision() !== revision) return;
        showNotification(t(`oauth_model_alias.${operation}_success`), 'success');
      } catch (err: unknown) {
        if (apiClient.getConnectionRevision() !== revision || isRequestCancelled(err)) return;
        const duplicate =
          typeof err === 'object' &&
          err !== null &&
          'apiCode' in err &&
          err.apiCode === 'duplicate_alias';
        const message = duplicate ? t('oauth_model_alias.duplicate_alias') : getErrorMessage(err);
        showNotification(`${t(`oauth_model_alias.${operation}_failed`)}: ${message}`, 'error');
      }
    },
    [loadModelAlias, showLoadRequired, showNotification, t]
  );

  const deleteModelAlias = useCallback(
    (provider: string) => {
      const revision = apiClient.getConnectionRevision();
      showConfirmation({
        title: t('oauth_model_alias.delete_title', { defaultValue: 'Delete Mappings' }),
        message: t('oauth_model_alias.delete_confirm', { provider }),
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: () =>
          mutateModelAlias(() => authFilesApi.deleteOauthModelAlias(provider), 'delete', revision),
      });
    },
    [mutateModelAlias, showConfirmation, t]
  );

  const handleMappingUpdate = useCallback(
    async (provider: string, sourceModel: string, newAlias: string) => {
      if (!normalizeProviderKey(provider) || !sourceModel.trim() || !newAlias.trim()) return;
      await mutateModelAlias(() =>
        authFilesApi.editOauthAliases({
          type: 'add',
          provider,
          model: sourceModel,
          alias: newAlias,
        })
      );
    },
    [mutateModelAlias]
  );

  const handleDeleteLink = useCallback(
    (provider: string, sourceModel: string, alias: string) => {
      const nameTrim = sourceModel.trim();
      const aliasTrim = alias.trim();
      if (!provider || !nameTrim || !aliasTrim) return;
      const revision = apiClient.getConnectionRevision();

      showConfirmation({
        title: t('oauth_model_alias.delete_link_title', { defaultValue: 'Unlink mapping' }),
        message: (
          <Trans
            i18nKey="oauth_model_alias.delete_link_confirm"
            values={{ provider, sourceModel: nameTrim, alias: aliasTrim }}
            components={{ code: <code /> }}
          />
        ),
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: () =>
          mutateModelAlias(
            () =>
              authFilesApi.editOauthAliases({
                type: 'unlink',
                provider,
                model: nameTrim,
                alias: aliasTrim,
              }),
            'save',
            revision
          ),
      });
    },
    [mutateModelAlias, showConfirmation, t]
  );

  const handleToggleFork = useCallback(
    (provider: string, sourceModel: string, alias: string, fork: boolean) =>
      mutateModelAlias(() =>
        authFilesApi.editOauthAliases({ type: 'fork', provider, model: sourceModel, alias, fork })
      ),
    [mutateModelAlias]
  );

  const handleRenameAlias = useCallback(
    async (oldAlias: string, newAlias: string) => {
      if (!oldAlias.trim() || !newAlias.trim() || oldAlias.trim() === newAlias.trim()) return;
      await mutateModelAlias(() =>
        authFilesApi.editOauthAliases({ type: 'rename', alias: oldAlias, newAlias })
      );
    },
    [mutateModelAlias]
  );

  const handleDeleteAlias = useCallback(
    (aliasName: string) => {
      const alias = aliasName.trim();
      if (!alias) return;
      const revision = apiClient.getConnectionRevision();

      showConfirmation({
        title: t('oauth_model_alias.delete_alias_title', { defaultValue: 'Delete Alias' }),
        message: (
          <Trans
            i18nKey="oauth_model_alias.delete_alias_confirm"
            values={{ alias }}
            components={{ code: <code /> }}
          />
        ),
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: () =>
          mutateModelAlias(
            () => authFilesApi.editOauthAliases({ type: 'delete', alias }),
            'delete',
            revision
          ),
      });
    },
    [mutateModelAlias, showConfirmation, t]
  );

  return {
    excluded,
    excludedError,
    modelAlias,
    modelAliasError,
    allProviderModels,
    providerList,
    loadExcluded,
    loadModelAlias,
    deleteExcluded,
    deleteModelAlias,
    handleMappingUpdate,
    handleDeleteLink,
    handleToggleFork,
    handleRenameAlias,
    handleDeleteAlias,
  };
}
