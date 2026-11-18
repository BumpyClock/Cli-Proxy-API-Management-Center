import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { apiClient, usageApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import { downloadBlob } from '@/utils/download';

export function UsageBackupActions({ onRestored }: { onRestored: () => Promise<void> }) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = async (
    action: 'export' | 'import',
    revision: number,
    work: (isCurrent: () => boolean) => Promise<void>
  ) => {
    const isCurrent = () => mounted.current && apiClient.getConnectionRevision() === revision;
    if (busy || !isCurrent()) return;
    setBusy(action);
    try {
      await work(isCurrent);
    } catch {
      if (isCurrent()) showNotification(t(`usage_stats.${action}_failed`), 'error');
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const exportBackup = () =>
    run('export', apiClient.getConnectionRevision(), async (isCurrent) => {
      const backup = await usageApi.exportUsage();
      if (!isCurrent()) return;
      downloadBlob({
        filename: `usage-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        blob: backup,
      });
    });

  const selectBackup = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const revision = apiClient.getConnectionRevision();
    showConfirmation({
      title: t('usage_stats.import_backup'),
      message: t('usage_stats.import_confirm'),
      confirmText: t('usage_stats.import_backup'),
      variant: 'danger',
      onConfirm: () =>
        run('import', revision, async (isCurrent) => {
          const result = await usageApi.importUsage(file);
          if (!isCurrent()) return;
          showNotification(t('usage_stats.import_done', result), 'success');
          void onRestored().catch(() => undefined);
        }),
    });
  };

  return (
    <>
      <Button
        variant="secondary"
        loading={busy === 'export'}
        disabled={busy !== null}
        onClick={() => void exportBackup()}
      >
        {t('usage_stats.export_backup')}
      </Button>
      <Button
        variant="secondary"
        loading={busy === 'import'}
        disabled={busy !== null}
        onClick={() => input.current?.click()}
      >
        {t('usage_stats.import_backup')}
      </Button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={selectBackup}
      />
    </>
  );
}
