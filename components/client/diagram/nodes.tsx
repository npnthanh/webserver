"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useState } from "react";
import { useDiagramActions } from "./context";
import type {
  JunctionFlowNode,
  MeterFlowNode,
  MeterIcon,
  MeterStatus,
  SourceFlowNode,
} from "./types";

/* ---------------- Bảng màu sơ đồ đơn tuyến (Single-line, nền tối) ---------------- */
/** Dây dẫn có điện / có dữ liệu. */
const LINE_LIVE = "#facc15";
/** Dây dẫn mất kết nối. */
const LINE_DEAD = "#475569";
const EQUIPMENT = "#fb923c";
const VALUE_TEXT = "text-[#4ade80]";

const statusText: Record<MeterStatus, string> = {
  normal: "text-[#4ade80]",
  warning: "text-amber-300",
  offline: "text-slate-400",
};

/** Dây dẫn đứng, luôn nét liền: vàng khi có dữ liệu, xám khi mất kết nối. */
function VLine({ live, height }: { live: boolean; height: number }) {
  return <span className="block w-[3px]" style={{ height, background: live ? LINE_LIVE : LINE_DEAD }} />;
}

/** Nhãn nguồn cấp sửa trực tiếp trên sơ đồ: bấm vào chữ (hoặc biểu tượng bút) để sửa, Enter để lưu, Esc để huỷ. */
function EditableGridLabel({ value }: { value: string }) {
  const { renameSource } = useDiagramActions();
  const [draft, setDraft] = useState<string | null>(null);

  if (draft !== null) {
    const commit = () => {
      renameSource(draft);
      setDraft(null);
    };
    return (
      <input
        autoFocus
        value={draft}
        maxLength={60}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setDraft(null);
        }}
        className="nodrag nopan w-[180px] rounded border border-[#fb923c]/60 bg-[#0b1220] px-1 py-0.5 font-mono text-[10.5px] font-bold outline-none"
        style={{ color: EQUIPMENT }}
        aria-label="Nhãn nguồn cấp"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        setDraft(value);
      }}
      className="nodrag nopan group flex items-center gap-1 rounded px-0.5 text-left font-bold hover:bg-white/5"
      style={{ color: EQUIPMENT }}
      title="Bấm để sửa nhãn"
    >
      {value}
      <PencilIcon className="h-3 w-3 opacity-40 group-hover:opacity-100" />
    </button>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 20h4L19 9l-4-4L4 16v4z" strokeLinejoin="round" />
    </svg>
  );
}

export function SourceNode({ data }: NodeProps<SourceFlowNode>) {
  const isElectric = data.energy === "Điện";
  const isOnline = data.normalCount > 0;
  const busWidth = Math.max(data.busWidth ?? 440, 300);
  const feeders = data.feeders?.length ? data.feeders : [{ id: "bus-out", x: busWidth / 2 }];

  return (
    <div className="flex flex-col items-center select-none" style={{ width: busWidth }}>
      {isElectric ? (
        <div className="flex flex-col items-center">
          {/* Lưới điện trung thế */}
          <div className="flex items-end gap-3">
            <svg viewBox="0 0 44 44" className="h-11 w-11 shrink-0" fill="none" aria-hidden>
              <path
                d="M22 3L13 41M22 3L31 41M10 41H34M9 14H35M11 24H33M15 14L29 24M29 14L15 24M14 24L30 37M30 24L14 37"
                stroke={EQUIPMENT}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="pb-0.5 font-mono text-[10.5px] leading-[1.35]">
              <EditableGridLabel value={data.gridLabel} />
            </div>
          </div>
          {/* Đường dây từ nguồn xuống thanh cái: chỉ một nét liền (giữ nguyên chiều cao bố cục cũ). */}
          <VLine live={isOnline} height={130} />
        </div>
      ) : null}

      {/* Thanh cái tổng */}
      <div className="relative w-full">
        {/* Bộ đếm nằm nổi phía trên mép phải thanh cái để đường dây từ nguồn chạm thẳng vào thanh cái. */}
        <div className="absolute bottom-full right-0 mb-1 flex items-end px-1 font-mono text-[10.5px]">
          <span className="flex items-center gap-2 text-[10px] font-semibold">
            <span className="text-[#4ade80]" title="Điểm đo bình thường">
              ● {data.normalCount}
            </span>
            <span className="text-amber-300" title="Điểm đo cảnh báo / mất kết nối">
              ● {data.warningCount}
            </span>
            <span className="text-slate-400" title="Điểm đo ngoại tuyến">
              ● {data.offlineCount}
            </span>
          </span>
        </div>
        <div className="h-[7px] w-full rounded-[1px]" style={{ backgroundColor: LINE_LIVE }} />

        {feeders.map((feeder) => (
          <Handle
            key={feeder.id}
            type="source"
            position={Position.Bottom}
            id={feeder.id === "bus-out" ? "bus-out" : `bus-${feeder.id}`}
            className="!bottom-0 !h-0 !w-2 !min-h-0 !min-w-0 !border-0 !bg-transparent"
            style={{ left: feeder.x }}
          />
        ))}
      </div>
    </div>
  );
}

export function MeterNode({ id, data, selected }: NodeProps<MeterFlowNode>) {
  const { openSettings, refreshLive } = useDiagramActions();
  const isOnline = data.status === "normal";
  const live = data.status !== "offline";

  return (
    <div className="flex w-[264px] flex-col items-center">
      <Handle
        type="target"
        position={Position.Top}
        id="parent"
        className="!top-0 !h-0 !w-2 !min-h-0 !min-w-0 !border-0 !bg-transparent"
        title="Nối từ Thanh cái / Điểm cha"
      />

      <VLine live={data.lineLive ?? live} height={62} />

      {/* Thiết bị / phụ tải + nhãn thông số kiểu SCADA */}
      <div
        className={`diagram-card relative flex w-full flex-col items-center rounded-lg px-2 pb-2 pt-1.5 ${
          selected ? "bg-white/[0.04] ring-1 ring-[#facc15]/60" : ""
        }`}
      >
        <div className="absolute right-1 top-1 flex items-center gap-0.5 text-slate-500">
          <button
            type="button"
            className="rounded p-0.5 hover:bg-white/10 hover:text-[#facc15]"
            aria-label="Làm mới số liệu"
            title="Làm mới số liệu"
            onClick={(event) => {
              event.stopPropagation();
              refreshLive();
            }}
          >
            <RefreshIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded p-0.5 hover:bg-white/10 hover:text-white"
            aria-label="Cài đặt điểm đo"
            title="Tùy chỉnh thông số hiển thị"
            onClick={(event) => {
              event.stopPropagation();
              openSettings(id);
            }}
          >
            <GearIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        <span className="flex h-12 w-12 items-center justify-center overflow-hidden" style={{ color: EQUIPMENT }}>
          {data.iconImage ? (
            <img src={data.iconImage} alt="" className="h-full w-full rounded object-cover" />
          ) : (
            <NodeGlyph type={data.icon} className="h-11 w-11" />
          )}
        </span>

        <p
          className="mt-1 max-w-full truncate text-center font-mono text-[12px] font-bold uppercase"
          style={{ color: EQUIPMENT }}
        >
          {data.title}
        </p>
        <p className={`font-mono text-[9.5px] font-semibold tracking-wide ${statusText[data.status]}`}>
          {data.subtitle ? `${data.subtitle} · ` : ""}
          {data.statusLabel ?? "ĐANG ĐO ĐẾM ONLINE"}
        </p>

        <div
          className={`mt-1.5 font-mono text-[11.5px] leading-[1.45] tabular-nums ${
            isOnline ? VALUE_TEXT : "text-slate-400"
          }`}
        >
          {data.metrics.map((metric) => (
            <p key={metric.key ?? metric.label} className="whitespace-nowrap text-center">
              {metric.label}: {metric.value}
            </p>
          ))}
        </div>

        {data.sampleAt ? (
          <p className="mt-1 font-mono text-[9.5px] text-slate-500">Cập nhật: {data.sampleAt}</p>
        ) : null}
      </div>

      <VLine live={data.lineLive ?? live} height={18} />

      <Handle
        type="source"
        position={Position.Bottom}
        id="child"
        className="!bottom-0 !h-0 !w-2 !min-h-0 !min-w-0 !border-0 !bg-transparent"
        title="Kéo xuống để gắn điểm con"
      />
    </div>
  );
}

export function JunctionNode({ selected }: NodeProps<JunctionFlowNode>) {
  return (
    <div
      className={`relative flex h-8 w-8 items-center justify-center rounded-md border-2 bg-white shadow-sm ${
        selected ? "border-emerald-600 ring-2 ring-emerald-500/25" : "border-slate-300"
      }`}
      title="Điểm nhánh — kéo để chỉnh cây cha-con"
    >
      <span className="h-2 w-2 rounded-full bg-slate-400" />
      <Handle
        id="in"
        type="target"
        position={Position.Top}
        className="!-top-1.5 !h-3 !w-3 !border-2 !border-white !bg-[#64748b]"
      />
      <Handle
        id="left"
        type="source"
        position={Position.Left}
        className="!-left-1.5 !h-3 !w-3 !border-2 !border-white !bg-[#64748b]"
      />
      <Handle
        id="right"
        type="source"
        position={Position.Right}
        className="!-right-1.5 !h-3 !w-3 !border-2 !border-white !bg-[#64748b]"
      />
      <Handle
        id="out"
        type="source"
        position={Position.Bottom}
        className="!-bottom-1.5 !h-3 !w-3 !border-2 !border-white !bg-[#64748b]"
      />
    </div>
  );
}

function NodeGlyph({ type, className }: { type: MeterIcon; className?: string }) {
  if (type === "cabinet") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="6" y="4" width="12" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
        <path d="M9 8h6M9 12h6M9 16h3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "fan") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M12 9.5c3-3.8 7 0 4.2 3.2M12 14.5c-3 3.8-7 0-4.2-3.2M14.5 12c3.8 3 0 7-3.2 4.2M9.5 12C5.7 9 9.8 5 12.9 8.8"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (type === "meter") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 15V9M12 15v-4M16 15v-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "pump") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 7.5V4M12 20v-3.5M16.5 12H20M4 12h3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "valve") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M4 12h16M8 8l4 4-4 4M16 8l-4 4 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "solar") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="4" y="8" width="16" height="10" rx="1" stroke="currentColor" strokeWidth="1.7" />
        <path d="M7 18v3M12 18v3M17 18v3M12 4v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "boiler") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="5" y="10" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 10V7h8v3M9 6h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 20V10l4-2v3l4-3v4l4-2v10H5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M15 11h4v9h-4" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 12a8 8 0 1 1-2.3-5.7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M20 5v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 5v1.5M12 17.5V19M19 12h-1.5M6.5 12H5M16.8 7.2l-1 1M8.2 15.8l-1 1M16.8 16.8l-1-1M8.2 8.2l-1-1"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export { NodeGlyph };
