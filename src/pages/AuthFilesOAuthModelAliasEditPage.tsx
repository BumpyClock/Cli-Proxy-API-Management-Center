import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconInfo, IconPlus } from '@/components/ui/icons';
import { OAuthEditorProviderCard } from '@/features/authFiles/components/OAuthEditorProviderCard';
import { OAuthAliasMappingRow } from '@/features/authFiles/components/OAuthAliasMappingRow';
import { OAuthEditorActions } from '@/features/authFiles/components/OAuthEditorActions';
import { PageHeader } from '@/components/ui/PageHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useAuthStore, useNotificationStore } from '@/stores';
import { authFilesApi } from '@/services/api';
import {
  buildOAuthProviderOptions,
  getTypeLabel,
  normalizeProviderKey,
} from '@/features/authFiles/constants';
import {
  getModelAliasDraftSignature,
  isOAuthEditorDirty,
} from '@/features/authFiles/oauthEditorState';
import type { AuthFileItem, OAuthModelAliasEntry } from '@/types';
import { generateId, getErrorMessage } from '@/utils/helpers';
import styles from '@/features/authFiles/components/OAuthEditor.module.scss';
import bodyStyles from './AuthFilesOAuthModelAliasEditPage.module.scss';

type AuthFileModelItem = { id: string; display_name?: string; type?: string; owned_by?: string };

type LocationState = { fromAuthFiles?: boolean } | null;

type OAuthModelMappingFormEntry = OAuthModelAliasEntry & { id: string };

const buildEmptyMappingEntry = (): OAuthModelMappingFormEntry => ({
  id: generateId(),
  name: '',
  alias: '',
  fork: true,
});

const normalizeMappingEntries = (
  entries?: OAuthModelAliasEntry[]
): OAuthModelMappingFormEntry[] => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [buildEmptyMappingEntry()];
  }
  return entries.map((entry) => ({
    id: generateId(),
    name: entry.name ?? '',
    alias: entry.alias ?? '',
    fork: Boolean(entry.fork),
    forceMapping: entry.forceMapping,
  }));
};

export function AuthFilesOAuthModelAliasEditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { showConfirmation, showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const disableControls = connectionStatus !== 'connected';

  const [searchParams, setSearchParams] = useSearchParams();
  const providerFromParams = searchParams.get('provider') ?? '';
  const [initialProviderKey] = useState(() => normalizeProviderKey(providerFromParams));

  const [provider, setProvider] = useState(providerFromParams);
  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [excluded, setExcluded] = useState<Record<string, string[]>>({});
  const [modelAlias, setModelAlias] = useState<Record<string, OAuthModelAliasEntry[]>>({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null);
  const [baselineReady, setBaselineReady] = useState(false);
  const [modelAliasUnsupported, setModelAliasUnsupported] = useState(false);
  const loadRequestRef = useRef(0);

  const [mappings, setMappings] = useState<OAuthModelMappingFormEntry[]>([
    buildEmptyMappingEntry(),
  ]);
  const [modelsList, setModelsList] = useState<AuthFileModelItem[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<'unsupported' | null>(null);
  const [saving, setSaving] = useState(false);
  const providerRequirementId = useId();
  const saveReasonId = useId();

  useEffect(() => {
    setProvider(providerFromParams);
  }, [providerFromParams]);

  const providerOptions = useMemo(() => {
    const extraProviders = new Set<string>();
    Object.keys(excluded).forEach((value) => extraProviders.add(value));
    Object.keys(modelAlias).forEach((value) => extraProviders.add(value));
    files.forEach((file) => {
      if (typeof file.type === 'string') {
        extraProviders.add(file.type);
      }
      if (typeof file.provider === 'string') {
        extraProviders.add(file.provider);
      }
    });

    return buildOAuthProviderOptions(extraProviders);
  }, [excluded, files, modelAlias]);

  const resolvedProviderKey = useMemo(() => normalizeProviderKey(provider), [provider]);
  /** One predicate gates Save, the requirement under the Provider field and the catalog hint. */
  const providerMissing = !resolvedProviderKey;
  const isEditing = useMemo(() => {
    if (!resolvedProviderKey) return false;
    return Object.prototype.hasOwnProperty.call(modelAlias, resolvedProviderKey);
  }, [modelAlias, resolvedProviderKey]);
  const baselineMappingsSignature = useMemo(
    () => getModelAliasDraftSignature(modelAlias[resolvedProviderKey] ?? []),
    [modelAlias, resolvedProviderKey]
  );
  const mappingsSignature = useMemo(() => getModelAliasDraftSignature(mappings), [mappings]);
  const contentDirty = baselineMappingsSignature !== mappingsSignature;
  const isDirty = isOAuthEditorDirty(
    initialProviderKey,
    provider,
    baselineMappingsSignature,
    mappingsSignature
  );
  const unsavedChangesDialog = useMemo(
    () => ({
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.leave'),
      cancelText: t('common.stay'),
    }),
    [t]
  );
  const { allowNextNavigation, allowNavigationTo } = useUnsavedChangesGuard({
    shouldBlock: isDirty,
    dialog: unsavedChangesDialog,
  });
  // The h1 names the destination (matches breadcrumb and section tab); the provider goes in meta.
  const providerName = getTypeLabel(t, provider.trim() || resolvedProviderKey);
  const headerMeta = providerMissing
    ? undefined
    : t(isEditing ? 'oauth_model_alias.meta_editing' : 'oauth_model_alias.meta_new', {
        provider: providerName,
      });

  const catalogHint = useMemo(() => {
    if (modelsLoading) {
      return t('oauth_model_alias.model_source_loading');
    }
    if (modelsError === 'unsupported') {
      return t('oauth_model_alias.model_source_unsupported');
    }
    return t('oauth_model_alias.model_source_loaded', { count: modelsList.length });
  }, [modelsError, modelsList.length, modelsLoading, t]);

  const handleBack = useCallback(() => {
    const state = location.state as LocationState;
    if (state?.fromAuthFiles) {
      navigate(-1);
      return;
    }
    navigate('/auth-files', { replace: true });
  }, [location.state, navigate]);

  const swipeRef = useEdgeSwipeBack({ onBack: handleBack });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBack]);

  const loadInitialData = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setInitialLoading(true);
    setInitialLoadError(null);
    setBaselineReady(false);
    setModelAliasUnsupported(false);

    try {
      const [filesResult, excludedResult, aliasResult] = await Promise.allSettled([
        authFilesApi.list(),
        authFilesApi.getOauthExcludedModels(),
        authFilesApi.getOauthModelAlias(),
      ]);

      if (requestId !== loadRequestRef.current) return;

      if (filesResult.status === 'fulfilled') {
        setFiles(filesResult.value?.files ?? []);
      }

      if (excludedResult.status === 'fulfilled') {
        setExcluded(excludedResult.value ?? {});
      }

      if (aliasResult.status === 'fulfilled') {
        setModelAlias(aliasResult.value ?? {});
        setBaselineReady(true);
        return;
      }

      const err = aliasResult.reason;
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status?: unknown }).status
          : undefined;

      if (status === 404) {
        setModelAliasUnsupported(true);
        return;
      }
      setInitialLoadError(getErrorMessage(err));
    } catch (err: unknown) {
      if (requestId === loadRequestRef.current) {
        setInitialLoadError(getErrorMessage(err));
      }
    } finally {
      if (requestId === loadRequestRef.current) {
        setInitialLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadInitialData();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [loadInitialData]);

  useEffect(() => {
    if (!resolvedProviderKey) {
      setMappings([buildEmptyMappingEntry()]);
      return;
    }
    const existing = modelAlias[resolvedProviderKey] ?? [];
    setMappings(normalizeMappingEntries(existing));
  }, [modelAlias, resolvedProviderKey]);

  useEffect(() => {
    if (!resolvedProviderKey || modelAliasUnsupported) {
      setModelsList([]);
      setModelsError(null);
      setModelsLoading(false);
      return;
    }

    let cancelled = false;
    setModelsLoading(true);
    setModelsError(null);

    authFilesApi
      .getModelDefinitions(resolvedProviderKey)
      .then((models) => {
        if (cancelled) return;
        setModelsList(models);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status =
          typeof err === 'object' && err !== null && 'status' in err
            ? (err as { status?: unknown }).status
            : undefined;

        if (status === 400 || status === 404) {
          setModelsList([]);
          setModelsError('unsupported');
          return;
        }

        const errorMessage = err instanceof Error ? err.message : '';
        showNotification(`${t('notification.load_failed')}: ${errorMessage}`, 'error');
      })
      .finally(() => {
        if (cancelled) return;
        setModelsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [modelAliasUnsupported, resolvedProviderKey, showNotification, t]);

  const applyProviderChange = useCallback(
    (value: string) => {
      setProvider(value);
      const next = new URLSearchParams(searchParams);
      const trimmed = value.trim();
      if (trimmed) {
        next.set('provider', trimmed);
      } else {
        next.delete('provider');
      }
      const nextSearch = next.toString();
      allowNavigationTo(
        `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}${location.hash}`
      );
      setSearchParams(next, { replace: true });
    },
    [allowNavigationTo, location.hash, location.pathname, searchParams, setSearchParams]
  );

  const updateProvider = useCallback(
    (value: string) => {
      if (!contentDirty || normalizeProviderKey(value) === resolvedProviderKey) {
        applyProviderChange(value);
        return;
      }
      showConfirmation({
        ...unsavedChangesDialog,
        variant: 'danger',
        onConfirm: () => applyProviderChange(value),
      });
    },
    [applyProviderChange, contentDirty, resolvedProviderKey, showConfirmation, unsavedChangesDialog]
  );

  const updateMappingEntry = useCallback(
    (index: number, field: keyof OAuthModelAliasEntry, value: string | boolean) => {
      setMappings((prev) =>
        prev.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry))
      );
    },
    []
  );

  const addMappingEntry = useCallback(() => {
    setMappings((prev) => [...prev, buildEmptyMappingEntry()]);
  }, []);

  const removeMappingEntry = useCallback((index: number) => {
    setMappings((prev) => {
      const next = prev.filter((_, idx) => idx !== index);
      return next.length ? next : [buildEmptyMappingEntry()];
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (providerMissing) return;

    const seenAlias = new Set<string>();
    let hasDuplicateAlias = false;
    const normalized = mappings
      .map((entry) => {
        const name = String(entry.name ?? '').trim();
        const alias = String(entry.alias ?? '').trim();
        if (!name || !alias) return null;
        const aliasKey = alias.toLowerCase();
        if (seenAlias.has(aliasKey)) {
          hasDuplicateAlias = true;
          return null;
        }
        seenAlias.add(aliasKey);
        const normalizedEntry: OAuthModelAliasEntry = { name, alias };
        if (entry.fork) normalizedEntry.fork = true;
        if (typeof entry.forceMapping === 'boolean') {
          normalizedEntry.forceMapping = entry.forceMapping;
        }
        return normalizedEntry;
      })
      .filter(Boolean) as OAuthModelAliasEntry[];

    if (hasDuplicateAlias) {
      showNotification(t('oauth_model_alias.duplicate_alias'), 'error');
      return;
    }

    setSaving(true);
    try {
      if (normalized.length) {
        await authFilesApi.saveOauthModelAlias(resolvedProviderKey, normalized);
      } else if (isEditing) {
        await authFilesApi.deleteOauthModelAlias(resolvedProviderKey);
      }
      showNotification(t('oauth_model_alias.save_success'), 'success');
      allowNextNavigation();
      handleBack();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('oauth_model_alias.save_failed')}: ${errorMessage}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [
    allowNextNavigation,
    handleBack,
    isEditing,
    mappings,
    providerMissing,
    resolvedProviderKey,
    showNotification,
    t,
  ]);

  const editorReady = !initialLoading && !modelAliasUnsupported && initialLoadError === null;
  const showProviderRequirement = editorReady && providerMissing;
  const canSave =
    !providerMissing &&
    !disableControls &&
    !saving &&
    baselineReady &&
    !modelAliasUnsupported &&
    initialLoadError === null;

  return (
    <div ref={swipeRef} className={styles.pageContent}>
      <PageHeader
        title={t('oauth_model_alias.title')}
        description={t('oauth_model_alias.editor_description')}
        meta={headerMeta && <p className={styles.headerMeta}>{headerMeta}</p>}
      />
      {initialLoading ? (
        <div className={styles.loading} role="status">
          <LoadingSpinner size={16} />
          {t('common.loading')}
        </div>
      ) : modelAliasUnsupported ? (
        <Card>
          <EmptyState
            title={t('oauth_model_alias.upgrade_required_title')}
            description={t('oauth_model_alias.upgrade_required_desc')}
          />
        </Card>
      ) : initialLoadError !== null ? (
        <Card>
          <EmptyState
            title={t('notification.refresh_failed')}
            description={initialLoadError || t('notification.refresh_failed')}
            action={
              <Button variant="secondary" size="sm" onClick={() => void loadInitialData()}>
                {t('common.refresh')}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <OAuthEditorProviderCard
            provider={provider}
            options={providerOptions}
            onChange={updateProvider}
            disabled={disableControls || saving}
            translationPrefix="oauth_model_alias"
            requirementId={showProviderRequirement ? providerRequirementId : undefined}
          />

          <Card className={styles.settingsCard}>
            <div className={styles.editorHeader}>
              <div className={styles.sectionHeading}>
                <span className={styles.stepNumber} aria-hidden="true">
                  02
                </span>
                <div className={styles.headingCopy}>
                  <h2 className={styles.editorSectionTitle}>
                    {t('oauth_model_alias.alias_label')}
                  </h2>
                  <p className={styles.editorDescription}>{t('oauth_model_alias.mapping_hint')}</p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={addMappingEntry}
                disabled={disableControls || saving || modelAliasUnsupported}
              >
                <IconPlus size={14} aria-hidden="true" />
                {t('oauth_model_alias.add_alias')}
              </Button>
            </div>

            {!providerMissing && (
              <div className={bodyStyles.catalogHint}>
                <IconInfo size={15} aria-hidden="true" />
                <p className={styles.editorDescription}>{catalogHint}</p>
              </div>
            )}

            <div className={bodyStyles.mappingsBody}>
              {mappings.map((entry, index) => (
                <OAuthAliasMappingRow
                  key={entry.id}
                  entry={entry}
                  index={index}
                  options={modelsList.map((model) => ({
                    value: model.id,
                    label:
                      model.display_name && model.display_name !== model.id
                        ? model.display_name
                        : undefined,
                  }))}
                  disabled={disableControls || saving}
                  canRemove={mappings.length > 1}
                  onChange={(field, value) => updateMappingEntry(index, field, value)}
                  onRemove={() => removeMappingEntry(index)}
                />
              ))}
            </div>
          </Card>
        </>
      )}
      <OAuthEditorActions
        reason={
          showProviderRequirement
            ? { id: saveReasonId, text: t('oauth_model_alias.provider_required') }
            : undefined
        }
      >
        <Button variant="secondary" className={styles.pageBack} onClick={handleBack}>
          {t('common.back')}
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          loading={saving}
          disabled={!canSave}
          aria-describedby={showProviderRequirement ? saveReasonId : undefined}
        >
          {t('oauth_model_alias.save')}
        </Button>
      </OAuthEditorActions>
    </div>
  );
}
