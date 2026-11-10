import { afterEach, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { apiClient } from '@/services/api/client';
import { loadDashboardUsage } from '@/features/dashboard/hooks/useDashboardOverview';
import { UsagePanel } from '@/features/dashboard/components/UsagePanel';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n('en');
const mocks: Array<{ mockRestore(): void }> = [];
afterEach(() => mocks.splice(0).forEach((mock) => mock.mockRestore()));

for (const enabled of [false, true]) {
  test(`an absent snapshot wins over the ${enabled} collection setting on the dashboard`, async () => {
    const get = spyOn(apiClient, 'get').mockImplementation(async (path) => {
      if (path === '/usage') throw Object.assign(new Error('not found'), { status: 404 });
      return enabled;
    });
    mocks.push(get);
    const usage = await loadDashboardUsage();
    expect(usage.supported).toBe(false);
    expect(usage.usage).toBeNull();
    const html = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(
          MemoryRouter,
          null,
          createElement(UsagePanel, {
            usage,
            summary: null,
            windowLabel: 'Now',
            historicalWindow: false,
            credentialsByIndex: new Map(),
          })
        )
      )
    );
    expect(html).toContain(i18n.t('dashboard.usage_unsupported'));
    expect(html).not.toContain('field=usageStatisticsEnabled');
    expect(get.mock.calls.map(([path]) => path)).not.toContain('/observability/usage/queue');
  });
}

for (const enabled of [false, true]) {
  test(`a supported snapshot preserves the ${enabled} collection state`, async () => {
    const snapshot = { total_requests: 3 };
    const get = spyOn(apiClient, 'get').mockImplementation(async (path) =>
      path === '/usage' ? { usage: snapshot } : enabled
    );
    mocks.push(get);
    const usage = await loadDashboardUsage();
    expect(usage.enabled).toBe(enabled);
    expect(usage.supported).toBe(true);
    expect(usage.usage).toEqual(enabled ? snapshot : null);
  });
}
