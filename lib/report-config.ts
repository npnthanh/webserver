/**
 * Định nghĩa các loại báo cáo + cấu hình báo cáo của dự án (project_settings.reportConfig).
 * Quản trị viên đặt ở Quản lý dự án → Cấu hình báo cáo; trang Báo cáo của khách dùng làm mặc định.
 */

export type ReportTypeId =
  | "overview"
  | "energy"
  | "cost"
  | "ghg"
  | "alerts"
  | "comparison";

export type ReportFieldDef = {
  key: string;
  label: string;
  align?: "left" | "right";
  defaultChecked?: boolean;
};

export type ReportHeaderFooterConfig = {
  companyName: string;
  department: string;
  formCode: string;
  preparedByTitle: string;
  reviewedByTitle: string;
  approvedByTitle: string;
  footerNote: string;
};

export const DEFAULT_HEADER_FOOTER: ReportHeaderFooterConfig = {
  companyName: "HỆ THỐNG QUẢN LÝ NĂNG LƯỢNG & PHÁT THẢI EMS",
  department: "Phòng Kỹ thuật & Quản lý Năng lượng",
  formCode: "BM-EMS-01/BC",
  preparedByTitle: "Người lập biểu",
  reviewedByTitle: "Kiểm soát kỹ thuật",
  approvedByTitle: "Phê duyệt / Giám đốc",
  footerNote:
    "Báo cáo được trích xuất tự động từ Hệ thống Quản lý Năng lượng EMS — Dữ liệu đo đếm thời gian thực từ Gateway.",
};


export const REPORTS: {
  id: ReportTypeId;
  name: string;
  title: string;
  subtitle: string;
  formCode: string;
}[] = [
  {
    id: "overview",
    name: "Báo cáo tổng hợp",
    title: "BÁO CÁO TỔNG HỢP NĂNG LƯỢNG & VẬN HÀNH",
    subtitle: "Tổng hợp tiêu thụ năng lượng, công suất, chi phí, phát thải khí nhà kính và cảnh báo",
    formCode: "BM-EMS-01/TH",
  },
  {
    id: "energy",
    name: "Báo cáo tiêu hao",
    title: "BÁO CÁO TIÊU HAO NĂNG LƯỢNG",
    subtitle: "Thống kê sản lượng tiêu thụ theo điểm đo, khung giờ bình thường / thấp điểm / cao điểm và thông số điện",
    formCode: "BM-EMS-02/THN",
  },
  {
    id: "cost",
    name: "Báo cáo chi phí",
    title: "BÁO CÁO CHI PHÍ NĂNG LƯỢNG",
    subtitle: "Phân tích chi phí tiền điện theo biểu giá 3 khung giờ (Bình thường, Thấp điểm, Cao điểm) và tỷ trọng",
    formCode: "BM-EMS-03/CP",
  },
  {
    id: "ghg",
    name: "Khí nhà kính",
    title: "BÁO CÁO KIỂM KÊ KHÍ NHÀ KÍNH (GHG)",
    subtitle: "Tổng hợp nguồn phát thải theo Phạm vi 1, Phạm vi 2, Phạm vi 3 và lượng phát thải quy đổi tCO₂e",
    formCode: "BM-EMS-04/GHG",
  },
  {
    id: "alerts",
    name: "Cảnh báo",
    title: "BÁO CÁO THỐNG KÊ CẢNH BÁO HỆ THỐNG",
    subtitle: "Nhật ký thời điểm phát sinh cảnh báo vượt ngưỡng, phân loại mức độ và trạng thái gửi Zalo / Telegram",
    formCode: "BM-EMS-05/CB",
  },
  {
    id: "comparison",
    name: "Báo cáo so sánh",
    title: "BÁO CÁO SO SÁNH TIÊU THỤ & CHI PHÍ",
    subtitle: "Đối chiếu biến động sản lượng tiêu hao và chi phí giữa kỳ báo cáo với kỳ đối chiếu hoặc giữa các điểm đo",
    formCode: "BM-EMS-06/SS",
  },
];

export const REPORT_FIELDS: Record<ReportTypeId, ReportFieldDef[]> = {
  overview: [
    { key: "point", label: "Điểm đo / Mã thiết bị", align: "left", defaultChecked: true },
    { key: "utility", label: "Loại năng lượng", align: "left", defaultChecked: true },
    { key: "kwhTotal", label: "Tổng tiêu thụ (kWh)", align: "right", defaultChecked: true },
    { key: "kwhPeak", label: "Tiêu thụ giờ cao điểm (kWh)", align: "right", defaultChecked: true },
    { key: "powerAvg", label: "Công suất P hiện tại (kW)", align: "right", defaultChecked: true },
    { key: "costVnd", label: "Chi phí ước tính (VNĐ)", align: "right", defaultChecked: true },
    { key: "ghgTons", label: "Phát thải quy đổi (tCO₂e)", align: "right", defaultChecked: true },
    { key: "alertCount", label: "Số lần cảnh báo", align: "right", defaultChecked: true },
  ],
  energy: [
    { key: "period", label: "Thời điểm / Kỳ đo", align: "left", defaultChecked: true },
    { key: "point", label: "Điểm đo", align: "left", defaultChecked: true },
    { key: "firstKwh", label: "Chỉ số đầu kỳ (kWh)", align: "right", defaultChecked: true },
    { key: "lastKwh", label: "Chỉ số cuối kỳ (kWh)", align: "right", defaultChecked: true },
    { key: "deltaKwh", label: "Sản lượng tiêu hao (kWh)", align: "right", defaultChecked: true },
    { key: "normalKwh", label: "Giờ bình thường (kWh)", align: "right", defaultChecked: true },
    { key: "offKwh", label: "Giờ thấp điểm (kWh)", align: "right", defaultChecked: true },
    { key: "peakKwh", label: "Giờ cao điểm (kWh)", align: "right", defaultChecked: true },
    { key: "noneKwh", label: "Không xác định khung giờ (kWh)", align: "right", defaultChecked: true },
    { key: "meterSwap", label: "Thay đồng hồ trong kỳ", align: "left", defaultChecked: true },
    { key: "uAvg", label: "Điện áp pha TB (V)", align: "right", defaultChecked: false },
    { key: "iAvg", label: "Dòng điện pha TB (A)", align: "right", defaultChecked: false },
  ],
  cost: [
    { key: "period", label: "Thời điểm / Kỳ tính", align: "left", defaultChecked: true },
    { key: "point", label: "Điểm đo", align: "left", defaultChecked: true },
    { key: "kwhTotal", label: "Tổng điện năng (kWh)", align: "right", defaultChecked: true },
    { key: "voltageLevel", label: "Cấp điện áp biểu giá", align: "left", defaultChecked: false },
    { key: "normalVnd", label: "Tiền giờ bình thường (VNĐ)", align: "right", defaultChecked: true },
    { key: "offVnd", label: "Tiền giờ thấp điểm (VNĐ)", align: "right", defaultChecked: true },
    { key: "peakVnd", label: "Tiền giờ cao điểm (VNĐ)", align: "right", defaultChecked: true },
    { key: "noneVnd", label: "Tiền không xác định khung giờ (VNĐ)", align: "right", defaultChecked: true },
    { key: "totalVnd", label: "Tổng thành tiền (VNĐ)", align: "right", defaultChecked: true },
    { key: "sharePct", label: "Tỷ trọng chi phí (%)", align: "right", defaultChecked: true },
  ],
  ghg: [
    { key: "scope", label: "Phạm vi (Scope)", align: "left", defaultChecked: true },
    { key: "sourceName", label: "Tên nguồn phát thải", align: "left", defaultChecked: true },
    { key: "method", label: "Phương thức thu thập", align: "left", defaultChecked: true },
    { key: "activityVal", label: "Dữ liệu hoạt động / Tiêu thụ", align: "right", defaultChecked: true },
    { key: "factorStr", label: "Hệ số phát thải", align: "left", defaultChecked: true },
    { key: "multiplierStr", label: "Hệ số nhân", align: "left", defaultChecked: true },
    { key: "formula", label: "Công thức tính", align: "left", defaultChecked: false },
    { key: "tonsCo2e", label: "Phát thải (tCO₂e)", align: "right", defaultChecked: true },
    { key: "sharePct", label: "Tỷ trọng (%)", align: "right", defaultChecked: true },
  ],
  alerts: [
    { key: "timestamp", label: "Thời điểm phát sinh", align: "left", defaultChecked: true },
    { key: "severity", label: "Mức độ cảnh báo", align: "left", defaultChecked: true },
    { key: "point", label: "Điểm đo", align: "left", defaultChecked: true },
    { key: "parameter", label: "Mã thông số", align: "left", defaultChecked: true },
    { key: "value", label: "Giá trị thực tế", align: "right", defaultChecked: true },
    { key: "threshold", label: "Ngưỡng cài đặt", align: "right", defaultChecked: true },
    { key: "delivery", label: "Trạng thái gửi (Zalo / Telegram)", align: "left", defaultChecked: true },
    { key: "message", label: "Nội dung cảnh báo", align: "left", defaultChecked: true },
  ],
  comparison: [
    { key: "target", label: "Điểm đo / Chỉ tiêu so sánh", align: "left", defaultChecked: true },
    { key: "currentKwh", label: "Sản lượng kỳ báo cáo (kWh)", align: "right", defaultChecked: true },
    { key: "baseKwh", label: "Sản lượng kỳ đối chiếu (kWh)", align: "right", defaultChecked: true },
    { key: "diffKwh", label: "Chênh lệch tiêu hao (kWh)", align: "right", defaultChecked: true },
    { key: "diffPct", label: "Biến động (%)", align: "right", defaultChecked: true },
    { key: "currentCost", label: "Chi phí kỳ báo cáo (VNĐ)", align: "right", defaultChecked: true },
    { key: "baseCost", label: "Chi phí kỳ đối chiếu (VNĐ)", align: "right", defaultChecked: true },
    { key: "diffCost", label: "Chênh lệch chi phí (VNĐ)", align: "right", defaultChecked: true },
    { key: "trend", label: "Đánh giá xu hướng", align: "left", defaultChecked: true },
  ],
};

/* ---------------- Báo cáo theo loại điểm đo (Điện / Nước / Nhiệt / Hơi …) ---------------- */

/** Trường theo thông số khai báo ở Hàm nhận dữ liệu của đồng hồ: `param:<tên>:<avg|min|max>`. */
export const PARAM_FIELD_PREFIX = "param:";

export type DeclaredReportParam = { key: string; label: string; unit: string; cumulative?: boolean };

/** Đơn vị sản lượng: theo chỉ số cộng dồn đã khai báo, không có thì theo loại điểm đo. */
export function consumptionUnitWith(meterType: string, params: DeclaredReportParam[] = []) {
  return params.find((param) => param.cumulative && param.unit)?.unit || consumptionUnitFor(meterType);
}

export function isElectricMeterType(meterType: string) {
  const value = meterType.trim().toLowerCase();
  return value === "" || value.includes("điện") || value.includes("dien");
}

/** Đơn vị sản lượng tiêu thụ theo loại điểm đo (rỗng = chưa có đơn vị chuẩn). */
export function consumptionUnitFor(meterType: string) {
  const value = meterType.trim().toLowerCase();
  if (isElectricMeterType(meterType)) return "kWh";
  if (value.includes("nước")) return "m³";
  if (value.includes("khí nén")) return "Nm³";
  if (value.includes("hơi")) return "t";
  if (value.includes("nhiệt")) return "kWh";
  return "";
}

/** Loại báo cáo dùng được: các báo cáo khung giờ giá điện / chi phí 3 giá / khí nhà kính chỉ dành cho Điện. */
export function reportsForMeterType(meterType: string): ReportTypeId[] {
  return isElectricMeterType(meterType) ? [...REPORT_TYPE_IDS] : ["overview", "energy", "alerts", "comparison"];
}

function withUnit(label: string, unit: string) {
  return unit ? `${label} (${unit})` : label;
}

/** Trường dữ liệu của một loại báo cáo theo loại điểm đo (Điện: như cũ; loại khác: bỏ trường riêng của điện). */
export function reportFieldsFor(
  id: ReportTypeId,
  meterType: string,
  params: DeclaredReportParam[] = [],
): ReportFieldDef[] {
  if (isElectricMeterType(meterType)) return REPORT_FIELDS[id];
  const unit = consumptionUnitWith(meterType, params);
  const pick = (keys: string[]) => REPORT_FIELDS[id].filter((field) => keys.includes(field.key));
  switch (id) {
    case "overview":
      return [
        ...pick(["point", "utility"]),
        { key: "kwhTotal", label: withUnit("Tổng tiêu thụ", unit), align: "right", defaultChecked: true },
        ...pick(["alertCount"]),
      ];
    case "energy":
      return [
        ...pick(["period", "point"]),
        { key: "firstKwh", label: withUnit("Chỉ số đầu kỳ", unit), align: "right", defaultChecked: true },
        { key: "lastKwh", label: withUnit("Chỉ số cuối kỳ", unit), align: "right", defaultChecked: true },
        { key: "deltaKwh", label: withUnit("Sản lượng tiêu hao", unit), align: "right", defaultChecked: true },
        ...pick(["meterSwap"]),
        // Chỉ số cộng dồn đã dùng cho sản lượng: không cần thống kê trung bình / nhỏ nhất / lớn nhất.
        ...params.filter((param) => !param.cumulative).flatMap((param): ReportFieldDef[] => [
          { key: `${PARAM_FIELD_PREFIX}${param.key}:avg`, label: withUnit(`${param.key} trung bình`, param.unit), align: "right", defaultChecked: true },
          { key: `${PARAM_FIELD_PREFIX}${param.key}:min`, label: withUnit(`${param.key} nhỏ nhất`, param.unit), align: "right", defaultChecked: false },
          { key: `${PARAM_FIELD_PREFIX}${param.key}:max`, label: withUnit(`${param.key} lớn nhất`, param.unit), align: "right", defaultChecked: false },
        ]),
      ];
    case "comparison":
      return [
        ...pick(["target"]),
        { key: "currentKwh", label: withUnit("Sản lượng kỳ báo cáo", unit), align: "right", defaultChecked: true },
        { key: "baseKwh", label: withUnit("Sản lượng kỳ đối chiếu", unit), align: "right", defaultChecked: true },
        { key: "diffKwh", label: withUnit("Chênh lệch tiêu hao", unit), align: "right", defaultChecked: true },
        ...pick(["diffPct", "trend"]),
      ];
    case "alerts":
      return REPORT_FIELDS.alerts;
    default:
      return [];
  }
}

/** Trường tích sẵn của từng báo cáo theo loại điểm đo. */
export function defaultFieldsForMeterType(
  meterType: string,
  params: DeclaredReportParam[] = [],
): Record<ReportTypeId, string[]> {
  return Object.fromEntries(
    REPORT_TYPE_IDS.map((id) => [
      id,
      reportFieldsFor(id, meterType, params)
        .filter((field) => field.defaultChecked !== false)
        .map((field) => field.key),
    ]),
  ) as Record<ReportTypeId, string[]>;
}

export function defaultSelectedFieldsByReport(): Record<ReportTypeId, string[]> {
  return Object.fromEntries(
    (Object.keys(REPORT_FIELDS) as ReportTypeId[]).map((id) => [
      id,
      REPORT_FIELDS[id].filter((f) => f.defaultChecked !== false).map((f) => f.key),
    ]),
  ) as Record<ReportTypeId, string[]>;
}

export type ReportExportFormat = ".pdf" | ".xlsx";

export type ReportLayoutDefaults = {
  chart: boolean;
  summary: boolean;
  detail: boolean;
  format: ReportExportFormat;
};

export type ReportConfig = {
  headerFooter: ReportHeaderFooterConfig;
  /** Trường đang tích ở trang Báo cáo của khách (khách tự chọn trong phạm vi được phép). */
  fieldsByReport: Record<ReportTypeId, string[]>;
  /**
   * Trường dữ liệu khách hàng ĐƯỢC XEM theo từng loại báo cáo (quản trị viên đặt, VD theo gói dịch vụ).
   * Trường không có trong danh sách bị ẩn hẳn ở trang khách (cả xem trước và file xuất).
   */
  allowedFields: Record<ReportTypeId, string[]>;
  /** Loại báo cáo khách hàng được dùng (theo thứ tự chuẩn). */
  enabledReports: ReportTypeId[];
  /** Tiêu đề in trên báo cáo theo từng loại (bỏ trống = tiêu đề chuẩn). */
  titles: Partial<Record<ReportTypeId, string>>;
  layout: ReportLayoutDefaults;
  /** Mẫu trong Thư viện báo cáo mà dự án đang dùng (rỗng = theo cấu hình riêng của dự án). */
  templateId?: string;
  /**
   * Trường theo thông số đo (param:…) bị ẩn với khách. Mặc định được xem (thông số mới khai báo tự hiện),
   * quản trị viên bỏ tích ở Cấu hình báo cáo thì ghi vào đây.
   */
  hiddenParamFields?: Partial<Record<ReportTypeId, string[]>>;
};

/** Khách có được xem trường này không (trường chuẩn: theo allowedFields; trường thông số đo: trừ khi bị ẩn). */
export function isReportFieldAllowed(config: Pick<ReportConfig, "allowedFields" | "hiddenParamFields">, id: ReportTypeId, key: string) {
  if (key.startsWith(PARAM_FIELD_PREFIX)) return !(config.hiddenParamFields?.[id] ?? []).includes(key);
  return (config.allowedFields[id] ?? []).includes(key);
}

/**
 * Mẫu báo cáo trong Thư viện báo cáo (Cấu hình → Thư viện báo cáo), chia theo loại điểm đo.
 * Trang Báo cáo của dự án chọn mẫu để áp header/footer, loại báo cáo, tiêu đề, trường dữ liệu và bố cục.
 */
export type ReportTemplate = {
  id: string;
  name: string;
  /** Loại điểm đo (Điện, Áp suất, ...) */
  meterType: string;
  headerFooter: ReportHeaderFooterConfig;
  enabledReports: ReportTypeId[];
  fieldsByReport: Record<ReportTypeId, string[]>;
  titles: Partial<Record<ReportTypeId, string>>;
  layout: ReportLayoutDefaults;
};

export const DEFAULT_REPORT_LAYOUT: ReportLayoutDefaults = { chart: true, summary: true, detail: true, format: ".pdf" };

export const REPORT_TYPE_IDS = REPORTS.map((item) => item.id);

export function reportTitle(config: Pick<ReportConfig, "titles">, id: ReportTypeId) {
  const custom = config.titles[id]?.trim();
  return custom || (REPORTS.find((item) => item.id === id)?.title ?? "");
}

/** Chuẩn hoá một mẫu báo cáo (dữ liệu thiếu / sai thì dùng mặc định). */
export function normalizeReportTemplate(raw: unknown): ReportTemplate {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  // Dùng lại bộ đọc reportConfig cho header/footer, loại báo cáo, tiêu đề, trường dữ liệu và bố cục.
  const config = readReportConfig({ reportConfig: source });
  return {
    id: typeof source.id === "string" ? source.id : "",
    name: typeof source.name === "string" ? source.name : "",
    meterType: typeof source.meterType === "string" ? source.meterType : "",
    headerFooter: config.headerFooter,
    enabledReports: config.enabledReports,
    fieldsByReport: config.fieldsByReport,
    titles: config.titles,
    layout: config.layout,
  };
}

/** Đọc cấu hình báo cáo từ project settings (thiếu / sai thì dùng mặc định). */
export function readReportConfig(settings: Record<string, unknown> | undefined | null): ReportConfig {
  const raw =
    settings?.reportConfig && typeof settings.reportConfig === "object" && !Array.isArray(settings.reportConfig)
      ? (settings.reportConfig as Record<string, unknown>)
      : {};

  const headerFooter = { ...DEFAULT_HEADER_FOOTER };
  if (raw.headerFooter && typeof raw.headerFooter === "object") {
    for (const [key, value] of Object.entries(raw.headerFooter as Record<string, unknown>)) {
      if (key in headerFooter && typeof value === "string") {
        headerFooter[key as keyof ReportHeaderFooterConfig] = value;
      }
    }
  }

  // Chưa cấu hình (dữ liệu cũ) = được xem mọi trường.
  const allowedFields = Object.fromEntries(
    REPORT_TYPE_IDS.map((id) => {
      const list = raw.allowedFields && typeof raw.allowedFields === "object"
        ? (raw.allowedFields as Record<string, unknown>)[id]
        : null;
      const all = REPORT_FIELDS[id].map((field) => field.key);
      const valid = Array.isArray(list) ? all.filter((key) => list.includes(key)) : [];
      return [id, valid.length ? valid : all];
    }),
  ) as Record<ReportTypeId, string[]>;

  const defaults = defaultSelectedFieldsByReport();
  const fieldsByReport = {} as Record<ReportTypeId, string[]>;
  for (const id of REPORT_TYPE_IDS) {
    const allowed = allowedFields[id];
    const list = raw.fieldsByReport && typeof raw.fieldsByReport === "object"
      ? (raw.fieldsByReport as Record<string, unknown>)[id]
      : null;
    // Trường theo thông số riêng của đồng hồ (param:…) không nằm trong danh sách chuẩn: giữ nguyên.
    const paramKeys = Array.isArray(list)
      ? list.filter((key): key is string => typeof key === "string" && key.startsWith(PARAM_FIELD_PREFIX))
      : [];
    const saved = Array.isArray(list) ? [...allowed.filter((key) => list.includes(key)), ...paramKeys] : [];
    const fallback = allowed.filter((key) => defaults[id].includes(key));
    fieldsByReport[id] = saved.length ? saved : fallback.length ? fallback : allowed;
  }

  const enabledRaw = Array.isArray(raw.enabledReports) ? raw.enabledReports : null;
  const enabled = enabledRaw ? REPORT_TYPE_IDS.filter((id) => enabledRaw.includes(id)) : [...REPORT_TYPE_IDS];

  const titles: Partial<Record<ReportTypeId, string>> = {};
  if (raw.titles && typeof raw.titles === "object") {
    for (const id of REPORT_TYPE_IDS) {
      const value = (raw.titles as Record<string, unknown>)[id];
      if (typeof value === "string" && value.trim()) titles[id] = value;
    }
  }

  const hiddenParamFields: Partial<Record<ReportTypeId, string[]>> = {};
  if (raw.hiddenParamFields && typeof raw.hiddenParamFields === "object") {
    for (const id of REPORT_TYPE_IDS) {
      const list = (raw.hiddenParamFields as Record<string, unknown>)[id];
      if (Array.isArray(list)) {
        const keys = list.filter((key): key is string => typeof key === "string" && key.startsWith(PARAM_FIELD_PREFIX));
        if (keys.length) hiddenParamFields[id] = keys;
      }
    }
  }

  const layoutRaw = raw.layout && typeof raw.layout === "object" ? (raw.layout as Record<string, unknown>) : {};
  const layout: ReportLayoutDefaults = {
    chart: layoutRaw.chart !== false,
    summary: layoutRaw.summary !== false,
    detail: layoutRaw.detail !== false,
    format: layoutRaw.format === ".xlsx" ? ".xlsx" : ".pdf",
  };

  return {
    headerFooter,
    fieldsByReport,
    allowedFields,
    // Không cho tắt hết: ít nhất còn báo cáo tổng hợp.
    enabledReports: enabled.length ? enabled : ["overview"],
    titles,
    layout,
    hiddenParamFields,
    ...(typeof raw.templateId === "string" && raw.templateId ? { templateId: raw.templateId } : {}),
  };
}
