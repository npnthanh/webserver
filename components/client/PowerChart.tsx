"use client";

import { SampleTrendChart, TREND_FILL_HEIGHT } from "@/components/client/SampleTrendChart";
import { ChartParamEmpty } from "@/components/client/ChartParamEmpty";
import { SectionChecks, useSectionSeries } from "@/components/client/ChartSectionChecks";
import type { ChartParameterConfig } from "@/lib/chart-parameters";
import type { ChartSample } from "@/lib/gateway-series";
import type { TimeFilterValue } from "./TimeFilterBar";

/** Công suất tác dụng P / phản kháng Q / biểu kiến S: tích một hoặc nhiều nhóm. */
const POWER_SECTIONS = ["P", "Q", "S"];
/** Hệ số công suất PF / hệ số công suất dịch pha DPF. */
const FACTOR_SECTIONS = ["PF", "DPF"];

/** Biểu đồ hệ số công suất PF / DPF (tab "Hệ số công suất"). */
export function PowerFactorChart({
  samples,
  onRefresh,
  chartParams,
}: {
  timeFilter?: TimeFilterValue;
  samples?: ChartSample[];
  onRefresh?: () => void;
  chartParams?: ChartParameterConfig;
}) {
  const factor = useSectionSeries("pf", FACTOR_SECTIONS, chartParams);
  if (!factor.modes.length) return <ChartParamEmpty title="Hệ số công suất (PF / DPF)" />;

  return (
    <SampleTrendChart
      title="Hệ số công suất (PF / DPF)"
      unitLabel="cosφ"
      series={factor.series}
      samples={samples}
      onRefresh={onRefresh}
      heightClass={TREND_FILL_HEIGHT}
      headerControls={
        <SectionChecks modes={factor.modes} selectedIds={factor.selectedIds} onToggle={factor.toggle} />
      }
    />
  );
}

export function PowerChart({
  samples,
  onRefresh,
  chartParams,
}: {
  timeFilter?: TimeFilterValue;
  samples?: ChartSample[];
  onRefresh?: () => void;
  chartParams?: ChartParameterConfig;
}) {
  const power = useSectionSeries("power", POWER_SECTIONS, chartParams);
  if (!power.modes.length) return <ChartParamEmpty title="Công suất tức thời" />;

  return (
    <div className="space-y-4">
      <SampleTrendChart
        title="Công suất tức thời"
        unitLabel={power.unitLabel || "kW"}
        series={power.series}
        samples={samples}
        onRefresh={onRefresh}
        heightClass={TREND_FILL_HEIGHT}
        headerControls={
          <SectionChecks modes={power.modes} selectedIds={power.selectedIds} onToggle={power.toggle} />
        }
      />
    </div>
  );
}
