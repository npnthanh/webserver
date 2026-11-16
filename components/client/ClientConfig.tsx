"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { useEffect, useMemo, useState, type DragEvent } from "react";
import {
  buildMeterDepthMap,
  hydrateClientMeters,
  isMeterDescendant,
  loadClientMeters,
  orderMetersByTree,
  saveClientMeters,
  type ClientMeter,
} from "@/lib/client-meters";
import { useAuth } from "@/components/auth/useAuth";
import {
  CUSTOMER_BRANCH_ROLES,
  canEditCustomerConfig,
  defaultCustomerAccount,
  ensureCustomerAccount,
  hydrateCustomerAccounts,
  loadCustomerAccounts,
  normalizeCustomerRole,
  removeCustomerAccount,
  upsertCustomerAccount,
  type CustomerAccount,
  type CustomerBranchRole,
} from "@/lib/customer-accounts";
import { loadDevices, type CatalogDevice } from "@/lib/devices";
import { hasPermission } from "@/lib/permissions";
import { hydrateProjects, loadProjects, resolveMeterTypes } from "@/lib/projects";
import {
  DEFAULT_VOLTAGE_LEVEL,
  formatTariffPrice,
  parseTariffPrice,
  INDUSTRIAL_SCHEDULE_DECISION,
  INDUSTRIAL_TARIFF_DECISION,
  INDUSTRIAL_VOLTAGE_LEVELS,
  pricesForLevel,
  resolveTouPrices,
  type TariffHistoryEntry,
  type TouBand,
  type VoltageLevelId,
} from "@/lib/industrial-electricity";
import {
  ALERT_CATEGORY_OPTIONS,
  DEFAULT_NOTIFICATION_CHANNELS,
  DEFAULT_SEVERITY_BY_CATEGORY,
  DEFAULT_USER_ALERT_CATEGORIES,
  DEFAULT_USER_ALERT_RULES,
  cloneDefaultRulesByGroup,
  normalizeAlertConfig,
  type AlertCategoryId,
  type AlertSeverityLevel,
  type NotificationChannelsConfig,
  type UserAlertCategoryTab,
  type UserAlertGroupId,
  type UserAlertRule,
} from "@/lib/alert-config";
import { hydrateAlertEvents } from "@/lib/alert-events";
import { loadProjectGatewayLatest } from "@/lib/gateway-series";
import {
  METER_PARAMETERS,
  parametersForChart,
  readMeterValue,
  type MeterChartId,
  type MeterParameter,
} from "@/lib/meter-parameters";
import { hydrateProjectSettings, saveProjectSettings, type ProjectSettingsPayload } from "@/lib/project-settings";

type TabId = "project" | "meters" | "cost" | "alerts" | "accounts";
type Utility = string;
type DropPosition = "before" | "after" | "child";
type Meter = ClientMeter;

const NAV: { id: TabId; n: number; label: string; icon: "doc" | "nodes" | "cash" | "warn" | "user" }[] = [
  { id: "project", n: 1, label: "Dự án", icon: "doc" },
  { id: "meters", n: 2, label: "Cụm điểm đo", icon: "nodes" },
  { id: "cost", n: 3, label: "Chi phí", icon: "cash" },
  { id: "alerts", n: 4, label: "Cảnh báo", icon: "warn" },
  { id: "accounts", n: 5, label: "Quản lý tài khoản", icon: "user" },
];

const FALLBACK_UTILITIES = ["Điện", "Nước", "Nhiệt", "Hơi"];

type Slot = { id: string; name: string; color: string; from: string; to: string; price: string };
type TouPriceInputs = Record<TouBand, string>;
type SavedProjectConfig = {
  classify?: string;
  startTime?: string;
  warnCount?: string;
  warnTimeout?: number;
  onlineTimeout?: number;
  gmail?: string;
  password?: string;
  language?: string;
  theme?: "Sáng" | "Tối" | "Hệ thống";
};

type SavedAlertsConfig = {
  classify?: string;
  categories?: UserAlertCategoryTab[];
  tags?: string[];
  activeGroupId?: UserAlertGroupId;
  activeTag?: string;
  rulesByGroup?: Record<string, UserAlertRule[]>;
  notifications?: Partial<NotificationChannelsConfig>;
  severityByCategory?: Partial<Record<AlertCategoryId, AlertSeverityLevel>>;
  overConsumptionKwh?: string;
  threshold?: string;
  dailyLimit?: number;
  peakWarn?: boolean;
  peakHourWarning?: boolean;
};

type SavedCostConfig = {
  utility?: string;
  applyDate?: string;
  slots?: Slot[];
  tariffHistory?: TariffHistoryEntry[];
  flatPrices?: Record<string, string>;
  electricity?: {
    voltageLevel?: VoltageLevelId;
    prices?: Partial<TouPriceInputs>;
  };
};

function tariffInputs(levelId: string | undefined): TouPriceInputs {
  const prices = pricesForLevel(levelId);
  return {
    normal: formatTariffPrice(prices.normal),
    off: formatTariffPrice(prices.off),
    peak: formatTariffPrice(prices.peak),
  };
}
export function ClientConfig() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id ?? "default";
  const { session } = useAuth();
  const [tab, setTab] = useState<TabId>("meters");
  const [openParams, setOpenParams] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [utilities, setUtilities] = useState<string[]>(FALLBACK_UTILITIES);
  const [utility, setUtility] = useState<Utility>("Điện");
  const [meters, setMeters] = useState<ClientMeter[]>([]);
  const [devices, setDevices] = useState<CatalogDevice[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [tariffHistory, setTariffHistory] = useState<TariffHistoryEntry[]>([]);
  const [applyDate, setApplyDate] = useState("");
  const [flatPrices, setFlatPrices] = useState<Record<string, string>>({});
  const [voltageLevel, setVoltageLevel] = useState<VoltageLevelId>(DEFAULT_VOLTAGE_LEVEL);
  const [touPrices, setTouPrices] = useState<TouPriceInputs>(() => tariffInputs(DEFAULT_VOLTAGE_LEVEL));
  const [accounts, setAccounts] = useState<CustomerAccount[]>(() =>
    loadCustomerAccounts().filter((item) => item.projectId === projectId),
  );
  const [adding, setAdding] = useState(false);
  const [accountActionError, setAccountActionError] = useState("");

  const canManageCustomerAccounts = useMemo(() => {
    if (!session) return true;
    if (session.portal === "admin") return true;
    return session.role === "Admin" || session.userId === `cus-${projectId}`;
  }, [session, projectId]);

  const canEditConfig = useMemo(
    () => canEditCustomerConfig(session, projectId),
    [session, projectId],
  );

  /** Thêm điểm đo dùng form quản trị: chỉ hiện với tài khoản quản trị có quyền quản lý dự án. */
  const addMeterHref = useMemo(() => {
    if (!hasPermission(session, "manageProjects")) return undefined;
    const id = encodeURIComponent(projectId);
    const returnTo = `/du-an/${id}/cau-hinh?tab=meters`;
    return `/chinh-sua-du-an/${id}/them-diem-do?returnTo=${encodeURIComponent(returnTo)}`;
  }, [session, projectId]);

  const [classify, setClassify] = useState("Thông tin chung (Info)");
  const [startTime, setStartTime] = useState("");
  const [warnCount, setWarnCount] = useState("");
  const [warnTimeout, setWarnTimeout] = useState(1);
  const [onlineTimeout, setOnlineTimeout] = useState(10);
  const [gmail, setGmail] = useState("");
  const [password, setPassword] = useState("");
  const [language, setLanguage] = useState("Tiếng Việt");
  const [theme, setTheme] = useState<"Sáng" | "Tối" | "Hệ thống">("Sáng");

  const [threshold, setThreshold] = useState("1500");
  const [dailyLimit, setDailyLimit] = useState(5000);
  const [peakWarn, setPeakWarn] = useState(true);
  const [alertClassify, setAlertClassify] = useState("Cấu hình ngưỡng theo thông số đo");
  const [alertCategories, setAlertCategories] = useState<UserAlertCategoryTab[]>(() =>
    DEFAULT_USER_ALERT_CATEGORIES.map((item) => ({ ...item })),
  );
  const [activeAlertGroupId, setActiveAlertGroupId] = useState<UserAlertGroupId>("energy");
  const [alertRulesByGroup, setAlertRulesByGroup] = useState<Record<string, UserAlertRule[]>>(() =>
    cloneDefaultRulesByGroup(),
  );
  const [alertNotifications, setAlertNotifications] = useState<NotificationChannelsConfig>(() => ({
    ...DEFAULT_NOTIFICATION_CHANNELS,
  }));
  const [severityByCategory, setSeverityByCategory] = useState<Record<AlertCategoryId, AlertSeverityLevel>>(
    DEFAULT_SEVERITY_BY_CATEGORY,
  );
  const [liveMeterValues, setLiveMeterValues] = useState<
    Record<string, { at: string; values: Record<string, number> }>
  >({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    const search = new URLSearchParams(window.location.search);
    const requestedTab = search.get("tab");
    if (
      requestedTab === "project" ||
      requestedTab === "meters" ||
      requestedTab === "cost" ||
      requestedTab === "alerts" ||
      requestedTab === "accounts"
    ) {
      setTab(requestedTab);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const poll = () => {
      void loadProjectGatewayLatest(projectId)
        .then((latestList) => {
          if (!active) return;
          const map: Record<string, { at: string; values: Record<string, number> }> = {};
          for (const sample of latestList) {
            map[sample.meterPointId] = { at: sample.at, values: sample.values };
          }
          setLiveMeterValues(map);
        })
        .catch(() => undefined);
    };
    poll();
    const timer = window.setInterval(poll, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [projectId]);

  function applyCostSettings(settings: ProjectSettingsPayload, types: string[] = utilities) {
    const savedProject = settings.projectConfig as SavedProjectConfig | undefined;
    if (savedProject) {
      if (savedProject.classify !== undefined) setClassify(savedProject.classify);
      if (savedProject.startTime !== undefined) setStartTime(savedProject.startTime);
      if (savedProject.warnCount !== undefined) setWarnCount(savedProject.warnCount);
      if (typeof savedProject.warnTimeout === "number") setWarnTimeout(savedProject.warnTimeout);
      if (typeof savedProject.onlineTimeout === "number") setOnlineTimeout(savedProject.onlineTimeout);
      if (savedProject.gmail !== undefined) setGmail(savedProject.gmail);
      if (savedProject.password !== undefined) setPassword(savedProject.password);
      if (savedProject.language !== undefined) setLanguage(savedProject.language);
      if (savedProject.theme) setTheme(savedProject.theme);
    }

    const savedAlerts = settings.alertsConfig as SavedAlertsConfig | undefined;
    const normalized = normalizeAlertConfig(
      savedAlerts,
      (settings as Record<string, unknown>).alertConfig,
    );
    setAlertClassify(normalized.classify ?? "Cấu hình ngưỡng theo thông số đo");
    setAlertCategories(normalized.categories);
    setActiveAlertGroupId((current) =>
      normalized.categories.some((c) => c.id === current) ? current : normalized.activeGroupId,
    );
    setAlertRulesByGroup(normalized.rulesByGroup);
    setAlertNotifications(normalized.notifications);
    setSeverityByCategory(normalized.severityByCategory);
    setThreshold(normalized.overConsumptionKwh ?? "1500");
    setDailyLimit(normalized.dailyLimit ?? 5000);
    setPeakWarn(normalized.peakHourWarning ?? true);

    const savedCost = settings.costConfig as SavedCostConfig | undefined;
    if (!savedCost) {
      setApplyDate("");
      setSlots([]);
      setTariffHistory([]);
      setFlatPrices({});
      setVoltageLevel(DEFAULT_VOLTAGE_LEVEL);
      setTouPrices(tariffInputs(DEFAULT_VOLTAGE_LEVEL));
      return;
    }
    setApplyDate(savedCost.applyDate ?? "");
    setSlots(savedCost.slots?.length ? savedCost.slots.map((slot) => ({ ...slot })) : []);
    setTariffHistory(savedCost.tariffHistory?.length ? savedCost.tariffHistory.map((h) => ({ ...h })) : []);
    setFlatPrices(savedCost.flatPrices ? { ...savedCost.flatPrices } : {});
    const tariff = resolveTouPrices(savedCost.electricity?.voltageLevel, savedCost.electricity?.prices);
    setVoltageLevel(tariff.levelId);
    setTouPrices({
      normal: formatTariffPrice(tariff.prices.normal),
      off: formatTariffPrice(tariff.prices.off),
      peak: formatTariffPrice(tariff.prices.peak),
    });
    if (savedCost.utility && types.includes(savedCost.utility)) setUtility(savedCost.utility);
  }

  useEffect(() => {
    const applyProject = (project = loadProjects().find((item) => item.id === projectId)) => {
      const types = resolveMeterTypes(project);
      setUtilities(types.length ? types : FALLBACK_UTILITIES);
      setUtility((current) => (types.includes(current) ? current : types[0] ?? "Điện"));
      return project;
    };
    const initialProject = applyProject();
    void hydrateProjects()
      .then((projects) => {
        const found = projects.find((item) => item.id === projectId) ?? initialProject;
        applyProject(found);
        return hydrateCustomerAccounts(projectId).then((loaded) => {
          if (!loaded.some((item) => item.id === `cus-${projectId}`) && found) {
            const primary = ensureCustomerAccount(found);
            setAccounts([primary, ...loaded.filter((item) => item.id !== primary.id)]);
          } else {
            setAccounts(loaded);
          }
        });
      })
      .catch(() => {
        void hydrateCustomerAccounts(projectId)
          .then(setAccounts)
          .catch(() => setAccounts(loadCustomerAccounts().filter((item) => item.projectId === projectId)));
      });
    void hydrateClientMeters(projectId)
      .then(setMeters)
      .catch(() => setMeters(loadClientMeters(projectId)));
    void hydrateProjectSettings(projectId, { force: true })
      .then((settings) => applyCostSettings(settings))
      .catch(() => undefined);
    setDevices(loadDevices());
  }, [projectId]);

  const markSaved = async () => {
    setSaveError("");
    setSaving(true);
    try {
      if (tab === "project") {
        const stored = await saveProjectSettings(projectId, {
          projectConfig: {
            classify,
            startTime,
            warnCount,
            warnTimeout,
            onlineTimeout,
            gmail,
            password,
            language,
            theme,
          },
        });
        applyCostSettings(stored);
        void hydrateAlertEvents(projectId, { force: true }).catch(() => undefined);
      } else if (tab === "alerts") {
        const stored = await saveProjectSettings(projectId, {
          alertsConfig: {
            classify: alertClassify,
            categories: alertCategories,
            activeGroupId: activeAlertGroupId,
            rulesByGroup: alertRulesByGroup,
            notifications: alertNotifications,
            severityByCategory,
            overConsumptionKwh: threshold,
            threshold,
            dailyLimit,
            peakWarn,
            peakHourWarning: peakWarn,
          },
        });
        applyCostSettings(stored);
        void hydrateAlertEvents(projectId, { force: true }).catch(() => undefined);
        // Đồng bộ các quy tắc ngưỡng đang bật xuống bảng gateway_thresholds
        const allRules = Object.values(alertRulesByGroup).flat();
        for (const rule of allRules) {
          if (!rule.enabled || !rule.parameterKey) continue;
          const minNum = rule.minValue.trim() ? Number(rule.minValue) : null;
          const maxNum = rule.maxValue.trim() ? Number(rule.maxValue) : null;
          if (
            (minNum == null || !Number.isFinite(minNum)) &&
            (maxNum == null || !Number.isFinite(maxNum))
          ) {
            continue;
          }
          const matchedMeter = rule.meterPointId
            ? meters.find((m) => m.id === rule.meterPointId)
            : undefined;
          const assignedDevice = matchedMeter?.deviceId
            ? devices.find((d) => d.id === matchedMeter.deviceId)
            : undefined;
          const meterId = assignedDevice?.sn || matchedMeter?.serialNumber || "";
          void fetch("/api/gateway/console", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "threshold",
              gatewayId: "",
              meterModel: "",
              meterId,
              parameterName: rule.parameterKey,
              minValue: minNum != null && Number.isFinite(minNum) ? minNum : null,
              maxValue: maxNum != null && Number.isFinite(maxNum) ? maxNum : null,
            }),
          }).catch(() => undefined);
        }
      } else if (tab === "cost") {
        // Tự động ghi mốc lịch sử biểu giá theo ngày bắt đầu áp dụng (applyDate) để bảo toàn kỳ tính giá trước đó
        let nextHistory = [...tariffHistory];
        if (applyDate) {
          const entry: TariffHistoryEntry = {
            applyDate,
            voltageLevel,
            prices: { ...touPrices },
            slots: slots.map((s) => ({ ...s })),
          };
          const existingIdx = nextHistory.findIndex((item) => item.applyDate === applyDate);
          if (existingIdx >= 0) {
            nextHistory[existingIdx] = entry;
          } else {
            nextHistory.push(entry);
          }
          nextHistory = nextHistory.sort((a, b) => a.applyDate.localeCompare(b.applyDate));
        }
        const stored = await saveProjectSettings(projectId, {
          costConfig: {
            utility,
            applyDate,
            slots,
            tariffHistory: nextHistory,
            flatPrices,
            electricity: {
              voltageLevel,
              prices: touPrices,
            },
          },
        });
        applyCostSettings(stored);
      } else {
        await saveClientMeters(projectId, meters);
        const refreshed = await hydrateClientMeters(projectId);
        if (refreshed.length) setMeters(refreshed);
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (error) {
      setSaved(false);
      setSaveError(error instanceof Error ? error.message : "Không thể lưu cấu hình. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  };

  const visibleMeters = useMemo(
    () => orderMetersByTree(meters.filter((item) => item.utility === utility)),
    [meters, utility],
  );

  const meta = {
    project: { title: "Thông tin dự án", hint: "Quản lý các thiết lập cơ bản cho dự án EMS" },
    meters: {
      title: "Cụm điểm đo",
      hint: `Cấu hình phân cấp cây cha–con của các điểm đo trên Sơ đồ · Dự án ${projectId}`,
    },
    cost: { title: "Cấu hình chi phí", hint: "Quản lý các thiết lập chi phí năng lượng cho nhà máy" },
    alerts: {
      title: "Cấu hình cảnh báo người dùng",
      hint: "Thiết lập mức độ phân loại cảnh báo (nghiêm trọng / cảnh báo / thông tin) và ngưỡng vận hành tiêu thụ của nhà máy.",
    },
    accounts: { title: "Quản lý tài khoản", hint: "Quản lý các thiết lập cơ bản cho dự án EMS" },
  }[tab];

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row bg-[#f4f6f9]">
      {/* Thanh tab cấu hình ngang trên Mobile */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 scrollbar-none md:hidden">
        {NAV.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                active
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-slate-100/80 text-slate-700 hover:bg-slate-200/70"
              }`}
            >
              <NavIcon type={item.icon} className="h-3.5 w-3.5 shrink-0" />
              <span>
                {item.n}. {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Sidebar tĩnh trên Desktop / Tablet */}
      <aside className="hidden md:flex w-[248px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h1 className="text-[16px] font-bold text-slate-800">Danh Sách Cấu Hình</h1>
        </div>
        <div className="px-3 py-3">
          <button
            type="button"
            onClick={() => setOpenParams((v) => !v)}
            className="mb-2 flex w-full items-center justify-between px-2 text-[11px] font-semibold tracking-[0.08em] text-slate-400"
          >
            CẤU HÌNH THÔNG SỐ
            <span className={`text-[10px] ${openParams ? "" : "-rotate-90"}`}>▾</span>
          </button>
          {openParams
            ? NAV.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`mb-1 flex h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-[13px] font-medium transition-colors ${
                    tab === item.id ? "bg-emerald-600 text-white shadow-xs" : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <NavIcon type={item.icon} className="h-4 w-4" />
                  {item.n}. {item.label}
                </button>
              ))
            : null}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:p-5">
        <section className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-5 lg:p-6">
          <div className="mb-4 sm:mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg sm:text-[22px] font-bold text-slate-800">{meta.title}</h2>
              <p className="mt-1 text-xs sm:text-sm text-slate-500">{meta.hint}</p>
            </div>
            {tab === "accounts" || canEditConfig ? (
              <button
                type="button"
                title="Lưu"
                onClick={() => void markSaved()}
                disabled={saving || (tab !== "accounts" && !canEditConfig)}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs transition-colors disabled:opacity-60"
              >
                {tab === "accounts" ? <FileIcon /> : <SaveIcon />}
              </button>
            ) : null}
          </div>

          {tab !== "accounts" && !canEditConfig ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-2.5 text-[12px] font-medium text-amber-800">
              Tài khoản nhánh của bạn đang có quyền <strong>Chỉ xem</strong> — chỉ được phép xem các thông số cấu hình, không thể chỉnh sửa hoặc lưu thay đổi.
            </div>
          ) : null}

          <fieldset disabled={tab !== "accounts" && !canEditConfig} className="m-0 min-w-0 border-0 p-0">
            {tab === "project" ? (
              <ProjectForm
                classify={classify}
                onClassify={setClassify}
                startTime={startTime}
                onStartTime={setStartTime}
                warnCount={warnCount}
                onWarnCount={setWarnCount}
                warnTimeout={warnTimeout}
                onWarnTimeout={setWarnTimeout}
                onlineTimeout={onlineTimeout}
                onOnlineTimeout={setOnlineTimeout}
                gmail={gmail}
                onGmail={setGmail}
                password={password}
                onPassword={setPassword}
                language={language}
                onLanguage={setLanguage}
                theme={theme}
                onTheme={setTheme}
              />
            ) : null}

            {tab === "meters" ? (
              <MetersPanel
                utility={utility}
                utilities={utilities}
                onUtility={setUtility}
                meters={visibleMeters}
                devices={devices}
                addMeterHref={addMeterHref}
                onMetersChange={(nextVisible) => {
                  if (!canEditConfig) return;
                  setMeters((current) => {
                    const other = current.filter((item) => item.utility !== utility);
                    return [...other, ...nextVisible];
                  });
                }}
              />
            ) : null}

            {tab === "cost" ? (
              <CostPanel
                utility={utility}
                utilities={utilities}
                onUtility={setUtility}
                applyDate={applyDate}
                onApplyDate={setApplyDate}
                voltageLevel={voltageLevel}
                touPrices={touPrices}
                slots={slots}
                onSlotsChange={setSlots}
                tariffHistory={tariffHistory}
                onTariffHistoryChange={setTariffHistory}
                onVoltageLevel={(levelId) => {
                  setVoltageLevel(levelId);
                  setTouPrices(tariffInputs(levelId));
                }}
                onTouPrice={(band, value) => setTouPrices((current) => ({ ...current, [band]: value }))}
                flatPrice={flatPrices[utility]}
                onFlatPrice={(value) => setFlatPrices((current) => ({ ...current, [utility]: value }))}
              />
            ) : null}

            {tab === "alerts" ? (
              <AlertsPanel
                classify={alertClassify}
                onClassify={setAlertClassify}
                categories={alertCategories}
                activeGroupId={activeAlertGroupId}
                onActiveGroup={setActiveAlertGroupId}
                onCategoriesChange={setAlertCategories}
                rulesByGroup={alertRulesByGroup}
                onRulesByGroupChange={setAlertRulesByGroup}
                notifications={alertNotifications}
                onNotificationsChange={setAlertNotifications}
                meters={meters}
                liveMeterValues={liveMeterValues}
                severityByCategory={severityByCategory}
                onSeverity={(category, level) =>
                  setSeverityByCategory((current) => ({ ...current, [category]: level }))
                }
                threshold={threshold}
                onThreshold={setThreshold}
                dailyLimit={dailyLimit}
                onDailyLimit={setDailyLimit}
                peakWarn={peakWarn}
                onPeakWarn={setPeakWarn}
              />
            ) : null}
          </fieldset>

          {tab === "accounts" ? (
            <AccountsPanel
              projectId={projectId}
              accounts={accounts}
              canManage={canManageCustomerAccounts}
              errorMessage={accountActionError}
              adding={adding}
              onAdding={(v) => {
                setAccountActionError("");
                setAdding(v);
              }}
              onSaveAccount={async (row) => {
                setAccountActionError("");
                try {
                  const saved = await upsertCustomerAccount(row);
                  setAccounts(saved.filter((item) => item.projectId === projectId));
                  setAdding(false);
                } catch (error) {
                  setAccountActionError(
                    error instanceof Error ? error.message : "Không thể lưu tài khoản khách hàng.",
                  );
                }
              }}
              onRemove={async (id) => {
                if (id === `cus-${projectId}`) {
                  setAccountActionError("Không thể xóa tài khoản Admin gốc của dự án.");
                  return;
                }
                setAccountActionError("");
                try {
                  const remaining = await removeCustomerAccount(id);
                  setAccounts(remaining.filter((item) => item.projectId === projectId));
                } catch (error) {
                  setAccountActionError(
                    error instanceof Error ? error.message : "Không thể xóa tài khoản khách hàng.",
                  );
                }
              }}
            />
          ) : null}

          {tab !== "accounts" && canEditConfig ? (
            <div className="mt-8 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setMeters(loadClientMeters(projectId));
                  void hydrateProjectSettings(projectId, { force: true }).then((settings) => {
                    applyCostSettings(settings);
                  });
                }}
                className="h-10 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={() => void markSaved()}
                disabled={saving}
                className="h-10 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700 shadow-xs transition-colors disabled:opacity-60"
              >
                {saving ? "Đang lưu..." : "Lưu cấu hình"}
              </button>
            </div>
          ) : null}
          {saveError ? (
            <p className="mt-3 text-right text-[12px] font-medium text-red-600">{saveError}</p>
          ) : saved ? (
            <p className="mt-3 text-right text-[12px] font-medium text-emerald-600">Đã lưu cấu hình vào database</p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function ProjectForm({
  classify,
  onClassify,
  startTime,
  onStartTime,
  warnCount,
  onWarnCount,
  warnTimeout,
  onWarnTimeout,
  onlineTimeout,
  onOnlineTimeout,
  gmail,
  onGmail,
  password,
  onPassword,
  language,
  onLanguage,
  theme,
  onTheme,
}: {
  classify: string;
  onClassify: (v: string) => void;
  startTime: string;
  onStartTime: (v: string) => void;
  warnCount: string;
  onWarnCount: (v: string) => void;
  warnTimeout: number;
  onWarnTimeout: (v: number) => void;
  onlineTimeout: number;
  onOnlineTimeout: (v: number) => void;
  gmail: string;
  onGmail: (v: string) => void;
  password: string;
  onPassword: (v: string) => void;
  language: string;
  onLanguage: (v: string) => void;
  theme: "Sáng" | "Tối" | "Hệ thống";
  onTheme: (v: "Sáng" | "Tối" | "Hệ thống") => void;
}) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-slate-400">PHÂN LOẠI</p>
      <CustomSelect
        value={classify}
        onChange={(e) => onClassify(e.target.value)}
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-500"
      >
        <option>Thông tin chung (Info)</option>
        <option>Thông tin kỹ thuật</option>
      </CustomSelect>
      <div className="mt-2 divide-y divide-slate-100">
        <Field n={1} title="Start Time" hint="Thời gian bắt đầu chu kỳ dữ liệu hệ thống">
          <DateInput value={startTime} onChange={onStartTime} />
        </Field>
        <Field n={2} title="Warning Number" hint="Số lượng cảnh báo tối đa cho phép trong hàng đợi">
          <input
            value={warnCount}
            onChange={(e) => onWarnCount(e.target.value)}
            placeholder="Nhập số lượng (ví dụ: 50)..."
            className="h-10 w-full max-w-xs rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500"
          />
        </Field>
        <Field n={3} title="Warning Timeout" hint="Thời gian chờ phản hồi cảnh báo (tối thiểu 1 phút)">
          <Stepper value={warnTimeout} min={1} onChange={onWarnTimeout} />
        </Field>
        <Field n={4} title="Online Timeout" hint="Thời gian xác định trạng thái ngoại tuyến (tối thiểu 2 phút)">
          <Stepper value={onlineTimeout} min={2} onChange={onOnlineTimeout} />
        </Field>
        <Field n={7} title="Gmail đăng nhập" hint="Email hệ thống dùng để gửi thông báo và báo cáo tự động">
          <input
            type="email"
            value={gmail}
            onChange={(e) => onGmail(e.target.value)}
            placeholder="example@ems-project.com"
            className="h-10 w-full max-w-sm rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500"
          />
        </Field>
        <Field n={8} title="Mật khẩu" hint="Mật khẩu bảo mật cho tài khoản hệ thống (đã mã hóa)">
          <input
            type="password"
            value={password}
            onChange={(e) => onPassword(e.target.value)}
            className="h-10 w-full max-w-sm rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500"
          />
        </Field>
        <Field n={5} title="Ngôn ngữ hệ thống" hint="Ngôn ngữ hiển thị trên toàn bộ giao diện quản trị">
          <CustomSelect
            value={language}
            onChange={(e) => onLanguage(e.target.value)}
            className="h-10 min-w-[180px] rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500"
          >
            <option>Tiếng Việt</option>
            <option>English</option>
          </CustomSelect>
        </Field>
        <Field n={6} title="Màu sắc giao diện" hint="Lựa chọn chủ đề sáng hoặc tối để phù hợp với môi trường làm việc">
          <div className="inline-flex overflow-hidden rounded-md border border-slate-200">
            {(["Sáng", "Tối", "Hệ thống"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onTheme(item)}
                className={`h-9 px-4 text-[13px] font-medium transition-colors ${
                  theme === item ? "bg-emerald-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </div>
  );
}

function MetersPanel({
  utility,
  utilities,
  onUtility,
  meters,
  devices,
  addMeterHref,
  onMetersChange,
}: {
  utility: Utility;
  utilities: string[];
  onUtility: (v: Utility) => void;
  meters: Meter[];
  devices: CatalogDevice[];
  addMeterHref?: string;
  onMetersChange: (rows: Meter[]) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; position: DropPosition } | null>(null);

  const depthMap = useMemo(() => buildMeterDepthMap(meters), [meters]);

  function resolveDropPosition(event: DragEvent<HTMLTableRowElement>): DropPosition {
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    const ratio = offsetY / rect.height;
    if (ratio < 0.28) return "before";
    if (ratio > 0.72) return "after";
    return "child";
  }

  function handleDrop(targetId: string, position: DropPosition) {
    if (!dragId) return;
    const next = applyMeterDrop(meters, dragId, targetId, position);
    if (next) onMetersChange(next);
    setDragId(null);
    setDropHint(null);
  }

  function changeParent(id: string, parentId: string | null) {
    if (parentId === id) return;
    if (parentId && isMeterDescendant(meters, id, parentId)) return;
    const ordered = orderMetersByTree(meters);
    const drag = ordered.find((meter) => meter.id === id);
    if (!drag) return;
    const without = ordered.filter((meter) => meter.id !== id);
    const moved: Meter = { ...drag, parentId };
    if (!parentId) {
      onMetersChange([...without, moved]);
      return;
    }
    const insertAt = findChildInsertIndex(without, parentId);
    const next = [...without.slice(0, insertAt), moved, ...without.slice(insertAt)];
    const depth = buildMeterDepthMap(next).get(id) ?? 0;
    if (depth > 2) return;
    onMetersChange(next);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <UtilityTabs value={utility} options={utilities} onChange={onUtility} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-600/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
            Kéo thả hoặc chọn điểm cha để phân cấp
          </span>
          {addMeterHref ? (
            <Link
              href={addMeterHref}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
            >
              + Thêm điểm đo
            </Link>
          ) : null}
        </div>
      </div>
      <p className="mt-3 text-[12px] text-slate-500">
        Kéo thả các hàng hoặc chọn trong cột <span className="font-semibold text-slate-700">ĐIỂM CHA</span> để thiết lập quan hệ cây phân cấp cha–con. Cấu trúc cây sẽ tự động đồng bộ và hiển thị trên <span className="font-semibold text-emerald-700">Sơ đồ hệ thống</span>.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[840px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-slate-100 text-[11px] font-semibold tracking-wide text-slate-400">
              <th className="py-2.5 pr-2 font-semibold">TÊN ĐIỂM ĐO</th>
              <th className="py-2.5 pr-2 font-semibold">MÃ ID</th>
              <th className="py-2.5 pr-2 font-semibold">ĐIỂM CHA</th>
              <th className="py-2.5 pr-2 font-semibold">THIẾT BỊ ĐÃ GÁN</th>
              <th className="py-2.5 pr-2 font-semibold">LOẠI THIẾT BỊ</th>
            </tr>
          </thead>
          <tbody>
            {meters.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sm text-slate-400">
                  Chưa có điểm đo loại {utility}.
                </td>
              </tr>
            ) : (
              meters.map((item) => {
                const depth = depthMap.get(item.id) ?? 0;
                const isDragging = dragId === item.id;
                const hint = dropHint?.id === item.id ? dropHint.position : null;
                const assigned = devices.find((device) => device.id === item.deviceId);
                return (
                  <tr
                    key={item.id}
                    draggable
                    onDragStart={(event) => {
                      setDragId(item.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", item.id);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (!dragId || dragId === item.id) return;
                      if (isMeterDescendant(meters, dragId, item.id)) return;
                      event.dataTransfer.dropEffect = "move";
                      setDropHint({ id: item.id, position: resolveDropPosition(event) });
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (!dragId || dragId === item.id) return;
                      handleDrop(item.id, resolveDropPosition(event));
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropHint(null);
                    }}
                    className={`border-b border-slate-50 text-slate-700 transition-colors ${
                      isDragging ? "opacity-40" : ""
                    } ${
                      hint === "child"
                        ? "bg-emerald-50 ring-1 ring-inset ring-emerald-500/30"
                        : hint
                          ? "bg-slate-50"
                          : "hover:bg-slate-50/70"
                    }`}
                  >
                    <td className="relative py-3 pr-2">
                      {hint === "before" ? (
                        <span className="absolute inset-x-0 top-0 h-0.5 bg-emerald-600" />
                      ) : null}
                      {hint === "after" ? (
                        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-emerald-600" />
                      ) : null}
                      <span
                        className="inline-flex w-full items-center gap-2"
                        style={{ paddingLeft: depth * 22 }}
                      >
                        <span
                          className="cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
                          title="Kéo thả để sắp xếp phân cấp"
                        >
                          <DragHandle />
                        </span>
                        {depth > 0 ? <span className="font-bold text-slate-300">↳</span> : null}
                        <span className="truncate text-[13px] font-semibold text-slate-800">
                          {item.name}
                        </span>
                        {hint === "child" ? (
                          <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                            Làm con
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="py-3 pr-2">
                      <span className="inline-flex rounded-md bg-slate-100 px-2 py-1 font-mono text-[12px] font-semibold text-slate-700">
                        {item.code}
                      </span>
                    </td>
                    <td className="py-3 pr-2">
                      <CustomSelect
                        value={item.parentId ?? ""}
                        onChange={(e) => changeParent(item.id, e.target.value || null)}
                        className="h-8 max-w-[200px] rounded-md border border-slate-200 bg-white px-2 text-[12px] font-medium text-slate-700 outline-none focus:border-emerald-500 shadow-2xs cursor-pointer"
                      >
                        <option value="">Không có điểm đo cha (Gốc)</option>
                        {meters
                          .filter((meter) => meter.id !== item.id && !isMeterDescendant(meters, item.id, meter.id))
                          .map((meter) => (
                            <option key={meter.id} value={meter.id}>
                              Con của: {meter.name}
                            </option>
                          ))}
                      </CustomSelect>
                    </td>
                    <td className="py-3 pr-2">
                      <div className="space-y-1.5">
                        {assigned ? (
                          <div>
                            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[12px] font-medium text-emerald-800">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              {assigned.name} · {assigned.sn}
                            </span>
                            <span className="mt-0.5 block truncate text-[10px] text-slate-400">
                              ID: {assigned.id}
                            </span>
                          </div>
                        ) : item.serialNumber ? (
                          <div>
                            <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[12px] font-medium text-amber-700">
                              Serial: {item.serialNumber}
                            </span>
                          </div>
                        ) : (
                          <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[12px] font-medium text-amber-700">
                            Chưa gán thiết bị
                          </span>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <CustomSelect
                            value={item.deviceId ?? ""}
                            onChange={(e) => {
                              const nextDevId = e.target.value;
                              const dev = devices.find((d) => d.id === nextDevId);
                              onMetersChange(
                                meters.map((m) =>
                                  m.id === item.id
                                    ? {
                                        ...m,
                                        deviceId: nextDevId,
                                        serialNumber: dev?.sn ?? m.serialNumber ?? "",
                                      }
                                    : m,
                                ),
                              );
                            }}
                            className="h-7 max-w-[180px] rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 outline-none focus:border-emerald-500"
                          >
                            <option value="">-- Đổi / Gán đồng hồ --</option>
                            {devices.map((dev) => (
                              <option key={dev.id} value={dev.id}>
                                {dev.name} ({dev.sn})
                              </option>
                            ))}
                          </CustomSelect>
                          <input
                            value={item.serialNumber ?? assigned?.sn ?? ""}
                            onChange={(e) => {
                              const sn = e.target.value;
                              onMetersChange(
                                meters.map((m) =>
                                  m.id === item.id ? { ...m, serialNumber: sn } : m,
                                ),
                              );
                            }}
                            placeholder="Nhập SN công tơ mới..."
                            title="Thay đổi Serial đồng hồ tại điểm đo này (dữ liệu đồng hồ cũ vẫn được bảo toàn theo lịch sử)"
                            className="h-7 w-36 rounded border border-slate-200 bg-white px-2 font-mono text-[11px] text-slate-700 outline-none focus:border-emerald-500"
                          />
                        </div>
                        {item.serialHistory && item.serialHistory.length > 1 ? (
                          <div className="rounded border border-sky-200 bg-sky-50/70 px-2 py-1 text-[10px] text-sky-800">
                            <span className="font-semibold">Lịch sử thay đồng hồ:</span>{" "}
                            {item.serialHistory.map((h, idx) => (
                              <span key={`${h.serialNumber}-${idx}`}>
                                {idx > 0 ? " → " : ""}
                                <span className="font-mono font-semibold">{h.serialNumber}</span>
                                {h.validTo ? ` (đến ${h.validTo.slice(0, 16).replace("T", " ")})` : " (đang đo)"}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-3 pr-2 text-[12px] text-slate-600">{item.type}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function findChildInsertIndex(ordered: Meter[], parentId: string) {
  const parentIndex = ordered.findIndex((meter) => meter.id === parentId);
  if (parentIndex < 0) return ordered.length;

  const parentDepth = buildMeterDepthMap(ordered).get(parentId) ?? 0;
  let index = parentIndex + 1;
  const depths = buildMeterDepthMap(ordered);
  while (index < ordered.length && (depths.get(ordered[index].id) ?? 0) > parentDepth) {
    index += 1;
  }
  return index;
}

function applyMeterDrop(
  meters: Meter[],
  dragId: string,
  targetId: string,
  position: DropPosition,
): Meter[] | null {
  if (dragId === targetId) return null;
  if (isMeterDescendant(meters, dragId, targetId)) return null;

  const drag = meters.find((meter) => meter.id === dragId);
  const target = meters.find((meter) => meter.id === targetId);
  if (!drag || !target) return null;

  const ordered = orderMetersByTree(meters);
  const without = ordered.filter((meter) => meter.id !== dragId);
  const depths = buildMeterDepthMap(without);
  const targetDepth = depths.get(targetId) ?? 0;

  let parentId: string | null;
  let insertAt: number;

  if (position === "child") {
    if (targetDepth >= 2) return null;
    parentId = targetId;
    insertAt = findChildInsertIndex(without, targetId);
  } else {
    parentId = target.parentId;
    const targetIndex = without.findIndex((meter) => meter.id === targetId);
    insertAt = position === "before" ? targetIndex : targetIndex + 1;
  }

  const moved: Meter = { ...drag, parentId };
  const next = [...without.slice(0, insertAt), moved, ...without.slice(insertAt)];

  for (const meter of next) {
    const depth = buildMeterDepthMap(next).get(meter.id) ?? 0;
    if (depth > 2) return null;
  }

  return next;
}

function CostPanel({
  utility,
  utilities,
  onUtility,
  applyDate,
  onApplyDate,
  voltageLevel,
  touPrices,
  slots,
  onSlotsChange,
  tariffHistory,
  onTariffHistoryChange,
  onVoltageLevel,
  onTouPrice,
  flatPrice,
  onFlatPrice,
}: {
  utility: Utility;
  utilities: string[];
  onUtility: (v: Utility) => void;
  applyDate: string;
  onApplyDate: (v: string) => void;
  voltageLevel: VoltageLevelId;
  touPrices: TouPriceInputs;
  slots: Slot[];
  onSlotsChange: (next: Slot[]) => void;
  tariffHistory: TariffHistoryEntry[];
  onTariffHistoryChange: (next: TariffHistoryEntry[]) => void;
  onVoltageLevel: (levelId: VoltageLevelId) => void;
  onTouPrice: (band: TouBand, value: string) => void;
  flatPrice?: string;
  onFlatPrice: (value: string) => void;
}) {
  const isElectric = utility === "Điện";
  const unitMeta: Record<string, { title: string; hint: string; unit: string; defaultPrice: string }> = {
    Điện: {
      title: "Giá điện sản xuất theo khung giờ",
      hint: `Đơn giá chưa gồm VAT theo ${INDUSTRIAL_TARIFF_DECISION}. Khung giờ theo ${INDUSTRIAL_SCHEDULE_DECISION}.`,
      unit: "đồng/kWh",
      defaultPrice: "0",
    },
    Nước: {
      title: "Đơn giá nước",
      hint: "Cấu hình đơn giá tiêu thụ nước (VNĐ/m³)",
      unit: "VNĐ/m³",
      defaultPrice: "12,500",
    },
    Nhiệt: {
      title: "Đơn giá nhiệt",
      hint: "Cấu hình đơn giá năng lượng nhiệt (VNĐ/kWh)",
      unit: "VNĐ/kWh",
      defaultPrice: "2,100",
    },
    Hơi: {
      title: "Đơn giá hơi",
      hint: "Cấu hình đơn giá hơi công nghệ (VNĐ/tấn)",
      unit: "VNĐ/tấn",
      defaultPrice: "850,000",
    },
  };
  const meta = unitMeta[utility] ?? {
    title: `Đơn giá ${utility}`,
    hint: `Cấu hình đơn giá cho ${utility}`,
    unit: "VNĐ",
    defaultPrice: "0",
  };
  const flatPriceValue = flatPrice ?? meta.defaultPrice;

  return (
    <div>
      <UtilityTabs value={utility} options={utilities} onChange={onUtility} />
      <div className="mt-5 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-5">
        <div>
          <p className="text-[15px] font-semibold text-slate-800">Ngày bắt đầu áp dụng</p>
          <p className="mt-1 text-[12px] text-slate-500">
            Thời gian chi phí mới bắt đầu có hiệu lực trong hệ thống (dữ liệu trước ngày này vẫn giữ nguyên biểu giá cũ)
          </p>
        </div>
        <DateInput value={applyDate} onChange={onApplyDate} />
      </div>

      {isElectric ? (
        <div className="mt-5 space-y-5">
          <div>
            <p className="text-[15px] font-semibold text-slate-800">{meta.title}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{meta.hint}</p>
            <p className="mt-2 text-[12px] text-slate-500">
              Tiền điện năng = sản lượng bình thường × đơn giá bình thường + sản lượng thấp điểm × đơn giá thấp điểm + sản lượng cao điểm × đơn giá cao điểm.
            </p>
          </div>

          <label className="block max-w-md">
            <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-400">
              CẤP ĐIỆN ÁP
            </span>
            <CustomSelect
              value={voltageLevel}
              onChange={(e) => onVoltageLevel(e.target.value as VoltageLevelId)}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-500"
            >
              {INDUSTRIAL_VOLTAGE_LEVELS.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.label}
                </option>
              ))}
            </CustomSelect>
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["normal", "Giờ bình thường", "#27ae60"],
                ["off", "Giờ thấp điểm", "#7ec8e3"],
                ["peak", "Giờ cao điểm", "#e67e22"],
              ] as const
            ).map(([band, label, color]) => (
              <label key={band} className="rounded-md border border-slate-200 p-3">
                <span className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-slate-400">
                  <span className="h-4 w-1 rounded-full" style={{ backgroundColor: color }} />
                  {label.toUpperCase()}
                </span>
                <span className="relative block">
                  <input
                    value={touPrices[band]}
                    onChange={(e) => onTouPrice(band, e.target.value)}
                    inputMode="decimal"
                    className="h-10 w-full rounded-md border border-slate-200 pr-16 pl-3 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-500"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11px] text-slate-400">
                    đ/kWh
                  </span>
                </span>
              </label>
            ))}
          </div>

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <div className="min-w-[480px]">
              <div className="grid grid-cols-4 bg-slate-50 px-4 py-2 text-[11px] font-semibold tracking-wide text-slate-400">
                <span>CẤP ĐIỆN ÁP</span>
                <span>BÌNH THƯỜNG</span>
                <span>THẤP ĐIỂM</span>
                <span>CAO ĐIỂM</span>
              </div>
              {INDUSTRIAL_VOLTAGE_LEVELS.map((level) => {
                const selected = level.id === voltageLevel;
                const normal = selected ? parseTariffPrice(touPrices.normal) : level.normal;
                const off = selected ? parseTariffPrice(touPrices.off) : level.off;
                const peak = selected ? parseTariffPrice(touPrices.peak) : level.peak;
                return (
                  <div
                    key={level.id}
                    className={`grid grid-cols-4 border-t border-slate-100 px-4 py-2.5 text-sm ${
                      selected ? "bg-emerald-50/70 font-semibold text-slate-800" : "text-slate-600"
                    }`}
                  >
                    <span>{level.label}{selected ? " · đang dùng" : ""}</span>
                    <span className="font-mono">{formatTariffPrice(normal)}</span>
                    <span className="font-mono">{formatTariffPrice(off)}</span>
                    <span className="font-mono">{formatTariffPrice(peak)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="text-[12px] text-slate-400">
            Dòng được tô là đơn giá đang áp dụng và sẽ ghi vào database khi bấm Lưu cấu hình. Các dòng còn lại là biểu giá nhà nước để đối chiếu. Đổi cấp điện áp sẽ điền lại đơn giá theo biểu giá đó.
          </p>

          <div className="grid gap-2 text-[12px] text-slate-600 sm:grid-cols-3">
            <p className="rounded-md bg-slate-50 px-3 py-2">
              <span className="block font-semibold text-slate-700">Giờ thấp điểm</span>
              00:00 – 06:00, tất cả các ngày trong tuần.
            </p>
            <p className="rounded-md bg-slate-50 px-3 py-2">
              <span className="block font-semibold text-slate-700">Giờ bình thường</span>
              06:00 – 17:30 và 22:30 – 24:00 từ thứ Hai đến thứ Bảy. Chủ nhật: 06:00 – 24:00.
            </p>
            <p className="rounded-md bg-slate-50 px-3 py-2">
              <span className="block font-semibold text-slate-700">Giờ cao điểm</span>
              17:30 – 22:30 từ thứ Hai đến thứ Bảy. Chủ nhật không có giờ cao điểm.
            </p>
          </div>

          {/* Khung giờ tùy chỉnh mở rộng (VD: chuyển từ 3 khung giá sang 4 khung giá từ ngày áp dụng) */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-bold text-slate-800">
                  Khung giá điện tùy chỉnh mở rộng (3 khung → 4+ khung giờ)
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Khi thêm các khung giờ tùy chỉnh bên dưới, hệ thống sẽ ưu tiên áp dụng các khung giờ này từ{" "}
                  <strong>{applyDate || "ngày hiệu lực"}</strong>.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {slots.length === 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      onSlotsChange([
                        { id: "slot-1", name: "Khung 1 (Thấp điểm)", color: "#7ec8e3", from: "00:00", to: "06:00", price: touPrices.off },
                        { id: "slot-2", name: "Khung 2 (Bình thường sáng)", color: "#27ae60", from: "06:00", to: "17:30", price: touPrices.normal },
                        { id: "slot-3", name: "Khung 3 (Cao điểm)", color: "#e67e22", from: "17:30", to: "22:30", price: touPrices.peak },
                        { id: "slot-4", name: "Khung 4 (Đêm / Phụ tải đặc biệt)", color: "#8b5cf6", from: "22:30", to: "24:00", price: touPrices.normal },
                      ])
                    }
                    className="h-8 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                  >
                    + Tạo mẫu 4 khung giá
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    onSlotsChange([
                      ...slots,
                      {
                        id: `slot-${Date.now()}`,
                        name: `Khung giá #${slots.length + 1}`,
                        color: ["#27ae60", "#7ec8e3", "#e67e22", "#8b5cf6", "#ef4444"][slots.length % 5],
                        from: "00:00",
                        to: "24:00",
                        price: touPrices.normal,
                      },
                    ])
                  }
                  className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  + Thêm khung giá
                </button>
              </div>
            </div>

            {slots.length > 0 ? (
              <div className="mt-3 space-y-2">
                {slots.map((slot, idx) => (
                  <div
                    key={slot.id}
                    className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-white p-2.5 sm:grid-cols-[1.4fr_110px_110px_140px_auto]"
                  >
                    <input
                      value={slot.name}
                      onChange={(e) =>
                        onSlotsChange(
                          slots.map((s, i) => (i === idx ? { ...s, name: e.target.value } : s)),
                        )
                      }
                      placeholder="Tên khung giờ..."
                      className="h-8 rounded border border-slate-200 px-2.5 text-xs font-medium text-slate-800 outline-none focus:border-emerald-500"
                    />
                    <input
                      value={slot.from}
                      onChange={(e) =>
                        onSlotsChange(
                          slots.map((s, i) => (i === idx ? { ...s, from: e.target.value } : s)),
                        )
                      }
                      placeholder="Từ (HH:mm)"
                      className="h-8 rounded border border-slate-200 px-2.5 font-mono text-xs text-slate-700 outline-none focus:border-emerald-500"
                    />
                    <input
                      value={slot.to}
                      onChange={(e) =>
                        onSlotsChange(
                          slots.map((s, i) => (i === idx ? { ...s, to: e.target.value } : s)),
                        )
                      }
                      placeholder="Đến (HH:mm)"
                      className="h-8 rounded border border-slate-200 px-2.5 font-mono text-xs text-slate-700 outline-none focus:border-emerald-500"
                    />
                    <div className="relative">
                      <input
                        value={slot.price}
                        onChange={(e) =>
                          onSlotsChange(
                            slots.map((s, i) => (i === idx ? { ...s, price: e.target.value } : s)),
                          )
                        }
                        placeholder="Đơn giá"
                        className="h-8 w-full rounded border border-slate-200 pr-12 pl-2.5 font-mono text-xs font-semibold text-slate-800 outline-none focus:border-emerald-500"
                      />
                      <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-slate-400">
                        đ/kWh
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSlotsChange(slots.filter((_, i) => i !== idx))}
                      className="h-8 rounded border border-rose-200 bg-rose-50 px-2.5 text-xs font-medium text-rose-600 hover:bg-rose-100"
                    >
                      Xóa
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Lịch sử các mốc thay đổi biểu giá theo ngày áp dụng */}
          {tariffHistory.length > 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-[12px] font-bold tracking-wide text-slate-700 uppercase">
                Lịch sử các mốc áp dụng biểu giá điện ({tariffHistory.length} mốc)
              </p>
              <div className="mt-2 space-y-1.5 text-xs text-slate-600">
                {tariffHistory.map((h, i) => (
                  <div
                    key={`${h.applyDate}-${i}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-100 bg-slate-50 px-3 py-2"
                  >
                    <div>
                      <span className="font-semibold text-slate-800">Từ ngày {h.applyDate}:</span>{" "}
                      {h.slots && h.slots.length > 0 ? (
                        <span>
                          {h.slots.length} khung giá tùy chỉnh (
                          {h.slots.map((s) => `${s.name}: ${s.price} đ`).join(", ")})
                        </span>
                      ) : (
                        <span>
                          3 khung EVN (BT: {h.prices?.normal} · TĐ: {h.prices?.off} · CĐ: {h.prices?.peak} đ/kWh)
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onTariffHistoryChange(tariffHistory.filter((_, idx) => idx !== i))}
                      className="text-[11px] font-medium text-rose-600 hover:underline"
                    >
                      Xóa mốc
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-5">
          <p className="text-[15px] font-semibold text-slate-800">{meta.title}</p>
          <p className="mt-1 text-[12px] text-slate-500">{meta.hint}</p>
          <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
            {utility} không dùng khung giờ cao điểm / thấp điểm — chỉ cấu hình đơn giá cố định.
          </p>
          <div className="mt-4 max-w-md rounded-md border border-slate-200 p-4">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-400">
                ĐƠN GIÁ ({meta.unit})
              </span>
              <span className="relative block">
                <input
                  value={flatPriceValue}
                  onChange={(e) => onFlatPrice(e.target.value)}
                  className="h-10 w-full rounded-md border border-slate-200 pr-14 pl-3 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-500"
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11px] text-slate-400">
                  VNĐ
                </span>
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function groupToChartId(groupId: string): MeterChartId | null {
  switch (groupId) {
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

function parametersForAlertGroup(groupId: string): MeterParameter[] {
  const chartId = groupToChartId(groupId);
  if (!chartId) return METER_PARAMETERS;
  const primary = parametersForChart(chartId);
  return primary.length > 0 ? primary : METER_PARAMETERS;
}

function AlertsPanel({
  classify,
  onClassify,
  categories,
  activeGroupId,
  onActiveGroup,
  onCategoriesChange,
  rulesByGroup,
  onRulesByGroupChange,
  notifications,
  onNotificationsChange,
  meters,
  liveMeterValues,
  severityByCategory,
  onSeverity,
  threshold,
  onThreshold,
  dailyLimit,
  onDailyLimit,
  peakWarn,
  onPeakWarn,
}: {
  classify: string;
  onClassify: (v: string) => void;
  categories: UserAlertCategoryTab[];
  activeGroupId: UserAlertGroupId;
  onActiveGroup: (id: UserAlertGroupId) => void;
  onCategoriesChange: (next: UserAlertCategoryTab[]) => void;
  rulesByGroup: Record<string, UserAlertRule[]>;
  onRulesByGroupChange: (next: Record<string, UserAlertRule[]>) => void;
  notifications: NotificationChannelsConfig;
  onNotificationsChange: (next: NotificationChannelsConfig) => void;
  meters: ClientMeter[];
  liveMeterValues: Record<string, { at: string; values: Record<string, number> }>;
  severityByCategory: Record<AlertCategoryId, AlertSeverityLevel>;
  onSeverity: (category: AlertCategoryId, level: AlertSeverityLevel) => void;
  threshold: string;
  onThreshold: (v: string) => void;
  dailyLimit: number;
  onDailyLimit: (v: number) => void;
  peakWarn: boolean;
  onPeakWarn: (v: boolean) => void;
}) {
  const [selectedMeterId, setSelectedMeterId] = useState<string>("all");
  const [addingTag, setAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [showSeverityDefaults, setShowSeverityDefaults] = useState(false);

  const activeCategory = categories.find((c) => c.id === activeGroupId) ?? categories[0];
  const currentGroupId = activeCategory?.id ?? "energy";
  const allRulesInGroup = rulesByGroup[currentGroupId] ?? [];
  const visibleRules =
    selectedMeterId === "all"
      ? allRulesInGroup
      : allRulesInGroup.filter((r) => !r.meterPointId || r.meterPointId === selectedMeterId);

  const groupParams = useMemo(() => parametersForAlertGroup(currentGroupId), [currentGroupId]);

  const combinedLiveValues = useMemo(() => {
    if (selectedMeterId !== "all" && liveMeterValues[selectedMeterId]) {
      return liveMeterValues[selectedMeterId].values;
    }
    const merged: Record<string, number> = {};
    for (const entry of Object.values(liveMeterValues)) {
      for (const [k, v] of Object.entries(entry.values)) {
        if (merged[k] === undefined && typeof v === "number" && Number.isFinite(v)) {
          merged[k] = v;
        }
      }
    }
    return merged;
  }, [liveMeterValues, selectedMeterId]);

  function updateGroupRules(nextList: UserAlertRule[]) {
    onRulesByGroupChange({
      ...rulesByGroup,
      [currentGroupId]: nextList,
    });
  }

  function updateRule(ruleId: string, patch: Partial<UserAlertRule>) {
    updateGroupRules(
      allRulesInGroup.map((item) => (item.id === ruleId ? { ...item, ...patch } : item)),
    );
  }

  function addRule() {
    const fallbackParam = groupParams[allRulesInGroup.length % Math.max(groupParams.length, 1)] ?? METER_PARAMETERS[0];
    const nextRule: UserAlertRule = {
      id: `rule-${currentGroupId}-${Date.now()}`,
      groupId: currentGroupId,
      name: fallbackParam ? `Ngưỡng ${fallbackParam.name}` : `Ngưỡng cảnh báo #${allRulesInGroup.length + 1}`,
      parameterKey: fallbackParam?.key ?? "",
      minValue: "",
      maxValue: "",
      unit: fallbackParam?.unit ?? "",
      severity: "warning",
      enabled: true,
      meterPointId: selectedMeterId === "all" ? undefined : selectedMeterId,
      description: fallbackParam ? `Tham số đo: ${fallbackParam.key} (${fallbackParam.group})` : "",
    };
    updateGroupRules([...allRulesInGroup, nextRule]);
  }

  function removeRule(ruleId: string) {
    updateGroupRules(allRulesInGroup.filter((item) => item.id !== ruleId));
  }

  function restoreDefaultGroupRules() {
    const defaults = DEFAULT_USER_ALERT_RULES[currentGroupId];
    if (defaults?.length) {
      updateGroupRules(defaults.map((item) => ({ ...item, id: `${item.id}-${Date.now()}` })));
    }
  }

  function handleAddCategory() {
    const label = newTagName.trim();
    if (!label) return;
    const slug = `custom-${label.toLowerCase().replace(/\s+/g, "-")}-${Date.now().toString().slice(-4)}`;
    const nextCategories = [...categories, { id: slug, label }];
    onCategoriesChange(nextCategories);
    onRulesByGroupChange({
      ...rulesByGroup,
      [slug]: [],
    });
    onActiveGroup(slug);
    setNewTagName("");
    setAddingTag(false);
  }

  function handleRemoveCategory(catId: string) {
    if (categories.length <= 1) return;
    const nextCategories = categories.filter((c) => c.id !== catId);
    onCategoriesChange(nextCategories);
    if (activeGroupId === catId && nextCategories[0]) {
      onActiveGroup(nextCategories[0].id);
    }
  }

  return (
    <div className="space-y-5">
      {/* Bộ lọc Phân loại & Điểm đo áp dụng */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-slate-400">
            PHÂN LOẠI CẤU HÌNH
          </p>
          <CustomSelect
            value={classify}
            onChange={(e) => onClassify(e.target.value)}
            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-500"
          >
            <option value="Cấu hình ngưỡng theo thông số đo">Cấu hình ngưỡng theo thông số đo</option>
            <option value="Thông tin chung (Info)">Thông tin chung & Ngưỡng tiêu thụ (Info)</option>
            <option value="Mức độ phân loại lỗi">Mức độ phân loại cảnh báo theo danh mục</option>
          </CustomSelect>
        </div>
        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-slate-400">
            ĐIỂM ĐO ÁP DỤNG
          </p>
          <CustomSelect
            value={selectedMeterId}
            onChange={(e) => setSelectedMeterId(e.target.value)}
            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-500"
          >
            <option value="all">Tất cả điểm đo trong dự án ({meters.length} điểm đo)</option>
            {meters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.code})
              </option>
            ))}
          </CustomSelect>
        </div>
      </div>

      {/* Thanh tab nhóm cảnh báo: Energy | U/I | Tần số | Công suất | Sóng hài | Mất cân bằng pha */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-slate-400">
            NHÓM CẢNH BÁO THÔNG SỐ
          </p>
          <button
            type="button"
            onClick={() => setShowSeverityDefaults((v) => !v)}
            className="text-xs font-semibold text-emerald-600 hover:underline"
          >
            {showSeverityDefaults ? "Ẩn mức độ mặc định theo danh mục" : "Thiết lập mức độ mặc định theo danh mục"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {categories.map((cat) => {
            const active = cat.id === currentGroupId;
            const count = (rulesByGroup[cat.id] ?? []).filter((r) => r.enabled).length;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onActiveGroup(cat.id)}
                className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span>{cat.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    active ? "bg-white/20 text-white" : "bg-slate-200/80 text-slate-600"
                  }`}
                >
                  {count}
                </span>
                {categories.length > 1 ? (
                  <span
                    role="presentation"
                    title="Xóa nhóm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveCategory(cat.id);
                    }}
                    className="ml-0.5 text-[12px] opacity-70 hover:opacity-100"
                  >
                    ×
                  </span>
                ) : null}
              </button>
            );
          })}
          {addingTag ? (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50/60 p-1">
              <input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddCategory();
                  }
                }}
                placeholder="Tên nhóm mới..."
                className="h-7 w-36 rounded border border-slate-200 bg-white px-2 text-xs outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={handleAddCategory}
                className="h-7 rounded bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                Thêm
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddingTag(false);
                  setNewTagName("");
                }}
                className="h-7 px-1.5 text-xs text-slate-500 hover:text-slate-700"
              >
                Hủy
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingTag(true)}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-dashed border-emerald-300 bg-emerald-50/40 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
            >
              + Thêm mới
            </button>
          )}
        </div>
      </div>

      {/* Bảng mức độ mặc định theo danh mục (khi bấm mở hoặc chọn phân loại Mức độ phân loại lỗi) */}
      {showSeverityDefaults || classify === "Mức độ phân loại lỗi" ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold tracking-wide text-slate-700 uppercase">
                Mức độ cảnh báo mặc định theo danh mục lỗi
              </p>
              <p className="text-[11px] text-slate-500">
                Áp dụng phân loại mức độ (Nghiêm trọng / Cảnh báo / Thông tin) cho các cảnh báo chung thuộc từng danh mục.
              </p>
            </div>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {ALERT_CATEGORY_OPTIONS.map((option) => (
              <div
                key={option.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-800">{option.label}</p>
                  <p className="truncate text-[10px] text-slate-400">{option.hint}</p>
                </div>
                <CustomSelect
                  value={severityByCategory[option.id]}
                  onChange={(e) => onSeverity(option.id, e.target.value as AlertSeverityLevel)}
                  className={`h-8 w-32 shrink-0 rounded-md border px-2 text-xs font-semibold outline-none ${
                    severityByCategory[option.id] === "critical"
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : severityByCategory[option.id] === "warning"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-slate-200 bg-slate-50 text-slate-700"
                  }`}
                >
                  <option value="critical">Nghiêm trọng</option>
                  <option value="warning">Cảnh báo</option>
                  <option value="info">Thông tin</option>
                </CustomSelect>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Danh sách cấu hình ngưỡng chi tiết của nhóm đang chọn */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">
              Danh sách ngưỡng cảnh báo · {activeCategory?.label ?? currentGroupId}
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Cài đặt ngưỡng giới hạn dưới (Min) và giới hạn trên (Max) cho các thông số đo thực tế từ đồng hồ.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {DEFAULT_USER_ALERT_RULES[currentGroupId] ? (
              <button
                type="button"
                onClick={restoreDefaultGroupRules}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Khôi phục mặc định
              </button>
            ) : null}
            <button
              type="button"
              onClick={addRule}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
            >
              + Thêm ngưỡng cảnh báo
            </button>
          </div>
        </div>

        {visibleRules.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-slate-500">
              Chưa có ngưỡng cảnh báo nào trong nhóm {activeCategory?.label}.
            </p>
            <div className="mt-3 flex justify-center gap-2">
              {DEFAULT_USER_ALERT_RULES[currentGroupId] ? (
                <button
                  type="button"
                  onClick={restoreDefaultGroupRules}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Nạp bộ ngưỡng tiêu chuẩn
                </button>
              ) : null}
              <button
                type="button"
                onClick={addRule}
                className="rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                + Thêm ngưỡng cảnh báo đầu tiên
              </button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {visibleRules.map((rule, idx) => {
              const matchedParam = METER_PARAMETERS.find((p) => p.key === rule.parameterKey);
              const liveValue = rule.parameterKey
                ? readMeterValue(combinedLiveValues, rule.parameterKey)
                : null;
              const minNum = rule.minValue.trim() !== "" ? Number(rule.minValue) : null;
              const maxNum = rule.maxValue.trim() !== "" ? Number(rule.maxValue) : null;
              const isViolated =
                rule.enabled &&
                liveValue !== null &&
                ((minNum !== null && Number.isFinite(minNum) && liveValue < minNum) ||
                  (maxNum !== null && Number.isFinite(maxNum) && liveValue > maxNum));
              const unitDisplay = rule.unit || matchedParam?.unit || "";

              return (
                <div
                  key={rule.id}
                  className={`p-4 transition-colors ${
                    !rule.enabled
                      ? "bg-slate-50/50 opacity-65"
                      : isViolated
                        ? "bg-rose-50/30"
                        : "bg-white hover:bg-slate-50/40"
                  }`}
                >
                  <div className="grid gap-3 lg:grid-cols-12 lg:items-center">
                    {/* Cột 1: STT + Bật/tắt + Tên cảnh báo */}
                    <div className="flex items-start gap-2.5 lg:col-span-4">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={rule.enabled}
                        title={rule.enabled ? "Đang bật cảnh báo" : "Đang tắt cảnh báo"}
                        onClick={() => updateRule(rule.id, { enabled: !rule.enabled })}
                        className={`mt-2 relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                          rule.enabled ? "bg-emerald-600" : "bg-slate-300"
                        }`}
                      >
                        <span
                          className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
                          style={{ left: rule.enabled ? 18 : 2 }}
                        />
                      </button>
                      <div className="min-w-0 flex-1">
                        <label className="mb-1 block text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                          #{idx + 1} · Tên cảnh báo
                        </label>
                        <input
                          value={rule.name}
                          onChange={(e) => updateRule(rule.id, { name: e.target.value })}
                          placeholder="Nhập tên cảnh báo..."
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    {/* Cột 2: Tham số đo từ đồng hồ */}
                    <div className="lg:col-span-3">
                      <label className="mb-1 block text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                        Tham số đo (Gateway)
                      </label>
                      <CustomSelect
                        value={rule.parameterKey}
                        onChange={(e) => {
                          const nextKey = e.target.value;
                          const param = METER_PARAMETERS.find((p) => p.key === nextKey);
                          updateRule(rule.id, {
                            parameterKey: nextKey,
                            unit: param?.unit ?? rule.unit,
                            name:
                              !rule.name || rule.name.startsWith("Ngưỡng ")
                                ? param
                                  ? `Ngưỡng ${param.name} (${param.key})`
                                  : rule.name
                                : rule.name,
                          });
                        }}
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 outline-none focus:border-emerald-500"
                      >
                        <option value="">-- Chọn tham số đo --</option>
                        {groupParams.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.key} — {p.name} {p.unit ? `(${p.unit})` : ""}
                          </option>
                        ))}
                        {METER_PARAMETERS.filter((p) => !groupParams.some((gp) => gp.key === p.key)).map(
                          (p) => (
                            <option key={p.key} value={p.key}>
                              [{p.group}] {p.key} — {p.name} {p.unit ? `(${p.unit})` : ""}
                            </option>
                          ),
                        )}
                      </CustomSelect>
                    </div>

                    {/* Cột 3: Ngưỡng Min & Max */}
                    <div className="grid grid-cols-2 gap-2 lg:col-span-3">
                      <div>
                        <label className="mb-1 block text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                          Ngưỡng thấp (Min)
                        </label>
                        <div className="relative">
                          <input
                            value={rule.minValue}
                            onChange={(e) => updateRule(rule.id, { minValue: e.target.value })}
                            placeholder="Không giới hạn"
                            inputMode="decimal"
                            className="h-9 w-full rounded-lg border border-slate-200 bg-white pr-8 pl-2.5 font-mono text-xs font-semibold text-slate-800 outline-none focus:border-emerald-500"
                          />
                          {unitDisplay ? (
                            <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] font-semibold text-slate-400">
                              {unitDisplay}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                          Ngưỡng cao (Max)
                        </label>
                        <div className="relative">
                          <input
                            value={rule.maxValue}
                            onChange={(e) => updateRule(rule.id, { maxValue: e.target.value })}
                            placeholder="Không giới hạn"
                            inputMode="decimal"
                            className="h-9 w-full rounded-lg border border-slate-200 bg-white pr-8 pl-2.5 font-mono text-xs font-semibold text-slate-800 outline-none focus:border-emerald-500"
                          />
                          {unitDisplay ? (
                            <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] font-semibold text-slate-400">
                              {unitDisplay}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* Cột 4: Mức độ + Xóa */}
                    <div className="flex items-end gap-2 lg:col-span-2">
                      <div className="min-w-0 flex-1">
                        <label className="mb-1 block text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                          Mức độ
                        </label>
                        <CustomSelect
                          value={rule.severity}
                          onChange={(e) =>
                            updateRule(rule.id, { severity: e.target.value as AlertSeverityLevel })
                          }
                          className={`h-9 w-full rounded-lg border px-2 text-xs font-semibold outline-none ${
                            rule.severity === "critical"
                              ? "border-rose-200 bg-rose-50 text-rose-700"
                              : rule.severity === "warning"
                                ? "border-amber-200 bg-amber-50 text-amber-800"
                                : "border-slate-200 bg-slate-50 text-slate-700"
                          }`}
                        >
                          <option value="critical">Nghiêm trọng</option>
                          <option value="warning">Cảnh báo</option>
                          <option value="info">Thông tin</option>
                        </CustomSelect>
                      </div>
                      <button
                        type="button"
                        title="Xóa ngưỡng cảnh báo này"
                        onClick={() => removeRule(rule.id)}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {/* Dòng thông tin phụ: Giá trị đo thực tế hiện tại + mô tả */}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-0 sm:pl-11 text-[11px]">
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono font-semibold ${
                          liveValue === null
                            ? "bg-slate-100 text-slate-500"
                            : isViolated
                              ? "bg-rose-100 text-rose-700 ring-1 ring-rose-300"
                              : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            liveValue === null
                              ? "bg-slate-400"
                              : isViolated
                                ? "bg-rose-600 animate-pulse"
                                : "bg-emerald-500"
                          }`}
                        />
                        Giá trị thực hiện tại:{" "}
                        {liveValue !== null ? `${liveValue} ${unitDisplay}`.trim() : "Chưa có mẫu đo"}
                        {isViolated ? " (Vượt ngưỡng!)" : ""}
                      </span>
                      {rule.description ? (
                        <span className="text-slate-400">{rule.description}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Ngưỡng vận hành điện năng tiêu thụ (hiển thị trong nhóm Energy hoặc chế độ Thông tin chung) */}
      {currentGroupId === "energy" || classify === "Thông tin chung (Info)" ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-1 text-xs font-bold tracking-wide text-slate-700 uppercase">
            Ngưỡng vận hành tiêu thụ điện năng (Tổng hợp nhà máy)
          </p>
          <p className="mb-3 text-[11px] text-slate-500">
            Cảnh báo khi sản lượng tiêu thụ điện vượt định mức cho phép theo chu kỳ hoặc giờ cao điểm.
          </p>
          <div className="divide-y divide-slate-100">
            <Field title="Over-consumption threshold" hint="Ngưỡng tiêu thụ vượt mức cho phép (kWh)">
              <div className="relative">
                <input
                  value={threshold}
                  onChange={(e) => onThreshold(e.target.value)}
                  placeholder="VD: 1500"
                  className="h-10 w-36 rounded-md border border-slate-200 pr-12 pl-3 text-sm font-semibold outline-none focus:border-emerald-500"
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-slate-400">
                  kWh
                </span>
              </div>
            </Field>
            <Field title="Daily limit" hint="Giới hạn tiêu thụ hàng ngày tối đa (kWh/ngày)">
              <Stepper value={dailyLimit} min={0} onChange={onDailyLimit} />
            </Field>
            <Field title="Peak Hour Warning" hint="Cảnh báo khi tiêu thụ cao trong giờ cao điểm (17:30 – 22:30)">
              <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                <button
                  type="button"
                  role="switch"
                  aria-checked={peakWarn}
                  onClick={() => onPeakWarn(!peakWarn)}
                  className={`relative h-6 w-11 rounded-full transition-colors ${peakWarn ? "bg-emerald-600" : "bg-slate-300"}`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${peakWarn ? "left-5.5" : "left-0.5"}`}
                    style={{ left: peakWarn ? 22 : 2 }}
                  />
                </button>
                Kích hoạt
              </label>
            </Field>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AccountsPanel({
  projectId,
  accounts,
  canManage,
  errorMessage,
  adding,
  onAdding,
  onSaveAccount,
  onRemove,
}: {
  projectId: string;
  accounts: CustomerAccount[];
  canManage: boolean;
  errorMessage?: string;
  adding: boolean;
  onAdding: (v: boolean) => void;
  onSaveAccount: (row: CustomerAccount) => Promise<void> | void;
  onRemove: (id: string) => Promise<void> | void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    username: string;
    displayName: string;
    role: CustomerBranchRole;
    email: string;
    password: string;
  }>({
    username: "",
    displayName: "",
    role: "Chỉ xem",
    email: "",
    password: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const displayAccounts = useMemo(() => {
    if (accounts.length > 0) return accounts;
    const project = loadProjects().find((item) => item.id === projectId);
    return [
      defaultCustomerAccount({
        id: projectId,
        customer: project?.customer ?? projectId,
      }),
    ];
  }, [accounts, projectId]);

  const isEditingPrimary = editingId === `cus-${projectId}`;

  function startCreate() {
    setEditingId(null);
    setDraft({
      username: "",
      displayName: "",
      role: "Chỉ xem",
      email: "",
      password: "",
    });
    onAdding(true);
  }

  function startEdit(row: CustomerAccount) {
    const isPrimary = row.id === `cus-${projectId}`;
    const normalized = normalizeCustomerRole(row.role, isPrimary);
    setEditingId(row.id);
    setDraft({
      username: row.username,
      displayName: row.displayName,
      role: normalized === "Xem và chỉnh sửa" ? "Xem và chỉnh sửa" : "Chỉ xem",
      email: row.email,
      password: "",
    });
    onAdding(true);
  }

  function cancelForm() {
    setEditingId(null);
    onAdding(false);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-slate-800">
            Danh sách tài khoản truy cập ứng dụng ({displayAccounts.length})
          </h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Hệ thống khởi tạo tài khoản <strong>Admin</strong> ban đầu. Từ tài khoản Admin, khách hàng tạo các tài khoản nhánh với quyền <strong>Chỉ xem</strong> hoặc <strong>Xem và chỉnh sửa</strong> cấu hình thông số.
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={startCreate}
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 text-sm font-medium text-white hover:bg-emerald-700 shadow-xs transition-colors"
          >
            <UserPlusIcon />
            + Thêm mới tài khoản
          </button>
        ) : (
          <span className="rounded-md bg-slate-100 px-3 py-1.5 text-[12px] font-medium text-slate-500">
            Chỉ tài khoản Admin mới có quyền quản lý tài khoản nhánh
          </span>
        )}
      </div>

      {errorMessage ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-600">
          {errorMessage}
        </div>
      ) : null}

      {adding && canManage ? (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="mb-2.5 flex items-center justify-between">
            <p className="text-[13px] font-semibold text-slate-800">
              {editingId
                ? isEditingPrimary
                  ? "Cập nhật tài khoản Admin ban đầu"
                  : "Cập nhật tài khoản nhánh"
                : "Tạo tài khoản nhánh mới"}
            </p>
            <span className="text-[11px] text-slate-500">
              {editingId
                ? "Để trống mật khẩu nếu giữ nguyên mật khẩu hiện tại"
                : "Mật khẩu mặc định là 123456 nếu để trống"}
            </span>
          </div>
          <div className="grid gap-2.5 md:grid-cols-6">
            <input
              value={draft.username}
              onChange={(e) => setDraft({ ...draft, username: e.target.value })}
              placeholder="Tên đăng nhập (VD: vanhanh_ca1)"
              className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-sm"
            />
            <input
              value={draft.displayName}
              onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              placeholder="Họ tên / Bộ phận"
              className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-sm"
            />
            <input
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              placeholder="Email đăng nhập"
              className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-sm"
            />
            {isEditingPrimary ? (
              <input
                value="Admin (Tài khoản ban đầu)"
                disabled
                className="h-9 rounded-md border border-slate-200 bg-slate-100 px-2.5 text-sm font-medium text-slate-600"
              />
            ) : (
              <CustomSelect
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value as CustomerBranchRole })}
                className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-700"
              >
                {CUSTOMER_BRANCH_ROLES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </CustomSelect>
            )}
            <input
              type="password"
              value={draft.password}
              onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              placeholder={editingId ? "Mật khẩu mới (tùy chọn)" : "Mật khẩu (mặc định 123456)"}
              className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={async () => {
                  const username = draft.username.trim();
                  const email = draft.email.trim() || `${username.toLowerCase()}@ems.local`;
                  if (!username) return;
                  setSubmitting(true);
                  try {
                    await onSaveAccount({
                      id: editingId ?? `cus-${projectId}-${Date.now()}`,
                      username,
                      displayName: draft.displayName.trim() || username,
                      role: isEditingPrimary ? "Admin" : draft.role,
                      email,
                      projectId,
                      password: editingId ? draft.password.trim() : draft.password.trim() || "123456",
                    });
                    setEditingId(null);
                    setDraft({
                      username: "",
                      displayName: "",
                      role: "Chỉ xem",
                      email: "",
                      password: "",
                    });
                  } finally {
                    setSubmitting(false);
                  }
                }}
                className="h-9 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700 shadow-xs transition-colors disabled:opacity-60"
              >
                {submitting ? "Đang lưu..." : editingId ? "Lưu" : "Thêm"}
              </button>
              <button
                type="button"
                onClick={cancelForm}
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-600 hover:bg-slate-50"
              >
                Hủy
              </button>
            </div>
          </div>
          {!isEditingPrimary ? (
            <p className="mt-2 text-[11px] text-slate-500">
              • <strong>Chỉ xem:</strong> Chỉ được xem dữ liệu và thông số cấu hình. &nbsp;|&nbsp; •{" "}
              <strong>Xem và chỉnh sửa:</strong> Được phép xem và chỉnh sửa các thông số trong phần Cấu hình (Dự án, Cụm điểm đo, Chi phí, Cảnh báo).
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-slate-100 text-[11px] font-semibold tracking-wide text-slate-400">
              <th className="py-2">TÊN NGƯỜI DÙNG / HỌ TÊN</th>
              <th className="py-2">VAI TRÒ PHÂN QUYỀN</th>
              <th className="py-2">EMAIL</th>
              <th className="py-2">TRẠNG THÁI</th>
              <th className="py-2 text-right">THAO TÁC</th>
            </tr>
          </thead>
          <tbody>
            {displayAccounts.map((row) => {
              const isPrimaryAdmin = row.id === `cus-${projectId}`;
              const roleLabel = normalizeCustomerRole(row.role, isPrimaryAdmin);
              return (
                <tr key={row.id} className="border-b border-slate-50">
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-800">{row.username}</p>
                      {isPrimaryAdmin ? (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                          Admin ban đầu
                        </span>
                      ) : (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          Tài khoản nhánh
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-slate-500">{row.displayName}</p>
                  </td>
                  <td className="py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        roleLabel === "Admin"
                          ? "bg-slate-900 text-white"
                          : roleLabel === "Xem và chỉnh sửa"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-sky-50 text-sky-700"
                      }`}
                    >
                      {roleLabel}
                    </span>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {roleLabel === "Admin"
                        ? "Toàn quyền cấu hình & tạo tài khoản nhánh"
                        : roleLabel === "Xem và chỉnh sửa"
                          ? "Được xem và chỉnh sửa cấu hình thông số"
                          : "Chỉ xem dữ liệu & thông số"}
                    </p>
                  </td>
                  <td className="py-3 text-slate-600">{row.email}</td>
                  <td className="py-3">
                    <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                      Đang hoạt động
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    {canManage ? (
                      <span className="inline-flex justify-end gap-1 text-slate-400">
                        <IconBtn label="Sửa tài khoản" onClick={() => startEdit(row)}>
                          <PencilIcon />
                        </IconBtn>
                        {!isPrimaryAdmin ? (
                          <IconBtn label="Xóa tài khoản nhánh" onClick={() => void onRemove(row.id)}>
                            <TrashIcon />
                          </IconBtn>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UtilityTabs({
  value,
  options,
  onChange,
}: {
  value: Utility;
  options: string[];
  onChange: (v: Utility) => void;
}) {
  return (
    <div className="flex gap-5 border-b border-slate-200">
      {options.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={`h-10 text-[14px] font-medium transition-colors ${
            value === item ? "border-b-2 border-emerald-600 text-emerald-600" : "text-slate-400 hover:text-slate-600"
          }`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function Field({
  n,
  title,
  hint,
  children,
}: {
  n?: number;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div>
        <p className="text-[14px] font-medium text-slate-800">
          {n ? `${n}. ` : ""}
          {title}
        </p>
        <p className="mt-0.5 text-[12px] text-slate-500">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [y, m, d] = value.split("-");
  const label = y && m && d ? `${d}/${m}/${y}` : value;
  return (
    <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700">
      {label}
      <CalendarIcon />
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="sr-only" />
    </label>
  );
}

function Stepper({ value, min, onChange }: { value: number; min: number; onChange: (v: number) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-slate-200">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} className="h-10 w-10 text-slate-500 hover:bg-slate-50">
        −
      </button>
      <span className="flex h-10 min-w-[52px] items-center justify-center border-x border-slate-200 text-sm font-semibold">
        {value}
      </span>
      <button type="button" onClick={() => onChange(value + 1)} className="h-10 w-10 text-slate-500 hover:bg-slate-50">
        +
      </button>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-slate-100 hover:text-slate-700"
    >
      {children}
    </button>
  );
}

function NavIcon({ type, className }: { type: "doc" | "nodes" | "cash" | "warn" | "user"; className?: string }) {
  if (type === "nodes") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="6" cy="12" r="2" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="18" cy="6" r="2" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="18" cy="18" r="2" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 12h8M16.3 7.6 8 11M16.3 16.4 8 13" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (type === "cash") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="12" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (type === "warn") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M12 4 3.5 19h17L12 4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M12 10v5M12 17.4v.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "user") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="9" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="16" cy="9" r="1.8" stroke="currentColor" strokeWidth="1.7" />
        <path d="M4.5 18c.8-2.5 2.6-4 5.5-4s4.7 1.5 5.5 4M14 14.2c1.7.2 3.1 1.2 4 3.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 3.5h7l5 5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M14 3.5V9h5.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path d="M5 5h11l3 3v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 5v5h8M8 19v-6h8v6" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path d="M7 3.5h7l5 5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function DragHandle() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-slate-300" aria-hidden>
      <circle cx="5" cy="4" r="1.1" fill="currentColor" />
      <circle cx="11" cy="4" r="1.1" fill="currentColor" />
      <circle cx="5" cy="8" r="1.1" fill="currentColor" />
      <circle cx="11" cy="8" r="1.1" fill="currentColor" />
      <circle cx="5" cy="12" r="1.1" fill="currentColor" />
      <circle cx="11" cy="12" r="1.1" fill="currentColor" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path
        d="M5 7h14M10 11v6M14 11v6M9 7V5h6v2M7 7l1 12h8l1-12"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path d="M4 20h4l11-11-4-4L4 16v4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function UserPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <circle cx="10" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.8 18c.7-2.6 2.6-4 5.2-4s4.5 1.4 5.2 4M17 8v6M14 11h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" aria-hidden>
      <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 3.5V7M16 3.5V7M4 10h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
