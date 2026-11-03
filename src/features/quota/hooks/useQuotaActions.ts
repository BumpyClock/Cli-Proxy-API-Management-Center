import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { getQuotaMap, type QuotaAdapter } from '../providers';
import { requestQuota } from './quotaRequests';

export function useQuotaActions(disableControls: boolean) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [resettingQuotaName, setResettingQuotaName] = useState<string | null>(null);

  const refreshQuota = useCallback(
    async (file: AuthFileItem, adapter: QuotaAdapter) => {
      if (disableControls || file.disabled || resettingQuotaName === getQuotaCacheKey(file)) return;
      const result = await requestQuota(file, adapter, t);
      if (result.status === 'success') {
        showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
      } else if (result.status === 'error') {
        showNotification(
          t('auth_files.quota_refresh_failed', { name: file.name, message: result.message }),
          'error'
        );
      }
    },
    [disableControls, resettingQuotaName, showNotification, t]
  );

  const testHealth = useCallback(
    async (file: AuthFileItem, adapter: QuotaAdapter) => {
      if (disableControls || file.disabled || !adapter.healthTest) return;
      await requestQuota(file, adapter, t, 'health-test');
    },
    [disableControls, t]
  );

  const resetQuota = useCallback(
    (file: AuthFileItem, adapter: QuotaAdapter) => {
      if (!adapter.resetQuota || disableControls || file.disabled) return;
      const cacheKey = getQuotaCacheKey(file);
      const quota = getQuotaMap(adapter)[cacheKey];
      if (quota?.status === 'loading' || quota?.refreshing || resettingQuotaName === cacheKey)
        return;

      showConfirmation({
        title: t('codex_quota.reset_confirm_title'),
        message: t('codex_quota.reset_confirm_message', { name: file.name }),
        confirmText: t('codex_quota.reset_confirm_button'),
        variant: 'primary',
        onConfirm: async () => {
          setResettingQuotaName(cacheKey);
          try {
            const result = await requestQuota(file, adapter, t, 'reset');
            if (result.status === 'success') {
              showNotification(t('codex_quota.reset_success', { name: file.name }), 'success');
            } else if (result.status === 'error') {
              showNotification(
                t('codex_quota.reset_failed', { name: file.name, message: result.message }),
                'error'
              );
            }
          } finally {
            setResettingQuotaName((current) => (current === cacheKey ? null : current));
          }
        },
      });
    },
    [disableControls, resettingQuotaName, showConfirmation, showNotification, t]
  );

  return { resettingQuotaName, refreshQuota, resetQuota, testHealth };
}
