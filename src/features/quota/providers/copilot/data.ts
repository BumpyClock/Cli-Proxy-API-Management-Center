import type { CopilotQuotaData, CopilotQuotaState } from '@/types';
import { copilotApi, CopilotQuotaError } from '@/services/api/copilot';
import { isRuntimeOnlyAuthFile } from '@/features/authFiles/constants';
import { isCopilotFile, isDisabledAuthFile } from '@/utils/quota';
import type { QuotaProviderData } from '../types';

export const COPILOT_CONFIG: QuotaProviderData<CopilotQuotaState, CopilotQuotaData> = {
  type: 'github-copilot',
  i18nPrefix: 'copilot_quota',
  filterFn: (file) =>
    isCopilotFile(file) && !isDisabledAuthFile(file) && !isRuntimeOnlyAuthFile(file),
  fetchQuota: async (file, t) => {
    try {
      return await copilotApi.getQuota(file.authIndex ?? file.auth_index);
    } catch (error: unknown) {
      if (error instanceof CopilotQuotaError) {
        error.message = t(`copilot_quota.${error.code}`);
      }
      throw error;
    }
  },
  storeSelector: (state) => state.copilotQuota,
  storeSetter: 'setCopilotQuota',
  buildLoadingState: () => ({ status: 'loading' }),
  buildSuccessState: (data) => ({ status: 'success', data }),
  buildErrorState: (error, errorStatus) => ({ status: 'error', error, errorStatus }),
};
