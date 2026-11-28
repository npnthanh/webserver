"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { loadAlertTemplates, type AlertTemplate } from "@/lib/alert-library";
import { DEFAULT_USER_ALERT_RULES } from "@/lib/alert-config";
import { alarmName, alarmUnitHint } from "@/lib/gateway-protocol";
import {
  METER_PARAMETERS,
  parametersForChart,
  readMeterValue,
  type MeterChartId,
  type MeterParameter,
} from "@/lib/meter-parameters";
import { hydrateProjectSettings, loadProjectSettings, saveProjectSettings } from "@/lib/project-settings";
import { hydrateDevices, loadDevices, type CatalogDevice } from "@/lib/devices";
import type { MeterType } from "@/lib/projects";

type CategoryId =
  | "energy"
  | "ui"
  | "frequency"
  | "power"
  | "harmonics"
  | "imbalance"
  | (string & {});

type Alarm = {
  id: string;
  /** Khóa tham số trong VAL gateway bắn về (VD: THDVan, Van, Ia, F, Papt...) hoặc mã IDAlarm */
  parameterKey?: string;
  /** Mã IDAlarm gateway bắn về (nếu dùng cảnh báo phần cứng IDAlarm) */
  alarmId: string;
  name: string;
  description: string;
  /** Ngưỡng Min so với giá trị gateway gửi về */
  minValue?: string;
  /** Ngưỡng Max (hoặc ngưỡng cảnh báo chính) so với giá trị gateway gửi về */
  threshold: string;
  unit: string;
  current: string;
  /** ID bản ghi trong bảng gateway_thresholds nếu đã đồng bộ */
  gatewayThresholdId?: number;
};

type GatewayDeviceSnapshot = {
  gatewayId: string;
  meterModel: string | null;
  meterId: string | null;
  lastSeenAt: string | null;
  lastValues: Record<string, unknown> | null;
};

type LiveGatewayAlarm = {
  id: number;
  source: "gateway" | "threshold";
  alarmCode: number | null;
  alarmName: string | null;
  alarmValue: number | null;
  parameterName: string | null;
  parameterValue: number | null;
  minValue: number | null;
  maxValue: number | null;
  occurredAt: string | null;
  meterId: string | null;
};

type GatewayThresholdRow = {
  id: number;
  gatewayId: string;
  meterModel: string;
  meterId: string;
  parameterName: string;
  minValue: number | null;
  maxValue: number | null;
};

type Category = {
  id: CategoryId;
  label: string;
  icon: (props: { className?: string }) => ReactNode;
};

const presetCategories: Category[] = [
  { id: "energy", label: "Điện năng", icon: BoltIcon },
  { id: "ui", label: "U/I", icon: GaugeIcon },
  { id: "frequency", label: "Tần số", icon: WaveIcon },
  { id: "power", label: "Công suất", icon: PowerIcon },
  { id: "harmonics", label: "Sóng hài", icon: HarmonicIcon },
  { id: "imbalance", label: "Mất cân bằng pha", icon: ImbalanceIcon },
];

const extraCategories: Category[] = [
  { id: "temperature", label: "Nhiệt độ", icon: ThermoIcon },
  { id: "quality", label: "Chất lượng điện", icon: QualityIcon },
  { id: "water", label: "Nước", icon: DropIcon },
  { id: "steam", label: "Hơi", icon: SteamIcon },
];

const catalogCategories: Category[] = [...presetCategories, ...extraCategories];

const ELECTRICITY_CATEGORY_IDS: CategoryId[] = [
  "energy",
  "ui",
  "frequency",
  "power",
  "harmonics",
  "imbalance",
];

function chartIdForCategory(categoryId: string): MeterChartId | null {
  switch (categoryId) {
    case "energy":
      return "energy";
    case "ui":
      return "ui";
    case "frequency":
      return "freq";
    case "power":
      return "power";
    case "harmonics":
      return "harm";
    case "imbalance":
      return "unbalance";
    default:
      return null;
  }
}

function parametersForCategory(categoryId: string): MeterParameter[] {
  const chartId = chartIdForCategory(categoryId);
  if (!chartId) return METER_PARAMETERS;
  return parametersForChart(chartId);
}

function isElectricUtility(utility: string) {
  const value = utility.toLowerCase();
  return value.includes("điện") || value.includes("dien");
}

/**
 * Tham số của loại điểm đo không phải điện = các dòng "Hàm nhận dữ liệu từ gateway" đã khai báo cho đồng hồ
 * cùng loại (Thư viện loại đồng hồ). Không dùng bộ 97 tham số của đồng hồ điện.
 */
function declaredParametersForUtility(utility: string, devices: CatalogDevice[]): MeterParameter[] {
  const list: MeterParameter[] = [];
  for (const device of devices) {
    if (device.type !== utility) continue;
    for (const row of device.registers ?? []) {
      const key = row.address?.trim();
      if (!key || list.some((item) => item.key === key)) continue;
      list.push({
        id: 10_000 + list.length,
        group: "Hàm nhận dữ liệu",
        chart: "energy",
        name: row.name?.trim() || key,
        unit: row.unit?.trim() || "",
        key,
      });
    }
  }
  return list;
}

function uniqueUtilities(values: string[]): MeterType[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function utilityIcon(utility: string): Category["icon"] {
  const value = utility.toLowerCase();
  if (value.includes("điện") || value.includes("dien")) return BoltIcon;
  if (value.includes("nước") || value.includes("nuoc")) return DropIcon;
  if (value.includes("nhiệt") || value.includes("nhiet")) return ThermoIcon;
  if (value.includes("hơi") || value.includes("hoi")) return SteamIcon;
  return TagIcon;
}

function categoriesForUtility(utility: string): Category[] {
  const value = utility.toLowerCase();
  const ids = value.includes("điện") || value.includes("dien")
    ? ELECTRICITY_CATEGORY_IDS
    : value.includes("nước") || value.includes("nuoc")
      ? (["water"] as CategoryId[])
      : value.includes("nhiệt") || value.includes("nhiet")
        ? (["temperature"] as CategoryId[])
        : value.includes("hơi") || value.includes("hoi")
          ? (["steam"] as CategoryId[])
          : [];
  const categories = ids
    .map((id) => catalogCategories.find((category) => category.id === id))
    .filter((category): category is Category => Boolean(category));
  return categories.length > 0
    ? categories
    : [{ id: `utility-${utility.toLowerCase().replace(/\s+/g, "-")}`, label: utility, icon: utilityIcon(utility) }];
}

/** Id các nhóm cảnh báo của một loại điểm đo (nhóm mặc định + nhóm đã lưu thêm). */
function utilityCategoryIds(utility: string, categoriesByUtility: Record<string, Category[]>) {
  const ids = categoriesForUtility(utility).map((category) => category.id as string);
  for (const category of categoriesByUtility[utility] ?? []) {
    if (!ids.includes(category.id)) ids.push(category.id);
  }
  return ids;
}

function buildCategoryMap(utilities: string[]) {
  return Object.fromEntries(utilities.map((utility) => [utility, categoriesForUtility(utility)])) as Record<string, Category[]>;
}

function buildDefaultAlarmsByCategory(): Record<string, Alarm[]> {
  return Object.fromEntries(
    Object.entries(DEFAULT_USER_ALERT_RULES).map(([catId, rules]) => [
      catId,
      rules.map((r, idx) => {
        const param = METER_PARAMETERS.find((p) => p.key === r.parameterKey);
        return {
          id: r.id,
          parameterKey: r.parameterKey,
          alarmId: String(param?.id ?? idx + 1),
          name: r.name,
          description: r.description ?? `Tham số gateway: ${r.parameterKey}`,
          minValue: r.minValue,
          threshold: r.maxValue,
          unit: r.unit,
          current: "",
        };
      }),
    ]),
  );
}

const initialAlarms: Record<string, Alarm[]> = buildDefaultAlarmsByCategory();

function newAlarmId(categoryId: string) {
  return `${categoryId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function defaultUnitForCategory(categoryId: string) {
  return alarmUnitHint(null, categoryId) || "";
}

function normalizeAlarm(alarm: Alarm, categoryId: string, index: number): Alarm | null {
  // Bỏ các dòng rác rỗng từ phiên bản cũ (threshold = "0", unit = "V", name = "")
  if (!alarm.parameterKey && !alarm.name.trim() && alarm.threshold === "0" && alarm.unit === "V") {
    return null;
  }
  const catParams = parametersForCategory(categoryId);
  const matchedParam = alarm.parameterKey
    ? METER_PARAMETERS.find((p) => p.key === alarm.parameterKey)
    : catParams[index] ?? catParams[0];

  const parameterKey = alarm.parameterKey || matchedParam?.key || "";
  const isLegacyZeroVolt = alarm.unit === "V" && alarm.threshold === "0" && categoryId !== "ui";
  const unit = isLegacyZeroVolt
    ? matchedParam?.unit || defaultUnitForCategory(categoryId)
    : alarm.unit || matchedParam?.unit || defaultUnitForCategory(categoryId);

  const isNumericName = /^\d+(\.\d+)?$/.test(alarm.name.trim());
  const threshold =
    isLegacyZeroVolt && isNumericName
      ? alarm.name.trim()
      : alarm.threshold === "0" && !alarm.minValue
        ? ""
        : alarm.threshold;
  const name =
    isLegacyZeroVolt && isNumericName
      ? matchedParam
        ? `Cảnh báo ${matchedParam.name}`
        : ""
      : alarm.name || (matchedParam ? `Cảnh báo ${matchedParam.name}` : "");

  return {
    ...alarm,
    parameterKey,
    alarmId: alarm.alarmId || String(matchedParam?.id ?? index + 1),
    name,
    description:
      alarm.description && alarm.description !== "Mô tả điều kiện kích hoạt cảnh báo"
        ? alarm.description
        : matchedParam
          ? `Tham số gateway: ${matchedParam.key} (${matchedParam.group})`
          : "So sánh trực tiếp với giá trị tức thời gateway bắn về",
    minValue: alarm.minValue ?? "",
    threshold,
    unit,
    current: alarm.current === "--.-" ? "" : alarm.current,
  };
}

export function AlertConfig({
  projectId = "",
  initialUtilities,
  mode = "project",
  libraryAlarms,
  onLibraryAlarmsChange,
}: {
  projectId?: string;
  initialUtilities: MeterType[];
  /** Chế độ thư viện: ngưỡng của mẫu đang sửa (trang Thư viện cảnh báo giữ danh sách mẫu). */
  libraryAlarms?: Record<string, unknown[]>;
  onLibraryAlarmsChange?: (alarmsByCategory: Record<string, unknown[]>) => void;
  /**
   * "project": thư viện cảnh báo của một dự án (lưu project_settings, đồng bộ ngưỡng xuống gateway).
   * "library": thư viện cảnh báo dùng chung theo loại điểm đo (bảng alert_library) — chỉ là mẫu,
   * không đẩy ngưỡng xuống gateway; dự án chép mẫu bằng nút "Áp dụng từ thư viện".
   */
  mode?: "project" | "library";
}) {
  const isLibrary = mode === "library";
  const utilities = useMemo(() => uniqueUtilities(initialUtilities), [initialUtilities]);
  const firstUtility = utilities[0] ?? "Điện";
  const [activeUtility, setActiveUtility] = useState<MeterType>(firstUtility);
  const [categoriesByUtility, setCategoriesByUtility] = useState<Record<string, Category[]>>(() =>
    buildCategoryMap(utilities.length ? utilities : [firstUtility]),
  );
  const [alarmsByCategory, setAlarmsByCategory] = useState(initialAlarms);
  const [gateways, setGateways] = useState<GatewayDeviceSnapshot[]>([]);
  const [liveAlarms, setLiveAlarms] = useState<LiveGatewayAlarm[]>([]);
  const [gatewayThresholds, setGatewayThresholds] = useState<GatewayThresholdRow[]>([]);
  const [syncNotice, setSyncNotice] = useState("");
  const [settingsReady, setSettingsReady] = useState(false);
  const [showAllLiveParams, setShowAllLiveParams] = useState(false);
  /** Mẫu thư viện chờ xác nhận áp dụng (trang cảnh báo của dự án). */
  const [pendingTemplate, setPendingTemplate] = useState<AlertTemplate | null>(null);
  const [templates, setTemplates] = useState<AlertTemplate[]>([]);
  /** Mẫu đang áp dụng cho từng loại điểm đo của dự án. */
  const [templateByUtility, setTemplateByUtility] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isLibrary) return;
    let active = true;
    void loadAlertTemplates()
      .then((list) => {
        if (active) setTemplates(list);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [isLibrary]);
  const [devices, setDevices] = useState<CatalogDevice[]>(loadDevices);

  useEffect(() => {
    const reloadDevices = () => void hydrateDevices().then(setDevices);
    reloadDevices();
    window.addEventListener("ems-devices-changed", reloadDevices);
    return () => window.removeEventListener("ems-devices-changed", reloadDevices);
  }, []);

  async function loadGatewayLive() {
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const response = await fetch(`/api/gateway/console?from=${encodeURIComponent(from)}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as {
        gateways?: GatewayDeviceSnapshot[];
        alarms?: LiveGatewayAlarm[];
        thresholds?: GatewayThresholdRow[];
      };
      setGateways(data.gateways ?? []);
      setLiveAlarms(data.alarms ?? []);
      setGatewayThresholds(data.thresholds ?? []);
    } catch {
      // Ignore network errors on background poll
    }
  }

  useEffect(() => {
    void loadGatewayLive();
  }, []);

  useEffect(() => {
    let active = true;
    setSettingsReady(false);
    const loadSaved: Promise<unknown> = isLibrary
      ? Promise.resolve({ alarmsByCategory: libraryAlarms ?? {} })
      : hydrateProjectSettings(projectId).then((payload) => payload.alertConfig);
    void loadSaved
      .then((rawSaved) => {
        if (!active) return;
        const saved = rawSaved as
          | {
              categories?: Array<{ id: string; label: string }>;
              categoriesByUtility?: Record<string, Array<{ id: string; label: string }>>;
              activeUtility?: string;
              activeId?: string;
              alarmsByCategory?: Record<string, Alarm[]>;
              templateByUtility?: Record<string, string>;
            }
          | undefined;
        const restoreCategory = (item: { id: string; label: string }) => {
          const catalog = catalogCategories.find((category) => category.id === item.id);
          return catalog ?? { id: item.id, label: item.label, icon: TagIcon };
        };
        const defaults = buildCategoryMap(utilities.length ? utilities : [firstUtility]);
        const savedByUtility = saved?.categoriesByUtility;
        if (savedByUtility) {
          for (const utility of Object.keys(defaults)) {
            const savedCategories = savedByUtility[utility];
            if (savedCategories?.length) defaults[utility] = savedCategories.map(restoreCategory);
          }
        } else if (saved?.categories?.length && defaults[firstUtility]) {
          defaults[firstUtility] = saved.categories.map(restoreCategory);
        }
        const restoredUtility =
          saved?.activeUtility && utilities.includes(saved.activeUtility)
            ? saved.activeUtility
            : firstUtility;
        setCategoriesByUtility(defaults);
        setActiveUtility(restoredUtility);
        setTemplateByUtility(saved?.templateByUtility && typeof saved.templateByUtility === "object" ? saved.templateByUtility : {});
        if (saved?.alarmsByCategory) {
          const next: Record<string, Alarm[]> = buildDefaultAlarmsByCategory();
          for (const [categoryId, rows] of Object.entries(saved.alarmsByCategory)) {
            if (!Array.isArray(rows)) continue;
            // Danh sách rỗng đã lưu = người dùng đã xoá hết, không nạp lại ngưỡng mặc định.
            next[categoryId] = rows
              .map((row, idx) => normalizeAlarm(row, categoryId, idx))
              .filter((row): row is Alarm => Boolean(row));
          }
          setAlarmsByCategory(next);
        }
        setSettingsReady(true);
      })
      .catch(() => {
        if (active) setSettingsReady(true);
      });
    return () => {
      active = false;
    };
    // libraryAlarms chỉ đọc khi mở mẫu: trang Thư viện tạo lại component (key) khi đổi mẫu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, firstUtility, utilities, isLibrary]);

  useEffect(() => {
    if (!settingsReady) return;
    const categoriesPayload = Object.fromEntries(
      Object.entries(categoriesByUtility).map(([utility, items]) => [
        utility,
        items.map(({ id, label }) => ({ id, label })),
      ]),
    );
    if (isLibrary) {
      // Thư viện: báo ngưỡng của các nhóm thuộc loại điểm đo cho trang Thư viện (trang đó lưu mẫu).
      const ids = new Set(utilityCategoryIds(activeUtility, categoriesByUtility));
      const picked = Object.fromEntries(Object.entries(alarmsByCategory).filter(([id]) => ids.has(id)));
      const timer = window.setTimeout(() => onLibraryAlarmsChange?.(picked), 300);
      return () => window.clearTimeout(timer);
    }
    void saveProjectSettings(projectId, {
      ...(loadProjectSettings(projectId) ?? {}),
      alertConfig: {
        categoriesByUtility: categoriesPayload,
        activeUtility,
        alarmsByCategory,
        templateByUtility,
      },
    });
    // onLibraryAlarmsChange: hàm của trang cha, không cần chạy lại khi đổi tham chiếu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUtility, alarmsByCategory, categoriesByUtility, projectId, settingsReady, isLibrary, templateByUtility]);

  // Không chia nhóm trên giao diện: gộp mọi nhóm của loại năng lượng (kể cả nhóm đã ẩn trước đây).
  // Dữ liệu vẫn lưu theo nhóm (suy ra từ tham số) để bộ đánh giá cảnh báo phía server giữ nguyên.
  const utilityCategories = useMemo(() => {
    const list = [...categoriesForUtility(activeUtility)];
    for (const category of categoriesByUtility[activeUtility] ?? []) {
      if (!list.some((item) => item.id === category.id)) list.push(category);
    }
    return list;
  }, [activeUtility, categoriesByUtility]);
  const electric = isElectricUtility(activeUtility);
  const utilityParameters = useMemo(() => {
    if (!electric) return declaredParametersForUtility(activeUtility, devices);
    const seen = new Set<string>();
    const list: MeterParameter[] = [];
    for (const category of utilityCategories) {
      for (const param of parametersForCategory(category.id)) {
        if (seen.has(param.key)) continue;
        seen.add(param.key);
        list.push(param);
      }
    }
    return list;
  }, [utilityCategories, electric, activeUtility, devices]);
  /** Tra tham số: ưu tiên tham số của loại điểm đo đang chọn, sau đó bộ tham số điện chuẩn. */
  const findParameter = (key: string | undefined) =>
    key ? utilityParameters.find((p) => p.key === key) ?? METER_PARAMETERS.find((p) => p.key === key) : undefined;
  const alarmEntries = useMemo(
    () =>
      utilityCategories.flatMap((category) =>
        (alarmsByCategory[category.id] ?? []).map((alarm) => ({ alarm, categoryId: category.id })),
      ),
    [alarmsByCategory, utilityCategories],
  );
  const alarms = alarmEntries.map((entry) => entry.alarm);
  const fallbackCategoryId = utilityCategories[0]?.id ?? "energy";

  /** Nhóm lưu trữ của một tham số (theo biểu đồ của tham số), mặc định nhóm đầu của loại năng lượng. */
  function categoryForParameter(key: string | undefined) {
    if (!key || key.startsWith("IDAlarm:")) return fallbackCategoryId;
    const owner = utilityCategories.find(
      (category) =>
        chartIdForCategory(category.id) != null && parametersForCategory(category.id).some((p) => p.key === key),
    );
    return owner?.id ?? fallbackCategoryId;
  }

  const latestValuesMap = useMemo(() => {
    const map = new Map<
      string,
      { value: number; gatewayId: string; meterModel: string | null; meterId: string | null }
    >();
    for (const gw of gateways) {
      if (!gw.lastValues) continue;
      for (const [k, raw] of Object.entries(gw.lastValues)) {
        if (typeof raw === "number" && Number.isFinite(raw) && !map.has(k)) {
          map.set(k, {
            value: raw,
            gatewayId: gw.gatewayId,
            meterModel: gw.meterModel,
            meterId: gw.meterId,
          });
        }
      }
    }
    return map;
  }, [gateways]);

  function updateAlarm(categoryId: string, alarmKey: string, patch: Partial<Alarm>) {
    // Đổi tham số sang nhóm khác thì chuyển dòng sang nhóm lưu trữ tương ứng.
    const nextCategory =
      patch.parameterKey !== undefined && !patch.parameterKey.startsWith("IDAlarm:")
        ? categoryForParameter(patch.parameterKey)
        : categoryId;
    setAlarmsByCategory((current) => {
      const source = current[categoryId] ?? [];
      const target = source.find((item) => item.id === alarmKey);
      if (!target) return current;
      const updated = { ...target, ...patch };
      if (nextCategory === categoryId) {
        return { ...current, [categoryId]: source.map((item) => (item.id === alarmKey ? updated : item)) };
      }
      return {
        ...current,
        [categoryId]: source.filter((item) => item.id !== alarmKey),
        [nextCategory]: [...(current[nextCategory] ?? []), updated],
      };
    });
  }

  function removeAlarm(categoryId: string, alarmKey: string) {
    const target = (alarmsByCategory[categoryId] ?? []).find((item) => item.id === alarmKey);
    if (!isLibrary && target?.parameterKey) {
      const matchedThreshold = gatewayThresholds.find(
        (t) => t.parameterName === target.parameterKey,
      );
      if (matchedThreshold) {
        void fetch("/api/gateway/console", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete-threshold", id: matchedThreshold.id }),
        }).then(() => loadGatewayLive());
      }
    }
    setAlarmsByCategory((current) => ({
      ...current,
      [categoryId]: (current[categoryId] ?? []).filter((item) => item.id !== alarmKey),
    }));
  }

  async function syncThresholdToGateway(alarm: Alarm, quiet = false) {
    // Thư viện chung chỉ là mẫu: không ghi ngưỡng xuống gateway.
    if (isLibrary) return;
    if (!alarm.parameterKey || alarm.parameterKey.startsWith("IDAlarm:")) return;
    const minVal = alarm.minValue?.trim() ? Number(alarm.minValue.replace(",", ".")) : null;
    const maxVal = alarm.threshold.trim() ? Number(alarm.threshold.replace(",", ".")) : null;
    if ((minVal == null || !Number.isFinite(minVal)) && (maxVal == null || !Number.isFinite(maxVal))) {
      return;
    }
    try {
      const response = await fetch("/api/gateway/console", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "threshold",
          gatewayId: "",
          meterModel: "",
          meterId: "",
          parameterName: alarm.parameterKey,
          minValue: minVal != null && Number.isFinite(minVal) ? minVal : null,
          maxValue: maxVal != null && Number.isFinite(maxVal) ? maxVal : null,
        }),
      });
      if (response.ok && !quiet) {
        setSyncNotice(`Đã lưu ngưỡng ${alarm.parameterKey} xuống bộ kiểm tra tức thời của Gateway.`);
        setTimeout(() => setSyncNotice(""), 3500);
        await loadGatewayLive();
      }
    } catch {
      // Ignore error
    }
  }

  function addAlarmForParameter(param?: MeterParameter) {
    const chosen =
      param ??
      utilityParameters.find((p) => !alarms.some((a) => a.parameterKey === p.key)) ??
      utilityParameters[0];
    const categoryId = categoryForParameter(chosen?.key);
    const existing = alarmsByCategory[categoryId] ?? [];

    const live = chosen ? latestValuesMap.get(chosen.key) : undefined;
    const row: Alarm = {
      id: newAlarmId(categoryId),
      parameterKey: chosen?.key ?? "",
      alarmId: String(chosen?.id ?? existing.length + 1),
      name: chosen ? `Cảnh báo ${chosen.name}` : "",
      description: chosen
        ? `Tham số gateway: ${chosen.key} (${chosen.group})`
        : "So sánh trực tiếp với giá trị tức thời gateway bắn về",
      minValue: "",
      threshold: "",
      unit: chosen?.unit || defaultUnitForCategory(categoryId),
      current: live != null ? String(live.value) : "",
    };
    setAlarmsByCategory((current) => ({
      ...current,
      [categoryId]: [...(current[categoryId] ?? []), row],
    }));
  }

  /** Chép ngưỡng của thư viện chung (loại điểm đo đang chọn) vào thư viện cảnh báo của dự án. */
  async function applyLibraryToProject(template: AlertTemplate) {
    setPendingTemplate(null);
    try {
      const libraryAlarms = (template.alarmsByCategory ?? {}) as Record<string, unknown>;
      const categoryIds = utilityCategories.map((category) => category.id);
      const hasRows = categoryIds.some(
        (id) => Array.isArray(libraryAlarms[id]) && (libraryAlarms[id] as unknown[]).length > 0,
      );
      if (!hasRows) {
        setSyncNotice(`Mẫu "${template.name}" chưa có ngưỡng nào.`);
        setTimeout(() => setSyncNotice(""), 4500);
        return;
      }
      const nextRows: Record<string, Alarm[]> = {};
      for (const id of categoryIds) {
        const rows = Array.isArray(libraryAlarms[id]) ? (libraryAlarms[id] as Alarm[]) : [];
        nextRows[id] = rows
          .map((row, idx) => normalizeAlarm({ ...row }, id, idx))
          .filter((row): row is Alarm => Boolean(row));
      }
      setAlarmsByCategory((current) => ({ ...current, ...nextRows }));
      setTemplateByUtility((current) => ({ ...current, [activeUtility]: template.id }));
      setSyncNotice(`Đã áp dụng mẫu "${template.name}" cho loại ${activeUtility}.`);
      setTimeout(() => setSyncNotice(""), 4500);
      // Đồng bộ ngưỡng Min/Max mới xuống bộ kiểm tra tức thời của gateway (như khi sửa tay từng ngưỡng).
      await Promise.all(Object.values(nextRows).flat().map((alarm) => syncThresholdToGateway(alarm, true)));
      await loadGatewayLive();
    } catch (error) {
      setSyncNotice(error instanceof Error ? error.message : "Không tải được thư viện cảnh báo.");
      setTimeout(() => setSyncNotice(""), 4500);
    }
  }

  function selectUtility(utility: MeterType) {
    setActiveUtility(utility);
    setShowAllLiveParams(false);
  }

  const displayedLiveParams = showAllLiveParams
    ? utilityParameters
    : utilityParameters.slice(0, 12);

  return (
    <div className="space-y-5">
      {isLibrary ? null : (
      <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
        <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
          Loại năng lượng của dự án
        </div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Loại năng lượng">
          {utilities.map((utility) => {
            const selected = utility === activeUtility;
            const Icon = utilityIcon(utility);
            return (
              <button
                key={utility}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => selectUtility(utility)}
                className={`inline-flex h-12 min-w-[132px] items-center gap-2.5 rounded-xl border px-3.5 text-sm font-bold transition-all ${
                  selected
                    ? "border-emerald-500 bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-500/20"
                    : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700"
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                    selected ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                {utility}
              </button>
            );
          })}
        </div>
      </section>
      )}

      <>
          <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3 px-1 sm:px-0">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                  {isLibrary ? `Thư viện cảnh báo · ${activeUtility}` : "Cấu hình cảnh báo tức thời đồng hồ"}
                </h2>
                {isLibrary ? null : (<>
                <p className="mt-1 max-w-3xl text-sm text-slate-500">
                  Trang này chỉ phục vụ cấu hình những cảnh báo tức thời từ dữ liệu Gateway bắn về (tham số{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-700">VAL</code> và{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-700">IDAlarm</code> /{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-700">ValueAlarm</code>
                  ). Các cấu hình cảnh báo vận hành khác đặt ở trang người dùng (<strong>Cấu hình → Cảnh báo</strong>).
                </p>
                <p className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-emerald-600">
                  <LiveIcon className="h-4 w-4" />
                  Cấu hình gateway trực tuyến ·{" "}
                  {gateways.length > 0
                    ? `${gateways.length} gateway đang kết nối (Đồng hồ ${gateways[0]?.meterModel ?? "PM2230"} #${gateways[0]?.meterId ?? "—"})`
                    : "Đang chờ bản tin từ gateway"}
                </p>
                </>)}
              </div>
              {isLibrary ? null : (
                <div className="w-full sm:w-72">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Mẫu cảnh báo áp dụng ({activeUtility})
                  </span>
                  <CustomSelect
                    value={templateByUtility[activeUtility] ?? ""}
                    onChange={(e) => {
                      const picked = templates.find((item) => item.id === e.target.value);
                      if (picked) setPendingTemplate(picked);
                    }}
                    className="h-9 w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 outline-none focus:border-emerald-500"
                  >
                    <option value="">
                      {templates.some((item) => item.meterType === activeUtility)
                        ? "-- Chọn mẫu từ thư viện --"
                        : "Thư viện chưa có mẫu cho loại này"}
                    </option>
                    {templates
                      .filter((item) => item.meterType === activeUtility)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </CustomSelect>
                </div>
              )}
            </div>

            {utilityParameters.length > 0 ? (
              <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Giá trị tức thời Gateway bắn về ({activeUtility})
                    </h3>
                  </div>
                  {utilityParameters.length > 12 ? (
                    <button
                      type="button"
                      onClick={() => setShowAllLiveParams((v) => !v)}
                      className="text-xs font-semibold text-emerald-700 hover:underline"
                    >
                      {showAllLiveParams
                        ? "Thu gọn"
                        : `Xem tất cả ${utilityParameters.length} tham số`}
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {displayedLiveParams.map((param) => {
                    const live = latestValuesMap.get(param.key);
                    const rawVal =
                      live != null
                        ? live.value
                        : readMeterValue(gateways[0]?.lastValues, param.key);
                    const configured = alarms.some((a) => a.parameterKey === param.key);
                    return (
                      <button
                        key={param.key}
                        type="button"
                        onClick={() => addAlarmForParameter(param)}
                        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                          configured
                            ? "border-emerald-300 bg-emerald-50/70 text-emerald-900"
                            : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/30"
                        }`}
                        title={`Bấm để thêm cấu hình ngưỡng cho ${param.key} (${param.name})`}
                      >
                        <div className="min-w-0">
                          <span className="block font-mono text-xs font-bold text-slate-900">
                            {param.key}
                          </span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {param.name}
                          </span>
                        </div>
                        <div className="shrink-0 text-right">
                          <span
                            className={`block font-mono text-xs font-bold ${
                              rawVal != null ? "text-emerald-700" : "text-slate-400"
                            }`}
                          >
                            {rawVal != null ? rawVal : "Null"}
                          </span>
                          <span className="block text-[10px] font-semibold text-slate-400">
                            {param.unit || "—"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : !electric ? (
              <div className="mb-5 rounded-xl border border-dashed border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-900">
                Chưa có tham số nào cho loại {activeUtility}. Khai báo ở <strong>Thư viện loại đồng hồ</strong> → sửa
                đồng hồ loại {activeUtility} → <strong>Hàm nhận dữ liệu từ gateway</strong> (tên, mô tả, đơn vị).
              </div>
            ) : null}

            {syncNotice ? (
              <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-800">
                {syncNotice}
              </div>
            ) : null}

            <div className="space-y-3">
              {alarmEntries.map(({ alarm, categoryId }) => {
                const paramMeta = findParameter(alarm.parameterKey);
                const liveParam = alarm.parameterKey
                  ? latestValuesMap.get(alarm.parameterKey)
                  : undefined;
                const code = Number(alarm.alarmId);
                const liveHardwareAlarm = Number.isFinite(code)
                  ? liveAlarms.find((item) => item.source === "gateway" && item.alarmCode === code)
                  : undefined;
                const resolvedUnit = alarm.unit || paramMeta?.unit || defaultUnitForCategory(categoryId);
                const currentDisplay =
                  liveParam != null
                    ? `${liveParam.value}${resolvedUnit ? ` ${resolvedUnit}` : ""}`
                    : liveHardwareAlarm?.alarmValue != null
                      ? `${liveHardwareAlarm.alarmValue}${resolvedUnit ? ` ${resolvedUnit}` : ""}`
                      : alarm.current
                        ? `${alarm.current}${resolvedUnit ? ` ${resolvedUnit}` : ""}`
                        : "Chưa có dữ liệu (Null)";

                return (
                  <article
                    key={alarm.id}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.03)] sm:px-5 sm:py-4"
                  >
                    {/* [&>*]:min-w-0: chữ dài trong ô chọn tham số không được đẩy lưới rộng quá màn hình */}
                    <div className="grid grid-cols-6 gap-x-2 gap-y-3 sm:gap-3 lg:grid-cols-[minmax(220px,1.2fr)_minmax(200px,1.2fr)_120px_120px_84px_40px] lg:items-start [&>*]:min-w-0">
                      <div className="col-span-6 lg:col-span-1">
                        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          THAM SỐ GATEWAY BẮN VỀ
                        </span>
                        <CustomSelect
                          value={alarm.parameterKey ?? ""}
                          onChange={(e) => {
                            const nextKey = e.target.value;
                            if (nextKey.startsWith("IDAlarm:")) {
                              const idNum = Number(nextKey.split(":")[1]);
                              const hwName = alarmName(idNum) ?? `Cảnh báo #${idNum}`;
                              const hwUnit = alarmUnitHint(idNum, categoryId);
                              updateAlarm(categoryId, alarm.id, {
                                parameterKey: nextKey,
                                alarmId: String(idNum),
                                name: hwName,
                                description: `Mã IDAlarm=${idNum} do firmware gateway bắn trực tiếp`,
                                unit: hwUnit,
                              });
                              return;
                            }
                            const picked = findParameter(nextKey);
                            const live = latestValuesMap.get(nextKey);
                            updateAlarm(categoryId, alarm.id, {
                              parameterKey: nextKey,
                              alarmId: String(picked?.id ?? alarm.alarmId),
                              name: picked ? `Cảnh báo ${picked.name}` : alarm.name,
                              description: picked
                                ? `Tham số gateway: ${picked.key} (${picked.group})`
                                : alarm.description,
                              unit: picked?.unit ?? defaultUnitForCategory(categoryForParameter(nextKey)),
                              current: live != null ? String(live.value) : "",
                            });
                          }}
                          className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-emerald-500"
                        >
                          <option value="">-- Chọn tham số từ Gateway --</option>
                          {utilityParameters.map((p) => {
                            const live = latestValuesMap.get(p.key);
                            return (
                              <option key={p.key} value={p.key}>
                                {p.key} — {p.name} ({p.unit || "—"})
                                {live != null ? ` [Hiện tại: ${live.value}]` : ""}
                              </option>
                            );
                          })}
                          {electric ? <option value="IDAlarm:1">IDAlarm #1 — Quá áp (V)</option> : null}
                          {electric ? <option value="IDAlarm:2">IDAlarm #2 — Quá dòng (A)</option> : null}
                          {electric ? <option value="IDAlarm:3">IDAlarm #3 — Quá áp (V)</option> : null}
                        </CustomSelect>
                      </div>

                      <label className="col-span-6 block lg:col-span-1">
                        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          TÊN CẢNH BÁO
                        </span>
                        <input
                          value={alarm.name}
                          onChange={(e) => updateAlarm(categoryId, alarm.id, { name: e.target.value })}
                          placeholder="Nhập tên cảnh báo"
                          className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                        />
                        <span className="mt-1 block truncate text-xs text-slate-400">
                          {alarm.description}
                        </span>
                      </label>

                      <label className="col-span-2 block lg:col-span-1">
                        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          NGƯỠNG MIN
                        </span>
                        <input
                          value={alarm.minValue ?? ""}
                          onChange={(e) => updateAlarm(categoryId, alarm.id, { minValue: e.target.value })}
                          onBlur={() => void syncThresholdToGateway(alarm)}
                          inputMode="decimal"
                          placeholder="Bỏ trống"
                          className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-xs placeholder:font-normal placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                        />
                      </label>

                      <label className="col-span-2 block lg:col-span-1">
                        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          NGƯỠNG MAX
                        </span>
                        <input
                          value={alarm.threshold}
                          onChange={(e) => updateAlarm(categoryId, alarm.id, { threshold: e.target.value })}
                          onBlur={() => void syncThresholdToGateway(alarm)}
                          inputMode="decimal"
                          placeholder={
                            liveParam != null ? `VD: ${liveParam.value}` : "Nhập ngưỡng"
                          }
                          className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-emerald-700 outline-none placeholder:text-xs placeholder:font-normal placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                        />
                      </label>

                      <label className="col-span-2 block lg:col-span-1">
                        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          ĐƠN VỊ
                        </span>
                        <input
                          value={alarm.unit}
                          onChange={(e) => updateAlarm(categoryId, alarm.id, { unit: e.target.value })}
                          placeholder={defaultUnitForCategory(categoryId) || "%"}
                          className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-2 text-center text-sm font-bold text-slate-700 outline-none focus:border-emerald-500 focus:bg-white"
                        />
                      </label>

                      <div className="hidden pt-5 lg:block">
                        <button
                          type="button"
                          onClick={() => removeAlarm(categoryId, alarm.id)}
                          title="Xóa cảnh báo này"
                          className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 font-medium text-emerald-700">
                          <CurrentIcon className="h-3.5 w-3.5 shrink-0" />
                          <span className="hidden sm:inline">Giá trị gateway bắn về hiện tại</span>
                          <span className="sm:hidden">Hiện tại</span>
                          {alarm.parameterKey ? ` (${alarm.parameterKey})` : ""}:{" "}
                          <strong className="whitespace-nowrap font-mono text-sm">{currentDisplay}</strong>
                        </span>
                        {liveParam ? (
                          <span className="text-slate-400">
                            Gateway {liveParam.gatewayId} · {liveParam.meterModel ?? "PM2230"} #
                            {liveParam.meterId}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {isLibrary ? null : (
                          <button
                            type="button"
                            onClick={() => void syncThresholdToGateway(alarm)}
                            className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
                          >
                            Lưu ngưỡng xuống Gateway
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeAlarm(categoryId, alarm.id)}
                          title="Xóa cảnh báo này"
                          aria-label="Xóa cảnh báo này"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 lg:hidden"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}

              {alarms.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                  Chưa có cảnh báo tức thời nào cho {activeUtility}. Bấm vào một tham số bên trên hoặc nút bên dưới để thêm ngưỡng cảnh báo.
                </p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => addAlarmForParameter()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-[#f8fafc] py-3.5 text-sm font-semibold text-slate-600 transition-colors hover:border-emerald-500 hover:bg-emerald-50/30 hover:text-emerald-700"
            >
              <span className="text-base leading-none text-emerald-600">+</span>
              <span className="sm:hidden">Thêm cảnh báo</span>
              <span className="hidden sm:inline">Thêm cảnh báo tức thời từ tham số Gateway</span>
            </button>
          </section>

          {isLibrary ? null : (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">
              Ngưỡng Min / Max đang kích hoạt trên Gateway Server ({gatewayThresholds.length})
            </h2>
            {gatewayThresholds.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">
                Chưa có ngưỡng Min/Max nào được lưu trên Gateway Server.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[600px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      <th className="px-2 py-2">Tham số (VAL)</th>
                      <th className="px-2 py-2">Tên thông số</th>
                      <th className="px-2 py-2">Ngưỡng Min</th>
                      <th className="px-2 py-2">Ngưỡng Max</th>
                      <th className="px-2 py-2">Giá trị hiện tại</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {gatewayThresholds.map((item) => {
                      const meta = METER_PARAMETERS.find((p) => p.key === item.parameterName);
                      const live = latestValuesMap.get(item.parameterName);
                      return (
                        <tr key={item.id}>
                          <td className="px-2 py-2 font-mono font-bold text-slate-800">
                            {item.parameterName}
                          </td>
                          <td className="px-2 py-2 text-slate-600">{meta?.name ?? "—"}</td>
                          <td className="px-2 py-2 font-mono">
                            {item.minValue != null ? `${item.minValue} ${meta?.unit ?? ""}` : "—"}
                          </td>
                          <td className="px-2 py-2 font-mono font-semibold text-emerald-700">
                            {item.maxValue != null ? `${item.maxValue} ${meta?.unit ?? ""}` : "—"}
                          </td>
                          <td className="px-2 py-2 font-mono text-slate-700">
                            {live != null ? `${live.value} ${meta?.unit ?? ""}` : "Null"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          )}
      </>

      <ConfirmDialog
        open={Boolean(pendingTemplate)}
        title="Áp dụng mẫu cảnh báo"
        description={`Thay toàn bộ ngưỡng cảnh báo loại ${activeUtility} của dự án bằng mẫu "${pendingTemplate?.name ?? ""}"? Các ngưỡng đang có của loại này sẽ bị thay thế.`}
        confirmText="Áp dụng"
        danger={false}
        onConfirm={() => {
          if (pendingTemplate) void applyLibraryToProject(pendingTemplate);
        }}
        onCancel={() => setPendingTemplate(null)}
      />
    </div>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z" />
    </svg>
  );
}

function BoltIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M13 2 4.5 13.5h6.2L9.2 22 19.5 10h-6.2L13 2Z" />
    </svg>
  );
}

function GaugeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="14" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M8.2 10.8a5.5 5.5 0 0 1 7.6 0M6 8.2a8.5 8.5 0 0 1 12 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WaveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PowerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M7.2 7.8a7 7 0 1 0 9.6 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HarmonicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 16V8M8 16v-5M12 16V6M16 16v-7M20 16v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ImbalanceIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5 4.5 18h15L12 5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 10v5M12 17.2v.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ThermoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M10 13.5V6.5a2 2 0 1 1 4 0v7a3.5 3.5 0 1 1-4 0Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 9v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function QualityIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 12.5 11 15.5 16.5 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DropIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3s6 7 6 11a6 6 0 1 1-12 0c0-4 6-11 6-11Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function SteamIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 18h14M8 18V9l4-4 4 4v9M9.5 12h5M9.5 15h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TagIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 12V5h7l9 9-7 7-9-9Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}

function LiveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="14" r="1.6" fill="currentColor" />
      <path
        d="M8.5 11.2a5 5 0 0 1 7 0M6.2 8.6a8.2 8.2 0 0 1 11.6 0M4 6.2a11.5 11.5 0 0 1 16 0"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CurrentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 12h10M11 7l7 5-7 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
