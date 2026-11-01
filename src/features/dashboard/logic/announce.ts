import type { AttentionItem } from './attention';

/**
 * What screen-reader announcements compare between polls: each attention item's
 * identity and state. Ages, counts, and error text are left out, so ticking clocks
 * and repeated failures never announce.
 */
export type AttentionState = Map<string, string>;

const stateOf = (item: AttentionItem): string =>
  item.kind === 'provider' ? item.provider.status : item.freshness;

export function attentionState(items: AttentionItem[]): AttentionState {
  return new Map(items.map((item) => [item.key, stateOf(item)]));
}

/** True when two states would read the same to an operator (same headline and issues). */
export function sameAnnouncementState(a: AnnouncementSnapshot, b: AnnouncementSnapshot): boolean {
  if (a.verdictKey !== b.verdictKey || a.attention.size !== b.attention.size) return false;
  for (const [key, value] of a.attention) {
    if (b.attention.get(key) !== value) return false;
  }
  return true;
}

const SEVERITY: Record<string, number> = {
  down: 3,
  unknown: 2,
  failed: 2,
  degraded: 2,
  stale: 1,
  limited: 1,
};

const isEscalation = (before: string | undefined, after: string): boolean =>
  before === undefined || (SEVERITY[after] ?? 0) > (SEVERITY[before] ?? 0);

/** True when `next` adds an issue or makes one worse. Recoveries can still coexist. */
export function escalates(previous: AnnouncementSnapshot, next: AnnouncementSnapshot): boolean {
  return [...next.attention].some(([key, value]) =>
    isEscalation(previous.attention.get(key), value)
  );
}

/** Keep provisional recoveries and their headline out of an urgent announcement. */
export function escalationSnapshot(
  previous: AnnouncementSnapshot,
  next: AnnouncementSnapshot
): AnnouncementSnapshot {
  const attention = new Map(previous.attention);
  for (const [key, value] of next.attention) {
    if (isEscalation(previous.attention.get(key), value)) attention.set(key, value);
  }
  const pendingRecovery = [...attention].some(([key, value]) => next.attention.get(key) !== value);
  return { verdictKey: pendingRecovery ? previous.verdictKey : next.verdictKey, attention };
}

export interface AnnouncementSnapshot {
  verdictKey: string;
  attention: AttentionState;
}

export interface AnnouncementNext {
  verdictKey: string;
  verdictProviderId: string | null;
  items: AttentionItem[];
}

export interface AnnouncementText {
  /** The headline as a sentence, e.g. "Muse (Meta) is down." */
  verdict: string;
  newIssue: (item: AttentionItem) => string;
  changedIssue: (item: AttentionItem) => string;
  resolved: (key: string) => string;
}

/**
 * Messages for one poll: the headline when it changed, then each new, changed, or
 * resolved attention item. A provider the headline already names is not repeated, and
 * resolutions are left to the headline once nothing needs attention.
 */
export function attentionAnnouncements(
  previous: AnnouncementSnapshot,
  next: AnnouncementNext,
  text: AnnouncementText,
  snapshot: AnnouncementSnapshot = {
    verdictKey: next.verdictKey,
    attention: attentionState(next.items),
  }
): string[] {
  const messages: string[] = [];
  const verdictChanged = previous.verdictKey !== snapshot.verdictKey;
  if (verdictChanged) messages.push(text.verdict);

  for (const item of next.items) {
    if (snapshot.attention.get(item.key) !== stateOf(item)) continue;
    const before = previous.attention.get(item.key);
    if (before === stateOf(item)) continue;
    const namedByVerdict =
      verdictChanged && item.kind === 'provider' && item.provider.id === next.verdictProviderId;
    if (namedByVerdict) continue;
    messages.push(before === undefined ? text.newIssue(item) : text.changedIssue(item));
  }

  if (next.items.length > 0) {
    for (const key of previous.attention.keys()) {
      if (!snapshot.attention.has(key)) messages.push(text.resolved(key));
    }
  }
  return messages;
}

/** Joins messages raised together into one announcement, without repeats. */
export function composeAnnouncement(messages: string[]): string {
  return [...new Set(messages.map((message) => message.trim()).filter(Boolean))].join(' ');
}

/**
 * One announcement for a batch: action results first (what the operator did), then the
 * net change from the last announced state to the latest one. Intermediate states
 * between the two (one source updated before another) are never described.
 */
export function settleAnnouncement(
  change: {
    previous: AnnouncementSnapshot;
    next: AnnouncementNext;
    text: AnnouncementText;
    snapshot?: AnnouncementSnapshot;
  } | null,
  actionMessages: string[]
): string {
  const stateMessages = change
    ? attentionAnnouncements(change.previous, change.next, change.text, change.snapshot)
    : [];
  return composeAnnouncement([...actionMessages, ...stateMessages]);
}
