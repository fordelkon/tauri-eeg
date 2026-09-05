import { useEffect, useRef, useState } from 'react';
import type { EChartsType } from 'echarts/core';
import styles from './EffectEvaluation.module.css';

/**
 * Bar chart for the baseline/post comparison; echarts loads on demand.
 * Extracted verbatim from the result cards so both cards share one mount
 * implementation while every file stays under the 500-line budget. (The
 * echarts entry module itself remains `effectResultChart.ts`; this file's
 * name differs in more than casing to keep case-insensitive filesystems
 * unambiguous.)
 */
export function EffectResultChart({
  option,
  ariaLabel,
}: {
  option: Record<string, unknown>;
  ariaLabel?: string;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<EChartsType | null>(null);
  const [isChartReady, setIsChartReady] = useState(false);

  useEffect(() => {
    if (!chartRef.current) {
      return undefined;
    }

    const host = chartRef.current;
    let cancelled = false;
    let frameHandle: number | null = null;
    let resizeCleanup: (() => void) | undefined;

    void import('./effectResultChart').then(({ default: echarts }) => {
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
    if (!isChartReady) {
      return;
    }

    chartInstanceRef.current?.setOption(option, true);
  }, [isChartReady, option]);

  return (
    <div className={styles.chartWrap}>
      {/* ECharts hosts on the inner box: zrender sizes the canvas from
          clientWidth/Height and starts it in the content box, so the padded,
          bordered frame must sit outside the chart element itself. */}
      <div
        ref={chartRef}
        className={styles.chartCanvas}
        role="img"
        aria-label={ariaLabel ?? '基线与调控后量表得分对比图'}
      />
    </div>
  );
}
