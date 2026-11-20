"use client";

import { useMemo } from "react";
import { SampleTrendChart } from "@/components/client/SampleTrendChart";
import { ChartParamEmpty } from "@/components/client/ChartParamEmpty";
import { SectionChecks, useSectionSeries } from "@/components/client/ChartSectionChecks";
import { sectionSeries, type ChartParameterConfig } from "@/lib/chart-parameters";
import type { ChartSample } from "@/lib/gateway-series";
import type { TimeFilterValue } from "./TimeFilterBar";

/** Mất cân bằng điện áp pha (Vuan..) / điện áp dây (Vuab..): tích một hoặc nhiều nhóm. */
const VOLTAGE_SECTIONS = ["v_phase", "v_line"];

export function UnbalanceChart({
  samples,
  onRefresh,
  chartParams,
}: {
  samples?: ChartSample[];
  timeFilter?: TimeFilterValue;
  onRefresh?: () => void;
  chartParams?: ChartParameterConfig;
}) {
  const voltage = useSectionSeries("unbalance", VOLTAGE_SECTIONS, chartParams);
  const currentSeries = useMemo(() => sectionSeries("unbalance", "current", chartParams), [chartParams]);

  return (
    <div className="space-y-4">
      {voltage.modes.length ? (
        <SampleTrendChart
          title="Mất cân bằng điện áp"
          unitLabel="%"
          series={voltage.series}
          samples={samples}
          onRefresh={onRefresh}
          startAtZero
          headerControls={
            <SectionChecks modes={voltage.modes} selectedIds={voltage.selectedIds} onToggle={voltage.toggle} />
          }
        />
      ) : (
        <ChartParamEmpty title="Mất cân bằng điện áp" />
      )}

      {currentSeries.length ? (
        <SampleTrendChart
          title={`Mất cân bằng dòng điện (${currentSeries.map((item) => item.key).join(", ")})`}
          unitLabel="%"
          series={currentSeries}
          samples={samples}
          onRefresh={onRefresh}
          startAtZero
        />
      ) : (
        <ChartParamEmpty title="Mất cân bằng dòng điện" />
      )}
    </div>
  );
}
