"use client";

import { useMemo, useState } from "react";
import { SampleTrendChart, type TrendSeriesConfig } from "@/components/client/SampleTrendChart";
import { CustomSelect } from "@/components/ui/CustomSelect";
import type { ChartSample } from "@/lib/gateway-series";
import type { TimeFilterValue } from "./TimeFilterBar";

type ThdMode = "v_phase" | "v_line" | "i";
type HarmChannelGroup = "van" | "vll" | "curr";

export function HarmonicsChart({
  samples,
  onRefresh,
}: {
  samples?: ChartSample[];
  timeFilter?: TimeFilterValue;
  onRefresh?: () => void;
}) {
  const [thdMode, setThdMode] = useState<ThdMode>("v_phase");
  const [orderGroup, setOrderGroup] = useState<HarmChannelGroup>("van");
  const [selectedOrder, setSelectedOrder] = useState<number>(3);

  const thdSeries = useMemo<TrendSeriesConfig[]>(() => {
    if (thdMode === "v_phase") {
      return [
        { key: "THDVan", label: "THD_U_Ph1 (THDVan)", color: "#5470c6", unit: "%", digits: 2 },
        { key: "THDVbn", label: "THD_U_Ph2 (THDVbn)", color: "#91cc75", unit: "%", digits: 2 },
        { key: "THDVcn", label: "THD_U_Ph3 (THDVcn)", color: "#fac858", unit: "%", digits: 2 },
        { key: "THDVln", label: "THD_U_Ph_avg (THDVln)", color: "#ee6666", unit: "%", digits: 2 },
      ];
    }
    if (thdMode === "v_line") {
      return [
        { key: "THDVab", label: "THD_U_L12 (THDVab)", color: "#5470c6", unit: "%", digits: 2 },
        { key: "THDVbc", label: "THD_U_L23 (THDVbc)", color: "#91cc75", unit: "%", digits: 2 },
        { key: "THDVca", label: "THD_U_L31 (THDVca)", color: "#fac858", unit: "%", digits: 2 },
        { key: "THDVll", label: "THD_U_LL_avg (THDVll)", color: "#ee6666", unit: "%", digits: 2 },
      ];
    }
    return [
      { key: "THDCa", label: "THD_I_Ph1 (THDCa)", color: "#5470c6", unit: "%", digits: 2 },
      { key: "THDCb", label: "THD_I_Ph2 (THDCb)", color: "#91cc75", unit: "%", digits: 2 },
      { key: "THDCc", label: "THD_I_Ph3 (THDCc)", color: "#fac858", unit: "%", digits: 2 },
      { key: "THDCn", label: "THD_I_N (THDCn)", color: "#ee6666", unit: "%", digits: 2 },
    ];
  }, [thdMode]);

  const orderSeries = useMemo<TrendSeriesConfig[]>(() => {
    const h = `H${selectedOrder}`;
    if (orderGroup === "van") {
      return [
        { key: `${h}Van`, label: `${h}_Van (Pha A-N)`, color: "#5470c6", unit: "%", digits: 2 },
        { key: `${h}Vbn`, label: `${h}_Vbn (Pha B-N)`, color: "#91cc75", unit: "%", digits: 2 },
        { key: `${h}Vcn`, label: `${h}_Vcn (Pha C-N)`, color: "#fac858", unit: "%", digits: 2 },
      ];
    }
    if (orderGroup === "vll") {
      return [
        { key: `${h}Vab`, label: `${h}_Vab (Dây A-B)`, color: "#5470c6", unit: "%", digits: 2 },
        { key: `${h}Vbc`, label: `${h}_Vbc (Dây B-C)`, color: "#91cc75", unit: "%", digits: 2 },
        { key: `${h}Vca`, label: `${h}_Vca (Dây C-A)`, color: "#fac858", unit: "%", digits: 2 },
      ];
    }
    return [
      { key: `${h}Ca`, label: `${h}_Ca (Dòng pha A)`, color: "#5470c6", unit: "%", digits: 2 },
      { key: `${h}Cb`, label: `${h}_Cb (Dòng pha B)`, color: "#91cc75", unit: "%", digits: 2 },
      { key: `${h}Cc`, label: `${h}_Cc (Dòng pha C)`, color: "#fac858", unit: "%", digits: 2 },
    ];
  }, [orderGroup, selectedOrder]);

  return (
    <div className="space-y-4">
      <SampleTrendChart
        title="Tổng biến dạng sóng hài (THD)"
        unitLabel="%"
        series={thdSeries}
        samples={samples}
        onRefresh={onRefresh}
        startAtZero
        headerControls={
          <CustomSelect
            value={thdMode}
            onChange={(e) => setThdMode(e.target.value as ThdMode)}
            className="h-8 min-w-[230px] rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500"
          >
            <option value="v_phase">THD Điện áp pha (THDVan, THDVbn, THDVcn, THDVln)</option>
            <option value="v_line">THD Điện áp dây (THDVab, THDVbc, THDVca, THDVll)</option>
            <option value="i">THD Dòng điện (THDCa, THDCb, THDCc, THDCn)</option>
          </CustomSelect>
        }
      />

      <SampleTrendChart
        title={`Sóng hài theo bậc (Bậc H${selectedOrder} — 36 tham số H3..H9)`}
        unitLabel="%"
        series={orderSeries}
        samples={samples}
        onRefresh={onRefresh}
        startAtZero
        headerControls={
          <div className="flex flex-wrap items-center gap-2">
            <CustomSelect
              value={orderGroup}
              onChange={(e) => setOrderGroup(e.target.value as HarmChannelGroup)}
              className="h-8 min-w-[200px] rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500"
            >
              <option value="van">Sóng hài Điện áp pha (Van, Vbn, Vcn)</option>
              <option value="vll">Sóng hài Điện áp dây (Vab, Vbc, Vca)</option>
              <option value="curr">Sóng hài Dòng điện (Ca, Cb, Cc)</option>
            </CustomSelect>
            <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
              {[3, 5, 7, 9].map((ord) => (
                <button
                  key={ord}
                  type="button"
                  onClick={() => setSelectedOrder(ord)}
                  className={`h-7 rounded px-2.5 text-xs font-semibold transition-colors ${
                    selectedOrder === ord
                      ? "bg-emerald-600 text-white shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Bậc H{ord}
                </button>
              ))}
            </div>
          </div>
        }
      />
    </div>
  );
}
