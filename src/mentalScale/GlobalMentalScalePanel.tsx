import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { EChartsType } from 'echarts/core';
import type { ReactNode } from 'react';
import {
  getMentalScaleStatusSnapshot,
  subscribeMentalScaleStatus,
} from './mentalScaleStatus';
import styles from './GlobalMentalScalePanel.module.css';

type Props = {
  children?: ReactNode;
};

const dimensionLabels: Record<string, string> = {
  anxiety: '焦虑',
  energy: '精力',
  mood: '情绪',
  worry: '担忧',
};

const scaleTitleLabels: Record<string, string> = {
  'Average Baseline': '平均基线',
  'Game Regulation Scale': '游戏调控量表',
  'Music Regulation Scale': '音乐调控量表',
  'Video Regulation Scale': '视频调控量表',
  '游戏调控量表': '游戏调控量表',
  '音乐调控量表': '音乐调控量表',
  '视频调控量表': '视频调控量表',
};

const getDimensionLabel = (key: string, fallback: string) => dimensionLabels[key] ?? fallback;
const getScaleTitleLabel = (title: string) => scaleTitleLabels[title] ?? title;

export default function GlobalMentalScalePanel({ children }: Props) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<EChartsType | null>(null);
  const [isChartReady, setIsChartReady] = useState(false);
  const status = useSyncExternalStore(
    subscribeMentalScaleStatus,
    getMentalScaleStatusSnapshot,
    getMentalScaleStatusSnapshot,
  );

  useEffect(() => {
    const host = chartRef.current;

    if (!host) {
      return undefined;
    }

    let cancelled = false;
    let frameHandle: number | null = null;
    let resizeCleanup: (() => void) | undefined;

    void import('./radarChart').then(({ default: echarts }) => {
      if (cancelled || !chartRef.current) {
        return;
      }

      const chart = echarts.init(chartRef.current);
      chartInstanceRef.current = chart;
      setIsChartReady(true);

      // ResizeObserver on the chart host with rAF-throttled resize(): unlike
      // a window resize listener it also catches layout-driven width changes
      // (e.g. a collapsible sidebar) without calling resize() per event.
      const observer = new ResizeObserver(() => {
        if (frameHandle !== null || cancelled) {
          return;
        }
        frameHandle = window.requestAnimationFrame(() => {
          frameHandle = null;
          if (!cancelled) {
            chart.resize();
          }
        });
      });
      observer.observe(host);
      resizeCleanup = () => {
        observer.disconnect();
        if (frameHandle !== null) {
          window.cancelAnimationFrame(frameHandle);
          frameHandle = null;
        }
      };
    });

    return () => {
      cancelled = true;
      resizeCleanup?.();
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartInstanceRef.current;

    if (!chart || !isChartReady) {
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
          name: getDimensionLabel(dimension.key, dimension.label),
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
              name: '心理状态',
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
  }, [isChartReady, status.dimensions]);

  const updatedLabel = status.updatedAt
    ? new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(status.updatedAt))
    : '基线';

  return (
    <aside className={styles.panel} aria-label="全局心理量表状态">
      <div className={styles.header}>
        <span className={styles.eyebrow}>心理量表</span>
        <h2 className={styles.headline}>心理状态雷达图</h2>
        <p className={styles.summary}>
          {getScaleTitleLabel(status.lastScaleTitle)} · {updatedLabel}
        </p>
      </div>

      <div className={styles.chartWrap}>
        <div
          ref={chartRef}
          className={styles.radar}
          role="img"
          aria-label="心理状态雷达图"
        />
      </div>

      {children ? <div className={styles.assistantSlot}>{children}</div> : null}
    </aside>
  );
}
