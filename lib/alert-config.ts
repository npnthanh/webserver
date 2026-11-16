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

export type UserAlertRule = {
  id: string;
  groupId: UserAlertGroupId;
  name: string;
  parameterKey: string;
  minValue: string;
  maxValue: string;
  unit: string;
  severity: AlertSeverityLevel;
  enabled: boolean;
  meterPointId?: string;
  description?: string;
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

  let categories: UserAlertCategoryTab[] = DEFAULT_USER_ALERT_CATEGORIES.map((item) => ({ ...item }));
  if (Array.isArray(source.categories) && source.categories.length > 0) {
    categories = source.categories
      .map((item) => {
        if (item && typeof item === "object" && "id" in item && "label" in item) {
          return {
            id: String((item as { id: unknown }).id),
            label: String((item as { label: unknown }).label),
          };
        }
        return null;
      })
      .filter((item): item is UserAlertCategoryTab => Boolean(item));
  } else if (Array.isArray(source.tags) && source.tags.length > 0) {
    categories = source.tags
      .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      .map(mapTagToCategory);
  }
  if (categories.length === 0) {
    categories = DEFAULT_USER_ALERT_CATEGORIES.map((item) => ({ ...item }));
  }

  const rulesByGroup = cloneDefaultRulesByGroup();
  const hasUserRules =
    source.rulesByGroup &&
    typeof source.rulesByGroup === "object" &&
    !Array.isArray(source.rulesByGroup) &&
    Object.keys(source.rulesByGroup as Record<string, unknown>).length > 0;

  if (hasUserRules) {
    for (const [groupId, rawList] of Object.entries(source.rulesByGroup as Record<string, unknown>)) {
      if (!Array.isArray(rawList) || rawList.length === 0) continue;
      const parsed: UserAlertRule[] = [];
      for (const rawRule of rawList) {
        if (!rawRule || typeof rawRule !== "object") continue;
        const r = rawRule as Record<string, unknown>;
        const severity: AlertSeverityLevel =
          r.severity === "critical" || r.severity === "info" ? r.severity : "warning";
        parsed.push({
          id: typeof r.id === "string" && r.id ? r.id : `rule-${groupId}-${parsed.length + 1}`,
          groupId,
          name: typeof r.name === "string" ? r.name : "",
          parameterKey: typeof r.parameterKey === "string" ? r.parameterKey : "",
          minValue: typeof r.minValue === "string" ? r.minValue : "",
          maxValue: typeof r.maxValue === "string" ? r.maxValue : "",
          unit: typeof r.unit === "string" ? r.unit : "",
          severity,
          enabled: typeof r.enabled === "boolean" ? r.enabled : true,
          meterPointId: typeof r.meterPointId === "string" ? r.meterPointId : undefined,
          description: typeof r.description === "string" ? r.description : undefined,
        });
      }
      if (parsed.length > 0) {
        rulesByGroup[groupId] = parsed;
      }
    }
  } else if (
    adminSource.alarmsByCategory &&
    typeof adminSource.alarmsByCategory === "object" &&
    !Array.isArray(adminSource.alarmsByCategory)
  ) {
    for (const [groupId, rawList] of Object.entries(adminSource.alarmsByCategory as Record<string, unknown>)) {
      if (!Array.isArray(rawList) || rawList.length === 0) continue;
      const parsed: UserAlertRule[] = [];
      for (const rawRule of rawList) {
        if (!rawRule || typeof rawRule !== "object") continue;
        const r = rawRule as Record<string, unknown>;
        parsed.push({
          id: typeof r.id === "string" && r.id ? r.id : `rule-${groupId}-${parsed.length + 1}`,
          groupId,
          name: typeof r.name === "string" ? r.name : "",
          parameterKey: typeof r.parameterKey === "string" ? r.parameterKey : "",
          minValue: typeof r.minValue === "string" ? r.minValue : "",
          maxValue:
            typeof r.threshold === "string"
              ? r.threshold
              : typeof r.maxValue === "string"
                ? r.maxValue
                : "",
          unit: typeof r.unit === "string" ? r.unit : "",
          severity: "warning",
          enabled: true,
          description: typeof r.description === "string" ? r.description : undefined,
        });
      }
      if (parsed.length > 0) {
        rulesByGroup[groupId] = parsed;
      }
    }
  }

  for (const cat of categories) {
    if (!rulesByGroup[cat.id]) {
      rulesByGroup[cat.id] = DEFAULT_USER_ALERT_RULES[cat.id]?.map((r) => ({ ...r })) ?? [];
    }
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
