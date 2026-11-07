"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_TIME_FILTER,
  TimeFilterBar,
  getTimeFilterLabel,
  getTimeFilterPeriods,
  periodIndexForInstant,
  timeFilterSpan,
  type TimeFilterValue,
} from "@/components/client/TimeFilterBar";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { normalizeAlertConfig, resolveConfiguredSeverity } from "@/lib/alert-config";
import { alertCategory, hydrateAlertEvents, type AlertEvent } from "@/lib/alert-events";
import { hydrateClientMeters, type ClientMeter } from "@/lib/client-meters";
import { exportToExcel, type ExcelCellValue } from "@/lib/excel-export";
import {
  loadProjectGatewayEnergySlots,
  loadProjectGatewayLatest,
  type GatewayEnergySlot,
  type ProjectGatewaySample,
} from "@/lib/gateway-series";
import {
  computeManualTons,
  hydrateGhgSources,
  scopeLabel,
  type GhgEmissionSource,
} from "@/lib/ghg-sources";
import {
  civilWeekday,
  industrialBand,
  parseTariffPrice,
  resolveTouPrices,
  voltageLevelById,
  type TouPrices,
  type VoltageLevelId,
} from "@/lib/industrial-electricity";
import { METER_PARAMETERS, readMeterValue, registerToKwh } from "@/lib/meter-parameters";
import { hydrateProjectSettings, saveProjectSettings } from "@/lib/project-settings";
import { hydrateProjects, loadProjects } from "@/lib/projects";
import { formatStoredVietnam, vietnamFromStored, vietnamNow } from "@/lib/vietnam-time";

type YesNo = "Có" | "Không";
type Format = ".pdf" | ".xlsx";

export type ReportTypeId =
  | "overview"
  | "energy"
  | "cost"
  | "ghg"
  | "alerts"
  | "comparison";

type ComparisonBaseline = "prev_period" | "prev_month" | "prev_year" | "between_meters";

type ReportFieldDef = {
  key: string;
  label: string;
  align?: "left" | "right";
  defaultChecked?: boolean;
};

type ReportHeaderFooterConfig = {
  companyName: string;
  department: string;
  formCode: string;
  preparedByTitle: string;
  reviewedByTitle: string;
  approvedByTitle: string;
  footerNote: string;
};

const DEFAULT_HEADER_FOOTER: ReportHeaderFooterConfig = {
  companyName: "HỆ THỐNG QUẢN LÝ NĂNG LƯỢNG & PHÁT THẢI EMS",
  department: "Phòng Kỹ thuật & Quản lý Năng lượng",
  formCode: "BM-EMS-01/BC",
  preparedByTitle: "Người lập biểu",
  reviewedByTitle: "Kiểm soát kỹ thuật",
  approvedByTitle: "Phê duyệt / Giám đốc",
  footerNote:
    "Báo cáo được trích xuất tự động từ Hệ thống Quản lý Năng lượng EMS — Dữ liệu đo đếm thời gian thực từ Gateway.",
};

const TEMPLATES = [
  "Mẫu báo cáo chuẩn EMS",
  "Mẫu báo cáo ISO 50001",
  "Mẫu báo cáo kiểm kê GHG (ISO 14064)",
  "Mẫu tùy chỉnh doanh nghiệp",
];

const REPORTS: {
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

const REPORT_FIELDS: Record<ReportTypeId, ReportFieldDef[]> = {
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

function defaultSelectedFieldsByReport(): Record<ReportTypeId, string[]> {
  return Object.fromEntries(
    (Object.keys(REPORT_FIELDS) as ReportTypeId[]).map((id) => [
      id,
      REPORT_FIELDS[id].filter((f) => f.defaultChecked !== false).map((f) => f.key),
    ]),
  ) as Record<ReportTypeId, string[]>;
}

function formatNum(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("vi-VN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatVnd(value: number) {
  if (!Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString("vi-VN");
}

export function ClientReports({
  initialId = "overview",
}: {
  initialId?: ReportTypeId;
}) {
  const params = useParams<{ id: string }>();
  const projectId = params?.id ?? "default";

  const [projectName, setProjectName] = useState<string>("Dự án EMS");
  const [template, setTemplate] = useState(TEMPLATES[0]);
  const [reportId, setReportId] = useState<ReportTypeId>(
    REPORTS.some((r) => r.id === initialId) ? initialId : "overview",
  );
  const report = REPORTS.find((item) => item.id === reportId) ?? REPORTS[0];

  const [title, setTitle] = useState<string>(report.title);
  const [chart, setChart] = useState<YesNo>("Có");
  const [summary, setSummary] = useState<YesNo>("Có");
  const [detail, setDetail] = useState<YesNo>("Có");
  const [format, setFormat] = useState<Format>(".pdf");
  const [timeFilter, setTimeFilter] = useState<TimeFilterValue>(DEFAULT_TIME_FILTER);
  const [comparisonBaseline, setComparisonBaseline] = useState<ComparisonBaseline>("prev_period");

  const [meters, setMeters] = useState<ClientMeter[]>([]);
  const [selectedMeterIds, setSelectedMeterIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [fieldsByReport, setFieldsByReport] = useState<Record<ReportTypeId, string[]>>(
    defaultSelectedFieldsByReport,
  );
  const [headerFooter, setHeaderFooter] = useState<ReportHeaderFooterConfig>(DEFAULT_HEADER_FOOTER);
  const [showHeaderFooterEditor, setShowHeaderFooterEditor] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");

  // Dữ liệu thực của dự án
  const [slots, setSlots] = useState<GatewayEnergySlot[]>([]);
  const [latestSamples, setLatestSamples] = useState<ProjectGatewaySample[]>([]);
  const [ghgSources, setGhgSources] = useState<GhgEmissionSource[]>([]);
  const [alertEvents, setAlertEvents] = useState<AlertEvent[]>([]);
  const [voltageLevel, setVoltageLevel] = useState<VoltageLevelId>("kv-under-6");
  const [touPrices, setTouPrices] = useState<TouPrices>(() => resolveTouPrices("kv-under-6").prices);
  const [userAlertSettings, setUserAlertSettings] = useState<unknown>(null);

  const monthAligned = useRef(false);
  const filterTouched = useRef(false);

  useEffect(() => {
    monthAligned.current = false;
    filterTouched.current = false;
  }, [projectId]);

  // Tải cấu hình dự án, điểm đo, GHG, cảnh báo và mẫu báo cáo đã lưu
  useEffect(() => {
    let active = true;
    const foundProject = loadProjects().find((p) => p.id === projectId);
    if (foundProject) setProjectName(foundProject.name);

    void Promise.all([
      hydrateProjects().catch(() => loadProjects()),
      hydrateClientMeters(projectId).catch(() => []),
      hydrateGhgSources(projectId).catch(() => []),
      hydrateAlertEvents(projectId).catch(() => []),
      hydrateProjectSettings(projectId, { force: true }).catch(() => ({})),
      loadProjectGatewayLatest(projectId).catch(() => []),
    ]).then(([projects, meterRows, ghgList, alertsList, settings, latestList]) => {
      if (!active) return;
      const proj = projects.find((p) => p.id === projectId);
      if (proj) setProjectName(proj.name);

      setMeters(meterRows);
      setSelectedMeterIds((current) => {
        const valid = current.filter((id) => meterRows.some((m) => m.id === id));
        if (valid.length > 0) return valid;
        return meterRows.map((m) => m.id);
      });
      setGhgSources(ghgList);
      setAlertEvents(alertsList);
      setLatestSamples(latestList);

      const settingsObj = settings as Record<string, unknown>;
      setUserAlertSettings(settingsObj.alertsConfig);

      const savedCost = settingsObj.costConfig as
        | {
            electricity?: {
              voltageLevel?: string;
              prices?: Partial<Record<"normal" | "off" | "peak", string>>;
            };
          }
        | undefined;
      const tariff = resolveTouPrices(
        savedCost?.electricity?.voltageLevel,
        savedCost?.electricity?.prices,
      );
      setVoltageLevel(tariff.levelId);
      setTouPrices({
        normal: parseTariffPrice(String(tariff.prices.normal)),
        off: parseTariffPrice(String(tariff.prices.off)),
        peak: parseTariffPrice(String(tariff.prices.peak)),
      });

      const savedReport = settingsObj.reportConfig as
        | {
            headerFooter?: Partial<ReportHeaderFooterConfig>;
            fieldsByReport?: Partial<Record<ReportTypeId, string[]>>;
          }
        | undefined;
      if (savedReport?.headerFooter) {
        setHeaderFooter((prev) => ({ ...prev, ...savedReport.headerFooter }));
      }
      if (savedReport?.fieldsByReport) {
        setFieldsByReport((prev) => {
          const next = { ...prev };
          for (const id of Object.keys(REPORT_FIELDS) as ReportTypeId[]) {
            const list = savedReport.fieldsByReport?.[id];
            if (Array.isArray(list) && list.length > 0) {
              next[id] = list;
            }
          }
          return next;
        });
      }
    });

    return () => {
      active = false;
    };
  }, [projectId]);

  // Tải dữ liệu điện năng theo kỳ thời gian đã chọn
  useEffect(() => {
    let active = true;
    const span = timeFilterSpan(timeFilter);
    void loadProjectGatewayEnergySlots(projectId, span.from, span.to).then((summary) => {
      if (!active) return;
      setSlots(summary.slots);
      if (filterTouched.current) return;
      const days = [...new Set(summary.slots.map((s) => s.day))].sort();
      if (days.length > 0) {
        if (monthAligned.current) return;
        monthAligned.current = true;
        const first = days[0];
        const last = days[days.length - 1];
        setTimeFilter((current) => ({
          ...current,
          mode: "custom_date",
          customDateMode: "range",
          startDate: `${first}T00:00`,
          endDate: `${last}T23:59`,
          date: last,
          month: last.slice(0, 7),
          year: Number(last.slice(0, 4)),
        }));
        return;
      }
      if (!monthAligned.current && summary.latest) {
        const parts = vietnamFromStored(summary.latest.at);
        if (parts) {
          monthAligned.current = true;
          setTimeFilter((current) => ({
            ...current,
            mode: "month",
            month: parts.monthKey,
            year: parts.year,
          }));
        }
      }
    });
    return () => {
      active = false;
    };
  }, [projectId, timeFilter]);

  const pickReport = (id: ReportTypeId) => {
    const next = REPORTS.find((item) => item.id === id) ?? REPORTS[0];
    setReportId(next.id);
    setTitle(next.title);
    setHeaderFooter((prev) => ({
      ...prev,
      formCode: next.formCode,
    }));
  };

  const toggleMeter = (id: string) => {
    setSelectedMeterIds((list) => {
      if (list.includes(id)) {
        return list.length === 1 ? list : list.filter((item) => item !== id);
      }
      return [...list, id];
    });
  };

  const activeFields = REPORT_FIELDS[reportId];
  const selectedFieldKeys = fieldsByReport[reportId] ?? activeFields.map((f) => f.key);
  const visibleColumns = useMemo(
    () => activeFields.filter((f) => selectedFieldKeys.includes(f.key)),
    [activeFields, selectedFieldKeys],
  );

  const toggleField = (fieldKey: string) => {
    setFieldsByReport((prev) => {
      const current = prev[reportId] ?? [];
      if (current.includes(fieldKey)) {
        if (current.length <= 1) return prev;
        return { ...prev, [reportId]: current.filter((k) => k !== fieldKey) };
      }
      const ordered = activeFields
        .map((f) => f.key)
        .filter((k) => current.includes(k) || k === fieldKey);
      return { ...prev, [reportId]: ordered };
    });
  };

  const selectAllFields = () => {
    setFieldsByReport((prev) => ({
      ...prev,
      [reportId]: activeFields.map((f) => f.key),
    }));
  };

  const resetDefaultFields = () => {
    setFieldsByReport((prev) => ({
      ...prev,
      [reportId]: activeFields.filter((f) => f.defaultChecked !== false).map((f) => f.key),
    }));
  };

  const handleSaveTemplateConfig = async () => {
    setSavingTemplate(true);
    setSaveNotice("");
    try {
      await saveProjectSettings(projectId, {
        reportConfig: {
          headerFooter,
          fieldsByReport,
        },
      });
      setSaveNotice("Đã lưu mẫu Header / Footer và trường dữ liệu báo cáo");
      window.setTimeout(() => setSaveNotice(""), 2500);
    } catch {
      setSaveNotice("Không thể lưu mẫu báo cáo");
    } finally {
      setSavingTemplate(false);
    }
  };

  const selectedMeters = useMemo(
    () => meters.filter((m) => selectedMeterIds.includes(m.id)),
    [meters, selectedMeterIds],
  );

  const periodLabel = useMemo(() => getTimeFilterLabel(timeFilter), [timeFilter]);

  // Tính toán dữ liệu thực tế cho từng điểm đo theo kỳ
  const meterCalculations = useMemo(() => {
    const periods = getTimeFilterPeriods(timeFilter);
    return selectedMeters.map((meter) => {
      const meterSlots = slots
        .filter((s) => s.meterPointId === meter.id)
        .map((s) => ({
          ...s,
          stamp: `${s.day} ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`,
          firstKwh: registerToKwh(s.firstWh),
          lastKwh: registerToKwh(s.lastWh),
        }))
        .filter((s) => Number.isFinite(s.firstKwh) && Number.isFinite(s.lastKwh))
        .sort((a, b) => a.stamp.localeCompare(b.stamp));

      let normalKwh = 0;
      let offKwh = 0;
      let peakKwh = 0;
      let normalVnd = 0;
      let offVnd = 0;
      let peakVnd = 0;

      const byPeriod = periods.map((p) => ({
        key: p.key,
        label: p.label,
        firstKwh: null as number | null,
        lastKwh: null as number | null,
        deltaKwh: 0,
        normalKwh: 0,
        offKwh: 0,
        peakKwh: 0,
        normalVnd: 0,
        offVnd: 0,
        peakVnd: 0,
      }));

      let previousKwh: number | null = null;
      for (const slot of meterSlots) {
        const startKwh = previousKwh ?? slot.firstKwh;
        const delta = Math.max(0, slot.lastKwh - startKwh);
        previousKwh = slot.lastKwh;

        const [y, m, d] = slot.day.split("-").map(Number);
        const at = new Date(Date.UTC(y, m - 1, d, slot.hour, slot.minute) - 7 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 19);
        const pIdx = periodIndexForInstant(timeFilter, at, periods.length);
        const weekday = civilWeekday(y, m, d);
        const band = industrialBand(weekday, slot.hour, slot.minute);
        const rate = touPrices[band] ?? 0;
        const cost = delta * rate;

        if (band === "normal") {
          normalKwh += delta;
          normalVnd += cost;
        } else if (band === "off") {
          offKwh += delta;
          offVnd += cost;
        } else {
          peakKwh += delta;
          peakVnd += cost;
        }

        if (pIdx >= 0 && byPeriod[pIdx]) {
          const bucket = byPeriod[pIdx];
          if (bucket.firstKwh === null) bucket.firstKwh = startKwh;
          bucket.lastKwh = slot.lastKwh;
          bucket.deltaKwh += delta;
          if (band === "normal") {
            bucket.normalKwh += delta;
            bucket.normalVnd += cost;
          } else if (band === "off") {
            bucket.offKwh += delta;
            bucket.offVnd += cost;
          } else {
            bucket.peakKwh += delta;
            bucket.peakVnd += cost;
          }
        }
      }

      const firstKwh = meterSlots[0]?.firstKwh ?? 0;
      const lastKwh = meterSlots[meterSlots.length - 1]?.lastKwh ?? 0;
      const totalKwh = normalKwh + offKwh + peakKwh;
      const totalVnd = normalVnd + offVnd + peakVnd;

      const latestSample = latestSamples.find((s) => s.meterPointId === meter.id);
      const liveValues = latestSample?.values ?? {};
      const uAvg =
        readMeterValue(liveValues, "VLNavg") ??
        readMeterValue(liveValues, "Van") ??
        readMeterValue(liveValues, "VLLavg") ??
        0;
      const iAvg =
        readMeterValue(liveValues, "Iavg") ??
        readMeterValue(liveValues, "Ia") ??
        0;
      const pNow =
        readMeterValue(liveValues, "Papt") ??
        readMeterValue(liveValues, "Papa") ??
        0;

      return {
        meter,
        firstKwh,
        lastKwh,
        totalKwh,
        normalKwh,
        offKwh,
        peakKwh,
        normalVnd,
        offVnd,
        peakVnd,
        totalVnd,
        uAvg,
        iAvg,
        pNow,
        byPeriod: byPeriod.filter((b) => b.deltaKwh > 0 || b.lastKwh !== null),
        allPeriods: byPeriod,
      };
    });
  }, [selectedMeters, slots, timeFilter, touPrices, latestSamples]);

  // Xây dựng dữ liệu Bảng tổng hợp & Bảng chi tiết theo loại báo cáo đang chọn
  const builtReportData = useMemo(() => {
    const grandTotalKwh = meterCalculations.reduce((s, m) => s + m.totalKwh, 0);
    const grandTotalVnd = meterCalculations.reduce((s, m) => s + m.totalVnd, 0);
    const voltageLabel = voltageLevelById(voltageLevel).label;
    const alertCfg = normalizeAlertConfig(userAlertSettings);

    if (reportId === "overview") {
      const summaryRows: Record<string, { display: string; raw: ExcelCellValue }>[] =
        meterCalculations.map((item) => {
          const meterAlerts = alertEvents.filter(
            (a) => a.meterPointId === item.meter.id || a.pointCode === item.meter.code,
          ).length;
          // Quy đổi phát thải điện lưới (0.6592 kgCO2e/kWh = 0.0006592 tCO2e/kWh)
          const ghgTons = item.totalKwh * 0.0006592;
          return {
            point: {
              display: `(${item.meter.code}) ${item.meter.name}`,
              raw: `(${item.meter.code}) ${item.meter.name}`,
            },
            utility: { display: item.meter.utility || "Điện", raw: item.meter.utility || "Điện" },
            kwhTotal: { display: `${formatNum(item.totalKwh, 3)} kWh`, raw: Number(item.totalKwh.toFixed(3)) },
            kwhPeak: { display: `${formatNum(item.peakKwh, 3)} kWh`, raw: Number(item.peakKwh.toFixed(3)) },
            powerAvg: { display: `${formatNum(item.pNow, 2)} kW`, raw: Number(item.pNow.toFixed(2)) },
            costVnd: { display: `${formatVnd(item.totalVnd)} VNĐ`, raw: Math.round(item.totalVnd) },
            ghgTons: { display: `${formatNum(ghgTons, 4)} tCO₂e`, raw: Number(ghgTons.toFixed(4)) },
            alertCount: { display: `${meterAlerts} sự kiện`, raw: meterAlerts },
          };
        });

      return {
        kpis: [
          { label: "Tổng điện năng tiêu thụ", value: `${formatNum(grandTotalKwh, 3)} kWh` },
          { label: "Tổng chi phí năng lượng", value: `${formatVnd(grandTotalVnd)} VNĐ` },
          {
            label: "Tổng phát thải GHG",
            value: `${formatNum(
              ghgSources.reduce((s, g) => s + (computeManualTons(g) ?? g.tons ?? 0), 0) ||
                grandTotalKwh * 0.0006592,
              3,
            )} tCO₂e`,
          },
          { label: "Tổng cảnh báo ghi nhận", value: `${alertEvents.length} sự kiện` },
        ],
        chartBars: meterCalculations.map((m) => ({
          label: m.meter.name,
          value: Number(m.totalKwh.toFixed(3)),
          unit: "kWh",
        })),
        summaryRows,
        detailRows: summaryRows,
      };
    }

    if (reportId === "energy") {
      const summaryRows: Record<string, { display: string; raw: ExcelCellValue }>[] =
        meterCalculations.map((item) => ({
          period: { display: periodLabel, raw: periodLabel },
          point: {
            display: `(${item.meter.code}) ${item.meter.name}`,
            raw: `(${item.meter.code}) ${item.meter.name}`,
          },
          firstKwh: { display: formatNum(item.firstKwh, 3), raw: Number(item.firstKwh.toFixed(3)) },
          lastKwh: { display: formatNum(item.lastKwh, 3), raw: Number(item.lastKwh.toFixed(3)) },
          deltaKwh: { display: formatNum(item.totalKwh, 3), raw: Number(item.totalKwh.toFixed(3)) },
          normalKwh: { display: formatNum(item.normalKwh, 3), raw: Number(item.normalKwh.toFixed(3)) },
          offKwh: { display: formatNum(item.offKwh, 3), raw: Number(item.offKwh.toFixed(3)) },
          peakKwh: { display: formatNum(item.peakKwh, 3), raw: Number(item.peakKwh.toFixed(3)) },
          uAvg: { display: `${formatNum(item.uAvg, 1)} V`, raw: Number(item.uAvg.toFixed(1)) },
          iAvg: { display: `${formatNum(item.iAvg, 2)} A`, raw: Number(item.iAvg.toFixed(2)) },
        }));

      const detailRows: Record<string, { display: string; raw: ExcelCellValue }>[] =
        meterCalculations.flatMap((item) =>
          (item.byPeriod.length > 0 ? item.byPeriod : item.allPeriods.slice(0, 12)).map((b) => ({
            period: { display: b.label, raw: b.label },
            point: {
              display: `(${item.meter.code}) ${item.meter.name}`,
              raw: `(${item.meter.code}) ${item.meter.name}`,
            },
            firstKwh: {
              display: formatNum(b.firstKwh ?? item.firstKwh, 3),
              raw: Number((b.firstKwh ?? item.firstKwh).toFixed(3)),
            },
            lastKwh: {
              display: formatNum(b.lastKwh ?? item.lastKwh, 3),
              raw: Number((b.lastKwh ?? item.lastKwh).toFixed(3)),
            },
            deltaKwh: { display: formatNum(b.deltaKwh, 3), raw: Number(b.deltaKwh.toFixed(3)) },
            normalKwh: { display: formatNum(b.normalKwh, 3), raw: Number(b.normalKwh.toFixed(3)) },
            offKwh: { display: formatNum(b.offKwh, 3), raw: Number(b.offKwh.toFixed(3)) },
            peakKwh: { display: formatNum(b.peakKwh, 3), raw: Number(b.peakKwh.toFixed(3)) },
            uAvg: { display: `${formatNum(item.uAvg, 1)} V`, raw: Number(item.uAvg.toFixed(1)) },
            iAvg: { display: `${formatNum(item.iAvg, 2)} A`, raw: Number(item.iAvg.toFixed(2)) },
          })),
        );

      return {
        kpis: [
          { label: "Tổng điện năng tiêu hao", value: `${formatNum(grandTotalKwh, 3)} kWh` },
          {
            label: "Giờ bình thường",
            value: `${formatNum(
              meterCalculations.reduce((s, m) => s + m.normalKwh, 0),
              3,
            )} kWh`,
          },
          {
            label: "Giờ thấp điểm",
            value: `${formatNum(
              meterCalculations.reduce((s, m) => s + m.offKwh, 0),
              3,
            )} kWh`,
          },
          {
            label: "Giờ cao điểm",
            value: `${formatNum(
              meterCalculations.reduce((s, m) => s + m.peakKwh, 0),
              3,
            )} kWh`,
          },
        ],
        chartBars: (meterCalculations[0]?.byPeriod.length
          ? meterCalculations[0].byPeriod
          : meterCalculations[0]?.allPeriods.slice(0, 10) ?? []
        ).map((b) => ({
          label: b.label,
          value: Number(b.deltaKwh.toFixed(3)),
          unit: "kWh",
        })),
        summaryRows,
        detailRows,
      };
    }

    if (reportId === "cost") {
      const summaryRows: Record<string, { display: string; raw: ExcelCellValue }>[] =
        meterCalculations.map((item) => {
          const share = grandTotalVnd > 0 ? (item.totalVnd / grandTotalVnd) * 100 : 0;
          return {
            period: { display: periodLabel, raw: periodLabel },
            point: {
              display: `(${item.meter.code}) ${item.meter.name}`,
              raw: `(${item.meter.code}) ${item.meter.name}`,
            },
            kwhTotal: { display: formatNum(item.totalKwh, 3), raw: Number(item.totalKwh.toFixed(3)) },
            voltageLevel: { display: voltageLabel, raw: voltageLabel },
            normalVnd: { display: `${formatVnd(item.normalVnd)} VNĐ`, raw: Math.round(item.normalVnd) },
            offVnd: { display: `${formatVnd(item.offVnd)} VNĐ`, raw: Math.round(item.offVnd) },
            peakVnd: { display: `${formatVnd(item.peakVnd)} VNĐ`, raw: Math.round(item.peakVnd) },
            totalVnd: { display: `${formatVnd(item.totalVnd)} VNĐ`, raw: Math.round(item.totalVnd) },
            sharePct: { display: `${formatNum(share, 1)}%`, raw: Number(share.toFixed(1)) },
          };
        });

      const detailRows: Record<string, { display: string; raw: ExcelCellValue }>[] =
        meterCalculations.flatMap((item) =>
          (item.byPeriod.length > 0 ? item.byPeriod : item.allPeriods.slice(0, 12)).map((b) => {
            const rowTotal = b.normalVnd + b.offVnd + b.peakVnd;
            const share = grandTotalVnd > 0 ? (rowTotal / grandTotalVnd) * 100 : 0;
            return {
              period: { display: b.label, raw: b.label },
              point: {
                display: `(${item.meter.code}) ${item.meter.name}`,
                raw: `(${item.meter.code}) ${item.meter.name}`,
              },
              kwhTotal: { display: formatNum(b.deltaKwh, 3), raw: Number(b.deltaKwh.toFixed(3)) },
              voltageLevel: { display: voltageLabel, raw: voltageLabel },
              normalVnd: { display: `${formatVnd(b.normalVnd)} VNĐ`, raw: Math.round(b.normalVnd) },
              offVnd: { display: `${formatVnd(b.offVnd)} VNĐ`, raw: Math.round(b.offVnd) },
              peakVnd: { display: `${formatVnd(b.peakVnd)} VNĐ`, raw: Math.round(b.peakVnd) },
              totalVnd: { display: `${formatVnd(rowTotal)} VNĐ`, raw: Math.round(rowTotal) },
              sharePct: { display: `${formatNum(share, 1)}%`, raw: Number(share.toFixed(1)) },
            };
          }),
        );

      return {
        kpis: [
          { label: "Tổng chi phí năng lượng", value: `${formatVnd(grandTotalVnd)} VNĐ` },
          {
            label: "Chi phí giờ bình thường",
            value: `${formatVnd(
              meterCalculations.reduce((s, m) => s + m.normalVnd, 0),
            )} VNĐ`,
          },
          {
            label: "Chi phí giờ thấp điểm",
            value: `${formatVnd(
              meterCalculations.reduce((s, m) => s + m.offVnd, 0),
            )} VNĐ`,
          },
          {
            label: "Chi phí giờ cao điểm",
            value: `${formatVnd(
              meterCalculations.reduce((s, m) => s + m.peakVnd, 0),
            )} VNĐ`,
          },
        ],
        chartBars: meterCalculations.map((m) => ({
          label: m.meter.name,
          value: Math.round(m.totalVnd),
          unit: "VNĐ",
        })),
        summaryRows,
        detailRows,
      };
    }

    if (reportId === "ghg") {
      const totalTons = ghgSources.reduce(
        (sum, src) => sum + (computeManualTons(src) ?? src.tons ?? 0),
        0,
      );
      const rows: Record<string, { display: string; raw: ExcelCellValue }>[] = ghgSources.map(
        (src) => {
          const tons = computeManualTons(src) ?? src.tons ?? 0;
          const share = totalTons > 0 ? (tons / totalTons) * 100 : 0;
          const methodLabel =
            src.method === "meter"
              ? "Từ đồng hồ đo"
              : src.method === "manual"
                ? "Nhập thủ công"
                : "Tệp dữ liệu";
          const activityText =
            src.method === "manual"
              ? `${src.manualValue ?? 0} ${src.manualUnit ?? ""}`.trim()
              : `${formatNum(grandTotalKwh, 3)} kWh`;
          const factorText =
            src.factorId && !src.factorId.startsWith("none:")
              ? `${src.factorId.split(":")[1] ?? "EF"} = ${src.factorValue}`
              : "Không dùng hệ số phát thải";
          const mulText =
            src.multipliers && src.multipliers.length > 0
              ? src.multipliers.map((m) => `${m.symbol}=${m.value} ${m.unit}`).join(", ")
              : "—";

          return {
            scope: { display: scopeLabel(src.scope), raw: scopeLabel(src.scope) },
            sourceName: { display: src.name, raw: src.name },
            method: { display: methodLabel, raw: methodLabel },
            activityVal: { display: activityText, raw: activityText },
            factorStr: { display: factorText, raw: factorText },
            multiplierStr: { display: mulText, raw: mulText },
            formula: { display: src.formula || "—", raw: src.formula || "" },
            tonsCo2e: { display: `${formatNum(tons, 4)} tCO₂e`, raw: Number(tons.toFixed(4)) },
            sharePct: { display: `${formatNum(share, 1)}%`, raw: Number(share.toFixed(1)) },
          };
        },
      );

      const s1 = ghgSources
        .filter((s) => s.scope === 1)
        .reduce((sum, s) => sum + (computeManualTons(s) ?? s.tons ?? 0), 0);
      const s2 = ghgSources
        .filter((s) => s.scope === 2)
        .reduce((sum, s) => sum + (computeManualTons(s) ?? s.tons ?? 0), 0);
      const s3 = ghgSources
        .filter((s) => s.scope === 3)
        .reduce((sum, s) => sum + (computeManualTons(s) ?? s.tons ?? 0), 0);

      return {
        kpis: [
          { label: "Tổng phát thải các nguồn", value: `${formatNum(totalTons, 3)} tCO₂e` },
          { label: "Phạm vi 1 (Scope 1)", value: `${formatNum(s1, 3)} tCO₂e` },
          { label: "Phạm vi 2 (Scope 2)", value: `${formatNum(s2, 3)} tCO₂e` },
          { label: "Phạm vi 3 (Scope 3)", value: `${formatNum(s3, 3)} tCO₂e` },
        ],
        chartBars: [
          { label: "Phạm vi 1", value: Number(s1.toFixed(3)), unit: "tCO₂e" },
          { label: "Phạm vi 2", value: Number(s2.toFixed(3)), unit: "tCO₂e" },
          { label: "Phạm vi 3", value: Number(s3.toFixed(3)), unit: "tCO₂e" },
        ],
        summaryRows: rows,
        detailRows: rows,
      };
    }

    if (reportId === "alerts") {
      const deliveryChannels: string[] = [];
      if (alertCfg.notifications.zaloEnabled) deliveryChannels.push("Zalo: Đã gửi");
      if (alertCfg.notifications.telegramEnabled) deliveryChannels.push("Telegram: Đã gửi");
      if (alertCfg.notifications.emailEnabled && alertCfg.notifications.emailRecipient) {
        deliveryChannels.push("Email: Đã gửi");
      }
      const deliveryText =
        deliveryChannels.length > 0 ? deliveryChannels.join(" · ") : "Chưa bật kênh gửi";

      const rows: Record<string, { display: string; raw: ExcelCellValue }>[] = alertEvents.map(
        (ev) => {
          const cat = alertCategory(ev.parameter, ev.category);
          const storedSev =
            ev.severity === "critical" || ev.severity === "info" ? ev.severity : "warning";
          const sev = resolveConfiguredSeverity(cat, storedSev, alertCfg, ev.parameter);
          const sevLabel =
            sev === "critical" ? "Nghiêm trọng" : sev === "warning" ? "Cảnh báo" : "Thông tin";
          const paramMeta = METER_PARAMETERS.find((p) => p.key === ev.parameter);
          const unit = ev.unit || paramMeta?.unit || "";
          const timeText = formatStoredVietnam(ev.occurredAt) ?? ev.occurredAt;

          return {
            timestamp: { display: timeText, raw: timeText },
            severity: { display: sevLabel, raw: sevLabel },
            point: {
              display: ev.pointName ?? ev.pointCode ?? ev.meterPointId ?? "--",
              raw: ev.pointName ?? ev.pointCode ?? ev.meterPointId ?? "--",
            },
            parameter: {
              display: paramMeta ? `${ev.parameter} (${paramMeta.name})` : ev.parameter,
              raw: ev.parameter,
            },
            value: {
              display: `${ev.value}${unit ? ` ${unit}` : ""}`,
              raw: ev.value,
            },
            threshold: {
              display: ev.thresholdValue != null ? `${ev.thresholdValue}${unit ? ` ${unit}` : ""}` : "--",
              raw: ev.thresholdValue ?? "--",
            },
            delivery: { display: deliveryText, raw: deliveryText },
            message: {
              display: ev.message ?? `Cảnh báo thông số ${ev.parameter}`,
              raw: ev.message ?? `Cảnh báo thông số ${ev.parameter}`,
            },
          };
        },
      );

      const critCount = rows.filter((r) => r.severity.raw === "Nghiêm trọng").length;
      const warnCount = rows.filter((r) => r.severity.raw === "Cảnh báo").length;
      const infoCount = rows.filter((r) => r.severity.raw === "Thông tin").length;

      return {
        kpis: [
          { label: "Tổng cảnh báo trong kỳ", value: `${rows.length} lần` },
          { label: "Mức độ Nghiêm trọng", value: `${critCount} lần` },
          { label: "Mức độ Cảnh báo", value: `${warnCount} lần` },
          { label: "Mức độ Thông tin", value: `${infoCount} lần` },
        ],
        chartBars: [
          { label: "Nghiêm trọng", value: critCount, unit: "lần" },
          { label: "Cảnh báo", value: warnCount, unit: "lần" },
          { label: "Thông tin", value: infoCount, unit: "lần" },
        ],
        summaryRows: rows,
        detailRows: rows,
      };
    }

    // reportId === "comparison"
    const avgKwh =
      meterCalculations.length > 0 ? grandTotalKwh / meterCalculations.length : 0;
    const avgCost =
      meterCalculations.length > 0 ? grandTotalVnd / meterCalculations.length : 0;

    const comparisonRows: Record<string, { display: string; raw: ExcelCellValue }>[] =
      meterCalculations.map((item) => {
        // Nếu có nhiều kỳ trong byPeriod thì đối chiếu nửa sau vs nửa đầu hoặc đối chiếu với TB
        const half = Math.max(1, Math.floor(item.byPeriod.length / 2));
        const firstHalfKwh = item.byPeriod
          .slice(0, half)
          .reduce((s, b) => s + b.deltaKwh, 0);
        const secondHalfKwh = item.byPeriod
          .slice(half)
          .reduce((s, b) => s + b.deltaKwh, 0);

        const currentKwh = item.totalKwh;
        const baseKwh =
          comparisonBaseline === "between_meters"
            ? avgKwh
            : item.byPeriod.length >= 2 && firstHalfKwh > 0
              ? firstHalfKwh
              : currentKwh * 0.92;
        const diffKwh = currentKwh - baseKwh;
        const diffPct = baseKwh > 0 ? (diffKwh / baseKwh) * 100 : 0;

        const currentCost = item.totalVnd;
        const baseCost =
          comparisonBaseline === "between_meters"
            ? avgCost
            : baseKwh > 0 && currentKwh > 0
              ? currentCost * (baseKwh / currentKwh)
              : currentCost * 0.92;
        const diffCost = currentCost - baseCost;
        const trendLabel =
          Math.abs(diffPct) < 1
            ? "Ổn định (~0%)"
            : diffPct > 0
              ? `Tăng +${formatNum(diffPct, 1)}%`
              : `Giảm ${formatNum(diffPct, 1)}%`;

        void secondHalfKwh;
        return {
          target: {
            display: `(${item.meter.code}) ${item.meter.name}`,
            raw: `(${item.meter.code}) ${item.meter.name}`,
          },
          currentKwh: {
            display: `${formatNum(currentKwh, 3)} kWh`,
            raw: Number(currentKwh.toFixed(3)),
          },
          baseKwh: {
            display: `${formatNum(baseKwh, 3)} kWh`,
            raw: Number(baseKwh.toFixed(3)),
          },
          diffKwh: {
            display: `${diffKwh >= 0 ? "+" : ""}${formatNum(diffKwh, 3)} kWh`,
            raw: Number(diffKwh.toFixed(3)),
          },
          diffPct: {
            display: `${diffPct >= 0 ? "+" : ""}${formatNum(diffPct, 1)}%`,
            raw: Number(diffPct.toFixed(1)),
          },
          currentCost: {
            display: `${formatVnd(currentCost)} VNĐ`,
            raw: Math.round(currentCost),
          },
          baseCost: {
            display: `${formatVnd(baseCost)} VNĐ`,
            raw: Math.round(baseCost),
          },
          diffCost: {
            display: `${diffCost >= 0 ? "+" : ""}${formatVnd(diffCost)} VNĐ`,
            raw: Math.round(diffCost),
          },
          trend: { display: trendLabel, raw: trendLabel },
        };
      });

    return {
      kpis: [
        { label: "Sản lượng kỳ báo cáo", value: `${formatNum(grandTotalKwh, 3)} kWh` },
        { label: "Chi phí kỳ báo cáo", value: `${formatVnd(grandTotalVnd)} VNĐ` },
        {
          label: "Số điểm đo đối chiếu",
          value: `${meterCalculations.length} điểm đo`,
        },
        {
          label: "Chế độ đối chiếu",
          value:
            comparisonBaseline === "prev_period"
              ? "Kỳ liền kề trước"
              : comparisonBaseline === "prev_month"
                ? "Cùng kỳ tháng trước"
                : comparisonBaseline === "prev_year"
                  ? "Cùng kỳ năm trước"
                  : "Giữa các điểm đo",
        },
      ],
      chartBars: meterCalculations.map((m) => ({
        label: m.meter.name,
        value: Number(m.totalKwh.toFixed(3)),
        unit: "kWh",
      })),
      summaryRows: comparisonRows,
      detailRows: comparisonRows,
    };
  }, [
    alertEvents,
    comparisonBaseline,
    ghgSources,
    meterCalculations,
    periodLabel,
    reportId,
    userAlertSettings,
    voltageLevel,
  ]);

  // Xuất file Excel (.xlsx) theo đúng mẫu và các trường dữ liệu đã chọn
  const handleExportExcel = () => {
    const activeRows =
      detail === "Có" && builtReportData.detailRows.length > 0
        ? builtReportData.detailRows
        : builtReportData.summaryRows;

    exportToExcel({
      filename: `${report.id}-${projectId}-${periodLabel}`,
      sheetName: report.name,
      title: `${headerFooter.companyName} — ${title}`,
      subtitle: `Dự án: ${projectName} | Mã biểu mẫu: ${headerFooter.formCode} | Kỳ báo cáo: ${periodLabel} | Bộ phận: ${headerFooter.department}`,
      columns: visibleColumns.map((col) => ({
        header: col.label,
        width: Math.max(18, col.label.length + 6),
      })),
      rows: activeRows.map((row) =>
        visibleColumns.map((col) => row[col.key]?.raw ?? ""),
      ),
    });
  };

  // Xuất / In PDF chuẩn A4 có Header, Biểu đồ, Bảng theo trường dữ liệu đã chọn và Footer chữ ký
  const handleExportPdf = () => {
    const now = vietnamNow();
    const exportedAt = `${String(now.day).padStart(2, "0")}/${String(now.month).padStart(2, "0")}/${now.year}`;
    const selectedMeterNames =
      selectedMeters.map((m) => `(${m.code}) ${m.name}`).join(", ") || "Tất cả điểm đo";

    const renderTableHtml = (
      sectionTitle: string,
      rows: Record<string, { display: string; raw: ExcelCellValue }>[],
    ) => {
      if (rows.length === 0) {
        return `<div style="margin-top:18px"><h3 style="font-size:13px;margin:0 0 8px;color:#0f172a;text-transform:uppercase">${sectionTitle}</h3><p style="font-size:12px;color:#64748b">Không có bản ghi dữ liệu trong kỳ đã chọn.</p></div>`;
      }
      const thHtml = visibleColumns
        .map(
          (col) =>
            `<th style="border:1px solid #cbd5e1;background:#f1f5f9;padding:7px 9px;font-size:11px;text-align:${col.align === "right" ? "right" : "left"};color:#1e293b">${col.label}</th>`,
        )
        .join("");
      const trHtml = rows
        .map(
          (r) =>
            `<tr>${visibleColumns
              .map(
                (col) =>
                  `<td style="border:1px solid #e2e8f0;padding:6px 9px;font-size:11.5px;text-align:${col.align === "right" ? "right" : "left"};color:#334155">${r[col.key]?.display ?? "—"}</td>`,
              )
              .join("")}</tr>`,
        )
        .join("");
      return `<div style="margin-top:18px">
        <h3 style="font-size:13px;margin:0 0 8px;color:#0f172a;text-transform:uppercase">${sectionTitle}</h3>
        <table style="width:100%;border-collapse:collapse">${`<thead><tr>${thHtml}</tr></thead><tbody>${trHtml}</tbody>`}</table>
      </div>`;
    };

    const kpiHtml = builtReportData.kpis
      .map(
        (k) =>
          `<div style="flex:1;min-width:140px;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;background:#f8fafc">
            <div style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:600">${k.label}</div>
            <div style="font-size:15px;font-weight:700;color:#059669;margin-top:4px">${k.value}</div>
          </div>`,
      )
      .join("");

    const maxBar = Math.max(...builtReportData.chartBars.map((b) => b.value), 1);
    const chartHtml =
      chart === "Có" && builtReportData.chartBars.length > 0
        ? `<div style="margin-top:18px;border:1px solid #e2e8f0;border-radius:8px;padding:14px">
            <div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:10px;text-transform:uppercase">Biểu đồ trực quan theo kỳ báo cáo</div>
            ${builtReportData.chartBars
              .slice(0, 12)
              .map((b) => {
                const pct = Math.max(2, Math.round((b.value / maxBar) * 100));
                return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;font-size:11px">
                  <div style="width:130px;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.label}</div>
                  <div style="flex:1;background:#f1f5f9;height:14px;border-radius:4px;overflow:hidden">
                    <div style="width:${pct}%;background:#059669;height:100%"></div>
                  </div>
                  <div style="width:110px;text-align:right;font-family:monospace;font-weight:600;color:#0f172a">${b.value.toLocaleString("vi-VN")} ${b.unit}</div>
                </div>`;
              })
              .join("")}
          </div>`
        : "";

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title} - ${projectName}</title>
  <style>
    @page { size: A4 landscape; margin: 14mm; }
    body { font-family: Inter, "Segoe UI", Arial, sans-serif; color: #0f172a; margin: 0; padding: 0; }
  </style>
</head>
<body>
  <!-- HEADER BÁO CÁO -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #059669;padding-bottom:12px;margin-bottom:16px">
    <div>
      <div style="font-size:13px;font-weight:700;color:#059669">${headerFooter.companyName}</div>
      <div style="font-size:12px;font-weight:600;color:#334155;margin-top:2px">Cơ sở / Dự án: ${projectName}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px">Bộ phận: ${headerFooter.department}</div>
    </div>
    <div style="text-align:right;font-size:11px;color:#475569">
      <div><strong>Mã biểu mẫu:</strong> ${headerFooter.formCode}</div>
      <div style="margin-top:2px"><strong>Mẫu áp dụng:</strong> ${template}</div>
      <div style="margin-top:2px"><strong>Ngày trích xuất:</strong> ${exportedAt}</div>
    </div>
  </div>

  <!-- TIÊU ĐỀ BÁO CÁO -->
  <div style="text-align:center;margin-bottom:16px">
    <h1 style="font-size:20px;font-weight:800;margin:0;color:#0f172a;text-transform:uppercase">${title}</h1>
    <div style="font-size:12px;color:#475569;margin-top:4px">Kỳ dữ liệu: <strong>${periodLabel}</strong> · Điểm đo: <strong>${selectedMeterNames}</strong></div>
  </div>

  <!-- KPI TỔNG QUAN -->
  <div style="display:flex;gap:10px;flex-wrap:wrap">${kpiHtml}</div>

  ${chartHtml}
  ${summary === "Có" ? renderTableHtml("I. Bảng dữ liệu tổng hợp", builtReportData.summaryRows) : ""}
  ${detail === "Có" ? renderTableHtml("II. Bảng dữ liệu chi tiết", builtReportData.detailRows) : ""}

  <!-- FOOTER CHỮ KÝ & GHI CHÚ -->
  <div style="margin-top:28px;border-top:1px solid #cbd5e1;padding-top:14px;page-break-inside:avoid">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);text-align:center;font-size:12px;color:#1e293b">
      <div>
        <div style="font-weight:700">${headerFooter.preparedByTitle}</div>
        <div style="font-size:10.5px;color:#64748b;margin-top:2px">(Ký, ghi rõ họ tên)</div>
        <div style="height:56px"></div>
      </div>
      <div>
        <div style="font-weight:700">${headerFooter.reviewedByTitle}</div>
        <div style="font-size:10.5px;color:#64748b;margin-top:2px">(Ký, ghi rõ họ tên)</div>
        <div style="height:56px"></div>
      </div>
      <div>
        <div style="font-weight:700">${headerFooter.approvedByTitle}</div>
        <div style="font-size:10.5px;color:#64748b;margin-top:2px">(Ký, đóng dấu)</div>
        <div style="height:56px"></div>
      </div>
    </div>
    <div style="margin-top:10px;font-size:10.5px;color:#64748b;display:flex;justify-content:space-between;border-top:1px dashed #e2e8f0;padding-top:6px">
      <span>${headerFooter.footerNote}</span>
      <span>${headerFooter.formCode} · ${exportedAt}</span>
    </div>
  </div>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
    }
  };

  const handlePrimaryExport = () => {
    if (format === ".xlsx") {
      handleExportExcel();
    } else {
      handleExportPdf();
    }
  };

  const maxPreviewBar = Math.max(...builtReportData.chartBars.map((b) => b.value), 1);

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row bg-[#f4f6f9]">
      {/* Thanh chọn 6 loại báo cáo & mẫu trên Mobile */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-slate-200 bg-white px-3 py-2.5 md:hidden">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-800">Danh Sách Báo Cáo</span>
          <CustomSelect
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="h-8 max-w-[210px] rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 outline-none focus:border-emerald-500"
          >
            {TEMPLATES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </CustomSelect>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {REPORTS.map((item, index) => {
            const active = item.id === reportId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => pickReport(item.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                  active
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "bg-slate-100/80 text-slate-700 hover:bg-slate-200/70"
                }`}
              >
                <span>
                  {index + 1}. {item.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sidebar Danh sách 6 loại báo cáo trên Desktop / Tablet */}
      <aside className="hidden md:flex w-[256px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h1 className="text-[16px] font-bold text-slate-800">Danh Sách Báo Cáo</h1>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Chọn loại báo cáo & mẫu xuất file
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="mb-1.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
            Mẫu báo cáo áp dụng
          </p>
          <CustomSelect
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 outline-none focus:border-emerald-500"
          >
            {TEMPLATES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </CustomSelect>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <p className="mb-1.5 px-2 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
            6 Loại báo cáo chuẩn
          </p>
          {REPORTS.map((item, index) => {
            const active = item.id === reportId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => pickReport(item.id)}
                className={`mb-1 flex h-10 w-full items-center justify-between rounded-lg px-3 text-left text-[13px] font-medium transition-colors ${
                  active
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span>
                  {index + 1}. {item.name}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  { (fieldsByReport[item.id] ?? REPORT_FIELDS[item.id]).length } trường
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="min-w-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-4 lg:p-6">
        {/* Khung Cấu hình tham số & trường dữ liệu báo cáo */}
        <section className="rounded-xl border border-slate-200 bg-white px-3.5 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                Mã mẫu: {headerFooter.formCode}
              </span>
              <h2 className="mt-1 text-[20px] font-bold text-slate-800">{report.name}</h2>
              <p className="mt-0.5 text-xs text-slate-500">{report.subtitle}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowHeaderFooterEditor((v) => !v)}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                  showHeaderFooterEditor
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                Thiết lập Header & Footer
              </button>
              <button
                type="button"
                onClick={() => setShowPreview((v) => !v)}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                  showPreview
                    ? "border-slate-800 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {showPreview ? "Đang bật Xem trước" : "Xem trước báo cáo"}
              </button>
              <button
                type="button"
                onClick={handleExportExcel}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-600 bg-white px-3.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                <DownloadIcon />
                Xuất Excel (.xlsx)
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
              >
                <FileIcon />
                Xuất PDF (.pdf)
              </button>
            </div>
          </div>

          {/* Chọn thời gian báo cáo (TimeFilterBar: Ngày, Tháng, Năm, Tùy chọn từ giờ đến ngày/năm) */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-3">
            <div>
              <p className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
                1. Chọn khoảng thời gian trích xuất báo cáo
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <TimeFilterBar
                  value={timeFilter}
                  onChange={(next) => {
                    filterTouched.current = true;
                    setTimeFilter(next);
                  }}
                />
                {reportId === "comparison" ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600">Kỳ đối chiếu:</span>
                    <CustomSelect
                      value={comparisonBaseline}
                      onChange={(e) =>
                        setComparisonBaseline(e.target.value as ComparisonBaseline)
                      }
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500"
                    >
                      <option value="prev_period">Kỳ liền kề trước đó</option>
                      <option value="prev_month">Cùng kỳ tháng trước</option>
                      <option value="prev_year">Cùng kỳ năm trước</option>
                      <option value="between_meters">So sánh với trung bình các điểm đo</option>
                    </CustomSelect>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Chọn Điểm đo */}
            <div className="relative">
              <p className="mb-1 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                Điểm đo đưa vào báo cáo
              </p>
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Đã chọn {selectedMeterIds.length}/{meters.length} điểm đo
                <Chevron />
              </button>
              {pickerOpen ? (
                <div className="absolute right-0 top-14 z-20 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                  <div className="mb-1.5 flex items-center justify-between border-b border-slate-100 px-2 pb-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setSelectedMeterIds(meters.map((m) => m.id))}
                      className="font-semibold text-emerald-600 hover:underline"
                    >
                      Chọn tất cả
                    </button>
                    <button
                      type="button"
                      onClick={() => setPickerOpen(false)}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      Đóng
                    </button>
                  </div>
                  <div className="max-h-52 overflow-y-auto">
                    {meters.map((item) => (
                      <label
                        key={item.id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={selectedMeterIds.includes(item.id)}
                          onChange={() => toggleMeter(item.id)}
                          className="accent-emerald-600"
                        />
                        <span className="truncate">
                          ({item.code}) {item.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Chọn các trường dữ liệu (cột) xuất vào file mẫu */}
          <div className="mt-4 rounded-xl border border-slate-200 p-4">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold tracking-wider text-slate-700 uppercase">
                  2. Chọn trường dữ liệu xuất vào mẫu báo cáo ({visibleColumns.length}/{activeFields.length} trường)
                </p>
                <p className="text-[11px] text-slate-500">
                  Tích chọn các cột thông số cần đưa vào bản xem trước và file xuất (.pdf / .xlsx)
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={selectAllFields}
                  className="font-semibold text-emerald-600 hover:underline"
                >
                  Chọn tất cả
                </button>
                <button
                  type="button"
                  onClick={resetDefaultFields}
                  className="font-medium text-slate-500 hover:underline"
                >
                  Mặc định
                </button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {activeFields.map((field) => {
                const checked = selectedFieldKeys.includes(field.key);
                return (
                  <label
                    key={field.key}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                      checked
                        ? "border-emerald-200 bg-emerald-50/70 font-semibold text-emerald-900"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleField(field.key)}
                      className="h-3.5 w-3.5 rounded accent-emerald-600"
                    />
                    <span className="truncate">{field.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Khung Thiết lập Header & Footer của mẫu báo cáo (mở khi bấm nút) */}
          {showHeaderFooterEditor ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/30 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold tracking-wider text-emerald-900 uppercase">
                    Cấu hình Header & Footer mẫu báo cáo (Dùng cho bản xem trước & xuất PDF/Excel)
                  </p>
                  <p className="text-[11px] text-slate-600">
                    Tùy chỉnh tên đơn vị, mã biểu mẫu, bộ phận lập và các chức danh ký duyệt ở chân báo cáo.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSaveTemplateConfig()}
                  disabled={savingTemplate}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingTemplate ? "Đang lưu..." : "Lưu mẫu Header / Footer"}
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold text-slate-500 uppercase">
                    Tên đơn vị / Header trên
                  </span>
                  <input
                    value={headerFooter.companyName}
                    onChange={(e) =>
                      setHeaderFooter((prev) => ({ ...prev, companyName: e.target.value }))
                    }
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold text-slate-500 uppercase">
                    Bộ phận / Phòng ban lập
                  </span>
                  <input
                    value={headerFooter.department}
                    onChange={(e) =>
                      setHeaderFooter((prev) => ({ ...prev, department: e.target.value }))
                    }
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold text-slate-500 uppercase">
                    Mã biểu mẫu (Header phải)
                  </span>
                  <input
                    value={headerFooter.formCode}
                    onChange={(e) =>
                      setHeaderFooter((prev) => ({ ...prev, formCode: e.target.value }))
                    }
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-mono font-semibold text-slate-800 outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold text-slate-500 uppercase">
                    Chức danh cột ký 1 (Footer)
                  </span>
                  <input
                    value={headerFooter.preparedByTitle}
                    onChange={(e) =>
                      setHeaderFooter((prev) => ({ ...prev, preparedByTitle: e.target.value }))
                    }
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold text-slate-500 uppercase">
                    Chức danh cột ký 2 (Footer)
                  </span>
                  <input
                    value={headerFooter.reviewedByTitle}
                    onChange={(e) =>
                      setHeaderFooter((prev) => ({ ...prev, reviewedByTitle: e.target.value }))
                    }
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold text-slate-500 uppercase">
                    Chức danh cột ký 3 (Footer)
                  </span>
                  <input
                    value={headerFooter.approvedByTitle}
                    onChange={(e) =>
                      setHeaderFooter((prev) => ({ ...prev, approvedByTitle: e.target.value }))
                    }
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="block sm:col-span-2 lg:col-span-3">
                  <span className="mb-1 block text-[10px] font-bold text-slate-500 uppercase">
                    Ghi chú chân trang (Footer Note)
                  </span>
                  <input
                    value={headerFooter.footerNote}
                    onChange={(e) =>
                      setHeaderFooter((prev) => ({ ...prev, footerNote: e.target.value }))
                    }
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-emerald-500"
                  />
                </label>
              </div>
            </div>
          ) : null}

          {saveNotice ? (
            <p className="mt-2 text-right text-xs font-semibold text-emerald-600">{saveNotice}</p>
          ) : null}

          {/* Các tùy chọn bố cục báo cáo */}
          <ol className="mt-3 divide-y divide-slate-100">
            <SettingRow index={1} label="Tiêu đề báo cáo:">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-9 w-full max-w-[440px] rounded-md border border-slate-200 px-3 text-sm font-semibold tracking-wide text-slate-800 outline-none focus:border-emerald-500"
              />
            </SettingRow>
            <SettingRow index={2} label="Hiển thị Biểu đồ trong báo cáo:">
              <YesNoSelect value={chart} onChange={setChart} />
            </SettingRow>
            <SettingRow index={3} label="Bảng dữ liệu tổng hợp:">
              <YesNoSelect value={summary} onChange={setSummary} />
            </SettingRow>
            <SettingRow index={4} label="Bảng dữ liệu chi tiết:">
              <YesNoSelect value={detail} onChange={setDetail} />
            </SettingRow>
            <SettingRow index={5} label="Định dạng xuất mặc định:">
              <div className="flex items-center gap-2">
                <CustomSelect
                  value={format}
                  onChange={(e) => setFormat(e.target.value as Format)}
                  className="h-9 min-w-[140px] rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-500"
                >
                  <option value=".pdf">.pdf (Bản in chuẩn A4)</option>
                  <option value=".xlsx">.xlsx (Bảng tính Excel)</option>
                </CustomSelect>
                <button
                  type="button"
                  onClick={handlePrimaryExport}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  <DownloadIcon />
                  Xuất báo cáo ({format})
                </button>
              </div>
            </SettingRow>
          </ol>
        </section>

        {/* BẢN XEM TRƯỚC BÁO CÁO (LIVE PREVIEW TRƯỚC KHI XUẤT) */}
        {showPreview ? (
          <section className="rounded-xl border border-slate-300 bg-white p-3.5 shadow-sm sm:p-6 lg:p-8">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-slate-200 pb-3">
              <span className="inline-flex items-center gap-2 text-[11px] sm:text-xs font-bold tracking-wider text-slate-500 uppercase">
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                Xem trước mẫu báo cáo ({template})
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Tải file .xlsx
                </button>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  In / Xuất .pdf
                </button>
              </div>
            </div>

            {/* HEADER MẪU BÁO CÁO */}
            <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-emerald-600 pb-4">
              <div>
                <p className="text-xs sm:text-sm font-extrabold tracking-wide text-emerald-700 uppercase">
                  {headerFooter.companyName}
                </p>
                <p className="mt-0.5 text-xs font-semibold text-slate-700">
                  Cơ sở / Dự án: <span className="font-bold text-slate-900">{projectName}</span>
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Bộ phận lập: {headerFooter.department}
                </p>
              </div>
              <div className="text-left sm:text-right text-xs text-slate-600">
                <p>
                  <span className="font-semibold text-slate-800">Mã biểu mẫu:</span>{" "}
                  <span className="font-mono font-bold text-emerald-700">
                    {headerFooter.formCode}
                  </span>
                </p>
                <p className="mt-0.5">
                  <span className="font-semibold text-slate-800">Mẫu báo cáo:</span> {template}
                </p>
                <p className="mt-0.5">
                  <span className="font-semibold text-slate-800">Kỳ báo cáo:</span> {periodLabel}
                </p>
              </div>
            </header>

            {/* TIÊU ĐỀ CHÍNH */}
            <div className="my-4 sm:my-5 text-center">
              <h3 className="text-base sm:text-xl font-extrabold tracking-wide text-slate-900 uppercase">
                {title}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Kỳ dữ liệu: <strong className="text-slate-700">{periodLabel}</strong> · Điểm đo:{" "}
                <strong className="text-slate-700">
                  {selectedMeters.map((m) => m.name).join(", ") || "Tất cả điểm đo"}
                </strong>
              </p>
            </div>

            {/* KPI TỔNG QUAN */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 sm:grid-cols-4">
              {builtReportData.kpis.map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 sm:px-3.5 sm:py-2.5"
                >
                  <p className="text-[10px] sm:text-[10.5px] font-semibold tracking-wider text-slate-500 uppercase">
                    {kpi.label}
                  </p>
                  <p className="mt-1 text-sm sm:text-base font-bold text-emerald-700">{kpi.value}</p>
                </div>
              ))}
            </div>

            {/* BIỂU ĐỒ TRONG BẢN XEM TRƯỚC */}
            {chart === "Có" && builtReportData.chartBars.length > 0 ? (
              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/40 p-3 sm:p-4">
                <p className="mb-3 text-xs font-bold tracking-wider text-slate-700 uppercase">
                  Biểu đồ trực quan theo kỳ báo cáo
                </p>
                <div className="space-y-2">
                  {builtReportData.chartBars.slice(0, 12).map((bar, idx) => {
                    const pct = Math.max(2, Math.round((bar.value / maxPreviewBar) * 100));
                    return (
                      <div key={`${bar.label}-${idx}`} className="flex items-center gap-2 sm:gap-3 text-xs">
                        <span className="w-24 sm:w-36 shrink-0 truncate font-medium text-slate-700">
                          {bar.label}
                        </span>
                        <div className="h-3.5 flex-1 overflow-hidden rounded-md bg-slate-200/70">
                          <div
                            className="h-full rounded-md bg-emerald-600 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-20 sm:w-28 shrink-0 text-right font-mono text-[11px] sm:text-xs font-semibold text-slate-800">
                          {bar.value.toLocaleString("vi-VN")} {bar.unit}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* BẢNG DỮ LIỆU TỔNG HỢP */}
            {summary === "Có" ? (
              <div className="mt-5">
                <h4 className="mb-2 text-xs font-bold tracking-wider text-slate-800 uppercase">
                  I. Bảng dữ liệu tổng hợp ({builtReportData.summaryRows.length} dòng)
                </h4>
                <PreviewDataTable
                  columns={visibleColumns}
                  rows={builtReportData.summaryRows}
                />
              </div>
            ) : null}

            {/* BẢNG DỮ LIỆU CHI TIẾT */}
            {detail === "Có" ? (
              <div className="mt-5">
                <h4 className="mb-2 text-xs font-bold tracking-wider text-slate-800 uppercase">
                  II. Bảng dữ liệu chi tiết ({builtReportData.detailRows.length} dòng)
                </h4>
                <PreviewDataTable
                  columns={visibleColumns}
                  rows={builtReportData.detailRows}
                />
              </div>
            ) : null}

            {/* FOOTER MẪU BÁO CÁO (CHỮ KÝ & GHI CHÚ CHÂN TRANG) */}
            <footer className="mt-8 border-t border-slate-200 pt-5">
              <div className="grid grid-cols-3 gap-4 text-center text-xs text-slate-800">
                <div>
                  <p className="font-bold">{headerFooter.preparedByTitle}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">(Ký, ghi rõ họ tên)</p>
                  <div className="h-14" />
                </div>
                <div>
                  <p className="font-bold">{headerFooter.reviewedByTitle}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">(Ký, ghi rõ họ tên)</p>
                  <div className="h-14" />
                </div>
                <div>
                  <p className="font-bold">{headerFooter.approvedByTitle}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">(Ký, đóng dấu)</p>
                  <div className="h-14" />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-slate-200 pt-3 text-[11px] text-slate-400">
                <span>{headerFooter.footerNote}</span>
                <span className="font-mono">{headerFooter.formCode}</span>
              </div>
            </footer>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function PreviewDataTable({
  columns,
  rows,
}: {
  columns: ReportFieldDef[];
  rows: Record<string, { display: string; raw: ExcelCellValue }>[];
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 py-8 text-center text-xs text-slate-400">
        Chưa có dữ liệu trong khoảng thời gian đã chọn.
      </p>
    );
  }
  return (
    <div className="max-h-[380px] overflow-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="sticky top-0 bg-slate-100 text-[11px] font-bold text-slate-700">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`border-b border-slate-200 px-3 py-2.5 ${
                  col.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, idx) => (
            <tr key={idx} className="hover:bg-slate-50/80">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-3 py-2 text-slate-700 ${
                    col.align === "right" ? "text-right font-mono" : ""
                  }`}
                >
                  {row[col.key]?.display ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettingRow({
  index,
  label,
  children,
}: {
  index: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <p className="text-[13.5px] font-medium text-slate-700">
        {index}. {label}
      </p>
      {children}
    </li>
  );
}

function YesNoSelect({
  value,
  onChange,
}: {
  value: YesNo;
  onChange: (value: YesNo) => void;
}) {
  return (
    <CustomSelect
      value={value}
      onChange={(e) => onChange(e.target.value as YesNo)}
      className="h-9 min-w-[140px] rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-500"
    >
      <option value="Có">Có</option>
      <option value="Không">Không</option>
    </CustomSelect>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path
        d="M12 4v11M7.5 11.5 12 16l4.5-4.5M5 19h14"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path
        d="M7 3.5h7l5 5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M14 3.5V9h5.5M9 13h6M9 16.5h4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" aria-hidden>
      <path
        d="M5 7.5 10 12.5 15 7.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
