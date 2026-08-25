// On-demand ECharts registration for the mental scale radar chart. Pulling in
// the full library costs ~1.1MB minified; registering only what this chart
// needs keeps the vendor chunk a small fraction of that. RadarChart's install
// also brings the radar coordinate system, so no extra component is required.
import { RadarChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([RadarChart, TooltipComponent, CanvasRenderer]);

export default echarts;
