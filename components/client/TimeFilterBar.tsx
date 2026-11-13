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
            onStartDateChange={(startDate) =>
              onChange(withCivilDate({ ...value, startDate }, civilDatePart(startDate)))
            }
            onEndDateChange={(endDate) =>
              onChange(withCivilDate({ ...value, endDate }, civilDatePart(endDate)))
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

export function DateSelectionControl({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  compact = false,
}: {
  mode?: CustomDateMode;
  onModeChange?: (mode: CustomDateMode) => void;
  date?: string;
  onDateChange?: (date: string) => void;
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  compact?: boolean;
}) {
  const textClass = compact ? "text-[12px]" : "text-xs";
  const inputClass = compact
    ? "border-0 bg-transparent text-[12px] font-medium text-emerald-800 outline-none"
    : "border-0 bg-transparent text-xs font-semibold text-slate-900 outline-none cursor-pointer";

  return (
    <div
      className={`inline-flex min-h-9 max-w-full flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1 sm:px-3 ${textClass} font-medium text-slate-700 shadow-xs transition-colors hover:border-slate-300`}
    >
      <CalendarSmallIcon className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <span className="text-slate-400">Từ</span>
          <VietnamDateTimeInput
            value={startDate}
            max={endDate || undefined}
            onChange={onStartDateChange}
            className={inputClass}
          />
        </span>
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <span className="text-slate-400">→ Đến</span>
          <VietnamDateTimeInput
            value={endDate}
            min={startDate || undefined}
            onChange={onEndDateChange}
            className={inputClass}
          />
        </span>
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

function VietnamDateTimeInput({
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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const local = toCivilDateTime(value, civilTimePart(value, "00:00"));
  const dayPart = civilDatePart(local);
  const timePart = civilTimePart(local, "00:00");
  const [hourStr = "00", minStr = "00"] = timePart.split(":");

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

  const updateDateTime = (nextDay: string, nextHour: string, nextMin: string) => {
    const cleanDay = /^\d{4}-\d{2}-\d{2}$/.test(nextDay) ? nextDay : dayPart;
    const cleanHour = /^\d{2}$/.test(nextHour) ? nextHour : hourStr;
    const cleanMin = /^\d{2}$/.test(nextMin) ? nextMin : minStr;
    onChange(`${cleanDay}T${cleanHour}:${cleanMin}`);
  };

  return (
    <div ref={rootRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-slate-100 transition-colors ${className ?? ""}`}
        aria-label="Chọn ngày giờ (24h)"
      >
        <span>{formatCivilDateTime(local)}</span>
      </button>

      {open ? (
        <div className="absolute top-full left-0 z-50 mt-1.5 w-[248px] rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-xl">
          <div className="mb-2.5">
            <span className="mb-1 block text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              Ngày (DD/MM/YYYY)
            </span>
            <div
              className="relative flex h-9 cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2.5 font-semibold text-slate-900 hover:border-emerald-400"
              onClick={() => {
                const el = dateInputRef.current;
                if (!el) return;
                try {
                  el.showPicker();
                } catch {
                  el.focus();
                }
              }}
            >
              <span>{formatCivilDate(dayPart)}</span>
              <CalendarSmallIcon className="h-3.5 w-3.5 text-emerald-600" />
              <input
                ref={dateInputRef}
                type="date"
                value={dayPart}
                min={min ? civilDatePart(min) : undefined}
                max={max ? civilDatePart(max) : undefined}
                onChange={(e) => {
                  if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
                    updateDateTime(e.target.value, hourStr, minStr);
                  }
                }}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </div>
          </div>

          <div className="mb-2.5">
            <span className="mb-1 block text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              Giờ định dạng 24h (00:00 – 23:59)
            </span>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
              <select
                value={hourStr}
                onChange={(e) => updateDateTime(dayPart, e.target.value, minStr)}
                aria-label="Giờ (00-23)"
                className="h-9 cursor-pointer rounded-lg border border-slate-200 bg-white px-2 text-center font-mono text-xs font-bold text-slate-900 outline-none focus:border-emerald-500"
              >
                {HOURS_24.map((h) => (
                  <option key={h} value={h}>
                    {h} giờ
                  </option>
                ))}
              </select>
              <span className="font-mono text-sm font-bold text-slate-400">:</span>
              <select
                value={minStr}
                onChange={(e) => updateDateTime(dayPart, hourStr, e.target.value)}
                aria-label="Phút (00-59)"
                className="h-9 cursor-pointer rounded-lg border border-slate-200 bg-white px-2 text-center font-mono text-xs font-bold text-slate-900 outline-none focus:border-emerald-500"
              >
                {MINUTES_60.map((m) => (
                  <option key={m} value={m}>
                    {m} phút
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-1 border-t border-slate-100 pt-2">
            {(["00:00", "06:00", "12:00", "18:00", "23:59"] as const).map((preset) => {
              const [ph, pm] = preset.split(":");
              const active = hourStr === ph && minStr === pm;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => updateDateTime(dayPart, ph, pm)}
                  className={`rounded-md px-1.5 py-1 font-mono text-[10px] font-semibold transition-colors ${
                    active
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {preset}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
