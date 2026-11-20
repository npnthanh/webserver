"use client";

import { useMemo, useState } from "react";
import { SampleTrendChart, type TrendSeriesConfig } from "@/components/client/SampleTrendChart";
import { ChartParamEmpty } from "@/components/client/ChartParamEmpty";
import { SectionChecks, useSectionSeries } from "@/components/client/ChartSectionChecks";
import type { ChartParameterConfig } from "@/lib/chart-parameters";
import type { ChartSample } from "@/lib/gateway-series";
import type { TimeFilterValue } from "./TimeFilterBar";

/** THD điện áp pha / điện áp dây / dòng điện: tích một hoặc nhiều nhóm. */
const THD_SECTIONS = ["v_phase", "v_line", "i"];

type HarmChannelGroup = "van" | "vll" | "curr";

const ORDER_GROUPS: { id: HarmChannelGroup; label: string }[] = [
  { id: "van", label: "Sóng hài Điện áp pha (Van, Vbn, Vcn)" },
  { id: "vll", label: "Sóng hài Điện áp dây (Vab, Vbc, Vca)" },
  { id: "curr", label: "Sóng hài Dòng điện (Ca, Cb, Cc)" },
];

/** Màu theo nhóm (cùng thứ tự pha 1, 2, 3) để tích nhiều nhóm vẫn phân biệt được. */
const GROUP_COLORS: Record<HarmChannelGroup, string[]> = {
  van: ["#5470c6", "#91cc75", "#fac858"],
  vll: ["#3ba272", "#fc8452", "#9a60b4"],
  curr: ["#1d4ed8", "#b45309", "#0f766e"],
};

function orderSeriesFor(group: HarmChannelGroup, order: number): TrendSeriesConfig[] {
  const h = `H${order}`;
  const [c1, c2, c3] = GROUP_COLORS[group];
  if (group === "van") {
    return [
      { key: `${h}Van`, label: `${h}_Van (Pha A-N)`, color: c1, unit: "%", digits: 2 },
      { key: `${h}Vbn`, label: `${h}_Vbn (Pha B-N)`, color: c2, unit: "%", digits: 2 },
      { key: `${h}Vcn`, label: `${h}_Vcn (Pha C-N)`, color: c3, unit: "%", digits: 2 },
    ];
  }
  if (group === "vll") {
    return [
      { key: `${h}Vab`, label: `${h}_Vab (Dây A-B)`, color: c1, unit: "%", digits: 2 },
      { key: `${h}Vbc`, label: `${h}_Vbc (Dây B-C)`, color: c2, unit: "%", digits: 2 },
      { key: `${h}Vca`, label: `${h}_Vca (Dây C-A)`, color: c3, unit: "%", digits: 2 },
    ];
  }
  return [
    { key: `${h}Ca`, label: `${h}_Ca (Dòng pha A)`, color: c1, unit: "%", digits: 2 },
    { key: `${h}Cb`, label: `${h}_Cb (Dòng pha B)`, color: c2, unit: "%", digits: 2 },
    { key: `${h}Cc`, label: `${h}_Cc (Dòng pha C)`, color: c3, unit: "%", digits: 2 },
  ];
}

export function HarmonicsChart({
  samples,
  onRefresh,
  chartParams,
}: {
  samples?: ChartSample[];
  timeFilter?: TimeFilterValue;
  onRefresh?: () => void;
  chartParams?: ChartParameterConfig;
}) {
  const thd = useSectionSeries("harm", THD_SECTIONS, chartParams);
  const [orderGroups, setOrderGroups] = useState<HarmChannelGroup[]>(["van"]);
  const [selectedOrder, setSelectedOrder] = useState<number>(3);

  const orderSeries = useMemo<TrendSeriesConfig[]>(
    () =>
      ORDER_GROUPS.filter((group) => orderGroups.includes(group.id)).flatMap((group) =>
        orderSeriesFor(group.id, selectedOrder),
      ),
    [orderGroups, selectedOrder],
  );

  const toggleGroup = (id: HarmChannelGroup) =>
    setOrderGroups((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));

  return (
    <div className="space-y-4">
      {thd.modes.length ? (
        <SampleTrendChart
          title="Tổng biến dạng sóng hài (THD)"
          unitLabel="%"
          series={thd.series}
          samples={samples}
          onRefresh={onRefresh}
          startAtZero
          headerControls={<SectionChecks modes={thd.modes} selectedIds={thd.selectedIds} onToggle={thd.toggle} />}
        />
      ) : (
        <ChartParamEmpty title="Tổng biến dạng sóng hài (THD)" />
      )}

      <SampleTrendChart
        title={`Sóng hài theo bậc (Bậc H${selectedOrder} — 36 tham số H3..H9)`}
        unitLabel="%"
        series={orderSeries}
        samples={samples}
        onRefresh={onRefresh}
        startAtZero
        headerControls={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1 text-[12px] font-medium text-slate-700 shadow-2xs">
              {ORDER_GROUPS.map((group) => (
                <label key={group.id} className="inline-flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={orderGroups.includes(group.id)}
                    onChange={() => toggleGroup(group.id)}
                    className="accent-emerald-600"
                  />
                  {group.label}
                </label>
              ))}
            </div>
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
