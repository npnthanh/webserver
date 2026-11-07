"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CustomSelect } from "@/components/ui/CustomSelect";
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
  { id: "energy", label: "Energy", icon: BoltIcon },
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

function defaultUnitForCategory(categoryId: string) {
  return alarmUnitHint(null, categoryId) || "";
}

function normalizeAlarm(alarm: Alarm, categoryId: string, index: number): Alarm | null {
  // Bỏ các dòng rác rỗng từ phiên bản cũ (threshold = "0", unit = "V", name = "")
  if (!alarm.parameterKey && !alarm.name.trim() && alarm.threshold === "0" && alarm.unit === "V") {
    return null;
  }
  const catParams = parametersForCategory(categoryId);
  const matchedParam =
    (alarm.parameterKey ? METER_PARAMETERS.find((p) => p.key === alarm.parameterKey) : undefined) ??
    catParams[index] ??
    catParams[0];

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
  projectId,
  initialUtilities,
}: {
  projectId: string;
  initialUtilities: MeterType[];
}) {
  const utilities = useMemo(() => uniqueUtilities(initialUtilities), [initialUtilities]);
  const firstUtility = utilities[0] ?? "Điện";
  const [activeUtility, setActiveUtility] = useState<MeterType>(firstUtility);
  const [categoriesByUtility, setCategoriesByUtility] = useState<Record<string, Category[]>>(() =>
    buildCategoryMap(utilities.length ? utilities : [firstUtility]),
  );
  const [activeId, setActiveId] = useState<CategoryId>(
    categoriesForUtility(firstUtility)[0]?.id ?? "energy",
  );
  const [alarmsByCategory, setAlarmsByCategory] = useState(initialAlarms);
  const [gateways, setGateways] = useState<GatewayDeviceSnapshot[]>([]);
  const [liveAlarms, setLiveAlarms] = useState<LiveGatewayAlarm[]>([]);
  const [gatewayThresholds, setGatewayThresholds] = useState<GatewayThresholdRow[]>([]);
  const [syncNotice, setSyncNotice] = useState("");
  const [settingsReady, setSettingsReady] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<{ id: CategoryId; label: string } | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showAllLiveParams, setShowAllLiveParams] = useState(false);

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
    void hydrateProjectSettings(projectId)
      .then((payload) => {
        if (!active) return;
        const saved = payload.alertConfig as
          | {
              categories?: Array<{ id: string; label: string }>;
              categoriesByUtility?: Record<string, Array<{ id: string; label: string }>>;
              activeUtility?: string;
              activeId?: string;
              alarmsByCategory?: Record<string, Alarm[]>;
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
        const restoredCategories = defaults[restoredUtility] ?? categoriesForUtility(restoredUtility);
        setCategoriesByUtility(defaults);
        setActiveUtility(restoredUtility);
        const savedActiveId = saved?.activeId;
        setActiveId(
          savedActiveId && restoredCategories.some((category) => category.id === savedActiveId)
            ? savedActiveId
            : (restoredCategories[0]?.id ?? ""),
        );
        if (saved?.alarmsByCategory) {
          const next: Record<string, Alarm[]> = buildDefaultAlarmsByCategory();
          for (const [categoryId, rows] of Object.entries(saved.alarmsByCategory)) {
            const normalizedRows = rows
              .map((row, idx) => normalizeAlarm(row, categoryId, idx))
              .filter((row): row is Alarm => Boolean(row));
            if (normalizedRows.length > 0) {
              next[categoryId] = normalizedRows;
            }
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
  }, [projectId, firstUtility, utilities]);

  useEffect(() => {
    if (!settingsReady) return;
    void saveProjectSettings(projectId, {
      ...(loadProjectSettings(projectId) ?? {}),
      alertConfig: {
        categoriesByUtility: Object.fromEntries(
          Object.entries(categoriesByUtility).map(([utility, items]) => [
            utility,
            items.map(({ id, label }) => ({ id, label })),
          ]),
        ),
        activeUtility,
        activeId,
        alarmsByCategory,
      },
    });
  }, [activeId, activeUtility, alarmsByCategory, categoriesByUtility, projectId, settingsReady]);

  const categories = categoriesByUtility[activeUtility] ?? categoriesForUtility(activeUtility);
  const active = categories.find((item) => item.id === activeId) ?? categories[0];
  const alarms = alarmsByCategory[active?.id ?? "energy"] ?? [];
  const categoryParameters = useMemo(
    () => (active ? parametersForCategory(active.id) : []),
    [active],
  );

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

  const unusedCatalog = useMemo(
    () => catalogCategories.filter((item) => !categories.some((cat) => cat.id === item.id)),
    [categories],
  );

  function updateAlarm(alarmKey: string, patch: Partial<Alarm>) {
    if (!active) return;
    setAlarmsByCategory((current) => ({
      ...current,
      [active.id]: (current[active.id] ?? []).map((item) =>
        item.id === alarmKey ? { ...item, ...patch } : item,
      ),
    }));
  }

  function removeAlarm(alarmKey: string) {
    if (!active) return;
    const target = (alarmsByCategory[active.id] ?? []).find((item) => item.id === alarmKey);
    if (target?.parameterKey) {
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
      [active.id]: (current[active.id] ?? []).filter((item) => item.id !== alarmKey),
    }));
  }

  async function syncThresholdToGateway(alarm: Alarm) {
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
      if (response.ok) {
        setSyncNotice(`Đã lưu ngưỡng ${alarm.parameterKey} xuống bộ kiểm tra tức thời của Gateway.`);
        setTimeout(() => setSyncNotice(""), 3500);
        await loadGatewayLive();
      }
    } catch {
      // Ignore error
    }
  }

  function addAlarmForParameter(param?: MeterParameter) {
    if (!active) return;
    const existing = alarmsByCategory[active.id] ?? [];
    const chosen =
      param ??
      categoryParameters.find((p) => !existing.some((a) => a.parameterKey === p.key)) ??
      categoryParameters[0];

    const live = chosen ? latestValuesMap.get(chosen.key) : undefined;
    const row: Alarm = {
      id: `${active.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      parameterKey: chosen?.key ?? "",
      alarmId: String(chosen?.id ?? existing.length + 1),
      name: chosen ? `Cảnh báo ${chosen.name}` : "",
      description: chosen
        ? `Tham số gateway: ${chosen.key} (${chosen.group})`
        : "So sánh trực tiếp với giá trị tức thời gateway bắn về",
      minValue: "",
      threshold: "",
      unit: chosen?.unit || defaultUnitForCategory(active.id),
      current: live != null ? String(live.value) : "",
    };
    setAlarmsByCategory((current) => ({
      ...current,
      [active.id]: [...(current[active.id] ?? []), row],
    }));
  }

  function removeCategory(id: CategoryId) {
    setCategoriesByUtility((current) => ({
      ...current,
      [activeUtility]: (current[activeUtility] ?? []).filter((item) => item.id !== id),
    }));
    if (activeId === id) {
      setActiveId(categories.find((item) => item.id !== id)?.id ?? "");
    }
  }

  function addExistingCategory(category: Category) {
    setCategoriesByUtility((current) => ({
      ...current,
      [activeUtility]: (current[activeUtility] ?? []).some((item) => item.id === category.id)
        ? current[activeUtility]
        : [...(current[activeUtility] ?? []), category],
    }));
    setAlarmsByCategory((current) =>
      current[category.id] ? current : { ...current, [category.id]: [] },
    );
    setActiveId(category.id);
    setAddingCategory(false);
    setNewCategoryName("");
  }

  function addCustomCategory() {
    const label = newCategoryName.trim();
    if (!label) return;
    const exists = categories.find((item) => item.label.toLowerCase() === label.toLowerCase());
    if (exists) {
      setActiveId(exists.id);
      setAddingCategory(false);
      setNewCategoryName("");
      return;
    }
    const fromCatalog = catalogCategories.find((item) => item.label.toLowerCase() === label.toLowerCase());
    if (fromCatalog) {
      addExistingCategory(fromCatalog);
      return;
    }
    addExistingCategory({ id: `custom-${Date.now()}`, label, icon: TagIcon });
  }

  function selectUtility(utility: MeterType) {
    const nextCategories = categoriesByUtility[utility] ?? categoriesForUtility(utility);
    setActiveUtility(utility);
    setActiveId((current) =>
      nextCategories.some((category) => category.id === current)
        ? current
        : (nextCategories[0]?.id ?? ""),
    );
  }

  const displayedLiveParams = showAllLiveParams
    ? categoryParameters
    : categoryParameters.slice(0, 12);

  return (
    <div className="space-y-5">
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

      <div>
        <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
          Nhóm cảnh báo tức thời của {activeUtility}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {categories.map((category) => {
            const selected = category.id === active?.id;
            const Icon = category.icon;
            return (
              <div
                key={category.id}
                className={`inline-flex h-11 items-center gap-2 rounded-xl pr-1 pl-2.5 text-sm font-semibold transition-all ${
                  selected
                    ? "bg-emerald-50 text-emerald-700 shadow-xs ring-1 ring-emerald-500"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-900"
                }`}
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                    selected ? "bg-emerald-600 text-white shadow-xs" : "bg-slate-50 text-slate-500"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveId(category.id);
                    setShowAllLiveParams(false);
                  }}
                >
                  {category.label}
                </button>
                <button
                  type="button"
                  aria-label={`Ẩn nhóm ${category.label}`}
                  className={`px-2 text-base leading-none ${
                    selected ? "text-emerald-700/70 hover:text-emerald-900" : "text-slate-400 hover:text-slate-600"
                  }`}
                  onClick={() => setCategoryToDelete({ id: category.id, label: category.label })}
                >
                  ×
                </button>
              </div>
            );
          })}
          {addingCategory ? (
            <div className="flex min-w-[280px] flex-1 flex-wrap items-center gap-2 rounded-xl border border-dashed border-emerald-500 bg-emerald-50/40 p-2">
              {unusedCatalog.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addExistingCategory(item)}
                  className="inline-flex h-8 items-center rounded-lg bg-white px-2.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition-colors hover:text-emerald-600 hover:ring-emerald-500"
                >
                  {item.label}
                </button>
              ))}
              <input
                autoFocus
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addCustomCategory();
                  if (e.key === "Escape") {
                    setAddingCategory(false);
                    setNewCategoryName("");
                  }
                }}
                placeholder="Tên nhóm cảnh báo mới"
                className="h-8 min-w-[160px] flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-sm outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={addCustomCategory}
                disabled={!newCategoryName.trim()}
                className="h-8 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-40"
              >
                Thêm
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddingCategory(false);
                  setNewCategoryName("");
                }}
                className="h-8 rounded-lg px-2 text-xs font-medium text-slate-500 hover:bg-white"
              >
                Hủy
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingCategory(true)}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-white px-3 text-sm font-semibold text-slate-500 transition-colors hover:border-emerald-500 hover:text-emerald-600"
            >
              <span className="text-base leading-none text-emerald-600">+</span>
              Thêm mới
            </button>
          )}
        </div>
      </div>

      {!active ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          Chưa có nhóm cảnh báo. Thêm mới để bắt đầu cấu hình.
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                  Cấu hình Cảnh báo tức thời Gateway: {active.label}
                </h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-500">
                  Trang này chỉ phục vụ cấu hình những cảnh báo tức thời từ dữ liệu Gateway bắn về (tham số{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-700">VAL</code> và{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-700">IDAlarm</code> /{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-700">ValueAlarm</code>
                  ). Các cấu hình cảnh báo vận hành khác đặt ở trang người dùng (<strong>Cấu hình → Cảnh báo</strong>).
                </p>
                <p className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-emerald-600">
                  <LiveIcon className="h-4 w-4" />
                  Cấu hình Gateway trực tuyến (Live Gateway Configuration) ·{" "}
                  {gateways.length > 0
                    ? `${gateways.length} gateway đang kết nối (Đồng hồ ${gateways[0]?.meterModel ?? "PM2230"} #${gateways[0]?.meterId ?? "—"})`
                    : "Đang chờ bản tin từ gateway"}
                </p>
              </div>
            </div>

            {categoryParameters.length > 0 ? (
              <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Giá trị tức thời Gateway bắn về ({active.label})
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Xem giá trị thực tế từ gói tin <code className="font-mono">VAL</code> của Gateway để chọn và cài đặt ngưỡng Min / Max chính xác. Bấm vào tham số để thêm nhanh cấu hình ngưỡng.
                    </p>
                  </div>
                  {categoryParameters.length > 12 ? (
                    <button
                      type="button"
                      onClick={() => setShowAllLiveParams((v) => !v)}
                      className="text-xs font-semibold text-emerald-700 hover:underline"
                    >
                      {showAllLiveParams
                        ? "Thu gọn"
                        : `Xem tất cả ${categoryParameters.length} tham số`}
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
            ) : null}

            {syncNotice ? (
              <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-800">
                {syncNotice}
              </div>
            ) : null}

            <div className="space-y-3">
              {alarms.map((alarm) => {
                const paramMeta = METER_PARAMETERS.find((p) => p.key === alarm.parameterKey);
                const liveParam = alarm.parameterKey
                  ? latestValuesMap.get(alarm.parameterKey)
                  : undefined;
                const code = Number(alarm.alarmId);
                const liveHardwareAlarm = Number.isFinite(code)
                  ? liveAlarms.find((item) => item.source === "gateway" && item.alarmCode === code)
                  : undefined;
                const resolvedUnit = alarm.unit || paramMeta?.unit || defaultUnitForCategory(active.id);
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
                    className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.03)]"
                  >
                    <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.2fr)_minmax(200px,1.2fr)_120px_120px_84px_40px] lg:items-start">
                      <div>
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
                              const hwUnit = alarmUnitHint(idNum, active.id);
                              updateAlarm(alarm.id, {
                                parameterKey: nextKey,
                                alarmId: String(idNum),
                                name: hwName,
                                description: `Mã IDAlarm=${idNum} do firmware gateway bắn trực tiếp`,
                                unit: hwUnit,
                              });
                              return;
                            }
                            const picked = METER_PARAMETERS.find((p) => p.key === nextKey);
                            const live = latestValuesMap.get(nextKey);
                            updateAlarm(alarm.id, {
                              parameterKey: nextKey,
                              alarmId: String(picked?.id ?? alarm.alarmId),
                              name: picked ? `Cảnh báo ${picked.name}` : alarm.name,
                              description: picked
                                ? `Tham số gateway: ${picked.key} (${picked.group})`
                                : alarm.description,
                              unit: picked?.unit ?? defaultUnitForCategory(active.id),
                              current: live != null ? String(live.value) : "",
                            });
                          }}
                          className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-emerald-500"
                        >
                          <option value="">-- Chọn tham số từ Gateway --</option>
                          {categoryParameters.map((p) => {
                            const live = latestValuesMap.get(p.key);
                            return (
                              <option key={p.key} value={p.key}>
                                {p.key} — {p.name} ({p.unit || "—"})
                                {live != null ? ` [Hiện tại: ${live.value}]` : ""}
                              </option>
                            );
                          })}
                          <option value="IDAlarm:1">IDAlarm #1 — Quá áp (V)</option>
                          <option value="IDAlarm:2">IDAlarm #2 — Quá dòng (A)</option>
                          <option value="IDAlarm:3">IDAlarm #3 — Quá áp (V)</option>
                        </CustomSelect>
                      </div>

                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          TÊN CẢNH BÁO
                        </span>
                        <input
                          value={alarm.name}
                          onChange={(e) => updateAlarm(alarm.id, { name: e.target.value })}
                          placeholder="Nhập tên cảnh báo"
                          className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                        />
                        <span className="mt-1 block truncate text-xs text-slate-400">
                          {alarm.description}
                        </span>
                      </label>

                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          NGƯỠNG MIN
                        </span>
                        <input
                          value={alarm.minValue ?? ""}
                          onChange={(e) => updateAlarm(alarm.id, { minValue: e.target.value })}
                          onBlur={() => void syncThresholdToGateway(alarm)}
                          inputMode="decimal"
                          placeholder="Để trống = bỏ qua"
                          className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-xs placeholder:font-normal placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          NGƯỠNG MAX
                        </span>
                        <input
                          value={alarm.threshold}
                          onChange={(e) => updateAlarm(alarm.id, { threshold: e.target.value })}
                          onBlur={() => void syncThresholdToGateway(alarm)}
                          inputMode="decimal"
                          placeholder={
                            liveParam != null ? `VD: ${liveParam.value}` : "Nhập ngưỡng"
                          }
                          className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-emerald-700 outline-none placeholder:text-xs placeholder:font-normal placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          ĐƠN VỊ
                        </span>
                        <input
                          value={alarm.unit}
                          onChange={(e) => updateAlarm(alarm.id, { unit: e.target.value })}
                          placeholder={defaultUnitForCategory(active.id) || "%"}
                          className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-2 text-center text-sm font-bold text-slate-700 outline-none focus:border-emerald-500 focus:bg-white"
                        />
                      </label>

                      <div className="pt-5">
                        <button
                          type="button"
                          onClick={() => removeAlarm(alarm.id)}
                          title="Xóa cảnh báo này"
                          className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                          <CurrentIcon className="h-3.5 w-3.5" />
                          Giá trị gateway bắn về hiện tại
                          {alarm.parameterKey ? ` (${alarm.parameterKey})` : ""}:{" "}
                          <strong className="font-mono text-sm">{currentDisplay}</strong>
                        </span>
                        {liveParam ? (
                          <span className="text-slate-400">
                            Gateway {liveParam.gatewayId} · {liveParam.meterModel ?? "PM2230"} #
                            {liveParam.meterId}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => void syncThresholdToGateway(alarm)}
                        className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
                      >
                        Lưu ngưỡng xuống Gateway
                      </button>
                    </div>
                  </article>
                );
              })}

              {alarms.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                  Chưa có cảnh báo tức thời nào cho nhóm {active.label}. Bấm vào một tham số bên trên hoặc nút bên dưới để thêm ngưỡng cảnh báo.
                </p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => addAlarmForParameter()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-[#f8fafc] py-3.5 text-sm font-semibold text-slate-600 transition-colors hover:border-emerald-500 hover:bg-emerald-50/30 hover:text-emerald-700"
            >
              <span className="text-base leading-none text-emerald-600">+</span>
              Thêm cảnh báo tức thời từ tham số Gateway
            </button>
          </section>

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
        </>
      )}

      <ConfirmDialog
        open={Boolean(categoryToDelete)}
        title="Xác nhận xóa nhóm cảnh báo"
        description={`Bạn có chắc chắn muốn xóa nhóm cảnh báo "${categoryToDelete?.label}" của ${activeUtility} không? Các cấu hình cảnh báo thuộc nhóm này sẽ bị loại bỏ.`}
        confirmText="Xóa nhóm"
        onConfirm={() => {
          if (categoryToDelete) {
            removeCategory(categoryToDelete.id);
            setCategoryToDelete(null);
          }
        }}
        onCancel={() => setCategoryToDelete(null)}
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
