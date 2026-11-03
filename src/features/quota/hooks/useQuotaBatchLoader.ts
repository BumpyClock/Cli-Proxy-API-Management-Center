import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuotaFileEntry } from '../logic';
import { requestQuotaBatch } from './quotaRequests';

/** A batch collects shared observations; it never owns cache writes. */
export function useQuotaBatchLoader() {
  const { t } = useTranslation();
  const [pendingBatches, setPendingBatches] = useState(0);

  const loadQuota = useCallback(
    async (targets: QuotaFileEntry[]) => {
      if (targets.length === 0) return;
      setPendingBatches((count) => count + 1);
      try {
        const results = await requestQuotaBatch(targets, t);
        return {
          success: results.filter((result) => result.status === 'success').length,
          failed: results.filter((result) => result.status === 'error').length,
          skipped: results.filter((result) => result.status === 'skipped').length,
          checkedAt: Date.now(),
        };
      } finally {
        setPendingBatches((count) => count - 1);
      }
    },
    [t]
  );

  return { batchLoading: pendingBatches > 0, loadQuota };
}
