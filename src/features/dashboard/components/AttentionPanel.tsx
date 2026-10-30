import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconCheckCircle2, IconRefreshCw } from '@/components/ui/icons';
import type { CredentialRow } from '../types';
import type {
  AttentionItem,
  DashboardSourceId,
  ProviderAttention,
  SourceAttention,
} from '../logic/attention';
import type { SourceFreshness } from '../logic/freshness';
import { MIN_REQUESTS_FOR_RATE } from '../logic/fleet';
import { providerCredentialsHref } from '../logic/links';
import { formatClockRange } from '../logic/time';
import { providerLabel } from '../utils';
import { credentialRecoveryLines, formatAge } from './formatters';
import { StatusChip } from './StatusPills';
import styles from './AttentionPanel.module.scss';

const MAX_CREDENTIALS_PER_ITEM = 3;

interface AttentionPanelProps {
  items: AttentionItem[];
  checkedCredentials: number;
  checkedProviders: number;
  primaryFreshness: SourceFreshness;
  primaryReceivedAt: number | null;
  windowLabel: string;
  now: number;
  onRetry: (source: DashboardSourceId) => Promise<void>;
}

function CredentialEvidence({ row, now }: { row: CredentialRow; now: number }) {
  const { t, i18n } = useTranslation();
  const lines = credentialRecoveryLines(t, row, now, i18n.language);

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
      {lines.map((line) => (
        <span key={line} className={styles.credentialMeta}>
          {line}
        </span>
      ))}
    </li>
  );
}

function ProviderItem({
  item,
  windowLabel,
  now,
}: {
  item: ProviderAttention;
  windowLabel: string;
  now: number;
}) {
  const { t, i18n } = useTranslation();
  const { provider } = item;
  const name = providerLabel(provider.id, t('dashboard.provider_unknown'));
  const summary: string[] = [];

  if (provider.status === 'down') {
    summary.push(t('dashboard.attention_no_working_credential'));
  } else if (provider.credentials.problems > 0) {
    summary.push(
      t('dashboard.attention_credentials_problem', {
        count: provider.credentials.problems,
        total: provider.credentials.total,
      })
    );
  }
  if (provider.window.failed > 0 && provider.window.total >= MIN_REQUESTS_FOR_RATE) {
    summary.push(
      t('dashboard.attention_failed_requests', {
        failed: provider.window.failed.toLocaleString(),
        total: provider.window.total.toLocaleString(),
        window: windowLabel,
      })
    );
  }
  if (provider.lastActive && !provider.lastActive.partial) {
    summary.push(
      t('dashboard.attention_last_traffic', {
        range: formatClockRange(
          provider.lastActive.startMs,
          provider.lastActive.endMs,
          i18n.language
        ),
      })
    );
  }

  const hasCredentials = provider.credentials.total > 0;
  const shown = provider.problemCredentials.slice(0, MAX_CREDENTIALS_PER_ITEM);
  const hidden = provider.problemCredentials.length - shown.length;

  return (
    <li className={[styles.item, styles[`item_${item.severity}`]].join(' ')}>
      <div className={styles.itemBody}>
        <div className={styles.itemHead}>
          <span className={styles.itemTitle}>{name}</span>
          <StatusChip tone={item.severity === 'critical' ? 'critical' : 'warning'}>
            {t(`dashboard.provider_status_${provider.status}`)}
          </StatusChip>
        </div>
        {summary.length > 0 && <p className={styles.itemSummary}>{summary.join(' · ')}</p>}
        {shown.length > 0 && (
          <ul className={styles.credentials}>
            {shown.map((row) => (
              <CredentialEvidence key={`${row.name}:${row.identity.primary}`} row={row} now={now} />
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
        {hasCredentials ? (
          <Link
            className={styles.action}
            to={providerCredentialsHref(provider)}
            aria-label={t('dashboard.action_inspect_credentials_named', { provider: name })}
          >
            {provider.problemCredentials.length === 1
              ? t('dashboard.action_inspect_credential')
              : t('dashboard.action_inspect_credentials')}
          </Link>
        ) : (
          <Link
            className={styles.action}
            to="/ai-providers"
            aria-label={t('dashboard.action_open_provider_named', { provider: name })}
          >
            {t('dashboard.action_open_provider')}
          </Link>
        )}
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
      ? t('dashboard.attention_source_failed', { source })
      : t('dashboard.attention_source_stale', { source });
  const details = [
    item.error,
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
          onClick={onRetry}
          disabled={retrying}
          aria-label={t('dashboard.action_retry_named', { source })}
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
 * resolves it. When nothing is wrong it says what was checked and when.
 */
export function AttentionPanel({
  items,
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
        <section className={styles.allClear} aria-labelledby="dashboard-attention-title">
          <span className={styles.setupIcon} aria-hidden="true">
            <IconAlertTriangle size={18} />
          </span>
          <div className={styles.allClearCopy}>
            <h2 id="dashboard-attention-title" className={styles.allClearTitle}>
              {t('dashboard.attention_setup')}
            </h2>
            <p className={styles.allClearDetail}>{t('dashboard.attention_setup_detail')}</p>
          </div>
          <Link className={styles.action} to="/oauth">
            {t('dashboard.health_add')}
          </Link>
        </section>
      );
    }
    return (
      <section className={styles.allClear} aria-labelledby="dashboard-attention-title">
        <span className={styles.allClearIcon} aria-hidden="true">
          <IconCheckCircle2 size={18} />
        </span>
        <div className={styles.allClearCopy}>
          <h2 id="dashboard-attention-title" className={styles.allClearTitle}>
            {pending ? t('dashboard.attention_checking') : t('dashboard.attention_none')}
          </h2>
          {!pending && (
            <p className={styles.allClearDetail}>
              {t('dashboard.attention_none_detail', {
                credentials: t('dashboard.attention_none_credentials', {
                  count: checkedCredentials,
                }),
                providers: t('dashboard.attention_none_providers', { count: checkedProviders }),
                age: formatAge(t, primaryReceivedAt as number, now),
              })}
            </p>
          )}
        </div>
        <Link className={styles.headerLink} to="/logs">
          {t('dashboard.cta_inspect_logs')} <span aria-hidden="true">→</span>
        </Link>
      </section>
    );
  }

  const critical = items.filter((item) => item.severity === 'critical').length;

  return (
    <section className={styles.panel} aria-labelledby="dashboard-attention-title">
      <header className={styles.header}>
        <span className={styles.headerIcon} aria-hidden="true">
          <IconAlertTriangle size={18} />
        </span>
        <h2 id="dashboard-attention-title" className={styles.title}>
          {t('dashboard.attention_title', { count: items.length })}
          {critical > 0 && (
            <span className={styles.titleCritical}>
              {t('dashboard.attention_critical_count', { count: critical })}
            </span>
          )}
        </h2>
        <Link className={styles.headerLink} to="/logs">
          {t('dashboard.cta_inspect_logs')} <span aria-hidden="true">→</span>
        </Link>
      </header>
      <ul className={styles.list}>
        {items.map((item) =>
          item.kind === 'provider' ? (
            <ProviderItem key={item.key} item={item} windowLabel={windowLabel} now={now} />
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
