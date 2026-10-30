import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { useAuthStore, useNotificationStore } from '@/stores';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useRevealGroup, useRevealOnScroll } from '@/hooks/motion';
import { formatCompactNumber, formatDateValue, formatPercent } from '@/utils/format';
import { getErrorMessage } from '@/utils/helpers';
import { resolveTimeZoneLabel } from '@/utils/time/timezone';
import {
  DASHBOARD_POLL_MS,
  DASHBOARD_SOURCE_IDS,
  useDashboardOverview,
} from './hooks/useDashboardOverview';
import { useDashboardClock } from './hooks/useDashboardClock';
import {
  buildAttention,
  deriveVerdict,
  type DashboardSourceId,
  type SourceHealth,
  type Verdict,
  type VerdictTone,
} from './logic/attention';
import { classifyFreshness, worstFreshness, type SourceFreshness } from './logic/freshness';
import { redactUrlCredentials } from './logic/redact';
import { formatClock } from './logic/time';
import { summarizeUsage } from './logic/usage';
import type { CredentialRow } from './types';
import { AttentionPanel } from './components/AttentionPanel';
import { CredentialList } from './components/CredentialList';
import { ProviderHealthList } from './components/ProviderHealthList';
import { SourceStamp, type StampEntry } from './components/SourceStamp';
import { ThroughputChart } from './components/ThroughputChart';
import { UsagePanel } from './components/UsagePanel';
import { VitalsStrip, type Vital } from './components/VitalsStrip';
import { providerLabel, splitWindowMinutes, toneForSuccessRate } from './utils';
import styles from './dashboard.module.scss';

const DASH = '—';
const DEFAULT_WINDOW_MINUTES = 200;

/** Status colour of the headline's full stop. */
const VERDICT_ACCENTS: Record<VerdictTone, string> = {
  good: 'var(--viz-success)',
  warning: 'var(--amber-color)',
  critical: 'var(--viz-failure)',
  idle: 'var(--text-quaternary)',
};

/** Large figures: grouped digits below six figures, compact above. */
const formatHeadline = (value: number): string =>
  value < 100_000 ? value.toLocaleString() : formatCompactNumber(value);

function useVerdictTitle(verdict: Verdict): string {
  const { t } = useTranslation();
  switch (verdict.kind) {
    case 'down': {
      const provider = verdict.providerId
        ? providerLabel(verdict.providerId, t('dashboard.provider_unknown'))
        : null;
      if (verdict.stale) {
        return provider
          ? t('dashboard.hero_verdict_down_stale_one', { provider })
          : t('dashboard.hero_verdict_down_stale_many', { count: verdict.count });
      }
      return provider
        ? t('dashboard.hero_verdict_down_one', { provider })
        : t('dashboard.hero_verdict_down_many', { count: verdict.count });
    }
    case 'attention':
      return t('dashboard.hero_verdict_attention', { count: verdict.count });
    default:
      return t(`dashboard.hero_verdict_${verdict.kind}`);
  }
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);
  const showNotification = useNotificationStore((state) => state.showNotification);

  const {
    connectionStatus,
    connected,
    config,
    counts,
    traffic,
    providers,
    credentials,
    usage,
    sources,
    refresh,
    retrySource,
  } = useDashboardOverview();

  useHeaderRefresh(refresh, connected);
  const now = useDashboardClock();
  const [refreshing, setRefreshing] = useState(false);
  const [retryingCredentials, setRetryingCredentials] = useState(false);

  /* Hero cascades as a group; the sections below reveal as whole blocks. */
  const heroRef = useRevealGroup<HTMLElement>();
  const trafficRef = useRevealOnScroll<HTMLElement>();
  const fleetRef = useRevealOnScroll<HTMLElement>();
  const credentialsRef = useRevealOnScroll<HTMLElement>();
  const detailRef = useRevealGroup<HTMLElement>();

  /* ---------- Freshness ---------- */

  const freshness = useMemo(
    () =>
      Object.fromEntries(
        DASHBOARD_SOURCE_IDS.map((id) => [
          id,
          classifyFreshness(sources[id], DASHBOARD_POLL_MS[id], now),
        ])
      ) as Record<DashboardSourceId, SourceFreshness>,
    [sources, now]
  );
  const stampEntries = (ids: DashboardSourceId[]): StampEntry[] =>
    ids.map((id) => ({ id, status: sources[id], freshness: freshness[id] }));
  const primaryFreshness = worstFreshness([freshness.credentials, freshness.traffic]);
  const hasData = sources.credentials.receivedAt !== null || sources.traffic.receivedAt !== null;

  /* A primary source that has never loaded makes every total partial. */
  const missingPrimary = (['credentials', 'traffic'] as const).filter(
    (id) => sources[id].receivedAt === null && sources[id].error !== null
  );
  const missingNames = missingPrimary.map((id) => t(`dashboard.source_${id}`)).join(', ');
  const partialNote =
    missingPrimary.length > 0 ? t('dashboard.partial_missing', { sources: missingNames }) : null;
  const partialShort =
    missingPrimary.length > 0 ? t('dashboard.partial_short', { sources: missingNames }) : null;

  /* ---------- Attention and verdict ---------- */

  // Every source can raise an attention item when it fails or goes stale. Usage is skipped
  // only while the server's latest successful answer says it has no usage statistics.
  const sourceHealth = useMemo<SourceHealth[]>(
    () =>
      DASHBOARD_SOURCE_IDS.filter(
        (id) => !(id === 'usage' && usage?.enabled === null && freshness.usage === 'live')
      ).map((id) => ({
        id,
        freshness: freshness[id],
        error: sources[id].error,
        receivedAt: sources[id].receivedAt,
      })),
    [freshness, sources, usage?.enabled]
  );
  const attention = useMemo(
    () => (connected ? buildAttention(providers, sourceHealth) : []),
    [connected, providers, sourceHealth]
  );
  /* ---------- Usage (separate source, same window) ---------- */

  const usageWindowStart = traffic.startMs ?? now - DEFAULT_WINDOW_MINUTES * 60_000;
  const usageSummary = useMemo(
    () => (usage?.enabled ? summarizeUsage(usage.usage, usageWindowStart) : null),
    [usage, usageWindowStart]
  );
  // Credential traffic covers credentials listed now; usage statistics also keep requests
  // from credentials that were removed. Flag a material disagreement instead of letting
  // one of them read as the whole truth.
  const usageRequests = usageSummary && freshness.usage === 'live' ? usageSummary.requests : null;
  const usageDiffers =
    usageRequests !== null &&
    Math.abs(usageRequests - traffic.total) >
      Math.max(5, 0.1 * Math.max(usageRequests, traffic.total));

  const verdict = deriveVerdict({
    connectionStatus,
    attention,
    primaryFreshness,
    hasData,
    trafficTotal: Math.max(traffic.total, usageRequests ?? 0),
  });
  const verdictTitle = useVerdictTitle(verdict);
  /* The status full stop breathes only while steady traffic is flowing and fresh. */
  const heroAlive = verdict.kind === 'good' && primaryFreshness === 'live';

  /* ---------- Labels ---------- */

  const windowMinutes = traffic.windowMinutes > 0 ? traffic.windowMinutes : DEFAULT_WINDOW_MINUTES;
  const windowLabel = useMemo(() => {
    const { hours, minutes } = splitWindowMinutes(windowMinutes);
    if (hours === 0) return t('dashboard.window_m', { minutes });
    if (minutes === 0) return t('dashboard.window_h', { hours });
    return t('dashboard.window_hm', { hours, minutes });
  }, [windowMinutes, t]);

  const connectionLabel = t(
    connectionStatus === 'connected'
      ? 'common.connected'
      : connectionStatus === 'connecting'
        ? 'common.connecting'
        : 'common.disconnected'
  );
  const versionLabel = serverVersion ? `v${serverVersion.trim().replace(/^[vV]+/, '')}` : null;

  const routingStrategy = useMemo(() => {
    const raw = config?.routingStrategy?.trim() ?? '';
    if (!raw) return config ? t('dashboard.runtime_routing_default') : DASH;
    if (raw === 'round-robin') return t('basic_settings.routing_strategy_round_robin');
    if (raw === 'weighted-round-robin') {
      return t('basic_settings.routing_strategy_weighted_round_robin');
    }
    if (raw === 'fill-first') return t('basic_settings.routing_strategy_fill_first');
    return raw;
  }, [config, t]);

  const credentialsByIndex = useMemo(() => {
    const map = new Map<string, CredentialRow>();
    credentials?.rows.forEach((row) => {
      if (row.authIndex) map.set(row.authIndex, row);
    });
    return map;
  }, [credentials]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } catch (error: unknown) {
      showNotification(
        `${t('notification.refresh_failed')}: ${getErrorMessage(error, t('dashboard.source_credentials'))}`,
        'error'
      );
    } finally {
      setRefreshing(false);
    }
  };

  const retryCredentials = () => {
    setRetryingCredentials(true);
    void retrySource('credentials')
      .catch(() => undefined)
      .finally(() => setRetryingCredentials(false));
  };

  /* ---------- Vitals ---------- */

  // A partial total cannot vouch for health: keep its rate neutral until every source loads.
  // A partial or out-of-date total cannot vouch for health: keep its rate neutral until
  // every source is live again, and say why beside the number.
  const primaryLive = primaryFreshness === 'live';
  const successTone =
    partialShort || !primaryLive ? 'idle' : toneForSuccessRate(traffic.successRate);
  const primaryStamp =
    !primaryLive && hasData ? (
      <SourceStamp entries={stampEntries(['credentials', 'traffic'])} now={now} />
    ) : null;
  const exceptionTone = (tone: string): Vital['tone'] =>
    tone === 'critical' ? 'critical' : tone === 'warning' ? 'warning' : undefined;
  const trafficDetail = partialShort ? (
    <span className={styles.partialNote}>{partialShort}</span>
  ) : (
    primaryStamp
  );

  const credentialsVital: Vital = !credentials
    ? {
        key: 'credentials',
        label: t('dashboard.vitals_credentials'),
        value: DASH,
        detail: sources.credentials.error ? (
          <span className={styles.failedNote}>{t('dashboard.credentials_load_failed')}</span>
        ) : (
          t('dashboard.stamp_loading')
        ),
      }
    : {
        key: 'credentials',
        label: t('dashboard.vitals_credentials'),
        value:
          credentials.total === 0
            ? '0'
            : t('dashboard.vitals_of', {
                serving: credentials.serving,
                total: credentials.total - credentials.disabled,
              }),
        unit: credentials.total === 0 ? undefined : t('dashboard.vitals_serving_unit'),
        tone: credentials.problems > 0 ? 'warning' : undefined,
        detail: (
          <>
            <span className={styles.vitalLine}>
              {credentials.total === 0
                ? t('dashboard.vitals_credentials_none')
                : [
                    // "including N limited" qualifies the serving count, so it comes first.
                    credentials.limited > 0
                      ? t('dashboard.vitals_credentials_limited', { count: credentials.limited })
                      : null,
                    credentials.problems > 0
                      ? t('dashboard.vitals_credentials_problems', { count: credentials.problems })
                      : null,
                    credentials.disabled > 0
                      ? t('dashboard.vitals_credentials_disabled', { count: credentials.disabled })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || t('dashboard.vitals_credentials_ok')}
            </span>
            {freshness.credentials !== 'live' && (
              <SourceStamp entries={stampEntries(['credentials'])} now={now} />
            )}
          </>
        ),
      };

  const vitals: Vital[] = [
    {
      key: 'requests',
      label: t('dashboard.vitals_requests'),
      value: connected && hasData ? formatHeadline(traffic.total) : DASH,
      detail: (
        <>
          <span className={styles.vitalLine}>
            {t('dashboard.vitals_window', { window: windowLabel })}
          </span>
          {trafficDetail}
          {usageDiffers && (
            <span className={`${styles.vitalLine} ${styles.partialNote}`}>
              {t('dashboard.vitals_usage_differs', { count: usageRequests ?? 0 })}
            </span>
          )}
        </>
      ),
    },
    {
      key: 'success',
      label: t('dashboard.vitals_success'),
      value: traffic.successRate === null ? DASH : formatPercent(traffic.successRate),
      tone: exceptionTone(successTone),
      meter:
        traffic.successRate === null
          ? undefined
          : { value: traffic.successRate, tone: successTone, label: t('dashboard.vitals_success') },
      detail: (
        <>
          <span className={styles.vitalLine}>
            {traffic.total > 0
              ? t('dashboard.vitals_split', {
                  success: traffic.success.toLocaleString(),
                  failed: traffic.failed.toLocaleString(),
                })
              : t('dashboard.vitals_no_requests')}
          </span>
          {trafficDetail}
        </>
      ),
    },
    credentialsVital,
    {
      key: 'models',
      label: t('dashboard.vitals_models'),
      value: counts.models === null ? DASH : counts.models.toLocaleString(),
      detail: (
        <SourceStamp
          entries={stampEntries(['models'])}
          now={now}
          everyMs={DASHBOARD_POLL_MS.models}
        />
      ),
    },
  ];

  /* ---------- Runtime ---------- */

  const runtimeRows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: t('dashboard.runtime_routing'), value: routingStrategy },
    {
      label: t('dashboard.runtime_retry'),
      value: config ? String(config.requestRetry ?? 0) : DASH,
    },
    {
      label: t('dashboard.runtime_provider_keys'),
      value: counts.providerKeys === null ? DASH : String(counts.providerKeys),
    },
    {
      label: t('dashboard.runtime_client_keys'),
      value: counts.clientApiKeys === null ? DASH : String(counts.clientApiKeys),
    },
    { label: t('dashboard.runtime_version'), value: serverVersion?.trim() || DASH },
    {
      label: t('dashboard.runtime_build'),
      value: formatDateValue(serverBuildDate, i18n.language) || DASH,
    },
    {
      label: t('dashboard.runtime_proxy'),
      // Proxy URLs can embed credentials (user:password@host); never show the password.
      value: config?.proxyUrl?.trim()
        ? redactUrlCredentials(config.proxyUrl.trim())
        : t('dashboard.runtime_proxy_none'),
      mono: Boolean(config?.proxyUrl?.trim()),
    },
  ];

  const runtimeSwitches = config
    ? [
        { label: t('dashboard.runtime_debug'), on: Boolean(config.debug) },
        { label: t('dashboard.runtime_file_logging'), on: Boolean(config.loggingToFile) },
        { label: t('dashboard.runtime_request_log'), on: Boolean(config.requestLog) },
        { label: t('dashboard.runtime_ws_auth'), on: Boolean(config.wsAuth) },
        { label: t('dashboard.runtime_model_prefix'), on: Boolean(config.forceModelPrefix) },
      ]
    : [];

  const timeZoneLabel = resolveTimeZoneLabel(
    traffic.endMs !== null ? new Date(traffic.endMs) : undefined
  );

  return (
    <div className={styles.page}>
      <div className={styles.ambient} aria-hidden="true">
        <span className={styles.gridWash} />
      </div>

      {/* ---------- Verdict ---------- */}
      <section className={styles.hero} ref={heroRef}>
        <h1 className={styles.heroTitle} data-reveal>
          {verdictTitle}
          <span
            className={`${styles.heroPeriod} ${heroAlive ? styles.heroPeriodLive : ''}`}
            style={{ color: VERDICT_ACCENTS[verdict.tone] }}
          >
            {t('dashboard.hero_period')}
          </span>
        </h1>
        <div className={styles.heroMeta} data-reveal>
          <span className={styles.heroMetaText}>
            {[versionLabel, connectionLabel].filter(Boolean).map((part, index) => (
              <span key={index} className={styles.heroMetaPart}>
                {part}
              </span>
            ))}
            {connected && (
              <span className={styles.heroMetaPart}>
                <SourceStamp
                  entries={stampEntries(['credentials', 'traffic'])}
                  now={now}
                  className={styles.heroStamp}
                />
              </span>
            )}
          </span>
          {connected && (
            <button
              type="button"
              className={styles.refreshButton}
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              aria-label={t('dashboard.refresh_now')}
              title={t('dashboard.refresh_now')}
            >
              <IconRefreshCw
                size={14}
                className={refreshing ? styles.spinning : undefined}
                aria-hidden="true"
              />
              <span>{refreshing ? t('dashboard.refreshing') : t('dashboard.refresh')}</span>
            </button>
          )}
        </div>
      </section>

      {/* ---------- Attention ---------- */}
      {connected && (
        <AttentionPanel
          items={attention}
          evidenceAsOf={
            primaryFreshness === 'stale' || primaryFreshness === 'failed'
              ? (sources.credentials.receivedAt ?? sources.traffic.receivedAt)
              : null
          }
          checkedCredentials={credentials?.total ?? 0}
          checkedProviders={providers.length}
          primaryFreshness={primaryFreshness}
          primaryReceivedAt={
            sources.credentials.receivedAt !== null && sources.traffic.receivedAt !== null
              ? Math.min(sources.credentials.receivedAt, sources.traffic.receivedAt)
              : null
          }
          windowLabel={windowLabel}
          now={now}
          onRetry={retrySource}
        />
      )}

      {/* ---------- Vitals ---------- */}
      <VitalsStrip items={vitals} ariaLabel={t('dashboard.stats_aria')} />

      {/* ---------- Traffic ---------- */}
      <section className={styles.section} ref={trafficRef}>
        <header className={styles.sectionHead}>
          <span className={styles.eyebrow}>{t('dashboard.traffic_eyebrow')}</span>
          <h2 className={styles.sectionTitle}>{t('dashboard.traffic_title')}</h2>
          <p className={styles.sectionDescription}>
            {traffic.startMs !== null
              ? t('dashboard.traffic_description', {
                  start: formatClock(traffic.startMs, i18n.language),
                  zone: timeZoneLabel,
                })
              : t('dashboard.traffic_description_empty')}
          </p>
          {partialNote && <p className={styles.partialNote}>{partialNote}</p>}
          <SourceStamp entries={stampEntries(['credentials', 'traffic'])} now={now} />
        </header>
        <div className={styles.panel}>
          <ThroughputChart traffic={traffic} />
        </div>
      </section>

      {/* ---------- Providers ---------- */}
      <section className={styles.section} ref={fleetRef}>
        <header className={styles.sectionHeadRow}>
          <div className={styles.sectionHead}>
            <span className={styles.eyebrow}>{t('dashboard.fleet_eyebrow')}</span>
            <h2 className={styles.sectionTitle}>{t('dashboard.fleet_title')}</h2>
            <p className={styles.sectionDescription}>
              {t('dashboard.fleet_description', { window: windowLabel })}
            </p>
            {partialShort && <p className={styles.partialNote}>{partialShort}</p>}
            <SourceStamp entries={stampEntries(['credentials', 'traffic'])} now={now} />
          </div>
          <Link to="/ai-providers" className={styles.sectionLink}>
            {t('dashboard.cta_manage_providers')} <span aria-hidden="true">→</span>
          </Link>
        </header>
        <div className={styles.panel}>
          <ProviderHealthList providers={providers} />
        </div>
      </section>

      {/* ---------- Credentials ---------- */}
      <section className={styles.section} ref={credentialsRef}>
        <header className={styles.sectionHeadRow}>
          <div className={styles.sectionHead}>
            <span className={styles.eyebrow}>{t('dashboard.health_eyebrow')}</span>
            <h2 className={styles.sectionTitle}>{t('dashboard.health_title')}</h2>
            <SourceStamp entries={stampEntries(['credentials'])} now={now} />
          </div>
          <Link to="/oauth" className={styles.sectionLink}>
            {t('dashboard.action_add_oauth')} <span aria-hidden="true">→</span>
          </Link>
        </header>
        <div className={styles.panel}>
          <CredentialList
            credentials={credentials}
            loadError={sources.credentials.error}
            now={now}
            onRetry={retryCredentials}
            retrying={retryingCredentials}
          />
        </div>
      </section>

      {/* ---------- Usage + runtime ---------- */}
      <section className={styles.detailGrid} ref={detailRef}>
        <div className={styles.panel} data-reveal>
          <header className={styles.panelHead}>
            <span className={styles.eyebrow}>{t('dashboard.usage_eyebrow')}</span>
            <h2 className={styles.panelTitle}>{t('dashboard.usage_title')}</h2>
            <SourceStamp entries={stampEntries(['usage'])} now={now} />
          </header>
          <UsagePanel
            usage={usage}
            summary={usageSummary}
            windowLabel={windowLabel}
            credentialsByIndex={credentialsByIndex}
          />
        </div>

        <div className={styles.panel} data-reveal>
          <header className={styles.panelHead}>
            <span className={styles.eyebrow}>{t('dashboard.runtime_eyebrow')}</span>
            <h2 className={styles.panelTitle}>{t('dashboard.runtime_title')}</h2>
            <SourceStamp entries={stampEntries(['config'])} now={now} />
          </header>
          <dl className={styles.specList}>
            {runtimeRows.map((row) => (
              <div key={row.label} className={styles.specRow}>
                <dt className={styles.specLabel}>{row.label}</dt>
                <dd className={`${styles.specValue} ${row.mono ? styles.specMono : ''}`}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {runtimeSwitches.length > 0 && (
            <dl className={`${styles.specList} ${styles.switchList}`}>
              {runtimeSwitches.map((item) => (
                <div key={item.label} className={styles.specRow}>
                  <dt className={styles.specLabel}>{item.label}</dt>
                  <dd className={`${styles.specValue} ${item.on ? '' : styles.specOff}`}>
                    {item.on ? t('dashboard.runtime_on') : t('dashboard.runtime_off')}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <div className={styles.panelLinks}>
            <Link to="/config" className={styles.panelLink}>
              {t('dashboard.runtime_link')} <span aria-hidden="true">→</span>
            </Link>
            <Link to="/system" className={styles.panelLink}>
              {t('dashboard.runtime_system_link')} <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
