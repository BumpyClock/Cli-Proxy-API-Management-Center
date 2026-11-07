import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import { getStatusRateTone, statusRateColor } from '@/components/providers/utils';
import { readFileSync } from 'node:fs';
import statusBarStyles from '@/features/providers/components/providerStatusBar.module.scss';
import { statusBarDataFromRecentRequests } from '@/utils/recentRequests';
import { FAILING_SUCCESS_RATE } from '@/features/providers/workbenchLayout';
import { createTestI18n } from './helpers/locales';

const i18n = await createTestI18n();
const rate = (successRate: number, total = 10) => ({
  successRate,
  totalSuccess: total,
  totalFailure: 0,
});

describe('status bar success-rate badge', () => {
  test('bands: >= 90 high, >= 50 medium, below that low; no requests, no badge', () => {
    expect(getStatusRateTone({ successRate: 0, totalSuccess: 0, totalFailure: 0 })).toBeNull();
    expect(getStatusRateTone(rate(100))).toBe('high');
    expect(getStatusRateTone(rate(90))).toBe('high');
    expect(getStatusRateTone(rate(89.9))).toBe('medium');
    expect(getStatusRateTone(rate(50))).toBe('medium');
    expect(getStatusRateTone(rate(49.9))).toBe('low');
    // The row health word turns "failing" exactly where the badge turns low.
    expect(getStatusRateTone(rate(FAILING_SUCCESS_RATE))).toBe('medium');
  });

  const renderBar = (buckets: Array<{ success: number; failed: number }>) =>
    renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(ProviderStatusBar, {
          statusData: statusBarDataFromRecentRequests(buckets),
          styles: statusBarStyles,
        })
      )
    );

  test('the badge carries its tone', () => {
    const markup = renderBar([{ success: 7, failed: 3 }]);
    expect(markup).toContain('data-rate-tone="medium"');
    expect(markup).toContain('>70%<');
  });

  test('without requests there is no badge', () => {
    const markup = renderBar([{ success: 0, failed: 0 }]);
    expect(markup).not.toContain('data-rate-tone');
  });

  test('block fills blend theme tokens, so dark mode never inherits light-theme RGB', () => {
    expect(statusRateColor(0)).toBe(
      'color-mix(in srgb, var(--warning-color) 0%, var(--viz-failure))'
    );
    expect(statusRateColor(0.25)).toBe(
      'color-mix(in srgb, var(--warning-color) 50%, var(--viz-failure))'
    );
    expect(statusRateColor(0.5)).toBe(
      'color-mix(in srgb, var(--viz-success) 0%, var(--warning-color))'
    );
    expect(statusRateColor(1)).toBe(
      'color-mix(in srgb, var(--viz-success) 100%, var(--warning-color))'
    );
    expect(statusRateColor(7)).toBe(statusRateColor(1));
    const markup = renderBar([{ success: 7, failed: 3 }]);
    expect(markup).toContain('background-color:color-mix(in srgb, var(--viz-success) 40%');
    for (const path of [
      'src/components/providers/ProviderStatusBar.tsx',
      'src/components/providers/utils.ts',
    ]) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/rgba?\(|#[0-9a-f]{3,8}\b/i);
    }
  });
});
