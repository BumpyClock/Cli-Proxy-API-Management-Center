/** Client access keys are separate from upstream provider groups in v8. */
import { getConfigValue, readConfigResource } from './configValue';

const PATH = '/config/access/api-keys';
const normalizeKeys = (value: unknown): string[] => {
  if (!Array.isArray(value) || !value.every((key) => typeof key === 'string')) {
    throw new Error('Invalid client access keys');
  }
  return value.slice();
};
const assertIndex = (keys: string[], index: number) => {
  if (!Number.isInteger(index) || index < 0 || index >= keys.length) {
    throw new RangeError('API key index out of range');
  }
};

export const apiKeysApi = {
  async list(): Promise<string[]> {
    const data = await getConfigValue<unknown>(PATH, []);
    return normalizeKeys(data);
  },

  async replace(keys: string[]) {
    const resource = await readConfigResource(PATH, []);
    return resource.replace(keys);
  },

  async update(index: number, value: string) {
    const resource = await readConfigResource(PATH, []);
    const keys = normalizeKeys(resource.value);
    assertIndex(keys, index);
    keys[index] = value;
    return resource.replace(keys);
  },

  async delete(index: number) {
    const resource = await readConfigResource(PATH, []);
    const keys = normalizeKeys(resource.value);
    assertIndex(keys, index);
    keys.splice(index, 1);
    return resource.replace(keys);
  },
};
