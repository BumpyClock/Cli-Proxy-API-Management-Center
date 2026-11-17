import { getConfigValue } from './configValue';

export const apiKeysApi = {
  async list(): Promise<string[]> {
    const keys = await getConfigValue<unknown>('/config/access/api-keys', []);
    if (!Array.isArray(keys) || !keys.every((key) => typeof key === 'string')) {
      throw new Error('Invalid client access keys');
    }
    return keys.slice();
  },
};
