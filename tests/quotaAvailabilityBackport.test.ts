import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { AntigravityQuotaBody } from '@/features/quota/providers/antigravity/AntigravityQuotaBody';
import { buildClaudeQuotaWindows, CLAUDE_CONFIG } from '@/features/quota/providers/claude/data';
import { normalizeClaudeUsageSnapshot } from '@/services/api/claudeUsage';
import { bindQuotaClasses, QUOTA_CLASS_KEYS } from '@/features/quota/types';
import type { TFunction } from 'i18next';
import type { ClaudeUsagePayload } from '@/types';

const t = ((key: string) => key) as TFunction;
const reset = '2026-11-12T10:00:00Z';
const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'fixture'
);
const antigravity = (weekly: number) =>
  renderToStaticMarkup(
    createElement(AntigravityQuotaBody, {
      classes,
      quota: {
        status: 'success',
        groups: [
          {
            id: 'gemini',
            label: 'Gemini Models',
            buckets: [
              {
                id: 'weekly',
                label: 'Weekly Limit Remaining',
                window: 'weekly',
                remainingFraction: weekly,
              },
              { id: '5h', label: 'Five Hour Limit Remaining', window: '5h', remainingFraction: 1 },
            ],
          },
        ],
      },
    })
  );

describe('Antigravity quota availability', () => {
  test('does not promise availability when weekly quota is exhausted', () => {
    expect(antigravity(0)).not.toContain(i18n.t('antigravity_quota.quota_available'));
    expect(antigravity(0.5)).toContain(i18n.t('antigravity_quota.quota_available'));
  });

  test('translates current upstream Remaining labels', () => {
    const markup = antigravity(0.5);
    expect(markup).toContain(i18n.t('antigravity_quota.weekly_limit'));
    expect(markup).toContain(i18n.t('antigravity_quota.five_hour_limit'));
    expect(markup).not.toContain('Limit Remaining');
  });
});

describe('Claude legacy cloud credits', () => {
  test.each(['limit_dollars', 'used_dollars', 'remaining_dollars'] as const)(
    '%s identifies partial cloud credit pools without inventing a weekly period',
    (field) => {
      const payload: ClaudeUsagePayload = {
        iguana_necktie: { utilization: 5, resets_at: reset, [field]: 10 },
        limits: [
          {
            kind: 'weekly_scoped',
            percent: 64,
            resets_at: reset,
            scope: { model: { display_name: 'Fable' } },
          },
        ],
      };
      const windows = buildClaudeQuotaWindows(payload, t);
      expect(windows.map((window) => [window.id, window.usedPercent])).toEqual([
        ['cloud-session-credits', 5],
        ['seven-day-fable', 64],
      ]);
      expect(windows[0]).toMatchObject({
        labelKey: 'claude_quota.cloud_session_credits',
        periodHours: null,
      });
      const observations = CLAUDE_CONFIG.getObservations!({ status: 'success', windows });
      expect(
        observations.windows.find((window) => window.id === 'cloud-session-credits')?.periodHours
      ).toBeNull();
    }
  );

  test('keeps complete dollar balances separate without duplicate meters', () => {
    const payload: ClaudeUsagePayload = {
      iguana_necktie: {
        utilization: 5,
        resets_at: reset,
        limit_dollars: 100,
        used_dollars: 5,
        remaining_dollars: 95,
      },
    };
    const snapshot = normalizeClaudeUsageSnapshot(payload)!;
    expect(snapshot.dollarWindows).toHaveLength(1);
    expect(buildClaudeQuotaWindows(payload, t, snapshot.dollarWindows)).toEqual([]);
  });
});
