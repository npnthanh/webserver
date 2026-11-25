"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CustomSelect } from "@/components/ui/CustomSelect";
import {
  hydrateMeterModels,
  loadGatewayProtocolVersions,
  loadMeterModels,
  parseIdentCode,
  removeMeterModel,
  upsertMeterModel,
  type MeterModelDef,
} from "@/lib/meter-catalog";
import {
  deleteMeterTypeConfig,
  hydrateMeterTypeDefs,
  loadMeterTypeDefs,
  saveMeterTypeConfig,
  type MeterTypeDef,
} from "@/lib/meter-types";

type TypeDraft = { name: string; code: string; description: string };
type ModelDraft = { meterType: string; brand: string; modelName: string; code: string; protocol: string };

const EMPTY_TYPE: TypeDraft = { name: "", code: "", description: "" };
const EMPTY_MODEL: ModelDraft = { meterType: "", brand: "", modelName: "", code: "", protocol: "" };

type PendingDelete = { kind: "type"; name: string } | { kind: "model"; model: MeterModelDef };

/** "types": trang Cấu hình → Loại điểm đo; "models": trang Cấu hình → Loại đồng hồ (model). */
export function MeterCatalogConfig({ section }: { section: "types" | "models" }) {
  const [types, setTypes] = useState<MeterTypeDef[]>([]);
  const [models, setModels] = useState<MeterModelDef[]>([]);
  const [protocolVersions, setProtocolVersions] = useState<string[]>([]);

  const [typeDraft, setTypeDraft] = useState<TypeDraft>(EMPTY_TYPE);
  const [editingType, setEditingType] = useState<string | null>(null);
  const [typeError, setTypeError] = useState("");
  const [savingType, setSavingType] = useState(false);

  const [modelDraft, setModelDraft] = useState<ModelDraft>(EMPTY_MODEL);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [modelError, setModelError] = useState("");
  const [savingModel, setSavingModel] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteError, setDeleteError] = useState("");
  /** Sắp xếp theo mã nhận dạng: none = thứ tự gốc, asc = tăng dần, desc = giảm dần. */
  const [typeSort, setTypeSort] = useState<SortDir>("none");
  const [modelSort, setModelSort] = useState<SortDir>("none");

  useEffect(() => {
    let active = true;
    void Promise.all([hydrateMeterTypeDefs(), hydrateMeterModels({ force: true }), loadGatewayProtocolVersions()]).then(
      ([typeRows, modelRows, versions]) => {
        if (!active) return;
        setTypes(typeRows);
        setModels(modelRows);
        setProtocolVersions(versions);
        setModelDraft((current) => (current.protocol ? current : { ...current, protocol: versions[0] ?? "" }));
      },
    );
    const syncTypes = () => setTypes(loadMeterTypeDefs());
    const syncModels = () => setModels(loadMeterModels());
    window.addEventListener("ems-meter-types-changed", syncTypes);
    window.addEventListener("ems-meter-models-changed", syncModels);
    return () => {
      active = false;
      window.removeEventListener("ems-meter-types-changed", syncTypes);
      window.removeEventListener("ems-meter-models-changed", syncModels);
    };
  }, []);

  const typeCodeByName = useMemo(
    () => new Map(types.map((item) => [item.name, item.gatewayCode ?? null])),
    [types],
  );
  const sortedTypes = useMemo(
    () => sortByCodes(types, typeSort, (item) => [item.gatewayCode]),
    [types, typeSort],
  );
  const sortedModels = useMemo(
    () => sortByCodes(models, modelSort, (item) => [typeCodeByName.get(item.meterType) ?? null, item.modelCode]),
    [models, modelSort, typeCodeByName],
  );

  const brandOptions = useMemo(
    () => Array.from(new Set(models.map((item) => item.brand))).sort((a, b) => a.localeCompare(b, "vi")),
    [models],
  );
  const editingTypeDef = types.find((item) => item.name === editingType);

  function resetType() {
    setTypeDraft(EMPTY_TYPE);
    setEditingType(null);
    setTypeError("");
  }

  function resetModel() {
    setModelDraft({ ...EMPTY_MODEL, meterType: modelDraft.meterType, protocol: protocolVersions[0] ?? "" });
    setEditingModel(null);
    setModelError("");
  }

  async function submitType() {
    const code = parseIdentCode(typeDraft.code);
    if (!typeDraft.name.trim()) return setTypeError("Vui lòng nhập tên loại điểm đo.");
    if (code === "invalid" || (code != null && (code < 1 || code > 9))) {
      return setTypeError("Mã nhận dạng loại phải là số nguyên từ 1 đến 9.");
    }
    setSavingType(true);
    setTypeError("");
    try {
      setTypes(
        await saveMeterTypeConfig({
          name: typeDraft.name,
          description: typeDraft.description,
          gatewayCode: code,
          previousName: editingType ?? undefined,
        }),
      );
      resetType();
    } catch (error) {
      setTypeError(error instanceof Error ? error.message : "Không lưu được loại điểm đo.");
    } finally {
      setSavingType(false);
    }
  }

  async function submitModel() {
    const code = parseIdentCode(modelDraft.code);
    if (!modelDraft.meterType) return setModelError("Vui lòng chọn loại điểm đo.");
    if (!modelDraft.brand.trim() || !modelDraft.modelName.trim()) {
      return setModelError("Vui lòng nhập thương hiệu / nhà sản xuất và tên model.");
    }
    if (code === "invalid") return setModelError("Mã nhận dạng model phải là số nguyên từ 0 đến 255.");
    setSavingModel(true);
    setModelError("");
    try {
      setModels(
        await upsertMeterModel({
          id: editingModel ?? "",
          meterType: modelDraft.meterType,
          brand: modelDraft.brand.trim(),
          modelName: modelDraft.modelName.trim(),
          modelCode: code,
          protocol: modelDraft.protocol || null,
        }),
      );
      resetModel();
    } catch (error) {
      setModelError(error instanceof Error ? error.message : "Không lưu được model đồng hồ.");
    } finally {
      setSavingModel(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleteError("");
    try {
      if (pendingDelete.kind === "type") {
        setTypes(await deleteMeterTypeConfig(pendingDelete.name));
        if (editingType === pendingDelete.name) resetType();
      } else {
        setModels(await removeMeterModel(pendingDelete.model.id));
        if (editingModel === pendingDelete.model.id) resetModel();
      }
      setPendingDelete(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Không xóa được.");
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 font-sans sm:p-6 lg:p-8">
      <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
        {section === "types" ? "Loại điểm đo" : "Cấu hình loại đồng hồ"}
      </h1>

      {/* ---------------- Loại điểm đo (dùng chung cho dự án và đồng hồ) ---------------- */}
      {section === "types" ? (
      <Section title="Danh sách loại điểm đo">
        <div className="grid gap-3 sm:grid-cols-[1.2fr_0.7fr_2fr_auto] sm:items-end">
          <Field label="Tên loại điểm đo">
            <input
              className="input"
              value={typeDraft.name}
              disabled={Boolean(editingTypeDef?.builtin)}
              onChange={(e) => setTypeDraft({ ...typeDraft, name: e.target.value })}
              placeholder="VD: Khí nén"
            />
          </Field>
          <Field label="Mã nhận dạng (MT)">
            <input
              className="input"
              inputMode="numeric"
              value={typeDraft.code}
              onChange={(e) => setTypeDraft({ ...typeDraft, code: e.target.value })}
              placeholder="1–9"
            />
          </Field>
          <Field label="Mô tả">
            <input
              className="input"
              value={typeDraft.description}
              onChange={(e) => setTypeDraft({ ...typeDraft, description: e.target.value })}
              placeholder="VD: Lưu lượng và áp suất khí nén"
            />
          </Field>
          <FormButtons editing={Boolean(editingType)} saving={savingType} onSubmit={submitType} onCancel={resetType} />
        </div>
        {typeError ? <ErrorText text={typeError} /> : null}

        <Table
          headers={[
            "Loại điểm đo",
            <SortHeader key="mt" label="Mã nhận dạng (MT)" dir={typeSort} onChange={setTypeSort} />,
            "Mô tả",
            "",
          ]}
        >
          {sortedTypes.map((item) => (
            <tr key={item.name} className={editingType === item.name ? "bg-emerald-50/50" : "hover:bg-slate-50/80"}>
              <td className="px-4 py-3 font-semibold text-slate-900">{item.name}</td>
              <td className="px-4 py-3">
                <CodeBadge code={item.gatewayCode} />
              </td>
              <td className="px-4 py-3 text-slate-600">{item.description}</td>
              <td className="px-4 py-3">
                <RowActions
                  onEdit={() => {
                    setEditingType(item.name);
                    setTypeError("");
                    setTypeDraft({
                      name: item.name,
                      code: item.gatewayCode == null ? "" : String(item.gatewayCode),
                      description: item.description,
                    });
                  }}
                  onDelete={() => {
                    setDeleteError("");
                    setPendingDelete({ kind: "type", name: item.name });
                  }}
                  deleteDisabled={item.builtin}
                  deleteTitle={item.builtin ? "Loại mặc định không xóa được" : "Xóa loại điểm đo"}
                />
              </td>
            </tr>
          ))}
        </Table>
      </Section>
      ) : null}

      {/* ---------------- Model đồng hồ ---------------- */}
      {section === "models" ? (
      <Section title="Model đồng hồ">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.2fr_1.2fr_0.7fr_1fr_auto] lg:items-end">
          <Field label="Loại điểm đo">
            <CustomSelect
              className="input"
              value={modelDraft.meterType}
              onChange={(e) => setModelDraft({ ...modelDraft, meterType: e.target.value })}
            >
              <option value="">Chọn loại điểm đo</option>
              {types.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.gatewayCode != null ? `${item.name} (MT ${item.gatewayCode})` : item.name}
                </option>
              ))}
            </CustomSelect>
          </Field>
          <Field label="Thương hiệu / Nhà sản xuất">
            <input
              className="input"
              list="meter-brand-options"
              value={modelDraft.brand}
              onChange={(e) => setModelDraft({ ...modelDraft, brand: e.target.value })}
              placeholder="VD: Schneider Electric"
            />
            <datalist id="meter-brand-options">
              {brandOptions.map((brand) => (
                <option key={brand} value={brand} />
              ))}
            </datalist>
          </Field>
          <Field label="Tên model">
            <input
              className="input"
              value={modelDraft.modelName}
              onChange={(e) => setModelDraft({ ...modelDraft, modelName: e.target.value })}
              placeholder="VD: PM2230"
            />
          </Field>
          <Field label="Mã nhận dạng model (MM)">
            <input
              className="input"
              inputMode="numeric"
              value={modelDraft.code}
              onChange={(e) => setModelDraft({ ...modelDraft, code: e.target.value })}
              placeholder="0–255"
            />
          </Field>
          <Field label="Giao thức (Protocol Version)">
            <CustomSelect
              className="input"
              value={modelDraft.protocol}
              onChange={(e) => setModelDraft({ ...modelDraft, protocol: e.target.value })}
            >
              {protocolVersions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
              {/* Model cũ lưu tên giao thức (VD "Modbus TCP"): vẫn hiện để không mất khi sửa. */}
              {modelDraft.protocol && !protocolVersions.includes(modelDraft.protocol) ? (
                <option value={modelDraft.protocol}>{modelDraft.protocol}</option>
              ) : null}
            </CustomSelect>
          </Field>
          <FormButtons editing={Boolean(editingModel)} saving={savingModel} onSubmit={submitModel} onCancel={resetModel} />
        </div>
        {modelError ? <ErrorText text={modelError} /> : null}

        <Table
          headers={[
            "Loại điểm đo",
            "Thương hiệu / Nhà sản xuất",
            "Tên model",
            <SortHeader key="mtmm" label="Mã nhận dạng (MT · MM)" dir={modelSort} onChange={setModelSort} />,
            "Protocol Version",
            "",
          ]}
        >
          {models.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                Chưa có model nào.
              </td>
            </tr>
          ) : (
            sortedModels.map((item) => (
              <tr key={item.id} className={editingModel === item.id ? "bg-emerald-50/50" : "hover:bg-slate-50/80"}>
                <td className="px-4 py-3 font-semibold text-slate-900">{item.meterType}</td>
                <td className="px-4 py-3 text-slate-700">{item.brand}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{item.modelName}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5">
                    <CodeBadge code={typeCodeByName.get(item.meterType) ?? null} prefix="MT" />
                    <CodeBadge code={item.modelCode} prefix="MM" />
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-slate-600">{item.protocol || "—"}</td>
                <td className="px-4 py-3">
                  <RowActions
                    onEdit={() => {
                      setEditingModel(item.id);
                      setModelError("");
                      setModelDraft({
                        meterType: item.meterType,
                        brand: item.brand,
                        modelName: item.modelName,
                        code: item.modelCode == null ? "" : String(item.modelCode),
                        protocol: item.protocol || protocolVersions[0] || "",
                      });
                    }}
                    onDelete={() => {
                      setDeleteError("");
                      setPendingDelete({ kind: "model", model: item });
                    }}
                    deleteTitle="Xóa model"
                  />
                </td>
              </tr>
            ))
          )}
        </Table>
      </Section>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete?.kind === "type" ? "Xóa loại điểm đo" : "Xóa model đồng hồ"}
        description={
          deleteError ||
          (pendingDelete?.kind === "type"
            ? `Xóa loại "${pendingDelete.name}"? Hành động này không thể hoàn tác.`
            : pendingDelete
              ? `Xóa model "${pendingDelete.model.brand} ${pendingDelete.model.modelName}"? Hành động này không thể hoàn tác.`
              : "")
        }
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setPendingDelete(null);
          setDeleteError("");
        }}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="block min-w-0">
      <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500">{label}</span>
      {children}
    </div>
  );
}

function FormButtons({
  editing,
  saving,
  onSubmit,
  onCancel,
}: {
  editing: boolean;
  saving: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2">
      {editing ? (
        <button
          type="button"
          onClick={onCancel}
          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Hủy
        </button>
      ) : null}
      <button
        type="button"
        onClick={onSubmit}
        disabled={saving}
        className="h-10 whitespace-nowrap rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
      >
        {saving ? "Đang lưu..." : editing ? "Lưu thay đổi" : "+ Thêm"}
      </button>
    </div>
  );
}

function Table({ headers, children }: { headers: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-100">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {headers.map((header, index) => (
              <th key={index} className={`px-4 py-3 ${index === headers.length - 1 ? "text-right" : ""}`}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

type SortDir = "none" | "asc" | "desc";

/**
 * Sắp xếp theo một hoặc nhiều mã (so lần lượt từng mã). Dòng chưa đặt mã luôn nằm cuối
 * dù tăng hay giảm; "none" giữ nguyên thứ tự gốc.
 */
function sortByCodes<T>(items: T[], dir: SortDir, codesOf: (item: T) => (number | null | undefined)[]) {
  if (dir === "none") return items;
  const sign = dir === "asc" ? 1 : -1;
  return items
    .map((item, index) => ({ item, index, codes: codesOf(item) }))
    .sort((a, b) => {
      for (let i = 0; i < Math.max(a.codes.length, b.codes.length); i += 1) {
        const x = a.codes[i];
        const y = b.codes[i];
        const xMissing = x == null;
        const yMissing = y == null;
        if (xMissing !== yMissing) return xMissing ? 1 : -1;
        if (!xMissing && !yMissing && x !== y) return (x - y) * sign;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

/** Tiêu đề cột bấm được: lần lượt tăng dần → giảm dần → thứ tự gốc. */
function SortHeader({ label, dir, onChange }: { label: string; dir: SortDir; onChange: (dir: SortDir) => void }) {
  const next: SortDir = dir === "none" ? "asc" : dir === "asc" ? "desc" : "none";
  const title =
    dir === "asc" ? "Đang tăng dần · bấm để giảm dần" : dir === "desc" ? "Đang giảm dần · bấm để bỏ sắp xếp" : "Bấm để sắp xếp tăng dần";
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      title={title}
      aria-label={`${label}: ${title}`}
      className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors ${
        dir === "none" ? "hover:text-slate-700" : "text-emerald-700"
      }`}
    >
      {label}
      <SortIcon dir={dir} />
    </button>
  );
}

function SortIcon({ dir }: { dir: SortDir }) {
  return (
    <svg viewBox="0 0 12 16" className="h-3.5 w-2.5" aria-hidden>
      <path d="M6 1.5 10 6H2z" fill="currentColor" opacity={dir === "asc" ? 1 : 0.3} />
      <path d="M6 14.5 2 10h8z" fill="currentColor" opacity={dir === "desc" ? 1 : 0.3} />
    </svg>
  );
}

function CodeBadge({ code, prefix }: { code: number | null | undefined; prefix?: string }) {
  if (code == null) return <span className="text-[11px] text-slate-400">{prefix ? `${prefix} —` : "Chưa đặt"}</span>;
  return (
    <span className="inline-flex rounded-md bg-slate-900 px-2 py-0.5 font-mono text-[11px] font-bold text-white">
      {prefix ? `${prefix} ${code}` : code}
    </span>
  );
}

function RowActions({
  onEdit,
  onDelete,
  deleteDisabled,
  deleteTitle,
}: {
  onEdit: () => void;
  onDelete: () => void;
  deleteDisabled?: boolean;
  deleteTitle: string;
}) {
  return (
    <div className="flex justify-end gap-1">
      <button
        type="button"
        onClick={onEdit}
        title="Sửa"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={deleteDisabled}
        title={deleteTitle}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-400"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        </svg>
      </button>
    </div>
  );
}

function ErrorText({ text }: { text: string }) {
  return <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{text}</p>;
}
