"use client";

import { useMemo, useState } from "react";
import type { TrendSeriesConfig } from "@/components/client/SampleTrendChart";
import {
  availableModes,
  sectionOptionLabel,
  type ChartParamTabId,
  type ChartParameterConfig,
} from "@/lib/chart-parameters";

/** Nhóm thứ 2, thứ 3 cùng hiện trên một biểu đồ thì đổi bộ màu để không trùng màu nhóm đầu. */
const EXTRA_PALETTES = [
  ["#3ba272", "#fc8452", "#9a60b4", "#ea7ccc"],
  ["#1d4ed8", "#b45309", "#0f766e", "#be123c"],
];

/**
 * Các nhóm tham số của một biểu đồ (VD Điện áp pha / Điện áp dây) hiển thị thành ô tích thay cho ô chọn:
 * tích nhiều nhóm cùng lúc hoặc bỏ hết. Mặc định tích nhóm đầu tiên (giống ô chọn trước đây).
 * `sectionIds` phải là hằng số cấp module (giữ tham chiếu ổn định).
 */
export function useSectionSeries(
  tabId: ChartParamTabId,
  sectionIds: string[],
  chartParams: ChartParameterConfig | undefined,
) {
  const modes = useMemo(() => availableModes(tabId, sectionIds, chartParams), [tabId, sectionIds, chartParams]);
  const [picked, setPicked] = useState<string[] | null>(null);
  const selectedIds = picked ?? modes.slice(0, 1).map((mode) => mode.section.id);
  const selectedKey = selectedIds.join("|");

  // Tham chiếu ổn định theo nhóm đã tích: SampleTrendChart đặt lại trạng thái ẩn/hiện đường khi `series` đổi.
  const series = useMemo<TrendSeriesConfig[]>(() => {
    const ids = selectedKey ? selectedKey.split("|") : [];
    return modes
      .filter((mode) => ids.includes(mode.section.id))
      .flatMap((mode, index) =>
        mode.series.map((item, itemIndex) => ({
          ...item,
          color: index === 0 ? item.color : EXTRA_PALETTES[(index - 1) % EXTRA_PALETTES.length][itemIndex % 4],
        })),
      );
  }, [modes, selectedKey]);

  const units = [...new Set(series.map((item) => item.unit).filter(Boolean))];

  const toggle = (id: string) =>
    setPicked((current) => {
      const base = current ?? selectedIds;
      return base.includes(id) ? base.filter((item) => item !== id) : [...base, id];
    });

  return { modes, selectedIds, toggle, series, unitLabel: units.join(" / ") };
}

/** Ô tích chọn nhóm tham số, đặt ở thanh tiêu đề biểu đồ. */
export function SectionChecks({
  modes,
  selectedIds,
  onToggle,
}: {
  modes: ReturnType<typeof availableModes>;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  if (modes.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1 text-[12px] font-medium text-slate-700 shadow-2xs">
      {modes.map((mode) => (
        <label key={mode.section.id} className="inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={selectedIds.includes(mode.section.id)}
            onChange={() => onToggle(mode.section.id)}
            className="accent-emerald-600"
          />
          {sectionOptionLabel(mode.section, mode.series)}
        </label>
      ))}
    </div>
  );
}
