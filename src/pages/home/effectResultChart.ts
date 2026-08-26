// On-demand ECharts registration for the effect-result bar chart, mirroring
// radarChart.ts: registering only what this chart needs keeps the shared
// vendor chunk small (GridComponent brings the category/value axes).
import { BarChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export default echarts;
