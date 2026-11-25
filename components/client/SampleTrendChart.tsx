"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChartSize } from "@/components/client/useChartSize";
import { useChartShowMarkers } from "@/lib/chart-display";
import { exportToExcel } from "@/lib/excel-export";
import type { ChartSample } from "@/lib/gateway-series";
import { formatAppNumber } from "@/lib/number-format";
import { vietnamFromDate } from "@/lib/vietnam-time";

/**
 * Chiều cao vùng vẽ cho tab chỉ có MỘT biểu đồ (Tần số, Công suất, Hệ số công suất): cao theo màn hình
 * để không thừa khoảng trống bên dưới; tối thiểu bằng chiều cao mặc định.
 */
export const TREND_FILL_HEIGHT = "h-[360px] sm:h-[max(430px,calc(100dvh-420px))]";

export type TrendSeriesConfig = {
  key: string;
  label: string;
  /** Nhãn cột ngắn gọn khi hiển thị trong bảng Table Data (nếu không truyền sẽ dùng label). */
  tableLabel?: string;
  color: string;
  unit?: string;
  digits?: number;
  /** Lấy giá trị từ 1 mẫu sample. Nếu không truyền sẽ lấy sample.values[key]. */
  extract?: (sample: ChartSample) => number | null;
};

type ParsedSample = {
  raw: ChartSample;
  timeMs: number;
  timeText: string; // YYYY-MM-DD HH:mm:ss (giờ VN)
  shortTimeText: string; // HH:mm:ss
  gapId: number; // Tăng lên 1 khi có khoảng đứt quãng mất dữ liệu thực sự giữa 2 mẫu gốc liên tiếp
};

function parseSampleTimeMs(at: string | undefined): number | null {
  if (!at) return null;
  const trimmed = at.trim();
  const iso = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const withZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
  const parsed = Date.parse(withZone);
  if (Number.isFinite(parsed)) return parsed;
  const match = trimmed.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

export function formatVietnamTimestamp(timeMs: number): string {
  const parts = vietnamFromDate(new Date(timeMs));
  const y = parts.year;
  const m = String(parts.month).padStart(2, "0");
  const d = String(parts.day).padStart(2, "0");
  const hh = String(parts.hour).padStart(2, "0");
  const mm = String(parts.minute).padStart(2, "0");
  const ss = String(parts.second).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function formatAxisTick(timeMs: number, spanMs: number, isFirst = false): string {
  const parts = vietnamFromDate(new Date(timeMs));
  const m = String(parts.month).padStart(2, "0");
  const d = String(parts.day).padStart(2, "0");
  const hh = String(parts.hour).padStart(2, "0");
  const mm = String(parts.minute).padStart(2, "0");
  const ss = String(parts.second).padStart(2, "0");
  if (spanMs > 36 * 3600 * 1000) {
    return `${d}/${m} ${hh}:${mm}`;
  }
  if (spanMs <= 2 * 3600 * 1000) {
    return `${hh}:${mm}:${ss}`;
  }
  if (isFirst && spanMs > 24 * 3600 * 1000) {
    return `${d}/${m} ${hh}:${mm}`;
  }
  return `${hh}:${mm}`;
}

function formatHandleTime(timeMs: number, spanMs: number): string {
  const parts = vietnamFromDate(new Date(timeMs));
  const m = String(parts.month).padStart(2, "0");
  const d = String(parts.day).padStart(2, "0");
  const hh = String(parts.hour).padStart(2, "0");
  const mm = String(parts.minute).padStart(2, "0");
  const ss = String(parts.second).padStart(2, "0");
  if (spanMs > 36 * 3600 * 1000) {
    return `${d}/${m} ${hh}:${mm}`;
  }
  return `${hh}:${mm}:${ss}`;
}

const VIRTUAL_ROW_HEIGHT = 35;
const VIRTUAL_VIEWPORT_HEIGHT = 500;

export function SampleTrendChart({
  title,
  unitLabel,
  series,
  samples,
  onRefresh,
  headerControls,
  heightClass = "h-[360px] sm:h-[430px]",
  startAtZero = false,
  gapMinutes = 15,
}: {
  title: string;
  unitLabel: string;
  series: TrendSeriesConfig[];
  samples?: ChartSample[];
  onRefresh?: () => void;
  headerControls?: React.ReactNode;
  heightClass?: string;
  startAtZero?: boolean;
  /** Khoảng cách tối đa giữa 2 bản tin liên tiếp (phút) trước khi ngắt nét để hiển thị mất dữ liệu (loss data). */
  gapMinutes?: number;
}) {
  // Dấu chấm tại từng điểm dữ liệu: bật / tắt ở Cấu hình → Tham số biểu đồ (mặc định ẩn).
  const showMarkers = useChartShowMarkers();
  const [tableMode, setTableMode] = useState(false);
  const [tableScope, setTableScope] = useState<"all" | "zoom">("all");
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const [zoom, setZoom] = useState<{ startPct: number; endPct: number }>({ startPct: 0, endPct: 1 });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [boxSelect, setBoxSelect] = useState<{ startX: number; currentX: number } | null>(null);
  const sliderRef = useRef<HTMLDivElement | null>(null);

  const { parsedSamples, medianStepSec, gapThresholdMs } = useMemo(() => {
    const baseMs = gapMinutes * 60 * 1000;
    if (!samples?.length) {
      return { parsedSamples: [] as ParsedSample[], medianStepSec: 10, gapThresholdMs: baseMs };
    }
    const list: ParsedSample[] = [];
    for (const s of samples) {
      const timeMs = parseSampleTimeMs(s.at);
      if (timeMs == null) continue;
      const timeText = formatVietnamTimestamp(timeMs);
      list.push({
        raw: s,
        timeMs,
        timeText,
        shortTimeText: timeText.slice(11, 19),
        gapId: 0,
      });
    }
    list.sort((a, b) => a.timeMs - b.timeMs);
    const deduped: ParsedSample[] = [];
    for (const item of list) {
      if (deduped.length > 0 && deduped[deduped.length - 1].timeText === item.timeText) {
        deduped[deduped.length - 1] = item;
      } else {
        deduped.push(item);
      }
    }
    if (deduped.length < 3) {
      return { parsedSamples: deduped, medianStepSec: 10, gapThresholdMs: baseMs };
    }
    const diffs: number[] = [];
    const stride = Math.max(1, Math.floor(deduped.length / 400));
    for (let i = stride; i < deduped.length; i += stride) {
      const d = (deduped[i].timeMs - deduped[i - stride].timeMs) / stride;
      if (d > 0) diffs.push(d);
    }
    let stepSec = 10;
    let dynamicGap = baseMs;
    if (diffs.length) {
      diffs.sort((a, b) => a - b);
      const median = diffs[Math.floor(diffs.length / 2)];
      stepSec = Math.max(1, Math.round(median / 1000));
      // Chỉ ngắt nét khi mất dữ liệu thực sự vượt ngưỡng gapMinutes (mặc định >= 15 phút) giữa 2 bản tin gốc liên tiếp
      dynamicGap = Math.max(baseMs, Math.min(median * 20, 6 * 3600 * 1000));
    }
    let currentGapId = 0;
    deduped[0].gapId = 0;
    for (let i = 1; i < deduped.length; i++) {
      if (deduped[i].timeMs - deduped[i - 1].timeMs > dynamicGap) {
        currentGapId += 1;
      }
      deduped[i].gapId = currentGapId;
    }
    return { parsedSamples: deduped, medianStepSec: stepSec, gapThresholdMs: dynamicGap };
  }, [samples, gapMinutes]);

  // Reset hiddenKeys if series change completely
  useEffect(() => {
    setHiddenKeys((prev) => prev.filter((k) => series.some((s) => s.key === k)));
  }, [series]);

  const activeSeries = useMemo(
    () => series.filter((s) => !hiddenKeys.includes(s.key)),
    [series, hiddenKeys],
  );

  const readVal = (sample: ChartSample, cfg: TrendSeriesConfig): number | null => {
    const v = cfg.extract ? cfg.extract(sample) : sample.values[cfg.key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  const timeBounds = useMemo(() => {
    if (!parsedSamples.length) {
      const now = Date.now();
      return { minMs: now - 3600_000, maxMs: now };
    }
    const minMs = parsedSamples[0].timeMs;
    const maxMs = parsedSamples[parsedSamples.length - 1].timeMs;
    if (maxMs <= minMs) {
      return { minMs: minMs - 1800_000, maxMs: maxMs + 1800_000 };
    }
    return { minMs, maxMs };
  }, [parsedSamples]);

  const totalSpanMs = Math.max(1, timeBounds.maxMs - timeBounds.minMs);
  const viewStartMs = timeBounds.minMs + zoom.startPct * totalSpanMs;
  const viewEndMs = timeBounds.minMs + zoom.endPct * totalSpanMs;
  const viewSpanMs = Math.max(1, viewEndMs - viewStartMs);

  const visibleSamples = useMemo(() => {
    if (!parsedSamples.length) return [];
    const minT = viewStartMs - 1000;
    const maxT = viewEndMs + 1000;
    // Binary search for start index
    let lo = 0;
    let hi = parsedSamples.length - 1;
    let startIdx = parsedSamples.length;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (parsedSamples[mid].timeMs >= minT) {
        startIdx = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    if (startIdx >= parsedSamples.length) return [];
    // Binary search for end index
    lo = startIdx;
    hi = parsedSamples.length - 1;
    let endIdx = startIdx - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (parsedSamples[mid].timeMs <= maxT) {
        endIdx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return endIdx >= startIdx ? parsedSamples.slice(startIdx, endIdx + 1) : [];
  }, [parsedSamples, viewStartMs, viewEndMs]);

  const yDomain = useMemo<[number, number]>(() => {
    // Quét toàn bộ mẫu (không lấy mẫu thưa) để không bỏ sót cực trị — nếu bỏ sót, đường vẽ sẽ vượt ra ngoài trục.
    const pool = visibleSamples.length > 0 ? visibleSamples : parsedSamples;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const item of pool) {
      for (const s of activeSeries) {
        const v = readVal(item.raw, s);
        if (v == null || !Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 250];
    if (startAtZero && min >= 0) {
      min = 0;
    }
    if (max === min) {
      const pad = Math.max(Math.abs(max) * 0.1, 1);
      return [startAtZero && min >= 0 ? 0 : min - pad, max + pad];
    }
    const span = max - min;
    const low = startAtZero && min >= 0 ? 0 : min - span * 0.12;
    const high = max + span * 0.12;
    return [low, high];
  }, [activeSeries, parsedSamples, startAtZero, visibleSamples]);

  const yTicks = useMemo(() => {
    const [min, max] = yDomain;
    const count = 6;
    const step = (max - min) / (count - 1);
    return Array.from({ length: count }, (_, i) => min + step * i);
  }, [yDomain]);

  const { ref: chartRef, width: W, height: H } = useChartSize();
  const pad = { l: 52, r: 18, t: 24, b: 30 };
  const innerW = Math.max(1, W - pad.l - pad.r);
  const innerH = Math.max(1, H - pad.t - pad.b);

  const xAtMs = (ms: number) => pad.l + ((ms - viewStartMs) / viewSpanMs) * innerW;
  const yAtVal = (v: number) => {
    const [yMin, yMax] = yDomain;
    return pad.t + ((yMax - v) / (yMax - yMin || 1)) * innerH;
  };

  const xTicks = useMemo(() => {
    const count = W < 480 ? 5 : 8;
    return Array.from({ length: count }, (_, i) => {
      const ms = viewStartMs + (viewSpanMs * i) / (count - 1);
      return {
        ms,
        x: pad.l + (innerW * i) / (count - 1),
        label: formatAxisTick(ms, viewSpanMs, i === 0),
      };
    });
  }, [W, innerW, pad.l, viewSpanMs, viewStartMs]);

  const toggleSeries = (key: string) => {
    setHiddenKeys((prev) => {
      if (prev.includes(key)) return prev.filter((item) => item !== key);
      // Cho phép ẩn hết các đường.
      return [...prev, key];
    });
  };

  // Dragging DataZoom slider (tương thích hoàn toàn với cả cảm ứng điện thoại & chuột máy tính)
  const beginSliderDrag = (
    e: React.PointerEvent<HTMLElement>,
    mode: "left" | "right" | "window",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const el = sliderRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const startClientX = e.clientX;
    const initial = { ...zoom };
    const minWindow = 0.005; // Cho phép zoom sâu tới 0.5% (tương đương vài phút trong 1 ngày)

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unsupported
    }

    const onMove = (ev: PointerEvent) => {
      const dxPct = (ev.clientX - startClientX) / width;
      if (mode === "left") {
        const nextStart = Math.max(0, Math.min(initial.endPct - minWindow, initial.startPct + dxPct));
        setZoom({ startPct: nextStart, endPct: initial.endPct });
      } else if (mode === "right") {
        const nextEnd = Math.min(1, Math.max(initial.startPct + minWindow, initial.endPct + dxPct));
        setZoom({ startPct: initial.startPct, endPct: nextEnd });
      } else {
        const winLen = initial.endPct - initial.startPct;
        let nextStart = initial.startPct + dxPct;
        if (nextStart < 0) nextStart = 0;
        if (nextStart + winLen > 1) nextStart = 1 - winLen;
        setZoom({ startPct: nextStart, endPct: nextStart + winLen });
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // Click trực tiếp lên rãnh thanh DataZoom để nhảy vùng zoom tới vị trí đó
  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = sliderRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clickPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const winLen = zoom.endPct - zoom.startPct;
    // Nếu đang ở 100%, thu hẹp xuống 25% quanh vị trí vừa chạm
    const targetLen = winLen > 0.95 ? 0.25 : winLen;
    let nextStart = clickPct - targetLen / 2;
    if (nextStart < 0) nextStart = 0;
    if (nextStart + targetLen > 1) nextStart = 1 - targetLen;
    setZoom({ startPct: nextStart, endPct: nextStart + targetLen });
  };

  const applyPresetSpan = (durationMs: number) => {
    if (totalSpanMs <= 0) return;
    const ratio = Math.max(0.005, Math.min(1, durationMs / totalSpanMs));
    const center = (zoom.startPct + zoom.endPct) / 2;
    // Nếu đang ở toàn cảnh (100%), ưu tiên zoom vào đoạn dữ liệu mới nhất ở cuối
    if (zoom.endPct - zoom.startPct > 0.98) {
      setZoom({ startPct: Math.max(0, 1 - ratio), endPct: 1 });
      return;
    }
    let nextStart = center - ratio / 2;
    if (nextStart < 0) nextStart = 0;
    if (nextStart + ratio > 1) nextStart = 1 - ratio;
    setZoom({ startPct: nextStart, endPct: nextStart + ratio });
  };

  const stepZoom = (factor: number) => {
    const currentSpan = zoom.endPct - zoom.startPct;
    const nextSpan = Math.max(0.005, Math.min(1, currentSpan * factor));
    const center = (zoom.startPct + zoom.endPct) / 2;
    let nextStart = center - nextSpan / 2;
    if (nextStart < 0) nextStart = 0;
    if (nextStart + nextSpan > 1) nextStart = 1 - nextSpan;
    setZoom({ startPct: nextStart, endPct: nextStart + nextSpan });
  };

  const handleWheelZoom = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    const relX = Math.max(0, Math.min(1, (e.clientX - box.left - pad.l) / innerW));
    const currentSpan = zoom.endPct - zoom.startPct;
    const factor = e.deltaY < 0 ? 0.78 : 1.28;
    const nextSpan = Math.max(0.005, Math.min(1, currentSpan * factor));
    const anchor = zoom.startPct + relX * currentSpan;
    let nextStart = anchor - relX * nextSpan;
    if (nextStart < 0) nextStart = 0;
    if (nextStart + nextSpan > 1) nextStart = 1 - nextSpan;
    setZoom({ startPct: nextStart, endPct: nextStart + nextSpan });
  };

  // Tìm mẫu gần nhất với thời gian targetMs bằng Binary Search O(log N)
  const findNearestVisibleIndex = (targetMs: number): number | null => {
    if (!visibleSamples.length) return null;
    let lo = 0;
    let hi = visibleSamples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (visibleSamples[mid].timeMs < targetMs) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) {
      const dPrev = Math.abs(visibleSamples[lo - 1].timeMs - targetMs);
      const dCurr = Math.abs(visibleSamples[lo].timeMs - targetMs);
      if (dPrev <= dCurr) return lo - 1;
    }
    return lo;
  };

  // Mini preview path in DataZoom slider (được giảm mẫu xuống tối đa 250 điểm để render tức thì)
  const miniPreviewPath = useMemo(() => {
    if (parsedSamples.length < 2 || !series.length) return "";
    const firstSeries = activeSeries[0] ?? series[0];
    let minV = Infinity;
    let maxV = -Infinity;
    const stride = Math.max(1, Math.floor(parsedSamples.length / 250));
    for (let i = 0; i < parsedSamples.length; i += stride) {
      const v = readVal(parsedSamples[i].raw, firstSeries);
      if (v == null) continue;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return "";
    const spanV = maxV - minV || 1;
    let d = "";
    let prevGapId: number | null = null;
    for (let i = 0; i < parsedSamples.length; i += stride) {
      const item = parsedSamples[i];
      const v = readVal(item.raw, firstSeries);
      if (v == null) continue;
      const x = ((item.timeMs - timeBounds.minMs) / totalSpanMs) * 1000;
      const y = 26 - ((v - minV) / spanV) * 20;
      const isGap = prevGapId != null && item.gapId !== prevGapId;
      d += `${prevGapId == null || isGap ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)} `;
      prevGapId = item.gapId;
    }
    return d;
  }, [activeSeries, parsedSamples, series, timeBounds.minMs, totalSpanMs]);

  const tableRowsSource = tableScope === "zoom" ? visibleSamples : parsedSamples;

  const exportTableExcel = () => {
    exportToExcel({
      filename: `${title.toLowerCase().replace(/\s+/g, "-")}-table-data`,
      sheetName: "Bảng dữ liệu",
      title: `${title} - Bảng dữ liệu`,
      columns: [
        { header: "Thời gian", width: 24 },
        ...series.map((s) => ({
          header: s.unit ? `${s.label} (${s.unit})` : s.label,
          width: 18,
        })),
      ],
      rows: tableRowsSource.map((item) => [
        item.timeText,
        ...series.map((s) => {
          const val = readVal(item.raw, s);
          return val == null ? "" : Number(val.toFixed(s.digits ?? 2));
        }),
      ]),
    });
  };

  const hoveredSample = hoverIdx != null ? visibleSamples[hoverIdx] ?? null : null;
  const isZoomed = zoom.startPct > 0.001 || zoom.endPct < 0.999;

  // Tính toán Virtual Scroll cho Table Data để mở 8,640 dòng 10s/lần không bao giờ lag
  const totalTableRows = tableRowsSource.length;
  const startRowIdx = Math.max(0, Math.floor(tableScrollTop / VIRTUAL_ROW_HEIGHT) - 8);
  const visibleRowCount = Math.ceil(VIRTUAL_VIEWPORT_HEIGHT / VIRTUAL_ROW_HEIGHT) + 16;
  const endRowIdx = Math.min(totalTableRows, startRowIdx + visibleRowCount);
  const virtualSlice = tableRowsSource.slice(startRowIdx, endRowIdx);
  const topSpacerHeight = startRowIdx * VIRTUAL_ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (totalTableRows - endRowIdx) * VIRTUAL_ROW_HEIGHT);

  return (
    <div className="w-full min-w-0 rounded-lg border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-4">
      {/* Header Title */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
        <div className="hidden sm:block sm:w-28" />
        <h3 className="flex-1 text-center text-[16px] font-bold text-slate-800">{title}</h3>
        <div className="flex items-center justify-end gap-1.5 text-[11px]">
          {parsedSamples.length > 0 ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-200">
              {medianStepSec < 60
                ? `Thời gian thực (${medianStepSec}s/lần)`
                : medianStepSec < 3600
                  ? `Tối ưu tốc độ (${Math.round(medianStepSec / 60)} phút/điểm)`
                  : `Tối ưu tốc độ (${Math.round(medianStepSec / 3600)} giờ/điểm)`}
            </span>
          ) : null}
        </div>
      </div>

      {/* Sub-header controls (dropdowns / channel selectors) */}
      {headerControls ? (
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-3 border-b border-slate-100 pb-2.5">
          {headerControls}
        </div>
      ) : null}

      {tableMode ? (
        /* Giao diện Table Data chuẩn theo ảnh 3 của server.dts-tech.vn + Virtual Scroll chống lag */
        <div className="mt-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h4 className="text-[18px] font-bold text-slate-800">Bảng dữ liệu</h4>
              {isZoomed ? (
                <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setTableScope("all");
                      setTableScrollTop(0);
                    }}
                    className={`rounded px-2.5 py-1 font-medium ${
                      tableScope === "all"
                        ? "bg-white text-slate-800 shadow-2xs"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    Toàn bộ ({parsedSamples.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTableScope("zoom");
                      setTableScrollTop(0);
                    }}
                    className={`rounded px-2.5 py-1 font-medium ${
                      tableScope === "zoom"
                        ? "bg-white text-slate-800 shadow-2xs"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    Vùng đang phóng to ({visibleSamples.length})
                  </button>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={exportTableExcel}
                disabled={tableRowsSource.length === 0}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-emerald-600 bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Xuất Excel (.xlsx)
              </button>
              <button
                type="button"
                onClick={() => setTableMode(false)}
                className="inline-flex h-8 items-center rounded bg-[#b91c1c] px-3.5 text-xs font-semibold text-white hover:bg-[#991b1b]"
              >
                Đóng
              </button>
            </div>
          </div>

          <div
            onScroll={(e) => setTableScrollTop(e.currentTarget.scrollTop)}
            className="max-h-[500px] overflow-auto border border-slate-200"
          >
            <table className="w-full min-w-[540px] border-collapse text-center text-[13px]">
              <thead className="sticky top-0 z-10 bg-slate-50 text-slate-700 shadow-2xs">
                <tr className="border-b border-slate-300">
                  <th className="px-3.5 py-2.5 font-semibold whitespace-nowrap">Thời gian</th>
                  {series.map((s) => (
                    <th
                      key={s.key}
                      className="px-3.5 py-2.5 font-semibold whitespace-nowrap"
                      style={{ color: s.color }}
                    >
                      {s.tableLabel ?? s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                {totalTableRows === 0 ? (
                  <tr>
                    <td colSpan={series.length + 1} className="py-12 text-center text-sm text-slate-400">
                      Chưa có mẫu dữ liệu trong khoảng thời gian đã chọn.
                    </td>
                  </tr>
                ) : (
                  <>
                    {topSpacerHeight > 0 ? (
                      <tr style={{ height: `${topSpacerHeight}px` }} aria-hidden>
                        <td colSpan={series.length + 1} />
                      </tr>
                    ) : null}
                    {virtualSlice.map((item, idx) => (
                      <tr
                        key={`${item.timeMs}-${startRowIdx + idx}`}
                        style={{ height: `${VIRTUAL_ROW_HEIGHT}px` }}
                        className="hover:bg-slate-50/80"
                      >
                        <td className="px-3.5 py-1.5 font-mono text-[12.5px] whitespace-nowrap text-slate-700">
                          {item.timeText}
                        </td>
                        {series.map((s) => {
                          const val = readVal(item.raw, s);
                          return (
                            <td key={s.key} className="px-3.5 py-1.5 font-mono text-[12.5px] whitespace-nowrap">
                              {val == null
                                ? "-"
                                : formatAppNumber(val, {
                                    minDecimals: (s.digits ?? 2) > 0 ? 1 : 0,
                                    maxDecimals: s.digits ?? 2,
                                  })}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {bottomSpacerHeight > 0 ? (
                      <tr style={{ height: `${bottomSpacerHeight}px` }} aria-hidden>
                        <td colSpan={series.length + 1} />
                      </tr>
                    ) : null}
                  </>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-500">
              Hiển thị thời gian thực từng bản tin:{" "}
              <strong className="text-slate-700">{formatAppNumber(tableRowsSource.length, 0)}</strong> bản ghi
              {medianStepSec < 60 ? ` (chu kỳ ~${medianStepSec}s/lần)` : ""}
            </span>
            <button
              type="button"
              onClick={() => setTableMode(false)}
              className="inline-flex h-8 items-center rounded bg-[#b91c1c] px-4 text-xs font-semibold text-white shadow-xs hover:bg-[#991b1b]"
            >
              Đóng
            </button>
          </div>
        </div>
      ) : (
        /* Giao diện Biểu đồ có chấm điểm dữ liệu (dots), ngắt nét khi mất mẫu (loss data) và thanh DataZoom */
        <div className="mt-3">
          {/* Top bar: Legend ở giữa + 2 nút Table Data & Refresh ở góc phải (giống ảnh 2) */}
          <div className="relative flex flex-wrap items-center justify-between gap-2 px-1 pb-1">
            <div className="flex flex-1 flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
              {series.map((s) => {
                const hidden = hiddenKeys.includes(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => toggleSeries(s.key)}
                    className={`inline-flex items-center gap-1.5 text-[12px] font-medium transition-opacity ${
                      hidden ? "opacity-35 line-through" : "opacity-100"
                    }`}
                  >
                    <svg viewBox="0 0 26 12" className="h-3 w-6 shrink-0" aria-hidden>
                      <line x1="1" y1="6" x2="25" y2="6" stroke={s.color} strokeWidth="1.8" />
                      {showMarkers ? (
                        <circle
                          cx="13"
                          cy="6"
                          r="3.2"
                          fill="#ffffff"
                          stroke={s.color}
                          strokeWidth="1.8"
                        />
                      ) : null}
                    </svg>
                    <span className="text-slate-700">{s.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                title="Xem bảng dữ liệu chi tiết"
                onClick={() => {
                  setTableScrollTop(0);
                  setTableMode(true);
                }}
                className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              >
                <DocTableIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Bảng chi tiết</span>
              </button>
              {onRefresh ? (
                <button
                  type="button"
                  title="Làm mới dữ liệu"
                  onClick={onRefresh}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                >
                  <ReloadIcon className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          {/* Chart Canvas (Hỗ trợ kéo quét trực tiếp trên biểu đồ để Zoom đúng vị trí bất kỳ + Lăn chuột) */}
          <div ref={chartRef} className={`w-full min-w-0 select-none ${heightClass}`}>
            {W > 0 && H > 0 ? (
              <svg
                viewBox={`0 0 ${W} ${H}`}
                className="block h-full w-full cursor-crosshair touch-pan-y"
                onWheel={handleWheelZoom}
                onPointerDown={(e) => {
                  if (e.button !== 0 && e.pointerType === "mouse") return;
                  const box = e.currentTarget.getBoundingClientRect();
                  const mouseX = ((e.clientX - box.left) / Math.max(1, box.width)) * W;
                  if (mouseX < pad.l || mouseX > W - pad.r) return;
                  setBoxSelect({ startX: mouseX, currentX: mouseX });
                }}
                onPointerMove={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  const mouseX = Math.max(
                    pad.l,
                    Math.min(W - pad.r, ((e.clientX - box.left) / Math.max(1, box.width)) * W),
                  );
                  if (boxSelect) {
                    setBoxSelect((prev) => (prev ? { ...prev, currentX: mouseX } : null));
                  }
                  if (!visibleSamples.length) {
                    setHoverIdx(null);
                    return;
                  }
                  const targetMs =
                    viewStartMs + Math.max(0, Math.min(1, (mouseX - pad.l) / innerW)) * viewSpanMs;
                  setHoverIdx(findNearestVisibleIndex(targetMs));
                }}
                onPointerUp={() => {
                  if (boxSelect) {
                    const minX = Math.min(boxSelect.startX, boxSelect.currentX);
                    const maxX = Math.max(boxSelect.startX, boxSelect.currentX);
                    setBoxSelect(null);
                    // Nếu người dùng kéo quét rộng hơn 16px, phóng to ngay vào đúng khoảng đã quét!
                    if (maxX - minX >= 16) {
                      const currentSpan = zoom.endPct - zoom.startPct;
                      const relStart = Math.max(0, Math.min(1, (minX - pad.l) / innerW));
                      const relEnd = Math.max(0, Math.min(1, (maxX - pad.l) / innerW));
                      const nextStart = zoom.startPct + relStart * currentSpan;
                      const nextEnd = Math.max(nextStart + 0.005, zoom.startPct + relEnd * currentSpan);
                      setZoom({ startPct: nextStart, endPct: Math.min(1, nextEnd) });
                    }
                  }
                }}
                onPointerLeave={() => {
                  setHoverIdx(null);
                  setBoxSelect(null);
                }}
              >
                {/* Đơn vị trục tung (V, A, Hz, kW, ...) */}
                {/* Canh trái từ mép khung: đơn vị dài (VD "kW / kVAR / kVA" khi tích nhiều nhóm) không bị cắt. */}
                <text x={4} y={15} textAnchor="start" className="fill-slate-500" fontSize="11">
                  ({unitLabel})
                </text>

                {/* Lưới ngang & Nhãn trục tung */}
                {yTicks.map((tv, idx) => {
                  const y = yAtVal(tv);
                  const span = Math.abs(yDomain[1] - yDomain[0]);
                  const label =
                    span >= 50
                      ? formatAppNumber(Math.round(tv), 0)
                      : span >= 5
                        ? formatAppNumber(tv, { minDecimals: 1, maxDecimals: 1 })
                        : formatAppNumber(tv, { minDecimals: 2, maxDecimals: 2 });
                  return (
                    <g key={idx}>
                      <line
                        x1={pad.l}
                        x2={W - pad.r}
                        y1={y}
                        y2={y}
                        stroke="#e2e8f0"
                        strokeWidth="1"
                      />
                      <text
                        x={pad.l - 8}
                        y={y + 3.5}
                        textAnchor="end"
                        className="fill-slate-500"
                        fontSize="10.5"
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}

                {/* Trục hoành & Nhãn thời gian */}
                <line
                  x1={pad.l}
                  x2={W - pad.r}
                  y1={H - pad.b}
                  y2={H - pad.b}
                  stroke="#94a3b8"
                  strokeWidth="1"
                />
                {xTicks.map((t, idx) => (
                  <g key={idx}>
                    <line
                      x1={t.x}
                      x2={t.x}
                      y1={H - pad.b}
                      y2={H - pad.b + 4}
                      stroke="#94a3b8"
                    />
                    <text
                      x={t.x}
                      y={H - 8}
                      textAnchor="middle"
                      className="fill-slate-500"
                      fontSize="10.5"
                    >
                      {t.label}
                    </text>
                  </g>
                ))}

                {/* Đường biểu diễn + Các chấm điểm dữ liệu (dots) + Ngắt nét khi mất dữ liệu */}
                {activeSeries.map((s) => {
                  // Nếu số điểm đang hiển thị > 550, áp dụng Min-Max Bucket Decimation để giữ 100% đỉnh/đáy & khoảng mất mạng mà không gây lag DOM
                  const maxRenderPts = 550;
                  let sampleList = visibleSamples;
                  if (visibleSamples.length > maxRenderPts) {
                    const bucketSize = Math.ceil(visibleSamples.length / (maxRenderPts / 2));
                    const reduced: ParsedSample[] = [];
                    for (let i = 0; i < visibleSamples.length; i += bucketSize) {
                      const slice = visibleSamples.slice(i, i + bucketSize);
                      if (slice.length <= 2) {
                        reduced.push(...slice);
                        continue;
                      }
                      // Luôn giữ điểm đầu, điểm cuối, điểm có khoảng nghỉ (gap), cùng điểm Min & Max trong bucket
                      let minItem = slice[0];
                      let maxItem = slice[0];
                      let minV = Infinity;
                      let maxV = -Infinity;
                      const picked = new Set<ParsedSample>([slice[0], slice[slice.length - 1]]);
                      for (let j = 0; j < slice.length; j++) {
                        const cur = slice[j];
                        const prev = j > 0 ? slice[j - 1] : i > 0 ? visibleSamples[i - 1] : null;
                        if (prev && cur.gapId !== prev.gapId) {
                          picked.add(prev);
                          picked.add(cur);
                        }
                        const v = readVal(cur.raw, s);
                        if (v != null) {
                          if (v < minV) {
                            minV = v;
                            minItem = cur;
                          }
                          if (v > maxV) {
                            maxV = v;
                            maxItem = cur;
                          }
                        }
                      }
                      picked.add(minItem);
                      picked.add(maxItem);
                      const ordered = [...picked].sort((a, b) => a.timeMs - b.timeMs);
                      for (const p of ordered) {
                        if (reduced[reduced.length - 1] !== p) reduced.push(p);
                      }
                    }
                    sampleList = reduced;
                  }

                  let d = "";
                  let prevGapId: number | null = null;
                  const dots: Array<{ x: number; y: number; ms: number; val: number; gapId: number }> = [];

                  for (const item of sampleList) {
                    const val = readVal(item.raw, s);
                    if (val == null) continue;
                    const x = xAtMs(item.timeMs);
                    const y = yAtVal(val);
                    const isGap = prevGapId != null && item.gapId !== prevGapId;
                    d += `${prevGapId == null || isGap ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)} `;
                    prevGapId = item.gapId;
                    dots.push({ x, y, ms: item.timeMs, val, gapId: item.gapId });
                  }

                  const step = dots.length > 90 ? Math.ceil(dots.length / 55) : 1;

                  return (
                    <g key={s.key}>
                      {d ? (
                        <path
                          d={d}
                          fill="none"
                          stroke={s.color}
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ) : null}
                      {(showMarkers ? dots : []).map((pt, i) => {
                        const prev = dots[i - 1];
                        const next = dots[i + 1];
                        const boundary =
                          !prev ||
                          !next ||
                          pt.gapId !== prev.gapId ||
                           next.gapId !== pt.gapId;
                        if (step > 1 && i % step !== 0 && !boundary) return null;
                        return (
                          <circle
                            key={`${s.key}-pt-${i}`}
                            cx={pt.x}
                            cy={pt.y}
                            r={visibleSamples.length <= 120 ? "2.8" : "2.3"}
                            fill="#ffffff"
                            stroke={s.color}
                            strokeWidth="1.6"
                          />
                        );
                      })}
                    </g>
                  );
                })}

                {/* Hiệu ứng kéo quét chọn vùng Zoom trực tiếp trên biểu đồ */}
                {boxSelect && Math.abs(boxSelect.currentX - boxSelect.startX) >= 6 ? (
                  <g pointerEvents="none">
                    <rect
                      x={Math.min(boxSelect.startX, boxSelect.currentX)}
                      y={pad.t}
                      width={Math.abs(boxSelect.currentX - boxSelect.startX)}
                      height={innerH}
                      fill="rgba(14, 165, 233, 0.16)"
                      stroke="#0284c7"
                      strokeWidth="1"
                      strokeDasharray="3 2"
                    />
                  </g>
                ) : null}

                {/* Crosshair & Tooltip khi di chuột */}
                {hoveredSample ? (
                  <g pointerEvents="none">
                    {(() => {
                      const hx = xAtMs(hoveredSample.timeMs);
                      const rows = activeSeries.map((s) => {
                        const val = readVal(hoveredSample.raw, s);
                        const valStr =
                          (val == null
                            ? "--"
                            : formatAppNumber(val, {
                                minDecimals: (s.digits ?? 2) > 0 ? 1 : 0,
                                maxDecimals: s.digits ?? 2,
                              })) + (s.unit ? ` ${s.unit}` : "");
                        return { s, valStr };
                      });
                      const maxRowPx = rows.reduce(
                        (max, r) => Math.max(max, Math.ceil(r.s.label.length * 6.4 + r.valStr.length * 6.8 + 46)),
                        210,
                      );
                      const maxAllowedW = Math.max(200, W - pad.l - pad.r - 12);
                      const tipW = Math.min(maxRowPx, maxAllowedW);
                      const tipH = 26 + activeSeries.length * 18;
                      const tipX =
                        hx + 14 + tipW > W - pad.r ? Math.max(pad.l, hx - tipW - 14) : hx + 14;
                      const tipY = Math.max(pad.t + 4, Math.min(H - pad.b - tipH - 4, pad.t + 12));
                      return (
                        <>
                          <line
                            x1={hx}
                            x2={hx}
                            y1={pad.t}
                            y2={H - pad.b}
                            stroke="#64748b"
                            strokeDasharray="4 3"
                          />
                          {activeSeries.map((s) => {
                            const val = readVal(hoveredSample.raw, s);
                            if (val == null) return null;
                            return (
                              <circle
                                key={`${s.key}-hover`}
                                cx={hx}
                                cy={yAtVal(val)}
                                r="4.2"
                                fill={s.color}
                                stroke="#ffffff"
                                strokeWidth="1.8"
                              />
                            );
                          })}
                          <g transform={`translate(${tipX}, ${tipY})`}>
                            <rect
                              width={tipW}
                              height={tipH}
                              rx="6"
                              fill="rgba(15, 23, 42, 0.92)"
                              stroke="#334155"
                            />
                            <text
                              x="10"
                              y="17"
                              fill="#f8fafc"
                              fontSize="11"
                              fontWeight="600"
                            >
                              {hoveredSample.timeText}
                            </text>
                            {rows.map(({ s, valStr }, idx) => {
                              const maxLabelChars = Math.max(
                                10,
                                Math.floor((tipW - valStr.length * 6.8 - 44) / 6.3),
                              );
                              const displayLabel =
                                s.label.length > maxLabelChars
                                  ? `${s.label.slice(0, maxLabelChars - 1)}…`
                                  : s.label;
                              return (
                                <g
                                  key={`${s.key}-tip-row`}
                                  transform={`translate(10, ${33 + idx * 18})`}
                                >
                                  <circle cx="4" cy="-3.5" r="3.5" fill={s.color} />
                                  <text x="12" y="0" fill="#cbd5e1" fontSize="11">
                                    {displayLabel}
                                  </text>
                                  <text
                                    x={tipW - 20}
                                    y="0"
                                    textAnchor="end"
                                    fill="#ffffff"
                                    fontSize="11"
                                    fontWeight="700"
                                  >
                                    {valStr}
                                  </text>
                                </g>
                              );
                            })}
                          </g>
                        </>
                      );
                    })()}
                  </g>
                ) : null}
              </svg>
            ) : null}
          </div>

          {/* Thanh DataZoom chuẩn giống webdemo server.dts-tech.vn (ảnh 2) + Hỗ trợ cảm ứng điện thoại */}
          <div className="mt-1.5 px-2 sm:px-6">
            <div
              ref={sliderRef}
              onPointerDown={handleTrackPointerDown}
              className="relative h-8 w-full cursor-pointer touch-none select-none rounded-[3px] border border-slate-300 bg-slate-50/80"
            >
              {/* Đường preview thu nhỏ của chuỗi dữ liệu */}
              <svg
                viewBox="0 0 1000 28"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 h-full w-full"
              >
                {miniPreviewPath ? (
                  <path
                    d={miniPreviewPath}
                    fill="none"
                    stroke="#64748b"
                    strokeWidth="1.5"
                    opacity="0.75"
                  />
                ) : null}
              </svg>

              {/* Phần bị che mờ 2 bên ngoài vùng zoom */}
              <div
                className="pointer-events-none absolute inset-y-0 left-0 bg-slate-200/45"
                style={{ width: `${zoom.startPct * 100}%` }}
              />
              <div
                className="pointer-events-none absolute inset-y-0 right-0 bg-slate-200/45"
                style={{ width: `${(1 - zoom.endPct) * 100}%` }}
              />

              {/* Vùng chọn đang zoom (kéo cả cửa sổ để di chuyển vị trí) */}
              <div
                onPointerDown={(e) => beginSliderDrag(e, "window")}
                style={{
                  left: `${zoom.startPct * 100}%`,
                  width: `${Math.max(1.5, (zoom.endPct - zoom.startPct) * 100)}%`,
                }}
                className="absolute inset-y-0 cursor-grab touch-none border-x border-sky-500 bg-sky-500/25 active:cursor-grabbing"
                title="Kéo để trượt cửa sổ thời gian đang zoom"
              />

              {/* Tay nắm trái (có vùng chạm rộng 24px cho điện thoại + nhãn mốc giờ) */}
              <div
                onPointerDown={(e) => beginSliderDrag(e, "left")}
                style={{ left: `calc(${zoom.startPct * 100}% - 12px)` }}
                className="group absolute -top-0.5 -bottom-0.5 z-10 flex w-6 cursor-ew-resize touch-none items-center justify-center"
                title="Kéo để chỉnh điểm bắt đầu zoom"
              >
                <div className="flex h-7 w-3 items-center justify-center rounded-[2px] border border-sky-600 bg-white shadow-xs group-hover:bg-sky-50">
                  <span className="h-3.5 w-0.5 bg-sky-600" />
                </div>
                {isZoomed ? (
                  <span className="pointer-events-none absolute -top-5 left-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-white shadow-2xs">
                    {formatHandleTime(viewStartMs, totalSpanMs)}
                  </span>
                ) : null}
              </div>

              {/* Tay nắm phải (có vùng chạm rộng 24px cho điện thoại + nhãn mốc giờ) */}
              <div
                onPointerDown={(e) => beginSliderDrag(e, "right")}
                style={{ left: `calc(${zoom.endPct * 100}% - 12px)` }}
                className="group absolute -top-0.5 -bottom-0.5 z-10 flex w-6 cursor-ew-resize touch-none items-center justify-center"
                title="Kéo để chỉnh điểm kết thúc zoom"
              >
                <div className="flex h-7 w-3 items-center justify-center rounded-[2px] border border-sky-600 bg-white shadow-xs group-hover:bg-sky-50">
                  <span className="h-3.5 w-0.5 bg-sky-600" />
                </div>
                {isZoomed ? (
                  <span className="pointer-events-none absolute -top-5 right-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-white shadow-2xs">
                    {formatHandleTime(viewEndMs, totalSpanMs)}
                  </span>
                ) : null}
              </div>
            </div>

            {/* Thanh điều khiển nhanh mức Zoom & thông tin mẫu đang xem */}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>
                Đang xem:{" "}
                <strong className="font-mono text-slate-700">
                  {formatVietnamTimestamp(viewStartMs)}
                </strong>{" "}
                →{" "}
                <strong className="font-mono text-slate-700">
                  {formatVietnamTimestamp(viewEndMs)}
                </strong>{" "}
                ({formatAppNumber(visibleSamples.length, 0)}/
                {formatAppNumber(parsedSamples.length, 0)} mẫu)
              </span>

              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-[10.5px] text-slate-400">Thu phóng nhanh:</span>
                {totalSpanMs <= 48 * 3600 * 1000 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => applyPresetSpan(15 * 60 * 1000)}
                      className="rounded border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-600 hover:border-sky-400 hover:text-sky-600"
                    >
                      15p
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPresetSpan(30 * 60 * 1000)}
                      className="rounded border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-600 hover:border-sky-400 hover:text-sky-600"
                    >
                      30p
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPresetSpan(60 * 60 * 1000)}
                      className="rounded border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-600 hover:border-sky-400 hover:text-sky-600"
                    >
                      1h
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPresetSpan(3 * 3600 * 1000)}
                      className="rounded border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-600 hover:border-sky-400 hover:text-sky-600"
                    >
                      3h
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => stepZoom(0.65)}
                  title="Phóng to (+)"
                  className="rounded border border-slate-200 bg-white px-2 py-0.5 font-bold text-slate-700 hover:border-sky-400 hover:text-sky-600"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => stepZoom(1.45)}
                  title="Thu nhỏ (-)"
                  className="rounded border border-slate-200 bg-white px-2 py-0.5 font-bold text-slate-700 hover:border-sky-400 hover:text-sky-600"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => setZoom({ startPct: 0, endPct: 1 })}
                  className={`rounded border px-2 py-0.5 font-semibold ${
                    isZoomed
                      ? "border-sky-500 bg-sky-50 text-sky-700 hover:bg-sky-100"
                      : "border-slate-200 bg-slate-50 text-slate-400"
                  }`}
                >
                  100%
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DocTableIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M14 3v6h6M8 13h8M8 17h8M8 9h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ReloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 11a8 8 0 1 0 2 5.3M20 4v7h-7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
