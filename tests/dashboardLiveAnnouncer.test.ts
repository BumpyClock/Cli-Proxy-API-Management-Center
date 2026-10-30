import { describe, expect, test } from 'bun:test';
import { attentionState, type AnnouncementText } from '../src/features/dashboard/logic/announce';
import type { AttentionItem } from '../src/features/dashboard/logic/attention';
import { LiveAnnouncer, type AnnouncerUpdate } from '../src/features/dashboard/logic/liveAnnouncer';
import type { ProviderHealth } from '../src/features/dashboard/types';

/** Manual clock: timers fire only when the test advances time. */
function fakeTimers() {
  let current = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  return {
    set: (callback: () => void, ms: number) => {
      const id = nextId++;
      pending.set(id, { at: current + ms, callback });
      return id;
    },
    clear: (id: unknown) => {
      pending.delete(id as number);
    },
    now: () => current,
    advance(ms: number) {
      const target = current + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        current = due[1].at;
        due[1].callback();
      }
      current = target;
    },
  };
}

const provider = (id: string, status: ProviderHealth['status']): AttentionItem => ({
  kind: 'provider',
  key: `provider:${id}`,
  severity: status === 'down' ? 'critical' : 'warning',
  provider: { id, status } as ProviderHealth,
});

const HEADLINES: Record<string, string> = {
  incident: 'Muse (Meta) is down.',
  partial: '1 issue needs attention.',
  steady: 'All systems steady.',
};

const text = (verdictKey: string): AnnouncementText => ({
  verdict: HEADLINES[verdictKey],
  newIssue: (item) => (item.kind === 'provider' ? `New issue: ${item.provider.id}.` : ''),
  changedIssue: (item) => (item.kind === 'provider' ? `${item.provider.id} changed.` : ''),
  resolved: (key) => `Resolved: ${key}.`,
});

const state = (
  verdictKey: 'incident' | 'partial' | 'steady',
  primary: AnnouncerUpdate['primary']
): AnnouncerUpdate => {
  const items =
    verdictKey === 'incident'
      ? [provider('meta', 'down'), provider('claude', 'degraded')]
      : verdictKey === 'partial'
        ? [provider('claude', 'degraded')]
        : [];
  return {
    snapshot: { verdictKey, attention: attentionState(items) },
    next: { verdictKey, verdictProviderId: verdictKey === 'incident' ? 'meta' : null, items },
    text: text(verdictKey),
    primary,
  };
};

function setup() {
  const timers = fakeTimers();
  const spoken: string[] = [];
  const announcer = new LiveAnnouncer((message) => spoken.push(message), timers, {
    batchMs: 500,
    maxHoldMs: 15_000,
  });
  return { timers, spoken, announcer };
}

describe('LiveAnnouncer', () => {
  test('the first settled state is silent', () => {
    const { timers, spoken, announcer } = setup();
    announcer.update(state('incident', { credentialsAt: 1, trafficAt: 1, busy: false }));
    timers.advance(20_000);
    expect(spoken).toEqual([]);
  });

  test('staggered sources announce only the final state, even 5 s apart', () => {
    const { timers, spoken, announcer } = setup();
    announcer.update(state('incident', { credentialsAt: 1, trafficAt: 1, busy: false }));
    // Credentials land first: one issue left, traffic still in flight for 5 s.
    announcer.update(state('partial', { credentialsAt: 2, trafficAt: 1, busy: true }));
    timers.advance(5_000);
    expect(spoken).toEqual([]);
    announcer.update(state('steady', { credentialsAt: 2, trafficAt: 3, busy: false }));
    timers.advance(1_000);
    expect(spoken).toEqual(['All systems steady.']);
  });

  test('a source that reported earlier is awaited even when nothing is in flight', () => {
    const { timers, spoken, announcer } = setup();
    announcer.update(state('incident', { credentialsAt: 1, trafficAt: 1, busy: false }));
    announcer.update(state('partial', { credentialsAt: 2, trafficAt: 1, busy: false }));
    timers.advance(3_000);
    expect(spoken).toEqual([]);
    announcer.update(state('steady', { credentialsAt: 2, trafficAt: 4, busy: false }));
    timers.advance(600);
    expect(spoken).toEqual(['All systems steady.']);
  });

  test('a stalled source delays the announcement by at most one interval', () => {
    const { timers, spoken, announcer } = setup();
    announcer.update(state('incident', { credentialsAt: 1, trafficAt: 1, busy: false }));
    announcer.update(state('partial', { credentialsAt: 2, trafficAt: 1, busy: true }));
    timers.advance(14_000);
    expect(spoken).toEqual([]);
    timers.advance(2_000);
    expect(spoken).toEqual(['1 issue needs attention. Resolved: provider:meta.']);
  });

  test('a secondary incident under the same headline is announced', () => {
    const { timers, spoken, announcer } = setup();
    const muse = (primary: AnnouncerUpdate['primary'], items: AttentionItem[]) => ({
      snapshot: { verdictKey: 'incident', attention: attentionState(items) },
      next: { verdictKey: 'incident', verdictProviderId: 'meta', items },
      text: text('incident'),
      primary,
    });
    announcer.update(
      muse({ credentialsAt: 1, trafficAt: 1, busy: false }, [provider('meta', 'down')])
    );
    announcer.update(
      muse({ credentialsAt: 2, trafficAt: 2, busy: false }, [
        provider('meta', 'down'),
        provider('claude', 'degraded'),
      ])
    );
    timers.advance(600);
    expect(spoken).toEqual(['New issue: claude.']);
  });

  test('a Refresh holds state changes and its result leads the announcement', () => {
    const { timers, spoken, announcer } = setup();
    announcer.update(state('incident', { credentialsAt: 1, trafficAt: 1, busy: false }));
    announcer.actionStarted();
    announcer.update(state('partial', { credentialsAt: 2, trafficAt: 1, busy: true }));
    announcer.update(state('steady', { credentialsAt: 2, trafficAt: 2, busy: false }));
    timers.advance(2_000);
    expect(spoken).toEqual([]);
    announcer.actionFinished('Dashboard data refreshed.');
    timers.advance(600);
    expect(spoken).toEqual(['Dashboard data refreshed. All systems steady.']);
  });

  test('a failed Retry is announced even when nothing else changed', () => {
    const { timers, spoken, announcer } = setup();
    announcer.update(state('incident', { credentialsAt: 1, trafficAt: 1, busy: false }));
    announcer.actionStarted();
    announcer.actionFinished("Still couldn't load credentials.");
    timers.advance(600);
    expect(spoken).toEqual(["Still couldn't load credentials."]);
  });
});
