"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { hydrateFactorGroups } from "@/lib/emission-factors";
import { exportToExcel } from "@/lib/excel-export";
import {
  GHG_SCOPES,
  computeManualTons,
  computeMeterSourceTons,
  getSourceMonthActivity,
  getSourceYearActivity,
  hydrateGhgSources,
  loadGhgSources,
  saveGhgSources,
  type GhgEmissionSource,
  type ScopeId,
} from "@/lib/ghg-sources";
import {
  hydrateMeterReadings,
  loadMeterReadings,
  type MeterReading,
} from "@/lib/meter-readings";
import { loadProjectGatewayDailyRange } from "@/lib/gateway-series";
import { registerToKwh } from "@/lib/meter-parameters";
import {
  formatAppNumber,
  formatAppNumberInput,
  formatLiveNumberInput,
  parseAppNumber,
  parseMonthlyExcelOrCsvFile,
} from "@/lib/number-format";
import {
  DEFAULT_TIME_FILTER,
  TimeFilterBar,
  getTimeFilterLabel,
  getTimeFilterPeriods,
  periodIndexForInstant,
  timeFilterSpan,
  type TimeFilterMode,
  type TimeFilterValue,
} from "./TimeFilterBar";

function formatNumber(n: number, maxDecimals = 6): string {
  return formatAppNumber(n, { maxDecimals });
}

type Selection =
  | { kind: "all" }
  | { kind: "scope"; scope: ScopeId }
  | { kind: "source"; sourceId: string };

type ComputedRow = GhgEmissionSource & {
  tons: number;
  share: number;
  activityValue?: number;
};

const SCOPE_COLORS: Record<ScopeId, { bar: string; badgeBg: string; badgeText: string; dot: string }> = {
  1: { bar: "#10b981", badgeBg: "#ecfdf5", badgeText: "#047857", dot: "#10b981" },
  2: { bar: "#3b82f6", badgeBg: "#eff6ff", badgeText: "#1d4ed8", dot: "#3b82f6" },
  3: { bar: "#f59e0b", badgeBg: "#fffbeb", badgeText: "#b45309", dot: "#f59e0b" },
};

const SOURCE_PALETTE = [
  "#10b981",
  "#3b82f6",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#06b6d4",
];

const ENTRY_YEARS = [2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030];

export function GreenhouseCharts({ projectId = "default" }: { projectId?: string }) {
  const [rawSources, setRawSources] = useState<GhgEmissionSource[]>(() => loadGhgSources(projectId));
  const [meterReadings, setMeterReadings] = useState<MeterReading[]>(() =>
    loadMeterReadings(projectId),
  );
  const [meterKwhByPoint, setMeterKwhByPoint] = useState<Record<string, number>>({});
  const [selection, setSelection] = useState<Selection>({ kind: "all" });
  const [expandedScopes, setExpandedScopes] = useState<Record<ScopeId, boolean>>({
    1: true,
    2: true,
    3: true,
  });
  const [search, setSearch] = useState("");
  const [timeFilter, setTimeFilter] = useState<TimeFilterValue>(DEFAULT_TIME_FILTER);

  // State cho modal Nhập số liệu 12 tháng
  const [editingSource, setEditingSource] = useState<GhgEmissionSource | null>(null);
  const [modalYear, setModalYear] = useState<number>(DEFAULT_TIME_FILTER.year);
  const [draftMonthly, setDraftMonthly] = useState<Record<string, string>>({});
  const [importNotice, setImportNotice] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const syncSources = () => setRawSources(loadGhgSources(projectId));
    const syncReadings = () => setMeterReadings(loadMeterReadings(projectId));
    void hydrateFactorGroups();
    void hydrateGhgSources(projectId).then(setRawSources);
    void hydrateMeterReadings(projectId).then(setMeterReadings);
    window.addEventListener("ems-ghg-sources-changed", syncSources);
    window.addEventListener("ems-meter-readings-changed", syncReadings);
    return () => {
      window.removeEventListener("ems-ghg-sources-changed", syncSources);
      window.removeEventListener("ems-meter-readings-changed", syncReadings);
    };
  }, [projectId]);

  // Kiểm tra nguồn đang chọn có phải nguồn lấy từ điểm đo không
  const selectedRawSource = useMemo(
    () =>
      selection.kind === "source"
        ? rawSources.find((s) => s.id === selection.sourceId)
        : undefined,
    [selection, rawSources],
  );

  // Phần tổng quan và nguồn nhập số liệu / import excel chỉ hiển thị theo Tháng hoặc Năm.
  // Chỉ khi vào chi tiết nguồn lấy từ điểm đo (method === "meter") mới cho phép chọn Ngày / Tùy chọn.
  const canFilterByDay =
    selection.kind === "source" && selectedRawSource?.method === "meter";

  const allowedModes = useMemo<TimeFilterMode[]>(
    () => (canFilterByDay ? ["day", "month", "year", "custom_date"] : ["month", "year"]),
    [canFilterByDay],
  );

  const effectiveTimeFilter = useMemo<TimeFilterValue>(() => {
    if (!canFilterByDay && (timeFilter.mode === "day" || timeFilter.mode === "custom_date")) {
      return { ...timeFilter, mode: "month" };
    }
    return timeFilter;
  }, [canFilterByDay, timeFilter]);

  useEffect(() => {
    if (!canFilterByDay && (timeFilter.mode === "day" || timeFilter.mode === "custom_date")) {
      setTimeFilter((prev) => ({ ...prev, mode: "month" }));
    }
  }, [canFilterByDay, timeFilter.mode]);

  useEffect(() => {
    let active = true;
    const span = timeFilterSpan(effectiveTimeFilter);
    const load = () => {
      void loadProjectGatewayDailyRange(projectId, span.from, span.to).then((summary) => {
        if (!active) return;
        const map: Record<string, number> = {};
        for (const row of summary.days) {
          const firstKwh = registerToKwh(Number(row.firstWh));
          const lastKwh = registerToKwh(Number(row.lastWh));
          if (!Number.isFinite(firstKwh) || !Number.isFinite(lastKwh)) continue;
          const consumed = Math.max(0, lastKwh - firstKwh);
          map[row.meterPointId] = (map[row.meterPointId] ?? 0) + consumed;
        }
        setMeterKwhByPoint(map);
      });
    };
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [projectId, effectiveTimeFilter]);

  const activeYearAndMonth = useMemo(() => {
    if (effectiveTimeFilter.mode === "month") {
      const [y, m] = effectiveTimeFilter.month.split("-").map(Number);
      return {
        year: Number.isFinite(y) && y > 0 ? y : effectiveTimeFilter.year,
        month: Number.isFinite(m) && m >= 1 && m <= 12 ? m : 1,
      };
    }
    return {
      year: effectiveTimeFilter.year,
      month: Number(effectiveTimeFilter.month.split("-")[1]) || 1,
    };
  }, [effectiveTimeFilter]);

  const computedRows = useMemo<ComputedRow[]>(() => {
    const withTons = rawSources.map((source) => {
      let rawTons = 0;
      let activityValue: number | undefined = undefined;

      if (source.method === "meter") {
        rawTons = computeMeterSourceTons(source, meterKwhByPoint) ?? 0;
      } else {
        // Nguồn nhập số liệu hoặc import file: tính theo Tháng hoặc Năm từ bảng 12 tháng
        if (effectiveTimeFilter.mode === "year") {
          let sumTons = 0;
          let sumAct = 0;
          for (let m = 1; m <= 12; m += 1) {
            const mAct = getSourceMonthActivity(source, activeYearAndMonth.year, m);
            sumAct += mAct;
            sumTons += computeManualTons(source, mAct) ?? 0;
          }
          activityValue = Number(sumAct.toFixed(6));
          rawTons = Number(sumTons.toFixed(6));
        } else {
          const mAct = getSourceMonthActivity(
            source,
            activeYearAndMonth.year,
            activeYearAndMonth.month,
          );
          activityValue = Number(mAct.toFixed(6));
          rawTons = computeManualTons(source, mAct) ?? 0;
        }
      }

      const tons = Number(rawTons.toFixed(6));
      return { ...source, tons, activityValue };
    });
    const totalTons = withTons.reduce((sum, r) => sum + r.tons, 0) || 1;
    return withTons.map((row) => ({
      ...row,
      share: Number(((row.tons / totalTons) * 100).toFixed(1)),
    }));
  }, [rawSources, meterKwhByPoint, effectiveTimeFilter.mode, activeYearAndMonth]);

  const selectedRows = useMemo<ComputedRow[]>(() => {
    if (selection.kind === "all") return computedRows;
    if (selection.kind === "scope") {
      return computedRows.filter((r) => r.scope === selection.scope);
    }
    return computedRows.filter((r) => r.id === selection.sourceId);
  }, [computedRows, selection]);

  const barData = useMemo(() => {
    const meterSources = selectedRows.filter((r) => r.method === "meter");
    const manualSources = selectedRows.filter((r) => r.method !== "meter");

    // Nếu chỉ đang xem các nguồn nhập số liệu / import excel và bộ lọc đang ở chế độ Tháng,
    // hiển thị biểu đồ cột 12 tháng của năm đó để dễ theo dõi biến động các tháng trong năm.
    const force12MonthsForManual =
      meterSources.length === 0 &&
      manualSources.length > 0 &&
      effectiveTimeFilter.mode === "month";

    const periods = force12MonthsForManual
      ? Array.from({ length: 12 }, (_, i) => ({ key: i + 1, label: `T${i + 1}` }))
      : getTimeFilterPeriods(effectiveTimeFilter);

    const len = periods.length || 1;
    // Lượng phát thải theo từng nguồn trong mỗi kỳ — để vẽ cột xếp chồng.
    const bySource = new Map<string, number[]>();
    const bucketOf = (id: string) => {
      let list = bySource.get(id);
      if (!list) {
        list = Array<number>(len).fill(0);
        bySource.set(id, list);
      }
      return list;
    };

    if (meterSources.length > 0) {
      for (const src of meterSources) {
        const buckets = bucketOf(src.id);
        const factor = Number.isFinite(src.factorValue) ? src.factorValue : 0;
        const mul = (src.multipliers ?? []).reduce(
          (acc, m) => acc * (Number.isFinite(m.value) ? m.value : 1),
          1,
        );
        for (const reading of meterReadings) {
          if (src.meterPointId && reading.meterPointId !== src.meterPointId) continue;
          if (!src.meterPointId && reading.utility !== "Điện") continue;
          const idx = periodIndexForInstant(effectiveTimeFilter, reading.recordedAt, len);
          if (idx >= 0 && idx < len) {
            buckets[idx] += (reading.value * factor * mul) / 1000;
          }
        }
      }
    }

    if (manualSources.length > 0) {
      if (effectiveTimeFilter.mode === "year" || force12MonthsForManual) {
        // Phân bổ đúng giá trị của từng tháng (T1..T12)
        for (const src of manualSources) {
          const buckets = bucketOf(src.id);
          for (let m = 1; m <= Math.min(12, len); m += 1) {
            const act = getSourceMonthActivity(src, activeYearAndMonth.year, m);
            buckets[m - 1] += computeManualTons(src, act) ?? 0;
          }
        }
      }
    }

    // Nhóm đoạn cột giống biểu đồ tròn: Tất cả → theo Scope; còn lại → theo từng nguồn.
    const groups: { id: string; label: string; color: string; buckets: number[] }[] =
      selection.kind === "all"
        ? GHG_SCOPES.map((sc) => {
            const buckets = Array<number>(len).fill(0);
            for (const row of selectedRows) {
              if (row.scope !== sc.id) continue;
              const list = bySource.get(row.id);
              if (list) list.forEach((v, i) => (buckets[i] += v));
            }
            return { id: `scope-${sc.id}`, label: sc.label, color: SCOPE_COLORS[sc.id].bar, buckets };
          })
        : selectedRows.map((row, idx) => ({
            id: row.id,
            label: row.name,
            color: SOURCE_PALETTE[idx % SOURCE_PALETTE.length],
            buckets: bySource.get(row.id) ?? Array<number>(len).fill(0),
          }));

    return periods.map((p, idx) => {
      const parts = groups.map((g) => ({
        id: g.id,
        label: g.label,
        color: g.color,
        value: Number(Math.max(0, g.buckets[idx]).toFixed(6)),
      }));
      return {
        label: p.label,
        value: Number(parts.reduce((s, part) => s + part.value, 0).toFixed(6)),
        parts,
      };
    });
  }, [selectedRows, selection.kind, effectiveTimeFilter, meterReadings, activeYearAndMonth.year]);

  const totalSelectedTons = useMemo(
    () => Number(selectedRows.reduce((s, r) => s + r.tons, 0).toFixed(6)),
    [selectedRows],
  );

  const selectedWithLocalShare = useMemo(
    () =>
      selectedRows.map((row) => ({
        ...row,
        localShare:
          totalSelectedTons > 0
            ? Number(((row.tons / totalSelectedTons) * 100).toFixed(1))
            : 0,
      })),
    [selectedRows, totalSelectedTons],
  );

  const scopeTotals = useMemo(() => {
    const total = computedRows.reduce((s, r) => s + r.tons, 0);
    return GHG_SCOPES.map((sc) => {
      const rows = computedRows.filter((r) => r.scope === sc.id);
      const tons = Number(rows.reduce((s, r) => s + r.tons, 0).toFixed(6));
      const share = total > 0 ? Number(((tons / total) * 100).toFixed(1)) : 0;
      return { ...sc, tons, share, count: rows.length };
    });
  }, [computedRows]);

  const grandTotalTons = useMemo(
    () => Number(computedRows.reduce((s, r) => s + r.tons, 0).toFixed(6)),
    [computedRows],
  );

  const filteredTree = useMemo(() => {
    const q = search.trim().toLowerCase();
    return GHG_SCOPES.map((sc) => {
      const items = computedRows.filter(
        (r) =>
          r.scope === sc.id &&
          (!q || r.name.toLowerCase().includes(q) || sc.label.toLowerCase().includes(q)),
      );
      return { ...sc, items };
    });
  }, [computedRows, search]);

  const pieSlices = useMemo(() => {
    if (selection.kind === "all") {
      return scopeTotals.map((sc) => ({
        id: `scope-${sc.id}`,
        label: sc.label,
        tons: sc.tons,
        share: sc.share,
        color: SCOPE_COLORS[sc.id].bar,
      }));
    }
    return selectedWithLocalShare.map((row, idx) => ({
      id: row.id,
      label: row.name,
      tons: row.tons,
      share: row.localShare,
      color: SOURCE_PALETTE[idx % SOURCE_PALETTE.length],
    }));
  }, [selection, scopeTotals, selectedWithLocalShare]);

  const headerTitle = useMemo(() => {
    if (selection.kind === "all") return "Tổng quan phát thải khí nhà kính";
    if (selection.kind === "scope") {
      const sc = GHG_SCOPES.find((s) => s.id === selection.scope);
      return sc ? `${sc.label} — ${sc.desc}` : "Phạm vi phát thải";
    }
    const row = computedRows.find((r) => r.id === selection.sourceId);
    return row ? row.name : "Nguồn phát thải";
  }, [selection, computedRows]);

  const headerSubtitle = useMemo(() => {
    if (selection.kind === "all") {
      return `Tổng hợp tất cả ${computedRows.length} nguồn phát thải thuộc 3 phạm vi (Scope 1, 2, 3)`;
    }
    if (selection.kind === "scope") {
      return `${selectedRows.length} nguồn phát thải trong Phạm vi ${selection.scope}`;
    }
    const row = computedRows.find((r) => r.id === selection.sourceId);
    if (!row) return "";
    return `Phạm vi ${row.scope} · Phương thức: ${
      row.method === "meter"
        ? "Từ điểm đo"
        : row.method === "manual"
          ? "Nhập số liệu"
          : "Import Excel / File"
    }`;
  }, [selection, computedRows, selectedRows.length]);

  function toggleScopeExpand(scope: ScopeId) {
    setExpandedScopes((prev) => ({ ...prev, [scope]: !prev[scope] }));
  }

  function openManualEdit(source: GhgEmissionSource) {
    const initialYear = activeYearAndMonth.year;
    setEditingSource(source);
    setModalYear(initialYear);
    setImportNotice("");

    // Khởi tạo dữ liệu nháp từ manualMonthly hiện có (hoặc tương thích manualValue cũ)
    const draft: Record<string, string> = {};
    if (source.manualMonthly && Object.keys(source.manualMonthly).length > 0) {
      for (const [k, v] of Object.entries(source.manualMonthly)) {
        if (Number.isFinite(v) && v > 0) {
          draft[k] = formatAppNumber(v, { maxDecimals: 6 });
        }
      }
    } else if (source.manualValue != null && source.manualValue > 0) {
      const fallbackKey =
        source.appliedAt && /^\d{4}-\d{2}/.test(source.appliedAt)
          ? source.appliedAt.slice(0, 7)
          : `${initialYear}-${String(activeYearAndMonth.month).padStart(2, "0")}`;
      draft[fallbackKey] = formatAppNumber(source.manualValue, { maxDecimals: 6 });
    }
    setDraftMonthly(draft);
  }

  function updateMonthDraft(year: number, month: number, rawInput: string) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    setDraftMonthly((prev) => ({
      ...prev,
      [key]: formatLiveNumberInput(rawInput),
    }));
  }

  function blurMonthDraft(year: number, month: number) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    setDraftMonthly((prev) => {
      const current = prev[key] ?? "";
      if (!current.trim()) return prev;
      return {
        ...prev,
        [key]: formatAppNumberInput(current, 6),
      };
    });
  }

  function handlePasteIntoMonth(startMonth: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text/plain");
    if (!text || (!text.includes("\n") && !text.includes("\t"))) return;
    e.preventDefault();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    setDraftMonthly((prev) => {
      const next = { ...prev };
      let mCursor = startMonth;
      for (const line of lines) {
        if (mCursor > 12) break;
        const cells = line.split(/\t|;/).map((c) => c.trim());
        for (const cell of cells) {
          if (!/\d/.test(cell)) continue;
          const num = parseAppNumber(cell, Number.NaN);
          if (Number.isFinite(num) && num >= 0) {
            const key = `${modalYear}-${String(mCursor).padStart(2, "0")}`;
            next[key] = num > 0 ? formatAppNumber(num, { maxDecimals: 6 }) : "";
            mCursor += 1;
            break;
          }
        }
      }
      return next;
    });
    setImportNotice("Đã dán và tự động chuẩn hóa định dạng số liệu từ Clipboard.");
  }

  async function handleImportExcelFile(file: File) {
    try {
      const monthMap = await parseMonthlyExcelOrCsvFile(file);
      const count = Object.keys(monthMap).length;
      if (count === 0) {
        setImportNotice("Không tìm thấy dữ liệu số hợp lệ trong file đã chọn.");
        return;
      }
      setDraftMonthly((prev) => {
        const next = { ...prev };
        for (let m = 1; m <= 12; m += 1) {
          const val = monthMap[m];
          if (val !== undefined && Number.isFinite(val)) {
            const key = `${modalYear}-${String(m).padStart(2, "0")}`;
            next[key] = val > 0 ? formatAppNumber(val, { maxDecimals: 6 }) : "";
          }
        }
        return next;
      });
      setImportNotice(
        `Đã nhập ${count} tháng cho năm ${modalYear} từ file "${file.name}" và chuẩn hóa định dạng số.`,
      );
    } catch {
      setImportNotice("Không thể đọc file. Vui lòng sử dụng file .xlsx hoặc .csv hợp lệ.");
    }
  }

  function handleDownloadTemplate() {
    if (!editingSource) return;
    const fixedUnit = editingSource.manualUnit || "lít";
    const rows = Array.from({ length: 12 }, (_, idx) => {
      const m = idx + 1;
      const key = `${modalYear}-${String(m).padStart(2, "0")}`;
      const rawStr = draftMonthly[key] ?? "";
      const val = rawStr.trim() ? parseAppNumber(rawStr, 0) : 0;
      return [`Tháng ${m}`, val > 0 ? formatAppNumber(val, { maxDecimals: 6 }) : "0", fixedUnit];
    });
    exportToExcel({
      filename: `Mau-so-lieu-12-thang-${modalYear}.xlsx`,
      sheetName: `Nam_${modalYear}`,
      title: `BẢNG SỐ LIỆU HOẠT ĐỘNG 12 THÁNG - NĂM ${modalYear}`,
      subtitle: `${editingSource.name} (Đơn vị cố định: ${fixedUnit})`,
      columns: [
        { header: "Tháng", width: 16 },
        { header: "Số liệu hoạt động", width: 24 },
        { header: "Đơn vị cố định", width: 18 },
      ],
      rows,
    });
  }

  function saveManualEdit() {
    if (!editingSource) return;

    const nextMonthly: Record<string, number> = {};
    for (const [k, raw] of Object.entries(draftMonthly)) {
      if (!/^\d{4}-\d{2}$/.test(k)) continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const num = parseAppNumber(trimmed, Number.NaN);
      if (Number.isFinite(num) && num >= 0) {
        nextMonthly[k] = num;
      }
    }

    // Tính tổng năm hiện tại để đồng bộ vào trường manualValue / tons dự phòng
    let modalYearSum = 0;
    for (let m = 1; m <= 12; m += 1) {
      const k = `${modalYear}-${String(m).padStart(2, "0")}`;
      modalYearSum += nextMonthly[k] ?? 0;
    }
    const activeMonthKey = `${activeYearAndMonth.year}-${String(activeYearAndMonth.month).padStart(2, "0")}`;
    const representativeVal = nextMonthly[activeMonthKey] ?? modalYearSum;

    const next = rawSources.map((src) => {
      if (src.id !== editingSource.id) return src;
      const updated: GhgEmissionSource = {
        ...src,
        manualMonthly: nextMonthly,
        manualValue: Number(representativeVal.toFixed(6)),
      };
      return {
        ...updated,
        tons: computeManualTons(updated, representativeVal) ?? src.tons,
      };
    });
    setRawSources(next);
    saveGhgSources(next, projectId);
    setEditingSource(null);
  }

  return (
    <div className="mx-auto max-w-[1600px] p-4 sm:p-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[310px_minmax(0,1fr)]">
        {/* Cột trái: Cây phân cấp phát thải */}
        <aside className="self-start rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs lg:sticky lg:top-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-bold tracking-wider text-slate-500 uppercase">
              Danh mục nguồn phát thải
            </h2>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
              {computedRows.length} nguồn
            </span>
          </div>

          {/* Ô tìm kiếm */}
          <div className="relative mb-3">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm nguồn phát thải..."
              className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 pr-3 pl-8 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white"
            />
          </div>

          {/* Nút Tổng quan */}
          <button
            type="button"
            onClick={() => setSelection({ kind: "all" })}
            className={`mb-2 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition-all ${
              selection.kind === "all"
                ? "bg-emerald-600 text-white shadow-xs"
                : "bg-slate-50 text-slate-700 hover:bg-slate-100"
            }`}
          >
            <span className="flex items-center gap-2">
              <GlobeIcon className="h-4 w-4" />
              <span>Tổng hợp toàn nhà máy</span>
            </span>
            <span
              className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] ${
                selection.kind === "all"
                  ? "bg-white/20 text-white"
                  : "bg-white text-slate-600"
              }`}
            >
              {formatNumber(grandTotalTons)} t
            </span>
          </button>

          {/* Cây Scope 1, 2, 3 */}
          <div className="space-y-1.5">
            {filteredTree.map((sc) => {
              const scopeActive =
                selection.kind === "scope" && selection.scope === sc.id;
              const isOpen = expandedScopes[sc.id];
              const scTotal = scopeTotals.find((s) => s.id === sc.id)?.tons ?? 0;
              const colors = SCOPE_COLORS[sc.id];

              return (
                <div
                  key={sc.id}
                  className="overflow-hidden rounded-xl border border-slate-100 bg-slate-50/50"
                >
                  <div
                    className={`flex items-center justify-between px-2.5 py-2 transition-colors ${
                      scopeActive
                        ? "bg-emerald-50 text-emerald-900"
                        : "hover:bg-slate-100/80"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelection({ kind: "scope", scope: sc.id })}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: colors.dot }}
                      />
                      <span className="truncate text-xs font-bold text-slate-800">
                        {sc.label}
                      </span>
                      <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200/70">
                        {formatNumber(scTotal)} t
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleScopeExpand(sc.id)}
                      aria-label={`Thu gọn / mở rộng ${sc.label}`}
                      className="ml-1 flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-600"
                    >
                      <ChevronDownIcon
                        className={`h-3.5 w-3.5 transition-transform ${
                          isOpen ? "rotate-0" : "-rotate-90"
                        }`}
                      />
                    </button>
                  </div>

                  {isOpen && (
                    <ul className="space-y-0.5 border-t border-slate-100 bg-white p-1.5">
                      {sc.items.map((item) => {
                        const active =
                          selection.kind === "source" && selection.sourceId === item.id;
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() =>
                                setSelection({ kind: "source", sourceId: item.id })
                              }
                              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                                active
                                  ? "bg-emerald-50 font-semibold text-emerald-800 ring-1 ring-emerald-200"
                                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                              }`}
                            >
                              <span className="min-w-0 flex-1 truncate">{item.name}</span>
                              <span className="shrink-0 font-mono text-[11px] text-slate-500">
                                {formatNumber(item.tons)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                      {sc.items.length === 0 && (
                        <li className="px-2.5 py-2 text-[11px] text-slate-400">
                          Không có nguồn phù hợp
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        {/* Khu vực chính */}
        <div className="space-y-6">
          {/* Header ngữ cảnh + Bộ lọc thời gian */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-xs">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-900">{headerTitle}</h1>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  {formatNumber(totalSelectedTons)} tấn CO₂e
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                  {getTimeFilterLabel(effectiveTimeFilter)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{headerSubtitle}</p>
            </div>
            <TimeFilterBar
              value={effectiveTimeFilter}
              onChange={setTimeFilter}
              allowedModes={allowedModes}
            />
          </div>

          {/* 3 thẻ KPI Phạm vi 1, 2, 3 khi xem Tổng quan */}
          {selection.kind === "all" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {scopeTotals.map((sc) => {
                const colors = SCOPE_COLORS[sc.id];
                return (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => setSelection({ kind: "scope", scope: sc.id })}
                    className="group rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-xs transition-all hover:border-emerald-300 hover:shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                        style={{
                          backgroundColor: colors.badgeBg,
                          color: colors.badgeText,
                        }}
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: colors.dot }}
                        />
                        {sc.label} ({sc.short})
                      </span>
                      <span className="text-xs font-semibold text-slate-400 group-hover:text-emerald-600">
                        {sc.count} nguồn →
                      </span>
                    </div>
                    <div className="mt-3 flex items-baseline justify-between">
                      <div>
                        <span className="font-mono text-2xl font-bold text-slate-900">
                          {formatNumber(sc.tons)}
                        </span>
                        <span className="ml-1.5 text-xs text-slate-500">tấn CO₂e</span>
                      </div>
                      <span className="font-mono text-sm font-semibold text-slate-700">
                        {formatNumber(sc.share, 1)}%
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">{sc.desc}</p>
                  </button>
                );
              })}
            </div>
          )}

          {/* Hàng trên: Bảng chi tiết + Biểu đồ tròn */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-bold tracking-wider text-slate-800 uppercase">
                    Chi tiết phát thải (Tấn CO₂e)
                  </h2>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {selection.kind === "all"
                      ? `Tổng hợp ${selectedWithLocalShare.length} nguồn phát thải (${formatNumber(totalSelectedTons)} tấn CO₂e)`
                      : `Hiển thị ${selectedWithLocalShare.length} mục đã chọn`}
                  </p>
                </div>
                {selection.kind !== "all" && (
                  <button
                    type="button"
                    onClick={() => setSelection({ kind: "all" })}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Xem tất cả
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-400 uppercase">
                      <th className="pb-2.5">Hạng mục</th>
                      <th className="pb-2.5">Phạm vi</th>
                      <th className="pb-2.5">Số liệu</th>
                      <th className="pb-2.5 text-right">Giá trị (Tấn)</th>
                      <th className="pb-2.5 text-right">Tỷ trọng (%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedWithLocalShare.map((row) => {
                      const colors = SCOPE_COLORS[row.scope];
                      const fixedUnit = row.manualUnit || "lít";
                      return (
                        <tr
                          key={row.id}
                          onClick={() =>
                            setSelection({ kind: "source", sourceId: row.id })
                          }
                          className="cursor-pointer text-slate-700 transition-colors hover:bg-slate-50/80"
                        >
                          <td className="py-3 pr-2 font-medium text-slate-800">
                            {row.name}
                          </td>
                          <td className="py-3 pr-2">
                            <span
                              className="inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold"
                              style={{
                                backgroundColor: colors.badgeBg,
                                color: colors.badgeText,
                              }}
                            >
                              Phạm vi {row.scope}
                            </span>
                          </td>
                          <td
                            className="py-3 pr-2"
                            onClick={(e) => {
                              if (row.method !== "meter") {
                                e.stopPropagation();
                                openManualEdit(row);
                              }
                            }}
                          >
                            {row.method === "meter" ? (
                              <span className="text-[11px] text-slate-400">Từ điểm đo</span>
                            ) : (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                                title="Nhấn để nhập bảng số liệu 12 tháng hoặc import từ Excel"
                              >
                                {row.activityValue != null && row.activityValue > 0 ? (
                                  <>
                                    {formatNumber(row.activityValue)} {fixedUnit}
                                  </>
                                ) : (
                                  "+ Nhập số liệu"
                                )}
                              </button>
                            )}
                          </td>
                          <td className="py-3 text-right font-mono text-slate-800">
                            {formatNumber(row.tons)}
                          </td>
                          <td className="py-3 text-right font-mono font-semibold text-slate-900">
                            {formatNumber(row.localShare, 1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Thanh tỷ trọng trực quan */}
              <div className="mt-6 border-t border-slate-100 pt-5">
                <h3 className="mb-4 text-xs font-bold tracking-wider text-slate-800 uppercase">
                  Biểu đồ tỷ trọng phát thải
                </h3>
                <div className="space-y-3.5">
                  {(selection.kind === "all"
                    ? scopeTotals.map((sc) => ({
                        id: `bar-scope-${sc.id}`,
                        label: `${sc.label} (${sc.short}) — ${sc.desc}`,
                        share: sc.share,
                        color: SCOPE_COLORS[sc.id].bar,
                      }))
                    : selectedWithLocalShare.map((row, idx) => ({
                        id: row.id,
                        label: `${row.name} (Phạm vi ${row.scope})`,
                        share: row.localShare,
                        color: SOURCE_PALETTE[idx % SOURCE_PALETTE.length],
                      }))
                  ).map((bar) => (
                    <div key={bar.id}>
                      <div className="mb-1 flex justify-between text-xs text-slate-700">
                        <span className="truncate pr-2">{bar.label}</span>
                        <span className="font-semibold">{formatNumber(bar.share, 1)}%</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, bar.share)}%`,
                            backgroundColor: bar.color,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Biểu đồ tròn */}
            <section className="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-bold tracking-wider text-slate-800 uppercase">
                  {selection.kind === "all"
                    ? "Cơ cấu theo phạm vi (Scope 1, 2, 3)"
                    : "Biểu đồ tròn phát thải"}
                </h2>
                <span className="text-[11px] text-slate-400">Đơn vị: %</span>
              </div>
              <div className="flex flex-1 flex-col items-center justify-center py-4">
                <PieChart slices={pieSlices} total={totalSelectedTons} />
              </div>
            </section>
          </div>

          {/* Biểu đồ cột theo thời gian */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-bold tracking-wider text-slate-800 uppercase">
                  Biểu đồ cột theo thời gian
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Lượng phát thải (Tấn CO₂e) của mục đang chọn ·{" "}
                  {getTimeFilterLabel(effectiveTimeFilter)}
                </p>
              </div>
            </div>
            <BarChart data={barData} />
          </section>
        </div>
      </div>

      {/* Modal nhập bảng số liệu 12 tháng cho nguồn thủ công / import file */}
      {editingSource && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-3 sm:p-4 backdrop-blur-[1px]"
          onClick={() => setEditingSource(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Modal: Tiêu đề bên trái + Chọn năm ở góc trên bên phải */}
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Nhập số liệu</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {editingSource.name} · Phạm vi {editingSource.scope}
                </p>
                <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                  <span>Đơn vị cố định (cấu hình Quản trị):</span>
                  <strong className="font-semibold text-emerald-700">
                    {editingSource.manualUnit || "lít"}
                  </strong>
                </div>
              </div>

              {/* Góc trên bên phải: Lựa chọn năm nhập số liệu */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">Năm số liệu:</span>
                <div className="relative min-w-[116px]">
                  <CustomSelect
                    value={modalYear}
                    onChange={(e) => {
                      setModalYear(Number(e.target.value));
                      setImportNotice("");
                    }}
                    className="h-9 w-full cursor-pointer appearance-none rounded-xl border border-emerald-200 bg-emerald-50/70 pr-8 pl-3 text-xs font-bold text-emerald-900 shadow-xs outline-none transition-colors hover:border-emerald-300 focus:border-emerald-500"
                  >
                    {ENTRY_YEARS.map((y) => (
                      <option key={y} value={y}>
                        Năm {y}
                      </option>
                    ))}
                  </CustomSelect>
                  <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-emerald-700">
                    ▾
                  </span>
                </div>
              </div>
            </div>

            {/* Thanh công cụ Import Excel / Tải file mẫu */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-5 py-2.5">
              <span className="text-[11px] text-slate-500">
                Định dạng chuẩn: dấu cách ngăn cách hàng nghìn, dấu phẩy thập phân (VD:{" "}
                <strong className="font-mono text-slate-700">43 215,5</strong>)
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.csv,.txt,.tsv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImportExcelFile(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 text-xs font-semibold text-emerald-700 shadow-2xs hover:bg-emerald-50 transition-colors"
                >
                  <span>↑ Import từ Excel / CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 shadow-2xs hover:bg-slate-100 transition-colors"
                >
                  <span>↓ Tải file mẫu (.xlsx)</span>
                </button>
              </div>
            </div>

            {importNotice ? (
              <div className="border-b border-emerald-100 bg-emerald-50/70 px-5 py-2 text-xs font-medium text-emerald-800">
                {importNotice}
              </div>
            ) : null}

            {/* Bảng nhập số liệu 12 tháng */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase">
                    <tr>
                      <th className="w-28 px-3.5 py-2.5">Tháng</th>
                      <th className="px-3.5 py-2.5">Khối lượng / Số liệu</th>
                      <th className="w-28 px-3.5 py-2.5 text-center">Đơn vị</th>
                      <th className="w-40 px-3.5 py-2.5 text-right">Phát thải (Tấn CO₂e)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Array.from({ length: 12 }, (_, idx) => {
                      const m = idx + 1;
                      const key = `${modalYear}-${String(m).padStart(2, "0")}`;
                      const rawStr = draftMonthly[key] ?? "";
                      const parsedVal = rawStr.trim() ? parseAppNumber(rawStr, 0) : 0;
                      const monthTons =
                        parsedVal > 0 ? (computeManualTons(editingSource, parsedVal) ?? 0) : 0;
                      const isCurrentActiveMonth =
                        modalYear === activeYearAndMonth.year &&
                        m === activeYearAndMonth.month;
                      const fixedUnit = editingSource.manualUnit || "lít";

                      return (
                        <tr
                          key={m}
                          className={
                            isCurrentActiveMonth
                              ? "bg-emerald-50/35"
                              : "hover:bg-slate-50/60"
                          }
                        >
                          <td className="px-3.5 py-2 font-semibold text-slate-800">
                            <span>Tháng {m}</span>
                            {isCurrentActiveMonth ? (
                              <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            ) : null}
                          </td>
                          <td className="px-3.5 py-1.5">
                            <input
                              value={rawStr}
                              onChange={(e) => updateMonthDraft(modalYear, m, e.target.value)}
                              onBlur={() => blurMonthDraft(modalYear, m)}
                              onPaste={(e) => handlePasteIntoMonth(m, e)}
                              inputMode="decimal"
                              placeholder="0"
                              className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs font-semibold text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                            />
                          </td>
                          <td className="px-3.5 py-2 text-center">
                            <span className="inline-flex rounded-md bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
                              {fixedUnit}
                            </span>
                          </td>
                          <td className="px-3.5 py-2 text-right font-mono font-semibold text-slate-800">
                            {formatNumber(monthTons)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-900">
                    {(() => {
                      let sumAct = 0;
                      let sumTons = 0;
                      for (let m = 1; m <= 12; m += 1) {
                        const key = `${modalYear}-${String(m).padStart(2, "0")}`;
                        const rawStr = draftMonthly[key] ?? "";
                        const val = rawStr.trim() ? parseAppNumber(rawStr, 0) : 0;
                        if (val > 0) {
                          sumAct += val;
                          sumTons += computeManualTons(editingSource, val) ?? 0;
                        }
                      }
                      const fixedUnit = editingSource.manualUnit || "lít";
                      return (
                        <tr>
                          <td className="px-3.5 py-2.5">Tổng năm {modalYear}</td>
                          <td className="px-3.5 py-2.5 font-mono text-emerald-700">
                            {formatNumber(sumAct)}
                          </td>
                          <td className="px-3.5 py-2.5 text-center text-slate-600">
                            {fixedUnit}
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-mono text-emerald-700">
                            {formatNumber(sumTons)} tấn
                          </td>
                        </tr>
                      );
                    })()}
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Footer Modal */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3.5">
              <p className="text-[11px] text-slate-400">
                Hệ thống tính tấn CO₂e theo công thức đã cấu hình của nguồn này.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingSource(null)}
                  className="h-9 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={saveManualEdit}
                  className="h-9 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  Lưu số liệu
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Biểu đồ tròn ---------- */
function PieChart({
  slices,
  total,
}: {
  slices: { id: string; label: string; tons: number; share: number; color: string }[];
  total: number;
}) {
  const radius = 86;
  const strokeWidth = 38;
  const circumference = 2 * Math.PI * radius;

  const segments = slices.reduce<
    {
      id: string;
      label: string;
      tons: number;
      share: number;
      color: string;
      dash: number;
      offset: number;
    }[]
  >((acc, slice) => {
    const prevSum = acc.reduce((s, item) => s + item.share, 0);
    const dash = (slice.share / 100) * circumference;
    const offset = -((prevSum / 100) * circumference);
    acc.push({ ...slice, dash, offset });
    return acc;
  }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative flex items-center justify-center">
        <svg viewBox="0 0 240 240" className="h-52 w-52 -rotate-90">
          <circle
            cx="120"
            cy="120"
            r={radius}
            fill="none"
            stroke="#f1f5f9"
            strokeWidth={strokeWidth}
          />
          {segments.map((seg) => (
            <circle
              key={seg.id}
              cx="120"
              cy="120"
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${seg.dash} ${circumference}`}
              strokeDashoffset={seg.offset}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-mono text-xl font-bold text-slate-900">
            {formatNumber(total)}
          </span>
          <span className="text-[11px] text-slate-400">tấn CO₂e</span>
        </div>
      </div>

      {/* Chú giải */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-[11px] text-slate-600">
        {slices.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-xs"
              style={{ backgroundColor: s.color }}
            />
            <span className="max-w-[200px] truncate">{s.label}</span>
            <strong className="font-mono text-slate-800">
              {formatNumber(s.share, 1)}%
            </strong>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- Biểu đồ cột thời gian ---------- */
type StackPart = { id: string; label: string; color: string; value: number };

function BarChart({ data }: { data: { label: string; value: number; parts: StackPart[] }[] }) {
  const maxVal = Math.max(...data.map((d) => d.value), 0);
  const niceMax = maxVal <= 0 ? 1 : maxVal * 1.15;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) =>
    Number((niceMax * t).toFixed(maxVal < 1 ? 4 : 1)),
  );
  const chartHeight = 200;

  return (
    <div className="w-full overflow-x-auto">
      <div className="min-w-[680px]">
        <div className="relative flex" style={{ height: chartHeight }}>
          {/* Trục Y */}
          <div className="flex w-16 flex-col justify-between pr-2 text-right font-mono text-[10px] text-slate-400">
            {[...ticks].reverse().map((t, i) => (
              <span key={i}>{formatNumber(t, maxVal < 1 ? 4 : 1)}</span>
            ))}
          </div>

          {/* Lưới + các cột */}
          <div className="relative flex-1 border-b border-l border-slate-200">
            {[0, 0.25, 0.5, 0.75].map((r, i) => (
              <div
                key={i}
                className="pointer-events-none absolute right-0 left-0 border-t border-dashed border-slate-100"
                style={{ top: `${r * 100}%` }}
              />
            ))}

            <div className="relative z-10 flex h-full items-end justify-around gap-1 px-2">
              {data.map((d, idx) => {
                const heightPct = niceMax > 0 ? Math.min(100, (d.value / niceMax) * 100) : 0;
                const parts = d.parts.filter((part) => part.value > 0);
                const leftHalf = idx < data.length / 2;
                return (
                  <div
                    key={idx}
                    className="group relative flex h-full flex-1 flex-col items-center justify-end"
                  >
                    {/* Tooltip: tổng + từng phần (giá trị, %) */}
                    <div
                      className={`pointer-events-none absolute top-1 z-20 hidden min-w-[190px] rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] whitespace-nowrap shadow-lg group-hover:block ${
                        leftHalf ? "left-1/2 ml-3" : "right-1/2 mr-3"
                      }`}
                    >
                      <p className="font-semibold text-slate-500">{d.label}</p>
                      <p className="mt-0.5 font-bold text-slate-800">
                        Tổng: <span className="font-mono">{formatNumber(d.value)}</span> tấn CO₂e
                      </p>
                      {d.parts.length > 1 || (d.parts.length === 1 && d.parts[0].label) ? (
                        <div className="mt-1 space-y-0.5">
                          {d.parts.map((part) => (
                            <div key={part.id} className="flex items-center gap-1.5">
                              <span className="h-2 w-2 shrink-0 rounded-xs" style={{ backgroundColor: part.color }} />
                              <span className="max-w-[140px] truncate text-slate-600">{part.label}</span>
                              <span className="ml-auto pl-2 font-mono font-semibold" style={{ color: part.color }}>
                                {formatNumber(part.value)} t (
                                {formatNumber(d.value > 0 ? (part.value / d.value) * 100 : 0, 1)}%)
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {/* Cột xếp chồng: phần đầu tiên nằm dưới cùng */}
                    <div
                      className="flex w-full max-w-[26px] flex-col-reverse overflow-hidden rounded-t-md transition-opacity group-hover:opacity-85"
                      style={{ height: `${heightPct}%` }}
                    >
                      {parts.map((part) => (
                        <div
                          key={part.id}
                          className="w-full shrink-0 border-t border-white/60 first:border-t-0"
                          style={{
                            height: `${d.value > 0 ? (part.value / d.value) * 100 : 0}%`,
                            backgroundColor: part.color,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Nhãn trục X */}
        <div className="mt-2 flex pl-16">
          <div className="flex flex-1 justify-around gap-1 px-2 text-[10px] text-slate-400">
            {data.map((d, idx) => {
              const show =
                data.length <= 14 || idx % 2 === 0 || idx === data.length - 1;
              return (
                <span key={idx} className="flex-1 text-center">
                  {show ? d.label : ""}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Icons ---------- */
function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
