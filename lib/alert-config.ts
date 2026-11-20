export type AlertSeverityLevel = "critical" | "warning" | "info";

export type AlertCategoryId =
  | "frequency"
  | "voltage"
  | "current"
  | "unbalance"
  | "harmonics"
  | "power"
  | "connectivity";

export type UserAlertGroupId =
  | "energy"
  | "ui"
  | "frequency"
  | "power"
  | "harmonics"
  | "imbalance"
  | (string & {});

export type UserAlertCategoryTab = {
  id: UserAlertGroupId;
  label: string;
};

/** Cấu hình riêng của một điểm đo cho một ngưỡng. Min/Max để trống = dùng ngưỡng mặc định. */
export type AlertPointSetting = {
  enabled: boolean;
  minValue: string;
  maxValue: string;
};

export type UserAlertRule = {
  id: string;
  groupId: UserAlertGroupId;
  name: string;
  parameterKey: string;
  /** Ngưỡng mặc định áp cho các điểm đo (lấy từ thư viện cảnh báo của dự án). */
  minValue: string;
  maxValue: string;
  unit: string;
  severity: AlertSeverityLevel;
  enabled: boolean;
  /** Dữ liệu cũ: ngưỡng chỉ áp cho một điểm đo. */
  meterPointId?: string;
  description?: string;
  /** Ngưỡng gốc trong thư viện (để biết khách có chỉnh khác thư viện không). */
  libraryMin?: string;
  libraryMax?: string;
  /** Cấu hình theo từng điểm đo; điểm đo không có trong danh sách = áp dụng với ngưỡng mặc định. */
  points?: Record<string, AlertPointSetting>;
};

/** Phần khách hàng chỉnh trên một ngưỡng của thư viện (lưu trong alertsConfig.ruleOverrides). */
export type AlertRuleOverride = {
  enabled: boolean;
  severity: AlertSeverityLevel;
  /** Chỉ có khi chuyển từ dữ liệu cũ mà khách đã đặt ngưỡng khác thư viện. */
  minValue?: string;
  maxValue?: string;
  points?: Record<string, AlertPointSetting>;
};

export type NotificationChannelsConfig = {
  zaloEnabled: boolean;
  zaloRecipient: string;
  telegramEnabled: boolean;
  telegramChatId: string;
  emailEnabled: boolean;
  emailRecipient: string;
};

/** Không còn dữ liệu mẫu: kênh gửi thật cấu hình ở Cấu hình → Cấu hình thông báo. */
export const DEFAULT_NOTIFICATION_CHANNELS: NotificationChannelsConfig = {
  zaloEnabled: false,
  zaloRecipient: "",
  telegramEnabled: false,
  telegramChatId: "",
  emailEnabled: false,
  emailRecipient: "",
};

export type AlertConfig = {
  /** Mức độ mặc định theo danh mục lỗi (dùng trên trang Cảnh báo). */
  severityByCategory: Record<AlertCategoryId, AlertSeverityLevel>;
  /** Phân loại chế độ hiển thị trong tab 4. Cảnh báo */
  classify?: string;
  /** Các tab nhóm cảnh báo trên trang người dùng */
  categories: UserAlertCategoryTab[];
  /** Tab đang chọn */
  activeGroupId: UserAlertGroupId;
  /** Danh sách quy tắc ngưỡng cảnh báo theo từng nhóm */
  rulesByGroup: Record<string, UserAlertRule[]>;
  /** Kênh gửi thông báo cảnh báo (Zalo, Telegram, Email) */
  notifications: NotificationChannelsConfig;
  overConsumptionKwh?: string;
  dailyLimit?: number;
  peakHourWarning?: boolean;
};

export const DEFAULT_USER_ALERT_CATEGORIES: UserAlertCategoryTab[] = [
  { id: "energy", label: "Điện năng" },
  { id: "ui", label: "U/I" },
  { id: "frequency", label: "Tần số" },
  { id: "power", label: "Công suất" },
  { id: "harmonics", label: "Sóng hài" },
  { id: "imbalance", label: "Mất cân bằng pha" },
];

export const DEFAULT_USER_ALERT_RULES: Record<string, UserAlertRule[]> = {
  energy: [
    {
      id: "rule-energy-epaed",
      groupId: "energy",
      name: "Điện năng tác dụng nhận vượt ngưỡng",
      parameterKey: "EPaed",
      minValue: "",
      maxValue: "10000",
      unit: "kWh",
      severity: "warning",
      enabled: true,
      description: "Cảnh báo khi chỉ số điện năng tác dụng nhận (EPaed) vượt ngưỡng cài đặt",
    },
    {
      id: "rule-energy-eqred",
      groupId: "energy",
      name: "Điện năng phản kháng nhận vượt ngưỡng",
      parameterKey: "EQred",
      minValue: "",
      maxValue: "5000",
      unit: "kVARh",
      severity: "info",
      enabled: true,
      description: "Theo dõi điện năng phản kháng nhận (EQred) để kiểm soát bù công suất phản kháng",
    },
  ],
  ui: [
    {
      id: "rule-ui-van",
      groupId: "ui",
      name: "Ngưỡng điện áp pha A (Van)",
      parameterKey: "Van",
      minValue: "198",
      maxValue: "242",
      unit: "V",
      severity: "warning",
      enabled: true,
      description: "Sụt áp (< 198V) hoặc quá áp (> 242V) trên pha A",
    },
    {
      id: "rule-ui-vbn",
      groupId: "ui",
      name: "Ngưỡng điện áp pha B (Vbn)",
      parameterKey: "Vbn",
      minValue: "198",
      maxValue: "242",
      unit: "V",
      severity: "warning",
      enabled: true,
      description: "Sụt áp (< 198V) hoặc quá áp (> 242V) trên pha B",
    },
    {
      id: "rule-ui-vcn",
      groupId: "ui",
      name: "Ngưỡng điện áp pha C (Vcn)",
      parameterKey: "Vcn",
      minValue: "198",
      maxValue: "242",
      unit: "V",
      severity: "warning",
      enabled: true,
      description: "Sụt áp (< 198V) hoặc quá áp (> 242V) trên pha C",
    },
    {
      id: "rule-ui-vllavg",
      groupId: "ui",
      name: "Ngưỡng điện áp dây trung bình (VLLavg)",
      parameterKey: "VLLavg",
      minValue: "342",
      maxValue: "418",
      unit: "V",
      severity: "warning",
      enabled: true,
      description: "Giới hạn điện áp dây 3 pha tiêu chuẩn (±10% của 380V)",
    },
    {
      id: "rule-ui-ia",
      groupId: "ui",
      name: "Quá dòng pha A (Ia)",
      parameterKey: "Ia",
      minValue: "",
      maxValue: "100",
      unit: "A",
      severity: "critical",
      enabled: true,
      description: "Cảnh báo quá tải dòng điện trên pha A",
    },
    {
      id: "rule-ui-ib",
      groupId: "ui",
      name: "Quá dòng pha B (Ib)",
      parameterKey: "Ib",
      minValue: "",
      maxValue: "100",
      unit: "A",
      severity: "critical",
      enabled: true,
      description: "Cảnh báo quá tải dòng điện trên pha B",
    },
    {
      id: "rule-ui-ic",
      groupId: "ui",
      name: "Quá dòng pha C (Ic)",
      parameterKey: "Ic",
      minValue: "",
      maxValue: "100",
      unit: "A",
      severity: "critical",
      enabled: true,
      description: "Cảnh báo quá tải dòng điện trên pha C",
    },
  ],
  frequency: [
    {
      id: "rule-freq-f",
      groupId: "frequency",
      name: "Độ lệch tần số lưới điện (F)",
      parameterKey: "F",
      minValue: "49.5",
      maxValue: "50.5",
      unit: "Hz",
      severity: "warning",
      enabled: true,
      description: "Tần số lưới điện nằm ngoài dải vận hành chuẩn 49.5 – 50.5 Hz",
    },
  ],
  power: [
    {
      id: "rule-power-papt",
      groupId: "power",
      name: "Quá tải tổng công suất tác dụng (Papt)",
      parameterKey: "Papt",
      minValue: "",
      maxValue: "500",
      unit: "kW",
      severity: "critical",
      enabled: true,
      description: "Tổng công suất tác dụng 3 pha vượt công suất định mức cho phép",
    },
    {
      id: "rule-power-sapt",
      groupId: "power",
      name: "Tổng công suất biểu kiến (Sapt)",
      parameterKey: "Sapt",
      minValue: "",
      maxValue: "600",
      unit: "kVA",
      severity: "warning",
      enabled: true,
      description: "Giám sát dung lượng mang tải máy biến áp / nhánh tổng (kVA)",
    },
    {
      id: "rule-power-pft",
      groupId: "power",
      name: "Hệ số công suất trung bình thấp (PFt)",
      parameterKey: "PFt",
      minValue: "0.9",
      maxValue: "1.0",
      unit: "",
      severity: "warning",
      enabled: true,
      description: "Cảnh báo khi cosφ / PF trung bình tụt dưới 0.90 gây phạt công suất phản kháng",
    },
  ],
  harmonics: [
    {
      id: "rule-harm-thdvan",
      groupId: "harmonics",
      name: "Sóng hài tổng điện áp pha A (THDVan)",
      parameterKey: "THDVan",
      minValue: "",
      maxValue: "5",
      unit: "%",
      severity: "warning",
      enabled: true,
      description: "Tổng biến dạng sóng hài điện áp pha A vượt chuẩn IEEE 519 (5%)",
    },
    {
      id: "rule-harm-thdvbn",
      groupId: "harmonics",
      name: "Sóng hài tổng điện áp pha B (THDVbn)",
      parameterKey: "THDVbn",
      minValue: "",
      maxValue: "5",
      unit: "%",
      severity: "warning",
      enabled: true,
      description: "Tổng biến dạng sóng hài điện áp pha B vượt chuẩn IEEE 519 (5%)",
    },
    {
      id: "rule-harm-thdvcn",
      groupId: "harmonics",
      name: "Sóng hài tổng điện áp pha C (THDVcn)",
      parameterKey: "THDVcn",
      minValue: "",
      maxValue: "5",
      unit: "%",
      severity: "warning",
      enabled: true,
      description: "Tổng biến dạng sóng hài điện áp pha C vượt chuẩn IEEE 519 (5%)",
    },
    {
      id: "rule-harm-thdca",
      groupId: "harmonics",
      name: "Sóng hài tổng dòng điện pha A (THDCa)",
      parameterKey: "THDCa",
      minValue: "",
      maxValue: "15",
      unit: "%",
      severity: "info",
      enabled: true,
      description: "Tổng biến dạng sóng hài dòng điện pha A vượt 15%",
    },
    {
      id: "rule-harm-thdcb",
      groupId: "harmonics",
      name: "Sóng hài tổng dòng điện pha B (THDCb)",
      parameterKey: "THDCb",
      minValue: "",
      maxValue: "15",
      unit: "%",
      severity: "info",
      enabled: true,
      description: "Tổng biến dạng sóng hài dòng điện pha B vượt 15%",
    },
    {
      id: "rule-harm-thdcc",
      groupId: "harmonics",
      name: "Sóng hài tổng dòng điện pha C (THDCc)",
      parameterKey: "THDCc",
      minValue: "",
      maxValue: "15",
      unit: "%",
      severity: "info",
      enabled: true,
      description: "Tổng biến dạng sóng hài dòng điện pha C vượt 15%",
    },
  ],
  imbalance: [
    {
      id: "rule-imb-vuan",
      groupId: "imbalance",
      name: "Mất cân bằng điện áp pha A (Vuan)",
      parameterKey: "Vuan",
      minValue: "",
      maxValue: "3",
      unit: "%",
      severity: "warning",
      enabled: true,
      description: "Độ lệch cân bằng điện áp pha A vượt 3%",
    },
    {
      id: "rule-imb-vubn",
      groupId: "imbalance",
      name: "Mất cân bằng điện áp pha B (Vubn)",
      parameterKey: "Vubn",
      minValue: "",
      maxValue: "3",
      unit: "%",
      severity: "warning",
      enabled: true,
      description: "Độ lệch cân bằng điện áp pha B vượt 3%",
    },
    {
      id: "rule-imb-vucn",
      groupId: "imbalance",
      name: "Mất cân bằng điện áp pha C (Vucn)",
      parameterKey: "Vucn",
      minValue: "",
      maxValue: "3",
      unit: "%",
      severity: "warning",
      enabled: true,
      description: "Độ lệch cân bằng điện áp pha C vượt 3%",
    },
    {
      id: "rule-imb-iua",
      groupId: "imbalance",
      name: "Mất cân bằng dòng điện pha A (IuA)",
      parameterKey: "IuA",
      minValue: "",
      maxValue: "10",
      unit: "%",
      severity: "warning",
      enabled: true,
      description: "Độ lệch cân bằng dòng điện pha A vượt 10%",
    },
    {
      id: "rule-imb-iub",
      groupId: "imbalance",
      name: "Mất cân bằng dòng điện pha B (IuB)",
      parameterKey: "IuB",
      minValue: "",
      maxValue: "10",
      unit: "%",
      severity: "warning",
      enabled: true,
      description: "Độ lệch cân bằng dòng điện pha B vượt 10%",
    },
    {
      id: "rule-imb-iuc",
      groupId: "imbalance",
      name: "Mất cân bằng dòng điện pha C (IuC)",
      parameterKey: "IuC",
      minValue: "",
      maxValue: "10",
      unit: "%",
      severity: "warning",
      enabled: true,
      description: "Độ lệch cân bằng dòng điện pha C vượt 10%",
    },
  ],
};

export const ALERT_CATEGORY_OPTIONS: { id: AlertCategoryId; label: string; hint: string }[] = [
  { id: "frequency", label: "Tần số", hint: "F, lệch tần số lưới" },
  { id: "voltage", label: "Điện áp", hint: "Sụt áp / quá áp" },
  { id: "current", label: "Dòng điện", hint: "Quá dòng" },
  { id: "unbalance", label: "Mất cân bằng pha", hint: "Lệch pha U/I" },
  { id: "harmonics", label: "Sóng hài", hint: "THD" },
  { id: "power", label: "Công suất", hint: "Giờ cao điểm / quá tải" },
  { id: "connectivity", label: "Kết nối", hint: "Mất gateway / RTU" },
];

export const DEFAULT_SEVERITY_BY_CATEGORY: Record<AlertCategoryId, AlertSeverityLevel> = {
  frequency: "warning",
  voltage: "warning",
  current: "critical",
  unbalance: "warning",
  harmonics: "info",
  power: "warning",
  connectivity: "critical",
};

export function cloneDefaultRulesByGroup(): Record<string, UserAlertRule[]> {
  return Object.fromEntries(
    Object.entries(DEFAULT_USER_ALERT_RULES).map(([group, list]) => [
      group,
      list.map((item) => ({ ...item })),
    ]),
  );
}

function mapTagToCategory(tag: string): UserAlertCategoryTab {
  const normalized = tag.trim().toLowerCase();
  if (normalized === "energy" || normalized === "điện năng") return { id: "energy", label: "Điện năng" };
  if (normalized === "u/i" || normalized === "ui") return { id: "ui", label: "U/I" };
  if (normalized === "tần số" || normalized === "frequency") return { id: "frequency", label: "Tần số" };
  if (normalized === "công suất" || normalized === "power") return { id: "power", label: "Công suất" };
  if (normalized === "sóng hài" || normalized === "harmonics") return { id: "harmonics", label: "Sóng hài" };
  if (normalized === "mất cân bằng pha" || normalized === "imbalance") {
    return { id: "imbalance", label: "Mất cân bằng pha" };
  }
  return {
    id: normalized.replace(/\s+/g, "-") || `custom-${Date.now()}`,
    label: tag.trim() || "Nhóm mới",
  };
}

export function normalizeAlertConfig(raw: unknown, fallbackAdminRaw?: unknown): AlertConfig {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const adminSource =
    fallbackAdminRaw && typeof fallbackAdminRaw === "object" && !Array.isArray(fallbackAdminRaw)
      ? (fallbackAdminRaw as Record<string, unknown>)
      : {};
  const map = source.severityByCategory;
  const severityByCategory = { ...DEFAULT_SEVERITY_BY_CATEGORY };
  if (map && typeof map === "object" && !Array.isArray(map)) {
    for (const option of ALERT_CATEGORY_OPTIONS) {
      const value = (map as Record<string, unknown>)[option.id];
      if (value === "critical" || value === "warning" || value === "info") {
        severityByCategory[option.id] = value;
      }
    }
  }

  // Danh sách ngưỡng LUÔN lấy từ thư viện cảnh báo của dự án (trang quản trị → Cấu hình cảnh báo tức thời
  // đồng hồ); khách hàng chỉ bật / tắt, chọn mức độ và đặt ngưỡng riêng cho từng điểm đo.
  const libraryByGroup = readLibraryRules(adminSource);
  const overrides = readRuleOverrides(source, libraryByGroup);

  const labelById = new Map<string, string>(DEFAULT_USER_ALERT_CATEGORIES.map((item) => [item.id, item.label]));
  const adminCategories = adminSource.categoriesByUtility;
  if (adminCategories && typeof adminCategories === "object" && !Array.isArray(adminCategories)) {
    for (const list of Object.values(adminCategories as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (item && typeof item === "object" && "id" in item && "label" in item) {
          const id = String((item as { id: unknown }).id);
          if (!labelById.has(id)) labelById.set(id, String((item as { label: unknown }).label));
        }
      }
    }
  }

  const rulesByGroup: Record<string, UserAlertRule[]> = {};
  for (const [groupId, rules] of Object.entries(libraryByGroup)) {
    rulesByGroup[groupId] = rules.map((rule) => {
      const override = overrides[rule.id];
      return {
        ...rule,
        libraryMin: rule.minValue,
        libraryMax: rule.maxValue,
        enabled: override?.enabled ?? rule.enabled,
        severity: override?.severity ?? rule.severity,
        minValue: override?.minValue ?? rule.minValue,
        maxValue: override?.maxValue ?? rule.maxValue,
        ...(override?.points && Object.keys(override.points).length ? { points: override.points } : {}),
      };
    });
  }

  // Nhóm hiển thị = nhóm của thư viện có ngưỡng (theo thứ tự mặc định, nhóm thêm của admin xếp sau).
  const order = DEFAULT_USER_ALERT_CATEGORIES.map((item) => item.id as string);
  let categories: UserAlertCategoryTab[] = Object.keys(rulesByGroup)
    .filter((groupId) => rulesByGroup[groupId].length > 0)
    .sort((x, y) => {
      const ix = order.indexOf(x);
      const iy = order.indexOf(y);
      return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
    })
    .map((id) => ({ id, label: labelById.get(id) ?? id }));
  if (categories.length === 0) {
    categories = DEFAULT_USER_ALERT_CATEGORIES.map((item) => ({ ...item }));
    for (const cat of categories) rulesByGroup[cat.id] ??= [];
  }

  let activeGroupId: UserAlertGroupId = categories[0]?.id ?? "energy";
  if (typeof source.activeGroupId === "string" && categories.some((c) => c.id === source.activeGroupId)) {
    activeGroupId = source.activeGroupId;
  } else if (typeof source.activeTag === "string") {
    const mapped = mapTagToCategory(source.activeTag);
    if (categories.some((c) => c.id === mapped.id)) {
      activeGroupId = mapped.id;
    }
  }

  const overConsumptionKwh =
    typeof source.overConsumptionKwh === "string" && source.overConsumptionKwh.trim()
      ? source.overConsumptionKwh
      : typeof source.threshold === "string" && source.threshold.trim()
        ? source.threshold
        : "1500";

  const dailyLimit =
    typeof source.dailyLimit === "number" && source.dailyLimit > 0 ? source.dailyLimit : 5000;

  const peakHourWarning =
    typeof source.peakHourWarning === "boolean"
      ? source.peakHourWarning
      : typeof source.peakWarn === "boolean"
        ? source.peakWarn
        : true;

  const rawNotif =
    source.notifications && typeof source.notifications === "object" && !Array.isArray(source.notifications)
      ? (source.notifications as Record<string, unknown>)
      : {};
  const notifications: NotificationChannelsConfig = {
    zaloEnabled:
      typeof rawNotif.zaloEnabled === "boolean"
        ? rawNotif.zaloEnabled
        : DEFAULT_NOTIFICATION_CHANNELS.zaloEnabled,
    zaloRecipient:
      typeof rawNotif.zaloRecipient === "string"
        ? rawNotif.zaloRecipient
        : DEFAULT_NOTIFICATION_CHANNELS.zaloRecipient,
    telegramEnabled:
      typeof rawNotif.telegramEnabled === "boolean"
        ? rawNotif.telegramEnabled
        : DEFAULT_NOTIFICATION_CHANNELS.telegramEnabled,
    telegramChatId:
      typeof rawNotif.telegramChatId === "string"
        ? rawNotif.telegramChatId
        : DEFAULT_NOTIFICATION_CHANNELS.telegramChatId,
    emailEnabled:
      typeof rawNotif.emailEnabled === "boolean"
        ? rawNotif.emailEnabled
        : DEFAULT_NOTIFICATION_CHANNELS.emailEnabled,
    emailRecipient:
      typeof rawNotif.emailRecipient === "string"
        ? rawNotif.emailRecipient
        : DEFAULT_NOTIFICATION_CHANNELS.emailRecipient,
  };

  return {
    severityByCategory,
    classify: typeof source.classify === "string" ? source.classify : "Cấu hình ngưỡng theo thông số đo",
    categories,
    activeGroupId,
    rulesByGroup,
    notifications,
    overConsumptionKwh,
    dailyLimit,
    peakHourWarning,
  };
}

function textField(value: unknown) {
  return typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/** Thư viện ngưỡng của dự án (alertConfig.alarmsByCategory do admin cấu hình); chưa cấu hình thì dùng bộ mặc định. */
function readLibraryRules(adminSource: Record<string, unknown>): Record<string, UserAlertRule[]> {
  const raw = adminSource.alarmsByCategory;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return cloneDefaultRulesByGroup();
  const result: Record<string, UserAlertRule[]> = {};
  for (const [groupId, rawList] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(rawList)) continue;
    const parsed: UserAlertRule[] = [];
    for (const rawRule of rawList) {
      if (!rawRule || typeof rawRule !== "object") continue;
      const r = rawRule as Record<string, unknown>;
      const parameterKey = textField(r.parameterKey);
      if (!parameterKey) continue;
      parsed.push({
        id: textField(r.id) || `rule-${groupId}-${parsed.length + 1}`,
        groupId,
        name: textField(r.name) || parameterKey,
        parameterKey,
        minValue: textField(r.minValue),
        maxValue: textField(r.threshold) || textField(r.maxValue),
        unit: textField(r.unit),
        severity: r.severity === "critical" || r.severity === "info" ? r.severity : "warning",
        enabled: true,
        description: textField(r.description) || undefined,
      });
    }
    // Danh sách rỗng đã lưu = admin đã xoá hết ngưỡng của nhóm này.
    result[groupId] = parsed;
  }
  return result;
}

function readPointSettings(raw: unknown): Record<string, AlertPointSetting> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const points: Record<string, AlertPointSetting> = {};
  for (const [pointId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    points[pointId] = {
      enabled: v.enabled !== false,
      minValue: textField(v.minValue),
      maxValue: textField(v.maxValue),
    };
  }
  return Object.keys(points).length ? points : undefined;
}

/**
 * Phần khách hàng chỉnh trên từng ngưỡng thư viện. Dữ liệu cũ (alertsConfig.rulesByGroup — danh sách ngưỡng
 * khách tự tạo) được chuyển sang: khớp theo nhóm + tham số đo với ngưỡng thư viện.
 */
function readRuleOverrides(
  source: Record<string, unknown>,
  libraryByGroup: Record<string, UserAlertRule[]>,
): Record<string, AlertRuleOverride> {
  const raw = source.ruleOverrides;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const result: Record<string, AlertRuleOverride> = {};
    for (const [ruleId, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      result[ruleId] = {
        enabled: v.enabled !== false,
        severity: v.severity === "critical" || v.severity === "info" ? v.severity : "warning",
        ...(typeof v.minValue === "string" ? { minValue: v.minValue } : {}),
        ...(typeof v.maxValue === "string" ? { maxValue: v.maxValue } : {}),
        ...(readPointSettings(v.points) ? { points: readPointSettings(v.points) } : {}),
      };
    }
    return result;
  }

  const legacy = source.rulesByGroup;
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return {};
  const result: Record<string, AlertRuleOverride> = {};
  for (const [groupId, rawList] of Object.entries(legacy as Record<string, unknown>)) {
    if (!Array.isArray(rawList)) continue;
    for (const rawRule of rawList) {
      if (!rawRule || typeof rawRule !== "object") continue;
      const r = rawRule as Record<string, unknown>;
      const library = (libraryByGroup[groupId] ?? []).find((rule) => rule.parameterKey === r.parameterKey);
      if (!library) continue;
      const severity: AlertSeverityLevel = r.severity === "critical" || r.severity === "info" ? r.severity : "warning";
      const enabled = r.enabled !== false;
      const minValue = textField(r.minValue);
      const maxValue = textField(r.maxValue);
      const current = result[library.id] ?? { enabled, severity };
      if (typeof r.meterPointId === "string" && r.meterPointId) {
        current.points = { ...(current.points ?? {}), [r.meterPointId]: { enabled, minValue, maxValue } };
      } else {
        current.enabled = enabled;
        current.severity = severity;
        if (minValue !== library.minValue) current.minValue = minValue;
        if (maxValue !== library.maxValue) current.maxValue = maxValue;
      }
      result[library.id] = current;
    }
  }
  return result;
}

/** Phần cần lưu (alertsConfig.ruleOverrides) từ danh sách ngưỡng đang chỉnh. */
export function buildRuleOverrides(rulesByGroup: Record<string, UserAlertRule[]>) {
  const result: Record<string, AlertRuleOverride> = {};
  for (const rules of Object.values(rulesByGroup)) {
    for (const rule of rules) {
      result[rule.id] = {
        enabled: rule.enabled,
        severity: rule.severity,
        ...(rule.libraryMin !== undefined && rule.minValue !== rule.libraryMin ? { minValue: rule.minValue } : {}),
        ...(rule.libraryMax !== undefined && rule.maxValue !== rule.libraryMax ? { maxValue: rule.maxValue } : {}),
        ...(rule.points && Object.keys(rule.points).length ? { points: rule.points } : {}),
      };
    }
  }
  return result;
}

/**
 * Ngưỡng của `rule` áp cho điểm đo `pointId`, hoặc null nếu ngưỡng tắt / không áp dụng cho điểm đo này.
 * Min/Max riêng của điểm đo để trống thì dùng ngưỡng mặc định của ngưỡng.
 */
export function ruleThresholdsForPoint(rule: UserAlertRule, pointId: string) {
  if (!rule.enabled) return null;
  if (rule.meterPointId && rule.meterPointId !== pointId) return null;
  const point = rule.points?.[pointId];
  if (point && !point.enabled) return null;
  return {
    minValue: point?.minValue.trim() ? point.minValue : rule.minValue,
    maxValue: point?.maxValue.trim() ? point.maxValue : rule.maxValue,
  };
}

export function resolveConfiguredSeverity(
  category: string | undefined,
  fallback: AlertSeverityLevel,
  config: AlertConfig,
  parameterKey?: string,
): AlertSeverityLevel {
  if (parameterKey === "Kết nối trở lại" || fallback === "info") {
    return "info";
  }
  if (parameterKey) {
    for (const rules of Object.values(config.rulesByGroup ?? {})) {
      const matched = rules.find((r) => r.parameterKey === parameterKey && r.enabled);
      if (matched) return matched.severity;
    }
  }
  if (category && category in config.severityByCategory) {
    return config.severityByCategory[category as AlertCategoryId];
  }
  return fallback;
}
