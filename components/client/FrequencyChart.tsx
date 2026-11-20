"use client";

import { useMemo } from "react";
import { SampleTrendChart, TREND_FILL_HEIGHT } from "@/components/client/SampleTrendChart";
import { ChartParamEmpty } from "@/components/client/ChartParamEmpty";
import { sectionSeries, type ChartParameterConfig } from "@/lib/chart-parameters";
import type { ChartSample } from "@/lib/gateway-series";
import type { TimeFilterValue } from "./TimeFilterBar";

export function FrequencyChart({
  samples,
  onRefresh,
  chartParams,
}: {
  onRefresh?: () => void;
  timeFilter: TimeFilterValue;
  samples?: ChartSample[];
  chartParams?: ChartParameterConfig;
}) {
  const series = useMemo(() => sectionSeries("freq", "freq", chartParams), [chartParams]);
  if (!series.length) return <ChartParamEmpty title="Tần số lưới điện" />;

  return (
    <SampleTrendChart
      title="Tần số lưới điện"
      unitLabel="Hz"
      series={series}
      samples={samples}
      onRefresh={onRefresh}
      heightClass={TREND_FILL_HEIGHT}
    />
  );
}
