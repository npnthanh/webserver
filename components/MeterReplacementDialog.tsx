"use client";

import { useEffect, useState } from "react";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { formatAppNumber } from "@/lib/number-format";
import {
  dismissMeterResetSuspect,
  saveMeterReplacement,
  undoMeterReplacement,
  type MeterReplacementRecord,
  type MeterReplacementState,
  type MeterResetSuspect,
} from "@/lib/meter-replacement";
import { formatCivilDateTime, formatStoredVietnam, vietnamNow } from "@/lib/vietnam-time";

export type ReplacementDeviceOption = {
  id: string;
  label: string;
  /** Lý do không chọn được (đang gắn ở điểm đo / dự án khác). */
  usedBy: string;
};

/** Giá trị mặc định ô thời điểm thay: lúc nghi thay (nếu có) hoặc bây giờ, giờ Việt Nam. */
function defaultReplacedAt(suspect: MeterResetSuspect | null) {
  if (suspect) return suspect.at.replace(" ", "T").slice(0, 16);
  return vietnamNow().stamp.slice(0, 16);
}

function numberText(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "" : String(Number(value.toFixed(3)));
}

function kwh(value: number | null) {
  return value == null ? "—" : `${formatAppNumber(value, { maxDecimals: 3 })} kWh`;
}

/**
 * Biên bản thay đồng hồ của một điểm đo.
 * Điện năng của kỳ có thay = (chỉ số chốt đồng hồ cũ − chỉ số đầu kỳ) + (chỉ số cuối kỳ − chỉ số ban đầu đồng hồ mới).
 */
export function MeterReplacementDialog({
  projectId,
  point,
  devices,
  latestKwh,
  latestAt,
  suspect,
  history,
  onClose,
  onChanged,
}: {
  projectId: string;
  point: { id: string; name: string; sn: string; deviceId: string | null };
  devices: ReplacementDeviceOption[];
  latestKwh: number | null;
  /** Thời điểm bản tin cuối (UTC, định dạng lưu của gateway). */
  latestAt: string | null;
  suspect: MeterResetSuspect | null;
  history: MeterReplacementRecord[];
  onClose: () => void;
  onChanged: (state: MeterReplacementState) => void;
}) {
  const [replacedAt, setReplacedAt] = useState(() => defaultReplacedAt(suspect));
  const [finalIndex, setFinalIndex] = useState(() => numberText(suspect ? suspect.beforeIndex : latestKwh));
  const [initialIndex, setInitialIndex] = useState("0");
  const [newDeviceId, setNewDeviceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmUndoId, setConfirmUndoId] = useState<number | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  async function run(work: () => Promise<MeterReplacementState>, closeAfter: boolean) {
    setBusy(true);
    setError("");
    try {
      const state = await work();
      onChanged(state);
      if (closeAfter) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được biên bản thay đồng hồ.");
    } finally {
      setBusy(false);
      setConfirmUndoId(null);
    }
  }

  function submit() {
    const finalValue = finalIndex.trim() === "" ? null : Number(finalIndex.replace(",", "."));
    const initialValue = initialIndex.trim() === "" ? 0 : Number(initialIndex.replace(",", "."));
    if (!replacedAt) return setError("Vui lòng chọn thời điểm thay đồng hồ.");
    if (finalValue != null && (!Number.isFinite(finalValue) || finalValue < 0)) {
      return setError("Chỉ số chốt đồng hồ cũ phải là số không âm.");
    }
    if (!Number.isFinite(initialValue) || initialValue < 0) {
      return setError("Chỉ số ban đầu đồng hồ mới phải là số không âm.");
    }
    void run(
      () =>
        saveMeterReplacement(projectId, {
          meterPointId: point.id,
          replacedAt,
          finalIndex: finalValue,
          initialIndex: initialValue,
          newDeviceId: newDeviceId || null,
        }),
      true,
    );
  }

  const latestLabel = latestAt ? formatStoredVietnam(latestAt)?.slice(0, 16) : null;
  const newSerialLabel = newDeviceId ? devices.find((item) => item.id === newDeviceId)?.label ?? "" : point.sn;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs" onClick={() => !busy && onClose()} />
      <div className="relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-bold text-slate-900">Thay đồng hồ</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Điểm đo <span className="font-semibold text-slate-700">{point.name}</span> · đồng hồ đang gắn{" "}
            <span className="font-mono font-semibold text-slate-700">{point.sn}</span>
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {suspect ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
              Hệ thống thấy chỉ số tụt lúc <strong>{formatCivilDateTime(suspect.at)}</strong>:{" "}
              {kwh(suspect.beforeIndex)} → {kwh(suspect.afterIndex)} và không hồi lại. Điện năng đang được tạm nối tiếp
              từ lần đọc {kwh(suspect.afterIndex)}; nhập biên bản để tính đủ phần điện lúc thay.
              <div className="mt-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => dismissMeterResetSuspect(projectId, suspect.id), true)}
                  className="font-semibold text-amber-700 underline-offset-2 hover:underline disabled:opacity-50"
                >
                  Không phải thay đồng hồ — bỏ qua cảnh báo
                </button>
              </div>
            </div>
          ) : null}

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500">THỜI ĐIỂM THAY</span>
            <input
              type="datetime-local"
              value={replacedAt}
              onChange={(event) => setReplacedAt(event.target.value)}
              className="input"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500">
                CHỈ SỐ CHỐT ĐỒNG HỒ CŨ (kWh)
              </span>
              <input
                inputMode="decimal"
                value={finalIndex}
                onChange={(event) => setFinalIndex(event.target.value)}
                placeholder="Bỏ trống = lần đọc cuối"
                className="input"
              />
              <span className="mt-1 block text-[11px] text-slate-400">
                {latestKwh != null
                  ? `Lần đọc gần nhất: ${kwh(latestKwh)}${latestLabel ? ` lúc ${latestLabel}` : ""}`
                  : "Số trên mặt đồng hồ cũ lúc tháo."}
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500">
                CHỈ SỐ BAN ĐẦU ĐỒNG HỒ MỚI (kWh)
              </span>
              <input
                inputMode="decimal"
                value={initialIndex}
                onChange={(event) => setInitialIndex(event.target.value)}
                className="input"
              />
              <span className="mt-1 block text-[11px] text-slate-400">Đồng hồ mới thường bắt đầu từ 0.</span>
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500">ĐỒNG HỒ MỚI</span>
            <CustomSelect
              value={newDeviceId}
              onChange={(event) => setNewDeviceId(event.target.value)}
              className="input appearance-none pr-9"
              searchable
              searchPlaceholder="Tìm serial, model..."
            >
              <option value="">Dùng lại serial hiện tại ({point.sn})</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id} disabled={Boolean(device.usedBy)}>
                  {device.label}
                  {device.usedBy ? ` (${device.usedBy})` : ""}
                </option>
              ))}
            </CustomSelect>
            <span className="mt-1 block text-[11px] text-slate-400">
              Chọn đồng hồ khác nếu đồng hồ mới có số serial khác (khai báo ở trang Thiết bị trước).
            </span>
          </label>

          <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs leading-relaxed text-slate-600">
            Điện năng kỳ có thay đồng hồ = (chỉ số chốt cũ{finalIndex.trim() ? ` ${finalIndex.trim()}` : ""} − chỉ số
            đầu kỳ) + (chỉ số cuối kỳ của {newSerialLabel || "đồng hồ mới"} − {initialIndex.trim() || "0"}). Các
            biểu đồ, chi phí, khí nhà kính và báo cáo đều tính theo cách này.
          </div>

          {history.length ? (
            <div>
              <p className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500">LỊCH SỬ THAY ĐỒNG HỒ</p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {history.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-xs">
                    <span className="font-semibold text-slate-800">{formatCivilDateTime(item.at)}</span>
                    <span className="text-slate-600">
                      {item.oldSerial !== item.newSerial ? `SN ${item.oldSerial} ` : ""}chốt {kwh(item.finalIndex)} →{" "}
                      {item.oldSerial !== item.newSerial ? `SN ${item.newSerial} ` : ""}bắt đầu {kwh(item.initialIndex)}
                    </span>
                    <span className="text-slate-400">· {item.recordedBy}</span>
                    {item.canUndo ? (
                      confirmUndoId === item.id ? (
                        <span className="ml-auto inline-flex gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => undoMeterReplacement(projectId, item.id), false)}
                            className="font-semibold text-rose-600 hover:underline disabled:opacity-50"
                          >
                            Xác nhận hoàn tác
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmUndoId(null)}
                            className="font-semibold text-slate-500 hover:underline"
                          >
                            Không
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirmUndoId(item.id)}
                          className="ml-auto font-semibold text-slate-500 hover:text-rose-600 hover:underline disabled:opacity-50"
                        >
                          Hoàn tác
                        </button>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-2 text-xs font-medium text-rose-700">{error}</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-slate-100 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-50"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="inline-flex h-10 items-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "Đang lưu..." : "Lưu biên bản"}
          </button>
        </div>
      </div>
    </div>
  );
}
