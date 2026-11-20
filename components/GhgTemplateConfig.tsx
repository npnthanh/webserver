"use client";

import { EmissionTabs } from "@/components/EmissionTabs";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CustomSelect } from "@/components/ui/CustomSelect";
import {
  formatFactorValue,
  hydrateFactorGroups,
  parseFactorNumber,
  type FactorGroup,
  type GasValue,
} from "@/lib/emission-factors";
import {
  DEFAULT_TEMPLATE_FORMULA,
  deleteGhgTemplate,
  hydrateGhgTemplates,
  saveGhgTemplate,
  type GhgManualTemplate,
} from "@/lib/ghg-templates";
import { formatAppNumber, formatAppNumberInput, formatLiveNumberInput, parseAppNumber } from "@/lib/number-format";

type MultiplierDraft = { id: string; label: string; symbol: string; value: string; unit: string };

type Draft = {
  id: string;
  name: string;
  unit: string;
  defaultValue: string;
  factorGroupId: string;
  multipliers: MultiplierDraft[];
  formula: string;
};

const ACTIVITY_TOKEN = "{Giá trị thủ công}";

function emptyDraft(): Draft {
  return { id: "", name: "", unit: "lít", defaultValue: "", factorGroupId: "", multipliers: [], formula: DEFAULT_TEMPLATE_FORMULA };
}

function plainGasLabel(gas: Pick<GasValue, "key" | "label">) {
  const fromLabel = gas.label.replaceAll("₂", "2").replaceAll("₃", "3").replaceAll("₄", "4").replace(/\s+/g, "");
  return fromLabel || gas.key.toUpperCase();
}

function gasToken(gas: Pick<GasValue, "key" | "label">) {
  return `[${plainGasLabel(gas)}]`;
}

export function GhgTemplateConfig() {
  const [templates, setTemplates] = useState<GhgManualTemplate[]>([]);
  const [groups, setGroups] = useState<FactorGroup[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<GhgManualTemplate | null>(null);
  const formulaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([hydrateGhgTemplates(), hydrateFactorGroups()]).then(([rows, nextGroups]) => {
      if (!active) return;
      setTemplates(rows);
      setGroups(nextGroups);
    });
    return () => {
      active = false;
    };
  }, []);

  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const selectedGroup = groupById.get(draft.factorGroupId);

  function patch(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
    if (error) setError("");
  }

  function openNew() {
    setDraft(emptyDraft());
    setError("");
    setFormOpen(true);
  }

  function openEdit(template: GhgManualTemplate) {
    setDraft({
      id: template.id,
      name: template.name,
      unit: template.unit,
      defaultValue: template.defaultValue == null ? "" : formatAppNumber(template.defaultValue, { maxDecimals: 6 }),
      factorGroupId: template.factorGroupId,
      multipliers: template.multipliers.map((row) => ({ ...row, value: formatFactorValue(row.value) })),
      formula: template.formula,
    });
    setError("");
    setFormOpen(true);
  }

  function selectGroup(groupId: string) {
    const group = groupById.get(groupId);
    setDraft((current) => {
      const trimmed = current.formula.trim();
      const isDefault = !trimmed || trimmed === DEFAULT_TEMPLATE_FORMULA;
      const first = group?.gases[0];
      return {
        ...current,
        factorGroupId: groupId,
        formula: isDefault && first ? `${ACTIVITY_TOKEN} * ${gasToken(first)}` : current.formula,
      };
    });
  }

  function insertToken(token: string) {
    const el = formulaRef.current;
    const start = el?.selectionStart ?? draft.formula.length;
    const end = el?.selectionEnd ?? draft.formula.length;
    const next = `${draft.formula.slice(0, start)}${token}${draft.formula.slice(end)}`;
    patch({ formula: next });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function submit() {
    const name = draft.name.trim();
    if (!name) return setError("Vui lòng nhập tên nguồn phát thải.");
    if (!draft.unit.trim()) return setError("Vui lòng nhập đơn vị.");
    const defaultValue = draft.defaultValue.trim() ? parseAppNumber(draft.defaultValue, Number.NaN) : null;
    if (defaultValue != null && !Number.isFinite(defaultValue)) return setError("Giá trị mặc định không hợp lệ.");
    const filled = draft.multipliers.filter((row) => row.label.trim() || row.symbol.trim() || row.value.trim());
    if (filled.some((row) => !row.label.trim() || !row.symbol.trim() || !row.value.trim())) {
      return setError("Mỗi hệ số nhân cần đủ tên, ký hiệu và giá trị.");
    }
    const symbols = filled.map((row) => row.symbol.trim());
    if (new Set(symbols).size !== symbols.length) return setError("Ký hiệu hệ số nhân không được trùng nhau.");
    if ((!selectedGroup || selectedGroup.gases.length === 0) && filled.length === 0) {
      return setError("Chọn hệ số phát thải hoặc thêm ít nhất một hệ số nhân để tính toán.");
    }
    if (!draft.formula.trim()) return setError("Vui lòng nhập công thức tính.");
    setSaving(true);
    try {
      setTemplates(
        await saveGhgTemplate({
          id: draft.id,
          name,
          unit: draft.unit.trim(),
          defaultValue,
          factorGroupId: draft.factorGroupId,
          multipliers: filled.map((row) => ({
            id: row.id,
            label: row.label.trim(),
            symbol: row.symbol.trim(),
            value: parseFactorNumber(row.value),
            unit: row.unit.trim() || "tấn CO2e",
          })),
          formula: draft.formula.trim(),
        }),
      );
      setFormOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được nguồn phát thải.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 font-sans sm:p-6 lg:p-8">
      <div>
        <EmissionTabs />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Công thức phát thải</h1>
        {!formOpen ? (
          <button
            type="button"
            onClick={openNew}
            className="h-10 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            + Thêm công thức
          </button>
        ) : null}
      </div>

      {formOpen ? (
        <section className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-[15px] font-semibold text-slate-800">
            {draft.id ? "Sửa công thức phát thải" : "Thêm công thức phát thải"}
          </h2>
          <Field label="TÊN NGUỒN PHÁT THẢI">
            <input
              className="input"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="VD: Phát thải từ tiêu thụ dầu FO cho lò hơi"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
            <Field label="ĐƠN VỊ">
              <input
                className="input"
                value={draft.unit}
                onChange={(e) => patch({ unit: e.target.value })}
                placeholder="lít, kg, tấn, m³..."
              />
            </Field>
            <Field label="GIÁ TRỊ MẶC ĐỊNH (TÙY CHỌN)">
              <input
                className="input"
                inputMode="decimal"
                value={draft.defaultValue}
                onChange={(e) => patch({ defaultValue: formatLiveNumberInput(e.target.value) })}
                onBlur={(e) => patch({ defaultValue: formatAppNumberInput(e.target.value) })}
                placeholder="VD: 1 200"
              />
            </Field>
          </div>
          <Field label="HỆ SỐ PHÁT THẢI (TÙY CHỌN)">
            <CustomSelect className="input" value={draft.factorGroupId} onChange={(e) => selectGroup(e.target.value)}>
              <option value="">Không dùng hệ số phát thải</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </CustomSelect>
            {selectedGroup ? (
              <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                {selectedGroup.gases.map((gas) => (
                  <li key={gas.key} className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-700">{plainGasLabel(gas)}</span>
                    <strong className="font-mono text-slate-800">
                      {formatFactorValue(gas.value)} {gas.unit}
                    </strong>
                  </li>
                ))}
              </ul>
            ) : null}
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold tracking-wide text-slate-500">HỆ SỐ NHÂN</span>
              <button
                type="button"
                onClick={() =>
                  patch({
                    multipliers: [
                      ...draft.multipliers,
                      { id: `mul-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, label: "", symbol: "", value: "", unit: "" },
                    ],
                  })
                }
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
              >
                + Thêm hệ số nhân
              </button>
            </div>
            {draft.multipliers.length ? (
              <div className="space-y-2">
                {draft.multipliers.map((row) => {
                  const update = (next: Partial<MultiplierDraft>) =>
                    patch({ multipliers: draft.multipliers.map((item) => (item.id === row.id ? { ...item, ...next } : item)) });
                  return (
                    <div key={row.id} className="grid grid-cols-[1.4fr_0.8fr_1fr_1fr_auto] items-center gap-2">
                      <input className="input h-9" value={row.label} onChange={(e) => update({ label: e.target.value })} placeholder="Tên (VD: Nhiệt trị)" />
                      <input
                        className="input h-9 font-mono"
                        value={row.symbol}
                        onChange={(e) => update({ symbol: e.target.value.replace(/[{}[\]]/g, "") })}
                        placeholder="Q"
                      />
                      <input
                        className="input h-9 font-mono"
                        inputMode="decimal"
                        value={row.value}
                        onChange={(e) => update({ value: formatLiveNumberInput(e.target.value) })}
                        onBlur={(e) => update({ value: formatAppNumberInput(e.target.value) })}
                        placeholder="43 215"
                      />
                      <input className="input h-9" value={row.unit} onChange={(e) => update({ unit: e.target.value })} placeholder="kJ/kg" />
                      <button
                        type="button"
                        onClick={() => patch({ multipliers: draft.multipliers.filter((item) => item.id !== row.id) })}
                        className="h-9 rounded-lg px-2 text-xs font-semibold text-rose-500 hover:bg-rose-50"
                        aria-label="Xóa hệ số nhân"
                      >
                        Xóa
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400">Chưa có hệ số nhân.</p>
            )}
          </div>

          <Field label="CÔNG THỨC TÍNH (TẤN CO₂E)">
            <div className="overflow-hidden rounded-xl border border-slate-200 focus-within:border-emerald-500">
              <textarea
                ref={formulaRef}
                rows={3}
                value={draft.formula}
                onChange={(e) => patch({ formula: e.target.value })}
                className="w-full resize-none bg-white px-3 pt-3 pb-2 font-mono text-sm text-slate-800 outline-none"
              />
              <div className="flex flex-wrap justify-end gap-2 px-3 pb-3">
                {(selectedGroup?.gases ?? []).map((gas) => (
                  <TokenButton key={gas.key} onClick={() => insertToken(gasToken(gas))}>
                    {gasToken(gas)}
                  </TokenButton>
                ))}
                {draft.multipliers
                  .filter((row) => row.symbol.trim())
                  .map((row) => (
                    <TokenButton key={row.id} onClick={() => insertToken(`{${row.symbol.trim()}}`)}>
                      [{row.symbol.trim()}]
                    </TokenButton>
                  ))}
                <TokenButton onClick={() => insertToken(ACTIVITY_TOKEN)}>[Giá trị thủ công]</TokenButton>
              </div>
            </div>
          </Field>

          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className="h-10 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? "Đang lưu..." : "Lưu"}
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Hủy
            </button>
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Nguồn phát thải</th>
                <th className="px-4 py-3">Đơn vị</th>
                <th className="px-4 py-3">Hệ số phát thải</th>
                <th className="px-4 py-3">Công thức</th>
                <th className="px-4 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    Chưa có công thức phát thải nào.
                  </td>
                </tr>
              ) : (
                templates.map((template) => (
                  <tr key={template.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-semibold text-slate-900">{template.name}</td>
                    <td className="px-4 py-3 text-slate-700">{template.unit}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {groupById.get(template.factorGroupId)?.name ?? (template.factorGroupId ? template.factorGroupId : "—")}
                    </td>
                    <td className="max-w-[320px] truncate px-4 py-3 font-mono text-[11px] text-slate-600" title={template.formula}>
                      {template.formula}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(template)}
                          className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => setToDelete(template)}
                          className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                        >
                          Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Xóa công thức phát thải"
        description={`Xóa "${toDelete?.name}" khỏi danh sách? Các nguồn đã thêm vào dự án vẫn giữ nguyên cấu hình.`}
        onConfirm={() => {
          if (!toDelete) return;
          void deleteGhgTemplate(toDelete.id).then(setTemplates);
          setToDelete(null);
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
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

function TokenButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg bg-emerald-50 px-2 py-1 font-mono text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
    >
      {children}
    </button>
  );
}
