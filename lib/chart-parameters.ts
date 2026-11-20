/**
 * Tham số được vẽ trên từng biểu đồ của trang Biểu đồ (dashboard dự án).
 * Khách chọn ở Cấu hình → Tham số biểu đồ; lưu trong project_settings.payload.chartParameters.
 * Đây là nguồn duy nhất của danh sách đường (series) cho các biểu đồ U/I, tần số, công suất, PF, THD, mất cân bằng.
 */

export type ChartSeriesDef = {
  key: string;
  label: string;
  color: string;
  unit?: string;
  digits?: number;
};

export type ChartParamSection = {
  id: string;
  label: string;
  series: ChartSeriesDef[];
};

export type ChartParamTabId = "ui" | "freq" | "power" | "pf" | "harm" | "unbalance";

export type ChartParamTab = {
  id: ChartParamTabId;
  label: string;
  sections: ChartParamSection[];
};

const C1 = "#5470c6";
const C2 = "#91cc75";
const C3 = "#fac858";
const C4 = "#ee6666";
const C5 = "#73c0de";

export const CHART_PARAMETER_TABS: ChartParamTab[] = [
  {
    id: "ui",
    label: "Điện áp / Dòng điện",
    sections: [
      {
        id: "v_phase",
        label: "Điện áp pha",
        series: [
          { key: "Van", label: "U_Ph1", color: C1, unit: "V", digits: 2 },
          { key: "Vbn", label: "U_Ph2", color: C2, unit: "V", digits: 2 },
          { key: "Vcn", label: "U_Ph3", color: C3, unit: "V", digits: 2 },
          { key: "VLNavg", label: "U_Ph_avg", color: C4, unit: "V", digits: 2 },
        ],
      },
      {
        id: "v_line",
        label: "Điện áp dây",
        series: [
          { key: "Vab", label: "U_L12", color: C1, unit: "V", digits: 2 },
          { key: "Vbc", label: "U_L23", color: C2, unit: "V", digits: 2 },
          { key: "Vca", label: "U_L31", color: C3, unit: "V", digits: 2 },
        ],
      },
      {
        id: "current",
        label: "Dòng điện",
        series: [
          { key: "Ia", label: "I_Ph1", color: C1, unit: "A", digits: 2 },
          { key: "Ib", label: "I_Ph2", color: C2, unit: "A", digits: 2 },
          { key: "Ic", label: "I_Ph3", color: C3, unit: "A", digits: 2 },
          { key: "In", label: "I_N", color: C5, unit: "A", digits: 2 },
        ],
      },
    ],
  },
  {
    id: "freq",
    label: "Tần số",
    sections: [
      { id: "freq", label: "Tần số", series: [{ key: "F", label: "Freq", color: C4, unit: "Hz", digits: 2 }] },
    ],
  },
  {
    id: "power",
    label: "Công suất",
    sections: [
      {
        id: "P",
        label: "Công suất tác dụng P",
        series: [
          { key: "Papa", label: "P_Ph1 (Papa)", color: C1, unit: "kW", digits: 3 },
          { key: "Papb", label: "P_Ph2 (Papb)", color: C2, unit: "kW", digits: 3 },
          { key: "Papc", label: "P_Ph3 (Papc)", color: C3, unit: "kW", digits: 3 },
          { key: "Papt", label: "P_Total (Papt)", color: C4, unit: "kW", digits: 3 },
        ],
      },
      {
        id: "Q",
        label: "Công suất phản kháng Q",
        series: [
          { key: "Qrpa", label: "Q_Ph1 (Qrpa)", color: C1, unit: "kVAR", digits: 3 },
          { key: "Qrpb", label: "Q_Ph2 (Qrpb)", color: C2, unit: "kVAR", digits: 3 },
          { key: "Qrpc", label: "Q_Ph3 (Qrpc)", color: C3, unit: "kVAR", digits: 3 },
          { key: "Qrpt", label: "Q_Total (Qrpt)", color: C4, unit: "kVAR", digits: 3 },
        ],
      },
      {
        id: "S",
        label: "Công suất biểu kiến S",
        series: [
          { key: "Sapa", label: "S_Ph1 (Sapa)", color: C1, unit: "kVA", digits: 3 },
          { key: "Sapb", label: "S_Ph2 (Sapb)", color: C2, unit: "kVA", digits: 3 },
          { key: "Sapc", label: "S_Ph3 (Sapc)", color: C3, unit: "kVA", digits: 3 },
          { key: "Sapt", label: "S_Total (Sapt)", color: C4, unit: "kVA", digits: 3 },
        ],
      },
    ],
  },
  {
    id: "pf",
    label: "Hệ số công suất",
    sections: [
      {
        id: "PF",
        label: "Hệ số công suất PF",
        series: [
          { key: "PFa", label: "PF_Ph1 (PFa)", color: C1, digits: 3 },
          { key: "PFb", label: "PF_Ph2 (PFb)", color: C2, digits: 3 },
          { key: "PFc", label: "PF_Ph3 (PFc)", color: C3, digits: 3 },
          { key: "PFt", label: "PF_Total (PFt)", color: C4, digits: 3 },
        ],
      },
      {
        id: "DPF",
        label: "Hệ số công suất dịch pha DPF",
        series: [
          { key: "DPFa", label: "DPF_Ph1 (DPFa)", color: C1, digits: 3 },
          { key: "DPFb", label: "DPF_Ph2 (DPFb)", color: C2, digits: 3 },
          { key: "DPFc", label: "DPF_Ph3 (DPFc)", color: C3, digits: 3 },
          { key: "DPFt", label: "DPF_Total (DPFt)", color: C4, digits: 3 },
        ],
      },
    ],
  },
  {
    id: "harm",
    label: "Sóng hài (THD)",
    sections: [
      {
        id: "v_phase",
        label: "THD Điện áp pha",
        series: [
          { key: "THDVan", label: "THD_U_Ph1 (THDVan)", color: C1, unit: "%", digits: 2 },
          { key: "THDVbn", label: "THD_U_Ph2 (THDVbn)", color: C2, unit: "%", digits: 2 },
          { key: "THDVcn", label: "THD_U_Ph3 (THDVcn)", color: C3, unit: "%", digits: 2 },
        ],
      },
      {
        id: "v_line",
        label: "THD Điện áp dây",
        series: [
          { key: "THDVab", label: "THD_U_L12 (THDVab)", color: C1, unit: "%", digits: 2 },
          { key: "THDVbc", label: "THD_U_L23 (THDVbc)", color: C2, unit: "%", digits: 2 },
          { key: "THDVca", label: "THD_U_L31 (THDVca)", color: C3, unit: "%", digits: 2 },
        ],
      },
      {
        id: "i",
        label: "THD Dòng điện",
        series: [
          { key: "THDCa", label: "THD_I_Ph1 (THDCa)", color: C1, unit: "%", digits: 2 },
          { key: "THDCb", label: "THD_I_Ph2 (THDCb)", color: C2, unit: "%", digits: 2 },
          { key: "THDCc", label: "THD_I_Ph3 (THDCc)", color: C3, unit: "%", digits: 2 },
        ],
      },
    ],
  },
  {
    id: "unbalance",
    label: "Mất cân bằng pha",
    sections: [
      {
        id: "v_phase",
        label: "Mất cân bằng điện áp pha",
        series: [
          { key: "Vuan", label: "U_unb_Ph1 (Vuan)", color: C1, unit: "%", digits: 2 },
          { key: "Vubn", label: "U_unb_Ph2 (Vubn)", color: C2, unit: "%", digits: 2 },
          { key: "Vucn", label: "U_unb_Ph3 (Vucn)", color: C3, unit: "%", digits: 2 },
        ],
      },
      {
        id: "v_line",
        label: "Mất cân bằng điện áp dây",
        series: [
          { key: "Vuab", label: "U_unb_L12 (Vuab)", color: C1, unit: "%", digits: 2 },
          { key: "Vubc", label: "U_unb_L23 (Vubc)", color: C2, unit: "%", digits: 2 },
          { key: "Vuca", label: "U_unb_L31 (Vuca)", color: C3, unit: "%", digits: 2 },
        ],
      },
      {
        id: "current",
        label: "Mất cân bằng dòng điện",
        series: [
          { key: "IuA", label: "I_unb_Ph1 (IuA)", color: C1, unit: "%", digits: 2 },
          { key: "IuB", label: "I_unb_Ph2 (IuB)", color: C2, unit: "%", digits: 2 },
          { key: "IuC", label: "I_unb_Ph3 (IuC)", color: C3, unit: "%", digits: 2 },
        ],
      },
    ],
  },
];

/** Tham số đã chọn theo biểu đồ. Biểu đồ không có trong cấu hình = vẽ đủ tham số mặc định. */
export type ChartParameterConfig = Partial<Record<ChartParamTabId, string[]>>;

export function chartTab(tabId: ChartParamTabId) {
  return CHART_PARAMETER_TABS.find((tab) => tab.id === tabId)!;
}

export function allTabKeys(tabId: ChartParamTabId) {
  return chartTab(tabId).sections.flatMap((section) => section.series.map((item) => item.key));
}

/** Đọc cấu hình từ project settings (bỏ khóa lạ / tham số không còn tồn tại). */
export function readChartParameterConfig(settings: Record<string, unknown> | undefined | null): ChartParameterConfig {
  const raw = settings?.chartParameters;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const config: ChartParameterConfig = {};
  for (const tab of CHART_PARAMETER_TABS) {
    const list = (raw as Record<string, unknown>)[tab.id];
    if (!Array.isArray(list)) continue;
    const valid = new Set(allTabKeys(tab.id));
    config[tab.id] = list.filter((key): key is string => typeof key === "string" && valid.has(key));
  }
  return config;
}

/** Tham số có được vẽ không (biểu đồ chưa cấu hình = vẽ tất cả). */
export function isParamAllowed(config: ChartParameterConfig | undefined, tabId: ChartParamTabId, key: string) {
  const selected = config?.[tabId];
  return !selected || selected.includes(key);
}

/** Các đường của một nhóm sau khi lọc theo cấu hình. */
export function sectionSeries(
  tabId: ChartParamTabId,
  sectionId: string,
  config: ChartParameterConfig | undefined,
): ChartSeriesDef[] {
  const section = chartTab(tabId).sections.find((item) => item.id === sectionId);
  if (!section) return [];
  const selected = config?.[tabId];
  if (!selected) return section.series;
  const allowed = new Set(selected);
  return section.series.filter((item) => allowed.has(item.key));
}

/**
 * Các nhóm (chế độ) còn tham số sau khi lọc theo cấu hình.
 * Không có cấu hình thì `series` giữ nguyên tham chiếu hằng — gọi trong useMemo để biểu đồ không bị vẽ lại liên tục.
 */
export function availableModes(
  tabId: ChartParamTabId,
  sectionIds: string[],
  config: ChartParameterConfig | undefined,
): { section: ChartParamSection; series: ChartSeriesDef[] }[] {
  const tab = chartTab(tabId);
  return sectionIds
    .map((id) => ({
      section: tab.sections.find((item) => item.id === id)!,
      series: sectionSeries(tabId, id, config),
    }))
    .filter((mode) => Boolean(mode.section) && mode.series.length > 0);
}

/** Nhãn lựa chọn chế độ, VD "Công suất tác dụng P (Papa, Papt)". */
export function sectionOptionLabel(section: Pick<ChartParamSection, "label">, series: ChartSeriesDef[]) {
  return `${section.label} (${series.map((item) => item.key).join(", ")})`;
}
