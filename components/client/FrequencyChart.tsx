"use client";

import { useMemo } from "react";
import { SampleTrendChart, type TrendSeriesConfig } from "@/components/client/SampleTrendChart";
import type { ChartSample } from "@/lib/gateway-series";
import type { TimeFilterValue } from "./TimeFilterBar";

export function FrequencyChart({
  samples,
  onRefresh,
}: {
  onRefresh?: () => void;
  timeFilter: TimeFilterValue;
  samples?: ChartSample[];
}) {
  const series = useMemo<TrendSeriesConfig[]>(
    () => [{ key: "F", label: "Freq", color: "#ee6666", unit: "Hz", digits: 2 }],
    [],
  );

  return (
    <SampleTrendChart
      title="Tần số lưới điện"
      unitLabel="Hz"
      series={series}
      samples={samples}
      onRefresh={onRefresh}
    />
  );
}
