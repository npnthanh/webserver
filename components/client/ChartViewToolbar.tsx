"use client";

import { exportToExcel, type ExcelCellValue } from "@/lib/excel-export";
import { chartTimeLabel, type ChartSample } from "@/lib/gateway-series";
import { formatStoredVietnam } from "@/lib/vietnam-time";

export type ChartViewMode = "chart" | "table";

export type ChartTableColumn = {
  header: string;
  color?: string;
  align?: "left" | "right";
  width?: number;
};

export type ChartTableRow = {
  label: string;
  values: { display: string; raw: ExcelCellValue }[];
};

export function buildSampleTableRows(
  samples: ChartSample[] | undefined,
  seriesList: { name: string; color?: string; unit?: string; digits?: number; values: number[] }[],
  windowRange: { start: number; end: number },
  totalPoints: number,
): ChartTableRow[] {
  if (!samples?.length) return [];
  const M = samples.length;
  const rows: ChartTableRow[] = [];
  for (let k = 0; k < M; k += 1) {
    const pos =
      M === 1
        ? windowRange.start
        : Math.round((k / Math.max(M - 1, 1)) * Math.max(totalPoints - 1, 1));
    if (pos < windowRange.start || pos > windowRange.end) continue;
    const rawAt = samples[k].at;
    const label =
      (rawAt ? formatStoredVietnam(rawAt) : null) ||
      chartTimeLabel(samples, pos, totalPoints, "tooltip") ||
      `Mẫu #${k + 1}`;
    const values = seriesList.map((s) => {
      const digits = s.digits ?? 2;
      const num = Number((s.values[pos] ?? 0).toFixed(digits));
      const formatted = num.toFixed(digits);
      return {
        raw: num,
        display: s.unit ? `${formatted} ${s.unit}` : formatted,
      };
    });
    rows.push({ label, values });
  }
  return rows;
}

export function ChartViewToolbar({
  view,
  onViewChange,
  onRefresh,
  showSum,
  onToggleSum,
}: {
  view: ChartViewMode;
  onViewChange: (next: ChartViewMode) => void;
  onRefresh?: () => void;
  showSum?: boolean;
  onToggleSum?: () => void;
}) {
  return (
    <div className="flex items-center">
      <ToolbarIconBtn
        label="Biểu đồ"
        active={view === "chart"}
        onClick={() => onViewChange("chart")}
      >
        <BarIcon className="h-4 w-4" />
      </ToolbarIconBtn>
      {onToggleSum ? (
        <ToolbarIconBtn label="Tổng" active={Boolean(showSum)} onClick={onToggleSum}>
          <SigmaIcon className="h-4 w-4" />
        </ToolbarIconBtn>
      ) : null}
      <ToolbarIconBtn
        label="Bảng dữ liệu"
        active={view === "table"}
        onClick={() => onViewChange("table")}
      >
        <TableIcon className="h-4 w-4" />
      </ToolbarIconBtn>
      {onRefresh ? (
        <ToolbarIconBtn label="Làm mới" onClick={onRefresh}>
          <RefreshIcon className="h-4 w-4" />
        </ToolbarIconBtn>
      ) : null}
    </div>
  );
}

export function ChartDataTable({
  title,
  subtitle,
  filename,
  columns,
  rows,
  rowCountLabel,
  emptyMessage = "Chưa có số liệu trong khoảng thời gian đã chọn.",
}: {
  title: string;
  subtitle?: string;
  filename: string;
  columns: ChartTableColumn[];
  rows: ChartTableRow[];
  rowCountLabel?: string;
  emptyMessage?: string;
}) {
  const handleExport = () => {
    exportToExcel({
      filename,
      sheetName: title,
      title,
      subtitle,
      columns: columns.map((col) => ({
        header: col.header,
        width: col.width ?? Math.max(16, col.header.length + 6),
      })),
      rows: rows.map((row) => [row.label, ...row.values.map((cell) => cell.raw)]),
    });
  };

  return (
    <div className="mt-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-800">
            {rowCountLabel ?? `Bảng số liệu (${rows.length} dòng dữ liệu)`}
          </p>
          {subtitle ? <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          onClick={handleExport}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700"
        >
          <ExcelIcon className="h-3.5 w-3.5" />
          Xuất Excel (.xlsx)
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">{emptyMessage}</p>
      ) : (
        <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-xs">
              <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                {columns.map((col, idx) => (
                  <th
                    key={`${col.header}-${idx}`}
                    className={`px-3 py-2.5 font-semibold ${col.align === "right" ? "text-right" : ""}`}
                    style={col.color ? { color: col.color } : undefined}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, rowIdx) => (
                <tr key={`${row.label}-${rowIdx}`} className="text-slate-600 hover:bg-slate-50/70">
                  <td className="px-3 py-2 font-medium whitespace-nowrap text-slate-700">
                    {row.label}
                  </td>
                  {row.values.map((cell, cellIdx) => (
                    <td
                      key={cellIdx}
                      className={`px-3 py-2 font-mono text-[13px] whitespace-nowrap ${
                        columns[cellIdx + 1]?.align === "right" ? "text-right" : ""
                      }`}
                    >
                      {cell.display}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ToolbarIconBtn({
  children,
  label,
  onClick,
  active = false,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors ${
        active ? "bg-slate-100 text-slate-900" : "hover:bg-slate-100 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

function BarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 19V11M10 19V6M15 19v-8M20 19V9"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SigmaIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M18 5H7l5 7-5 7h11"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TableIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="5" width="16" height="14" rx="1.8" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4 10h16M10 10v9" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 12a8 8 0 1 1-2.3-5.7M20 5v5h-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExcelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 3v6h6M9.5 12.5l5 5M14.5 12.5l-5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
