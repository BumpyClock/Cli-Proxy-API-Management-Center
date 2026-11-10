import { apiClient } from './client';
import { configWriteHeaders, guardConfigConnection } from './configValue';

export interface ConfigYamlSnapshot {
  content: string;
  replace(content: string): Promise<void>;
}

export const configFileApi = {
  async fetchConfigYaml(): Promise<ConfigYamlSnapshot> {
    const assertConnection = guardConfigConnection();
    const response = await apiClient.getRaw('/config.yaml', {
      responseType: 'text',
      headers: { Accept: 'application/yaml, text/yaml, text/plain' },
    });
    assertConnection();
    const content: unknown = response.data;
    if (typeof content !== 'string') throw new Error('Invalid YAML configuration response');
    const etag: unknown = response.headers.etag;
    return {
      content,
      async replace(next: string): Promise<void> {
        assertConnection();
        await apiClient.put('/config.yaml', next, {
          headers: {
            ...configWriteHeaders(etag),
            'Content-Type': 'application/yaml',
            Accept: 'application/json, text/plain, */*',
          },
        });
      },
    };
  },
};
