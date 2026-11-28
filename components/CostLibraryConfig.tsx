"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CostPanel, tariffInputs, type Slot, type TouPriceInputs } from "@/components/client/ClientConfig";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { loadCostTemplates, saveCostTemplates, type CostTemplate } from "@/lib/cost-library";
import { DEFAULT_VOLTAGE_LEVEL, type VoltageLevelId } from "@/lib/industrial-electricity";
import { hydrateMeterTypeDefs } from "@/lib/meter-types";
import { defaultUtilityBands, type UtilityBand } from "@/lib/utility-tariff";

function blankTemplate(meterType: string): CostTemplate {
  return meterType === "Điện"
    ? {
        id: "",
        name: "",
        meterType,
        electricity: { voltageLevel: DEFAULT_VOLTAGE_LEVEL, prices: tariffInputs(DEFAULT_VOLTAGE_LEVEL), slots: [] },
      }
    : { id: "", name: "", meterType, bands: defaultUtilityBands() };
}

/**
 * Trang Cấu hình → Thư viện chi phí: nhiều mẫu biểu giá có tên theo loại điểm đo.
 * Điện: cấp điện áp, đơn giá 3 khung giờ (+ Không xác định), khung giá tùy chỉnh mở rộng.
 * Loại khác: khung giờ và đơn giá. Dự án chọn mẫu ở Cấu hình → Chi phí.
 */
export function CostLibraryConfig() {
  const [types, setTypes] = useState<string[] | null>(null);
  const [activeType, setActiveType] = useState("");
  const [templates, setTemplates] = useState<CostTemplate[]>([]);
  const [draft, setDraft] = useState<CostTemplate | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const templatesRef = useRef<CostTemplate[]>([]);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    templatesRef.current = templates;
  }, [templates]);

  useEffect(() => {
    let active = true;
    Promise.all([hydrateMeterTypeDefs(), loadCostTemplates()])
      .then(([defs, list]) => {
        if (!active) return;
        const names = defs.map((item) => item.name);
        setTypes(names);
        setTemplates(list);
        const first = names[0] ?? "";
        setActiveType(first);
        setDraft(list.find((item) => item.meterType === first) ?? null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Không tải được thư viện chi phí.");
      });
    return () => {
      active = false;
    };
  }, []);

  const typeTemplates = useMemo(() => templates.filter((item) => item.meterType === activeType), [templates, activeType]);

  function flash(kind: "ok" | "error", text: string) {
    setMessage({ kind, text });
    window.setTimeout(() => setMessage(null), 3000);
  }

  const persist = useCallback(async (next: CostTemplate[], notice?: string) => {
    try {
      const saved = await saveCostTemplates(next);
      setTemplates(saved);
      if (notice) flash("ok", notice);
      return saved;
    } catch (err) {
      flash("error", err instanceof Error ? err.message : "Không lưu được thư viện chi phí.");
      return null;
    }
  }, []);

  /** Sửa biểu giá của mẫu đang mở; mẫu đã tạo thì tự lưu (gom các lần gõ liên tiếp). */
  function patch(next: Partial<CostTemplate>) {
    if (!draft) return;
    const updated = { ...draft, ...next };
    setDraft(updated);
    if (!updated.id) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persist(templatesRef.current.map((item) => (item.id === updated.id ? updated : item)));
    }, 700);
  }

  function selectType(type: string) {
    setActiveType(type);
    setDraft(templates.find((item) => item.meterType === type) ?? null);
  }

  function nameTaken(name: string, id: string) {
    return templates.some(
      (item) => item.meterType === activeType && item.id !== id && item.name.toLowerCase() === name.toLowerCase(),
    );
  }

  async function create() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return flash("error", "Vui lòng nhập tên mẫu chi phí.");
    if (nameTaken(name, "")) return flash("error", `Loại ${activeType} đã có mẫu tên "${name}".`);
    const created = { ...draft, id: `ctpl-${Date.now()}`, name };
    const saved = await persist([...templates, created], "Đã tạo mẫu chi phí.");
    if (saved) setDraft(saved.find((item) => item.id === created.id) ?? created);
  }

  async function commitName() {
    if (!draft?.id) return;
    const name = draft.name.trim();
    const original = templates.find((item) => item.id === draft.id);
    if (!name || name === original?.name) {
      if (!name && original) setDraft({ ...draft, name: original.name });
      return;
    }
    if (nameTaken(name, draft.id)) return flash("error", `Loại ${activeType} đã có mẫu tên "${name}".`);
    await persist(templates.map((item) => (item.id === draft.id ? { ...item, name } : item)), "Đã đổi tên mẫu.");
  }

  async function remove() {
    if (!draft?.id) return;
    setConfirmDelete(false);
    const saved = await persist(templates.filter((item) => item.id !== draft.id), "Đã xoá mẫu chi phí.");
    if (saved) setDraft(saved.find((item) => item.meterType === activeType) ?? null);
  }

  const electricity = draft?.electricity;
  const prices: TouPriceInputs = electricity
    ? { ...tariffInputs(electricity.voltageLevel), ...electricity.prices }
    : tariffInputs(DEFAULT_VOLTAGE_LEVEL);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Thư viện chi phí</h1>

      {message ? (
        <p
          className={`rounded-xl border px-4 py-2.5 text-sm font-medium ${
            message.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      ) : types === null ? (
        <p className="text-sm text-slate-400">Đang tải…</p>
      ) : types.length === 0 ? (
        <p className="text-sm text-slate-500">Chưa có loại điểm đo nào. Thêm tại Cấu hình → Loại điểm đo.</p>
      ) : (
        <>
          <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Loại điểm đo</div>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Loại điểm đo">
              {types.map((type) => {
                const count = templates.filter((item) => item.meterType === type).length;
                const selected = type === activeType;
                return (
                  <button
                    key={type}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => selectType(type)}
                    className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-sm font-bold transition-all ${
                      selected
                        ? "border-emerald-500 bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-500/20"
                        : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700"
                    }`}
                  >
                    {type}
                    <span className="rounded-md bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-500">{count}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="h-fit space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
              <span className="block px-1 pb-1 text-xs font-bold uppercase tracking-wider text-slate-400">
                Mẫu · {activeType}
              </span>
              {typeTemplates.length === 0 ? (
                <p className="px-1 py-4 text-sm text-slate-400">Chưa có mẫu nào cho loại này.</p>
              ) : (
                typeTemplates.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDraft(item)}
                    className={`block w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      draft?.id === item.id
                        ? "border-emerald-500 bg-emerald-50 font-semibold text-emerald-800"
                        : "border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {item.name}
                    <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
                      {item.electricity
                        ? `${item.electricity.slots.length ? `${item.electricity.slots.length} khung tùy chỉnh` : "3 khung giờ"}`
                        : `${item.bands?.length ?? 0} khung giờ`}
                    </span>
                  </button>
                ))
              )}
              <button
                type="button"
                onClick={() => setDraft(blankTemplate(activeType))}
                className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2.5 text-sm font-semibold text-slate-600 hover:border-emerald-500 hover:text-emerald-700"
              >
                <span className="text-emerald-600">+</span> Thêm mẫu
              </button>
            </aside>

            {draft ? (
              <div className="min-w-0 space-y-4">
                <section className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <label className="block w-full min-w-0 flex-1 sm:w-auto sm:min-w-[260px]">
                    <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500">TÊN MẪU CHI PHÍ</span>
                    <input
                      className="input"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      onBlur={() => void commitName()}
                      placeholder={`VD: ${activeType} - biểu giá 2026`}
                    />
                  </label>
                  <div className="flex w-full gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">
                    {draft.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setDraft({ ...draft, id: "", name: `${draft.name} (bản sao)` })}
                          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Nhân bản
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(true)}
                          className="h-10 rounded-lg border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-600 hover:bg-rose-50"
                        >
                          Xoá mẫu
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void create()}
                        className="h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
                      >
                        Tạo mẫu
                      </button>
                    )}
                  </div>
                  <p className="w-full text-[11px] text-slate-400">
                    {draft.id
                      ? "Thay đổi biểu giá được lưu tự động. Dự án đã chọn mẫu này cần chọn lại mẫu để nhận biểu giá mới."
                      : "Đặt tên rồi bấm Tạo mẫu để lưu vào thư viện."}
                  </p>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <CostPanel
                    libraryMode
                    utility={draft.meterType}
                    utilities={[draft.meterType]}
                    onUtility={() => undefined}
                    applyDate=""
                    onApplyDate={() => undefined}
                    voltageLevel={(electricity?.voltageLevel ?? DEFAULT_VOLTAGE_LEVEL) as VoltageLevelId}
                    touPrices={prices}
                    slots={(electricity?.slots ?? []) as Slot[]}
                    onSlotsChange={(slots) =>
                      patch({ electricity: { voltageLevel: electricity?.voltageLevel ?? DEFAULT_VOLTAGE_LEVEL, prices, slots } })
                    }
                    tariffHistory={[]}
                    onTariffHistoryChange={() => undefined}
                    onVoltageLevel={(levelId) =>
                      patch({
                        electricity: {
                          voltageLevel: levelId,
                          prices: { ...tariffInputs(levelId), none: prices.none },
                          slots: electricity?.slots ?? [],
                        },
                      })
                    }
                    onTouPrice={(band, value) =>
                      patch({
                        electricity: {
                          voltageLevel: electricity?.voltageLevel ?? DEFAULT_VOLTAGE_LEVEL,
                          prices: { ...prices, [band]: value },
                          slots: electricity?.slots ?? [],
                        },
                      })
                    }
                    bands={draft.bands ?? defaultUtilityBands()}
                    onBands={(bands: UtilityBand[]) => patch({ bands })}
                    indexSources={[]}
                    onPickIndex={async () => undefined}
                  />
                </section>
              </div>
            ) : (
              <section className="flex items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-sm text-slate-400">
                Chọn một mẫu bên trái hoặc bấm “Thêm mẫu”.
              </section>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Xoá mẫu chi phí"
        description={`Xoá mẫu "${draft?.name ?? ""}" khỏi thư viện? Biểu giá đã chép vào các dự án vẫn giữ nguyên.`}
        confirmText="Xoá mẫu"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
