import { useCallback, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { exportEffectReport } from '../../mentalScale/scaleRecordsApi';
import { describeFriendlyError } from '../../ui/friendlyError';
import {
  buildBatchReportPayload,
  buildComparisonReportPayload,
  buildSingleReportPayload,
  suggestReportFileName,
  type ExportReportFormat,
} from './effectReportExport';

/**
 * Report-export flow for the effect-evaluation page: single-run, batch, and
 * cross-condition comparison exports ride the shared save dialog +
 * backend command, with one shared busy flag and a dismissible notice.
 * Extracted from the page so the dialog choreography is testable and the
 * page keeps only the wiring of its buttons.
 */

export type EffectExportNotice = { severity: 'success' | 'error'; text: string };

export function useEffectReportExports(options: {
  subjectId: string;
  emotion: string;
  baselineRecordId: string | null;
  postRecordId: string | null;
}) {
  const { subjectId, emotion, baselineRecordId, postRecordId } = options;
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<EffectExportNotice | null>(null);

  const runSingleExport = useCallback(async (format: ExportReportFormat) => {
    setExportNotice(null);
    setIsExporting(true);

    try {
      const path = await save({
        title: format === 'csv' ? '导出单次报告（CSV）' : '导出单次报告（JSON）',
        defaultPath: suggestReportFileName({ kind: 'single', format, subjectId }),
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });

      if (typeof path !== 'string') {
        return;
      }

      const result = await exportEffectReport(buildSingleReportPayload({
        baselineRecordId, postRecordId, path, format,
      }));
      setExportNotice({ severity: 'success', text: `单次报告已导出：${result.path}` });
    } catch (error) {
      setExportNotice({ severity: 'error', text: describeFriendlyError(error, '导出单次报告') });
    } finally {
      setIsExporting(false);
    }
  }, [baselineRecordId, postRecordId, subjectId]);

  const runBatchExport = async () => {
    setExportNotice(null);
    setIsExporting(true);

    try {
      const path = await save({
        title: '批量汇总导出（所有被试最近一次评价）',
        defaultPath: suggestReportFileName({ kind: 'batch' }),
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });

      if (typeof path !== 'string') {
        return;
      }

      const result = await exportEffectReport(buildBatchReportPayload({ path }));
      setExportNotice({ severity: 'success', text: `批量汇总已导出：${result.path}` });
    } catch (error) {
      setExportNotice({ severity: 'error', text: describeFriendlyError(error, '导出批量汇总') });
    } finally {
      setIsExporting(false);
    }
  };

  // R7, 大纲 6.3 步骤 5: the cross-condition comparison document (both legs'
  // trace, per-dimension inputs, verdict, frozen formula note). The backend
  // re-pairs the two legs from the wizard's subject+emotion at export time.
  const runComparisonExport = useCallback(async (format: ExportReportFormat) => {
    setExportNotice(null);
    setIsExporting(true);

    try {
      const path = await save({
        title: format === 'csv' ? '导出跨条件对比报告（CSV）' : '导出跨条件对比报告（JSON）',
        defaultPath: suggestReportFileName({ kind: 'comparison', format, subjectId }),
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });

      if (typeof path !== 'string') {
        return;
      }

      const result = await exportEffectReport(buildComparisonReportPayload({
        subjectId, emotion, path, format,
      }));
      setExportNotice({ severity: 'success', text: `跨条件对比报告已导出：${result.path}` });
    } catch (error) {
      setExportNotice({ severity: 'error', text: describeFriendlyError(error, '导出跨条件对比报告') });
    } finally {
      setIsExporting(false);
    }
  }, [emotion, subjectId]);

  // The result/comparison cards are memoized, so every callback they
  // receive must keep a stable identity across renders.
  const handleExportSingleJson = useCallback(() => void runSingleExport('json'), [runSingleExport]);
  const handleExportSingleCsv = useCallback(() => void runSingleExport('csv'), [runSingleExport]);
  const handleExportComparisonJson = useCallback(() => void runComparisonExport('json'), [runComparisonExport]);
  const handleExportComparisonCsv = useCallback(() => void runComparisonExport('csv'), [runComparisonExport]);

  return {
    exportNotice,
    handleExportComparisonCsv,
    handleExportComparisonJson,
    handleExportSingleCsv,
    handleExportSingleJson,
    isExporting,
    runBatchExport,
    runComparisonExport,
    runSingleExport,
    setExportNotice,
  };
}
