"use client";

import { useRef } from "react";

export type ChartRange = { start: number; end: number };

export function ChartTimeline({
  labels,
  values,
  range,
  onRange,
  compact = false,
}: {
  labels: string[];
  values: number[];
  range: ChartRange;
  onRange: (range: ChartRange) => void;
  compact?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const last = Math.max(labels.length - 1, 0);
  const minSpan = last <= 0 ? 0 : Math.max(1, Math.min(2, last));
  const minVal = values.length ? Math.min(...values) : 0;
  const maxVal = values.length ? Math.max(...values) : 1;
  const spanVal = Math.max(1e-9, maxVal - minVal);
  const left = last === 0 ? 0 : range.start / last;
  const right = last === 0 ? 1 : range.end / last;
  const startLabel = labels[range.start] ?? labels[0] ?? "--";
  const endLabel = labels[range.end] ?? labels[last] ?? "--";
  const isZoomed = range.start > 0 || range.end < last;

  const beginDrag = (
    e: React.PointerEvent<HTMLElement>,
    mode: "start" | "end" | "move",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const el = trackRef.current;
    if (!el || last <= 0) return;
    const rect = el.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const startX = e.clientX;
    const initial = { ...range };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unsupported
    }

    const onMove = (ev: PointerEvent) => {
      const dIdx = Math.round(((ev.clientX - startX) / width) * last);
      if (mode === "start") {
        const nextStart = Math.max(0, Math.min(initial.end - minSpan, initial.start + dIdx));
        onRange({ start: nextStart, end: initial.end });
      } else if (mode === "end") {
        const nextEnd = Math.min(last, Math.max(initial.start + minSpan, initial.end + dIdx));
        onRange({ start: initial.start, end: nextEnd });
      } else {
        const span = initial.end - initial.start;
        let nextStart = initial.start + dIdx;
        if (nextStart < 0) nextStart = 0;
        if (nextStart + span > last) nextStart = last - span;
        onRange({ start: nextStart, end: nextStart + span });
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

  const handleTrackClick = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    if (!el || last <= 0) return;
    const rect = el.getBoundingClientRect();
    const clickIdx = Math.round(
      Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))) * last,
    );
    const currentSpan = range.end - range.start;
    const targetSpan = currentSpan >= last ? Math.max(minSpan, Math.round(last * 0.35)) : currentSpan;
    let nextStart = clickIdx - Math.floor(targetSpan / 2);
    if (nextStart < 0) nextStart = 0;
    if (nextStart + targetSpan > last) nextStart = last - targetSpan;
    onRange({ start: nextStart, end: nextStart + targetSpan });
  };

  const stepZoom = (delta: number) => {
    if (last <= 0) return;
    const currentSpan = range.end - range.start;
    const nextSpan = Math.max(minSpan, Math.min(last, currentSpan + delta));
    const center = Math.round((range.start + range.end) / 2);
    let nextStart = center - Math.floor(nextSpan / 2);
    if (nextStart < 0) nextStart = 0;
    if (nextStart + nextSpan > last) nextStart = last - nextSpan;
    onRange({ start: nextStart, end: nextStart + nextSpan });
  };

  const spark = values
    .map((value, index) => {
      const x = last === 0 ? 0 : (index / last) * 1000;
      const y = 26 - ((value - minVal) / spanVal) * 20;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="w-full px-1 sm:px-4">
      <div
        ref={trackRef}
        onPointerDown={handleTrackClick}
        className={`relative ${
          compact ? "h-7" : "h-8"
        } w-full cursor-pointer touch-none select-none rounded-[3px] border border-slate-300 bg-slate-50/80`}
      >
        {spark ? (
          <svg
            viewBox="0 0 1000 28"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <path d={spark} fill="none" stroke="#64748b" strokeWidth="1.5" opacity="0.75" />
          </svg>
        ) : null}

        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-slate-200/45"
          style={{ width: `${left * 100}%` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-slate-200/45"
          style={{ width: `${(1 - right) * 100}%` }}
        />

        {/* Cửa sổ đang zoom */}
        <div
          onPointerDown={(e) => beginDrag(e, "move")}
          style={{
            left: `${left * 100}%`,
            width: `${Math.max((right - left) * 100, 2)}%`,
          }}
          className="absolute inset-y-0 cursor-grab touch-none border-x border-sky-500 bg-sky-500/25 active:cursor-grabbing"
          title="Kéo để di chuyển vị trí zoom"
        />

        {/* Tay nắm trái */}
        <div
          onPointerDown={(e) => beginDrag(e, "start")}
          style={{ left: `calc(${left * 100}% - 12px)` }}
          className="group absolute -top-0.5 -bottom-0.5 z-10 flex w-6 cursor-ew-resize touch-none items-center justify-center"
          title="Kéo để chỉnh điểm bắt đầu"
        >
          <div className="flex h-7 w-3 items-center justify-center rounded-[2px] border border-sky-600 bg-white shadow-xs group-hover:bg-sky-50">
            <span className="h-3.5 w-0.5 bg-sky-600" />
          </div>
        </div>

        {/* Tay nắm phải */}
        <div
          onPointerDown={(e) => beginDrag(e, "end")}
          style={{ left: `calc(${right * 100}% - 12px)` }}
          className="group absolute -top-0.5 -bottom-0.5 z-10 flex w-6 cursor-ew-resize touch-none items-center justify-center"
          title="Kéo để chỉnh điểm kết thúc"
        >
          <div className="flex h-7 w-3 items-center justify-center rounded-[2px] border border-sky-600 bg-white shadow-xs group-hover:bg-sky-50">
            <span className="h-3.5 w-0.5 bg-sky-600" />
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>
          Đang xem: <strong className="font-mono text-slate-700">{startLabel}</strong> →{" "}
          <strong className="font-mono text-slate-700">{endLabel}</strong>
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => stepZoom(-Math.max(2, Math.round(last * 0.2)))}
            className="rounded border border-slate-200 bg-white px-2 py-0.5 font-bold text-slate-700 hover:border-sky-400 hover:text-sky-600"
            title="Phóng to (+)"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => stepZoom(Math.max(2, Math.round(last * 0.2)))}
            className="rounded border border-slate-200 bg-white px-2 py-0.5 font-bold text-slate-700 hover:border-sky-400 hover:text-sky-600"
            title="Thu nhỏ (-)"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => onRange({ start: 0, end: last })}
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
  );
}
