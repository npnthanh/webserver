"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CustomSelect } from "@/components/ui/CustomSelect";
import type { Project } from "@/lib/projects";
import { normalizeAlertConfig } from "@/lib/alert-config";
import { alertValueText, hydrateAlertEvents, type AlertEvent } from "@/lib/alert-events";
import { hydrateClientMeters } from "@/lib/client-meters";
import { computeSourceTons, hydrateGhgSources, type GhgEmissionSource } from "@/lib/ghg-sources";
import { hydrateDevices } from "@/lib/devices";
import {
  resolveElectricityRateAt,
  resolveTouPrices,
  type SavedElectricityCostConfig,
  type TouPrices,
} from "@/lib/industrial-electricity";
import { readMeterValue, registerToKwh } from "@/lib/meter-parameters";
import { formatAppNumber } from "@/lib/number-format";
import { hydrateProjectSettings } from "@/lib/project-settings";
import {
  loadProjectGatewayDaily,
  loadProjectGatewayEnergySlots,
  loadProjectGatewayLatest,
  type GatewayDailyPoint,
  type GatewayEnergySlot,
  type ProjectGatewaySample,
} from "@/lib/gateway-series";
import { formatStoredVietnam, vietnamFromStored } from "@/lib/vietnam-time";

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

type DashboardAlert = { id: string; time: string; point: string; param: string; value: string };
type EnergyPoint = { day: string; label: string; kwh: number; indexKwh: number; hasSample: boolean };
type StatusSlice = { label: string; value: number; color: string };

const EMPTY_STATUS: StatusSlice[] = [
  { label: "BÌNH THƯỜNG", value: 0, color: "#43a047" },
  { label: "CẢNH BÁO", value: 0, color: "#ef8d3a" },
  { label: "NGOẠI TUYẾN", value: 0, color: "#9aa3af" },
];

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthRange(year: number, month: number) {
  const last = daysInMonth(year, month);
  return {
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(last)}`,
    last,
  };
}

function formatKwh(value: number) {
  if (!Number.isFinite(value)) return "0,0";
  const digits = Math.abs(value) > 0 && Math.abs(value) < 10 ? 3 : 1;
  return formatAppNumber(value, { maxDecimals: digits, minDecimals: digits });
}

function formatReading(value: number, digits: number) {
  if (!Number.isFinite(value)) return "0";
  return formatAppNumber(value, { maxDecimals: digits, minDecimals: digits });
}

function formatVnd(value: number) {
  return formatAppNumber(Math.round(value), { maxDecimals: 0 });
}

function slotStoredAt(day: string, hour: number, minute: number) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour, minute) - 7 * 60 * 60 * 1000).toISOString().slice(0, 19);
}

function monthlyCostFromSlots(
  slots: GatewayEnergySlot[],
  prices: TouPrices,
  costConfig?: SavedElectricityCostConfig,
) {
  const byMeter = new Map<string, GatewayEnergySlot[]>();
  for (const slot of slots) {
    const key = `${slot.meterPointId}:${(slot as { meterId?: string }).meterId ?? ""}`;
    const list = byMeter.get(key) ?? [];
    list.push(slot);
    byMeter.set(key, list);
  }
  let total = 0;
  for (const list of byMeter.values()) {
    const ordered = [...list].sort(
      (a, b) => a.day.localeCompare(b.day) || a.hour - b.hour || a.minute - b.minute,
    );
    let previous: number | null = null;
    for (const slot of ordered) {
      const startKwh = registerToKwh(slot.firstWh);
      const endKwh = registerToKwh(slot.lastWh);
      // Nếu công tơ bị thay mới hoặc reset chỉ số về nhỏ hơn trước đó, tính bắt đầu lại từ startKwh
      if (previous != null && startKwh < previous) {
        previous = startKwh;
      }
      const within = Math.max(0, endKwh - startKwh);
      const gap = previous == null ? 0 : Math.max(0, startKwh - previous);
      const delta = within + gap;
      previous = endKwh >= startKwh ? endKwh : startKwh;
      if (delta <= 0) continue;
      const parts = vietnamFromStored(slotStoredAt(slot.day, slot.hour, slot.minute));
      if (!parts) continue;
      if (costConfig) {
        const rate = resolveElectricityRateAt(costConfig, parts);
        total += delta * rate.price;
      } else {
        const rate = resolveElectricityRateAt(
          {
            electricity: {
              prices: {
                normal: String(prices.normal),
                off: String(prices.off),
                peak: String(prices.peak),
              },
            },
          },
          parts,
        );
        total += delta * rate.price;
      }
    }
  }
  return total;
}

function monthEnergySeries(rows: GatewayDailyPoint[], year: number, month: number): EnergyPoint[] {
  const byDay = new Map<string, { kwh: number; indexKwh: number }>();
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.day)) continue;
    const firstKwh = registerToKwh(Number(row.firstWh));
    const lastKwh = registerToKwh(Number(row.lastWh));
    if (!Number.isFinite(firstKwh) || !Number.isFinite(lastKwh)) continue;
    const consumed = Math.max(0, lastKwh - firstKwh);
    const current = byDay.get(row.day) ?? { kwh: 0, indexKwh: 0 };
    byDay.set(row.day, {
      kwh: current.kwh + consumed,
      indexKwh: current.indexKwh + lastKwh,
    });
  }
  const last = daysInMonth(year, month);
  return Array.from({ length: last }, (_, index) => {
    const day = index + 1;
    const iso = `${year}-${pad2(month)}-${pad2(day)}`;
    const point = byDay.get(iso);
    return {
      day: iso,
      label: pad2(day),
      kwh: point?.kwh ?? 0,
      indexKwh: point?.indexKwh ?? 0,
      hasSample: Boolean(point),
    };
  });
}

export function ClientDashboard({ project }: { project: Project }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [dailyRows, setDailyRows] = useState<GatewayDailyPoint[]>([]);
  const [monthSlots, setMonthSlots] = useState<GatewayEnergySlot[]>([]);
  const [latest, setLatest] = useState<ProjectGatewaySample | null>(null);
  const [touPrices, setTouPrices] = useState<TouPrices>(() => resolveTouPrices("kv-under-6").prices);
  const [savedCostConfig, setSavedCostConfig] = useState<SavedElectricityCostConfig | undefined>(undefined);
  const [rawGhgSources, setRawGhgSources] = useState<GhgEmissionSource[]>([]);
  const [deviceStatus, setDeviceStatus] = useState(EMPTY_STATUS);
  const [alerts, setAlerts] = useState<DashboardAlert[]>([]);
  const [prevMonthKwh, setPrevMonthKwh] = useState<number | null>(null);
  const [pollTick, setPollTick] = useState(0);
  const alignedMonth = useRef(false);

  useEffect(() => {
    alignedMonth.current = false;
  }, [project.id]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") {
        setPollTick((value) => value + 1);
      }
    };
    const timer = window.setInterval(tick, 15_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const reload = () => {
      void Promise.all([
        hydrateAlertEvents(project.id, { force: true }),
        hydrateDevices(),
        hydrateClientMeters(project.id),
        hydrateGhgSources(project.id),
        hydrateProjectSettings(project.id),
        loadProjectGatewayLatest(project.id).catch(() => [] as ProjectGatewaySample[]),
      ]).then(([alertEvents, devices, meters, sources, settings, latestList]) => {
        if (!active) return;
        const saved = settings.costConfig as SavedElectricityCostConfig | undefined;
        setSavedCostConfig(saved);
        setTouPrices(resolveTouPrices(saved?.electricity?.voltageLevel, saved?.electricity?.prices).prices);

        const settingsRec = settings as Record<string, unknown>;
        const projectCfg = (settingsRec.projectConfig ?? {}) as { onlineTimeout?: number };
        const adminAlertCfg = (settingsRec.alertConfig ?? {}) as { commLossMinutes?: number };
        const timeoutMinutes = Math.max(
          1,
          Number(projectCfg.onlineTimeout ?? adminAlertCfg.commLossMinutes ?? 10) || 10,
        );
        const timeoutMs = timeoutMinutes * 60 * 1000;
        const userAlertCfg = normalizeAlertConfig(settingsRec.alertsConfig, settingsRec.alertConfig);
        const enabledRules = Object.values(userAlertCfg.rulesByGroup ?? {})
          .flat()
          .filter((r) => r.enabled && r.parameterKey);

        const warningPointIds = new Set<string>();
        const liveAlerts: DashboardAlert[] = [];

        for (const sample of latestList) {
          const meter = meters.find((m) => m.id === sample.meterPointId);
          for (const rule of enabledRules) {
            if (rule.meterPointId && rule.meterPointId !== sample.meterPointId) continue;
            const actual = readMeterValue(sample.values, rule.parameterKey);
            if (actual === null) continue;
            const minNum = rule.minValue.trim() !== "" ? Number(rule.minValue) : null;
            const maxNum = rule.maxValue.trim() !== "" ? Number(rule.maxValue) : null;
            const belowMin = minNum !== null && Number.isFinite(minNum) && actual < minNum;
            const aboveMax = maxNum !== null && Number.isFinite(maxNum) && actual > maxNum;
            if (!belowMin && !aboveMax) continue;
            warningPointIds.add(sample.meterPointId);
            const alreadyInDb = alertEvents.some(
              (ev) =>
                ev.parameter === rule.parameterKey &&
                (ev.meterPointId === sample.meterPointId || ev.pointName === meter?.name),
            );
            if (!alreadyInDb) {
              liveAlerts.push({
                id: `LIVE-${sample.meterPointId}-${rule.id}`,
                time: formatStoredVietnam(sample.at) ?? sample.at,
                point: meter?.name ?? sample.meterPointId,
                param: rule.parameterKey,
                value: `${actual}${rule.unit ? ` ${rule.unit}` : ""}`,
              });
            }
          }
        }

        // Chỉ đếm điểm đo của chính dự án này. Dự án chưa có điểm đo => 0 (không lấy thư viện thiết bị chung
        // của cả hệ thống). Điểm đo chưa có bản tin nào (chưa gán đồng hồ / gateway chưa gửi) => ngoại tuyến.
        const counts = { normal: 0, warning: 0, offline: 0 };
        const nowMs = Date.now();
        for (const meter of meters) {
          const sample = latestList.find((s) => s.meterPointId === meter.id);
          const linkedDev = meter.deviceId ? devices.find((d) => d.id === meter.deviceId) : undefined;
          const sampleMs = sample?.at ? Date.parse(`${sample.at.replace(" ", "T")}Z`) : Number.NaN;
          const isOffline =
            !Number.isFinite(sampleMs) || nowMs - sampleMs > timeoutMs || linkedDev?.status === "offline";
          if (isOffline) {
            counts.offline += 1;
          } else if (warningPointIds.has(meter.id) || linkedDev?.status === "maintenance") {
            counts.warning += 1;
          } else {
            counts.normal += 1;
          }
        }

        setDeviceStatus([
          { label: "BÌNH THƯỜNG", value: counts.normal, color: "#43a047" },
          { label: "CẢNH BÁO", value: counts.warning, color: "#ef8d3a" },
          { label: "NGOẠI TUYẾN", value: counts.offline, color: "#9aa3af" },
        ]);

        const dbDashboardAlerts: DashboardAlert[] = alertEvents.map((event: AlertEvent) => ({
          id: event.id ?? `${event.occurredAt}-${event.meterPointId}-${event.parameter}`,
          time: formatStoredVietnam(event.occurredAt) ?? event.occurredAt,
          point: event.pointName ?? event.meterPointId ?? "--",
          param: event.parameter,
          value: alertValueText(event),
        }));

        setAlerts([...liveAlerts, ...dbDashboardAlerts].slice(0, 12));
        setRawGhgSources(sources);
      }).catch(() => undefined);
    };
    reload();
    window.addEventListener("ems-alert-events-changed", reload);
    window.addEventListener("ems-client-meters-changed", reload);
    window.addEventListener("ems-ghg-sources-changed", reload);
    window.addEventListener("ems-project-settings-changed", reload);
    return () => {
      active = false;
      window.removeEventListener("ems-alert-events-changed", reload);
      window.removeEventListener("ems-client-meters-changed", reload);
      window.removeEventListener("ems-ghg-sources-changed", reload);
      window.removeEventListener("ems-project-settings-changed", reload);
    };
  }, [project.id, pollTick]);

  useEffect(() => {
    let active = true;
    const { from, to } = monthRange(year, month);
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    void Promise.all([
      loadProjectGatewayDaily(project.id, year, month),
      loadProjectGatewayEnergySlots(project.id, from, to),
      loadProjectGatewayDaily(project.id, prevYear, prevMonth),
    ]).then(([summary, slots, prevSummary]) => {
      if (!active) return;
      setDailyRows(summary.days);
      setLatest(summary.latest);
      setMonthSlots(slots.slots);
      const prevSeries = monthEnergySeries(prevSummary.days, prevYear, prevMonth);
      const prevTotal = prevSeries.reduce((sum, item) => sum + item.kwh, 0);
      setPrevMonthKwh(prevSummary.days.length ? prevTotal : null);
    });
    return () => {
      active = false;
    };
  }, [project.id, year, month, pollTick]);

  useEffect(() => {
    if (alignedMonth.current || !latest) return;
    const stamp = vietnamFromStored(latest.at);
    if (!stamp) return;
    alignedMonth.current = true;
    if (stamp.year !== year || stamp.month !== month) {
      setYear(stamp.year);
      setMonth(stamp.month);
    }
  }, [latest, year, month]);

  const energySeries = useMemo(() => monthEnergySeries(dailyRows, year, month), [dailyRows, year, month]);
  const consumptionTotal = energySeries.reduce((sum, item) => sum + item.kwh, 0);
  const kwhByPointId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of dailyRows) {
      const firstKwh = registerToKwh(Number(row.firstWh));
      const lastKwh = registerToKwh(Number(row.lastWh));
      if (!Number.isFinite(firstKwh) || !Number.isFinite(lastKwh)) continue;
      const consumed = Math.max(0, lastKwh - firstKwh);
      map[row.meterPointId] = (map[row.meterPointId] ?? 0) + consumed;
    }
    return map;
  }, [dailyRows]);

  const { co2, ghgSourceCount, topGhgText } = useMemo(() => {
    const computedSources = rawGhgSources.map((source) => ({
      name: source.name,
      tons: computeSourceTons(source, kwhByPointId, consumptionTotal, {
        mode: "month",
        year,
        month,
      }),
    }));
    const totalTons = computedSources.reduce((sum, item) => sum + item.tons, 0);
    const top = [...computedSources].sort((a, b) => b.tons - a.tons)[0];
    const topText =
      top && totalTons > 0
        ? `${top.name}: ${formatAppNumber(top.tons, { maxDecimals: 4 })} tấn (${Math.round((top.tons / totalTons) * 100)}%)`
        : "";
    return {
      co2: totalTons,
      ghgSourceCount: computedSources.length,
      topGhgText: topText,
    };
  }, [rawGhgSources, kwhByPointId, consumptionTotal, year, month]);

  const chartSeries = energySeries.map((item) => ({
    day: item.label,
    kwh: item.kwh,
    hasSample: item.hasSample,
  }));
  const sampledValues = chartSeries.filter((item) => item.hasSample).map((item) => item.kwh);
  const energyMax = sampledValues.length ? Math.max(...sampledValues) : 0;
  const energyMin = sampledValues.length ? Math.min(...sampledValues) : 0;
  const monthCost = useMemo(
    () => monthlyCostFromSlots(monthSlots, touPrices, savedCostConfig),
    [monthSlots, touPrices, savedCostConfig],
  );
  const monthCostThousands = monthCost / 1000;

  const energyMom = useMemo(() => {
    if (prevMonthKwh == null || !Number.isFinite(prevMonthKwh) || prevMonthKwh <= 0) return null;
    const delta = consumptionTotal - prevMonthKwh;
    const pct = (delta / prevMonthKwh) * 100;
    return { delta, pct, prev: prevMonthKwh };
  }, [consumptionTotal, prevMonthKwh]);

  const energyCaption =
    energyMom != null
      ? `${energyMom.delta >= 0 ? "Tăng" : "Giảm"} ${formatKwh(Math.abs(energyMom.delta))} kWh (${formatAppNumber(Math.abs(energyMom.pct), { maxDecimals: 1 })}%) so với tháng trước (${formatKwh(energyMom.prev)} kWh)`
      : sampledValues.length > 0
        ? `Tháng ${pad2(month)}/${year}: ${sampledValues.length} ngày có số liệu · Tổng ${formatKwh(consumptionTotal)} kWh`
        : `Tháng ${pad2(month)}/${year}: 0,0 kWh`;

  const co2Caption =
    co2 > 0
      ? topGhgText || `${ghgSourceCount} nguồn phát thải · Tổng ${formatAppNumber(co2, { maxDecimals: 4 })} tấn CO₂e`
      : ghgSourceCount > 0
        ? `${ghgSourceCount} nguồn phát thải · Tổng 0,00 tấn CO₂e`
        : "0 nguồn phát thải · 0,00 tấn CO₂e";

  return (
    <div className="mx-auto h-full max-w-[1480px] overflow-y-auto px-3 py-3.5 sm:px-5 sm:py-5 lg:px-6">
      <div className="mb-3.5 sm:mb-4 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
        <div>
          <h1 className="text-xl sm:text-[28px] font-bold tracking-tight text-slate-800">
            {project.customer}
          </h1>
        </div>
        <MonthPicker
          month={month}
          year={year}
          onChange={(nextMonth, nextYear) => {
            setMonth(nextMonth);
            setYear(nextYear);
          }}
        />
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:gap-4 xl:grid-cols-3">
        <DashboardCard title="ĐIỆN NĂNG TIÊU THỤ" className="xl:col-span-2">
          <div className="mb-3 flex flex-wrap gap-x-4 sm:gap-x-6 gap-y-1 text-xs sm:text-sm">
            <p>
              Lớn nhất:{" "}
              <span className="font-semibold text-emerald-700">{formatKwh(energyMax)} kWh</span>
            </p>
            <p>
              Nhỏ nhất:{" "}
              <span className="font-semibold text-emerald-600">{formatKwh(energyMin)} kWh</span>
            </p>
            <p>
              Tổng tiêu thụ:{" "}
              <span className="font-semibold text-slate-800">{formatKwh(consumptionTotal)} kWh</span>
            </p>
          </div>
          <EnergyChart data={chartSeries} />
          <p className="mt-2 text-center text-[11.5px] sm:text-[12px] text-slate-500">
            {energyCaption}
            {energyMom ? (
              <span className={`ml-1 ${energyMom.delta <= 0 ? "text-emerald-600" : "text-amber-600"}`}>
                {energyMom.delta <= 0 ? "↓" : "↑"}
              </span>
            ) : null}
          </p>
        </DashboardCard>

        <DashboardCard title="PHÁT THẢI CO2">
          <DonutChart
            color="#1e6b45"
            value={formatAppNumber(co2, { minDecimals: 2, maxDecimals: 4 })}
            unit="tấn CO2 tđ"
            progress={co2 > 0 ? 0.82 : 0}
            caption={co2Caption}
          />
        </DashboardCard>
      </div>

      <div className="mt-3.5 sm:mt-4 grid grid-cols-1 gap-3.5 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardCard title="CHI PHÍ">
          <DonutChart
            color="#1e5f8a"
            value={formatAppNumber(monthCostThousands, {
              maxDecimals: monthCostThousands > 0 && monthCostThousands < 10 ? 2 : 0,
            })}
            unit="nghìn VNĐ"
            progress={monthCost > 0 ? 0.82 : 0}
            caption={`Tổng tháng ${pad2(month)}/${year}: ${formatVnd(monthCost)} VNĐ`}
          />
        </DashboardCard>

        <DashboardCard title="TRẠNG THÁI THIẾT BỊ">
          <DeviceStatusChart items={deviceStatus} />
        </DashboardCard>

        <DashboardCard title="NHẬT KÝ CẢNH BÁO" className="sm:col-span-2">
          <AlertLogTable rows={alerts} />
        </DashboardCard>
      </div>
    </div>
  );
}

function MonthPicker({
  month,
  year,
  onChange,
}: {
  month: number;
  year: number;
  onChange: (month: number, year: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const label = `Tháng ${String(month).padStart(2, "0")}/${year}`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:bg-slate-50"
      >
        <CalendarIcon className="h-4 w-4 text-slate-400" />
        {label}
        <span className="text-[10px] text-slate-400">▾</span>
      </button>

      {open ? (
        <div className="absolute top-11 right-0 z-20 w-[220px] rounded-md border border-slate-200 bg-white p-3 shadow-md">
          <div className="mb-2 flex items-center gap-2">
            <CustomSelect
              value={year}
              onChange={(e) => onChange(month, Number(e.target.value))}
              className="h-9 flex-1 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus:border-emerald-500"
              aria-label="Năm"
            >
              {YEAR_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </CustomSelect>
          </div>
          <ul role="listbox" aria-label="Chọn tháng" className="grid grid-cols-3 gap-1.5">
            {MONTH_OPTIONS.map((value) => {
              const active = value === month;
              return (
                <li key={value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(value, year);
                      setOpen(false);
                    }}
                    className={`h-9 w-full rounded-md text-[12px] font-medium transition-colors ${
                      active
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {String(value).padStart(2, "0")}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DashboardCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-3.5 sm:p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${className}`}
    >
      <div className="mb-2 flex items-start justify-between">
        <h2 className="text-[12px] font-semibold tracking-[0.08em] text-slate-400">
          {title}
        </h2>
        <button
          type="button"
          className="text-slate-300 hover:text-slate-500"
          aria-label="Phóng to"
        >
          <ExpandIcon className="h-4 w-4" />
        </button>
      </div>
      {children}
    </section>
  );
}

function LatestReading({ sample }: { sample: ProjectGatewaySample }) {
  const items: Array<[string, string]> = [];
  const add = (label: string, value: number | undefined, unit: string, digits: number) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    items.push([label, `${formatReading(value, digits)} ${unit}`]);
  };
  add("Ua", sample.values.Van, "V", 1);
  add("Ub", sample.values.Vbn, "V", 1);
  add("Uc", sample.values.Vcn, "V", 1);
  add("F", sample.values.F, "Hz", 2);
  add("E", typeof sample.values.EPaed === "number" ? registerToKwh(sample.values.EPaed) : undefined, "kWh", 3);
  if (!items.length) return null;
  return (
    <p className="mb-3 text-xs text-slate-500">
      {items.map(([label, text]) => `${label} ${text}`).join(" · ")}
      {" · "}
      Cập nhật {formatStoredVietnam(sample.at) ?? sample.at}
    </p>
  );
}

function EnergyChart({ data }: { data: { day: string; kwh: number; hasSample?: boolean }[] }) {
  if (!data.length) {
    return (
      <div className="flex h-[220px] sm:h-[250px] items-center justify-center text-sm text-slate-400">
        Chưa có dữ liệu
      </div>
    );
  }
  const max = Math.max(...data.map((item) => item.kwh), 0.001);

  return (
    <div className="flex h-[220px] sm:h-[250px] w-full min-w-0 items-end gap-[2px] pb-1">
      {data.map((item, idx) => {
        const heightPct = item.kwh > 0 ? Math.max((item.kwh / max) * 100, 4) : 0;
        const showMobileLabel = idx % 2 === 0 || idx === data.length - 1;
        return (
          <div key={item.day} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex h-[185px] sm:h-[210px] w-full items-end justify-center">
              {heightPct > 0 ? (
                <div
                  className="w-[5px] sm:w-[7px] rounded-t-sm bg-emerald-600 transition-all hover:bg-emerald-500"
                  style={{ height: `${heightPct}%` }}
                  title={`Ngày ${item.day}: ${formatKwh(item.kwh)} kWh`}
                />
              ) : (
                <div
                  className={`h-[2px] w-[5px] sm:w-[7px] rounded-sm ${item.hasSample ? "bg-emerald-300" : "bg-slate-200"}`}
                  title={
                    item.hasSample
                      ? `Ngày ${item.day}: có bản tin, sản lượng 0 kWh`
                      : `Ngày ${item.day}: không có bản tin`
                  }
                />
              )}
            </div>
            <span
              className={`mt-1 text-[9px] leading-none text-slate-400 ${
                showMobileLabel ? "" : "invisible sm:visible"
              }`}
            >
              {item.day}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DeviceStatusChart({
  items,
}: {
  items: { label: string; value: number; color: string }[];
}) {
  const maxValue = Math.max(...items.map((item) => item.value), 0);
  const yMax = Math.max(4, Math.ceil(maxValue / 4) * 4 || 4);
  const ticks = [yMax, Math.round((yMax * 2) / 3), Math.round(yMax / 3), 0];
  const total = items.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="flex h-[250px] sm:h-[280px] w-full min-w-0 flex-col gap-2 pt-2">
      <p className="text-[12px] text-slate-500">Tổng thiết bị dự án: {total}</p>
      <div className="flex min-h-0 min-w-0 flex-1 gap-2">
        <div className="flex h-[185px] sm:h-[210px] shrink-0 flex-col justify-between py-0.5 text-[11px] text-slate-400">
          {ticks.map((tick) => (
            <span key={tick} className="leading-none">
              {tick}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-x-0 top-0 h-[185px] sm:h-[210px]">
            {ticks.map((tick, i) => (
              <div
                key={`${tick}-${i}`}
                className="absolute inset-x-0 border-t border-slate-100"
                style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}
              />
            ))}
          </div>
          <div className="relative flex h-[185px] sm:h-[210px] items-end justify-around px-1 sm:px-4">
            {items.map((item) => (
              <div key={item.label} className="flex h-full w-[30%] flex-col items-center justify-end">
                <span className="mb-1 text-sm font-semibold text-slate-700">{item.value}</span>
                <div
                  className="w-full max-w-[36px] sm:max-w-[42px] rounded-t-md"
                  style={{
                    height: `${item.value > 0 ? Math.max((item.value / yMax) * 100, 6) : 0}%`,
                    backgroundColor: item.color,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-around px-1 sm:px-4">
            {items.map((item) => (
              <p
                key={item.label}
                className="w-[32%] text-center text-[10px] font-medium tracking-tight sm:tracking-wide text-slate-500"
              >
                {item.label}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DonutChart({
  color,
  value,
  unit,
  progress = 0.82,
  caption,
}: {
  color: string;
  value: string;
  unit: string;
  progress?: number;
  caption: React.ReactNode;
}) {
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * Math.max(0, Math.min(1, progress));

  return (
    <div className="flex flex-col items-center pt-1">
      <div className="relative h-[168px] w-[168px] sm:h-[210px] sm:w-[210px]">
        <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
          <circle
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke="#edf0f3"
            strokeWidth="22"
          />
          <circle
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="22"
            strokeDasharray={`${filled} ${circumference}`}
            strokeLinecap="butt"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <p className="text-[22px] sm:text-[26px] font-bold leading-none text-slate-800">{value}</p>
          <p className="mt-1.5 text-xs text-slate-400">{unit}</p>
        </div>
      </div>
      <p className="mt-1 text-center text-[12px] text-slate-400">{caption}</p>
    </div>
  );
}

function AlertLogTable({ rows: sourceRows }: { rows: DashboardAlert[] }) {
  const [time, setTime] = useState("");
  const [point, setPoint] = useState("all");
  const [param, setParam] = useState("");
  const [value, setValue] = useState("");

  const rows = sourceRows.filter((row) => {
    const matchTime = !time || row.time.includes(time);
    const matchPoint = point === "all" || row.point === point;
    const matchParam =
      !param || row.param.toLowerCase().includes(param.toLowerCase());
    const matchValue = !value || row.value.includes(value);
    return matchTime && matchPoint && matchParam && matchValue;
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <thead>
          <tr className="text-[12px] font-medium text-slate-500">
            <th className="pb-2 font-medium">
              Thời gian <span className="text-slate-300">↕</span>
            </th>
            <th className="pb-2 font-medium">
              Điểm đo <span className="text-slate-300">↕</span>
            </th>
            <th className="pb-2 font-medium">
              Thông số <span className="text-slate-300">↕</span>
            </th>
            <th className="pb-2 font-medium">
              Giá trị <span className="text-slate-300">↕</span>
            </th>
          </tr>
          <tr className="text-slate-400">
            <th className="pb-2 pr-2 font-normal">
              <span className="relative block">
                <input
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="h-8 w-full rounded border border-slate-200 pr-7 pl-2 text-xs outline-none focus:border-emerald-500"
                />
                <FilterMark />
              </span>
            </th>
            <th className="pb-2 pr-2 font-normal">
              <span className="relative block">
                <CustomSelect
                  value={point}
                  onChange={(e) => setPoint(e.target.value)}
                  className="h-8 w-full appearance-none rounded border border-slate-200 pr-7 pl-2 text-xs outline-none focus:border-emerald-500"
                >
                  <option value="all" />
                  {Array.from(new Set(sourceRows.map((row) => row.point))).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </CustomSelect>
                <FilterMark />
              </span>
            </th>
            <th className="pb-2 pr-2 font-normal">
              <span className="relative block">
                <input
                  value={param}
                  onChange={(e) => setParam(e.target.value)}
                  className="h-8 w-full rounded border border-slate-200 pr-7 pl-2 text-xs outline-none focus:border-emerald-500"
                />
                <FilterMark />
              </span>
            </th>
            <th className="pb-2 font-normal">
              <span className="relative block">
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="h-8 w-full rounded border border-slate-200 pr-7 pl-2 text-xs outline-none focus:border-emerald-500"
                />
                <FilterMark />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-8 text-center text-sm text-slate-400">
                {sourceRows.length === 0 ? "Chưa có nhật ký cảnh báo trong dự án" : "Không khớp bộ lọc"}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 text-slate-600">
                <td className="py-2.5 whitespace-nowrap">{row.time}</td>
                <td className="py-2.5">{row.point}</td>
                <td className="py-2.5">
                  <button type="button" className="text-emerald-600 hover:underline">
                    {row.param}
                  </button>
                </td>
                <td className="py-2.5">{row.value}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function FilterMark() {
  return (
    <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-slate-300">
      ▾
    </span>
  );
}

function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M20 15v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 3.5V7M16 3.5V7M4 10h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
