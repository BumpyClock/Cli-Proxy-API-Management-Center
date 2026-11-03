import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconRefreshCw } from '@/components/ui/icons';
import { resolveTimeZoneLabel } from '@/utils/time/timezone';
import type { CredentialRow } from '../types';
import type {
  AttentionItem,
  DashboardSourceId,
  ProviderAttention,
  SourceAttention,
} from '../logic/attention';
import type { SourceFreshness } from '../logic/freshness';
import { providerCredentialsHref, providerLogsHref, providerSettingsHref } from '../logic/links';
import { redactSecrets } from '../logic/redact';
import { evidenceAsOf, type EvidenceReceipts } from '../logic/evidence';
import { formatClockRange } from '../logic/time';
import { providerLabel } from '../utils';
import { formatAge } from './formatters';
import { RecoveryDetails } from './RecoveryDetails';
import { StatusText } from './StatusText';
import styles from './AttentionPanel.module.scss';

const MAX_CREDENTIALS_PER_ITEM = 3;

interface AttentionPanelProps {
  items: AttentionItem[];
  /** Receipts of the sources behind provider evidence, so stale evidence states its age. */
  evidence?: EvidenceReceipts;
  checkedCredentials: number;
  checkedProviders: number;
  primaryFreshness: SourceFreshness;
  primaryReceivedAt: number | null;
  windowLabel: string;
  now: number;
  onRetry: (source: DashboardSourceId) => Promise<void>;
}

function CredentialEvidence({ row, now }: { row: CredentialRow; now: number }) {
  return (
    <li className={styles.credential}>
      <span
        className={[styles.credentialName, row.identity.kind === 'fileName' ? styles.mono : '']
          .filter(Boolean)
          .join(' ')}
        title={row.identity.fullName}
      >
        {row.identity.primary || row.name}
      </span>
      {row.reason && <span className={styles.credentialReason}>{row.reason}</span>}
      <RecoveryDetails row={row} now={now} lineClassName={styles.credentialMeta} />
    </li>
  );
}

function ProviderItem({
  item,
  windowLabel,
  now,
  evidence,
}: {
  item: ProviderAttention;
  windowLabel: string;
  now: number;
  evidence?: EvidenceReceipts;
}) {
  const { t, i18n } = useTranslation();
  const { provider } = item;
  const name = providerLabel(provider.id, t('dashboard.provider_unknown'));
  const summary: string[] = [];

  if (provider.status === 'down') {
    summary.push(t('dashboard.attention_no_working_credential'));
  } else if (provider.status === 'unknown') {
    summary.push(t('dashboard.attention_no_working_credential_keys_unknown'));
  } else if (provider.credentials.problems > 0) {
    summary.push(
      t('dashboard.attention_credentials_problem', {
        count: provider.credentials.problems,
        total: provider.credentials.total,
      })
    );
  } else if (provider.status === 'limited') {
    summary.push(
      t('dashboard.attention_credentials_limited', {
        count: provider.credentials.limited,
        total: provider.credentials.total,
      })
    );
  }
  if (provider.window.failed > 0 && provider.trafficFailing) {
    summary.push(
      t('dashboard.attention_failed_requests', {
        failed: provider.window.failed.toLocaleString(),
        total: provider.window.total.toLocaleString(),
        window: windowLabel,
      })
    );
  }
  if (provider.lastActive && !provider.lastActive.partial && provider.trafficFailing) {
    summary.push(
      t('dashboard.attention_last_traffic', {
        range: `${formatClockRange(
          provider.lastActive.startMs,
          provider.lastActive.endMs,
          i18n.language
        )} ${resolveTimeZoneLabel(new Date(provider.lastActive.startMs))}`,
      })
    );
  }
  // API-key traffic only carries counts; say so instead of implying there is no cause.
  const apiKeyOnlyFailure =
    provider.trafficFailing && provider.problemCredentials.length === 0 && provider.apiKeys > 0;
  if (apiKeyOnlyFailure) summary.push(t('dashboard.attention_reason_unreported'));

  // Offer the destination that matches the evidence: failing credentials go to Auth Files,
  // failing API-key traffic goes to that provider's settings and to its log lines. When
  // failing traffic cannot be attributed to one kind of credential, both are offered.
  const actions: Array<{ key: string; to: string; label: string; ariaLabel: string }> = [];
  const problems = provider.problemCredentials.length;
  const evidenceRows = problems > 0 ? provider.problemCredentials : provider.limitedCredentials;
  // Accessible names start with the visible label so voice control can target them.
  const named = (label: string) => t('dashboard.action_named', { label, context: name });
  if (evidenceRows.length > 0 || (provider.trafficFailing && provider.credentials.total > 0)) {
    const label =
      evidenceRows.length === 1
        ? t('dashboard.action_inspect_credential')
        : t('dashboard.action_inspect_credentials');
    actions.push({
      key: 'credentials',
      to: providerCredentialsHref(provider),
      label,
      ariaLabel: named(label),
    });
  }
  if (provider.trafficFailing && provider.apiKeys > 0) {
    actions.push({
      key: 'provider',
      to: providerSettingsHref(provider.id),
      label: t('dashboard.action_open_provider_named', { provider: name }),
      ariaLabel: t('dashboard.action_open_provider_named', { provider: name }),
    });
    actions.push({
      key: 'logs',
      to: providerLogsHref(provider.id),
      label: t('dashboard.action_search_logs'),
      ariaLabel: named(t('dashboard.action_search_logs')),
    });
  }
  const shown = evidenceRows.slice(0, MAX_CREDENTIALS_PER_ITEM);
  const hidden = evidenceRows.length - shown.length;
  const asOf = evidenceAsOf(provider, evidence);

  return (
    <li className={[styles.item, styles[`item_${item.severity}`]].join(' ')}>
      <div className={styles.itemBody}>
        <div className={styles.itemHead}>
          <span className={styles.itemTitle}>{name}</span>
          <StatusText tone={item.severity === 'critical' ? 'critical' : 'warning'}>
            {t(`dashboard.provider_status_${provider.status}`)}
          </StatusText>
          {asOf !== null && (
            <span className={styles.asOf}>
              {t('dashboard.attention_as_of', { age: formatAge(t, asOf, now) })}
            </span>
          )}
        </div>
        {summary.length > 0 && <p className={styles.itemSummary}>{summary.join(' · ')}</p>}
        {shown.length > 0 && (
          <ul className={styles.credentials}>
            {shown.map((row) => (
              <CredentialEvidence
                key={JSON.stringify([row.name, row.authIndex])}
                row={row}
                now={now}
              />
            ))}
            {hidden > 0 && (
              <li className={styles.credentialMore}>
                {t('dashboard.attention_more_credentials', { count: hidden })}
              </li>
            )}
          </ul>
        )}
      </div>
      <div className={styles.itemActions}>
        {actions.map((action) => (
          <Link
            key={action.key}
            className={styles.action}
            to={action.to}
            aria-label={action.ariaLabel}
          >
            {action.label}
          </Link>
        ))}
      </div>
    </li>
  );
}

function SourceItem({
  item,
  now,
  retrying,
  onRetry,
}: {
  item: SourceAttention;
  now: number;
  retrying: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const source = t(`dashboard.source_${item.source}`);
  const title =
    item.freshness === 'failed'
      ? item.receivedAt === null
        ? t('dashboard.attention_source_missing', { source })
        : t('dashboard.attention_source_failed', { source })
      : t('dashboard.attention_source_stale', { source });
  const details = [
    item.error ? redactSecrets(item.error) : null,
    item.receivedAt !== null
      ? t('dashboard.attention_source_showing', { age: formatAge(t, item.receivedAt, now) })
      : t('dashboard.attention_source_no_data'),
  ].filter(Boolean);

  return (
    <li className={[styles.item, styles.item_warning].join(' ')}>
      <div className={styles.itemBody}>
        <div className={styles.itemHead}>
          <span className={styles.itemTitle}>{title}</span>
        </div>
        <p className={styles.itemSummary}>{details.join(' · ')}</p>
      </div>
      <div className={styles.itemActions}>
        <button
          type="button"
          className={styles.action}
          // aria-disabled (not disabled) keeps keyboard focus on the button while it works.
          onClick={retrying ? undefined : onRetry}
          aria-disabled={retrying || undefined}
          aria-label={
            retrying
              ? undefined
              : t('dashboard.action_named', { label: t('dashboard.action_retry'), context: source })
          }
        >
          <IconRefreshCw
            size={14}
            className={retrying ? styles.spinning : undefined}
            aria-hidden="true"
          />
          {retrying ? t('dashboard.refreshing') : t('dashboard.action_retry')}
        </button>
      </div>
    </li>
  );
}

/**
 * The first thing below the headline: every problem, its evidence, and the action that
 * resolves it. No panel is rendered when there is nothing to act on.
 */
export function AttentionPanel({
  items,
  evidence,
  checkedCredentials,
  checkedProviders,
  primaryFreshness,
  primaryReceivedAt,
  windowLabel,
  now,
  onRetry,
}: AttentionPanelProps) {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState<Set<DashboardSourceId>>(() => new Set());

  const retry = (source: DashboardSourceId) => {
    setRetrying((current) => new Set(current).add(source));
    void onRetry(source)
      .catch(() => undefined)
      .finally(() =>
        setRetrying((current) => {
          const next = new Set(current);
          next.delete(source);
          return next;
        })
      );
  };

  if (items.length === 0) {
    const pending = primaryFreshness === 'pending' || primaryReceivedAt === null;
    // A fresh install has nothing to check yet: point at the first step instead of "all clear".
    const setupNeeded = !pending && checkedCredentials === 0 && checkedProviders === 0;
    if (setupNeeded) {
      return (
        <section
          className={styles.allClear}
          aria-labelledby="dashboard-attention-title"
          data-focus-rescue="dashboard-attention-title"
        >
          <span className={styles.setupIcon} aria-hidden="true">
            <IconAlertTriangle size={18} />
          </span>
          <div className={styles.allClearCopy}>
            <h2 id="dashboard-attention-title" tabIndex={-1} className={styles.allClearTitle}>
              {t('dashboard.attention_setup')}
            </h2>
            <p className={styles.allClearDetail}>{t('dashboard.attention_setup_detail')}</p>
          </div>
          <div className={styles.setupActions}>
            <Link className={styles.action} to="/oauth">
              {t('dashboard.action_add_oauth')}
            </Link>
            <Link className={styles.action} to="/ai-providers">
              {t('dashboard.action_add_api_key')}
            </Link>
          </div>
        </section>
      );
    }
    return null;
  }

  return (
    <section
      className={styles.panel}
      aria-labelledby="dashboard-attention-title"
      data-focus-rescue="dashboard-title"
    >
      <header className={styles.header}>
        <span className={styles.headerIcon} aria-hidden="true">
          <IconAlertTriangle size={18} />
        </span>
        <h2 id="dashboard-attention-title" tabIndex={-1} className={styles.title}>
          {t('dashboard.attention_title', { count: items.length })}
        </h2>
        <Link className={styles.headerLink} to="/logs">
          {t('dashboard.cta_inspect_logs')} <span aria-hidden="true">→</span>
        </Link>
      </header>
      <ul className={styles.list}>
        {items.map((item) =>
          item.kind === 'provider' ? (
            <ProviderItem
              key={item.key}
              item={item}
              windowLabel={windowLabel}
              now={now}
              evidence={evidence}
            />
          ) : (
            <SourceItem
              key={item.key}
              item={item}
              now={now}
              retrying={retrying.has(item.source)}
              onRetry={() => retry(item.source)}
            />
          )
        )}
      </ul>
    </section>
  );
}
