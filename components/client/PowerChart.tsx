"use client";

import { useMemo, useState } from "react";
import { SampleTrendChart, type TrendSeriesConfig } from "@/components/client/SampleTrendChart";
import { CustomSelect } from "@/components/ui/CustomSelect";
import type { ChartSample } from "@/lib/gateway-series";
import type { TimeFilterValue } from "./TimeFilterBar";

type PowerGroup = "P" | "Q" | "S";
type FactorGroup = "PF" | "DPF";

/** Biểu đồ hệ số công suất PF / DPF — dùng trong tab "Công suất" và tab riêng "Hệ số công suất". */
export function PowerFactorChart({
  samples,
  onRefresh,
}: {
  samples?: ChartSample[];
  onRefresh?: () => void;
}) {
  const [fGroup, setFGroup] = useState<FactorGroup>("PF");

  const factorSeries = useMemo<TrendSeriesConfig[]>(() => {
    if (fGroup === "PF") {
      return [
        { key: "PFa", label: "PF_Ph1 (PFa)", color: "#5470c6", digits: 3 },
        { key: "PFb", label: "PF_Ph2 (PFb)", color: "#91cc75", digits: 3 },
        { key: "PFc", label: "PF_Ph3 (PFc)", color: "#fac858", digits: 3 },
        { key: "PFt", label: "PF_Total (PFt)", color: "#ee6666", digits: 3 },
      ];
    }
    return [
      { key: "DPFa", label: "DPF_Ph1 (DPFa)", color: "#5470c6", digits: 3 },
      { key: "DPFb", label: "DPF_Ph2 (DPFb)", color: "#91cc75", digits: 3 },
      { key: "DPFc", label: "DPF_Ph3 (DPFc)", color: "#fac858", digits: 3 },
      { key: "DPFt", label: "DPF_Total (DPFt)", color: "#ee6666", digits: 3 },
    ];
  }, [fGroup]);

  return (
    <SampleTrendChart
      title="Hệ số công suất (PF / DPF)"
      unitLabel="cosφ"
      series={factorSeries}
      samples={samples}
      onRefresh={onRefresh}
      headerControls={
        <CustomSelect
          value={fGroup}
          onChange={(e) => setFGroup(e.target.value as FactorGroup)}
          className="h-8 min-w-[220px] rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500"
        >
          <option value="PF">Hệ số công suất PF (PFa, PFb, PFc, PFt)</option>
          <option value="DPF">Hệ số công suất dịch pha DPF (DPFa, DPFb, DPFc, DPFt)</option>
        </CustomSelect>
      }
    />
  );
}

export function PowerChart({
  samples,
  onRefresh,
}: {
  timeFilter: TimeFilterValue;
  samples?: ChartSample[];
  onRefresh?: () => void;
}) {
  const [pGroup, setPGroup] = useState<PowerGroup>("P");

  const powerSeries = useMemo<TrendSeriesConfig[]>(() => {
    if (pGroup === "P") {
      return [
        { key: "Papa", label: "P_Ph1 (Papa)", color: "#5470c6", unit: "kW", digits: 3 },
        { key: "Papb", label: "P_Ph2 (Papb)", color: "#91cc75", unit: "kW", digits: 3 },
        { key: "Papc", label: "P_Ph3 (Papc)", color: "#fac858", unit: "kW", digits: 3 },
        { key: "Papt", label: "P_Total (Papt)", color: "#ee6666", unit: "kW", digits: 3 },
      ];
    }
    if (pGroup === "Q") {
      return [
        { key: "Qrpa", label: "Q_Ph1 (Qrpa)", color: "#5470c6", unit: "kVAR", digits: 3 },
        { key: "Qrpb", label: "Q_Ph2 (Qrpb)", color: "#91cc75", unit: "kVAR", digits: 3 },
        { key: "Qrpc", label: "Q_Ph3 (Qrpc)", color: "#fac858", unit: "kVAR", digits: 3 },
        { key: "Qrpt", label: "Q_Total (Qrpt)", color: "#ee6666", unit: "kVAR", digits: 3 },
      ];
    }
    return [
      { key: "Sapa", label: "S_Ph1 (Sapa)", color: "#5470c6", unit: "kVA", digits: 3 },
      { key: "Sapb", label: "S_Ph2 (Sapb)", color: "#91cc75", unit: "kVA", digits: 3 },
      { key: "Sapc", label: "S_Ph3 (Sapc)", color: "#fac858", unit: "kVA", digits: 3 },
      { key: "Sapt", label: "S_Total (Sapt)", color: "#ee6666", unit: "kVA", digits: 3 },
    ];
  }, [pGroup]);

  const powerUnit = pGroup === "P" ? "kW" : pGroup === "Q" ? "kVAR" : "kVA";

  return (
    <div className="space-y-4">
      <SampleTrendChart
        title="Công suất tức thời"
        unitLabel={powerUnit}
        series={powerSeries}
        samples={samples}
        onRefresh={onRefresh}
        headerControls={
          <CustomSelect
            value={pGroup}
            onChange={(e) => setPGroup(e.target.value as PowerGroup)}
            className="h-8 min-w-[220px] rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500"
          >
            <option value="P">Công suất tác dụng P (Papa, Papb, Papc, Papt)</option>
            <option value="Q">Công suất phản kháng Q (Qrpa, Qrpb, Qrpc, Qrpt)</option>
            <option value="S">Công suất biểu kiến S (Sapa, Sapb, Sapc, Sapt)</option>
          </CustomSelect>
        }
      />

      <PowerFactorChart samples={samples} onRefresh={onRefresh} />
    </div>
  );
}
