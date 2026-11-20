"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CustomSelect } from "@/components/ui/CustomSelect";
import {
  civilDatePart,
  civilTimePart,
  formatCivilDate,
  formatCivilDateTime,
  toCivilDateTime,
  vietnamFromStored,
  vietnamNow,
} from "@/lib/vietnam-time";

export type TimeFilterMode = "day" | "month" | "year" | "custom_date";
export type CustomDateMode = "single" | "range";

export type TimeFilterValue = {
  mode: TimeFilterMode;
  date: string; // YYYY-MM-DD
  month: string; // YYYY-MM
  year: number; // YYYY
  customDateMode: CustomDateMode;
  /** YYYY-MM-DD hoặc YYYY-MM-DDTHH:mm */
  customDate: string;
  /** YYYY-MM-DD hoặc YYYY-MM-DDTHH:mm */
  startDate: string;
  /** YYYY-MM-DD hoặc YYYY-MM-DDTHH:mm */
  endDate: string;
};

export function createTimeFilter(now = vietnamNow()): TimeFilterValue {
  const noon = `${now.date}T00:00`;
  return {
    mode: "month",
    date: now.date,
    month: now.monthKey,
    year: now.year,
    customDateMode: "range",
    customDate: noon,
    startDate: `${now.monthKey}-01T00:00`,
    endDate: `${now.date}T23:59`,
  };
}

export const DEFAULT_TIME_FILTER: TimeFilterValue = createTimeFilter();

function filterInstantMs(value: string) {
  const date = civilDatePart(value);
  const time = civilTimePart(value, "00:00");
  return Date.parse(`${date}T${time}:00+07:00`);
}

function orderedRange(value: TimeFilterValue) {
  const startMs = filterInstantMs(value.startDate);
  const endMs = filterInstantMs(value.endDate);
  if (startMs <= endMs) {
    return { from: value.startDate, to: value.endDate, fromMs: startMs, toMs: endMs };
  }
  return { from: value.endDate, to: value.startDate, fromMs: endMs, toMs: startMs };
}

export function periodIndexForInstant(value: TimeFilterValue, at: string, length: number) {
  const parts = vietnamFromStored(at);
  if (!parts) return -1;
  let index = -1;
  if (value.mode === "month") {
    if (parts.monthKey === value.month) index = parts.day - 1;
  } else if (value.mode === "year") {
    if (parts.year === value.year) index = parts.month - 1;
  } else if (value.mode === "day" && parts.date === value.date) {
    index = length === 48 ? parts.hour * 2 + (parts.minute >= 30 ? 1 : 0) : parts.hour;
  } else if (value.mode === "custom_date") {
    const { fromMs, toMs } = orderedRange(value);
    const currentMs = filterInstantMs(`${parts.date}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`);
    if (currentMs < fromMs || currentMs > toMs) return -1;
    const span = timeFilterSpan(value);
    if (span.hourly) {
      index = Math.floor((currentMs - fromMs) / (30 * 60 * 1000));
    } else {
      const startDay = Date.parse(`${civilDatePart(span.from)}T00:00:00+07:00`);
      const currentDay = Date.parse(`${parts.date}T00:00:00+07:00`);
      index = Math.round((currentDay - startDay) / (24 * 60 * 60 * 1000));
    }
  }
  return index >= 0 && index < length ? index : -1;
}

export function getTimeFilterLabel(value: TimeFilterValue): string {
  switch (value.mode) {
    case "day":
      return value.date === vietnamNow().date
        ? `Hôm nay (${formatCivilDate(value.date)})`
        : formatCivilDate(value.date);
    case "custom_date":
      return `${formatCivilDateTime(value.startDate)} → ${formatCivilDateTime(value.endDate)}`;
    case "month": {
      const [y, m] = value.month.split("-");
      return `Tháng ${m}/${y}`;
    }
    case "year":
      return `Năm ${value.year}`;
    default:
      return "";
  }
}

export function getTimeFilterPeriods(value: TimeFilterValue): { key: string | number; label: string }[] {
  if (value.mode === "day") {
    return Array.from({ length: 48 }, (_, i) => {
      const h = Math.floor(i / 2);
      const m = i % 2 === 0 ? "00" : "30";
      return {
        key: i,
        label: `${String(h).padStart(2, "0")}:${m}`,
      };
    });
  }

  if (value.mode === "month") {
    const [y, m] = value.month.split("-").map(Number);
    const count = new Date(y, m, 0).getDate();
    return Array.from({ length: count }, (_, i) => ({
      key: i + 1,
      label: `${String(i + 1).padStart(2, "0")}/${String(m).padStart(2, "0")}`,
    }));
  }

  if (value.mode === "year") {
    return Array.from({ length: 12 }, (_, i) => ({
      key: i + 1,
      label: `T${i + 1}`,
    }));
  }

  if (value.mode === "custom_date") {
    const span = timeFilterSpan(value);
    const { fromMs, toMs } = orderedRange(value);
    if (span.hourly) {
      const sameDay = civilDatePart(span.from) === civilDatePart(span.to);
      const slots = Math.max(1, Math.min(336, Math.floor((toMs - fromMs) / (30 * 60 * 1000)) + 1));
      return Array.from({ length: slots }, (_, i) => {
        const t = new Date(fromMs + i * 30 * 60 * 1000);
        const label = new Intl.DateTimeFormat("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
          ...(sameDay ? {} : { day: "2-digit", month: "2-digit" }),
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(t);
        return { key: i, label };
      });
    }

    const startDay = Date.parse(`${civilDatePart(span.from)}T00:00:00+07:00`);
    const endDay = Date.parse(`${civilDatePart(span.to)}T00:00:00+07:00`);
    const diffDays = Math.min(366, Math.max(1, Math.round((endDay - startDay) / (24 * 60 * 60 * 1000)) + 1));
    return Array.from({ length: diffDays }, (_, i) => {
      const d = new Date(startDay + i * 24 * 60 * 60 * 1000);
      const label = new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        day: "2-digit",
        month: "2-digit",
      }).format(d);
      return { key: i, label };
    });
  }

  return [];
}

export function getTimeFilterScaleFactor(value: TimeFilterValue): number {
  switch (value.mode) {
    case "year":
      return 1.0;
    case "month":
      return 1 / 12;
    case "day":
      return 1 / 365;
    case "custom_date": {
      const { fromMs, toMs } = orderedRange(value);
      const diffDays = Math.max(1, (toMs - fromMs) / (1000 * 60 * 60 * 24));
      return diffDays / 365;
    }
    default:
      return 1.0;
  }
}

export function timeFilterSpan(value: TimeFilterValue): { from: string; to: string; hourly: boolean } {
  if (value.mode === "day") return { from: value.date, to: value.date, hourly: true };
  if (value.mode === "month") {
    const [year, month] = value.month.split("-").map(Number);
    if (!year || !month) {
      const now = vietnamNow();
      return { from: `${now.monthKey}-01`, to: now.date, hourly: false };
    }
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const mm = String(month).padStart(2, "0");
    return {
      from: `${year}-${mm}-01`,
      to: `${year}-${mm}-${String(last).padStart(2, "0")}`,
      hourly: false,
    };
  }
  if (value.mode === "year") return { from: `${value.year}-01-01`, to: `${value.year}-12-31`, hourly: false };
  const { from, to, fromMs, toMs } = orderedRange(value);
  const hours = (toMs - fromMs) / (60 * 60 * 1000);
  return {
    from: civilDatePart(from),
    to: civilDatePart(to),
    hourly: hours <= 48,
  };
}

export function shiftTimeFilter(value: TimeFilterValue, step: number): TimeFilterValue {
  if (value.mode === "day") return withCivilDate(value, shiftCivilDate(value.date, step));
  if (value.mode === "year") return { ...value, year: value.year + step };
  if (value.mode === "month") {
    const [year, month] = (/^\d{4}-\d{2}$/.test(value.month) ? value.month : vietnamNow().monthKey)
      .split("-")
      .map(Number);
    const next = new Date(Date.UTC(year, month - 1 + step, 1));
    const key = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
    return { ...value, month: key, year: next.getUTCFullYear() };
  }
  if (value.customDateMode === "range") {
    const { fromMs, toMs } = orderedRange(value);
    const spanMs = Math.max(60 * 60 * 1000, toMs - fromMs);
    const nextFromMs = fromMs + step * spanMs;
    const nextToMs = toMs + step * spanMs;
    const startDate = toCivilDateTime(
      new Date(nextFromMs).toLocaleString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).replace(" ", "T").slice(0, 16),
    );
    const endDate = toCivilDateTime(
      new Date(nextToMs).toLocaleString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).replace(" ", "T").slice(0, 16),
    );
    const startDay = civilDatePart(startDate);
    return {
      ...value,
      startDate,
      endDate,
      date: startDay,
      customDate: startDate,
      month: startDay.slice(0, 7),
      year: Number(startDay.slice(0, 4)),
    };
  }
  const shifted = shiftCivilDate(civilDatePart(value.customDate), step);
  const customDate = toCivilDateTime(shifted, civilTimePart(value.customDate));
  return withCivilDate({ ...value, customDate }, shifted);
}

function shiftCivilDate(value: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civilDatePart(value));
  const base = match
    ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : Date.parse(`${vietnamNow().date}T00:00:00Z`);
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function withCivilDate(value: TimeFilterValue, date: string): TimeFilterValue {
  const day = civilDatePart(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return value;
  return {
    ...value,
    date: day,
    month: day.slice(0, 7),
    year: Number(day.slice(0, 4)),
  };
}

export function TimeFilterBar({
  value,
  onChange,
  allowedModes,
  className = "",
}: {
  value: TimeFilterValue;
  onChange: (next: TimeFilterValue) => void;
  allowedModes?: TimeFilterMode[];
  className?: string;
}) {
  const allModes: { id: TimeFilterMode; label: string }[] = [
    { id: "day", label: "Ngày" },
    { id: "month", label: "Tháng" },
    { id: "year", label: "Năm" },
    { id: "custom_date", label: "Tùy chọn" },
  ];
  const modes = allowedModes
    ? allModes.filter((m) => allowedModes.includes(m.id))
    : allModes;

  const years = useMemo(() => [2023, 2024, 2025, 2026, 2027], []);

  return (
    <div className={`flex w-full flex-wrap items-center gap-2 font-sans sm:gap-2.5 ${className}`}>
      <div className="inline-flex max-w-full overflow-x-auto rounded-xl border border-slate-200/90 bg-white p-1 shadow-xs">
        {modes.map((item) => {
          const active = value.mode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  mode: item.id,
                  customDateMode: "range",
                })
              }
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                active
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="inline-flex max-w-full shrink-0 items-center gap-1.5">
        <button
          type="button"
          aria-label="Kỳ trước"
          onClick={() => onChange(shiftTimeFilter(value, -1))}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-xs hover:bg-slate-50"
        >
          ‹
        </button>
        {value.mode === "day" && (
          <div className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-xs whitespace-nowrap">
            <CalendarSmallIcon className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <VietnamDateInput
              value={value.date}
              onChange={(date) => onChange(withCivilDate(value, date))}
              className="min-w-[5.25rem] border-0 bg-transparent text-xs font-semibold text-slate-900 outline-none"
            />
          </div>
        )}

        {value.mode === "month" && (
          <MonthField
            month={/^\d{4}-\d{2}$/.test(value.month) ? value.month : vietnamNow().monthKey}
            onChange={(month) => onChange({ ...value, month, year: Number(month.slice(0, 4)) })}
          />
        )}

        {value.mode === "year" && (
          <div className="relative min-w-[104px]">
            <CustomSelect
              value={value.year}
              onChange={(e) => onChange({ ...value, year: Number(e.target.value) })}
              className="h-9 w-full cursor-pointer appearance-none rounded-xl border border-slate-200 bg-white pr-8 pl-3 text-xs font-semibold whitespace-nowrap text-slate-900 shadow-xs outline-none transition-colors hover:border-slate-300 focus:border-emerald-500"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  Năm {y}
                </option>
              ))}
            </CustomSelect>
            <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-slate-400">
              ▾
            </span>
          </div>
        )}

        {value.mode === "custom_date" && (
          <DateSelectionControl
            mode={value.customDateMode}
            onModeChange={(customDateMode) => onChange({ ...value, customDateMode })}
            date={value.customDate}
            onDateChange={(customDate) =>
              onChange(withCivilDate({ ...value, customDate }, civilDatePart(customDate)))
            }
            startDate={value.startDate}
            endDate={value.endDate}
            onRangeChange={(startDate, endDate) =>
              onChange(withCivilDate({ ...value, startDate, endDate }, civilDatePart(startDate)))
            }
          />
        )}
        <button
          type="button"
          aria-label="Kỳ sau"
          onClick={() => onChange(shiftTimeFilter(value, 1))}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-xs hover:bg-slate-50"
        >
          ›
        </button>
      </div>
    </div>
  );
}

const WEEKDAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

function civilDayMs(day: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Number.NaN;
}

function msToCivilDay(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Các ô ngày của lịch tháng `month` (YYYY-MM), tuần bắt đầu từ Thứ Hai; null = ô trống. */
function calendarCells(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const firstMs = Date.UTC(year, monthIndex - 1, 1);
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const lead = (new Date(firstMs).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(msToCivilDay(firstMs + (day - 1) * 86_400_000));
  while (cells.length % 7) cells.push(null);
  return cells;
}

function shiftMonthKey(month: string, step: number) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 1 + step, 1));
  return date.toISOString().slice(0, 7);
}

/** Khoảng nhanh theo ngày hôm nay (giờ Việt Nam). */
function quickRanges(today: string) {
  const todayMs = civilDayMs(today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevMonth = shiftMonthKey(today.slice(0, 7), -1);
  const prevMonthEnd = msToCivilDay(civilDayMs(monthStart) - 86_400_000);
  return [
    { label: "Hôm nay", from: today, to: today },
    { label: "Hôm qua", from: msToCivilDay(todayMs - 86_400_000), to: msToCivilDay(todayMs - 86_400_000) },
    { label: "7 ngày qua", from: msToCivilDay(todayMs - 6 * 86_400_000), to: today },
    { label: "30 ngày qua", from: msToCivilDay(todayMs - 29 * 86_400_000), to: today },
    { label: "Tháng này", from: monthStart, to: today },
    { label: "Tháng trước", from: `${prevMonth}-01`, to: prevMonthEnd },
  ];
}

/**
 * Chọn khoảng thời gian "Từ … → Đến …" trong MỘT bảng: bấm ngày bắt đầu rồi ngày kết thúc trên cùng một lịch,
 * chỉnh giờ hai đầu, bấm Áp dụng (dữ liệu chỉ tải lại một lần).
 */
export function DateSelectionControl({
  startDate,
  endDate,
  onRangeChange,
  compact = false,
}: {
  mode?: CustomDateMode;
  onModeChange?: (mode: CustomDateMode) => void;
  date?: string;
  onDateChange?: (date: string) => void;
  startDate: string;
  endDate: string;
  onRangeChange: (startDate: string, endDate: string) => void;
  compact?: boolean;
}) {
  const textClass = compact ? "text-[12px]" : "text-xs";
  const [open, setOpen] = useState(false);
  const [today] = useState(() => vietnamNow().date);
  const rootRef = useRef<HTMLDivElement>(null);

  const startLocal = toCivilDateTime(startDate, civilTimePart(startDate, "00:00"));
  const endLocal = toCivilDateTime(endDate, civilTimePart(endDate, "23:59"));

  // Bản nháp trong bảng chọn; chỉ áp dụng khi bấm "Áp dụng".
  const [fromDay, setFromDay] = useState(civilDatePart(startLocal));
  const [toDay, setToDay] = useState<string | null>(civilDatePart(endLocal));
  const [fromTime, setFromTime] = useState(civilTimePart(startLocal, "00:00"));
  const [toTime, setToTime] = useState(civilTimePart(endLocal, "23:59"));
  const [viewMonth, setViewMonth] = useState(civilDatePart(startLocal).slice(0, 7));
  const [hoverDay, setHoverDay] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openPicker() {
    setFromDay(civilDatePart(startLocal));
    setToDay(civilDatePart(endLocal));
    setFromTime(civilTimePart(startLocal, "00:00"));
    setToTime(civilTimePart(endLocal, "23:59"));
    setViewMonth(civilDatePart(endLocal).slice(0, 7));
    setHoverDay(null);
    setOpen(true);
  }

  function pickDay(day: string) {
    // Lần bấm 1: ngày bắt đầu; lần bấm 2: ngày kết thúc (bấm ngày sớm hơn thì đổi chỗ).
    if (toDay !== null) {
      setFromDay(day);
      setToDay(null);
      return;
    }
    if (day < fromDay) {
      setToDay(fromDay);
      setFromDay(day);
    } else {
      setToDay(day);
    }
  }

  function apply() {
    const endDay = toDay ?? fromDay;
    let start = `${fromDay}T${fromTime}`;
    let end = `${endDay}T${toTime}`;
    if (end < start) [start, end] = [end, start];
    onRangeChange(start, end);
    setOpen(false);
  }

  // Đang chờ chọn ngày kết thúc: rê chuột để xem trước khoảng sẽ chọn.
  const previewEnd = toDay ?? hoverDay ?? fromDay;
  const rangeStart = previewEnd < fromDay ? previewEnd : fromDay;
  const rangeEnd = previewEnd < fromDay ? fromDay : previewEnd;
  const cells = calendarCells(viewMonth);
  const [viewYear, viewMonthIndex] = viewMonth.split("-").map(Number);
  const [fromHour = "00", fromMin = "00"] = fromTime.split(":");
  const [toHour = "23", toMin = "59"] = toTime.split(":");

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-expanded={open}
        aria-label="Chọn khoảng thời gian"
        className={`inline-flex min-h-9 max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 sm:px-3 ${textClass} font-medium text-slate-700 shadow-xs transition-colors hover:border-slate-300`}
      >
        <CalendarSmallIcon className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <span className="text-slate-400">Từ</span>
          <span className="font-semibold text-slate-900">{formatCivilDateTime(startLocal)}</span>
        </span>
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <span className="text-slate-400">→ Đến</span>
          <span className="font-semibold text-slate-900">{formatCivilDateTime(endLocal)}</span>
        </span>
      </button>

      {open ? (
        <div className="absolute top-full left-1/2 z-50 mt-1.5 w-[min(340px,calc(100vw-24px))] -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-xl">
          <div className="mb-2.5 flex flex-wrap gap-1">
            {quickRanges(today).map((range) => {
              const active = fromDay === range.from && (toDay ?? fromDay) === range.to;
              return (
                <button
                  key={range.label}
                  type="button"
                  onClick={() => {
                    setFromDay(range.from);
                    setToDay(range.to);
                    setFromTime("00:00");
                    setToTime("23:59");
                    setViewMonth(range.to.slice(0, 7));
                  }}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                    active ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {range.label}
                </button>
              );
            })}
          </div>

          <div className="mb-1.5 flex items-center justify-between">
            <StepButton label="Tháng trước" onClick={() => setViewMonth(shiftMonthKey(viewMonth, -1))} />
            <span className="text-sm font-semibold text-slate-900">
              Tháng {String(viewMonthIndex).padStart(2, "0")}/{viewYear}
            </span>
            <StepButton label="Tháng sau" onClick={() => setViewMonth(shiftMonthKey(viewMonth, 1))} />
          </div>
          <div className="grid grid-cols-7 gap-y-0.5 text-center" onMouseLeave={() => setHoverDay(null)}>
            {WEEKDAY_LABELS.map((label) => (
              <span key={label} className="py-1 text-[10px] font-semibold text-slate-400">
                {label}
              </span>
            ))}
            {cells.map((day, index) => {
              if (!day) return <span key={`empty-${index}`} />;
              const isEdge = day === rangeStart || day === rangeEnd;
              const inRange = day > rangeStart && day < rangeEnd;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => pickDay(day)}
                  onMouseEnter={() => setHoverDay(day)}
                  className={`h-8 text-xs font-semibold transition-colors ${
                    isEdge
                      ? "rounded-lg bg-emerald-600 text-white"
                      : inRange
                        ? "bg-emerald-50 text-emerald-800"
                        : day === today
                          ? "rounded-lg text-emerald-700 ring-1 ring-emerald-300 ring-inset hover:bg-slate-100"
                          : "rounded-lg text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {Number(day.slice(8, 10))}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-center text-[11px] text-slate-400">
            {toDay === null ? "Bấm chọn ngày kết thúc" : "Bấm một ngày để chọn lại ngày bắt đầu"}
          </p>

          <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2.5">
            <TimePicker label="Giờ bắt đầu" hour={fromHour} minute={fromMin} onChange={setFromTime} />
            <TimePicker label="Giờ kết thúc" hour={toHour} minute={toMin} onChange={setToTime} />
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
            <span className="text-[11px] font-semibold text-slate-600">
              {formatCivilDate(fromDay)} {fromTime} → {formatCivilDate(toDay ?? fromDay)} {toTime}
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={apply}
                className="h-8 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                Áp dụng
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TimePicker({
  label,
  hour,
  minute,
  onChange,
}: {
  label: string;
  hour: string;
  minute: string;
  onChange: (time: string) => void;
}) {
  const selectClass =
    "h-8 min-w-0 flex-1 cursor-pointer rounded-lg border border-slate-200 bg-white px-1 text-center font-mono text-xs font-bold text-slate-900 outline-none focus:border-emerald-500";
  return (
    <div>
      <span className="mb-1 block text-[10px] font-semibold tracking-wider text-slate-400 uppercase">{label}</span>
      <div className="flex items-center gap-1">
        <select value={hour} onChange={(e) => onChange(`${e.target.value}:${minute}`)} aria-label={`${label} - giờ`} className={selectClass}>
          {HOURS_24.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="font-mono font-bold text-slate-400">:</span>
        <select value={minute} onChange={(e) => onChange(`${hour}:${e.target.value}`)} aria-label={`${label} - phút`} className={selectClass}>
          {MINUTES_60.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

const MONTH_LABELS = ["Th1", "Th2", "Th3", "Th4", "Th5", "Th6", "Th7", "Th8", "Th9", "Th10", "Th11", "Th12"];

function MonthField({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const year = Number(month.slice(0, 4)) || vietnamNow().year;
  const monthIndex = Number(month.slice(5, 7)) || vietnamNow().month;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (nextYear: number, nextMonth: number) => {
    onChange(`${nextYear}-${String(nextMonth).padStart(2, "0")}`);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label="Chọn tháng"
        className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold whitespace-nowrap text-slate-900 shadow-xs transition-colors hover:border-slate-300"
      >
        <CalendarSmallIcon className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
        <span>Tháng {String(monthIndex).padStart(2, "0")}/{year}</span>
      </button>
      {open ? (
        <div className="absolute left-1/2 z-40 mt-1 w-[232px] -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg sm:left-auto sm:right-0 sm:translate-x-0">
          <div className="mb-2 flex items-center justify-between">
            <StepButton label="Năm trước" onClick={() => choose(year - 1, monthIndex)} />
            <span className="text-sm font-semibold text-slate-900">{year}</span>
            <StepButton label="Năm sau" onClick={() => choose(year + 1, monthIndex)} />
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTH_LABELS.map((label, index) => {
              const active = index + 1 === monthIndex;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    choose(year, index + 1);
                    setOpen(false);
                  }}
                  className={`h-8 rounded-lg text-xs font-semibold ${
                    active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StepButton({ label, onClick }: { label: string; onClick: () => void }) {
  const previous = label.includes("trước");
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
    >
      {previous ? "‹" : "›"}
    </button>
  );
}

function VietnamDateInput({
  value,
  onChange,
  min,
  max,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const day = civilDatePart(value);
  return (
    <label
      className="relative inline-flex cursor-pointer items-center"
      onClick={(event) => {
        event.preventDefault();
        const input = inputRef.current;
        if (!input) return;
        try {
          input.showPicker();
        } catch {
          input.focus();
        }
      }}
    >
      <span className={className}>{formatCivilDate(day) || "Chọn ngày"}</span>
      <input
        ref={inputRef}
        type="date"
        value={day}
        min={min ? civilDatePart(min) : undefined}
        max={max ? civilDatePart(max) : undefined}
        aria-label="Chọn ngày"
        onChange={(event) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) return;
          onChange(event.target.value);
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  );
}

const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES_60 = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

function CalendarSmallIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
