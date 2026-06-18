import { useEffect, useRef, useSyncExternalStore } from 'react';
import * as echarts from 'echarts';
import {
  getMentalScaleStatusSnapshot,
  subscribeMentalScaleStatus,
} from './mentalScaleStatus';
import styles from './GlobalMentalScalePanel.module.css';

export default function GlobalMentalScalePanel() {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const status = useSyncExternalStore(
    subscribeMentalScaleStatus,
    getMentalScaleStatusSnapshot,
    getMentalScaleStatusSnapshot,
  );

  useEffect(() => {
    if (!chartRef.current) {
      return undefined;
    }

    const chart = echarts.init(chartRef.current);
    chartInstanceRef.current = chart;

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize, { passive: true });

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartInstanceRef.current;

    if (!chart) {
      return;
    }

    chart.setOption({
      animationDuration: 520,
      animationEasing: 'cubicOut',
      color: ['#df0203'],
      radar: {
        radius: '68%',
        center: ['50%', '52%'],
        indicator: status.dimensions.map((dimension) => ({
          name: dimension.label,
          max: 100,
        })),
        axisName: {
          color: 'rgba(44, 34, 24, 0.72)',
          fontSize: 12,
          fontWeight: 700,
        },
        axisLine: {
          lineStyle: {
            color: 'rgba(44, 34, 24, 0.16)',
          },
        },
        splitLine: {
          lineStyle: {
            color: 'rgba(44, 34, 24, 0.12)',
          },
        },
        splitArea: {
          areaStyle: {
            color: [
              'rgba(255, 255, 255, 0.38)',
              'rgba(245, 240, 235, 0.28)',
            ],
          },
        },
      },
      series: [
        {
          type: 'radar',
          data: [
            {
              value: status.dimensions.map((dimension) => dimension.value),
              name: 'Mental state',
              areaStyle: {
                color: 'rgba(223, 2, 3, 0.18)',
              },
              lineStyle: {
                color: '#df0203',
                width: 2,
              },
              symbol: 'circle',
              symbolSize: 6,
              itemStyle: {
                color: '#df0203',
                borderColor: '#f5f0eb',
                borderWidth: 2,
              },
            },
          ],
        },
      ],
      tooltip: {
        trigger: 'item',
        borderWidth: 0,
        backgroundColor: 'rgba(44, 34, 24, 0.92)',
        textStyle: {
          color: '#f5f0eb',
          fontSize: 12,
          fontWeight: 700,
        },
        valueFormatter: (value: number) => `${value}%`,
      },
    });
  }, [status.dimensions]);

  const primaryDimension = status.dimensions.reduce((strongest, dimension) => (
    dimension.value > strongest.value ? dimension : strongest
  ), status.dimensions[0]);

  const updatedLabel = status.updatedAt
    ? new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(status.updatedAt))
    : 'Baseline';

  return (
    <aside className={styles.panel} aria-label="Global mental scale status">
      <div className={styles.header}>
        <span className={styles.eyebrow}>Mental Scale</span>
        <h2 className={styles.headline}>Emotion Radar</h2>
        <p className={styles.summary}>
          {status.lastScaleTitle} · {updatedLabel}
        </p>
      </div>

      <div className={styles.chartWrap}>
        <div
          ref={chartRef}
          className={styles.radar}
          role="img"
          aria-label="Six dimension mental state radar chart"
        />
      </div>

      <div className={styles.focusCard}>
        <span>Highest signal</span>
        <strong>{primaryDimension.label} {primaryDimension.value}%</strong>
        <p>{primaryDimension.description}</p>
      </div>

      <div className={styles.metrics}>
        {status.dimensions.map((dimension) => (
          <div className={styles.metric} key={dimension.key}>
            <div className={styles.metricHead}>
              <span>{dimension.label}</span>
              <strong>{dimension.value}%</strong>
            </div>
            <span className={styles.track} aria-hidden="true">
              <span style={{ width: `${dimension.value}%` }} />
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
