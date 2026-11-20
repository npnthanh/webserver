"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChartTimeline } from "@/components/client/ChartTimeline";
import { ChartDataTable } from "@/components/client/ChartViewToolbar";
import { useChartSize } from "@/components/client/useChartSize";
import {
  DEFAULT_TIME_FILTER,
  TimeFilterBar,
  getTimeFilterLabel,
  getTimeFilterPeriods,
  periodIndexForInstant,
  timeFilterSpan,
  type TimeFilterValue,
} from "@/components/client/TimeFilterBar";
import { FrequencyChart } from "@/components/client/FrequencyChart";
import { HarmonicsChart } from "@/components/client/HarmonicsChart";
import { PowerChart, PowerFactorChart } from "@/components/client/PowerChart";
import { SampleTrendChart, type TrendSeriesConfig } from "@/components/client/SampleTrendChart";
import { UiWaveform } from "@/components/client/UiWaveform";
import { UnbalanceChart } from "@/components/client/UnbalanceChart";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { hydrateClientMeters, loadClientMeters, orderMetersByTree } from "@/lib/client-meters";
import { formatAppNumber } from "@/lib/number-format";
import { hydrateProjects, loadProjects, resolveMeterTypes } from "@/lib/projects";
import {
  loadProjectGatewayDailyRange,
  loadProjectGatewayEnergySlots,
  loadProjectGatewaySamples,
  type GatewayDailyPoint,
  type GatewayEnergySlot,
  type ProjectGatewaySample,
} from "@/lib/gateway-series";
import { formatStoredVietnam, vietnamFromStored } from "@/lib/vietnam-time";
import { hydrateMeterReadings, type MeterReading } from "@/lib/meter-readings";
import {
  bandForGap,
  civilWeekday,
  industrialBand,
  industrialBandAt,
  inferSlotMs,
} from "@/lib/industrial-electricity";
import { METER_PARAMETERS, registerToKwh } from "@/lib/meter-parameters";
import { readChartParameterConfig, type ChartParameterConfig } from "@/lib/chart-parameters";
import { readChartShowMarkers, setChartDisplay } from "@/lib/chart-display";
import { hydrateProjectSettings } from "@/lib/project-settings";

type EnergyKind = string;
type MetricId = "energy" | "ui" | "freq" | "power" | "pf" | "harm" | "unbalance" | "pst";
type ViewMode = "chart" | "table";

type MeterPoint = {
  id: string;
  code: string;
  name: string;
  energy: EnergyKind;
  color: string;
};

const POINT_COLORS = ["#059669", "#22c55e", "#a16207", "#ef4444", "#8b5cf6", "#06b6d4", "#f59e0b"];

const ENERGY_KIND_META: Record<string, "bolt" | "heat" | "air" | "water" | "steam"> = {
  Điện: "bolt",
  Nhiệt: "heat",
  "Khí nén": "air",
  Nước: "water",
  Hơi: "steam",
};

const METRICS: { id: MetricId; label: string }[] = [
  { id: "energy", label: "Điện năng" },
  { id: "ui", label: "U / I" },
  { id: "freq", label: "Tần số" },
  { id: "power", label: "Công suất" },
  { id: "pf", label: "Hệ số công suất" },
  { id: "harm", label: "Sóng hài" },
  { id: "unbalance", label: "Mất cân bằng pha" },
  { id: "pst", label: "Pst/Plt" },
];

type BarPoint = { minute: number; label: string; kwh: number };

function emptyEnergyBars(filter: TimeFilterValue): BarPoint[] {
  return getTimeFilterPeriods(filter).map((period, index) => ({
    minute: index,
    label: period.label,
    kwh: 0,
  }));
}

function energyBarsFromReadings(
  filter: TimeFilterValue,
  pointId: string | undefined,
  readings: MeterReading[],
) {
  const rows = readings.filter((row) => row.meterPointId === pointId && row.metric === "energy");
  if (!rows.length) return emptyEnergyBars(filter);
  const periods = getTimeFilterPeriods(filter);
  const values = new Map<number, number>();
  for (const row of rows) {
    const date = row.recordedAt.slice(0, 10);
    let index = -1;
    if (filter.mode === "month") {
      if (date.slice(0, 7) === filter.month) index = Number(date.slice(8, 10)) - 1;
    } else if (filter.mode === "year") {
      if (Number(date.slice(0, 4)) === filter.year) index = Number(date.slice(5, 7)) - 1;
    } else if (filter.mode === "day" && date === filter.date) {
      const hour = Number(row.recordedAt.slice(11, 13));
      const min = Number(row.recordedAt.slice(14, 16) || "0");
      index = periods.length === 48 ? hour * 2 + (min >= 30 ? 1 : 0) : hour;
    } else if (
      filter.mode === "custom_date" &&
      filter.customDateMode !== "range" &&
      date === filter.customDate.slice(0, 10)
    ) {
      const hour = Number(row.recordedAt.slice(11, 13));
      const min = Number(row.recordedAt.slice(14, 16) || "0");
      index = periods.length === 48 ? hour * 2 + (min >= 30 ? 1 : 0) : hour;
    } else if (filter.mode === "custom_date" && filter.customDateMode === "range") {
      index = periodIndexForInstant(filter, row.recordedAt, periods.length);
    }
    if (index >= 0 && index < periods.length) values.set(index, (values.get(index) ?? 0) + row.value);
  }
  if (!values.size) return emptyEnergyBars(filter);
  return periods.map((period, index) => ({
    minute: index,
    label: period.label,
    kwh: Number((values.get(index) ?? 0).toFixed(1)),
  }));
}

function periodIndex(filter: TimeFilterValue, at: string, length: number) {
  const normalized = at.includes("T") ? at : at.replace(" ", "T");
  const date = normalized.slice(0, 10);
  let index = -1;
  if (filter.mode === "month") {
    if (date.slice(0, 7) === filter.month) index = Number(date.slice(8, 10)) - 1;
  } else if (filter.mode === "year") {
    if (Number(date.slice(0, 4)) === filter.year) index = Number(date.slice(5, 7)) - 1;
  } else if (filter.mode === "day" && date === filter.date) {
    const hour = Number(normalized.slice(11, 13));
    const min = Number(normalized.slice(14, 16) || "0");
    index = length === 48 ? hour * 2 + (min >= 30 ? 1 : 0) : hour;
  } else if (
    filter.mode === "custom_date" &&
    filter.customDateMode !== "range" &&
    date === filter.customDate.slice(0, 10)
  ) {
    const hour = Number(normalized.slice(11, 13));
    const min = Number(normalized.slice(14, 16) || "0");
    index = length === 48 ? hour * 2 + (min >= 30 ? 1 : 0) : hour;
  } else if (filter.mode === "custom_date" && filter.customDateMode === "range") {
    index = periodIndexForInstant(filter, normalized, length);
  }
  return index >= 0 && index < length ? index : -1;
}

function filterValidOrderedEpaedKwh(rawList: number[]): number[] {
  if (rawList.length === 0) return [];
  const out: number[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const val = rawList[i];
    if (!Number.isFinite(val) || val < 0) continue;
    if (out.length > 0) {
      const prev = out[out.length - 1];
      // Nếu chỉ số giảm đột ngột (ví dụ gói test = 0 hoặc nhỏ hơn hẳn) nhưng các mẫu sau lại quay về vùng cũ (~prev), bỏ qua mẫu nhiễu này
      if (val < prev - 1) {
        const nextValid = rawList.slice(i + 1, i + 8).some((n) => Number.isFinite(n) && n >= prev - 1);
        if (nextValid) continue;
      }
    }
    out.push(val);
  }
  return out;
}

function slotStoredAt(day: string, hour: number, minute: number) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour, minute) - 7 * 60 * 60 * 1000).toISOString().slice(0, 19);
}

/** Mốc "mới nhất" nhỏ nhất giữa các điểm đo: xin mẫu mới hơn mốc này để không sót điểm đo gửi chậm. */
function oldestLatestSampleAt(samples: ProjectGatewaySample[]) {
  const latestByPoint = new Map<string, string>();
  for (const sample of samples) {
    const current = latestByPoint.get(sample.meterPointId);
    if (!current || sample.at > current) latestByPoint.set(sample.meterPointId, sample.at);
  }
  let oldest: string | undefined;
  for (const at of latestByPoint.values()) {
    if (!oldest || at < oldest) oldest = at;
  }
  return oldest;
}

/** Ghép mẫu mới vào danh sách hiện có (bỏ trùng theo điểm đo + thời điểm), giữ thứ tự thời gian. */
function mergeNewSamples(prev: ProjectGatewaySample[], incoming: ProjectGatewaySample[]) {
  if (!incoming.length) return prev;
  const seen = new Set(prev.map((sample) => `${sample.meterPointId}|${sample.at}`));
  const fresh = incoming.filter((sample) => !seen.has(`${sample.meterPointId}|${sample.at}`));
  if (!fresh.length) return prev;
  return [...prev, ...fresh].sort((a, b) => a.at.localeCompare(b.at));
}

type SlotInterval = 15 | 30 | 60;
const SLOT_INTERVALS: SlotInterval[] = [15, 30, 60];
const SLOT_INTERVAL_STORAGE_KEY = "ems:energy-day-interval";

type BucketLayout = {
  periods: { key: string | number; label: string }[];
  indexOf: (storedAt: string) => number;
};

/** Chia một ngày (giờ Việt Nam) thành các cột theo khoảng thời gian người dùng chọn. */
function dayBucketLayout(date: string, interval: SlotInterval): BucketLayout {
  const count = Math.round((24 * 60) / interval);
  return {
    periods: Array.from({ length: count }, (_, i) => {
      const minutes = i * interval;
      return {
        key: i,
        label: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
      };
    }),
    indexOf: (storedAt) => {
      const parts = vietnamFromStored(storedAt);
      if (!parts || parts.date !== date) return -1;
      const index = Math.floor((parts.hour * 60 + parts.minute) / interval);
      return index >= 0 && index < count ? index : -1;
    },
  };
}

/** Gộp cột 30 phút (dữ liệu dự phòng không có slot) thành cột 1 giờ. */
function mergeHalfHourBars(bars: { minute: number; label: string; kwh: number }[]) {
  const merged: { minute: number; label: string; kwh: number }[] = [];
  for (let i = 0; i < bars.length; i += 2) {
    const kwh = bars[i].kwh + (bars[i + 1]?.kwh ?? 0);
    merged.push({ minute: merged.length, label: bars[i].label, kwh: Number(kwh.toFixed(4)) });
  }
  return merged;
}

function energyAndTouFromSlots(filter: TimeFilterValue, slots: GatewayEnergySlot[], layout?: BucketLayout) {
  const periods = layout?.periods ?? getTimeFilterPeriods(filter);
  const bucketOf = (at: string) =>
    layout ? layout.indexOf(at) : periodIndexForInstant(filter, at, periods.length);
  const buckets = periods.map(() => 0);
  const tou = { peak: 0, normal: 0, off: 0, none: 0 };
  const ordered = [...slots].sort(
    (a, b) => a.day.localeCompare(b.day) || a.hour - b.hour || a.minute - b.minute,
  );
  let previous: number | null = null;
  let lastMeterId: string | undefined;
  // Khung dữ liệu trước (để biết phần điện năng tích lại có vắt qua khoảng mất dữ liệu nhiều khung giờ không).
  let prevAt: string | null = null;
  const slotMs = inferSlotMs(ordered.map((slot) => slotStoredAt(slot.day, slot.hour, slot.minute)));
  for (let i = 0; i < ordered.length; i++) {
    const slot = ordered[i];
    const startKwh = registerToKwh(slot.firstWh);
    const rawEndKwh = registerToKwh(slot.lastWh);
    const nextSlot = ordered[i + 1];
    const nextStartKwh = nextSlot ? registerToKwh(nextSlot.firstWh) : NaN;
    const endKwh =
      rawEndKwh < startKwh - 1 &&
      ordered
        .slice(i + 1, i + 4)
        .some((s) => registerToKwh(s.firstWh) >= startKwh - 1 || registerToKwh(s.lastWh) >= startKwh - 1)
        ? Number.isFinite(nextStartKwh) && nextStartKwh >= startKwh && nextStartKwh - startKwh < 100
          ? nextStartKwh
          : startKwh
        : rawEndKwh;
    if (!Number.isFinite(startKwh) || !Number.isFinite(endKwh) || endKwh < 0) continue;
    // Bỏ qua slot bị nhiễu do bản tin test xen vào làm firstWh tụt xuống thấp rồi nhảy vọt lại về mức cũ
    if (previous != null && startKwh < previous - 1) {
      const prevVal = previous;
      const returnsToPrev =
        endKwh >= prevVal - 1 ||
        ordered.slice(i + 1, i + 4).some((s) => registerToKwh(s.lastWh) >= prevVal - 1);
      if (returnsToPrev) {
        const clampedStart = Math.max(prevVal, startKwh);
        const clampedEnd = Math.max(clampedStart, endKwh);
        const delta = Math.max(0, clampedEnd - prevVal);
        if (delta > 0 && delta < 500) {
          const at = slotStoredAt(slot.day, slot.hour, slot.minute);
          const bucket = bucketOf(at);
          if (bucket >= 0) buckets[bucket] += delta;
          const parts = vietnamFromStored(at);
          if (parts) {
            const band = industrialBand(civilWeekday(parts.year, parts.month, parts.day), parts.hour, parts.minute);
            tou[band] += delta;
          } else {
            tou.none += delta;
          }
        }
        previous = Math.max(prevVal, endKwh);
        prevAt = slotStoredAt(slot.day, slot.hour, slot.minute);
        continue;
      }
    }
    if (
      previous != null &&
      ((slot.meterId && lastMeterId && slot.meterId !== lastMeterId) || startKwh < previous)
    ) {
      previous = startKwh;
    }
    const within = Math.max(0, endKwh - startKwh);
    const gap = previous == null ? 0 : Math.max(0, startKwh - previous);
    const delta = within + gap;
    const at = slotStoredAt(slot.day, slot.hour, slot.minute);
    const bucket = bucketOf(at);
    if (bucket >= 0 && delta > 0) {
      buckets[bucket] += delta;
      const parts = vietnamFromStored(at);
      if (parts) {
        const band = industrialBand(civilWeekday(parts.year, parts.month, parts.day), parts.hour, parts.minute);
        tou[band] += within;
        // Phần tích lại sau khoảng mất dữ liệu vắt qua nhiều khung giờ → Không xác định.
        if (gap > 0) tou[bandForGap(prevAt, at, slotMs, industrialBandAt)] += gap;
      } else {
        tou.none += delta;
      }
    }
    previous = endKwh;
    prevAt = at;
    if (slot.meterId) lastMeterId = slot.meterId;
  }
  return {
    bars: periods.map((period, index) => ({
      minute: index,
      label: period.label,
      kwh: Number(buckets[index].toFixed(4)),
    })),
    tou,
  };
}

function energyBarsFromGateway(filter: TimeFilterValue, samples: ProjectGatewaySample[]) {
  const periods = getTimeFilterPeriods(filter);
  const buckets = periods.map(() => 0);
  const ordered = [...samples].sort((a, b) => a.at.localeCompare(b.at));
  const validSamples: Array<{ at: string; kwh: number }> = [];
  const rawKwhs = ordered.map((s) => (typeof s.values.EPaed === "number" ? registerToKwh(s.values.EPaed) : NaN));
  for (let i = 0; i < ordered.length; i++) {
    const val = rawKwhs[i];
    if (!Number.isFinite(val) || val < 0) continue;
    if (validSamples.length > 0) {
      const prev = validSamples[validSamples.length - 1].kwh;
      if (val < prev - 1) {
        const nextValid = rawKwhs.slice(i + 1, i + 8).some((n) => Number.isFinite(n) && n >= prev - 1);
        if (nextValid) continue;
      }
    }
    validSamples.push({ at: ordered[i].at, kwh: val });
  }
  for (let i = 1; i < validSamples.length; i++) {
    const delta = validSamples[i].kwh - validSamples[i - 1].kwh;
    if (delta > 0 && delta < 500) {
      const index = periodIndexForInstant(filter, validSamples[i].at, periods.length);
      if (index >= 0) buckets[index] += delta;
    }
  }
  return periods.map((period, index) => ({
    minute: index,
    label: period.label,
    kwh: Number(buckets[index].toFixed(4)),
  }));
}

function energyBarsFromDaily(filter: TimeFilterValue, rows: GatewayDailyPoint[]) {
  const periods = getTimeFilterPeriods(filter);
  const buckets = periods.map(() => 0);
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  for (const row of sorted) {
    const index = periodIndexForInstant(filter, `${row.day}T00:00:00`, periods.length);
    if (index < 0) continue;
    const delta = Math.max(0, registerToKwh(row.lastWh) - registerToKwh(row.firstWh));
    buckets[index] += delta;
  }
  return periods.map((period, index) => ({
    minute: index,
    label: period.label,
    kwh: Number(buckets[index].toFixed(4)),
  }));
}

function formatNum(n: number) {
  return formatAppNumber(n, { maxDecimals: 1 });
}

function formatKwh(n: number) {
  if (!Number.isFinite(n)) return "0";
  const digits = Math.abs(n) > 0 && Math.abs(n) < 10 ? 3 : 1;
  return formatAppNumber(n, { maxDecimals: digits, minDecimals: 0 });
}

function seriesFor(count: number): number[][] {
  return Array.from({ length: Math.max(count, 0) }, () => Array.from({ length: 25 }, () => 0));
}

function metricMeta(energy: EnergyKind, metric: MetricId) {
  if (energy !== "Điện") {
    return {
      title: `Chi tiết tiêu thụ ${energy.toLowerCase()}`,
      unit: energy === "Nước" ? "M³" : energy === "Nhiệt" ? "KWH NHIỆT" : "M³ KHÍ NÉN",
    };
  }
  const map: Record<MetricId, { title: string; unit: string }> = {
    energy: { title: "Chi tiết tiêu thụ điện năng", unit: "KILOWATT-GIỜ (KWH)" },
    ui: { title: "Điện áp / Dòng điện", unit: "VOLT (V)" },
    freq: { title: "Tần số lưới điện", unit: "HERTZ (HZ)" },
    power: { title: "Công suất tức thời", unit: "KILOWATT (KW)" },
    pf: { title: "Hệ số công suất (PF / DPF)", unit: "COSΦ" },
    harm: { title: "Sóng hài (THD)", unit: "PHẦN TRĂM (%)" },
    unbalance: { title: "Mất cân bằng pha", unit: "PHẦN TRĂM (%)" },
    pst: { title: "Nháy sáng Pst/Plt", unit: "CHỈ SỐ PST" },
  };
  return map[metric];
}

export function EnergyCharts() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id ?? "default";
  // Tham số vẽ trên từng biểu đồ (Cấu hình → Tham số biểu đồ).
  const [chartParams, setChartParams] = useState<ChartParameterConfig>({});
  useEffect(() => {
    let active = true;
    void hydrateProjectSettings(projectId, { force: true })
      .then((settings) => {
        if (!active) return;
        setChartParams(readChartParameterConfig(settings));
        setChartDisplay({ showMarkers: readChartShowMarkers(settings) });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [projectId]);
  const [energyKinds, setEnergyKinds] = useState<EnergyKind[]>(["Điện", "Nước", "Nhiệt", "Hơi"]);
  const [energy, setEnergy] = useState<EnergyKind>("Điện");
  const [metricChoice, setMetric] = useState<MetricId>("energy");
  const [view, setView] = useState<ViewMode>("chart");
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<number | null>(null);
  const [showSum, setShowSum] = useState(false);
  const [range, setRange] = useState({ start: 0, end: 30 });
  const [slotInterval, setSlotIntervalState] = useState<SlotInterval>(30);
  const [allPoints, setAllPoints] = useState<MeterPoint[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pointQuery, setPointQuery] = useState("");
  const [timeFilter, setTimeFilter] = useState<TimeFilterValue>(() => ({
    ...DEFAULT_TIME_FILTER,
    mode: "day",
  }));
  const [pointsOpen, setPointsOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(SLOT_INTERVAL_STORAGE_KEY));
      // Đọc sau khi mount (không dùng lazy init) để HTML render phía server khớp lần hydrate đầu.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (SLOT_INTERVALS.includes(saved as SlotInterval)) setSlotIntervalState(saved as SlotInterval);
    } catch {
      // localStorage có thể bị chặn (chế độ riêng tư): dùng mặc định 30 phút.
    }
  }, []);

  const setSlotInterval = (next: SlotInterval) => {
    setSlotIntervalState(next);
    try {
      window.localStorage.setItem(SLOT_INTERVAL_STORAGE_KEY, String(next));
    } catch {
      // bỏ qua
    }
  };
  const [readings, setReadings] = useState<MeterReading[]>([]);
  const [gatewaySamples, setGatewaySamples] = useState<ProjectGatewaySample[]>([]);
  const [dailyRows, setDailyRows] = useState<GatewayDailyPoint[]>([]);
  const [energySlots, setEnergySlots] = useState<GatewayEnergySlot[]>([]);
  const [reloadTick, setReloadTick] = useState(0);
  const [livePollTick, setLivePollTick] = useState(0);
  const gatewayMonthAligned = useRef(false);
  const filterTouched = useRef(false);
  const selectionTouched = useRef(false);
  const lastFilterKeyRef = useRef<string>("");
  // Tự làm mới nhẹ: lần tải đầy đủ gần nhất + mẫu đang hiển thị (để chỉ xin phần mẫu mới).
  const lastFullLoadRef = useRef<{ key: string; at: number; reloadTick: number }>({ key: "", at: 0, reloadTick: -1 });
  const samplesRef = useRef<ProjectGatewaySample[]>([]);
  const handleRefresh = () => {
    setReloadTick((value) => value + 1);
    setLivePollTick((value) => value + 1);
  };

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") {
        setLivePollTick((value) => value + 1);
      }
    };
    const timer = window.setInterval(tick, 10_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  useEffect(() => {
    gatewayMonthAligned.current = false;
    filterTouched.current = false;
    selectionTouched.current = false;
  }, [projectId]);

  useEffect(() => {
    let active = true;
    const reload = () => {
      void Promise.all([
        hydrateProjects(),
        hydrateClientMeters(projectId),
        hydrateMeterReadings(projectId),
      ]).then(([projects, meterRows, readingRows]) => {
        if (!active) return;
        setReadings(readingRows);
        const project = projects.find((item) => item.id === projectId);
        const types = resolveMeterTypes(project);
        setEnergyKinds(types);
        setEnergy((current) => (types.includes(current) ? current : types[0] ?? "Điện"));
        const meters = orderMetersByTree(meterRows.length ? meterRows : loadClientMeters(projectId));
        if (!meters.length) {
          setAllPoints([]);
          return;
        }
        setAllPoints(
          meters.map((meter, index) => ({
            id: meter.id,
            code: meter.code,
            name: meter.name,
            energy: meter.utility,
            color: POINT_COLORS[index % POINT_COLORS.length],
          })),
        );
      });
    };
    reload();
    window.addEventListener("ems-client-meters-changed", reload);
    return () => {
      active = false;
      window.removeEventListener("ems-client-meters-changed", reload);
    };
  }, [projectId, reloadTick]);

  useEffect(() => {
    const span = timeFilterSpan(timeFilter);
    const filterKey = `${projectId}:${timeFilter.mode}:${span.from}:${span.to}`;
    const isSameFilter = lastFilterKeyRef.current === filterKey;
    lastFilterKeyRef.current = filterKey;
    let active = true;
    const fullKey = `${filterKey}:${slotInterval}`;
    const now = Date.now();
    const sinceFull = now - lastFullLoadRef.current.at;
    const manualReload = lastFullLoadRef.current.reloadTick !== reloadTick;
    const autoRefresh = isSameFilter && lastFullLoadRef.current.key === fullKey && !manualReload;
    // Chế độ Tháng/Năm: số liệu ít đổi, làm mới tối đa mỗi 60 giây thay vì mỗi 10 giây.
    if (!span.hourly && autoRefresh && sinceFull < 60_000) return;
    // Chế độ Ngày: tự làm mới chỉ tải phần mẫu mới; cứ 5 phút tải lại toàn bộ để nhận dữ liệu gửi bù / đồng bộ muộn.
    const tailOnly = span.hourly && autoRefresh && sinceFull < 5 * 60_000 && samplesRef.current.length > 0;
    const tailAfter = tailOnly ? oldestLatestSampleAt(samplesRef.current) : undefined;
    if (!tailOnly) lastFullLoadRef.current = { key: fullKey, at: now, reloadTick };
    if (span.hourly) {
      void Promise.all([
        loadProjectGatewaySamples(projectId, { from: span.from, to: span.to, limit: 18000, after: tailAfter }),
        loadProjectGatewayEnergySlots(
          projectId,
          span.from,
          span.to,
          timeFilter.mode === "day" && slotInterval === 15 ? 15 : 30,
        ),
      ]).then(
        async ([rows, slotSummary]) => {
          if (!active) return;
          if (rows.length === 0 && !filterTouched.current && !gatewayMonthAligned.current) {
            gatewayMonthAligned.current = true;
            const summary = await loadProjectGatewayDailyRange(projectId, "2026-01-01", span.to);
            if (!active) return;
            if (summary.latest) {
              const parts = vietnamFromStored(summary.latest.at);
              if (parts && parts.date !== timeFilter.date) {
                setTimeFilter((current) => ({
                  ...current,
                  mode: "day",
                  date: parts.date,
                  month: parts.monthKey,
                  year: parts.year,
                }));
                return;
              }
            }
          }
          setGatewaySamples((prev) => {
            const next = tailOnly
              ? mergeNewSamples(prev, rows)
              : isSameFilter && rows.length === 0 && prev.length > 0
                ? prev
                : rows;
            samplesRef.current = next;
            return next;
          });
          setEnergySlots((prev) =>
            isSameFilter && slotSummary.slots.length === 0 && prev.length > 0 ? prev : slotSummary.slots,
          );
          if (!isSameFilter) setDailyRows([]);
        },
      );
    } else {
      void Promise.all([
        loadProjectGatewayDailyRange(projectId, span.from, span.to),
        loadProjectGatewaySamples(projectId, { from: span.from, to: span.to, limit: 3000 }),
        loadProjectGatewayEnergySlots(projectId, span.from, span.to),
      ]).then(([summary, rows, slotSummary]) => {
        if (!active) return;
        setDailyRows((prev) =>
          isSameFilter && summary.days.length === 0 && prev.length > 0 ? prev : summary.days,
        );
        setGatewaySamples((prev) => {
          const next = isSameFilter && rows.length === 0 && prev.length > 0 ? prev : rows;
          samplesRef.current = next;
          return next;
        });
        setEnergySlots((prev) =>
          isSameFilter && slotSummary.slots.length === 0 && prev.length > 0 ? prev : slotSummary.slots,
        );
        if (filterTouched.current || gatewayMonthAligned.current || !summary.latest) return;
        const parts = vietnamFromStored(summary.latest.at);
        gatewayMonthAligned.current = true;
        if (!parts || (timeFilter.mode === "month" && timeFilter.month === parts.monthKey)) return;
        setTimeFilter((current) => ({ ...current, month: parts.monthKey, year: parts.year }));
      });
    }
    return () => {
      active = false;
    };
  }, [projectId, timeFilter, reloadTick, livePollTick, slotInterval]);

  const pointsForEnergy = useMemo(
    () => allPoints.filter((p) => p.energy === energy),
    [allPoints, energy],
  );

  const filteredPoints = useMemo(() => {
    const q = pointQuery.trim().toLowerCase();
    if (!q) return pointsForEnergy;
    return pointsForEnergy.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }, [pointQuery, pointsForEnergy]);

  // Khi đổi loại năng lượng, giữ các điểm đã chọn thuộc loại đó; nếu trống thì chọn 1–2 điểm đầu
  useEffect(() => {
    setSelectedIds((current) => {
      const kept = current.filter((id) => pointsForEnergy.some((p) => p.id === id));
      if (selectionTouched.current) return kept;
      const linked = pointsForEnergy.filter(
        (point) =>
          gatewaySamples.some((sample) => sample.meterPointId === point.id) ||
          dailyRows.some((row) => row.meterPointId === point.id),
      );
      if (linked.length > 0 && !kept.some((id) => linked.some((point) => point.id === id))) {
        return linked.slice(0, Math.min(2, linked.length)).map((point) => point.id);
      }
      if (kept.length > 0) return kept;
      const source = linked.length > 0 ? linked : pointsForEnergy;
      return source.slice(0, Math.min(2, source.length)).map((point) => point.id);
    });
  }, [dailyRows, pointsForEnergy, gatewaySamples]);

  const selectedPoints = useMemo(
    () => pointsForEnergy.filter((p) => selectedIds.includes(p.id)),
    [pointsForEnergy, selectedIds],
  );

  const values = useMemo(
    () => seriesFor(selectedPoints.length),
    [selectedPoints.length],
  );

  const gatewayByPoint = useMemo(() => {
    const grouped = new Map<string, ProjectGatewaySample[]>();
    for (const sample of gatewaySamples) {
      const list = grouped.get(sample.meterPointId) ?? [];
      list.push(sample);
      grouped.set(sample.meterPointId, list);
    }
    return grouped;
  }, [gatewaySamples]);

  const filterSpan = useMemo(() => timeFilterSpan(timeFilter), [timeFilter]);

  const isDayMode = timeFilter.mode === "day";
  /** 15 phút chỉ dùng được khi mọi điểm đo đang chọn đều có slot điện năng (EPaed); nếu không thì lùi về 30 phút. */
  const effectiveInterval: SlotInterval = useMemo(() => {
    if (slotInterval !== 15) return slotInterval;
    const allHaveSlots =
      selectedPoints.length > 0 &&
      selectedPoints.every((point) => energySlots.some((slot) => slot.meterPointId === point.id));
    return allHaveSlots ? 15 : 30;
  }, [energySlots, selectedPoints, slotInterval]);

  const multiBars = useMemo(
    () =>
      selectedPoints.map((point) => {
        const samples = gatewayByPoint.get(point.id);
        const daily = dailyRows.filter((row) => row.meterPointId === point.id);
        const slots = energySlots.filter((slot) => slot.meterPointId === point.id);
        if (isDayMode && slots.length > 0) {
          return {
            point,
            bars: energyAndTouFromSlots(timeFilter, slots, dayBucketLayout(timeFilter.date, effectiveInterval)).bars,
          };
        }
        const bars =
          slots.length > 0
            ? energyAndTouFromSlots(timeFilter, slots).bars
            : !filterSpan.hourly && daily.length
              ? energyBarsFromDaily(timeFilter, daily)
              : samples?.length
                ? energyBarsFromGateway(timeFilter, samples)
                : energyBarsFromReadings(timeFilter, point.id, readings);
        return { point, bars: isDayMode && effectiveInterval === 60 ? mergeHalfHourBars(bars) : bars };
      }),
    [dailyRows, effectiveInterval, energySlots, filterSpan.hourly, gatewayByPoint, isDayMode, readings, selectedPoints, timeFilter],
  );

  /** Điểm đo (node) cung cấp dữ liệu thời gian thực: điểm đầu tiên đang chọn có mẫu gateway. */
  const livePoint = useMemo(
    () => selectedPoints.find((point) => (gatewayByPoint.get(point.id)?.length ?? 0) > 0) ?? null,
    [gatewayByPoint, selectedPoints],
  );
  const liveSamples = useMemo(
    () => (livePoint ? gatewayByPoint.get(livePoint.id) ?? [] : []),
    [gatewayByPoint, livePoint],
  );

  const barCount = multiBars[0]?.bars.length ?? 30;

  useEffect(() => {
    setRange({ start: 0, end: Math.max(barCount - 1, 0) });
  }, [timeFilter, barCount]);

  // Pst/Plt (nháy sáng): tab chỉ hiện khi đồng hồ có gửi các chỉ số này.
  const pstKeys = useMemo(() => flickerKeys(liveSamples), [liveSamples]);
  const metric: MetricId = metricChoice === "pst" && pstKeys.length === 0 ? "energy" : metricChoice;

  const isElectric = energy === "Điện";
  /** Tiêu thụ năng lượng/hạ tầng — áp dụng mọi loại (Điện, Nước, …) */
  const isConsumptionChart = metric === "energy";
  const isEnergyChart = isElectric && isConsumptionChart;
  const isUiChart = isElectric && metric === "ui";
  const isFreqChart = isElectric && metric === "freq";
  const isPowerChart = isElectric && metric === "power";
  const isPfChart = isElectric && metric === "pf";
  const isHarmChart = isElectric && metric === "harm";
  const isUnbChart = isElectric && metric === "unbalance";
  const isPstChart = isElectric && metric === "pst";
  const meta = metricMeta(energy, isElectric ? metric : "energy");
  const yMax = isConsumptionChart ? 7 : Math.max(...values.flat(), 1) * 1.08;
  const yMin = isConsumptionChart ? 0 : Math.min(0, Math.min(...values.flat()) * 0.92);

  // Rời tab Điện → về chế độ tiêu thụ
  useEffect(() => {
    if (!isElectric && metric !== "energy") {
      setMetric("energy");
    }
  }, [isElectric, metric]);

  const consumptionUnit =
    energy === "Nước"
      ? "m³"
      : energy === "Khí nén"
        ? "Nm³"
        : energy === "Hơi"
          ? "t"
          : energy === "Nhiệt"
            ? "kWh"
            : "kWh";

  const primaryBars = multiBars[0]?.bars ?? energyBarsFromReadings(timeFilter, selectedPoints[0]?.id, readings);
  const visibleBars = primaryBars.slice(range.start, range.end + 1);
  const barSum = multiBars.reduce(
    (sum, series) =>
      sum + series.bars.slice(range.start, range.end + 1).reduce((s, p) => s + p.kwh, 0),
    0,
  );

  const pointTotals = useMemo(
    () =>
      multiBars.map((item) => ({
        point: item.point,
        total: item.bars.reduce((s, p) => s + p.kwh, 0),
      })),
    [multiBars],
  );

  const grandTotal = pointTotals.reduce((s, item) => s + item.total, 0);

  const tou = useMemo(() => {
    const result = { peak: 0, normal: 0, off: 0, none: 0 };
    for (const point of selectedPoints) {
      const slots = energySlots.filter((slot) => slot.meterPointId === point.id);
      if (slots.length > 0) {
        const computed = energyAndTouFromSlots(timeFilter, slots).tou;
        result.peak += computed.peak;
        result.normal += computed.normal;
        result.off += computed.off;
        result.none += computed.none;
        continue;
      }
      const samples = gatewayByPoint.get(point.id);
      if (!samples?.length) continue;
      const ordered = [...samples].sort((a, b) => a.at.localeCompare(b.at));
      const rawKwhs = ordered.map((s) =>
        typeof s.values.EPaed === "number" ? registerToKwh(s.values.EPaed) : NaN,
      );
      let prevKwh: number | null = null;
      for (let i = 0; i < ordered.length; i++) {
        const currKwh = rawKwhs[i];
        if (!Number.isFinite(currKwh) || currKwh < 0) continue;
        if (prevKwh != null && currKwh < prevKwh - 1) {
          const nextValid = rawKwhs.slice(i + 1, i + 8).some((n) => Number.isFinite(n) && n >= prevKwh! - 1);
          if (nextValid) continue;
        }
        const delta = prevKwh == null ? 0 : Math.max(0, currKwh - prevKwh);
        prevKwh = currKwh;
        if (delta <= 0 || delta >= 500) continue;
        const parts = vietnamFromStored(ordered[i].at);
        if (!parts) {
          result.none += delta;
          continue;
        }
        const band = industrialBand(
          civilWeekday(parts.year, parts.month, parts.day),
          parts.hour,
          parts.minute,
        );
        result[band] += delta;
      }
    }
    return {
      peak: Math.round(result.peak * 100) / 100,
      normal: Math.round(result.normal * 100) / 100,
      off: Math.round(result.off * 100) / 100,
      none: Math.round(result.none * 100) / 100,
    };
  }, [energySlots, gatewayByPoint, selectedPoints, timeFilter]);

  const totals = useMemo(() => {
    if (isConsumptionChart) {
      return {
        kind: "energy" as const,
        total: formatNum(grandTotal),
        count: selectedPoints.length,
      };
    }
    const flat = values.flat();
    if (flat.length === 0) {
      return { kind: "stats" as const, min: "--", max: "--", avg: "--", count: selectedPoints.length };
    }
    const min = Math.min(...flat);
    const max = Math.max(...flat);
    const avg = flat.reduce((a, b) => a + b, 0) / flat.length;
    return {
      kind: "stats" as const,
      min: formatAppNumber(min, { minDecimals: 2, maxDecimals: 2 }),
      max: formatAppNumber(max, { minDecimals: 2, maxDecimals: 2 }),
      avg: formatAppNumber(avg, { minDecimals: 2, maxDecimals: 2 }),
      count: selectedPoints.length,
    };
  }, [grandTotal, values, isConsumptionChart, selectedPoints.length]);

  const statsUnit =
    metric === "pst"
      ? "Pst"
      : metric === "freq"
        ? "Hz"
        : metric === "ui"
          ? "V"
          : metric === "power"
            ? "kW"
            : metric === "pf"
              ? "cosφ"
            : metric === "harm" || metric === "unbalance"
              ? "%"
              : "";

  function togglePoint(id: string) {
    selectionTouched.current = true;
    setSelectedIds((current) => {
      if (current.includes(id)) {
        return current.filter((item) => item !== id);
      }
      return [...current, id];
    });
  }

  function selectAllVisible() {
    selectionTouched.current = true;
    setSelectedIds(filteredPoints.map((p) => p.id));
  }

  function clearSelection() {
    selectionTouched.current = true;
    setSelectedIds([]);
  }

  return (
    <div className="flex h-full min-h-0 bg-[#f4f6f9]">
      {pointsOpen ? (
        <button
          type="button"
          aria-label="Đóng danh sách điểm đo"
          className="fixed inset-0 z-30 bg-slate-900/40 md:hidden"
          onClick={() => setPointsOpen(false)}
        />
      ) : null}
      <aside
        className={`${
          pointsOpen ? "fixed inset-y-0 left-0 z-40 flex" : "hidden"
        } w-[min(280px,85vw)] shrink-0 flex-col border-r border-slate-200 bg-white shadow-xl md:relative md:z-0 md:flex md:w-[240px] md:shadow-none lg:w-[280px]`}
      >
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Điểm đo trên sơ đồ</h2>
              <p className="mt-0.5 text-[11px] leading-4 text-slate-400">
                Tick chọn vị trí điểm đo (cùng danh sách Cấu hình / Sơ đồ) để hiển thị trên biểu đồ
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPointsOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 md:hidden"
              aria-label="Đóng"
            >
              ×
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-slate-400">
            DANH SÁCH ĐIỂM ĐO · {energy.toUpperCase()}
          </p>
          <label className="relative mb-2 block">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400">
              <SearchIcon className="h-3.5 w-3.5" />
            </span>
            <input
              value={pointQuery}
              onChange={(e) => setPointQuery(e.target.value)}
              placeholder="Tìm điểm đo..."
              className="h-9 w-full rounded-md border border-slate-200 bg-white pr-3 pl-9 text-sm outline-none placeholder:text-slate-400 focus:border-emerald-500"
            />
          </label>
          <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
            <span>
              Đã chọn {selectedPoints.length}/{filteredPoints.length}
            </span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={selectAllVisible}
                className="font-medium text-emerald-600 hover:underline"
              >
                Chọn tất cả
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="font-medium text-slate-500 hover:underline"
              >
                Bỏ chọn
              </button>
            </span>
          </div>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {filteredPoints.length === 0 ? (
              <li className="py-8 text-center text-sm text-slate-400">
                Không có điểm đo loại {energy}. Thêm tại Cấu hình → Cụm điểm đo.
              </li>
            ) : (
              filteredPoints.map((point, index) => {
                const checked = selectedIds.includes(point.id);
                return (
                  <li key={point.id}>
                    <label
                      className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2.5 transition-colors ${
                        checked
                          ? "bg-emerald-600 text-white shadow-sm"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePoint(point.id)}
                        className="h-4 w-4 shrink-0 rounded border border-white/40 bg-white accent-emerald-600"
                      />
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[2px] ring-1 ring-black/10"
                        style={{ backgroundColor: point.color }}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[13px] font-medium ${
                            checked ? "text-white" : "text-slate-700"
                          }`}
                        >
                          {index + 1}. {point.name}
                        </span>
                        <span
                          className={`block truncate text-[11px] ${
                            checked ? "text-white/75" : "text-slate-400"
                          }`}
                        >
                          ({point.code})
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto md:overflow-hidden">
        <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-4">
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none sm:flex-wrap">
              <button
                type="button"
                onClick={() => setPointsOpen(true)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[13px] font-medium text-slate-700 md:hidden"
              >
                Điểm đo ({selectedPoints.length})
              </button>
              {energyKinds.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setEnergy(item);
                    setMetric("energy");
                  }}
                  className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors ${
                    energy === item
                      ? "border-slate-900 bg-slate-900 text-white shadow-xs"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <EnergyGlyph type={ENERGY_KIND_META[item] ?? "bolt"} className="h-3.5 w-3.5" />
                  {item}
                </button>
              ))}
            </div>
            <TimeFilterBar
              className="w-full"
              value={timeFilter}
              onChange={(next) => {
                filterTouched.current = true;
                setTimeFilter(next);
              }}
            />
          </div>
          <div className="mt-2 flex items-center gap-1 overflow-x-auto border-t border-slate-100 pt-2 pb-0.5 scrollbar-none sm:flex-wrap">
            {(isElectric
              ? METRICS.filter((m) => m.id !== "pst" || pstKeys.length > 0)
              : METRICS.filter((m) => m.id === "energy")
            ).map(
              (item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMetric(item.id)}
                  className={`h-7 shrink-0 rounded-full px-2.5 text-[11.5px] font-medium whitespace-nowrap transition-colors ${
                    metric === item.id
                      ? "bg-emerald-600 text-white shadow-xs"
                      : "bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-white"
                  }`}
                >
                  {item.label}
                </button>
              ),
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1 md:min-h-0 md:overflow-y-auto p-2 sm:p-3">
        {isPstChart ? (
          <PstTrend keys={pstKeys} samples={liveSamples} onRefresh={handleRefresh} />
        ) : isUiChart ? (
          <section className="w-full min-w-0 rounded-lg border border-slate-200 bg-white p-2 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-3">
            <UiWaveform timeFilter={timeFilter} samples={liveSamples} onRefresh={handleRefresh} chartParams={chartParams} />
          </section>
        ) : isFreqChart ? (
          <FrequencyChart
            timeFilter={timeFilter}
            samples={liveSamples}
            onRefresh={handleRefresh}
            chartParams={chartParams}
          />
        ) : isPowerChart ? (
          <PowerChart timeFilter={timeFilter} samples={liveSamples} onRefresh={handleRefresh} chartParams={chartParams} />
        ) : isPfChart ? (
          <PowerFactorChart timeFilter={timeFilter} samples={liveSamples} onRefresh={handleRefresh} chartParams={chartParams} />
        ) : isHarmChart ? (
          <HarmonicsChart timeFilter={timeFilter} samples={liveSamples} onRefresh={handleRefresh} chartParams={chartParams} />
        ) : isUnbChart ? (
          <UnbalanceChart timeFilter={timeFilter} samples={liveSamples} onRefresh={handleRefresh} chartParams={chartParams} />
        ) : isConsumptionChart ? (
          <>
            <div className="flex w-full min-w-0 flex-col gap-4">
              <article className="w-full min-w-0 rounded-lg border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-semibold text-slate-800">
                      {energy === "Điện"
                        ? "Chi tiết tiêu thụ điện năng"
                        : `Chi tiết tiêu thụ ${energy.toLowerCase()}`}
                    </h2>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-600">
                      {selectedPoints.length === 0 ? (
                        <span className="text-slate-400">Chọn điểm đo bên trái để hiển thị</span>
                      ) : (
                        selectedPoints.map((point) => (
                          <span key={point.id} className="inline-flex items-center gap-1.5">
                            <span
                              className="h-2.5 w-2.5 rounded-[2px]"
                              style={{ backgroundColor: point.color }}
                            />
                            ({point.code}) {point.name}
                          </span>
                        ))
                      )}
                      {showSum && selectedPoints.length > 0 ? (
                        <span className="font-semibold text-emerald-600">
                          Σ {formatNum(barSum)} {consumptionUnit}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {isDayMode ? (
                      <div
                        className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-semibold"
                        role="group"
                        aria-label="Khoảng thời gian mỗi cột"
                        title="Khoảng thời gian mỗi cột"
                      >
                        {SLOT_INTERVALS.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setSlotInterval(option)}
                            className={`rounded-md px-2 py-1 transition-colors ${
                              slotInterval === option
                                ? "bg-white text-emerald-700 shadow-sm"
                                : "text-slate-500 hover:text-slate-800"
                            }`}
                          >
                            {option === 60 ? "1 giờ" : `${option} phút`}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="flex items-center">
                    <IconBtn
                      label="Biểu đồ cột"
                      active={view === "chart"}
                      onClick={() => setView("chart")}
                    >
                      <BarIcon className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn label="Tổng" active={showSum} onClick={() => setShowSum((v) => !v)}>
                      <SigmaIcon className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn
                      label="Bảng dữ liệu"
                      active={view === "table"}
                      onClick={() => setView("table")}
                    >
                      <TableIcon className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn label="Làm mới" onClick={handleRefresh}>
                      <RefreshIcon className="h-4 w-4" />
                    </IconBtn>
                    </div>
                  </div>
                </div>

                {selectedPoints.length === 0 ? (
                  <p className="py-16 text-center text-sm text-slate-400">
                    Tick chọn điểm đo bên trái để xem tiêu thụ
                  </p>
                ) : view === "chart" ? (
                  <div className="mt-3 flex w-full min-w-0 flex-col gap-3">
                    <MultiConsumptionBarChart
                      series={multiBars}
                      range={range}
                      hover={hover}
                      onHover={setHover}
                      unit={consumptionUnit}
                      yMaxHint={260}
                    />
                    <ChartTimeline
                      labels={primaryBars.map((item) => item.label)}
                      values={primaryBars.map((item) => item.kwh)}
                      range={range}
                      onRange={setRange}
                    />
                  </div>
                ) : (
                  <div className="mt-3 flex w-full min-w-0 flex-col gap-3">
                    <ChartDataTable
                      title={
                        energy === "Điện"
                          ? "Chi tiết tiêu thụ điện năng"
                          : `Chi tiết tiêu thụ ${energy.toLowerCase()}`
                      }
                      subtitle={`Kỳ lọc: ${getTimeFilterLabel(timeFilter)} · Đơn vị: ${consumptionUnit}${
                        filterSpan.hourly && liveSamples.length > 0
                          ? ` · Thời gian thực (${formatAppNumber(liveSamples.length, 0)} bản ghi)`
                          : ""
                      }`}
                      filename={`tieu-thu-${energy.toLowerCase()}`}
                      columns={[
                        { header: filterSpan.hourly && liveSamples.length > 0 ? "Time (Thời gian thực)" : "Thời điểm" },
                        ...selectedPoints.map((p) => ({
                          header: `(${p.code}) ${p.name} (${consumptionUnit})`,
                          color: p.color,
                        })),
                      ]}
                      rows={
                        filterSpan.hourly && liveSamples.length > 0
                          ? liveSamples.slice(-500).map((sample) => ({
                              label: formatStoredVietnam(sample.at) ?? sample.at,
                              values: selectedPoints.map((p) => {
                                const ptSamples = gatewayByPoint.get(p.id);
                                const raw =
                                  (ptSamples?.find((s) => s.at === sample.at) ?? sample).values.EPaed;
                                const kwh =
                                  typeof raw === "number" && Number.isFinite(raw)
                                    ? Number(registerToKwh(raw).toFixed(2))
                                    : 0;
                                return {
                                  raw: kwh,
                                  display: `${formatAppNumber(kwh, { maxDecimals: 2 })} ${consumptionUnit}`,
                                };
                              }),
                            }))
                          : visibleBars.map((point, rowIdx) => ({
                              label: point.label,
                              values: multiBars.map((series) => {
                                const kwh = Number(
                                  (series.bars[range.start + rowIdx]?.kwh ?? 0).toFixed(3),
                                );
                                return {
                                  raw: kwh,
                                  display: `${formatKwh(kwh)} ${consumptionUnit}`,
                                };
                              }),
                            }))
                      }
                    />
                    <ChartTimeline
                      labels={primaryBars.map((item) => item.label)}
                      values={primaryBars.map((item) => item.kwh)}
                      range={range}
                      onRange={setRange}
                    />
                  </div>
                )}
              </article>

              {/* Biểu đồ xu hướng chỉ số điện năng 2 chiều (6 tham số) hoặc tham số động cho Nước/Khí nén/Nhiệt/Hơi */}
              {isElectric ? (
                <BidirectionalEnergyTrend
                  samples={liveSamples}
                  nodeName={livePoint ? livePoint.name : selectedPoints[0]?.name}
                  onRefresh={handleRefresh}
                />
              ) : (
                <DynamicUtilityTrend
                  energy={energy}
                  unit={consumptionUnit}
                  samples={liveSamples}
                  onRefresh={handleRefresh}
                />
              )}

              <div className="grid w-full min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
                <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                  <h2 className="text-center text-[13px] font-bold tracking-wide text-slate-700">
                    {energy === "Điện" ? "TỔNG ĐIỆN NĂNG TIÊU THỤ" : `TỔNG ${energy.toUpperCase()} TIÊU THỤ`}
                  </h2>
                  <ConsumptionDonut
                    value={grandTotal}
                    unit={consumptionUnit}
                    segments={pointTotals}
                  />
                  <div className="mt-2 max-h-36 space-y-1.5 overflow-y-auto">
                    {pointTotals.map((item) => {
                      const pct = grandTotal > 0 ? Math.round((item.total / grandTotal) * 100) : 0;
                      return (
                        <div
                          key={item.point.id}
                          className="rounded-md bg-[#eaf3fb] px-3 py-2 text-[12px] text-slate-700"
                        >
                          <p className="flex items-start gap-2">
                            <span
                              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: item.point.color }}
                            />
                            <span>
                              ({item.point.code}) {item.point.name}
                              <span className="mt-0.5 block font-semibold">
                                {formatNum(item.total)} {consumptionUnit} (~{pct}%)
                              </span>
                            </span>
                          </p>
                        </div>
                      );
                    })}
                    {pointTotals.length === 0 ? (
                      <p className="py-4 text-center text-[12px] text-slate-400">Chưa chọn điểm đo</p>
                    ) : null}
                  </div>
                </article>

                {isElectric ? (
                  <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                    <h2 className="text-center text-[13px] font-bold tracking-wide text-slate-700">
                      TỔNG HỢP TIÊU THỤ THEO KHUNG GIỜ
                    </h2>
                    <TouConsumptionChart values={tou} />
                    <p className="mt-1 text-right text-[11px] text-slate-400">({consumptionUnit})</p>
                  </article>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-xs">
                <span className="text-slate-400 font-normal">Kỳ lọc:</span>
                <span className="text-slate-900">{getTimeFilterLabel(timeFilter)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[12px] text-slate-500">
                <p className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${liveSamples.length ? "bg-emerald-500" : "bg-slate-300"}`} />
                  {liveSamples.length ? "Đang có số liệu đo" : "Chưa có số liệu đo"}
                </p>
                <p>{liveSamples.length ? `Cập nhật: ${formatStoredVietnam(liveSamples[liveSamples.length - 1].at) ?? liveSamples[liveSamples.length - 1].at}` : "Chưa có số liệu"}</p>
              </div>
            </div>
          </>
        ) : (
          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-4">
            <div className="relative">
              <h1 className="text-center text-[15px] font-semibold text-slate-800 sm:text-[16px]">
                {meta.title}
              </h1>
              <div className="absolute top-0 right-0 flex items-center gap-0.5">
                <IconBtn label="Biểu đồ" active={view === "chart"} onClick={() => setView("chart")}>
                  <BarIcon className="h-4 w-4" />
                </IconBtn>
                <IconBtn label="Tổng" active={showSum} onClick={() => setShowSum((v) => !v)}>
                  <SigmaIcon className="h-4 w-4" />
                </IconBtn>
                <IconBtn label="Bảng dữ liệu" active={view === "table"} onClick={() => setView("table")}>
                  <TableIcon className="h-4 w-4" />
                </IconBtn>
                <IconBtn label="Làm mới" onClick={handleRefresh}>
                  <RefreshIcon className="h-4 w-4" />
                </IconBtn>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px] text-slate-600">
              {selectedPoints.length === 0 ? (
                <span className="text-slate-400">Chọn điểm đo bên trái để hiển thị</span>
              ) : (
                selectedPoints.map((point) => (
                  <span key={point.id} className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-[2px]"
                      style={{ backgroundColor: point.color }}
                    />
                    ({point.code}) {point.name}
                  </span>
                ))
              )}
            </div>

            {view === "chart" ? (
              <div className="relative mt-2">
                <LineChart
                  values={values}
                  colors={selectedPoints.map((p) => p.color)}
                  names={selectedPoints.map((p) => p.name)}
                  yMin={yMin}
                  yMax={yMax}
                  zoom={zoom}
                  hover={hover}
                  onHover={setHover}
                />
                <div className="absolute top-3 right-1 flex flex-col gap-1">
                  <IconBtn label="Phóng to" onClick={() => setZoom((z) => Math.min(3, z + 0.35))}>
                    +
                  </IconBtn>
                  <IconBtn label="Thu nhỏ" onClick={() => setZoom((z) => Math.max(1, z - 0.35))}>
                    −
                  </IconBtn>
                  <IconBtn label="Về mặc định" onClick={() => setZoom(1)}>
                    <HomeIcon className="h-4 w-4" />
                  </IconBtn>
                </div>
              </div>
            ) : (
              <ChartDataTable
                title={meta.title}
                subtitle={`Kỳ lọc: ${getTimeFilterLabel(timeFilter)}`}
                filename={`bieu-do-${metric}`}
                columns={[
                  { header: "Thời điểm" },
                  ...selectedPoints.map((p) => ({
                    header: `(${p.code}) ${p.name}`,
                    color: p.color,
                  })),
                ]}
                rows={Array.from({ length: 25 }, (_, i) => ({
                  label: `${String(i).padStart(2, "0")}:00`,
                  values: values.map((row) => {
                    const num = Number((row[i] ?? 0).toFixed(2));
                    return { raw: num, display: formatAppNumber(num, { minDecimals: 1, maxDecimals: 1 }) };
                  }),
                }))}
              />
            )}

            {isElectric && totals.kind === "stats" ? (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <StatCard
                  label={`GIÁ TRỊ NHỎ NHẤT (${totals.count} ĐIỂM)`}
                  value={totals.min}
                  unit={statsUnit}
                  color="text-emerald-600"
                />
                <StatCard
                  label={`GIÁ TRỊ LỚN NHẤT (${totals.count} ĐIỂM)`}
                  value={totals.max}
                  unit={statsUnit}
                  color="text-red-500"
                />
                <StatCard
                  label={`GIÁ TRỊ TRUNG BÌNH (${totals.count} ĐIỂM)`}
                  value={totals.avg}
                  unit={statsUnit}
                  color="text-emerald-600"
                />
              </div>
            ) : null}
          </section>
        )}

        {!isUiChart &&
        !isFreqChart &&
        !isPowerChart &&
        !isPfChart &&
        !isHarmChart &&
        !isUnbChart &&
        !isConsumptionChart ? null : isConsumptionChart ? null : (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[12px] text-slate-500">
            <p className="flex items-center gap-3">
              <span className={`rounded px-2 py-1 text-[11px] font-bold tracking-wide ${liveSamples.length ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                {liveSamples.length ? "ĐANG CÓ SỐ LIỆU" : "CHƯA CÓ SỐ LIỆU"}
              </span>
              <span>{liveSamples.length ? `Cập nhật: ${formatStoredVietnam(liveSamples[liveSamples.length - 1].at) ?? liveSamples[liveSamples.length - 1].at}` : "Chưa có số liệu"}</span>
            </p>
            <p className="inline-flex items-center gap-1.5 font-medium text-slate-400">
              <ShieldIcon className="h-4 w-4" />
              DỮ LIỆU BẢO MẬT
            </p>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

function MultiConsumptionBarChart({
  series,
  range,
  hover,
  onHover,
  unit = "kWh",
  yMaxHint = 260,
}: {
  series: { point: MeterPoint; bars: BarPoint[] }[];
  range: { start: number; end: number };
  hover: number | null;
  onHover: (index: number | null) => void;
  unit?: string;
  yMaxHint?: number;
}) {
  const { ref, width: W, height: H } = useChartSize();
  const pad = { l: 48, r: 16, t: 28, b: 32 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const base = series[0]?.bars ?? [];
  const visibleLen = Math.max(range.end - range.start + 1, 1);
  // Cột xếp chồng: mỗi mốc thời gian là một cột, mỗi điểm đo là một đoạn của cột.
  const valueAt = (item: { bars: BarPoint[] }, index: number) => Math.max(0, item.bars[index]?.kwh ?? 0);
  const totalAt = (index: number) => series.reduce((sum, item) => sum + valueAt(item, index), 0);
  const rawMax = Math.max(0, ...Array.from({ length: visibleLen }, (_, i) => totalAt(range.start + i)));
  const yMax =
    rawMax > 0 && rawMax < 50 ? rawMax * 1.25 : Math.max(yMaxHint, Math.ceil(Math.max(rawMax, 1) / 50) * 50);
  const yAt = (v: number) => pad.t + ((yMax - v) / yMax) * innerH;
  const groupW = innerW / visibleLen;
  const colW = Math.max(2, groupW * 0.7);
  const tipW = 250;
  const tickStep =
    yMax <= 0.01 ? yMax / 4 : yMax <= 1 ? 0.2 : yMax <= 10 ? 2 : yMax <= 100 ? 20 : yMax <= 300 ? 50 : 100;
  const yTicks = Array.from({ length: Math.floor(yMax / tickStep) + 1 }, (_, i) => i * tickStep);

  return (
    <div ref={ref} className="mt-1 h-[240px] w-full min-w-0 sm:h-[360px] lg:h-[420px]">
      {W > 0 && H > 0 ? (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-full w-full"
        onMouseLeave={() => onHover(null)}
      >
        <text x={pad.l} y="16" className="fill-slate-400" fontSize="12">
          ({unit})
        </text>
        {yTicks.map((v, tickIndex) => {
          const y = yAt(v);
          const label =
            yMax < 1
              ? formatAppNumber(v, { minDecimals: 3, maxDecimals: 3 })
              : yMax < 10
                ? formatAppNumber(v, { minDecimals: 1, maxDecimals: 1 })
                : formatAppNumber(Math.round(v), 0);
          return (
            <g key={tickIndex}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="#eceff3" />
              <text x={pad.l - 8} y={y + 4} textAnchor="end" className="fill-slate-400" fontSize="11">
                {label}
              </text>
            </g>
          );
        })}
        {Array.from({ length: visibleLen }, (_, i) => {
          const globalIndex = range.start + i;
          if (!base[globalIndex]) return null;
          const x = pad.l + i * groupW + (groupW - colW) / 2;
          let stacked = 0;
          return (
            <g
              key={`col-${globalIndex}`}
              opacity={hover == null || hover === globalIndex ? 1 : 0.4}
              onMouseEnter={() => onHover(globalIndex)}
            >
              {/* Vùng bắt hover cả chiều cao để rê vào cột thấp vẫn hiện chi tiết. */}
              <rect x={pad.l + i * groupW} y={pad.t} width={groupW} height={innerH} fill="transparent" />
              {series.map((item) => {
                const value = valueAt(item, globalIndex);
                if (value <= 0) return null;
                const y0 = yAt(stacked);
                stacked += value;
                const y1 = yAt(stacked);
                return (
                  <rect
                    key={item.point.id}
                    x={x}
                    y={y1}
                    width={colW}
                    height={Math.max(0, y0 - y1)}
                    fill={item.point.color}
                    stroke="white"
                    strokeWidth={series.length > 1 ? 0.5 : 0}
                  />
                );
              })}
            </g>
          );
        })}
        {(() => {
          const maxLabels = Math.max(3, Math.floor(innerW / 46));
          const labelStep = Math.max(1, Math.ceil(visibleLen / maxLabels));
          const lastStepIdx = Math.floor(Math.max(0, visibleLen - 1) / labelStep) * labelStep;
          return Array.from({ length: visibleLen }, (_, i) => {
            const globalIndex = range.start + i;
            const point = base[globalIndex];
            if (!point) return null;
            const isStep = i % labelStep === 0;
            const isLast =
              i === visibleLen - 1 && innerW >= 90 && (visibleLen - 1 - lastStepIdx) * groupW >= 42;
            if (!isStep && !isLast) return null;
            return (
              <text
                key={`lbl-${point.minute}`}
                x={pad.l + i * groupW + groupW / 2}
                y={H - 10}
                textAnchor="middle"
                className="fill-slate-500"
                fontSize={W < 420 ? "10" : "11"}
              >
                {point.label}
              </text>
            );
          });
        })()}
        {hover != null && base[hover]
          ? (() => {
              const total = totalAt(hover);
              const colX = pad.l + (hover - range.start) * groupW;
              // Cột ở nửa phải thì đặt tooltip bên trái cột để không che/tràn khung.
              const tipX =
                colX + groupW / 2 > W / 2 ? Math.max(pad.l, colX - tipW - 8) : Math.min(colX + groupW + 8, W - tipW - 4);
              const shortName = (name: string) => (name.length > 16 ? `${name.slice(0, 15)}…` : name);
              return (
                <g transform={`translate(${tipX}, ${pad.t + 6})`} pointerEvents="none">
                  <rect width={tipW} height={44 + series.length * 17} rx="6" fill="white" stroke="#e2e8f0" />
                  <text x="10" y="17" className="fill-slate-500" fontSize="11" fontWeight="600">
                    {base[hover].label}
                  </text>
                  <text x="10" y="35" className="fill-slate-800" fontSize="12" fontWeight="700">
                    Tổng: {formatKwh(total)} {unit}
                  </text>
                  {series.map((item, i) => {
                    const value = valueAt(item, hover);
                    const pct = total > 0 ? (value / total) * 100 : 0;
                    const y = 54 + i * 17;
                    return (
                      <g key={item.point.id}>
                        <rect x="10" y={y - 9} width="9" height="9" rx="2" fill={item.point.color} />
                        <text x="24" y={y} fontSize="11" className="fill-slate-600">
                          {shortName(item.point.name || item.point.code)}
                        </text>
                        <text x={tipW - 10} y={y} fontSize="11" fontWeight="600" textAnchor="end" fill={item.point.color}>
                          {formatKwh(value)} {unit} ({formatAppNumber(pct, { minDecimals: 1, maxDecimals: 1 })}%)
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })()
          : null}
      </svg>
      ) : null}
    </div>
  );
}

function ConsumptionDonut({
  value,
  unit,
  segments,
}: {
  value: number;
  unit: string;
  segments: { point: MeterPoint; total: number }[];
}) {
  const r = 58;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="relative mx-auto my-3 h-[168px] w-[168px]">
      <svg viewBox="0 0 160 160" className="h-full w-full">
        <circle cx="80" cy="80" r={r} fill="none" stroke="#e8eef4" strokeWidth="22" />
        {segments.map((item) => {
          const portion = value > 0 ? item.total / value : 0;
          const dash = portion * c;
          const el = (
            <circle
              key={item.point.id}
              cx="80"
              cy="80"
              r={r}
              fill="none"
              stroke={item.point.color}
              strokeWidth="22"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              transform="rotate(-90 80 80)"
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-2 text-center">
        <p className="text-[20px] font-bold leading-none text-slate-800">{formatNum(value)}</p>
        <p className="mt-1 text-[12px] text-slate-500">{unit}</p>
      </div>
    </div>
  );
}

const TOU_COLORS = [
  { id: "peak", label: "Cao", color: "#e67e22" },
  { id: "normal", label: "Trung", color: "#27ae60" },
  { id: "off", label: "Thấp", color: "#7ec8e3" },
  { id: "none", label: "Không xác định", color: "#9aa3af" },
] as const;

function TouConsumptionChart({
  values,
}: {
  values: { peak: number; normal: number; off: number; none: number };
}) {
  const W = 300;
  const H = 180;
  const pad = { l: 18, r: 18, t: 28, b: 38 };
  const innerW = W - pad.l - pad.r;
  const yMax = Math.max(values.peak, values.normal, values.off, values.none, 1);
  const yAt = (v: number) => pad.t + ((yMax - v) / yMax) * (H - pad.t - pad.b);
  const items = [
    { label: TOU_COLORS[0].label, color: TOU_COLORS[0].color, value: values.peak },
    { label: TOU_COLORS[1].label, color: TOU_COLORS[1].color, value: values.normal },
    { label: TOU_COLORS[2].label, color: TOU_COLORS[2].color, value: values.off },
    { label: TOU_COLORS[3].label, color: TOU_COLORS[3].color, value: values.none },
  ];
  const groupW = innerW / items.length;
  const barW = 28;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-1 h-[180px] w-full"
    >
      {items.map((item, i) => {
        const x = pad.l + i * groupW + (groupW - barW) / 2;
        const h = Math.max(item.value === 0 ? 3 : 0, yAt(0) - yAt(item.value));
        return (
          <g key={item.label}>
            <text
              x={x + barW / 2}
              y={item.value === 0 ? H - pad.b - 10 : yAt(item.value) - 8}
              textAnchor="middle"
              className="fill-slate-600"
              fontSize="11"
            >
              {formatNum(item.value)}
            </text>
            <rect
              x={x}
              y={yAt(item.value) - (item.value === 0 ? 3 : 0)}
              width={barW}
              height={h}
              fill={item.color}
            />
            <text x={x + barW / 2} y={H - 18} textAnchor="middle" className="fill-slate-600" fontSize="12">
              {/* Nhãn dài (VD "Không xác định") xuống hai dòng để không chồng lên cột bên cạnh. */}
              {item.label.length > 8 && item.label.includes(" ") ? (
                <>
                  <tspan x={x + barW / 2}>{item.label.split(" ")[0]}</tspan>
                  <tspan x={x + barW / 2} dy="13">
                    {item.label.split(" ").slice(1).join(" ")}
                  </tspan>
                </>
              ) : (
                <tspan x={x + barW / 2} dy="6">
                  {item.label}
                </tspan>
              )}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({
  values,
  colors,
  names,
  yMin,
  yMax,
  zoom,
  hover,
  onHover,
}: {
  values: number[][];
  colors: string[];
  names: string[];
  yMin: number;
  yMax: number;
  zoom: number;
  hover: number | null;
  onHover: (index: number | null) => void;
}) {
  const { ref, width: W, height: H } = useChartSize();
  const pad = { l: 44, r: 36, t: 18, b: 36 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const visible = 24 / zoom;
  const start = (24 - visible) / 2;
  const xAt = (h: number) => pad.l + ((h - start) / visible) * innerW;
  const yAt = (v: number) => pad.t + ((yMax - v) / (yMax - yMin || 1)) * innerH;

  const paths = values.map((row) => toSmoothPath(row.map((v, h) => [xAt(h), yAt(v)])));
  const ticks = [0, 4, 8, 12, 16, 20, 24];

  return (
    <div ref={ref} className="h-[240px] w-full min-w-0 sm:h-[340px] lg:h-[400px]">
    {W > 0 && H > 0 ? (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-full w-full"
      onMouseLeave={() => onHover(null)}
      onMouseMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - box.left) / box.width) * W;
        const hour = start + ((x - pad.l) / innerW) * visible;
        onHover(Math.max(0, Math.min(24, Math.round(hour))));
      }}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = pad.t + innerH * (1 - t);
        return (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="#eef1f5" />
            <text x={pad.l - 8} y={y + 4} textAnchor="end" className="fill-slate-400" fontSize="11">
              {Math.round(yMin + (yMax - yMin) * t)}
            </text>
          </g>
        );
      })}
      {ticks.map((h) => (
        <text
          key={h}
          x={xAt(h)}
          y={H - 12}
          textAnchor="middle"
          className="fill-slate-400"
          fontSize="11"
        >
          {h === 24 ? "23:59" : `${String(h).padStart(2, "0")}:00`}
        </text>
      ))}
      {paths.map((d, i) => (
        <path key={names[i]} d={d} fill="none" stroke={colors[i]} strokeWidth="2.4" />
      ))}
      {hover != null ? (
        <>
          <line
            x1={xAt(hover)}
            x2={xAt(hover)}
            y1={pad.t}
            y2={H - pad.b}
            stroke="#94a3b8"
            strokeDasharray="4 4"
          />
          {values.map((row, i) => (
            <circle key={names[i]} cx={xAt(hover)} cy={yAt(row[hover])} r="4" fill={colors[i]} />
          ))}
          <g transform={`translate(${Math.min(xAt(hover) + 12, W - 170)}, ${pad.t + 8})`}>
            <rect
              width="158"
              height={22 + Math.max(names.length, 1) * 14}
              rx="6"
              fill="white"
              stroke="#e2e8f0"
            />
            <text x="10" y="18" className="fill-slate-500" fontSize="11">
              {hover === 24 ? "23:59" : `${String(hover).padStart(2, "0")}:00`}
            </text>
            {names.map((name, i) => (
              <text key={`${name}-${i}`} x="10" y={36 + i * 14} fontSize="11" fill={colors[i]}>
                {name}: {values[i][hover].toFixed(1)}
              </text>
            ))}
          </g>
        </>
      ) : null}
    </svg>
    ) : null}
    </div>
  );
}

function toSmoothPath(points: number[][]) {
  if (points.length < 2) return "";
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function StatCard({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  color: string;
}) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <p className="text-[11px] font-semibold tracking-[0.08em] text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${color}`}>
        {value}
        <span className="ml-1.5 text-base font-medium text-slate-400">{unit}</span>
      </p>
    </article>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  active = false,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md ${
        active ? "bg-slate-100 text-slate-700" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      }`}
    >
      {children}
    </button>
  );
}

function EnergyGlyph({
  type,
  className,
}: {
  type: "bolt" | "heat" | "air" | "water" | "steam";
  className?: string;
}) {
  if (type === "heat") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M12 20a5 5 0 0 0 5-5c0-3-5-8-5-8s-5 5-5 8a5 5 0 0 0 5 5Z" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (type === "air") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M4 9h12a3 3 0 1 0-3-3M4 15h14a3 3 0 1 1-3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "water") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M12 4s6 7 6 11a6 6 0 1 1-12 0c0-4 6-11 6-11Z" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (type === "steam") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M5 18h14M8 18V9l4-4 4 4v9M9.5 12h5M9.5 15h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M13 2 4.5 13.5h6.2L9.2 22 19.5 10h-6.2L13 2Z" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16.5 20 20.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 18V10M10 18V6M15 18v-5M20 18V8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SigmaIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M17 6H7l5 6-5 6h10" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M20 5v5h-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TableIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="5" width="16" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4 10h16M10 5v14" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-5v-5H10v5H5a1 1 0 0 1-1-1v-8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3 5 6v6c0 4.5 2.8 7.5 7 9 4.2-1.5 7-4.5 7-9V6l-7-3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const SERIES_PALETTE = [
  "#5470c6",
  "#91cc75",
  "#fac858",
  "#ee6666",
  "#73c0de",
  "#3ba272",
  "#fc8452",
  "#9a60b4",
  "#ea7ccc",
];

type EnergyRegisterKind = "P" | "Q" | "S";
type EnergyRegisterDir = "in" | "out";

/** Chỉ số điện năng 2 chiều: P (tác dụng), Q (phản kháng), S (biểu kiến) × điện vào (nhận) / điện ra (phát). */
const ENERGY_REGISTERS: { key: string; kind: EnergyRegisterKind; dir: EnergyRegisterDir; unit: string; color: string }[] = [
  { key: "EPaed", kind: "P", dir: "in", unit: "kWh", color: "#5470c6" },
  { key: "EPaer", kind: "P", dir: "out", unit: "kWh", color: "#91cc75" },
  { key: "EQred", kind: "Q", dir: "in", unit: "kVARh", color: "#fac858" },
  { key: "EQrer", kind: "Q", dir: "out", unit: "kVARh", color: "#ee6666" },
  { key: "ESaed", kind: "S", dir: "in", unit: "kVAh", color: "#73c0de" },
  { key: "ESaer", kind: "S", dir: "out", unit: "kVAh", color: "#9a60b4" },
];

/** Bật/tắt một lựa chọn (cho phép bỏ chọn hết). */
function toggleItem<T>(list: T[], value: T) {
  if (list.includes(value)) return list.filter((item) => item !== value);
  return [...list, value];
}

function BidirectionalEnergyTrend({
  samples,
  nodeName,
  onRefresh,
}: {
  samples?: ProjectGatewaySample[];
  /** Tên điểm đo (node) đang hiển thị — không dùng tên model đồng hồ. */
  nodeName?: string;
  onRefresh?: () => void;
}) {
  const [kinds, setKinds] = useState<EnergyRegisterKind[]>(["P"]);
  const [dirs, setDirs] = useState<EnergyRegisterDir[]>(["in", "out"]);

  const series = useMemo<TrendSeriesConfig[]>(
    () =>
      ENERGY_REGISTERS.filter((item) => kinds.includes(item.kind) && dirs.includes(item.dir)).map((item) => ({
        key: item.key,
        label: `${item.dir === "in" ? "Điện vào" : "Điện ra"} ${item.kind} - ${item.key} (${item.unit})`,
        tableLabel: `${item.dir === "in" ? "Vào" : "Ra"} ${item.kind} (${item.unit})`,
        color: item.color,
        unit: item.unit,
        digits: 3,
        extract: (sample) =>
          typeof sample.values[item.key] === "number" ? registerToKwh(sample.values[item.key]) : null,
      })),
    [kinds, dirs],
  );

  return (
    <SampleTrendChart
      title={nodeName ? `Chỉ số điện năng ${nodeName} theo thời gian thực` : "Chỉ số điện năng theo thời gian thực"}
      unitLabel="kWh / kVARh / kVAh"
      series={series}
      samples={samples}
      onRefresh={onRefresh}
      headerControls={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] font-medium text-slate-700">
          <div className="inline-flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1 shadow-2xs">
            {(["P", "Q", "S"] as EnergyRegisterKind[]).map((kind) => (
              <label key={kind} className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={kinds.includes(kind)}
                  onChange={() => setKinds((list) => toggleItem(list, kind))}
                  className="accent-emerald-600"
                />
                {kind === "P" ? "P (kWh)" : kind === "Q" ? "Q (kVARh)" : "S (kVAh)"}
              </label>
            ))}
          </div>
          <div className="inline-flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1 shadow-2xs">
            {(["in", "out"] as EnergyRegisterDir[]).map((dir) => (
              <label key={dir} className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={dirs.includes(dir)}
                  onChange={() => setDirs((list) => toggleItem(list, dir))}
                  className="accent-emerald-600"
                />
                {dir === "in" ? "Điện vào" : "Điện ra"}
              </label>
            ))}
          </div>
        </div>
      }
    />
  );
}

function DynamicUtilityTrend({
  energy,
  unit,
  samples,
  onRefresh,
}: {
  energy: string;
  unit: string;
  samples?: ProjectGatewaySample[];
  onRefresh?: () => void;
}) {
  const series = useMemo<TrendSeriesConfig[]>(() => {
    const keys = new Set<string>();
    for (const s of samples ?? []) {
      for (const [k, v] of Object.entries(s.values)) {
        if (typeof v === "number" && Number.isFinite(v)) keys.add(k);
      }
    }
    const list = Array.from(keys);
    if (!list.length) {
      return [{ key: "EPaed", label: `Chỉ số ${energy}`, color: "#5470c6", unit, digits: 2 }];
    }
    return list.slice(0, 8).map((k, idx) => {
      const known = METER_PARAMETERS.find((p) => p.key === k);
      return {
        key: k,
        label: known ? `${k} (${known.name})` : k,
        color: SERIES_PALETTE[idx % SERIES_PALETTE.length],
        unit: known?.unit || unit,
        digits: 2,
      };
    });
  }, [energy, samples, unit]);

  return (
    <SampleTrendChart
      title={`Biểu đồ thông số đo ${energy} theo mẫu thời gian thực`}
      unitLabel={unit}
      series={series}
      samples={samples}
      onRefresh={onRefresh}
    />
  );
}

/** Khoá chỉ số nháy sáng (Pst / Plt, theo pha) có trong bản tin gateway. */
function flickerKeys(samples: ProjectGatewaySample[]) {
  const found = new Set<string>();
  for (const sample of samples) {
    for (const [key, value] of Object.entries(sample.values)) {
      if (/^p(st|lt)/i.test(key) && typeof value === "number" && Number.isFinite(value)) found.add(key);
    }
  }
  // Pst trước Plt, rồi theo tên (Psta, Pstb, Pstc...).
  return [...found].sort((a, b) => a.slice(0, 3).toLowerCase().localeCompare(b.slice(0, 3).toLowerCase()) * -1 || a.localeCompare(b));
}

const FLICKER_COLORS = ["#5470c6", "#91cc75", "#fac858", "#ee6666", "#73c0de", "#3ba272", "#fc8452", "#9a60b4"];

function PstTrend({
  keys,
  samples,
  onRefresh,
}: {
  keys: string[];
  samples: ProjectGatewaySample[];
  onRefresh?: () => void;
}) {
  const series = useMemo<TrendSeriesConfig[]>(
    () =>
      keys.map((key, index) => ({
        key,
        label: key,
        color: FLICKER_COLORS[index % FLICKER_COLORS.length],
        digits: 3,
      })),
    [keys],
  );
  return (
    <SampleTrendChart
      title="Nháy sáng Pst/Plt theo thời gian thực"
      unitLabel="Chỉ số"
      series={series}
      samples={samples}
      onRefresh={onRefresh}
    />
  );
}
