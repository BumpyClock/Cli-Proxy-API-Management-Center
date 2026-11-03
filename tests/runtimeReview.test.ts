import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { findActiveRoute } from '../src/components/layout/routeLabel';
import { usageSessionRequestState } from '../src/pages/usage-page-request-guard';

const source = (path: string) => readFileSync(path, 'utf8');

describe('route labels', () => {
  const items = [
    { path: '/', label: 'Dashboard' },
    { path: '/auth-files', label: 'Auth files' },
    { path: '/logs', label: 'Logs' },
  ];

  test('dashboard alias resolves to the dashboard without changing nested matching', () => {
    expect(findActiveRoute(items, '/dashboard')?.label).toBe('Dashboard');
    expect(findActiveRoute(items, '/')?.label).toBe('Dashboard');
    expect(findActiveRoute(items, '/auth-files/oauth')?.label).toBe('Auth files');
    expect(findActiveRoute(items, '/logs-extra')).toBeUndefined();
  });
});

describe('usage request eligibility', () => {
  test('connecting waits while error, disconnected and unauthenticated states stop', () => {
    expect(
      usageSessionRequestState({ isAuthenticated: true, connectionStatus: 'connecting' })
    ).toBe('connecting');
    for (const connectionStatus of ['error', 'disconnected']) {
      expect(usageSessionRequestState({ isAuthenticated: true, connectionStatus })).toBe('stopped');
    }
    expect(
      usageSessionRequestState({ isAuthenticated: false, connectionStatus: 'connected' })
    ).toBe('stopped');
    expect(usageSessionRequestState({ isAuthenticated: true, connectionStatus: 'connected' })).toBe(
      'ready'
    );
  });
});

describe('runtime interaction wiring', () => {
  test('iframe state belongs to the source and refresh attempt', () => {
    const page = source('src/features/plugins/PluginResourcePage.tsx');
    expect(page).toContain('<PluginFrame key={`${iframeSrc}:${frameAttempt}`} src={iframeSrc}');
    expect(page).toContain('setFrameAttempt((attempt) => attempt + 1)');
    expect(page).toMatch(
      /function PluginFrame[\s\S]*useState<'loading' \| 'loaded' \| 'failed'>\('loading'\)/
    );
    expect(page).toMatch(/onError=\{\(\) => setStatus\('failed'\)\}/);
  });

  test('log row exposes copy semantics and both keyboard activations', () => {
    const page = source('src/pages/LogsPage.tsx');
    expect(page).toContain(
      'role="button"\n                          aria-label={t(\'logs.copy_line_accessible\''
    );
    expect(page).toContain("event.key === 'Enter' || event.key === ' '");
    expect(page).toMatch(/event\.preventDefault\(\);\s*void copyLogLine\(line\.raw\)/);
  });
});
