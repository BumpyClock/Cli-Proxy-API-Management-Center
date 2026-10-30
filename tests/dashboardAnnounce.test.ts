import { describe, expect, test } from 'bun:test';
import {
  attentionAnnouncements,
  attentionState,
  composeAnnouncement,
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
