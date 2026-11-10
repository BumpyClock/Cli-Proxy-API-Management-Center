import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { PageHeader } from '@/components/ui/PageHeader';
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
import { formatInstant } from './logic/time';
import { deriveRequestScope, requestScopeLabel } from './logic/requestScope';
import { credentialsVitalLine } from './logic/vitals';
import { summarizeUsage } from './logic/usage';
import { deriveHealthStatus, verdictInTitle } from './logic/healthStatus';
import { useDashboardAnnouncer } from './hooks/useDashboardAnnouncer';
import { useFocusRescue } from './hooks/useFocusRescue';
import type { CredentialRow } from './types';
import { AttentionPanel } from './components/AttentionPanel';
import { CredentialList } from './components/CredentialList';
import { ProviderHealthList } from './components/ProviderHealthList';
import { SourceStamp, type StampEntry } from './components/SourceStamp';
import { EmptyRequestFlow, ThroughputChart } from './components/ThroughputChart';
import { HealthStatusRow } from './components/HealthStatusRow';
import { QuotaSummaryChart } from './components/QuotaSummaryChart';
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

function useVerdictTitle(verdict: Verdict, windowLabel: string): string {
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
      // Idle verdicts name the Requests window they describe.
      return t(`dashboard.hero_verdict_${verdict.kind}`, { window: windowLabel });
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
    credentialFiles,
    credentialFilesReady,
    usage,
    sources,
    refresh,
    retrySource,
  } = useDashboardOverview();

  useHeaderRefresh(refresh, connected);
  const now = useDashboardClock();
  const [refreshing, setRefreshing] = useState(false);
  const [retryingCredentials, setRetryingCredentials] = useState(false);

  /* Sections reveal as whole blocks. */
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

  const windowMinutes = traffic.windowMinutes > 0 ? traffic.windowMinutes : DEFAULT_WINDOW_MINUTES;
  const windowLabel = useMemo(() => {
    const { hours, minutes } = splitWindowMinutes(windowMinutes);
    if (hours === 0) return t('dashboard.window_m', { minutes });
    if (minutes === 0) return t('dashboard.window_h', { hours });
    return t('dashboard.window_hm', { hours, minutes });
  }, [windowMinutes, t]);

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
  const usageWindowEnd = traffic.endMs ?? now;
  const usageSummary = useMemo(
    () =>
      usage?.enabled && usage.supported !== false
        ? summarizeUsage(usage.usage, usageWindowStart, usageWindowEnd)
        : null,
    [usage, usageWindowStart, usageWindowEnd]
  );
  const usageWindowLabel = t('dashboard.usage_window_bounds', {
    start: `${formatInstant(usageWindowStart, now, i18n.language)} ${resolveTimeZoneLabel(new Date(usageWindowStart))}`,
    end: `${formatInstant(usageWindowEnd, now, i18n.language)} ${resolveTimeZoneLabel(new Date(usageWindowEnd))}`,
  });
  // Credential traffic covers credentials listed now; usage statistics also keep requests
  // from credentials that were removed. Flag a material disagreement instead of letting
  // one of them read as the whole truth.
  const comparableUsageRequests =
    usageSummary && usageSummary.coverageStartMs === null && freshness.usage === 'live'
      ? usageSummary.requests
      : null;
  const usageDiffers =
    comparableUsageRequests !== null &&
    Math.abs(comparableUsageRequests - traffic.total) >
      Math.max(5, 0.1 * Math.max(comparableUsageRequests, traffic.total));

  // Receipts of the sources behind provider evidence: credential files and API-key traffic.
  const evidence = useMemo(
    () => ({
      credentials: {
        receivedAt: sources.credentials.receivedAt,
        live: freshness.credentials === 'live',
      },
      traffic: { receivedAt: sources.traffic.receivedAt, live: freshness.traffic === 'live' },
    }),
    [
      freshness.credentials,
      freshness.traffic,
      sources.credentials.receivedAt,
      sources.traffic.receivedAt,
    ]
  );

  const verdict = deriveVerdict({
    evidence,
    connectionStatus,
    attention,
    primaryFreshness,
    hasData,
    trafficTotal: traffic.total,
    otherScopeActivity: freshness.usage === 'live' && (usageSummary?.requests ?? 0) > 0,
  });
  const verdictTitle = useVerdictTitle(verdict, windowLabel);
  const primaryReceivedAt =
    sources.credentials.receivedAt !== null && sources.traffic.receivedAt !== null
      ? Math.min(sources.credentials.receivedAt, sources.traffic.receivedAt)
      : null;
  const checkedCredentials = credentials?.total ?? 0;
  const healthStatus = deriveHealthStatus({
    attentionCount: attention.length,
    verdict: verdict.kind,
    primaryFreshness,
    primaryReceivedAt,
    checkedCredentials,
    checkedProviders: providers.length,
  });
  const heroTitle = verdictInTitle(connected, healthStatus, verdict.kind);

  /* ---------- Live announcements (screen readers) ---------- */

  const { liveText, track: trackAction } = useDashboardAnnouncer({
    settled:
      primaryFreshness !== 'pending' &&
      verdict.kind !== 'connecting' &&
      verdict.kind !== 'checking',
    verdictKey: `${verdict.kind}|${verdict.providerId ?? ''}|${verdict.count}|${verdict.stale}`,
    verdictProviderId: verdict.providerId,
    verdictSentence: `${verdictTitle}${t('dashboard.hero_period')}`,
    attention,
    primary: {
      credentialsAt: sources.credentials.receivedAt,
      trafficAt: sources.traffic.receivedAt,
      busy: sources.credentials.loading || sources.traffic.loading,
    },
  });

  // Polls and Retry can remove the focused control; keep keyboard users in place.
  useFocusRescue();

  /* ---------- Labels ---------- */

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
    if (refreshing) return;
    setRefreshing(true);
    try {
      // A failure is reported by the error toast (role="alert").
      await trackAction(() => refresh(), { ok: t('dashboard.announce_refreshed') });
    } catch (error: unknown) {
      showNotification(
        `${t('notification.refresh_failed')}: ${getErrorMessage(error, t('dashboard.source_credentials'))}`,
        'error'
      );
    } finally {
      setRefreshing(false);
    }
  };

  // Retry announces its outcome; a failure leaves the error in place, so say it again.
  const retryAndAnnounce = useCallback(
    async (id: Parameters<typeof retrySource>[0]) => {
      const source = t(`dashboard.source_${id}`);
      await trackAction(() => retrySource(id), {
        ok: t('dashboard.announce_source_loaded', { source }),
        failed: t('dashboard.announce_retry_failed', { source }),
      });
    },
    [retrySource, t, trackAction]
  );

  const retryCredentials = () => {
    if (retryingCredentials) return;
    setRetryingCredentials(true);
    void retryAndAnnounce('credentials')
      .catch(() => undefined)
      .finally(() => setRetryingCredentials(false));
  };

  /* ---------- Vitals ---------- */

  // A partial or out-of-date total cannot vouch for health: keep its rate neutral until
  // every source is live again.
  const primaryLive = primaryFreshness === 'live';
  const requestScope = deriveRequestScope({
    credentials: sources.credentials,
    traffic: sources.traffic,
  });
  const scopeLabel = requestScopeLabel(requestScope);
  const scopePartial = scopeLabel?.missingKey != null;
  const successTone = primaryLive ? toneForSuccessRate(traffic.successRate) : 'idle';
  const exceptionTone = (tone: string): Vital['tone'] =>
    tone === 'critical' ? 'critical' : tone === 'warning' ? 'warning' : undefined;
  const primaryStamp = <SourceStamp entries={stampEntries(['credentials', 'traffic'])} now={now} />;

  // One line under the Requests total: its window and exactly which sources it sums.
  const requestsLine = !scopeLabel ? (
    primaryStamp
  ) : scopeLabel.missingKey ? (
    <span className={`${styles.vitalLine} ${styles.partialNote}`}>
      {t('dashboard.vitals_scope_partial', {
        window: windowLabel,
        scope: t(scopeLabel.scopeKey),
        missing: t(scopeLabel.missingKey),
      })}
    </span>
  ) : (
    <>
      <span className={styles.vitalLine}>
        {t('dashboard.vitals_scope', { window: windowLabel, scope: t(scopeLabel.scopeKey) })}
      </span>
      {!primaryLive && primaryStamp}
    </>
  );

  const credentialsLine = credentials ? credentialsVitalLine(credentials, t) : '';
  const credentialsStamp =
    freshness.credentials !== 'live' ? (
      <SourceStamp entries={stampEntries(['credentials'])} now={now} />
    ) : null;
  const credentialsVital: Vital = !credentials
    ? {
        key: 'credentials',
        label: t('dashboard.vitals_credentials'),
        value: null,
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
        detail:
          credentialsLine || credentialsStamp ? (
            <>
              {credentialsLine && <span className={styles.vitalLine}>{credentialsLine}</span>}
              {credentialsStamp}
            </>
          ) : undefined,
      };

  const measured = connected && hasData;
  const successLine = [
    traffic.total > 0
      ? t('dashboard.vitals_split', {
          success: traffic.success.toLocaleString(),
          failed: traffic.failed.toLocaleString(),
        })
      : null,
    measured && traffic.successRate === null ? t('dashboard.vitals_success_unmeasured') : null,
    scopePartial && scopeLabel
      ? t('dashboard.vitals_rate_scope', { scope: t(scopeLabel.scopeKey) })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const vitals: Vital[] = [
    {
      key: 'requests',
      label: t('dashboard.vitals_requests'),
      value: measured ? formatHeadline(traffic.total) : null,
      detail: (
        <>
          {requestsLine}
          {usageDiffers && (
            <details className={styles.vitalCaveat}>
              <summary>
                {t('dashboard.vitals_usage_differs_short', { count: comparableUsageRequests ?? 0 })}
              </summary>
              <span>
                {t('dashboard.vitals_usage_differs', { count: comparableUsageRequests ?? 0 })}{' '}
                <Link to="/usage" className={styles.vitalLink}>
                  {t('dashboard.usage_link')} <span aria-hidden="true">→</span>
                </Link>
              </span>
            </details>
          )}
        </>
      ),
    },
    {
      key: 'success',
      label: t('dashboard.vitals_success'),
      value: traffic.successRate === null ? null : formatPercent(traffic.successRate),
      tone: exceptionTone(successTone),
      meter:
        traffic.successRate === null
          ? undefined
          : { value: traffic.successRate, tone: successTone, label: t('dashboard.vitals_success') },
      detail: successLine ? (
        <span className={scopePartial ? styles.partialNote : undefined}>{successLine}</span>
      ) : undefined,
    },
    credentialsVital,
    {
      key: 'models',
      label: t('dashboard.vitals_models'),
      value: counts.models === null ? null : counts.models.toLocaleString(),
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

  // An all-zero window adds nothing the status row has not said, so it yields its place
  // above the quota to figures that have values and follows them as one compact row.
  const trafficIdle = traffic.total === 0 && traffic.buckets.length > 0;
  const requestFlow = trafficIdle ? (
    <section
      className={`${styles.panel} ${styles.panelCompact}`}
      ref={trafficRef}
      aria-labelledby="dashboard-request-flow-title"
    >
      <EmptyRequestFlow
        traffic={traffic}
        zoneLabel={timeZoneLabel}
        stamp={<SourceStamp entries={stampEntries(['credentials', 'traffic'])} now={now} />}
        note={partialNote && <p className={styles.partialNote}>{partialNote}</p>}
      />
    </section>
  ) : (
    <section className={`${styles.section} ${styles.panel}`} ref={trafficRef}>
      <header className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{t('redesign.dashboard.request_flow')}</h2>
        {/* The bucket explanation only describes a plot; an unavailable window has none. */}
        {traffic.total > 0 && (
          <p className={styles.sectionDescription}>
            {t('redesign.dashboard.traffic_interval', { zone: timeZoneLabel })}
          </p>
        )}
        {partialNote && <p className={styles.partialNote}>{partialNote}</p>}
        <SourceStamp entries={stampEntries(['credentials', 'traffic'])} now={now} />
      </header>
      <ThroughputChart traffic={traffic} />
    </section>
  );

  return (
    <div className={styles.page}>
      <div className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
        {liveText}
      </div>
      <section className={styles.hero}>
        <PageHeader
          titleId="dashboard-title"
          variant={heroTitle ? 'hero' : 'default'}
          title={
            !heroTitle ? (
              t('nav.dashboard')
            ) : (
              <>
                {verdictTitle}
                <span
                  className={styles.heroPeriod}
                  style={{ color: VERDICT_ACCENTS[verdict.tone] }}
                >
                  {t('dashboard.hero_period')}
                </span>
              </>
            )
          }
          meta={
            <span className={styles.heroMetaText}>
              {[versionLabel, connectionLabel].filter(Boolean).map((part, index) => (
                <span key={index} className={styles.heroMetaPart}>
                  {part}
                </span>
              ))}
            </span>
          }
          actions={
            connected && (
              <RefreshButton
                onClick={() => void handleRefresh()}
                refreshing={refreshing}
                label={t('dashboard.refresh_now')}
              />
            )
          }
        />
      </section>

      {/* ---------- Status: the attention list, or one line saying what was checked ---------- */}
      {connected &&
        (healthStatus.kind === 'attention' || healthStatus.kind === 'setup' ? (
          <AttentionPanel
            items={attention}
            evidence={evidence}
            checkedCredentials={checkedCredentials}
            checkedProviders={providers.length}
            primaryFreshness={primaryFreshness}
            primaryReceivedAt={primaryReceivedAt}
            windowLabel={windowLabel}
            now={now}
            onRetry={retryAndAnnounce}
          />
        ) : (
          <HealthStatusRow status={healthStatus} windowLabel={windowLabel} now={now} />
        ))}

      {/* ---------- Vitals ---------- */}
      <VitalsStrip items={vitals} ariaLabel={t('dashboard.stats_aria')} />

      {!trafficIdle && requestFlow}

      <QuotaSummaryChart files={credentialFiles} filesReady={credentialFilesReady} />

      {trafficIdle && requestFlow}

      {/* ---------- Providers ---------- */}
      <section className={`${styles.section} ${styles.panel}`} ref={fleetRef}>
        <header className={styles.sectionHeadRow}>
          <div className={styles.sectionHead}>
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
        <ProviderHealthList providers={providers} />
      </section>

      {/* ---------- Credentials ---------- */}
      <section
        className={`${styles.section} ${styles.panel}`}
        ref={credentialsRef}
        data-focus-rescue="dashboard-credentials-title"
      >
        <header className={styles.sectionHeadRow}>
          <div className={styles.sectionHead}>
            <h2 id="dashboard-credentials-title" className={styles.sectionTitle} tabIndex={-1}>
              {t('dashboard.health_title')}
            </h2>
            <SourceStamp entries={stampEntries(['credentials'])} now={now} />
          </div>
          <Link to="/oauth" className={styles.sectionLink}>
            {t('dashboard.action_add_oauth')} <span aria-hidden="true">→</span>
          </Link>
        </header>
        <CredentialList
          credentials={credentials}
          loadError={sources.credentials.error}
          now={now}
          onRetry={retryCredentials}
          retrying={retryingCredentials}
        />
      </section>

      {/* ---------- Usage + runtime ---------- */}
      <section className={styles.detailGrid} ref={detailRef}>
        <div className={styles.panel} data-reveal>
          <header className={styles.panelHead}>
            <h2 className={styles.panelTitle}>{t('dashboard.usage_title')}</h2>
            <SourceStamp entries={stampEntries(['usage'])} now={now} />
          </header>
          <UsagePanel
            usage={usage}
            summary={usageSummary}
            windowLabel={usageWindowLabel}
            historicalWindow={usageWindowEnd < now}
            credentialsByIndex={credentialsByIndex}
          />
        </div>

        <div className={styles.panel} data-reveal>
          <header className={styles.panelHead}>
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
