import { AxiosHeaders, type AxiosResponse } from 'axios';

export const configResponse = (data: unknown): AxiosResponse<unknown> => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: new AxiosHeaders({ etag: '"fixture"' }),
  config: { headers: new AxiosHeaders() },
});
