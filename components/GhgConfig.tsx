"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CustomSelect } from "@/components/ui/CustomSelect";
import {
  formatFactorValue,
  hydrateFactorGroups,
  loadFactorGroups,
  parseFactorNumber,
  type FactorGroup,
  type GasValue,
} from "@/lib/emission-factors";
import {
  GHG_SCOPES,
  computeManualTons,
  hydrateGhgSources,
  loadGhgSources,
  saveGhgSources,
  type GhgEmissionSource,
  type GhgInputMethod,
  type GhgMultiplier,
  type ScopeId,
} from "@/lib/ghg-sources";
import {
  formatAppNumber,
  formatAppNumberInput,
  formatLiveNumberInput,
  parseAppNumber,
} from "@/lib/number-format";
import { vietnamNow } from "@/lib/vietnam-time";
import { hydrateGhgTemplates, type GhgManualTemplate } from "@/lib/ghg-templates";
import {
  hydrateClientMeters,
  loadClientMeters,
  type ClientMeter,
} from "@/lib/client-meters";

type InputMethod = GhgInputMethod;
type EmissionSource = GhgEmissionSource;

const SCOPES = GHG_SCOPES.map((item) => ({ id: item.id, label: item.label }));

const METHODS: { id: InputMethod; label: string; hint: string }[] = [
  { id: "meter", label: "Chọn từ điểm đo", hint: "Lấy số liệu realtime" },
  { id: "manual", label: "Nhập thủ công", hint: "Nhập khối lượng nhiên liệu" },
  { id: "file", label: "Tải file", hint: "CSV / Excel phát thải" },
];

const METHOD_LABEL: Record<InputMethod, string> = {
  meter: "Điểm đo",
  manual: "Thủ công",
  file: "Tải file",
};

const DEFAULT_METER_FORMULA = "{Giá trị điểm đo} * {Hệ số phát thải}";
const DEFAULT_MANUAL_FORMULA = "{Giá trị thủ công} * {Hệ số phát thải}";
/** Giá trị chọn "giữ cấu hình hiện tại" khi sửa nguồn thủ công tạo trước khi có danh mục nguồn mẫu. */
const KEEP_CURRENT = "__current__";

type MultiplierDraft = {
  id: string;
  label: string;
  symbol: string;
  value: string;
  unit: string;
};

function plainGasLabel(gas: Pick<GasValue, "key" | "label">) {
  const fromLabel = gas.label
    .replaceAll("₂", "2")
    .replaceAll("₃", "3")
    .replaceAll("₄", "4")
    .replace(/\s+/g, "");
  return fromLabel || gas.key.toUpperCase();
}

function gasToken(gas: Pick<GasValue, "key" | "label">) {
  return `[${plainGasLabel(gas)}]`;
}

function groupIdFromFactor(factorId: string) {
  if (!factorId || factorId.startsWith("none:")) return "";
  const index = factorId.indexOf(":");
  return index === -1 ? factorId : factorId.slice(0, index);
}

function activityToken(method: InputMethod) {
  return method === "meter" ? "{Giá trị điểm đo}" : "{Giá trị thủ công}";
}

function draftsFromMultipliers(rows: GhgMultiplier[] | undefined): MultiplierDraft[] {
  return (rows ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    symbol: row.symbol,
    value: formatFactorValue(row.value),
    unit: row.unit,
  }));
}

function formatFactor(value: number) {
  return formatAppNumber(value, {
    minDecimals: 4,
    maxDecimals: 4,
  });
}

type FactorHistoryRow = {
  id: string;
  label: string;
  value: number;
  unit: string;
  validFrom: string;
  validTo: string;
};

export function GhgConfig({ projectId }: { projectId: string }) {
  const [activeScope, setActiveScope] = useState<ScopeId>(1);
  const [tableFilter, setTableFilter] = useState<ScopeId | "all">("all");
  const [groups, setGroups] = useState<FactorGroup[]>([]);
  const [sources, setSources] = useState<EmissionSource[]>([]);
  const [sourcesProjectId, setSourcesProjectId] = useState<string | null>(null);
  const [meters, setMeters] = useState<ClientMeter[]>([]);
  const [metersProjectId, setMetersProjectId] = useState<string | null>(null);
  const metersLoading = metersProjectId !== projectId;
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dropHover, setDropHover] = useState(false);
  const formulaRef = useRef<HTMLTextAreaElement>(null);

  const [name, setName] = useState("");
  const [method, setMethod] = useState<InputMethod>("meter");
  const [meterPointId, setMeterPointId] = useState("");
  const [manualValue, setManualValue] = useState("");
  const [manualUnit, setManualUnit] = useState("lít");
  const [factorGroupId, setFactorGroupId] = useState("");
  const [multipliers, setMultipliers] = useState<MultiplierDraft[]>([]);
  const [formula, setFormula] = useState(DEFAULT_METER_FORMULA);
  const [appliedAt, setAppliedAt] = useState(() => vietnamNow().date);
  const [formError, setFormError] = useState("");
  // Nhập thủ công: chọn công thức phát thải đã cấu hình sẵn (Hệ số phát thải → Công thức phát thải).
  const [templates, setTemplates] = useState<GhgManualTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");

  const selectedMeter = useMemo(
    () => meters.find((meter) => meter.id === meterPointId),
    [meters, meterPointId],
  );
  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === factorGroupId),
    [groups, factorGroupId],
  );
  const factorHistoryRows = useMemo<FactorHistoryRow[]>(() => {
    if (!selectedGroup) return [];
    return selectedGroup.gases.map((gas) => ({
      id: `${selectedGroup.id}:${gas.key}`,
      label: `${selectedGroup.name} · ${plainGasLabel(gas)}`,
      value: gas.value,
      unit: gas.unit,
      validFrom: appliedAt,
      validTo: "Đang áp dụng",
    }));
  }, [appliedAt, selectedGroup]);

  function handleMethodChange(nextMethod: InputMethod) {
    setMethod(nextMethod);
    setFormula((current) => {
      if (current.trim() && current !== DEFAULT_METER_FORMULA && current !== DEFAULT_MANUAL_FORMULA) {
        return current;
      }
      return nextMethod === "meter" ? DEFAULT_METER_FORMULA : DEFAULT_MANUAL_FORMULA;
    });
    setFormError("");
  }

  useEffect(() => {
    let active = true;
    void hydrateClientMeters(projectId)
      .then((rows) => {
        if (active) {
          setMeters(rows);
          setMetersProjectId(projectId);
        }
      })
      .catch(() => {
        if (active) {
          setMeters(loadClientMeters(projectId));
          setMetersProjectId(projectId);
        }
      });
    void hydrateGhgTemplates().then((rows) => {
      if (active) setTemplates(rows);
    });
    void Promise.all([hydrateFactorGroups(), hydrateGhgSources(projectId)]).then(([nextGroups, sources]) => {
      if (!active) return;
      setGroups(nextGroups);
      setSources(sources);
      setSourcesProjectId(projectId);
    }).catch(() => {
      if (!active) return;
      setGroups(loadFactorGroups());
      setSources(loadGhgSources());
      setSourcesProjectId(projectId);
    });
    if (window.location.hash === "#them-nguon-phat-thai") {
      const url = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState(null, "", url);
    }
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (sourcesProjectId !== projectId || editingId) return;
    const requestedId = new URLSearchParams(window.location.search).get("edit");
    if (!requestedId) return;
    const source = sources.find((item) => item.id === requestedId);
    if (!source) return;

    handleEdit(source);
    const url = new URL(window.location.href);
    url.searchParams.delete("edit");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [editingId, projectId, sources, sourcesProjectId]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("ems-ghg-form-open", { detail: formOpen }));
  }, [formOpen]);

  useEffect(() => {
    function startNewSource() {
      setEditingId(null);
      setName("");
      setMethod("meter");
      setMeterPointId("");
      setManualValue("");
      setManualUnit("lít");
      setFactorGroupId("");
      setMultipliers([]);
      setFormula(DEFAULT_METER_FORMULA);
      setAppliedAt(vietnamNow().date);
      setFormError("");
      setTemplateId("");
      setTableFilter((current) => {
        setActiveScope(current === "all" ? 1 : current);
        return current;
      });
      setFormOpen(true);
    }
    window.addEventListener("ems-ghg-open-form", startNewSource);
    return () => window.removeEventListener("ems-ghg-open-form", startNewSource);
  }, []);

  function persistSources(next: EmissionSource[]) {
    const withProject = next.map((source) => ({ ...source, projectId }));
    setSources(withProject);
    saveGhgSources(withProject, projectId);
  }


  const visibleSources = useMemo(
    () =>
      tableFilter === "all" ? sources : sources.filter((item) => item.scope === tableFilter),
    [sources, tableFilter],
  );

  function applyGroup(group: FactorGroup) {
    setFactorGroupId(group.id);
    setFormula((current) => {
      const trimmed = current.trim();
      if (trimmed && trimmed !== DEFAULT_METER_FORMULA && trimmed !== DEFAULT_MANUAL_FORMULA) {
        return current;
      }
      const first = group.gases[0];
      return first ? `${activityToken(method)} * ${gasToken(first)}` : activityToken(method);
    });
    if (formError) setFormError("");
  }

  function addMultiplier() {
    setMultipliers((current) => [
      ...current,
      {
        id: `mul-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: "",
        symbol: "",
        value: "",
        unit: "tấn CO2e",
      },
    ]);
  }

  function updateMultiplier(id: string, patch: Partial<Omit<MultiplierDraft, "id">>) {
    setMultipliers((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }

  function removeMultiplier(id: string) {
    setMultipliers((current) => current.filter((row) => row.id !== id));
  }

  function closeForm() {
    setEditingId(null);
    setName("");
    setMethod("meter");
    setMeterPointId("");
    setManualValue("");
    setManualUnit("lít");
    setFactorGroupId("");
    setMultipliers([]);
    setFormula(DEFAULT_METER_FORMULA);
    setAppliedAt(vietnamNow().date);
    setFormError("");
    setTemplateId("");
    setFormOpen(false);
  }

  function handleCancel() {
    closeForm();
  }

  function insertToken(token: string) {
    const el = formulaRef.current;
    if (!el) {
      setFormula((current) => `${current}${current ? " " : ""}${token}`);
      return;
    }
    const start = el.selectionStart ?? formula.length;
    const end = el.selectionEnd ?? formula.length;
    const next = `${formula.slice(0, start)}${token}${formula.slice(end)}`;
    setFormula(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + token.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("Vui lòng nhập tên nguồn phát thải.");
      return;
    }
    if (method === "meter" && !meterPointId) {
      setFormError("Vui lòng chọn điểm đo cho nguồn phát thải.");
      return;
    }
    if (method === "manual" && !templateId) {
      setFormError("Vui lòng chọn nguồn phát thải đã cấu hình.");
      return;
    }
    const parsedManual =
      method !== "meter" && manualValue.trim()
        ? parseAppNumber(manualValue, Number.NaN)
        : undefined;
    if (method !== "meter" && manualValue.trim() && !Number.isFinite(parsedManual)) {
      setFormError("Giá trị thủ công không hợp lệ.");
      return;
    }
    const filledMultipliers = multipliers.filter(
      (row) => row.label.trim() || row.symbol.trim() || row.value.trim(),
    );
    if (filledMultipliers.some((row) => !row.label.trim() || !row.symbol.trim() || !row.value.trim())) {
      setFormError("Mỗi hệ số nhân cần đủ tên, ký hiệu và giá trị.");
      return;
    }
    const symbols = filledMultipliers.map((row) => row.symbol.trim());
    if (new Set(symbols).size !== symbols.length) {
      setFormError("Ký hiệu hệ số nhân không được trùng nhau.");
      return;
    }
    if ((!selectedGroup || selectedGroup.gases.length === 0) && filledMultipliers.length === 0) {
      setFormError("Chọn hệ số phát thải hoặc thêm ít nhất một hệ số nhân để tính toán.");
      return;
    }
    const primary = selectedGroup
      ? selectedGroup.gases.find((gas) => gas.key === "co2") ?? selectedGroup.gases[0]
      : undefined;
    const existing = editingId ? sources.find((item) => item.id === editingId) : undefined;
    const nextMultipliers = filledMultipliers.map((row) => ({
      id: row.id,
      label: row.label.trim(),
      symbol: row.symbol.trim(),
      value: parseFactorNumber(row.value),
      unit: row.unit.trim() || "tấn CO2e",
    }));
    const factorId = selectedGroup && primary ? `${selectedGroup.id}:${primary.key}` : "none:none";
    const factorValue = primary?.value ?? 0;
    const effectiveManualValue =
      method !== "meter" ? (parsedManual ?? existing?.manualValue) : undefined;
    const next: EmissionSource = {
      ...existing,
      id: existing?.id ?? `src-${Date.now()}`,
      scope: activeScope,
      name: trimmed,
      method,
      factorId,
      factorValue,
      gases: selectedGroup?.gases ?? existing?.gases,
      multipliers: nextMultipliers,
      formula,
      appliedAt,
      meterPointId: method === "meter" ? meterPointId : undefined,
      manualValue: effectiveManualValue,
      manualUnit: method !== "meter" ? manualUnit.trim() || "lít" : undefined,
      manualMonthly: method !== "meter" ? existing?.manualMonthly : undefined,
      tons:
        method !== "meter"
          ? computeManualTons({
              method,
              manualValue: effectiveManualValue,
              factorId,
              factorValue,
              gases: selectedGroup?.gases ?? existing?.gases,
              multipliers: nextMultipliers,
              formula,
            })
          : existing?.tons,
    };
    persistSources(
      editingId
        ? sources.map((item) => (item.id === editingId ? next : item))
        : [next, ...sources],
    );
    setTableFilter(activeScope);
    closeForm();
  }

  function handleEdit(source: EmissionSource) {
    setEditingId(source.id);
    setActiveScope(source.scope);
    setTableFilter(source.scope);
    setName(source.name);
    setMethod(source.method);
    setMeterPointId(source.meterPointId ?? "");
    setManualValue(
      source.manualValue == null ? "" : formatAppNumber(source.manualValue, { maxDecimals: 6 }),
    );
    setManualUnit(source.manualUnit ?? "lít");
    setFactorGroupId(groupIdFromFactor(source.factorId));
    setMultipliers(draftsFromMultipliers(source.multipliers));
    setFormula(source.formula);
    setAppliedAt(source.appliedAt);
    setFormError("");
    // Nguồn thủ công đã có: giữ nguyên cấu hình hiện tại cho tới khi chọn một nguồn khác.
    setTemplateId(source.method === "manual" ? KEEP_CURRENT : "");
    setFormOpen(true);
  }

  function applyTemplate(nextId: string) {
    setTemplateId(nextId);
    if (formError) setFormError("");
    const template = templates.find((item) => item.id === nextId);
    if (!template) return;
    setName((current) => current.trim() || template.name);
    setManualUnit(template.unit);
    setManualValue(template.defaultValue == null ? "" : formatAppNumber(template.defaultValue, { maxDecimals: 6 }));
    setFactorGroupId(template.factorGroupId);
    setMultipliers(draftsFromMultipliers(template.multipliers));
    setFormula(template.formula);
  }

  return (
    <div className="space-y-5">
      {formOpen ? (
      <>
      <div className="flex flex-wrap items-center gap-2">
        {SCOPES.map((scope) => {
          const active = activeScope === scope.id;
          return (
            <div
              key={scope.id}
              className={`inline-flex h-9 items-center rounded-xl pl-3.5 text-sm font-semibold transition-all ${
                active
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-900"
              }`}
            >
              <button type="button" onClick={() => setActiveScope(scope.id)} className="pr-1">
                {scope.label}
              </button>
              <span
                className={`px-2 text-base leading-none ${active ? "text-white/80" : "text-slate-400"}`}
                aria-hidden
              >
                ×
              </span>
            </div>
          );
        })}
      </div>

      <div className="grid items-start gap-5">
        <section
          id="them-nguon-phat-thai"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDropHover(true);
          }}
          onDragLeave={() => setDropHover(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropHover(false);
            const id = e.dataTransfer.getData("text/plain");
            const group = groups.find((item) => item.id === id);
            if (group) applyGroup(group);
          }}
          className={`rounded-xl border bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors ${
            dropHover ? "border-emerald-500 ring-2 ring-emerald-500/15" : "border-slate-200"
          }`}
        >
          <div className="mb-5 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 shadow-xs">
              <LeafIcon className="h-4 w-4" />
            </span>
            <h2 className="text-[15px] font-semibold text-slate-800">
              {editingId ? "Chỉnh sửa nguồn phát thải" : "Thêm mới nguồn phát thải"}
            </h2>
          </div>

          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
          >
            <Field label="TÊN NGUỒN PHÁT THẢI">
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (formError) setFormError("");
                }}
                placeholder="VD: Phát thải từ tiêu thụ dầu FO cho lò hơi"
                className="input"
              />
            </Field>

            <fieldset>
              <legend className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500">
                PHƯƠNG THỨC NHẬP SỐ LIỆU
              </legend>
              <div className={`grid gap-3 ${method === "file" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                {/* "Tải file" đã bỏ: chỉ còn hiện khi sửa nguồn cũ tạo bằng phương thức này. */}
                {METHODS.filter((item) => item.id !== "file" || method === "file").map((item) => {
                  const selected = method === item.id;
                  const Icon = methodIcons[item.id];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleMethodChange(item.id)}
                      className={`flex flex-col items-start gap-2 rounded-xl border px-4 py-3.5 text-left transition-colors ${
                        selected
                          ? "border-emerald-600 bg-emerald-50/70 text-emerald-700 shadow-[inset_0_0_0_1px_#059669]"
                          : "border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/20"
                      }`}
                    >
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                          selected ? "bg-emerald-600 text-white shadow-xs" : "bg-slate-50 text-slate-500"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold">{item.label}</span>
                        <span
                          className={`mt-0.5 block text-[11px] ${
                            selected ? "text-emerald-600 font-medium" : "text-slate-400"
                          }`}
                        >
                          {item.hint}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {method === "meter" ? (
              <Field label="CHỌN ĐIỂM ĐO">
                <div className="relative">
                  <CustomSelect
                    value={meterPointId}
                    onChange={(e) => {
                      setMeterPointId(e.target.value);
                      if (formError) setFormError("");
                    }}
                    required
                    disabled={metersLoading || meters.length === 0}
                    className="input appearance-none pr-9 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">
                      {metersLoading
                        ? "Đang tải điểm đo..."
                        : meters.length
                          ? "Chọn điểm đo của dự án"
                          : "Dự án chưa có điểm đo"}
                    </option>
                    {meters.map((meter) => (
                      <option key={meter.id} value={meter.id}>
                        {meter.name} · {meter.code} · {meter.utility}
                      </option>
                    ))}
                  </CustomSelect>
                  <ChevronIcon className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
                {selectedMeter ? (
                  <div className="mt-3 grid gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-xs sm:grid-cols-3">
                    <div>
                      <span className="block text-slate-500">Mã điểm đo</span>
                      <strong className="mt-0.5 block text-slate-800">{selectedMeter.code}</strong>
                    </div>
                    <div>
                      <span className="block text-slate-500">Loại năng lượng</span>
                      <strong className="mt-0.5 block text-slate-800">{selectedMeter.utility}</strong>
                    </div>
                    <div>
                      <span className="block text-slate-500">Thiết bị</span>
                      <strong className="mt-0.5 block text-slate-800">
                        {selectedMeter.deviceId ? "Đã gắn thiết bị" : "Chưa gắn thiết bị"}
                      </strong>
                    </div>
                  </div>
                ) : null}
              </Field>
            ) : null}

            {method === "manual" ? (
              <Field label="CÔNG THỨC PHÁT THẢI">
                <div className="relative">
                  <CustomSelect
                    value={templateId}
                    onChange={(e) => applyTemplate(e.target.value)}
                    className="input appearance-none pr-9"
                  >
                    <option value="">
                      {templates.length ? "Chọn công thức phát thải đã cấu hình" : "Chưa có công thức phát thải nào được cấu hình"}
                    </option>
                    {editingId && templateId === KEEP_CURRENT ? (
                      <option value={KEEP_CURRENT}>Giữ cấu hình hiện tại</option>
                    ) : null}
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </CustomSelect>
                  <ChevronIcon className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
                {templateId ? (
                  <div className="mt-3 grid gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-xs sm:grid-cols-2">
                    <div>
                      <span className="block text-slate-500">Đơn vị</span>
                      <strong className="mt-0.5 block text-slate-800">
                        {manualUnit || "—"}
                        {manualValue ? ` · mặc định ${manualValue}` : ""}
                      </strong>
                    </div>
                    <div>
                      <span className="block text-slate-500">Hệ số phát thải</span>
                      <strong className="mt-0.5 block text-slate-800">{selectedGroup?.name ?? "Không dùng"}</strong>
                    </div>
                    {multipliers.length ? (
                      <div className="sm:col-span-2">
                        <span className="block text-slate-500">Hệ số nhân</span>
                        <strong className="mt-0.5 block text-slate-800">
                          {multipliers.map((row) => `${row.label} (${row.symbol}) = ${row.value} ${row.unit}`).join(" · ")}
                        </strong>
                      </div>
                    ) : null}
                    <div className="sm:col-span-2">
                      <span className="block text-slate-500">Công thức</span>
                      <code className="mt-0.5 block break-all font-mono text-slate-800">{formula}</code>
                    </div>
                  </div>
                ) : null}
              </Field>
            ) : null}

            {method === "file" ? (
              <Field label="ĐƠN VỊ ĐO CỐ ĐỊNH & GIÁ TRỊ MẶC ĐỊNH (TÙY CHỌN)">
                <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
                  <div>
                    <input
                      value={manualUnit}
                      onChange={(e) => setManualUnit(e.target.value)}
                      placeholder="Đơn vị (lít, kg, tấn, m³...)"
                      className="input font-semibold text-slate-800"
                      required
                    />
                  </div>
                  <div>
                    <input
                      value={manualValue}
                      onChange={(e) => {
                        setManualValue(formatLiveNumberInput(e.target.value));
                        if (formError) setFormError("");
                      }}
                      onBlur={(e) => setManualValue(formatAppNumberInput(e.target.value))}
                      inputMode="decimal"
                      placeholder="Giá trị mặc định (VD: 1 200) — có thể để trống"
                      className="input"
                    />
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  Đơn vị (ví dụ: lít, kg, tấn, m³) sẽ được cố định khi khách hàng nhập bảng số liệu 12 tháng hoặc import từ Excel trên trang Khí nhà kính.
                </p>
              </Field>
            ) : null}

            {method !== "manual" ? (
            <>
            <Field label="LỰA CHỌN HỆ SỐ PHÁT THẢI (TÙY CHỌN)">
              <div className="relative">
                <CustomSelect
                  value={factorGroupId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    const group = groups.find((item) => item.id === nextId);
                    if (group) applyGroup(group);
                    else setFactorGroupId("");
                    if (formError) setFormError("");
                  }}
                  className="input appearance-none pr-9"
                >
                  <option value="">Không dùng hệ số phát thải</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </CustomSelect>
                <ChevronIcon className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
              {selectedGroup ? (
                <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                  <span className="text-slate-500">Giá trị tự lấy từ thư viện hệ số</span>
                  <ul className="mt-1.5 space-y-1">
                    {selectedGroup.gases.map((gas) => (
                      <li key={gas.key} className="flex items-center justify-between gap-3">
                        <span className="font-medium text-slate-700">{plainGasLabel(gas)}</span>
                        <strong className="font-mono text-slate-800">
                          {formatFactorValue(gas.value)} {gas.unit}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Field>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[11px] font-semibold tracking-wide text-slate-500">
                  HỆ SỐ NHÂN
                </span>
                <button
                  type="button"
                  onClick={addMultiplier}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  <span aria-hidden>+</span>
                  Thêm hệ số nhân
                </button>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Hệ số</th>
                      <th className="px-3 py-2">Ký hiệu</th>
                      <th className="px-3 py-2">Giá trị</th>
                      <th className="px-3 py-2">Đơn vị</th>
                      <th className="w-10 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {multipliers.map((row) => (
                      <tr key={row.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-2 py-2">
                          <input
                            value={row.label}
                            onChange={(e) => updateMultiplier(row.id, { label: e.target.value })}
                            placeholder="VD: Nhiệt trị"
                            className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-emerald-500"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={row.symbol}
                            onChange={(e) =>
                              updateMultiplier(row.id, {
                                symbol: e.target.value.replace(/[{}[\]]/g, ""),
                              })
                            }
                            placeholder="Q"
                            className="h-9 w-full rounded-lg border border-slate-200 px-2 font-mono text-sm outline-none focus:border-emerald-500"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={row.value}
                            onChange={(e) =>
                              updateMultiplier(row.id, {
                                value: formatLiveNumberInput(e.target.value),
                              })
                            }
                            onBlur={(e) =>
                              updateMultiplier(row.id, {
                                value: formatAppNumberInput(e.target.value),
                              })
                            }
                            inputMode="decimal"
                            placeholder="43 215"
                            className="h-9 w-full rounded-lg border border-slate-200 px-2 font-mono text-sm outline-none focus:border-emerald-500"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={row.unit}
                            onChange={(e) => updateMultiplier(row.id, { unit: e.target.value })}
                            placeholder="kJ/kg"
                            className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-emerald-500"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => removeMultiplier(row.id)}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500"
                            aria-label={`Xóa ${row.label || "hệ số nhân"}`}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {multipliers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-xs text-slate-400">
                          Thêm hệ số nhân (vd. nhiệt trị Q). Có thể tính chỉ với hệ số nhân, không cần hệ số phát thải.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <Field label="NHẬP CÔNG THỨC TÍNH (TẤN CO₂E)">
              <div className="overflow-hidden rounded-xl border border-slate-200 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/15 transition-all">
                <textarea
                  ref={formulaRef}
                  value={formula}
                  onChange={(e) => setFormula(e.target.value)}
                  rows={4}
                  placeholder={`${activityToken(method)} * [CO2] * {kCO2}`}
                  className="w-full resize-none bg-white px-3 pt-3 pb-2 font-mono text-sm text-slate-800 outline-none placeholder:text-slate-400"
                />
                <div className="flex flex-wrap justify-end gap-2 px-3 pb-3">
                  {(selectedGroup?.gases ?? []).map((gas) => (
                    <button
                      key={gas.key}
                      type="button"
                      onClick={() => insertToken(gasToken(gas))}
                      className="rounded-lg bg-emerald-50 px-2 py-1 font-mono text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors"
                    >
                      {gasToken(gas)}
                    </button>
                  ))}
                  {multipliers
                    .filter((row) => row.symbol.trim())
                    .map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => insertToken(`{${row.symbol.trim()}}`)}
                        className="rounded-lg bg-emerald-50 px-2 py-1 font-mono text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors"
                      >
                        [{row.symbol.trim()}]
                      </button>
                    ))}
                  <button
                    type="button"
                    onClick={() => insertToken(activityToken(method))}
                    className="rounded-lg bg-emerald-50 px-2 py-1 font-mono text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors"
                  >
                    {method === "meter" ? "[Điểm đo]" : "[Giá trị thủ công]"}
                  </button>
                </div>
              </div>
            </Field>
            </>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="NGÀY BẮT ĐẦU ÁP DỤNG">
                <input
                  type="date"
                  value={appliedAt}
                  onChange={(e) => setAppliedAt(e.target.value)}
                  className="input"
                />
              </Field>
            </div>

            <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Lịch sử áp dụng hệ số</h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Khi cập nhật hệ số, phiên bản cũ sẽ kết thúc vào ngày trước ngày bắt đầu của phiên bản mới.
                  </p>
                </div>
                <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">
                  Theo thời gian hiệu lực
                </span>
              </div>
              {factorHistoryRows.length ? (
                <>
                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                    <table className="w-full min-w-[560px] text-left text-xs">
                      <thead className="border-b border-slate-100 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        <tr>
                          <th className="px-3 py-2">Phiên bản</th>
                          <th className="px-3 py-2">Giá trị</th>
                          <th className="px-3 py-2">Từ ngày</th>
                          <th className="px-3 py-2">Đến ngày</th>
                        </tr>
                      </thead>
                      <tbody>
                        {factorHistoryRows.map((row) => (
                          <tr key={row.id} className="border-b border-slate-50 last:border-0">
                            <td className="px-3 py-2.5 font-medium text-slate-700">{row.label}</td>
                            <td className="px-3 py-2.5 font-mono text-slate-700">
                              {formatFactorValue(row.value)} {row.unit}
                            </td>
                            <td className="px-3 py-2.5 text-slate-600">{row.validFrom}</td>
                            <td className="px-3 py-2.5">
                              <span className="font-medium text-emerald-700">{row.validTo}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400">
                    Chưa có phiên bản cũ trong dữ liệu giao diện hiện tại. Khi thư viện phát sinh phiên bản mới,
                    phiên bản cũ sẽ được hiển thị với ngày kết thúc tương ứng.
                  </p>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-xs text-slate-400">
                  Chọn một hệ số để xem các phiên bản và thời gian hiệu lực.
                </div>
              )}
            </section>

            {formError ? <p className="text-sm font-medium text-red-500">{formError}</p> : null}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors"
              >
                <SaveIcon className="h-4 w-4" />
                Lưu
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors shadow-xs"
              >
                Hủy
              </button>
            </div>
          </form>
        </section>

      </div>
      </>
      ) : (
      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="text-[15px] font-semibold text-slate-800">
            Danh sách nguồn phát thải
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip
              active={tableFilter === "all"}
              onClick={() => setTableFilter("all")}
            >
              Tổng các nguồn phát thải
            </FilterChip>
            {SCOPES.map((scope) => (
              <FilterChip
                key={scope.id}
                active={tableFilter === scope.id}
                onClick={() => {
                  setTableFilter(scope.id);
                  setActiveScope(scope.id);
                }}
              >
                {scope.label}
              </FilterChip>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-semibold tracking-wide text-slate-400">
                <th className="px-5 py-3">PHẠM VI</th>
                <th className="px-5 py-3">TÊN NGUỒN PHÁT THẢI</th>
                <th className="px-5 py-3">PHƯƠNG THỨC</th>
                <th className="px-5 py-3">GIÁ TRỊ HỆ SỐ</th>
                <th className="px-5 py-3 text-right">THAO TÁC</th>
              </tr>
            </thead>
            <tbody>
              {visibleSources.map((source) => {
                const MethodIcon = methodIcons[source.method];
                const sourceGroup = groups.find((group) => group.id === groupIdFromFactor(source.factorId));
                return (
                  <tr
                    key={source.id}
                    className="border-b border-slate-50 last:border-0 hover:bg-slate-50/80"
                  >
                    <td className="px-5 py-3.5">
                      <span className="inline-flex rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                        Scope {source.scope}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-slate-800">{source.name}</td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-2 text-slate-600">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-50 text-slate-500">
                          <MethodIcon className="h-3.5 w-3.5" />
                        </span>
                        <span>{METHOD_LABEL[source.method]}</span>
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs font-semibold text-slate-800">
                      {sourceGroup
                        ? sourceGroup.gases
                            .map((gas) => `${plainGasLabel(gas)} ${formatFactorValue(gas.value)}`)
                            .join(" · ")
                        : source.multipliers?.length
                          ? source.multipliers
                              .map((row) => `${row.symbol} ${formatFactorValue(row.value)}`)
                              .join(" · ")
                          : "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleEdit(source)}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-emerald-600"
                          aria-label={`Chỉnh sửa ${source.name}`}
                        >
                          <EditIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            persistSources(sources.filter((item) => item.id !== source.id))
                          }
                          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500"
                          aria-label={`Xóa ${source.name}`}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visibleSources.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">
                    Chưa có nguồn phát thải trong phạm vi này.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 rounded-full px-3 text-sm font-semibold transition-colors ${
        active
          ? "bg-emerald-600 text-white shadow-xs"
          : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

const methodIcons: Record<InputMethod, (props: { className?: string }) => ReactNode> = {
  meter: GaugeIcon,
  manual: KeyboardIcon,
  file: UploadIcon,
};


function LeafIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 18c2.5-1 4-3.2 4-6 0-2.2-1.2-3.8-2-4 1.8.2 4.5 1.8 4.5 5.2 0 1.7-.6 3-1.4 4.1C10.8 13.8 13 11 13 8c0-2-.8-3.5-1.6-4.2 2.4.6 5.6 3 5.6 7.4 0 4.4-3.4 7.8-8.8 8.8H4v-2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GaugeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="14" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M8.2 10.8a5.5 5.5 0 0 1 7.6 0M6 8.2a8.5 8.5 0 0 1 12 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function KeyboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="7" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M7 11h.01M11 11h.01M15 11h.01M17 14H7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5M12 4v11M8 8l4-4 4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 10l5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}






function SaveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 5h11l3 3v11H5V5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M8 5v5h8V5M8 19v-5h8v5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 17.5V20h2.5L18 8.5 15.5 6 4 17.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M13.8 7.7 16.3 10.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 7h14M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M8 7l.7 12.2A1.5 1.5 0 0 0 10.2 21h3.6a1.5 1.5 0 0 0 1.5-1.8L16 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
