import { describe, expect, test } from 'bun:test';
import { buildAuthFilesHref, parseAuthFilesDeepLink } from '../src/features/authFiles/deepLink';

describe('auth files deep links', () => {
  test('builds a filtered link and round-trips it', () => {
    const href = buildAuthFilesHref({
      provider: 'Meta',
      status: 'problem',
      search: 'meta-ops@example.com.json',
    });
    expect(href).toBe(
      '/auth-files?provider=meta&status=problem&search=meta-ops%40example.com.json'
    );
    const params = new URLSearchParams(href.split('?')[1]);
    expect(parseAuthFilesDeepLink(params)).toEqual({
      provider: 'meta',
      status: 'problem',
      search: 'meta-ops@example.com.json',
    });
  });

  test('keeps an explicit "all" status so the link resets stale filters', () => {
    expect(buildAuthFilesHref({ status: 'all' })).toBe('/auth-files?status=all');
    expect(buildAuthFilesHref()).toBe('/auth-files');
  });

  test('ignores unknown status values and empty parameters', () => {
    expect(parseAuthFilesDeepLink(new URLSearchParams('status=broken&search=%20%20'))).toBeNull();
    expect(parseAuthFilesDeepLink(new URLSearchParams(''))).toBeNull();
  });

  test('caps the search length', () => {
    const link = parseAuthFilesDeepLink(new URLSearchParams(`search=${'x'.repeat(500)}`));
    expect(link?.search?.length).toBe(200);
  });
});
