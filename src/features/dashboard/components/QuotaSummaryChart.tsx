import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/Button';
import { TimeSeriesChart } from '@/components/ui/TimeSeriesChart';
import { useNow } from '@/hooks/useNow';
import { useAuthStore, useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';
import { classifyQuotaFiles } from '@/features/quota/logic';
import { getQuotaDataAdapter } from '@/features/quota/providers/registry';
import { buildAccountSeries } from '@/features/quota/quotaAccountSeries';
import {
  observableQuotaEntries,
  resolveQuotaEntryCheck,
  resolveQuotaRefreshTargets,
} from '@/features/quota/refreshScope';
import styles from './QuotaSummaryChart.module.scss';

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
  const series = model.series.map((item, index) => {
    const account = measured[index];
    const windowLabel = account.window
      ? t(account.window.label, { defaultValue: account.window.label })
      : '';
    return {
      ...item,
      label: [
        item.label,
        windowLabel,
        account.quota?.stale ? t('redesign.dashboardQuota.stale') : '',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  });
  const failed = quotas.filter((quota) => quota?.status === 'error' || quota?.stale).length;
  const checking =
    batchLoading || quotas.some((quota) => quota?.refreshing || quota?.status === 'loading');
  const oldestSnapshot =
    measured.length && measured.every((account) => account.quota?.checkedAt !== undefined)
      ? Math.min(...measured.map((account) => account.quota!.checkedAt!))
      : null;
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      }),
    [i18n.language]
  );
  const percentFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 1 }),
    [i18n.language]
  );
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
          <p>{t('redesign.dashboardQuota.subtitle')}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={refresh}
          disabled={!connected || !filesReady || observableEntries.length === 0 || checking}
          loading={checking}
        >
          {t('redesign.dashboardQuota.refresh')}
        </Button>
      </header>
      <div className={styles.status} role="status" aria-live="polite" aria-atomic="true">
        <span className={failed ? styles.warning : undefined}>
          {t(`redesign.dashboardQuota.${status}`, { count: failed })}
        </span>
        {filesReady && connected && (
          <span>
            {t('redesign.dashboardQuota.coverage', {
              measured: measured.length,
              eligible: observableEntries.length,
              unavailable: observableEntries.length - measured.length,
              skipped: files.length - observableEntries.length,
            })}
          </span>
        )}
      </div>
      <TimeSeriesChart
        id={`${id}-quota`}
        data={model.data}
        series={series}
        xDomain={[now, end]}
        yDomain={[0, 100]}
        formatX={(timestamp) => dateFormat.format(timestamp)}
        formatY={(value) => percentFormat.format(value / 100)}
        ariaLabel={t('redesign.dashboardQuota.chart_label')}
        emptyText={t(`redesign.dashboardQuota.${status}`, { count: failed })}
        description={t('redesign.dashboardQuota.evidence')}
        height={224}
        className={styles.chart}
      />
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
          <span>{t('redesign.dashboardQuota.refresh_policy')}</span>
        </div>
        <Link to="/quota">{t('redesign.dashboardQuota.open_quota')} →</Link>
      </footer>
    </section>
  );
}
