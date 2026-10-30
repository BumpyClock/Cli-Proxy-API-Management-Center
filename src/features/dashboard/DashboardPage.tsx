import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { useAuthStore, useNotificationStore } from '@/stores';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useCountUp, useRevealGroup, useRevealOnScroll } from '@/hooks/motion';
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
  type SourceHealth,
  type Verdict,
  type VerdictTone,
} from './logic/attention';
import {
  classifyFreshness,
  oldestReceipt,
  worstFreshness,
  type SourceFreshness,
} from './logic/freshness';
import { redactUrlCredentials } from './logic/redact';
import { formatClock } from './logic/time';
import type { CredentialRow } from './types';
import { AttentionPanel } from './components/AttentionPanel';
import { CredentialList } from './components/CredentialList';
import { LiveWire } from './components/LiveWire';
import { Meter } from './components/Meter';
import { ProviderHealthList } from './components/ProviderHealthList';
import { SourceStamp } from './components/SourceStamp';
import { ThroughputChart } from './components/ThroughputChart';
import { UsagePanel } from './components/UsagePanel';
import { providerLabel, splitWindowMinutes, toneForSuccessRate, type MeterTone } from './utils';
import styles from './dashboard.module.scss';

const DASH = '—';
const DEFAULT_WINDOW_MINUTES = 200;

/** Accent per tone: status color for meaningful tiles, neutral otherwise. */
const TONE_ACCENTS: Record<MeterTone | VerdictTone, string> = {
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
    case 'down':
      return verdict.providerId
        ? t('dashboard.hero_verdict_down_one', {
            provider: providerLabel(verdict.providerId, t('dashboard.provider_unknown')),
          })
        : t('dashboard.hero_verdict_down_many', { count: verdict.count });
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

  /* Hero and static grids cascade as a group; async sections reveal as one block. */
  const heroRef = useRevealGroup<HTMLElement>();
  const statsRef = useRevealGroup<HTMLElement>(0.12);
  const trafficRef = useRevealOnScroll<HTMLElement>();
  const fleetRef = useRevealOnScroll<HTMLElement>();
  const credentialsRef = useRevealOnScroll<HTMLElement>();
  const detailRef = useRevealGroup<HTMLElement>();

  const animatedTotal = useCountUp(traffic.total, connected);

  /* ---------- Freshness ---------- */

  const freshness = useMemo(
    () =>
      Object.fromEntries(
        DASHBOARD_SOURCE_IDS.map((id) => [
          id,
          classifyFreshness(sources[id], DASHBOARD_POLL_MS[id], now),
        ])
      ) as Record<(typeof DASHBOARD_SOURCE_IDS)[number], SourceFreshness>,
    [sources, now]
  );
  const primaryFreshness = worstFreshness([freshness.credentials, freshness.traffic]);
  const primaryStatuses = useMemo(
    () => [sources.credentials, sources.traffic],
    [sources.credentials, sources.traffic]
  );
  const primaryReceivedAt = oldestReceipt([sources.credentials, sources.traffic]);
  const hasData = sources.credentials.receivedAt !== null || sources.traffic.receivedAt !== null;

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
  const verdict = deriveVerdict({
    connectionStatus,
    attention,
    primaryFreshness,
    hasData,
    trafficTotal: traffic.total,
  });
  const verdictTitle = useVerdictTitle(verdict);
  /* The status period breathes only while steady traffic is flowing and fresh. */
  const heroAlive = verdict.kind === 'good' && primaryFreshness === 'live';

  /* ---------- Labels ---------- */

  const windowMinutes = traffic.windowMinutes > 0 ? traffic.windowMinutes : DEFAULT_WINDOW_MINUTES;
  const windowLabel = useMemo(() => {
    const { hours, minutes } = splitWindowMinutes(windowMinutes);
    if (hours === 0) return t('dashboard.window_m', { minutes });
    if (minutes === 0) return t('dashboard.window_h', { hours });
    return t('dashboard.window_hm', { hours, minutes });
  }, [windowMinutes, t]);

  const heroSparkPoints = useMemo(
    () => traffic.buckets.map((bucket) => bucket.success + bucket.failed),
    [traffic.buckets]
  );

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

  /* ---------- KPI tiles ---------- */

  const successTone = toneForSuccessRate(traffic.successRate);
  const credentialTone: MeterTone = !credentials
    ? 'idle'
    : credentials.problems > 0
      ? 'warning'
      : credentials.total > 0
        ? 'good'
        : 'idle';

  const statTiles = [
    {
      key: 'success',
      label: t('dashboard.success_rate'),
      value: traffic.successRate === null ? DASH : formatPercent(traffic.successRate),
      hint:
        traffic.total > 0
          ? t('dashboard.stat_success_hint', {
              success: traffic.success.toLocaleString(),
              total: traffic.total.toLocaleString(),
              window: windowLabel,
            })
          : t('dashboard.stat_success_empty', { window: windowLabel }),
      meter: traffic.successRate,
      tone: successTone as MeterTone | undefined,
    },
    {
      key: 'credentials',
      label: t('dashboard.stat_credentials'),
      value: credentials ? credentials.total.toLocaleString() : DASH,
      hint: credentials
        ? [
            t('dashboard.stat_credentials_serving', { count: credentials.serving }),
            credentials.problems > 0
              ? t('dashboard.stat_credentials_problems', { count: credentials.problems })
              : null,
            credentials.disabled > 0
              ? t('dashboard.stat_credentials_disabled', { count: credentials.disabled })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : t('dashboard.stat_credentials_empty'),
      meter:
        credentials && credentials.total > 0
          ? (credentials.serving / credentials.total) * 100
          : null,
      tone: credentialTone as MeterTone | undefined,
    },
    {
      key: 'providerKeys',
      label: t('dashboard.stat_provider_keys'),
      value: counts.providerKeys === null ? DASH : counts.providerKeys.toLocaleString(),
      hint: t('dashboard.stat_provider_keys_hint'),
      meter: null,
      tone: undefined,
    },
    {
      key: 'models',
      label: t('dashboard.stat_models'),
      value: counts.models === null ? DASH : counts.models.toLocaleString(),
      hint: t('dashboard.stat_models_hint'),
      meter: null,
      tone: undefined,
      stamp: <SourceStamp sources={[sources.models]} freshness={freshness.models} now={now} />,
    },
  ];

  const runtimeRows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: t('dashboard.runtime_routing'), value: routingStrategy },
    {
      label: t('dashboard.runtime_retry'),
      value: config ? String(config.requestRetry ?? 0) : DASH,
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
  const usageSupported = !(usage?.enabled === null && freshness.usage === 'live');

  return (
    <div className={styles.page}>
      <div className={styles.ambient} aria-hidden="true">
        <span className={styles.washTop} />
        <span className={styles.gridWash} />
      </div>

      {/* ---------- Hero ---------- */}
      <section className={styles.hero} ref={heroRef}>
        <div className={styles.heroCopy}>
          <h1 className={styles.heroTitle} data-reveal>
            {verdictTitle}
            <span
              className={`${styles.heroPeriod} ${heroAlive ? styles.heroPeriodLive : ''}`}
              style={{ color: TONE_ACCENTS[verdict.tone] }}
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
                    sources={primaryStatuses}
                    freshness={primaryFreshness}
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
        </div>

        <div className={styles.heroPanel} data-reveal="scale">
          <div className={styles.heroPanelTop}>
            <span className={styles.heroPanelLabel}>{t('dashboard.hero_requests_label')}</span>
          </div>
          <strong className={styles.heroFigure}>
            {connected && hasData ? formatHeadline(animatedTotal) : DASH}
          </strong>
          <span className={styles.heroPanelMeta}>
            {t('dashboard.hero_window_meta', { window: windowLabel })}
          </span>
          {traffic.total > 0 && (
            <div className={styles.ratioBar} aria-hidden="true">
              {traffic.success > 0 && (
                <span
                  className={`${styles.ratioSegment} ${styles.splitSuccess}`}
                  style={{ flexGrow: traffic.success }}
                />
              )}
              {traffic.failed > 0 && (
                <span
                  className={`${styles.ratioSegment} ${styles.splitFailure}`}
                  style={{ flexGrow: traffic.failed }}
                />
              )}
            </div>
          )}
          <div className={styles.heroSplit}>
            <span className={styles.heroSplitItem}>
              <i className={`${styles.splitSwatch} ${styles.splitSuccess}`} aria-hidden="true" />
              {t('stats.success')}
              <b>{traffic.success.toLocaleString()}</b>
            </span>
            <span className={styles.heroSplitItem}>
              <i className={`${styles.splitSwatch} ${styles.splitFailure}`} aria-hidden="true" />
              {t('stats.failure')}
              <b>{traffic.failed.toLocaleString()}</b>
            </span>
          </div>
        </div>

        <div className={styles.heroWire}>
          <LiveWire
            points={heroSparkPoints}
            ariaLabel={t('dashboard.hero_spark_label', { window: windowLabel })}
          />
        </div>
      </section>

      {/* ---------- Attention ---------- */}
      {connected && (
        <AttentionPanel
          items={attention}
          checkedCredentials={credentials?.total ?? 0}
          checkedProviders={providers.length}
          primaryFreshness={primaryFreshness}
          primaryReceivedAt={primaryReceivedAt}
          windowLabel={windowLabel}
          now={now}
          onRetry={retrySource}
        />
      )}

      {/* ---------- KPI ---------- */}
      <section className={styles.statsRow} ref={statsRef} aria-label={t('dashboard.stats_aria')}>
        {statTiles.map((tile) => (
          <article
            key={tile.key}
            className={styles.statTile}
            data-reveal
            style={
              {
                // Only exceptions colour the tile accent; healthy tiles stay neutral.
                '--tile-accent':
                  tile.tone === 'warning' || tile.tone === 'critical'
                    ? TONE_ACCENTS[tile.tone]
                    : 'var(--border-hover)',
              } as React.CSSProperties
            }
          >
            <span className={styles.statLabel}>{tile.label}</span>
            <strong className={styles.statValue}>{tile.value}</strong>
            {tile.meter !== null && tile.meter !== undefined && (
              <Meter
                value={tile.meter}
                tone={tile.tone}
                ariaLabel={tile.label}
                className={styles.statMeter}
              />
            )}
            <span className={styles.statHint}>{tile.hint}</span>
            {'stamp' in tile && tile.stamp}
          </article>
        ))}
      </section>

      {/* ---------- Traffic ---------- */}
      <section className={styles.section} ref={trafficRef}>
        <header className={styles.sectionHead}>
          <span className={styles.eyebrow}>{t('dashboard.traffic_eyebrow')}</span>
          <h2 className={styles.sectionTitle}>{t('dashboard.traffic_title')}</h2>
          <p className={styles.sectionDescription}>
            {traffic.startMs !== null && traffic.endMs !== null
              ? t('dashboard.traffic_description', {
                  start: formatClock(traffic.startMs, i18n.language),
                  zone: timeZoneLabel,
                })
              : t('dashboard.traffic_description_empty')}
          </p>
          <SourceStamp sources={primaryStatuses} freshness={primaryFreshness} now={now} />
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
            <SourceStamp
              sources={[sources.credentials]}
              freshness={freshness.credentials}
              now={now}
            />
          </div>
          <Link to="/oauth" className={styles.sectionLink}>
            {t('dashboard.health_add')} <span aria-hidden="true">→</span>
          </Link>
        </header>
        <div className={styles.panel}>
          <CredentialList credentials={credentials} now={now} />
        </div>
      </section>

      {/* ---------- Usage + runtime ---------- */}
      <section
        className={`${styles.detailGrid} ${usageSupported ? '' : styles.detailGridSingle}`}
        ref={detailRef}
      >
        {usageSupported && (
          <div className={styles.panel} data-reveal>
            <header className={styles.panelHead}>
              <span className={styles.eyebrow}>{t('dashboard.usage_eyebrow')}</span>
              <h2 className={styles.panelTitle}>{t('dashboard.usage_title')}</h2>
              <SourceStamp sources={[sources.usage]} freshness={freshness.usage} now={now} />
            </header>
            <UsagePanel
              usage={usage}
              windowStartMs={traffic.startMs ?? now - windowMinutes * 60_000}
              windowLabel={windowLabel}
              credentialsByIndex={credentialsByIndex}
            />
          </div>
        )}

        <div className={styles.panel} data-reveal>
          <header className={styles.panelHead}>
            <span className={styles.eyebrow}>{t('dashboard.runtime_eyebrow')}</span>
            <h2 className={styles.panelTitle}>{t('dashboard.runtime_title')}</h2>
            <SourceStamp sources={[sources.config]} freshness={freshness.config} now={now} />
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
