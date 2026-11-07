import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { TimeSeriesChart } from '@/components/ui/TimeSeriesChart';
import { useNow } from '@/hooks/useNow';
import { useAuthStore, useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';
import { classifyQuotaFiles } from '@/features/quota/logic';
import { getQuotaDataAdapter } from '@/features/quota/providers/registry';
import {
  buildAccountSeries,
  buildGlanceRows,
  resetMarkers,
} from '@/features/quota/quotaAccountSeries';
import { QuotaGlanceList } from '@/features/quota/components/QuotaGlanceList';
import {
  quotaAccountLabel,
  quotaTickFormat,
  quotaTimeFormat,
  quotaTimeZoneLabel,
} from '@/features/quota/quotaChartFormat';
import { formatSeriesNumbers, resolveSeriesStrokes } from '@/components/ui/TimeSeriesChart.model';
import {
  observableQuotaEntries,
  resolveQuotaEntryCheck,
  resolveQuotaRefreshTargets,
} from '@/features/quota/refreshScope';
import styles from './QuotaSummaryChart.module.scss';
import { chart } from '@/design-system';

/** Rows shown on the dashboard; Quota Management lists every account. */
const DASHBOARD_ROW_LIMIT = 6;

interface QuotaSummaryChartProps {
  files: readonly AuthFileItem[];
  /** An accepted credentials snapshot from the current dashboard connection. */
  filesReady: boolean;
}

export function QuotaSummaryChart({ files, filesReady }: QuotaSummaryChartProps) {
  const generation = useQuotaStore((state) => state.cacheGeneration);
  // Login/logout invalidate this generation. A previous batch must not block the new connection.
  return (
    <QuotaSummaryChartContent
      key={generation}
      files={files}
      filesReady={filesReady}
      generation={generation}
    />
  );
}

function QuotaSummaryChartContent({
  files,
  filesReady,
  generation,
}: QuotaSummaryChartProps & { generation: number }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const entries = useMemo(
    () => (connected ? classifyQuotaFiles([...files]) : []),
    [connected, files]
  );
  const observableEntries = useMemo(() => observableQuotaEntries(entries), [entries]);
  const quotas = useQuotaStore(
    useShallow((state) =>
      observableEntries.map(
        (entry) =>
          getQuotaDataAdapter(entry.type).storeSelector(state)[getQuotaCacheKey(entry.file)]
      )
    )
  );
  const { batchLoading, loadQuota } = useQuotaBatchLoader();
  const checkedGeneration = useRef<number | null>(null);

  useEffect(() => {
    const targets = resolveQuotaEntryCheck(
      checkedGeneration.current,
      !filesReady,
      {
        sessionGeneration: useQuotaStore.getState().cacheGeneration,
        filesGeneration: filesReady ? generation : null,
        hasError: false,
        disabled: !connected || useAuthStore.getState().connectionStatus !== 'connected',
      },
      entries
    );
    if (targets === null) return;
    checkedGeneration.current = generation;
    void loadQuota(targets);
  }, [connected, entries, filesReady, generation, loadQuota]);

  // The shared minute clock expires old windows. It never triggers a quota request.
  const now = useNow();
  const end = now + 7 * 86_400_000;
  const [seriesNumbers, setSeriesNumbers] = useState<ReadonlyMap<string, number>>(() => new Map());
  const numbers = useMemo(() => {
    const next = new Map(seriesNumbers);
    entries.forEach((entry) => {
      const key = `${entry.type}:${getQuotaCacheKey(entry.file)}`;
      if (!next.has(key)) next.set(key, next.size + 1);
    });
    return next.size === seriesNumbers.size ? seriesNumbers : next;
  }, [entries, seriesNumbers]);
  useEffect(() => setSeriesNumbers(numbers), [numbers]);
  const model = useMemo(() => {
    const snapshots = new Map(observableEntries.map((entry, index) => [entry, quotas[index]]));
    return buildAccountSeries(
      observableEntries,
      (entry) => snapshots.get(entry),
      'weekly',
      now,
      end,
      numbers
    );
  }, [observableEntries, quotas, now, end, numbers]);

  const measured = model.accounts.filter((account) => account.remaining !== null);
  const series = model.series.map((item, index) => ({
    ...item,
    label: quotaAccountLabel(measured[index], t),
  }));
  const xDomain = [now, end] as const;
  const forecast = measured.length
    ? { from: now, label: t('redesign.quota.projected_from_snapshot') }
    : undefined;
  // Same stroke decision as the chart; rows show their line key only while the chart is open.
  const { strokes } = resolveSeriesStrokes(series, model.data, {
    xDomain,
    yDomain: [0, 100],
    forecast: forecast !== undefined,
  });
  const glanceRows = buildGlanceRows(model.accounts, now);
  // Least remaining first: the dashboard shows the accounts closest to running out.
  const visibleRows = glanceRows.slice(0, DASHBOARD_ROW_LIMIT);
  const [projectionOpen, setProjectionOpen] = useState(false);
  const failed = quotas.filter((quota) => quota?.status === 'error' || quota?.stale).length;
  const checking =
    batchLoading || quotas.some((quota) => quota?.refreshing || quota?.status === 'loading');
  const oldestSnapshot =
    measured.length && measured.every((account) => account.quota?.checkedAt !== undefined)
      ? Math.min(...measured.map((account) => account.quota!.checkedAt!))
      : null;
  const dateFormat = useMemo(() => quotaTimeFormat(i18n.language), [i18n.language]);
  const tickFormat = useMemo(() => quotaTickFormat(i18n.language), [i18n.language]);
  const percentFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 1 }),
    [i18n.language]
  );
  const resets = resetMarkers(model.accounts, now, end, (end - now) * 0.03);
  const status = !connected
    ? 'disconnected'
    : !filesReady
      ? 'waiting'
      : checking
        ? 'checking'
        : failed
          ? 'failed'
          : measured.length
            ? 'snapshots'
            : observableEntries.length
              ? 'no_data'
              : 'no_eligible';

  const refresh = () => {
    const targets = resolveQuotaRefreshTargets(
      { sessionGeneration: generation, scope: 'all' },
      {
        sessionGeneration: useQuotaStore.getState().cacheGeneration,
        filesGeneration: filesReady ? generation : null,
        hasError: false,
        disabled: useAuthStore.getState().connectionStatus !== 'connected' || checking,
      },
      entries
    );
    void loadQuota(targets);
  };

  return (
    <section className={styles.card} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div>
          <h2 id={`${id}-title`}>{t('redesign.dashboardQuota.title')}</h2>
          <p>
            {t('redesign.dashboardQuota.subtitle')} ·{' '}
            {t('redesign.quota.times_in', { zone: quotaTimeZoneLabel(now) })}
          </p>
        </div>
        <RefreshButton
          onClick={refresh}
          label={t('redesign.dashboardQuota.refresh')}
          refreshing={checking}
          disabled={!connected || !filesReady || observableEntries.length === 0}
        />
      </header>
      {/* One short status line; methodology lives in the projection's reading guide. */}
      <p className={styles.status} role="status" aria-live="polite" aria-atomic="true">
        {status !== 'snapshots' && (
          <span className={failed ? styles.warning : undefined}>
            {t(`redesign.dashboardQuota.${status}`, { count: failed })}
          </span>
        )}
        {filesReady && connected && (
          <span>
            {[
              t('redesign.dashboardQuota.measured', {
                measured: measured.length,
                eligible: observableEntries.length,
              }),
              observableEntries.length > measured.length
                ? t('redesign.dashboardQuota.unmeasured', {
                    count: observableEntries.length - measured.length,
                  })
                : '',
              files.length > observableEntries.length
                ? t('redesign.dashboardQuota.skipped', {
                    count: files.length - observableEntries.length,
                  })
                : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </p>
      {visibleRows.length > 0 && (
        <div className={styles.accounts}>
          <QuotaGlanceList
            rows={visibleRows}
            strokes={projectionOpen ? strokes : undefined}
            formatTime={(timestamp) => dateFormat.format(timestamp)}
            formatPercent={(value) => percentFormat.format(value / 100)}
            layout="columns"
          />
          {glanceRows.length > visibleRows.length && (
            <p className={styles.more}>
              {t('redesign.dashboardQuota.lowest_shown', {
                shown: visibleRows.length,
                total: glanceRows.length,
              })}
            </p>
          )}
        </div>
      )}
      {series.length > 0 && (
        <details
          className={styles.projection}
          onToggle={(event) => setProjectionOpen(event.currentTarget.open)}
        >
          <summary>{t('redesign.dashboardQuota.show_projection')}</summary>
          {/* Mounted on demand: the plot measures its width only once the disclosure is open. */}
          {projectionOpen && (
            <TimeSeriesChart
              id={`${id}-quota`}
              data={model.data}
              series={series}
              xDomain={xDomain}
              yDomain={[0, 100]}
              forecast={forecast}
              annotations={resets.map((reset) => ({
                x: reset.atMs,
                label: reset.all
                  ? t('redesign.quota.reset_at', { time: dateFormat.format(reset.atMs) })
                  : t('redesign.quota.reset_some', {
                      numbers: formatSeriesNumbers(reset.numbers),
                      time: dateFormat.format(reset.atMs),
                    }),
              }))}
              formatX={(timestamp) => dateFormat.format(timestamp)}
              formatXTick={tickFormat}
              formatMarkerGroup={(numbers, count) =>
                t('redesign.quota.group_label', { numbers, count })
              }
              formatY={(value) => percentFormat.format(value / 100)}
              ariaLabel={t('redesign.dashboardQuota.chart_label')}
              emptyText={t(`redesign.dashboardQuota.${status}`, { count: failed })}
              height={chart.height.quotaSummary}
              compactHeight={200}
              legendPlacement="none"
              guide={
                <>
                  <p>{t('redesign.dashboardQuota.evidence')}</p>
                  <p>{t('redesign.dashboardQuota.refresh_policy')}</p>
                </>
              }
              className={styles.chart}
            />
          )}
        </details>
      )}
      <footer className={styles.footer}>
        <div>
          {oldestSnapshot !== null ? (
            <span>
              {t('redesign.dashboardQuota.oldest_snapshot')}{' '}
              <time dateTime={new Date(oldestSnapshot).toISOString()}>
                {dateFormat.format(oldestSnapshot)}
              </time>
            </span>
          ) : (
            <span>
              {t(`redesign.dashboardQuota.${measured.length ? 'unknown_time' : 'no_snapshot'}`)}
            </span>
          )}
        </div>
        <Link to="/quota">{t('redesign.dashboardQuota.open_quota')} →</Link>
      </footer>
    </section>
  );
}
