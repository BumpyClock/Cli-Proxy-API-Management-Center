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

export interface AnnouncementSnapshot {
  verdictKey: string;
  attention: AttentionState;
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
  next: { verdictKey: string; verdictProviderId: string | null; items: AttentionItem[] },
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
