import { useTranslation } from 'react-i18next';
import { TimeSeriesChart, type TimeSeriesSeries } from '@/components/ui/TimeSeriesChart';
import { formatPercent } from '@/utils/format';
import type { TrafficWindow } from '../types';
import { formatClock, formatClockRange } from '../logic/time';
import { axisMax } from '../utils';
import styles from './ThroughputChart.module.scss';

interface ThroughputChartProps {
  traffic: TrafficWindow;
}

export function ThroughputChart({ traffic }: ThroughputChartProps) {
  const { t, i18n } = useTranslation();
  const { buckets } = traffic;
  if (buckets.length === 0) {
    return (
      <div className={styles.placeholder}>
        <p className={styles.placeholderTitle}>{t('dashboard.traffic_unavailable')}</p>
        <p className={styles.placeholderHint}>{t('dashboard.traffic_unavailable_hint')}</p>
      </div>
    );
  }

  const locale = i18n.language;
  const formatCount = (value: number) => value.toLocaleString(locale);
  const series: TimeSeriesSeries[] = [
    {
      id: 'success',
      label: t('stats.success'),
      color: 'var(--chart-1)',
      legendValue: formatCount(traffic.success),
    },
    {
      id: 'failed',
      label: t('stats.failure'),
      color: 'var(--chart-4)',
      strokeDasharray: '4 4',
      legendValue: formatCount(traffic.failed),
    },
  ];
  const summary = t('dashboard.traffic_chart_summary', {
    total: traffic.total,
    success: traffic.success,
    failed: traffic.failed,
    minutes: traffic.windowMinutes,
  });

  return (
    <TimeSeriesChart
      id="dashboard-requests"
      data={buckets.map((bucket) => ({
        timestamp: bucket.startMs,
        values: { success: bucket.success, failed: bucket.failed },
      }))}
      series={series}
      xDomain={[buckets[0].startMs, buckets[buckets.length - 1].endMs]}
      yDomain={[0, axisMax(traffic.peakTotal, 4)]}
      formatX={(timestamp) => formatClock(timestamp, locale)}
      formatY={formatCount}
      ariaLabel={summary}
      emptyText={t('status_bar.no_requests')}
      height={250}
      dataTable={
        <table>
          <caption className={styles.srOnly}>{summary}</caption>
          <thead>
            <tr>
              <th scope="col">{t('dashboard.traffic_table_window')}</th>
              <th scope="col">{t('stats.success')}</th>
              <th scope="col">{t('stats.failure')}</th>
              <th scope="col">{t('dashboard.success_rate')}</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => {
              const total = bucket.success + bucket.failed;
              return (
                <tr key={bucket.startMs}>
                  <th scope="row">
                    {formatClockRange(bucket.startMs, bucket.endMs, locale)}
                    {bucket.partial ? ` · ${t('dashboard.traffic_partial')}` : ''}
                  </th>
                  <td>{formatCount(bucket.success)}</td>
                  <td>{formatCount(bucket.failed)}</td>
                  <td>{total > 0 ? formatPercent((bucket.success / total) * 100) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      }
    />
  );
}
