import { describe, expect, test } from 'bun:test';
import { redirectTargetFrom } from '../src/router/redirectTarget';

describe('login redirect target', () => {
  test('returns to an OAuth editor with its provider after a reload', () => {
    const state = {
      from: { pathname: '/auth-files/oauth-excluded', search: '?provider=claude', hash: '' },
    };
    const target = redirectTargetFrom(state);
    expect(target).toBe('/auth-files/oauth-excluded?provider=claude');
    expect(new URLSearchParams(target.split('?')[1]).get('provider')).toBe('claude');
  });

  test('keeps auth-file filters and a fragment', () => {
    expect(
      redirectTargetFrom({
        from: { pathname: '/auth-files', search: '?provider=codex&status=problem', hash: '#x' },
      })
    ).toBe('/auth-files?provider=codex&status=problem#x');
  });

  test('falls back for missing, malformed or self-referencing state', () => {
    expect(redirectTargetFrom(null)).toBe('/');
    expect(redirectTargetFrom({})).toBe('/');
    expect(redirectTargetFrom({ from: 'oauth' })).toBe('/');
    expect(redirectTargetFrom({ from: { pathname: 'https://evil.test/' } })).toBe('/');
    expect(redirectTargetFrom({ from: { pathname: '/login', search: '?a=1' } })).toBe('/');
    expect(redirectTargetFrom({ from: { pathname: '/logs', search: 'bad' } })).toBe('/logs');
  });
});
