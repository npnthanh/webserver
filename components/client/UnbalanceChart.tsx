"use client";

import { useMemo, useState } from "react";
import { SampleTrendChart, type TrendSeriesConfig } from "@/components/client/SampleTrendChart";
import { CustomSelect } from "@/components/ui/CustomSelect";
import type { ChartSample } from "@/lib/gateway-series";
import type { TimeFilterValue } from "./TimeFilterBar";

type UnbVoltageMode = "phase" | "line";

export function UnbalanceChart({
  samples,
  onRefresh,
}: {
  samples?: ChartSample[];
  timeFilter?: TimeFilterValue;
  onRefresh?: () => void;
}) {
  const [vMode, setVMode] = useState<UnbVoltageMode>("phase");

  const vSeries = useMemo<TrendSeriesConfig[]>(() => {
    if (vMode === "phase") {
      return [
        { key: "Vuan", label: "U_unb_Ph1 (Vuan)", color: "#5470c6", unit: "%", digits: 2 },
        { key: "Vubn", label: "U_unb_Ph2 (Vubn)", color: "#91cc75", unit: "%", digits: 2 },
        { key: "Vucn", label: "U_unb_Ph3 (Vucn)", color: "#fac858", unit: "%", digits: 2 },
      ];
    }
    return [
      { key: "Vuab", label: "U_unb_L12 (Vuab)", color: "#5470c6", unit: "%", digits: 2 },
      { key: "Vubc", label: "U_unb_L23 (Vubc)", color: "#91cc75", unit: "%", digits: 2 },
      { key: "Vuca", label: "U_unb_L31 (Vuca)", color: "#fac858", unit: "%", digits: 2 },
    ];
  }, [vMode]);

  const iSeries = useMemo<TrendSeriesConfig[]>(
    () => [
      { key: "IuA", label: "I_unb_Ph1 (IuA)", color: "#5470c6", unit: "%", digits: 2 },
      { key: "IuB", label: "I_unb_Ph2 (IuB)", color: "#91cc75", unit: "%", digits: 2 },
      { key: "IuC", label: "I_unb_Ph3 (IuC)", color: "#fac858", unit: "%", digits: 2 },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <SampleTrendChart
        title="Mất cân bằng điện áp"
        unitLabel="%"
        series={vSeries}
        samples={samples}
        onRefresh={onRefresh}
        startAtZero
        headerControls={
          <CustomSelect
            value={vMode}
            onChange={(e) => setVMode(e.target.value as UnbVoltageMode)}
            className="h-8 min-w-[220px] rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500"
          >
            <option value="phase">Mất cân bằng Điện áp pha (Vuan, Vubn, Vucn)</option>
            <option value="line">Mất cân bằng Điện áp dây (Vuab, Vubc, Vuca)</option>
          </CustomSelect>
        }
      />

      <SampleTrendChart
        title="Mất cân bằng dòng điện (IuA, IuB, IuC)"
        unitLabel="%"
        series={iSeries}
        samples={samples}
        onRefresh={onRefresh}
        startAtZero
      />
    </div>
  );
}
