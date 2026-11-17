import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parse as parseYaml, parseDocument } from 'yaml';
import { useConfigStore, useNotificationStore } from '@/stores';
import { configFileApi } from '@/services/api/configFile';
import { guardConfigConnection } from '@/services/api/configValue';
import { getErrorMessage, isRecord, isRequestCancelled } from '@/utils/helpers';
import type { ConfigEditorMode } from '../constants';

export function readCommercialModeFromYaml(yamlContent: string): boolean {
  try {
    const parsed = parseYaml(yamlContent);
    return isRecord(parsed) && isRecord(parsed.server) && parsed.server['commercial-mode'] === true;
  } catch {
    return false;
  }
}

export type UseConfigDocumentArgs = {
  mode: ConfigEditorMode;
  visualDirty: boolean;
  visualParseError: string | null;
  loadVisualValuesFromYaml: (yaml: string) => { ok: true } | { ok: false; error: string };
  applyVisualChangesToYaml: (yaml: string) => string;
};

type ApplyVisualChanges = UseConfigDocumentArgs['applyVisualChangesToYaml'];

type ConfigSaveDraft =
  | Readonly<{ origin: 'source'; content: string; applyVisualChanges?: ApplyVisualChanges }>
  | Readonly<{ origin: 'visual'; applyVisualChanges: ApplyVisualChanges }>;

type SaveOwner = Readonly<{ revision: number; assertConnection: () => void }>;

type ConfigSavePreview = Readonly<{
  owner: SaveOwner;
  draft: ConfigSaveDraft;
  serverContent: string;
  original: string;
  modified: string;
}>;

export function buildConfigSavePreview(
  owner: SaveOwner,
  draft: ConfigSaveDraft,
  serverContent: string
): ConfigSavePreview {
  const base = draft.origin === 'source' ? draft.content : serverContent;
  const modified = draft.applyVisualChanges ? draft.applyVisualChanges(base) : base;
  const original =
    draft.origin === 'visual' && serverContent !== modified
      ? parseDocument(serverContent).toString({ indent: 2, lineWidth: 120, minContentWidth: 0 })
      : serverContent;
  return { owner, draft, serverContent, original, modified };
}

/**
 * 未编辑源码的模式往返不应重载可视化值，否则会清空字段级 dirty，改变并发合并策略。
 * YAML 曾解析失败时仍须重试解析，避免仅靠切换模式绕过错误。
 */
export function shouldReloadVisualDraft(sourceDirty: boolean, visualParseError: string | null) {
  return sourceDirty || visualParseError !== null;
}

export function useConfigDocument({
  mode,
  visualDirty,
  visualParseError,
  loadVisualValuesFromYaml,
  applyVisualChangesToYaml,
}: UseConfigDocumentArgs) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceDirty, setSourceDirty] = useState(false);
  const [preview, setPreview] = useState<ConfigSavePreview | null>(null);

  const isDirty = sourceDirty || visualDirty;
  const loadRequestId = useRef(0);
  const draftRevision = useRef(0);
  const savedContent = useRef('');
  const savePhase = useRef<'reading' | 'writing' | null>(null);

  const acceptContent = useCallback(
    (value: string) => {
      draftRevision.current += 1;
      savedContent.current = value;
      setContent(value);
      setSourceDirty(false);
      setPreview(null);
      loadVisualValuesFromYaml(value);
    },
    [loadVisualValuesFromYaml]
  );

  const loadConfig = useCallback(async () => {
    if (savePhase.current) return;
    const requestId = ++loadRequestId.current;
    const revision = draftRevision.current;
    const assertConnection = guardConfigConnection();
    setLoading(true);
    setPreview(null);
    setLoadError(null);
    try {
      const { content: data } = await configFileApi.fetchConfigYaml();
      assertConnection();
      if (requestId !== loadRequestId.current || revision !== draftRevision.current) return;
      acceptContent(data);
    } catch (err: unknown) {
      if (requestId !== loadRequestId.current || isRequestCancelled(err)) return;
      setLoadError(getErrorMessage(err));
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [acceptContent]);

  useEffect(() => {
    void loadConfig();
    return () => {
      loadRequestId.current += 1;
      draftRevision.current += 1;
    };
  }, [loadConfig]);

  const showPreview = (next: ConfigSavePreview) => {
    savedContent.current = next.serverContent;
    if (next.original === next.modified) {
      acceptContent(next.serverContent);
      showNotification(t('config_management.diff.no_changes'), 'info');
    } else {
      setPreview(next);
    }
  };

  const runSave = async (operation: () => Promise<void>) => {
    if (savePhase.current) return;
    savePhase.current = 'reading';
    setSaving(true);
    try {
      await operation();
    } catch (err: unknown) {
      if (isRequestCancelled(err)) {
        setPreview(null);
      } else {
        showNotification(`${t('notification.save_failed')}: ${getErrorMessage(err)}`, 'error');
      }
    } finally {
      savePhase.current = null;
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (mode === 'visual' && visualParseError) {
      showNotification(t('config_management.visual_mode_save_blocked'), 'error');
      return;
    }

    const owner = { revision: draftRevision.current, assertConnection: guardConfigConnection() };
    const draft: ConfigSaveDraft = sourceDirty
      ? {
          origin: 'source',
          content,
          applyVisualChanges: mode === 'visual' ? applyVisualChangesToYaml : undefined,
        }
      : { origin: 'visual', applyVisualChanges: applyVisualChangesToYaml };

    return runSave(async () => {
      const snapshot = await configFileApi.fetchConfigYaml();
      owner.assertConnection();
      if (owner.revision !== draftRevision.current) return;
      showPreview(buildConfigSavePreview(owner, draft, snapshot.content));
    });
  };

  const handleConfirmSave = () => {
    if (!preview || preview.owner.revision !== draftRevision.current) return;
    return runSave(async () => {
      const { owner, draft, serverContent, modified } = preview;
      owner.assertConnection();
      const snapshot = await configFileApi.fetchConfigYaml();
      owner.assertConnection();
      if (owner.revision !== draftRevision.current) return;
      if (snapshot.content !== serverContent) {
        setPreview(null);
        showPreview(buildConfigSavePreview(owner, draft, snapshot.content));
        return;
      }

      savePhase.current = 'writing';
      await snapshot.replace(modified);
      owner.assertConnection();
      const configStore = useConfigStore.getState();
      configStore.invalidateCache();
      if (owner.revision === draftRevision.current) acceptContent(modified);
      const committedRevision = draftRevision.current;
      savePhase.current = 'reading';
      showNotification(t('config_management.save_success'), 'success');
      if (readCommercialModeFromYaml(serverContent) !== readCommercialModeFromYaml(modified)) {
        showNotification(t('notification.commercial_mode_restart_required'), 'warning');
      }

      await Promise.all([
        (async () => {
          try {
            const result = await configFileApi.fetchConfigYaml();
            owner.assertConnection();
            savedContent.current = result.content;
            if (committedRevision === draftRevision.current) acceptContent(result.content);
          } catch (err: unknown) {
            if (isRequestCancelled(err)) return;
            showNotification(
              t('config_management.save_verification_failed', { message: getErrorMessage(err) }),
              'warning'
            );
          }
        })(),
        configStore.fetchConfig(true).catch((err: unknown) => {
          if (!isRequestCancelled(err)) {
            showNotification(
              `${t('notification.refresh_failed')}: ${getErrorMessage(err)}`,
              'error'
            );
          }
        }),
      ]);
    });
  };

  // Generated source is only a view of the existing changes until the user edits it.
  const syncContentFromVisual = useCallback((value: string) => {
    setContent(value);
  }, []);

  const markDraftEdited = useCallback(() => {
    if (savePhase.current === 'writing') return false;
    draftRevision.current += 1;
    setPreview(null);
    return true;
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      if (!markDraftEdited()) return;
      setContent(value);
      setSourceDirty(true);
    },
    [markDraftEdited]
  );

  const handleReload = useCallback(() => {
    if (!isDirty) {
      void loadConfig();
      return;
    }

    showConfirmation({
      title: t('common.unsaved_changes_title'),
      message: t('config_management.reload_confirm_message'),
      confirmText: t('config_management.reload'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        await loadConfig();
      },
    });
  }, [isDirty, loadConfig, showConfirmation, t]);

  const handleDiscard = useCallback(() => {
    if (!isDirty) return;

    showConfirmation({
      title: t('common.unsaved_changes_title'),
      message: t('config_management.discard_confirm_message'),
      confirmText: t('config_management.actions.discard'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: () => acceptContent(savedContent.current),
    });
  }, [acceptContent, isDirty, showConfirmation, t]);

  const closeDiff = useCallback(() => setPreview(null), []);

  return {
    content,
    syncContentFromVisual,
    markDraftEdited,
    loading,
    saving,
    error: loadError === null ? '' : loadError || t('notification.refresh_failed'),
    sourceDirty,
    isDirty,
    preview,
    handleSave,
    handleConfirmSave,
    handleChange,
    handleReload,
    handleDiscard,
    closeDiff,
  };
}
