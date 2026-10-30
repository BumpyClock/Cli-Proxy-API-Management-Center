import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { AttentionItem } from '../logic/attention';
import { attentionState, type AnnouncementText } from '../logic/announce';
import { LiveAnnouncer } from '../logic/liveAnnouncer';
import { providerLabel } from '../utils';

interface AnnouncerInput {
  /** False until the verdict rests on loaded data. The first settled state is the baseline. */
  settled: boolean;
  verdictKey: string;
  verdictProviderId: string | null;
  /** The headline as a sentence, e.g. "Muse (Meta) is down." */
  verdictSentence: string;
  attention: AttentionItem[];
  /** When credentials and traffic last reported, and whether either request is in flight. */
  primary: { credentialsAt: number | null; trafficAt: number | null; busy: boolean };
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
 * The dashboard's screen-reader announcements, for one polite live region. Timing and
 * wording rules live in `LiveAnnouncer`: net changes only, both primary sources caught
 * up, and Refresh or Retry results leading their announcement.
 */
export function useDashboardAnnouncer({
  settled,
  verdictKey,
  verdictProviderId,
  verdictSentence,
  attention,
  primary,
}: AnnouncerInput) {
  const { t } = useTranslation();
  const [live, setLive] = useState({ text: '', nonce: 0 });
  const [announcer] = useState(
    () =>
      new LiveAnnouncer(
        (message) => setLive((current) => ({ text: message, nonce: current.nonce + 1 })),
        {
          set: (callback, ms) => window.setTimeout(callback, ms),
          clear: (id) => window.clearTimeout(id as number),
          now: () => Date.now(),
        }
      )
  );
  useEffect(() => () => announcer.dispose(), [announcer]);

  const { credentialsAt, trafficAt, busy } = primary;
  useEffect(() => {
    if (!settled) return;
    announcer.update({
      snapshot: { verdictKey, attention: attentionState(attention) },
      next: { verdictKey, verdictProviderId, items: attention },
      text: announcementText(t, verdictSentence),
      primary: { credentialsAt, trafficAt, busy },
    });
  }, [
    announcer,
    attention,
    busy,
    credentialsAt,
    settled,
    t,
    trafficAt,
    verdictKey,
    verdictProviderId,
    verdictSentence,
  ]);

  /** Runs a Refresh or Retry and announces its result with the change it caused. */
  const track = useCallback(
    async <T>(action: () => Promise<T>, result: ActionResult): Promise<T> => {
      announcer.actionStarted();
      let message: string | null = null;
      try {
        const value = await action();
        message = result.ok;
        return value;
      } catch (error: unknown) {
        message = result.failed ?? null;
        throw error;
      } finally {
        announcer.actionFinished(message);
      }
    },
    [announcer]
  );

  // The nonce toggles a zero-width character so a repeated message is announced again.
  const liveText = `${live.text}${live.nonce % 2 ? '\u200b' : ''}`;
  return { liveText, track };
}
