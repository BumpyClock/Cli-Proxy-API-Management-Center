import { useTranslation } from 'react-i18next';
import type { TimeSeriesChartProps } from './TimeSeriesChart.types';
import styles from './TimeSeriesChart.module.scss';

type TimeSeriesChartTableProps = Pick<
  TimeSeriesChartProps,
  'data' | 'series' | 'formatX' | 'formatY' | 'ariaLabel'
>;

/** The disclosure mounts this only on demand. Independent series keep their own evidence rows. */
export function TimeSeriesChartTable({
  data,
  series,
  formatX,
  formatY,
  ariaLabel,
}: TimeSeriesChartTableProps) {
  const { t } = useTranslation();
  const formatValue = (value: number | null | undefined) =>
    value === null || value === undefined ? t('redesign.chart.unreported') : formatY(value);

  if (series.some((item) => item.points !== undefined)) {
    return series.map((item) => (
      <table key={item.id}>
        <caption>{item.label}</caption>
        <thead>
          <tr>
            <th scope="col">{t('redesign.chart.time')}</th>
            <th scope="col">{item.label}</th>
          </tr>
        </thead>
        <tbody>
          {(item.points ?? data).map((point, index) => (
            <tr key={`${point.timestamp}-${index}`}>
              <th scope="row">{formatX(point.timestamp)}</th>
              <td>{formatValue('values' in point ? point.values[item.id] : point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ));
  }

  return (
    <table>
      <caption className={styles.srOnly}>{ariaLabel}</caption>
      <thead>
        <tr>
          <th scope="col">{t('redesign.chart.time')}</th>
          {series.map((item) => (
            <th scope="col" key={item.id}>
              {item.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, index) => (
          <tr key={`${row.timestamp}-${index}`}>
            <th scope="row">{formatX(row.timestamp)}</th>
            {series.map((item) => (
              <td key={item.id}>{formatValue(row.values[item.id])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
