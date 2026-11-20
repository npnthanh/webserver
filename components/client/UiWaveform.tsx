"use client";

import { useMemo } from "react";
import { SampleTrendChart } from "@/components/client/SampleTrendChart";
import { ChartParamEmpty } from "@/components/client/ChartParamEmpty";
import { SectionChecks, useSectionSeries } from "@/components/client/ChartSectionChecks";
import { sectionSeries, type ChartParameterConfig } from "@/lib/chart-parameters";
import type { ChartSample } from "@/lib/gateway-series";
import type { TimeFilterValue } from "./TimeFilterBar";

/** Điện áp pha (U_Ph1..3, U_Ph_avg) / Điện áp dây (U_L12..31): tích một hoặc nhiều nhóm. */
const VOLTAGE_SECTIONS = ["v_phase", "v_line"];

export function UiWaveform({
  samples,
  onRefresh,
  chartParams,
}: {
  timeFilter?: TimeFilterValue;
  samples?: ChartSample[];
  onRefresh?: () => void;
  /** Cấu hình → Tham số biểu đồ. */
  chartParams?: ChartParameterConfig;
}) {
  const voltage = useSectionSeries("ui", VOLTAGE_SECTIONS, chartParams);
  const currentSeries = useMemo(() => sectionSeries("ui", "current", chartParams), [chartParams]);

  return (
    <div className="space-y-4">
      {voltage.modes.length ? (
        <SampleTrendChart
          title="Điện áp"
          unitLabel={voltage.unitLabel || "V"}
          series={voltage.series}
          samples={samples}
          onRefresh={onRefresh}
          startAtZero
          headerControls={
            <SectionChecks modes={voltage.modes} selectedIds={voltage.selectedIds} onToggle={voltage.toggle} />
          }
        />
      ) : (
        <ChartParamEmpty title="Điện áp" />
      )}

      {currentSeries.length ? (
        <SampleTrendChart
          title={`Dòng điện (${currentSeries.map((item) => item.key).join(", ")})`}
          unitLabel="A"
          series={currentSeries}
          samples={samples}
          onRefresh={onRefresh}
          startAtZero
        />
      ) : (
        <ChartParamEmpty title="Dòng điện" />
      )}
    </div>
  );
}
