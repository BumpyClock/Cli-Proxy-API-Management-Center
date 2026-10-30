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
  text: AnnouncementText
): string[] {
  const messages: string[] = [];
  const verdictChanged = previous.verdictKey !== next.verdictKey;
  if (verdictChanged) messages.push(text.verdict);

  for (const item of next.items) {
    const before = previous.attention.get(item.key);
    if (before === stateOf(item)) continue;
    const namedByVerdict =
      verdictChanged && item.kind === 'provider' && item.provider.id === next.verdictProviderId;
    if (namedByVerdict) continue;
    messages.push(before === undefined ? text.newIssue(item) : text.changedIssue(item));
  }

  if (next.items.length > 0) {
    const current = new Set(next.items.map((item) => item.key));
    for (const key of previous.attention.keys()) {
      if (!current.has(key)) messages.push(text.resolved(key));
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
  change: { previous: AnnouncementSnapshot; next: AnnouncementNext; text: AnnouncementText } | null,
  actionMessages: string[]
): string {
  const stateMessages = change
    ? attentionAnnouncements(change.previous, change.next, change.text)
    : [];
  return composeAnnouncement([...actionMessages, ...stateMessages]);
}
