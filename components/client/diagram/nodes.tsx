"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useDiagramActions } from "./context";
import type {
  JunctionFlowNode,
  MeterFlowNode,
  MeterIcon,
  MeterStatus,
  SourceFlowNode,
} from "./types";

const statusBorder: Record<MeterStatus, string> = {
  normal: "border-emerald-500",
  warning: "border-[#f59e0b]",
  offline: "border-slate-300",
};

const statusText: Record<MeterStatus, string> = {
  normal: "text-emerald-600",
  warning: "text-[#ea8c12]",
  offline: "text-slate-400",
};

const iconWrap: Record<MeterStatus, string> = {
  normal: "bg-emerald-50 text-emerald-600",
  warning: "bg-orange-50 text-[#ea8c12]",
  offline: "bg-slate-100 text-slate-400",
};

export function SourceNode({ data }: NodeProps<SourceFlowNode>) {
  const isElectric = data.energy === "Điện";
  const isOnline = data.normalCount > 0;

  return (
    <div className="flex w-[360px] flex-col items-center select-none sm:w-[440px]">
      {isElectric ? (
        /* Cụm ký hiệu IEC: Lưới điện trung thế 22kV -> Máy biến áp 2 cuộn dây -> Máy cắt tổng ACB */
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-3 rounded-xl border border-slate-300 bg-white px-3.5 py-2 shadow-xs">
            {/* Cột điện cao thế / Lưới điện */}
            <svg viewBox="0 0 36 36" className="h-8 w-8 shrink-0 text-amber-600" fill="none" aria-hidden>
              <path
                d="M18 3L11 33M18 3L25 33M9 33H27M8 12H28M10 20H26M13 12L23 20M23 12L13 20M12 20L24 30M24 20L12 30"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="8" cy="14" r="1.3" fill="currentColor" />
              <circle cx="28" cy="14" r="1.3" fill="currentColor" />
            </svg>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold tracking-wider uppercase text-amber-700">
                  NGUỒN LƯỚI ĐIỆN · TBA
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.2 text-[9.5px] font-bold ${
                    isOnline
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isOnline ? "bg-emerald-500" : "bg-slate-400"
                    }`}
                  />
                  {isOnline ? "ĐÓNG ĐIỆN" : "STANDBY"}
                </span>
              </div>
              <p className="truncate text-[13px] font-bold text-slate-800">{data.title}</p>
              <p className="text-[11px] font-medium text-slate-500">{data.subtitle}</p>
            </div>
          </div>

          {/* Ký hiệu IEC Máy biến áp 2 cuộn dây (Two-winding Transformer) + Máy cắt tổng ACB */}
          <svg viewBox="0 0 120 68" className="h-[64px] w-[120px] overflow-visible" fill="none" aria-hidden>
            {/* Đường dây từ lưới xuống MBA */}
            <line x1="60" y1="0" x2="60" y2="10" stroke="#059669" strokeWidth="2.4" />
            {/* Cuộn sơ cấp (HV) */}
            <circle cx="60" cy="19" r="9.5" fill="#ffffff" stroke="#0f172a" strokeWidth="2" />
            {/* Ký hiệu đấu Sao / Tam giác nhỏ bên cạnh */}
            <text x="26" y="21" fill="#475569" fontSize="8.5" fontWeight="700">
              22/0,4kV
            </text>
            {/* Cuộn thứ cấp (LV) giao nhau chuẩn IEC */}
            <circle cx="60" cy="31" r="9.5" fill="none" stroke="#059669" strokeWidth="2" />
            {/* Đường dây qua ACB tổng */}
            <line x1="60" y1="40.5" x2="60" y2="48" stroke="#059669" strokeWidth="2.4" />
            {/* Tiếp điểm ACB tổng (X + gạch đóng mạch) */}
            <path d="M56.5 45.5L63.5 51.5M63.5 45.5L56.5 51.5" stroke="#0f172a" strokeWidth="1.8" />
            <line x1="60" y1="48" x2="60" y2="68" stroke="#059669" strokeWidth="2.4" />
            <rect
              x="66"
              y="44"
              width="42"
              height="14"
              rx="3"
              fill="#ecfdf5"
              stroke="#10b981"
              strokeWidth="1"
            />
            <text x="87" y="53.5" textAnchor="middle" fill="#047857" fontSize="8" fontWeight="700">
              ACB: ON
            </text>
          </svg>
        </div>
      ) : null}

      {/* Thanh cái tổng (Main Busbar MSB) */}
      <div className="relative w-full rounded-lg border-2 border-slate-800 bg-slate-900 px-3.5 py-2.5 text-white shadow-md">
        {/* Dải đồng cái 3 pha L1 - L2 - L3 */}
        {isElectric ? (
          <div className="mb-2 flex flex-col gap-[2px]">
            <div className="h-[3px] w-full rounded-full bg-red-500/90" title="Pha A (L1)" />
            <div className="h-[3px] w-full rounded-full bg-amber-400/90" title="Pha B (L2)" />
            <div className="h-[3px] w-full rounded-full bg-sky-400/90" title="Pha C (L3)" />
          </div>
        ) : (
          <div className="mb-2 h-1.5 w-full rounded-full bg-emerald-500" />
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-bold tracking-wider uppercase text-emerald-400">
              {isElectric ? "THANH CÁI TỔNG MSB (3P4W · 380/220V)" : `TRỤC CẤP ${data.energy.toUpperCase()} CHÍNH`}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-3 font-mono text-[11.5px] text-slate-200">
              {isElectric ? (
                <>
                  <span>
                    ΣP: <strong className="text-white">{data.totalPowerText}</strong>
                  </span>
                  <span>
                    U: <strong className="text-white">{data.voltageText}</strong>
                  </span>
                  <span>
                    f: <strong className="text-white">{data.freqText}</strong>
                  </span>
                </>
              ) : (
                <span>Điểm đo trực thuộc: {data.normalCount + data.warningCount + data.offlineCount}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold">
            <span
              className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300 ring-1 ring-emerald-500/40"
              title="Điểm đo hoạt động bình thường"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {data.normalCount}
            </span>
            <span
              className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300 ring-1 ring-amber-500/40"
              title="Điểm đo cảnh báo / mất kết nối"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              {data.warningCount}
            </span>
            <span
              className="inline-flex items-center gap-1 rounded bg-slate-700 px-1.5 py-0.5 text-slate-300 ring-1 ring-slate-600"
              title="Điểm đo ngoại tuyến"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              {data.offlineCount}
            </span>
          </div>
        </div>

        <Handle
          type="source"
          position={Position.Bottom}
          id="bus-out"
          className="!-bottom-1.5 !h-3 !w-3 !border-2 !border-white !bg-emerald-500"
        />
      </div>
    </div>
  );
}

export function MeterNode({ id, data, selected }: NodeProps<MeterFlowNode>) {
  const { openSettings, refreshLive } = useDiagramActions();
  const isElectric = data.energy === "Điện";
  const isOnline = data.status === "normal";

  return (
    <div className="flex w-[264px] flex-col items-center">
      <Handle
        type="target"
        position={Position.Top}
        id="parent"
        className="!-top-1.5 !h-3 !w-3 !border-2 !border-white !bg-emerald-600"
        title="Nối từ Thanh cái / Điểm cha"
      />

      {/* Nhánh lộ ra tủ điện chuẩn IEC: Dao cắt MCCB (QF) + Biến dòng đo lường (CT) */}
      {isElectric ? (
        <svg viewBox="0 0 180 54" className="h-[52px] w-[180px] overflow-visible select-none" fill="none" aria-hidden>
          {/* Dây pha trục đứng từ thanh cái xuống */}
          <line
            x1="90"
            y1="0"
            x2="90"
            y2="14"
            stroke={isOnline ? "#059669" : "#94a3b8"}
            strokeWidth="2.4"
          />
          {/* 3 gạch chéo ký hiệu đường dây 3 pha (3P4W) */}
          <path d="M85 6L95 2M85 9.5L95 5.5M85 13L95 9" stroke="#64748b" strokeWidth="1.2" />
          <text x="78" y="10" textAnchor="end" fill="#64748b" fontSize="8.5" fontWeight="700">
            3P4W
          </text>

          {/* Ký hiệu MCCB / CB nhánh (QF) */}
          <path d="M86.5 13.5L93.5 19.5M93.5 13.5L86.5 19.5" stroke="#0f172a" strokeWidth="1.7" />
          {isOnline ? (
            <line x1="90" y1="14" x2="90" y2="30" stroke="#059669" strokeWidth="2.4" />
          ) : (
            <line x1="90" y1="16" x2="82" y2="28" stroke="#dc2626" strokeWidth="2.2" />
          )}
          <rect
            x="98"
            y="13"
            width="48"
            height="13"
            rx="3"
            fill={isOnline ? "#ecfdf5" : "#fef2f2"}
            stroke={isOnline ? "#10b981" : "#f87171"}
            strokeWidth="1"
          />
          <text
            x="122"
            y="22"
            textAnchor="middle"
            fill={isOnline ? "#047857" : "#b91c1c"}
            fontSize="7.8"
            fontWeight="700"
          >
            {isOnline ? "MCCB: ON" : "MCCB"}
          </text>

          {/* Ký hiệu Biến dòng đo lường CT (2 vòng tròn lồng trên trục lộ ra) */}
          <line
            x1="90"
            y1="30"
            x2="90"
            y2="54"
            stroke={isOnline ? "#059669" : "#94a3b8"}
            strokeWidth="2.4"
          />
          <circle cx="90" cy="37" r="4.5" fill="none" stroke="#0f172a" strokeWidth="1.6" />
          <circle cx="90" cy="43" r="4.5" fill="none" stroke="#0f172a" strokeWidth="1.6" />
          {/* Đường tín hiệu dòng từ CT vào đồng hồ PM2230 */}
          <path d="M94.5 40H108V54" stroke="#0284c7" strokeWidth="1.2" strokeDasharray="2 1.5" />
          <text x="81" y="42.5" textAnchor="end" fill="#0369a1" fontSize="8" fontWeight="700">
            CT
          </text>
        </svg>
      ) : null}

      {/* Mặt đồng hồ đo đếm đa năng / Tủ phân phối (Digital Power Meter Bay) */}
      <div
        className={`diagram-card w-full overflow-hidden rounded-xl border-2 bg-white shadow-[0_3px_12px_rgba(15,23,42,0.08)] ${statusBorder[data.status]} ${
          selected ? "ring-2 ring-emerald-500/30" : ""
        }`}
      >
        {/* Thanh tiêu đề ngăn lộ tủ điện */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-3 py-1.5 text-white">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                data.status === "normal"
                  ? "bg-emerald-400 shadow-[0_0_6px_#34d399]"
                  : data.status === "warning"
                    ? "bg-amber-400"
                    : "bg-slate-400"
              }`}
            />
            <span className="truncate font-mono text-[10.5px] font-bold tracking-wider uppercase text-slate-200">
              {data.subtitle ? `ĐỒNG HỒ · ${data.subtitle}` : `NGĂN LỘ · ${data.energy.toUpperCase()}`}
            </span>
          </div>
          <div className="flex items-center gap-1 text-slate-300">
            <button
              type="button"
              className="rounded p-0.5 hover:bg-slate-800 hover:text-emerald-400"
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
              className="rounded p-0.5 hover:bg-slate-800 hover:text-white"
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
        </div>

        <div className="px-3.5 py-2.5">
          <div className="flex items-center gap-2.5">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200/80 ${iconWrap[data.status]}`}
            >
              {data.iconImage ? (
                <img src={data.iconImage} alt="" className="h-full w-full object-cover" />
              ) : (
                <NodeGlyph type={data.icon} className="h-5 w-5" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-bold text-slate-800">{data.title}</p>
              {data.statusLabel ? (
                <p className={`text-[10.5px] font-bold tracking-wide ${statusText[data.status]}`}>
                  {data.statusLabel}
                </p>
              ) : (
                <p className="text-[10.5px] font-semibold text-emerald-600">ĐANG ĐO ĐẾM ONLINE</p>
              )}
            </div>
          </div>

          {/* Màn hình thông số LCD kỹ thuật số */}
          <div className="mt-2.5 grid grid-cols-2 gap-1.5 rounded-lg border border-slate-200 bg-slate-50/90 p-2">
            {data.metrics.map((metric) => (
              <div
                key={metric.key ?? metric.label}
                className="flex items-baseline justify-between gap-1 rounded border border-slate-200/70 bg-white px-2 py-1 shadow-2xs"
              >
                <span className="font-mono text-[10.5px] font-bold text-slate-500">
                  {metric.label}
                </span>
                <span className="font-mono text-[12px] font-bold tabular-nums text-slate-800">
                  {metric.value}
                </span>
              </div>
            ))}
          </div>

          {data.sampleAt ? (
            <p className="mt-2 text-right font-mono text-[10px] text-slate-400">
              Cập nhật: {data.sampleAt}
            </p>
          ) : null}
        </div>
      </div>

      {/* Mũi tên phụ tải đầu ra (Outgoing Load Feeder) */}
      {isElectric ? (
        <svg viewBox="0 0 120 26" className="h-[24px] w-[120px] select-none" fill="none" aria-hidden>
          <line
            x1="60"
            y1="0"
            x2="60"
            y2="18"
            stroke={isOnline ? "#059669" : "#94a3b8"}
            strokeWidth="2.2"
          />
          <polygon points="55,15 65,15 60,23" fill={isOnline ? "#059669" : "#94a3b8"} />
          <text x="70" y="16" fill="#64748b" fontSize="8.5" fontWeight="600">
            Phụ tải
          </text>
        </svg>
      ) : null}

      <Handle
        type="source"
        position={Position.Bottom}
        id="child"
        className="!-bottom-1.5 !h-3 !w-3 !border-2 !border-white !bg-emerald-600"
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
