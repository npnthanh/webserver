"use client";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CustomSelect } from "@/components/ui/CustomSelect";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { METER_PARAMETERS } from "@/lib/meter-parameters";
import { hydrateMeterModels, type MeterModelDef } from "@/lib/meter-catalog";
import { hydrateMeterTypeDefs, type MeterTypeDef } from "@/lib/meter-types";
import {
  hydrateDevices,
  kindFromDeviceType,
  todaySyncLabel,
  upsertDevice,
  type DeviceExtraField,
  type DeviceRegister,
} from "@/lib/devices";

type ExtraField = DeviceExtraField;
type RegisterRow = DeviceRegister;

const dataTypes = ["UINT16", "UINT32", "INT32", "FLOAT32", "FLOAT64"];

function defaultPm2230Registers(): RegisterRow[] {
  const coreKeys = ["EPaed", "Papt", "Qrpt", "Sapt", "VLNavg", "VLLavg", "Iavg", "PFt", "F", "THDVln", "THDCa"];
  return METER_PARAMETERS.filter((param) => coreKeys.includes(param.key)).map((param, idx) => ({
    id: `r-${idx + 1}`,
    address: param.key,
    name: `${param.name}${param.unit ? ` (${param.unit})` : ""}`,
    dataType: "FLOAT32",
    multiplier: "1.0",
  }));
}

function nextId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyRegisterRows(): RegisterRow[] {
  return [
    { id: "r1", address: "", name: "", dataType: "FLOAT32", multiplier: "1.0" },
  ];
}

export function AddCustomDeviceForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editingId = searchParams.get("id");

  // Loại đồng hồ → Thương hiệu → Tên model: lấy từ trang Cấu hình loại đồng hồ.
  const [meterTypes, setMeterTypes] = useState<MeterTypeDef[]>([]);
  const [catalog, setCatalog] = useState<MeterModelDef[]>([]);
  const [meterType, setMeterType] = useState("");
  const [brand, setBrand] = useState("");
  const [modelId, setModelId] = useState("");
  const [legacyLabel, setLegacyLabel] = useState("");
  const [serial, setSerial] = useState("");
  const [error, setError] = useState("");
  // Không còn ô sửa ảnh / ghi chú: giữ nguyên giá trị đã lưu của đồng hồ cũ khi cập nhật.
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [isEdit, setIsEdit] = useState(false);
  const [extraFields, setExtraFields] = useState<ExtraField[]>([]);
  const [fieldToDelete, setFieldToDelete] = useState<ExtraField | null>(null);
  const [rowToDelete, setRowToDelete] = useState<RegisterRow | null>(null);
  const [rows, setRows] = useState<RegisterRow[]>(emptyRegisterRows());

  const lastEdited = useMemo(() => "Vừa xong", []);

  useEffect(() => {
    let active = true;
    void Promise.all([hydrateDevices(), hydrateMeterModels({ force: true }), hydrateMeterTypeDefs()]).then(
      ([devices, models, types]) => {
      if (!active) return;
      setCatalog(models);
      setMeterTypes(types);
      if (!editingId) {
        setIsEdit(false);
        return;
      }
      const existing = devices.find((item) => item.id === editingId);
      if (!existing) {
        setIsEdit(false);
        return;
      }
      setIsEdit(true);
      const linkedModel =
        models.find((item) => item.id === existing.modelId) ??
        models.find(
          (item) =>
            item.brand.toLowerCase() === existing.brand.toLowerCase() &&
            item.modelName.toLowerCase() === existing.name.toLowerCase(),
        );
      if (linkedModel) {
        setMeterType(linkedModel.meterType);
        setBrand(linkedModel.brand);
        setModelId(linkedModel.id);
      } else {
        setLegacyLabel(`${existing.brandModel || existing.name}${existing.category ? ` · ${existing.category}` : ""}`);
      }
      setSerial(existing.sn);
      setNotes(existing.notes ?? "");
      setPreview(existing.image ?? null);
      setExtraFields(existing.extraFields ?? []);
      setRows(existing.registers?.length ? existing.registers : emptyRegisterRows());
      },
    );
    return () => {
      active = false;
    };
  }, [editingId]);

  const typeOptions = useMemo(() => {
    const withModels = new Set(catalog.map((item) => item.meterType));
    return meterTypes.filter((item) => withModels.has(item.name));
  }, [catalog, meterTypes]);
  const brandOptions = useMemo(
    () =>
      Array.from(new Set(catalog.filter((item) => item.meterType === meterType).map((item) => item.brand))).sort(
        (a, b) => a.localeCompare(b, "vi"),
      ),
    [catalog, meterType],
  );
  const modelOptions = useMemo(
    () => catalog.filter((item) => item.meterType === meterType && item.brand === brand),
    [brand, catalog, meterType],
  );
  const selectedModel = catalog.find((item) => item.id === modelId) ?? null;

  function addExtraField() {
    setExtraFields((current) => [
      ...current,
      { id: nextId("f"), label: "Trường mới", value: "" },
    ]);
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        id: nextId("r"),
        address: "",
        name: "",
        dataType: "FLOAT32",
        multiplier: "1.0",
      },
    ]);
  }

  function updateRow(id: string, key: keyof RegisterRow, value: string) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
    );
  }

  async function handleSubmit() {
    const serialNumber = serial.trim();
    if (!selectedModel || !serialNumber) {
      setError("Vui lòng chọn loại đồng hồ, thương hiệu, tên model và nhập Serial.");
      return;
    }
    setError("");
    const id = editingId || `dev-${Date.now()}`;

    try {
      await upsertDevice({
        id,
        name: selectedModel.modelName,
        sn: serialNumber,
        category: selectedModel.modelName,
        brandModel: `${selectedModel.brand} ${selectedModel.modelName}`,
        brand: selectedModel.brand,
        type: selectedModel.meterType,
        kind: kindFromDeviceType(selectedModel.meterType),
        status: "active",
        lastSync: todaySyncLabel(),
        protocol: selectedModel.protocol ?? undefined,
        modelId: selectedModel.id,
        notes: notes.trim(),
        image: preview ?? undefined,
        extraFields,
        registers: rows.filter((row) => row.address.trim() || row.name.trim()),
      });
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "";
      setError(
        message.toLowerCase().includes("duplicate") || message.toLowerCase().includes("uq_devices_serial")
          ? "Serial này đã được dùng cho loại thiết bị khác."
          : "Không lưu được loại thiết bị. Hãy thử lại.",
      );
      return;
    }

    router.push("/thiet-bi");
  }

  return (
    <form
      className="mx-auto flex max-w-[1100px] flex-col gap-5 p-6 pb-28 lg:p-8"
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <div className="flex items-start gap-3">
        <Link
          href="/thiet-bi"
          className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-white hover:text-emerald-600 transition-colors"
          aria-label="Quay lại danh sách thiết bị"
        >
          <BackIcon className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {isEdit ? "Cập nhật loại đồng hồ" : "Thêm loại đồng hồ"}
          </h1>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-slate-700 uppercase">
            <InfoIcon className="h-4 w-4 text-emerald-600" />
            Thông số chung
          </h2>
          <button
            type="button"
            onClick={addExtraField}
            className="text-xs font-bold tracking-wide text-emerald-600 hover:text-emerald-700 hover:underline"
          >
            + THÊM TRƯỜNG THÔNG TIN
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {catalog.length === 0 ? (
            <div className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Chưa có model đồng hồ nào.{" "}
              <Link href="/cau-hinh/loai-dong-ho" className="font-semibold text-emerald-700 hover:underline">
                Mở Cấu hình loại đồng hồ
              </Link>{" "}
              để thêm loại, thương hiệu và model trước.
            </div>
          ) : null}
          {legacyLabel && !selectedModel ? (
            <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              Đồng hồ này đang lưu theo kiểu cũ: <span className="font-semibold">{legacyLabel}</span>. Hãy chọn lại
              loại, thương hiệu và model từ danh mục cấu hình.
            </div>
          ) : null}
          <Field label="1. Loại đồng hồ">
            <CustomSelect
              value={meterType}
              onChange={(e) => {
                setMeterType(e.target.value);
                setBrand("");
                setModelId("");
              }}
              className="input"
              required
            >
              <option value="">Chọn loại đồng hồ</option>
              {typeOptions.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </CustomSelect>
          </Field>
          <Field label="2. Thương hiệu / Nhà sản xuất">
            <CustomSelect
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value);
                setModelId("");
              }}
              className="input"
              disabled={!meterType}
              required
            >
              <option value="">Chọn thương hiệu</option>
              {brandOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </CustomSelect>
          </Field>
          <Field label="3. Tên model">
            <CustomSelect
              value={modelId}
              onChange={(e) => {
                const nextId = e.target.value;
                setModelId(nextId);
                const next = catalog.find((item) => item.id === nextId);
                if (
                  next &&
                  /pm2230/i.test(next.modelName) &&
                  rows.length === 1 &&
                  !rows[0].address.trim() &&
                  !rows[0].name.trim()
                ) {
                  setRows(defaultPm2230Registers());
                }
              }}
              className="input"
              disabled={!brand}
              required
            >
              <option value="">Chọn tên model</option>
              {modelOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.modelName}
                </option>
              ))}
            </CustomSelect>
            {selectedModel ? (
              <p className="mt-1.5 text-[11px] text-slate-400">
                Giao thức: {selectedModel.protocol || "—"}
                {selectedModel.modelCode != null ? ` · Mã model (MM): ${selectedModel.modelCode}` : ""}
              </p>
            ) : null}
          </Field>
          <Field label="4. Serial">
            <input
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="VD: 250384934"
              className="input"
              required
            />
          </Field>
          {extraFields.map((field) => (
            <div key={field.id} className="sm:col-span-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-end gap-2">
              <Field label="TÊN TRƯỜNG">
                <input
                  value={field.label}
                  onChange={(e) =>
                    setExtraFields((current) =>
                      current.map((item) =>
                        item.id === field.id ? { ...item, label: e.target.value } : item,
                      ),
                    )
                  }
                  placeholder="VD: Điện áp định mức"
                  className="input"
                />
              </Field>
              <Field label="GIÁ TRỊ">
                <input
                  value={field.value}
                  onChange={(e) =>
                    setExtraFields((current) =>
                      current.map((item) =>
                        item.id === field.id ? { ...item, value: e.target.value } : item,
                      ),
                    )
                  }
                  placeholder="Nhập giá trị"
                  className="input"
                />
              </Field>
              <button
                type="button"
                className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"
                onClick={() =>
                  setExtraFields((current) => current.filter((item) => item.id !== field.id))
                }
                aria-label="Xóa trường"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-slate-700 uppercase">
            <DocIcon className="h-4 w-4 text-emerald-600" />
            Hàm nhận dữ liệu từ gateway
          </h2>
          <button
            type="button"
            onClick={addRow}
            className="text-xs font-bold tracking-wide text-emerald-600 hover:text-emerald-700 hover:underline"
          >
            + THÊM DÒNG
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-semibold tracking-wide text-slate-400">
                {/* Dữ liệu lưu giữ nguyên: cột "Tên" ở trường address (VD: EPaed), "Mô tả" ở trường name. */}
                <th className="px-2 py-2">TÊN</th>
                <th className="px-2 py-2">MÔ TẢ</th>
                <th className="px-2 py-2">KIỂU DỮ LIỆU</th>
                <th className="px-2 py-2">HỆ SỐ NHÂN</th>
                <th className="w-12 px-2 py-2 text-right">THAO TÁC</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-2 py-2">
                    <input
                      value={row.address}
                      onChange={(e) => updateRow(row.id, "address", e.target.value)}
                      placeholder="VD: EPaed"
                      aria-label="Tên"
                      className="input h-9"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={row.name}
                      onChange={(e) => updateRow(row.id, "name", e.target.value)}
                      placeholder="VD: Điện năng tác dụng nhận (kWh)"
                      aria-label="Mô tả"
                      className="input h-9"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <CustomSelect
                      value={row.dataType}
                      onChange={(e) => updateRow(row.id, "dataType", e.target.value)}
                      className="input h-9"
                    >
                      {dataTypes.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </CustomSelect>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={row.multiplier}
                      onChange={(e) => updateRow(row.id, "multiplier", e.target.value)}
                      className="input h-9"
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500"
                      onClick={() =>
                        setRows((current) => current.filter((item) => item.id !== row.id))
                      }
                      aria-label="Xóa dòng"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="sticky bottom-0 -mx-6 mt-1 flex items-center justify-between gap-3 border-t border-slate-200 bg-[#f3f5f8]/95 px-6 py-4 backdrop-blur lg:-mx-8 lg:px-8">
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <ClockIcon className="h-4 w-4" />
          Chỉnh sửa lần cuối: {lastEdited}
        </p>
        <div className="flex items-center gap-3">
          {error ? <p className="text-sm font-medium text-red-500">{error}</p> : null}
          <Link
            href="/thiet-bi"
            className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors shadow-xs"
          >
            Hủy bỏ
          </Link>
          <button
            type="submit"
            className="h-10 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors"
          >
            {isEdit ? "Cập nhật loại đồng hồ" : "Lưu loại đồng hồ"}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(fieldToDelete)}
        title="Xác nhận xóa trường"
        description={`Bạn có chắc chắn muốn xóa trường "${fieldToDelete?.label || "này"}" không?`}
        confirmText="Xác nhận xóa"
        onConfirm={() => {
          if (fieldToDelete) {
            setExtraFields((current) => current.filter((item) => item.id !== fieldToDelete.id));
            setFieldToDelete(null);
          }
        }}
        onCancel={() => setFieldToDelete(null)}
      />

      <ConfirmDialog
        open={Boolean(rowToDelete)}
        title="Xác nhận xóa thanh ghi"
        description={`Bạn có chắc chắn muốn xóa thanh ghi "${rowToDelete?.name || "này"}" không?`}
        confirmText="Xác nhận xóa"
        onConfirm={() => {
          if (rowToDelete) {
            setRows((current) => current.filter((item) => item.id !== rowToDelete.id));
            setRowToDelete(null);
          }
        }}
        onCancel={() => setRowToDelete(null)}
      />
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function BackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 5 8 12l7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 11v5M12 8v.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DocIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 3.5V9h5.5M8.5 13h7M8.5 16.5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 7h14M10 7V5h4v2M8 7l.8 12h6.4L16 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v4.5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
