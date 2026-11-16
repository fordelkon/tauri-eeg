import { useCallback, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { exportEffectReport } from '../../mentalScale/scaleRecordsApi';
import { describeFriendlyError } from '../../ui/friendlyError';
import {
  buildBatchReportPayload,
  buildSingleReportPayload,
  suggestReportFileName,
  type ExportReportFormat,
} from './effectReportExport';

export type EffectExportNotice = { severity: 'success' | 'error'; text: string };

export function useEffectReportExports(options: {
  subjectId: string;
  baselineRecordId: string | null;
  postRecordId: string | null;
}) {
  const { subjectId, baselineRecordId, postRecordId } = options;
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<EffectExportNotice | null>(null);

  const runSingleExport = useCallback(
    async (format: ExportReportFormat) => {
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

        const result = await exportEffectReport(
          buildSingleReportPayload({
            baselineRecordId,
            postRecordId,
            path,
            format,
          }),
        );
        setExportNotice({ severity: 'success', text: `单次报告已导出：${result.path}` });
      } catch (error) {
        setExportNotice({ severity: 'error', text: describeFriendlyError(error, '导出单次报告') });
      } finally {
        setIsExporting(false);
      }
    },
    [baselineRecordId, postRecordId, subjectId],
  );

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

  const handleExportSingleJson = useCallback(() => void runSingleExport('json'), [runSingleExport]);
  const handleExportSingleCsv = useCallback(() => void runSingleExport('csv'), [runSingleExport]);
  return {
    exportNotice,
    handleExportSingleCsv,
    handleExportSingleJson,
    isExporting,
    runBatchExport,
    setExportNotice,
  };
}
