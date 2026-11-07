import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { TimeSeriesChart } from '@/components/ui/TimeSeriesChart';
import { useNow } from '@/hooks/useNow';
import type { ResolvedTheme } from '@/types';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import { DAY_MS, HOUR_MS, type TimelineMode } from '../quotaTimelineModel';
import { buildAccountSeries, buildGlanceRows, resetMarkers } from '../quotaAccountSeries';
import {
  quotaAccountLabel,
  quotaTickFormat,
  quotaTimeFormat,
  quotaTimeZoneLabel,
} from '../quotaChartFormat';
import {
  formatSeriesNumbers,
  nextHiddenSeries,
  resolveSeriesStrokes,
} from '@/components/ui/TimeSeriesChart.model';
import { QuotaGlanceList } from './QuotaGlanceList';
import styles from './QuotaOverview.module.scss';
import { chart } from '@/design-system';

interface QuotaOverviewProps {
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  seriesNumbers?: ReadonlyMap<string, number>;
  resolvedTheme: ResolvedTheme;
  disabled: boolean;
  canObserve: (entry: QuotaFileEntry) => boolean;
  onRefresh: (entries: QuotaFileEntry[]) => void;
  children: ReactNode;
}

type QuotaView = 'remaining' | 'accounts';

export function QuotaOverview({
  entries,
  quotaFor,
  seriesNumbers = new Map(),
  disabled,
  canObserve,
  onRefresh,
  children,
}: QuotaOverviewProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const [view, setView] = useState<QuotaView>('remaining');
  const accounts = view === 'accounts';
  const [mode, setMode] = useState<TimelineMode>('weekly');
  const [selection, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const end = now + (mode === 'weekly' ? 7 * DAY_MS : 5 * HOUR_MS);
  const model = buildAccountSeries(entries, quotaFor, mode, now, end, seriesNumbers);
  const measured = model.accounts.filter((account) => account.remaining !== null);
  const timeFormat = useMemo(() => quotaTimeFormat(i18n.language), [i18n.language]);
  const formatTime = (timestamp: number) => timeFormat.format(timestamp);
  const formatTick = useMemo(() => quotaTickFormat(i18n.language), [i18n.language]);
  const percent = (value: number) =>
    `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value)}%`;
  const resets = resetMarkers(model.accounts, now, end, (end - now) * 0.03);
  const glanceRows = buildGlanceRows(model.accounts, now);
  const series = model.series.map((item, index) => ({
    ...item,
    label: quotaAccountLabel(measured[index], t),
  }));
  const xDomain = [now, end] as const;
  const yDomain = [0, 100] as const;
  const forecast = measured.length
    ? { from: now, label: t('redesign.quota.projected_from_snapshot') }
    : undefined;
  const seriesIds = series.map((item) => item.id);
  // A selection made in the other window keeps only accounts plotted here, and never hides all.
  const kept = seriesIds.filter((id) => selection.has(id));
  const hidden: ReadonlySet<string> = kept.length < seriesIds.length ? new Set(kept) : new Set();
  // The list and the chart share one stroke decision, so the list's key matches each line.
  const { strokes } = resolveSeriesStrokes(series, model.data, {
    hidden,
    xDomain,
    yDomain,
    forecast: forecast !== undefined,
  });
  return (
    <div className={styles.overview}>
      <div className={styles.controls}>
        <div className={styles.control}>
          <span id="quota-view-label" className={styles.groupLabel}>
            {t('redesign.quota.view_label')}
          </span>
          <SegmentedControl<QuotaView>
            ariaLabelledBy="quota-view-label"
            value={view}
            onChange={setView}
            options={[
              { value: 'remaining', label: t('quota_management.pool_remaining') },
              { value: 'accounts', label: t('quota_management.pool_accounts') },
            ]}
          />
        </div>
        <div className={styles.control}>
          <span id="quota-window-label" className={styles.groupLabel}>
            {t('redesign.quota.window_label')}
          </span>
          <SegmentedControl<TimelineMode>
            ariaLabelledBy="quota-window-label"
            value={mode}
            onChange={setMode}
            options={(['weekly', 'session'] as const).map((value) => ({
              value,
              label: t(`quota_management.windows_mode_${value}`),
            }))}
          />
        </div>
      </div>
      {accounts ? (
        children
      ) : (
        <>
          <section className={styles.panel} aria-labelledby="quota-remaining-title">
            <header className={styles.panelHeader}>
              <h2 id="quota-remaining-title">{t('redesign.quota.remaining')}</h2>
              <span>{t('redesign.quota.times_in', { zone: quotaTimeZoneLabel(now) })}</span>
            </header>
            <div className={styles.glance}>
              <QuotaGlanceList
                id="quota-accounts-list"
                rows={glanceRows}
                strokes={strokes}
                formatTime={formatTime}
                formatPercent={percent}
                controls={{
                  hidden,
                  onToggle: (id) => setHidden(nextHiddenSeries(hidden, seriesIds, id)),
                  canRefresh: (account) => !disabled && canObserve(account.entry),
                  onRefresh: (account) => onRefresh([account.entry]),
                }}
              />
              <TimeSeriesChart
                id="quota-accounts"
                data={model.data}
                series={series}
                xDomain={xDomain}
                yDomain={yDomain}
                forecast={forecast}
                annotations={resets.map((reset) => ({
                  x: reset.atMs,
                  label: reset.all
                    ? t('redesign.quota.reset_at', { time: formatTime(reset.atMs) })
                    : t('redesign.quota.reset_some', {
                        numbers: formatSeriesNumbers(reset.numbers),
                        time: formatTime(reset.atMs),
                      }),
                }))}
                evidenceId="quota-accounts-list"
                formatX={formatTime}
                formatXTick={formatTick}
                formatMarkerGroup={(numbers, count) =>
                  t('redesign.quota.group_label', { numbers, count })
                }
                formatY={percent}
                ariaLabel={t('redesign.quota.remaining')}
                emptyText={t('quota_management.pool_no_window')}
                height={chart.height.quotaOverview}
                compactHeight={180}
                legendPlacement="none"
                hiddenSeries={hidden}
                onHiddenSeriesChange={setHidden}
                guide={
                  <>
                    <p>{t('redesign.quota.evidence')}</p>
                    {series.length > 1 && <p>{t('redesign.quota.isolate_hint')}</p>}
                  </>
                }
                className={styles.chart}
              />
            </div>
          </section>
          <details className={styles.details}>
            <summary>{t('quota_management.pool_account_details')}</summary>
            {children}
          </details>
        </>
      )}
    </div>
  );
}
