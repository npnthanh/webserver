export type MeterChartId = "energy" | "ui" | "freq" | "power" | "harm" | "unbalance";

export type MeterParameter = {
  id: number;
  group: string;
  chart: MeterChartId;
  name: string;
  unit: string;
  /** Khóa trong VAL của bản tin gateway. */
  key: string;
};

/**
 * Gateway PM2230 gửi điện năng bằng kWh / kVARh / kVAh (ví dụ 1251.979, 1252.0).
 * Giữ nguyên giá trị số thực từ thanh ghi (không chia 1000 khi gặp số nguyên chẵn như 1252.0 -> 1252).
 */
export function registerToKwh(value: number) {
  if (!Number.isFinite(value)) return 0;
  return value;
}

export const METER_PARAMETERS: MeterParameter[] = [
  { id: 1, group: "Điện năng 2 chiều", chart: "energy", name: "Điện năng tác dụng nhận", unit: "kWh", key: "EPaed" },
  { id: 2, group: "Điện năng 2 chiều", chart: "energy", name: "Điện năng tác dụng phát", unit: "kWh", key: "EPaer" },
  { id: 3, group: "Điện năng 2 chiều", chart: "energy", name: "Điện năng phản kháng nhận", unit: "kVARh", key: "EQred" },
  { id: 4, group: "Điện năng 2 chiều", chart: "energy", name: "Điện năng phản kháng phát", unit: "kVARh", key: "EQrer" },
  { id: 5, group: "Điện năng 2 chiều", chart: "energy", name: "Điện năng biểu kiến tiêu thụ", unit: "kVAh", key: "ESaed" },
  { id: 6, group: "Điện năng 2 chiều", chart: "energy", name: "Điện năng biểu kiến phát", unit: "kVAh", key: "ESaer" },

  { id: 7, group: "Công suất tức thời", chart: "power", name: "Công suất tác dụng pha A", unit: "kW", key: "Papa" },
  { id: 8, group: "Công suất tức thời", chart: "power", name: "Công suất tác dụng pha B", unit: "kW", key: "Papb" },
  { id: 9, group: "Công suất tức thời", chart: "power", name: "Công suất tác dụng pha C", unit: "kW", key: "Papc" },
  { id: 10, group: "Công suất tức thời", chart: "power", name: "Tổng công suất tác dụng", unit: "kW", key: "Papt" },
  { id: 11, group: "Công suất tức thời", chart: "power", name: "Công suất phản kháng pha A", unit: "kVAR", key: "Qrpa" },
  { id: 12, group: "Công suất tức thời", chart: "power", name: "Công suất phản kháng pha B", unit: "kVAR", key: "Qrpb" },
  { id: 13, group: "Công suất tức thời", chart: "power", name: "Công suất phản kháng pha C", unit: "kVAR", key: "Qrpc" },
  { id: 14, group: "Công suất tức thời", chart: "power", name: "Tổng công suất phản kháng", unit: "kVAR", key: "Qrpt" },
  { id: 15, group: "Công suất tức thời", chart: "power", name: "Công suất biểu kiến pha A", unit: "kVA", key: "Sapa" },
  { id: 16, group: "Công suất tức thời", chart: "power", name: "Công suất biểu kiến pha B", unit: "kVA", key: "Sapb" },
  { id: 17, group: "Công suất tức thời", chart: "power", name: "Công suất biểu kiến pha C", unit: "kVA", key: "Sapc" },
  { id: 18, group: "Công suất tức thời", chart: "power", name: "Tổng công suất biểu kiến", unit: "kVA", key: "Sapt" },

  { id: 19, group: "Trạng thái lưới điện", chart: "ui", name: "Điện áp dây A-B", unit: "V", key: "Vab" },
  { id: 20, group: "Trạng thái lưới điện", chart: "ui", name: "Điện áp dây B-C", unit: "V", key: "Vbc" },
  { id: 21, group: "Trạng thái lưới điện", chart: "ui", name: "Điện áp dây C-A", unit: "V", key: "Vca" },
  { id: 22, group: "Trạng thái lưới điện", chart: "ui", name: "Điện áp dây trung bình", unit: "V", key: "VLLavg" },
  { id: 23, group: "Trạng thái lưới điện", chart: "ui", name: "Điện áp pha A", unit: "V", key: "Van" },
  { id: 24, group: "Trạng thái lưới điện", chart: "ui", name: "Điện áp pha B", unit: "V", key: "Vbn" },
  { id: 25, group: "Trạng thái lưới điện", chart: "ui", name: "Điện áp pha C", unit: "V", key: "Vcn" },
  { id: 26, group: "Trạng thái lưới điện", chart: "ui", name: "Điện áp pha trung bình", unit: "V", key: "VLNavg" },
  { id: 27, group: "Trạng thái lưới điện", chart: "ui", name: "Dòng pha A", unit: "A", key: "Ia" },
  { id: 28, group: "Trạng thái lưới điện", chart: "ui", name: "Dòng pha B", unit: "A", key: "Ib" },
  { id: 29, group: "Trạng thái lưới điện", chart: "ui", name: "Dòng pha C", unit: "A", key: "Ic" },
  { id: 30, group: "Trạng thái lưới điện", chart: "ui", name: "Dòng điện dây trung tính", unit: "A", key: "In" },
  { id: 31, group: "Trạng thái lưới điện", chart: "ui", name: "Dòng điện trung bình", unit: "A", key: "Iavg" },
  { id: 32, group: "Trạng thái lưới điện", chart: "freq", name: "Tần số", unit: "Hz", key: "F" },
  { id: 33, group: "Trạng thái lưới điện", chart: "ui", name: "Hệ số công suất A", unit: "", key: "PFa" },
  { id: 34, group: "Trạng thái lưới điện", chart: "ui", name: "Hệ số công suất B", unit: "", key: "PFb" },
  { id: 35, group: "Trạng thái lưới điện", chart: "ui", name: "Hệ số công suất C", unit: "", key: "PFc" },
  { id: 36, group: "Trạng thái lưới điện", chart: "ui", name: "Hệ số công suất trung bình", unit: "", key: "PFt" },
  { id: 37, group: "Trạng thái lưới điện", chart: "ui", name: "Hệ số công suất dịch pha A", unit: "", key: "DPFa" },
  { id: 38, group: "Trạng thái lưới điện", chart: "ui", name: "Hệ số công suất dịch pha B", unit: "", key: "DPFb" },
  { id: 39, group: "Trạng thái lưới điện", chart: "ui", name: "Hệ số công suất dịch pha C", unit: "", key: "DPFc" },
  { id: 40, group: "Trạng thái lưới điện", chart: "ui", name: "Hệ số công suất dịch pha tổng", unit: "", key: "DPFt" },

  { id: 41, group: "Chất lượng điện", chart: "harm", name: "THD điện áp pha A", unit: "%", key: "THDVan" },
  { id: 42, group: "Chất lượng điện", chart: "harm", name: "THD điện áp pha B", unit: "%", key: "THDVbn" },
  { id: 43, group: "Chất lượng điện", chart: "harm", name: "THD điện áp pha C", unit: "%", key: "THDVcn" },
  { id: 44, group: "Chất lượng điện", chart: "harm", name: "THD điện áp pha trung bình", unit: "%", key: "THDVln" },
  { id: 45, group: "Chất lượng điện", chart: "harm", name: "THD điện áp dây A-B", unit: "%", key: "THDVab" },
  { id: 46, group: "Chất lượng điện", chart: "harm", name: "THD điện áp dây B-C", unit: "%", key: "THDVbc" },
  { id: 47, group: "Chất lượng điện", chart: "harm", name: "THD điện áp dây C-A", unit: "%", key: "THDVca" },
  { id: 48, group: "Chất lượng điện", chart: "harm", name: "THD điện áp dây trung bình", unit: "%", key: "THDVll" },
  { id: 49, group: "Chất lượng điện", chart: "harm", name: "THD dòng điện pha A", unit: "%", key: "THDCa" },
  { id: 50, group: "Chất lượng điện", chart: "harm", name: "THD dòng điện pha B", unit: "%", key: "THDCb" },
  { id: 51, group: "Chất lượng điện", chart: "harm", name: "THD dòng điện pha C", unit: "%", key: "THDCc" },
  { id: 52, group: "Chất lượng điện", chart: "harm", name: "THD dòng điện dây trung tính", unit: "%", key: "THDCn" },
  { id: 53, group: "Chất lượng điện", chart: "unbalance", name: "Mất cân bằng dòng điện pha A", unit: "%", key: "IuA" },
  { id: 54, group: "Chất lượng điện", chart: "unbalance", name: "Mất cân bằng dòng điện pha B", unit: "%", key: "IuB" },
  { id: 55, group: "Chất lượng điện", chart: "unbalance", name: "Mất cân bằng dòng điện pha C", unit: "%", key: "IuC" },
  { id: 56, group: "Chất lượng điện", chart: "unbalance", name: "Mất cân bằng điện áp pha A", unit: "%", key: "Vuan" },
  { id: 57, group: "Chất lượng điện", chart: "unbalance", name: "Mất cân bằng điện áp pha B", unit: "%", key: "Vubn" },
  { id: 58, group: "Chất lượng điện", chart: "unbalance", name: "Mất cân bằng điện áp pha C", unit: "%", key: "Vucn" },
  { id: 59, group: "Chất lượng điện", chart: "unbalance", name: "Mất cân bằng điện áp dây A-B", unit: "%", key: "Vuab" },
  { id: 60, group: "Chất lượng điện", chart: "unbalance", name: "Mất cân bằng điện áp dây B-C", unit: "%", key: "Vubc" },
  { id: 61, group: "Chất lượng điện", chart: "unbalance", name: "Mất cân bằng điện áp dây C-A", unit: "%", key: "Vuca" },

  ...harmonicParameters(),
];

function harmonicParameters(): MeterParameter[] {
  const channels: Array<{ label: string; suffix: string }> = [
    { label: "Điện áp dây A-B", suffix: "Vab" },
    { label: "Điện áp dây C-A", suffix: "Vca" },
    { label: "Điện áp dây B-C", suffix: "Vbc" },
    { label: "Điện áp pha A", suffix: "Van" },
    { label: "Điện áp pha B", suffix: "Vbn" },
    { label: "Điện áp pha C", suffix: "Vcn" },
    { label: "Dòng điện pha A", suffix: "Ca" },
    { label: "Dòng điện pha B", suffix: "Cb" },
    { label: "Dòng điện pha C", suffix: "Cc" },
  ];
  const orders = [3, 5, 7, 9];
  const rows: MeterParameter[] = [];
  let id = 62;
  for (const channel of channels) {
    for (const order of orders) {
      rows.push({
        id,
        group: "Độ thị bậc sóng hài",
        chart: "harm",
        name: `${channel.label}, sóng hài bậc ${order}`,
        unit: "%",
        key: `H${order}${channel.suffix}`,
      });
      id += 1;
    }
  }
  return rows;
}

export function parametersForChart(chart: MeterChartId) {
  return METER_PARAMETERS.filter((item) => item.chart === chart);
}

export function readMeterValue(values: Record<string, unknown> | null | undefined, key: string) {
  const value = values?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
