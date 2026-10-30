import { describe, expect, test } from 'bun:test';
import {
  attentionAnnouncements,
  attentionState,
  composeAnnouncement,
  escalates,
  settleAnnouncement,
  type AnnouncementText,
} from '../src/features/dashboard/logic/announce';
import type { AttentionItem } from '../src/features/dashboard/logic/attention';
import type { ProviderHealth } from '../src/features/dashboard/types';

const provider = (id: string, status: ProviderHealth['status']): AttentionItem => ({
  kind: 'provider',
  key: `provider:${id}`,
  severity: status === 'down' ? 'critical' : 'warning',
  provider: { id, status } as ProviderHealth,
});

const source = (freshness: 'failed' | 'stale', receivedAt: number | null): AttentionItem => ({
  kind: 'source',
  key: 'source:credentials',
  severity: 'warning',
  source: 'credentials',
  freshness,
  error: '503',
  receivedAt,
});

const text = (verdict: string): AnnouncementText => ({
  verdict,
  newIssue: (item) =>
    item.kind === 'provider' ? `new ${item.provider.id} ${item.provider.status}` : 'new source',
  changedIssue: (item) =>
    item.kind === 'provider' ? `now ${item.provider.id} ${item.provider.status}` : 'source again',
  resolved: (key) => `resolved ${key}`,
});

const snapshot = (verdictKey: string, items: AttentionItem[]) => ({
  verdictKey,
  attention: attentionState(items),
});

describe('dashboard live announcements', () => {
  test('a secondary incident is announced while the headline stays the same', () => {
    const before = snapshot('down|meta|1|false', [provider('meta', 'down')]);
    const messages = attentionAnnouncements(
      before,
      {
        verdictKey: 'down|meta|1|false',
        verdictProviderId: 'meta',
        items: [provider('meta', 'down'), provider('claude', 'degraded')],
      },
      text('Muse (Meta) is down.')
    );
    expect(messages).toEqual(['new claude degraded']);
  });

  test('a new headline names its provider once and lists the other new issues', () => {
    const messages = attentionAnnouncements(
      snapshot('good||0|false', []),
      {
        verdictKey: 'down|meta|1|false',
        verdictProviderId: 'meta',
        items: [provider('meta', 'down'), provider('claude', 'degraded')],
      },
      text('Muse (Meta) is down.')
    );
    expect(messages).toEqual(['Muse (Meta) is down.', 'new claude degraded']);
  });

  test('worsening and resolution are announced; full recovery is left to the headline', () => {
    const before = snapshot('down|meta|1|false', [
      provider('meta', 'down'),
      provider('claude', 'degraded'),
      provider('xai', 'limited'),
    ]);
    expect(
      attentionAnnouncements(
        before,
        {
          verdictKey: 'down|meta|1|false',
          verdictProviderId: 'meta',
          items: [provider('meta', 'down'), provider('claude', 'down')],
        },
        text('unused')
      )
    ).toEqual(['now claude down', 'resolved provider:xai']);
    expect(
      attentionAnnouncements(
        before,
        { verdictKey: 'good||0|false', verdictProviderId: null, items: [] },
        text('All systems steady.')
      )
    ).toEqual(['All systems steady.']);
  });

  test('ages, error text, and repeated failures stay silent', () => {
    const before = snapshot('unknown||0|true', [source('failed', 1_000)]);
    expect(
      attentionAnnouncements(
        before,
        {
          verdictKey: 'unknown||0|true',
          verdictProviderId: null,
          items: [source('failed', 5_000)],
        },
        text('unused')
      )
    ).toEqual([]);
  });

  test('a batch states the net change, never an intermediate headline', () => {
    // Incident, then (between polls) one issue left, then all clear: only the end state.
    const incident = snapshot('down|meta|1|false', [
      provider('meta', 'down'),
      provider('claude', 'degraded'),
    ]);
    expect(
      settleAnnouncement(
        {
          previous: incident,
          next: { verdictKey: 'good||0|false', verdictProviderId: null, items: [] },
          text: text('All systems steady.'),
        },
        ['Dashboard data refreshed.']
      )
    ).toBe('Dashboard data refreshed. All systems steady.');
  });

  test('a retry result leads and its recovered source is not repeated', () => {
    const before = snapshot('unknown||0|false', [source('failed', null)]);
    expect(
      settleAnnouncement(
        {
          previous: before,
          next: {
            verdictKey: 'down|meta|1|false',
            verdictProviderId: 'meta',
            items: [provider('meta', 'down'), provider('xai', 'limited')],
          },
          text: { ...text('Muse (Meta) is down.'), resolved: () => 'Loaded credentials.' },
        },
        ['Loaded credentials.']
      )
    ).toBe('Loaded credentials. Muse (Meta) is down. new xai limited');
  });

  test('new and worse issues escalate; recoveries do not', () => {
    const muse = snapshot('down|meta|1|false', [provider('meta', 'down')]);
    const museAndClaude = snapshot('down|meta|1|false', [
      provider('meta', 'down'),
      provider('claude', 'degraded'),
    ]);
    const claudeDown = snapshot('down|meta|2|false', [
      provider('meta', 'down'),
      provider('claude', 'down'),
    ]);
    expect(escalates(muse, museAndClaude)).toBe(true);
    expect(escalates(museAndClaude, claudeDown)).toBe(true);
    expect(escalates(claudeDown, museAndClaude)).toBe(false);
    expect(escalates(museAndClaude, snapshot('good||0|false', []))).toBe(false);
  });

  test('a retry result and the outage it reveals form one announcement', () => {
    expect(
      composeAnnouncement([
        'Loaded credentials.',
        'Muse (Meta) is down.',
        'Loaded credentials.',
        ' ',
      ])
    ).toBe('Loaded credentials. Muse (Meta) is down.');
  });
});
