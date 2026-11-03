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
  test('opaque iframe navigation retains source/retry identity without availability claims', () => {
    const page = source('src/features/plugins/PluginResourcePage.tsx');
    expect(page).toContain('key={`${iframeSrc}:${frameAttempt}`}');
    expect(page).toContain('setFrameAttempt((attempt) => attempt + 1)');
    expect(page).not.toMatch(/on(?:Load|Error)=|aria-busy=/);
    expect(page).toMatch(/href=\{openHref\}\s+target="_blank"\s+rel="noopener noreferrer"/);
    expect(page).toContain("t('plugin_resource.open_in_new_tab')");
    expect(page).toContain('role="status"');
  });

  test('log row exposes copy semantics and both keyboard activations', () => {
    const page = source('src/pages/LogsPage.tsx');
    expect(page).toMatch(/role="button"\s+aria-label=\{t\('logs\.copy_line_accessible'/);
    expect(page).toContain("event.key === 'Enter' || event.key === ' '");
    expect(page).toMatch(/event\.preventDefault\(\);\s*void copyLogLine\(line\.raw\)/);
  });
});
