import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { AttentionItem } from '../logic/attention';
import {
  attentionState,
  settleAnnouncement,
  type AnnouncementNext,
  type AnnouncementSnapshot,
  type AnnouncementText,
} from '../logic/announce';
import { providerLabel } from '../utils';

/** State changes and action results within this window are announced together. */
const ANNOUNCE_BATCH_MS = 500;

interface AnnouncerInput {
  /** False until the verdict rests on loaded data. The first settled state is the baseline. */
  settled: boolean;
  verdictKey: string;
  verdictProviderId: string | null;
  /** The headline as a sentence, e.g. "Muse (Meta) is down." */
  verdictSentence: string;
  attention: AttentionItem[];
}

interface ActionResult {
  ok: string;
  failed?: string;
}

function announcementText(t: TFunction, verdictSentence: string): AnnouncementText {
  const subject = (item: AttentionItem) =>
    item.kind === 'provider'
      ? providerLabel(item.provider.id, t('dashboard.provider_unknown'))
      : t(`dashboard.source_${item.source}`);
  const providerStatus = (item: AttentionItem) =>
    item.kind === 'provider'
      ? t(`dashboard.provider_status_${item.provider.status}`).toLocaleLowerCase()
      : '';
  const sourceSentence = (item: AttentionItem) =>
    item.kind === 'source'
      ? `${t(
          item.freshness === 'stale'
            ? 'dashboard.attention_source_stale'
            : item.receivedAt === null
              ? 'dashboard.attention_source_missing'
              : 'dashboard.attention_source_failed',
          { source: subject(item) }
        )}${t('dashboard.hero_period')}`
      : '';
  return {
    verdict: verdictSentence,
    newIssue: (item) =>
      item.kind === 'source'
        ? sourceSentence(item)
        : t('dashboard.announce_issue_new', {
            subject: subject(item),
            status: providerStatus(item),
          }),
    changedIssue: (item) =>
      item.kind === 'source'
        ? sourceSentence(item)
        : t('dashboard.announce_issue_changed', {
            subject: subject(item),
            status: providerStatus(item),
          }),
    // A recovered source reads like a successful Retry, so the two collapse into one.
    resolved: (key) => {
      const [kind, id] = key.split(':');
      return kind === 'provider'
        ? t('dashboard.announce_resolved', {
            subject: providerLabel(id, t('dashboard.provider_unknown')),
          })
        : t('dashboard.announce_source_loaded', { source: t(`dashboard.source_${id}`) });
    },
  };
}

/**
 * The dashboard's screen-reader announcements, for one polite live region.
 *
 * Each announcement states the net change from the last announced state to the latest
 * one: a new headline, then new, changed, or resolved issues. Intermediate states between
 * polls and ticking ages are never announced. Refresh and Retry run through `track`: state
 * changes wait until the action ends, then its result and the net change are announced
 * together, so the operator hears one consistent update.
 */
export function useDashboardAnnouncer({
  settled,
  verdictKey,
  verdictProviderId,
  verdictSentence,
  attention,
}: AnnouncerInput) {
  const { t } = useTranslation();
  const [live, setLive] = useState({ text: '', nonce: 0 });
  const announcedRef = useRef<AnnouncementSnapshot | null>(null);
  const latestRef = useRef<{
    snapshot: AnnouncementSnapshot;
    next: AnnouncementNext;
    text: AnnouncementText;
  } | null>(null);
  const actionMessagesRef = useRef<string[]>([]);
  const actionsRunningRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    timerRef.current = null;
    if (actionsRunningRef.current > 0) return; // the action's end flushes
    const latest = latestRef.current;
    const previous = announcedRef.current;
    if (latest) announcedRef.current = latest.snapshot;
    const message = settleAnnouncement(
      latest && previous ? { previous, next: latest.next, text: latest.text } : null,
      actionMessagesRef.current
    );
    actionMessagesRef.current = [];
    if (message) setLive((current) => ({ text: message, nonce: current.nonce + 1 }));
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current === null) timerRef.current = window.setTimeout(flush, ANNOUNCE_BATCH_MS);
  }, [flush]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  useEffect(() => {
    if (!settled) return;
    const snapshot = { verdictKey, attention: attentionState(attention) };
    latestRef.current = {
      snapshot,
      next: { verdictKey, verdictProviderId, items: attention },
      text: announcementText(t, verdictSentence),
    };
    if (!announcedRef.current) {
      announcedRef.current = snapshot; // the page itself carries the initial state
      return;
    }
    schedule();
  }, [attention, schedule, settled, t, verdictKey, verdictProviderId, verdictSentence]);

  /** Runs a Refresh or Retry and announces its result with the change it caused. */
  const track = useCallback(
    async <T>(action: () => Promise<T>, result: ActionResult): Promise<T> => {
      actionsRunningRef.current += 1;
      try {
        const value = await action();
        actionMessagesRef.current.push(result.ok);
        return value;
      } catch (error: unknown) {
        if (result.failed) actionMessagesRef.current.push(result.failed);
        throw error;
      } finally {
        actionsRunningRef.current -= 1;
        schedule();
      }
    },
    [schedule]
  );

  // The nonce toggles a zero-width character so a repeated message is announced again.
  const liveText = `${live.text}${live.nonce % 2 ? '\u200b' : ''}`;
  return { liveText, track };
}
