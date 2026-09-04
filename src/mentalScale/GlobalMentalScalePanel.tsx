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

/*
 * Radar palette rides the global design tokens (src/styles/tokens.css) so the
 * chart follows the brand without another hardcoded palette. Values are read
 * once at module scope; every fallback equals the token value verbatim, so a
 * not-yet-loaded stylesheet renders exactly the previous chart.
 */
const FALLBACK_BRAND = '#df0203';
const FALLBACK_INK = '#2c2218';
const FALLBACK_SURFACE = '#f5f0eb';

function readTokenColor(name: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return fallback;
  }
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function tokenRgba(tokenValue: string, fallback: string, alpha: number): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(tokenValue || fallback);
  if (!match) {
    return fallback;
  }
  const rgb = Number.parseInt(match[1], 16);
  return `rgba(${(rgb >> 16) & 255}, ${(rgb >> 8) & 255}, ${rgb & 255}, ${alpha})`;
}

const radarBrand = readTokenColor('--brand', FALLBACK_BRAND);
const radarInk = readTokenColor('--ink', FALLBACK_INK);
const radarSurface = readTokenColor('--surface', FALLBACK_SURFACE);
const radarBrandArea = tokenRgba(radarBrand, FALLBACK_BRAND, 0.18);
const radarInkAxisName = tokenRgba(radarInk, FALLBACK_INK, 0.72);
const radarInkAxisLine = tokenRgba(radarInk, FALLBACK_INK, 0.16);
const radarInkSplitLine = tokenRgba(radarInk, FALLBACK_INK, 0.12);
const radarInkTooltip = tokenRgba(radarInk, FALLBACK_INK, 0.92);
const radarSplitAreas = [
  'rgba(255, 255, 255, 0.38)',
  tokenRgba(radarSurface, FALLBACK_SURFACE, 0.28),
] as const;

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

    const startChartInit = () => {
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
    };

    // The echarts chunk (~534 KB) must not compete with Home's first paint:
    // the radar is secondary chrome, so the dynamic import waits for an idle
    // frame (setTimeout fallback where requestIdleCallback is missing). The
    // setOption effect below tolerates late readiness — it re-runs once
    // isChartReady flips true after the deferred init resolves.
    let cancelChartInit: () => void;
    if (typeof window.requestIdleCallback === 'function') {
      const idleHandle = window.requestIdleCallback(() => startChartInit());
      cancelChartInit = () => window.cancelIdleCallback(idleHandle);
    } else {
      const timeoutHandle = window.setTimeout(() => startChartInit(), 1);
      cancelChartInit = () => window.clearTimeout(timeoutHandle);
    }

    return () => {
      cancelled = true;
      cancelChartInit();
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
      color: [radarBrand],
      radar: {
        radius: '68%',
        center: ['50%', '52%'],
        indicator: status.dimensions.map((dimension) => ({
          name: getDimensionLabel(dimension.key, dimension.label),
          max: 100,
        })),
        axisName: {
          color: radarInkAxisName,
          fontSize: 12,
          fontWeight: 700,
        },
        axisLine: {
          lineStyle: {
            color: radarInkAxisLine,
          },
        },
        splitLine: {
          lineStyle: {
            color: radarInkSplitLine,
          },
        },
        splitArea: {
          areaStyle: {
            color: [...radarSplitAreas],
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
                color: radarBrandArea,
              },
              lineStyle: {
                color: radarBrand,
                width: 2,
              },
              symbol: 'circle',
              symbolSize: 6,
              itemStyle: {
                color: radarBrand,
                borderColor: radarSurface,
                borderWidth: 2,
              },
            },
          ],
        },
      ],
      tooltip: {
        trigger: 'item',
        borderWidth: 0,
        backgroundColor: radarInkTooltip,
        textStyle: {
          color: radarSurface,
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
