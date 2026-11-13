"use client";

import { useMemo, useState } from "react";
import { SampleTrendChart, type TrendSeriesConfig } from "@/components/client/SampleTrendChart";
import { CustomSelect } from "@/components/ui/CustomSelect";
import type { ChartSample } from "@/lib/gateway-series";
import type { TimeFilterValue } from "./TimeFilterBar";

type VoltageMode = "phase" | "line";

/** Dòng điện pha, trung bình và trung tính: một bộ duy nhất (bộ "3 pha & TB" cũ là tập con nên đã bỏ). */
const CURRENT_SERIES: TrendSeriesConfig[] = [
  { key: "Ia", label: "I_Ph1", color: "#5470c6", unit: "A", digits: 2 },
  { key: "Ib", label: "I_Ph2", color: "#91cc75", unit: "A", digits: 2 },
  { key: "Ic", label: "I_Ph3", color: "#fac858", unit: "A", digits: 2 },
  { key: "Iavg", label: "I_avg", color: "#ee6666", unit: "A", digits: 2 },
  { key: "In", label: "I_N", color: "#73c0de", unit: "A", digits: 2 },
];

export function UiWaveform({
  samples,
  onRefresh,
}: {
  timeFilter: TimeFilterValue;
  samples?: ChartSample[];
  onRefresh?: () => void;
}) {
  const [vMode, setVMode] = useState<VoltageMode>("phase");

  const voltageSeries = useMemo<TrendSeriesConfig[]>(() => {
    if (vMode === "phase") {
      return [
        { key: "Van", label: "U_Ph1", color: "#5470c6", unit: "V", digits: 2 },
        { key: "Vbn", label: "U_Ph2", color: "#91cc75", unit: "V", digits: 2 },
        { key: "Vcn", label: "U_Ph3", color: "#fac858", unit: "V", digits: 2 },
        { key: "VLNavg", label: "U_Ph_avg", color: "#ee6666", unit: "V", digits: 2 },
      ];
    }
    return [
      { key: "Vab", label: "U_L12", color: "#5470c6", unit: "V", digits: 2 },
      { key: "Vbc", label: "U_L23", color: "#91cc75", unit: "V", digits: 2 },
      { key: "Vca", label: "U_L31", color: "#fac858", unit: "V", digits: 2 },
      { key: "VLLavg", label: "U_LL_avg", color: "#ee6666", unit: "V", digits: 2 },
    ];
  }, [vMode]);

  return (
    <div className="space-y-4">
      <SampleTrendChart
        title="Điện áp"
        unitLabel="V"
        series={voltageSeries}
        samples={samples}
        onRefresh={onRefresh}
        startAtZero
        headerControls={
          <CustomSelect
            value={vMode}
            onChange={(e) => setVMode(e.target.value as VoltageMode)}
            className="h-8 min-w-[180px] rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500"
          >
            <option value="phase">Điện áp pha (U_Ph1..3, U_Ph_avg)</option>
            <option value="line">Điện áp dây (U_L12..31, U_LL_avg)</option>
          </CustomSelect>
        }
      />

      <SampleTrendChart
        title="Dòng điện pha, TB & Trung tính (Ia, Ib, Ic, Iavg, In)"
        unitLabel="A"
        series={CURRENT_SERIES}
        samples={samples}
        onRefresh={onRefresh}
        startAtZero
      />
    </div>
  );
}
