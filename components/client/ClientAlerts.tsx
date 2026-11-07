"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CustomSelect } from "@/components/ui/CustomSelect";
import type { Project } from "@/lib/projects";
import {
  alertCategory,
  hydrateAlertEvents,
  loadAlertEvents,
  type AlertEvent,
} from "@/lib/alert-events";
import {
  DEFAULT_NOTIFICATION_CHANNELS,
  normalizeAlertConfig,
  resolveConfiguredSeverity,
  type AlertConfig,
  type NotificationChannelsConfig,
} from "@/lib/alert-config";
import { hydrateClientMeters, loadClientMeters } from "@/lib/client-meters";
import { exportToExcel } from "@/lib/excel-export";
import { loadProjectGatewayLatest } from "@/lib/gateway-series";
import { METER_PARAMETERS, readMeterValue } from "@/lib/meter-parameters";
import { hydrateProjectSettings } from "@/lib/project-settings";
import { formatStoredVietnam, vietnamFromStored, vietnamNow } from "@/lib/vietnam-time";

export type AlertSeverity = "critical" | "warning" | "info";
export type AlertCategory =
  | "frequency"
  | "voltage"
  | "current"
  | "unbalance"
  | "harmonics"
  | "connectivity"
  | "power";

export type DeliveryChannelStatus = {
  channel: "Zalo" | "Telegram" | "Email";
  recipient: string;
  delivered: boolean;
};

export interface AlertItem {
  id: string;
  code: string;
  rawOccurredAt: string;
  monthKey: string;
  timestamp: string;
  pointCode: string;
  pointName: string;
  location: string;
  parameter: string;
  paramName: string;
  actualValue: string;
  thresholdValue: string;
  unit: string;
  severity: AlertSeverity;
  category: AlertCategory;
  message: string;
  deliveries: DeliveryChannelStatus[];
}

function buildDeliveryStatuses(
  notifications: NotificationChannelsConfig,
  note?: string,
): DeliveryChannelStatus[] {
  const failedInNote = note ? /fail|lỗi|thất bại/i.test(note) : false;
  const list: DeliveryChannelStatus[] = [];
  if (notifications.zaloEnabled) {
    list.push({
      channel: "Zalo",
      recipient: notifications.zaloRecipient || "Zalo OA",
      delivered: !failedInNote,
    });
  }
  if (notifications.telegramEnabled) {
    list.push({
      channel: "Telegram",
      recipient: notifications.telegramChatId || "@ems_alert_bot",
      delivered: !failedInNote,
    });
  }
  if (notifications.emailEnabled && notifications.emailRecipient.trim()) {
    list.push({
      channel: "Email",
      recipient: notifications.emailRecipient.trim(),
      delivered: !failedInNote,
    });
  }
  return list;
}

function extractMonthKey(rawAt: string): string {
  const vn = vietnamFromStored(rawAt);
  if (vn) return vn.monthKey;
  const match = rawAt.match(/^(\d{4}-\d{2})/);
  if (match) return match[1];
  return vietnamNow().monthKey;
}

function dbAlertToItem(event: AlertEvent, config: AlertConfig): AlertItem {
  const paramMeta = METER_PARAMETERS.find((p) => p.key === event.parameter);
  const parameterNames: Record<string, string> = {
    F_avg: "Tần số trung bình",
    U_unb: "Độ mất cân bằng điện áp",
    I_rms: "Dòng điện hiệu dụng",
    P_sum: "Công suất hữu công",
  };
  const category = alertCategory(event.parameter, event.category) as AlertCategory;
  const storedSeverity: AlertSeverity =
    event.severity === "critical" || event.severity === "info" ? event.severity : "warning";
  const unit = event.unit || paramMeta?.unit || "";

  // Tìm ngưỡng từ cấu hình người dùng nếu bản ghi chưa có thresholdValue
  const matchedRule = Object.values(config.rulesByGroup ?? {})
    .flat()
    .find((r) => r.parameterKey === event.parameter);
  const thresholdDisplay =
    event.thresholdValue != null
      ? String(event.thresholdValue)
      : matchedRule
        ? [
            matchedRule.minValue ? `Min ${matchedRule.minValue}` : "",
            matchedRule.maxValue ? `Max ${matchedRule.maxValue}` : "",
          ]
            .filter(Boolean)
            .join(" · ") || "--"
        : "--";

  return {
    id: event.id,
    code: event.parameter,
    rawOccurredAt: event.occurredAt,
    monthKey: extractMonthKey(event.occurredAt),
    timestamp: formatStoredVietnam(event.occurredAt) ?? event.occurredAt,
    pointCode: event.pointCode ?? event.meterPointId ?? "--",
    pointName: event.pointName ?? "Điểm đo dự án",
    location: event.utility ?? "Điện",
    parameter: event.parameter,
    paramName: paramMeta?.name ?? parameterNames[event.parameter] ?? event.parameter,
    actualValue: String(event.value),
    thresholdValue: thresholdDisplay,
    unit,
    severity: resolveConfiguredSeverity(category, storedSeverity, config, event.parameter),
    category,
    message:
      event.message ??
      `${paramMeta?.name ?? event.parameter}: giá trị đo ${event.value}${unit ? ` ${unit}` : ""}`,
    deliveries: buildDeliveryStatuses(config.notifications ?? DEFAULT_NOTIFICATION_CHANNELS, event.note),
  };
}

export function ClientAlerts({ project }: { project: Project }) {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [notificationsConfig, setNotificationsConfig] = useState<NotificationChannelsConfig>(
    DEFAULT_NOTIFICATION_CHANNELS,
  );
  const [search, setSearch] = useState("");
  const [selectedMonth, setSelectedMonth] = useState<string>(() => vietnamNow().monthKey);
  const [monthAligned, setMonthAligned] = useState(false);
  const [selectedSeverity, setSelectedSeverity] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedPoint, setSelectedPoint] = useState<string>("all");
  const [selectedDelivery, setSelectedDelivery] = useState<string>("all");
  const [liveMode, setLiveMode] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!liveMode) return;
    const timer = window.setInterval(() => {
      setReloadTick((v) => v + 1);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [liveMode]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      hydrateAlertEvents(project.id),
      hydrateProjectSettings(project.id, { force: true }).catch(() => ({})),
      loadProjectGatewayLatest(project.id).catch(() => []),
      hydrateClientMeters(project.id).catch(() => loadClientMeters(project.id)),
    ])
      .then(([events, settings, latestList, meterList]) => {
        if (!active) return;
        const userConfig = normalizeAlertConfig(
          (settings as Record<string, unknown>).alertsConfig,
        );
        setNotificationsConfig(userConfig.notifications);
        const source = events.length ? events : loadAlertEvents(project.id);
        const dbItems = source.map((event) => dbAlertToItem(event, userConfig));

        // Đối chiếu trực tiếp các quy tắc ngưỡng đã bật ở phần Cấu hình với mẫu đo mới nhất từ Gateway
        const liveItems: AlertItem[] = [];
        const allRules = Object.values(userConfig.rulesByGroup ?? {}).flat();
        for (const sample of latestList) {
          const meterPointId = sample.meterPointId;
          const meter = meterList.find((m) => m.id === meterPointId);
          for (const rule of allRules) {
            if (!rule.enabled || !rule.parameterKey) continue;
            if (rule.meterPointId && rule.meterPointId !== meterPointId) continue;
            const actual = readMeterValue(sample.values, rule.parameterKey);
            if (actual === null) continue;
            const minNum = rule.minValue.trim() !== "" ? Number(rule.minValue) : null;
            const maxNum = rule.maxValue.trim() !== "" ? Number(rule.maxValue) : null;
            const belowMin = minNum !== null && Number.isFinite(minNum) && actual < minNum;
            const aboveMax = maxNum !== null && Number.isFinite(maxNum) && actual > maxNum;
            if (!belowMin && !aboveMax) continue;

            const duplicate = dbItems.some(
              (item) =>
                item.parameter === rule.parameterKey &&
                (item.pointCode === (meter?.code ?? meterPointId) || item.pointName === meter?.name),
            );
            if (duplicate) continue;

            const paramMeta = METER_PARAMETERS.find((p) => p.key === rule.parameterKey);
            const cat = alertCategory(
              rule.parameterKey,
              rule.groupId === "imbalance"
                ? "unbalance"
                : rule.groupId === "harmonics"
                  ? "harmonics"
                  : undefined,
            ) as AlertCategory;
            const thresholdStr =
              belowMin && aboveMax
                ? `${minNum} – ${maxNum}`
                : belowMin
                  ? `< ${minNum}`
                  : `> ${maxNum}`;
            const unit = rule.unit || paramMeta?.unit || "";

            liveItems.push({
              id: `ALM-${meterPointId}-${rule.id}`,
              code: rule.parameterKey,
              rawOccurredAt: sample.at,
              monthKey: extractMonthKey(sample.at),
              timestamp: formatStoredVietnam(sample.at) ?? sample.at,
              pointCode: meter?.code ?? meterPointId,
              pointName: meter?.name ?? "Điểm đo Gateway",
              location: meter?.utility ?? "Điện",
              parameter: rule.parameterKey,
              paramName: paramMeta?.name ?? rule.name,
              actualValue: String(actual),
              thresholdValue: thresholdStr,
              unit,
              severity: rule.severity,
              category: cat,
              message: `${rule.name}: giá trị đo ${actual}${unit ? ` ${unit}` : ""} vượt ngưỡng cài đặt (${thresholdStr}${unit ? ` ${unit}` : ""})`,
              deliveries: buildDeliveryStatuses(userConfig.notifications),
            });
          }
        }

        const merged = [...liveItems, ...dbItems];
        setAlerts(merged);
        if (!monthAligned && merged.length > 0) {
          const months = Array.from(new Set(merged.map((a) => a.monthKey))).sort();
          const latestMonth = months[months.length - 1];
          if (latestMonth) setSelectedMonth(latestMonth);
          setMonthAligned(true);
        }
      })
      .catch(() => {
        if (active) setAlerts([]);
      });
    return () => {
      active = false;
    };
  }, [project.id, reloadTick, monthAligned]);

  // Danh sách các tháng có dữ liệu + 6 tháng gần nhất
  const availableMonths = useMemo(() => {
    const now = vietnamNow();
    const set = new Set<string>();
    for (let offset = 0; offset < 6; offset += 1) {
      let y = now.year;
      let m = now.month - offset;
      while (m <= 0) {
        m += 12;
        y -= 1;
      }
      set.add(`${y}-${String(m).padStart(2, "0")}`);
    }
    for (const a of alerts) {
      if (a.monthKey) set.add(a.monthKey);
    }
    return Array.from(set).sort().reverse();
  }, [alerts]);

  // Điểm đo unique
  const points = useMemo(() => {
    const map = new Map<string, string>();
    alerts.forEach((a) => map.set(a.pointCode, a.pointName));
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }));
  }, [alerts]);

  // Cảnh báo thuộc tháng đang chọn (dùng cho thống kê KPI trong tháng)
  const monthlyAlerts = useMemo(() => {
    if (selectedMonth === "all") return alerts;
    return alerts.filter((item) => item.monthKey === selectedMonth);
  }, [alerts, selectedMonth]);

  // Thống kê số lượng cảnh báo trong tháng chia theo mức độ đã cấu hình
  const stats = useMemo(() => {
    const total = monthlyAlerts.length;
    const critical = monthlyAlerts.filter((a) => a.severity === "critical").length;
    const warning = monthlyAlerts.filter((a) => a.severity === "warning").length;
    const info = monthlyAlerts.filter((a) => a.severity === "info").length;
    const sentSuccess = monthlyAlerts.filter(
      (a) => a.deliveries.length > 0 && a.deliveries.every((d) => d.delivered),
    ).length;
    return { total, critical, warning, info, sentSuccess };
  }, [monthlyAlerts]);

  // Bộ lọc chi tiết trên bảng
  const filteredAlerts = useMemo(() => {
    return monthlyAlerts.filter((item) => {
      if (selectedSeverity !== "all" && item.severity !== selectedSeverity) return false;
      if (selectedCategory !== "all" && item.category !== selectedCategory) return false;
      if (selectedPoint !== "all" && item.pointCode !== selectedPoint) return false;
      if (selectedDelivery === "sent") {
        if (item.deliveries.length === 0 || !item.deliveries.every((d) => d.delivered)) return false;
      } else if (selectedDelivery === "failed") {
        if (item.deliveries.length === 0 || item.deliveries.every((d) => d.delivered)) return false;
      } else if (selectedDelivery === "unconfigured") {
        if (item.deliveries.length > 0) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const match =
          item.id.toLowerCase().includes(q) ||
          item.pointName.toLowerCase().includes(q) ||
          item.pointCode.toLowerCase().includes(q) ||
          item.parameter.toLowerCase().includes(q) ||
          item.paramName.toLowerCase().includes(q) ||
          item.message.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [monthlyAlerts, selectedSeverity, selectedCategory, selectedPoint, selectedDelivery, search]);

  const monthLabel =
    selectedMonth === "all"
      ? "Tất cả các tháng"
      : `Tháng ${selectedMonth.slice(5, 7)}/${selectedMonth.slice(0, 4)}`;

  // Xuất file Excel (.xlsx) nhật ký cảnh báo trong tháng
  const handleExportExcel = () => {
    exportToExcel({
      filename: `canh-bao-${project.id}-${selectedMonth}`,
      sheetName: `Cảnh báo ${monthLabel}`,
      title: `Nhật ký cảnh báo dự án ${project.name} — ${monthLabel}`,
      subtitle: `Tổng số: ${filteredAlerts.length} cảnh báo (Nghiêm trọng: ${stats.critical}, Cảnh báo: ${stats.warning}, Thông tin: ${stats.info})`,
      columns: [
        { header: "Thời điểm xảy ra", width: 22 },
        { header: "Mức độ", width: 16 },
        { header: "Mã điểm đo", width: 18 },
        { header: "Tên điểm đo", width: 24 },
        { header: "Thông số", width: 22 },
        { header: "Giá trị thực tế", width: 16 },
        { header: "Ngưỡng cài đặt", width: 18 },
        { header: "Đơn vị", width: 10 },
        { header: "Trạng thái gửi (Zalo / Telegram)", width: 32 },
        { header: "Nội dung cảnh báo", width: 42 },
      ],
      rows: filteredAlerts.map((a) => {
        const deliverySummary =
          a.deliveries.length === 0
            ? "Chưa cấu hình kênh nhận"
            : a.deliveries
                .map((d) => `${d.channel}: ${d.delivered ? "Đã gửi thành công" : "Gửi thất bại"}`)
                .join(" | ");
        return [
          a.timestamp,
          a.severity === "critical" ? "Nghiêm trọng" : a.severity === "warning" ? "Cảnh báo" : "Thông tin",
          a.pointCode,
          a.pointName,
          `${a.parameter} (${a.paramName})`,
          a.actualValue,
          a.thresholdValue,
          a.unit,
          deliverySummary,
          a.message,
        ];
      }),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto md:overflow-hidden bg-[#f8fafc]">
      {/* Top Banner Header */}
      <div className="shrink-0 border-b border-slate-200/80 bg-white px-3.5 py-3.5 sm:px-5 sm:py-4 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
              <AlertBellIcon className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-base sm:text-xl font-bold tracking-tight text-slate-900">
                Nhật Ký Cảnh Báo Hệ Thống · {monthLabel}
              </h1>
              <p className="mt-0.5 text-xs text-slate-500">
                Thống kê thời điểm phát sinh cảnh báo trong tháng, phân loại mức độ theo cấu hình và trạng thái gửi thông báo qua Zalo / Telegram
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Live Mode Toggle */}
            <button
              type="button"
              onClick={() => setLiveMode(!liveMode)}
              className={`inline-flex h-8 sm:h-9 items-center gap-2 rounded-xl border px-2.5 sm:px-3 text-xs font-semibold transition-all ${
                liveMode
                  ? "border-emerald-200 bg-emerald-50/80 text-emerald-800 shadow-xs"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  liveMode ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
                }`}
              />
              {liveMode ? "Tự động cập nhật" : "Tạm dừng cập nhật"}
            </button>

            {/* Nút Cấu hình mức độ & ngưỡng */}
            <Link
              href={`/du-an/${project.id}/cau-hinh?tab=alerts`}
              className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 sm:px-3.5 text-xs font-semibold text-slate-700 shadow-xs transition-colors hover:bg-slate-50"
            >
              <GearIcon className="h-3.5 w-3.5 text-slate-500" />
              Cấu hình mức độ & kênh gửi
            </Link>

            {/* Nút Xuất Excel */}
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 sm:px-4 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              Xuất Excel (.xlsx)
            </button>
          </div>
        </div>

        {/* Thống kê số lượng cảnh báo trong tháng theo mức độ cấu hình & trạng thái gửi Zalo/Tele */}
        <div className="mt-3 sm:mt-4 grid grid-cols-2 gap-2.5 sm:gap-3 sm:grid-cols-5">
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
            <span className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
              Tổng cảnh báo ({monthLabel})
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">{stats.total}</span>
              <span className="text-[11px] text-slate-400">lần phát sinh</span>
            </div>
          </div>

          <div className="rounded-xl border border-rose-200/80 bg-rose-50/50 p-3">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-rose-700 uppercase">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              Mức độ Nghiêm trọng
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-rose-600">{stats.critical}</span>
              <span className="text-[11px] text-rose-500">theo cấu hình</span>
            </div>
          </div>

          <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-3">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-amber-700 uppercase">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              Mức độ Cảnh báo
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-amber-600">{stats.warning}</span>
              <span className="text-[11px] text-amber-600">theo cấu hình</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-3">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-600 uppercase">
              <span className="h-2 w-2 rounded-full bg-slate-400" />
              Mức độ Thông tin
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-800">{stats.info}</span>
              <span className="text-[11px] text-slate-500">theo cấu hình</span>
            </div>
          </div>

          <div className="col-span-2 rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-3 sm:col-span-1">
            <span className="text-[11px] font-semibold tracking-wider text-emerald-700 uppercase">
              Đã gửi Zalo / Telegram
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-emerald-600">
                {stats.sentSuccess}/{stats.total}
              </span>
              <span className="text-[11px] font-medium text-emerald-700">thành công</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-3.5 py-2.5 sm:px-5 sm:py-3 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {/* Chọn Tháng */}
            <CustomSelect
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-emerald-500"
            >
              <option value="all">Tất cả các tháng</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  Tháng {m.slice(5, 7)}/{m.slice(0, 4)}
                </option>
              ))}
            </CustomSelect>

            {/* Ô tìm kiếm */}
            <div className="relative min-w-[180px] max-w-[300px] flex-1">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm điểm đo, thông số, nội dung..."
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 pr-3 pl-8 text-xs text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-1 focus:ring-emerald-500"
              />
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
                >
                  ×
                </button>
              ) : null}
            </div>

            {/* Lọc theo Mức độ */}
            <CustomSelect
              value={selectedSeverity}
              onChange={(e) => setSelectedSeverity(e.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 outline-none focus:border-emerald-500"
            >
              <option value="all">Tất cả mức độ</option>
              <option value="critical">Nghiêm trọng</option>
              <option value="warning">Cảnh báo</option>
              <option value="info">Thông tin</option>
            </CustomSelect>

            {/* Lọc theo Nhóm thông số */}
            <CustomSelect
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 outline-none focus:border-emerald-500"
            >
              <option value="all">Tất cả nhóm thông số</option>
              <option value="frequency">Tần số</option>
              <option value="voltage">Điện áp</option>
              <option value="current">Dòng điện</option>
              <option value="unbalance">Mất cân bằng pha</option>
              <option value="harmonics">Sóng hài</option>
              <option value="power">Công suất</option>
              <option value="connectivity">Kết nối Gateway</option>
            </CustomSelect>

            {/* Lọc theo Điểm đo */}
            <CustomSelect
              value={selectedPoint}
              onChange={(e) => setSelectedPoint(e.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 outline-none focus:border-emerald-500"
            >
              <option value="all">Tất cả điểm đo</option>
              {points.map((p) => (
                <option key={p.code} value={p.code}>
                  ({p.code}) {p.name}
                </option>
              ))}
            </CustomSelect>

            {/* Lọc theo Trạng thái gửi thông báo Zalo/Telegram */}
            <CustomSelect
              value={selectedDelivery}
              onChange={(e) => setSelectedDelivery(e.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 outline-none focus:border-emerald-500"
            >
              <option value="all">Tất cả trạng thái gửi</option>
              <option value="sent">Đã gửi Zalo / Telegram thành công</option>
              <option value="failed">Gửi thông báo thất bại</option>
              <option value="unconfigured">Chưa bật kênh gửi</option>
            </CustomSelect>
          </div>

          {/* Tóm tắt kênh nhận đang bật */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <span>Kênh nhận đang bật:</span>
            {notificationsConfig.zaloEnabled ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">
                Zalo ({notificationsConfig.zaloRecipient || "Zalo OA"})
              </span>
            ) : null}
            {notificationsConfig.telegramEnabled ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 font-semibold text-sky-700">
                Telegram ({notificationsConfig.telegramChatId || "@ems_alert_bot"})
              </span>
            ) : null}
            {notificationsConfig.emailEnabled && notificationsConfig.emailRecipient ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                Email ({notificationsConfig.emailRecipient})
              </span>
            ) : null}
            {!notificationsConfig.zaloEnabled &&
            !notificationsConfig.telegramEnabled &&
            !notificationsConfig.emailEnabled ? (
              <span className="text-slate-400">Chưa bật kênh nhận</span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Bảng / Thẻ danh sách thời điểm cảnh báo & trạng thái gửi Zalo/Telegram */}
      <div className="min-h-0 flex-1 md:overflow-y-auto px-3.5 py-3.5 sm:px-5 sm:py-4 lg:px-8">
        {/* Danh sách thẻ dễ đọc trên Mobile (< md) */}
        <div className="space-y-2.5 md:hidden">
          {filteredAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-white px-4 py-12 text-center shadow-xs">
              <CheckCircleIcon className="mb-2 h-9 w-9 text-emerald-500 opacity-80" />
              <p className="text-sm font-semibold text-slate-700">
                Không có cảnh báo nào phát sinh trong {monthLabel.toLowerCase()}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Các thông số đo của dự án đều nằm trong ngưỡng cài đặt
              </p>
            </div>
          ) : (
            filteredAlerts.map((item) => (
              <article
                key={item.id}
                className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-xs space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-slate-800">
                    {item.timestamp}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase ${
                      item.severity === "critical"
                        ? "border border-rose-200 bg-rose-100 text-rose-700"
                        : item.severity === "warning"
                          ? "border border-amber-200 bg-amber-100 text-amber-800"
                          : "border border-slate-200 bg-slate-100 text-slate-700"
                    }`}
                  >
                    {item.severity === "critical"
                      ? "Nghiêm trọng"
                      : item.severity === "warning"
                        ? "Cảnh báo"
                        : "Thông tin"}
                  </span>
                </div>

                <div className="flex items-baseline justify-between gap-2 border-t border-slate-100 pt-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-800">
                      {item.pointName}{" "}
                      <span className="font-mono text-[11px] text-emerald-700">
                        ({item.pointCode})
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      <span className="rounded bg-slate-100 px-1 py-0.5 font-mono font-bold text-slate-800">
                        {item.parameter}
                      </span>{" "}
                      {item.paramName}
                    </p>
                  </div>
                  <div className="shrink-0 text-right font-mono">
                    <span
                      className={`text-sm font-bold ${
                        item.severity === "critical"
                          ? "text-rose-600"
                          : item.severity === "warning"
                            ? "text-amber-600"
                            : "text-slate-800"
                      }`}
                    >
                      {item.actualValue}
                    </span>
                    <span className="text-[11px] text-slate-400"> / {item.thresholdValue}</span>{" "}
                    <span className="text-[10.5px] font-medium text-slate-500">{item.unit}</span>
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-slate-600">{item.message}</p>

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {item.deliveries.length === 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10.5px] font-medium text-slate-500">
                      Chưa cấu hình kênh gửi
                    </span>
                  ) : (
                    item.deliveries.map((d) => (
                      <span
                        key={d.channel}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${
                          d.delivered
                            ? d.channel === "Zalo"
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : d.channel === "Telegram"
                                ? "border-sky-200 bg-sky-50 text-sky-700"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-rose-200 bg-rose-50 text-rose-700"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            d.delivered ? "bg-emerald-500" : "bg-rose-500"
                          }`}
                        />
                        {d.channel}: {d.delivered ? "Đã gửi thành công" : "Gửi thất bại"}
                      </span>
                    ))
                  )}
                </div>
              </article>
            ))
          )}
        </div>

        {/* Bảng đầy đủ trên Desktop / Tablet (≥ md) */}
        <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold tracking-wider text-slate-500 uppercase">
                  <th className="px-4 py-3.5">Thời điểm phát sinh</th>
                  <th className="px-3 py-3.5">Mức độ cảnh báo</th>
                  <th className="px-3 py-3.5">Điểm đo</th>
                  <th className="px-3 py-3.5">Thông số vượt ngưỡng</th>
                  <th className="px-3 py-3.5">Giá trị đo / Ngưỡng</th>
                  <th className="px-3 py-3.5">Nội dung cảnh báo</th>
                  <th className="px-4 py-3.5">Trạng thái gửi (Zalo / Telegram)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center">
                        <CheckCircleIcon className="mb-2 h-10 w-10 text-emerald-500 opacity-80" />
                        <p className="text-sm font-semibold text-slate-700">
                          Không có cảnh báo nào phát sinh trong {monthLabel.toLowerCase()}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Các thông số đo của dự án đều nằm trong ngưỡng cài đặt
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredAlerts.map((item) => (
                    <tr key={item.id} className="transition-colors hover:bg-slate-50/80">
                      {/* Thời điểm phát sinh */}
                      <td className="px-4 py-3.5 font-mono text-[12px] font-semibold whitespace-nowrap text-slate-800">
                        {item.timestamp}
                      </td>

                      {/* Mức độ cảnh báo (từ cấu hình) */}
                      <td className="px-3 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10.5px] font-bold tracking-wider uppercase ${
                            item.severity === "critical"
                              ? "border border-rose-200 bg-rose-100 text-rose-700"
                              : item.severity === "warning"
                                ? "border border-amber-200 bg-amber-100 text-amber-800"
                                : "border border-slate-200 bg-slate-100 text-slate-700"
                          }`}
                        >
                          {item.severity === "critical"
                            ? "Nghiêm trọng"
                            : item.severity === "warning"
                              ? "Cảnh báo"
                              : "Thông tin"}
                        </span>
                      </td>

                      {/* Điểm đo */}
                      <td className="px-3 py-3.5">
                        <p className="font-semibold text-slate-800">{item.pointName}</p>
                        <div className="flex items-center gap-1 text-[11px] text-slate-400">
                          <span className="font-mono font-medium text-emerald-700">
                            {item.pointCode}
                          </span>
                          <span>• {item.location}</span>
                        </div>
                      </td>

                      {/* Thông số vượt ngưỡng */}
                      <td className="px-3 py-3.5 whitespace-nowrap">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono font-bold text-slate-800">
                          {item.parameter}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-slate-500">
                          {item.paramName}
                        </span>
                      </td>

                      {/* Giá trị thực tế / Ngưỡng */}
                      <td className="px-3 py-3.5 whitespace-nowrap">
                        <div className="flex items-baseline gap-1 font-mono">
                          <span
                            className={`text-sm font-bold ${
                              item.severity === "critical"
                                ? "text-rose-600"
                                : item.severity === "warning"
                                  ? "text-amber-600"
                                  : "text-slate-800"
                            }`}
                          >
                            {item.actualValue}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            / {item.thresholdValue}
                          </span>
                          <span className="text-[10.5px] font-medium text-slate-500">
                            {item.unit}
                          </span>
                        </div>
                      </td>

                      {/* Nội dung cảnh báo */}
                      <td className="max-w-[300px] px-3 py-3.5">
                        <p className="leading-relaxed text-slate-700">{item.message}</p>
                      </td>

                      {/* Trạng thái gửi thông báo qua Zalo / Telegram / Email */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {item.deliveries.length === 0 ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                            Chưa cấu hình kênh gửi
                          </span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {item.deliveries.map((d) => (
                              <span
                                key={d.channel}
                                title={`${d.channel}: ${d.recipient}`}
                                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                                  d.delivered
                                    ? d.channel === "Zalo"
                                      ? "border-blue-200 bg-blue-50 text-blue-700"
                                      : d.channel === "Telegram"
                                        ? "border-sky-200 bg-sky-50 text-sky-700"
                                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : "border-rose-200 bg-rose-50 text-rose-700"
                                }`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    d.delivered ? "bg-emerald-500" : "bg-rose-500"
                                  }`}
                                />
                                {d.channel}: {d.delivered ? "Đã gửi thành công" : "Gửi thất bại"}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// Icons
function AlertBellIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      <path d="M4 2C2.8 3.7 2 5.7 2 8" strokeWidth="1.5" />
      <path d="M22 8c0-2.3-.8-4.3-2-6" strokeWidth="1.5" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
