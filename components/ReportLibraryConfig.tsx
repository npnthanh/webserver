"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { hydrateMeterTypeDefs } from "@/lib/meter-types";
import { declaredParamsForType, hydrateDevices, loadDevices, type CatalogDevice } from "@/lib/devices";
import {
  DEFAULT_HEADER_FOOTER,
  DEFAULT_REPORT_LAYOUT,
  REPORTS,
  defaultFieldsForMeterType,
  isElectricMeterType,
  reportFieldsFor,
  reportsForMeterType,
  type DeclaredReportParam,
  type ReportHeaderFooterConfig,
  type ReportTemplate,
  type ReportTypeId,
} from "@/lib/report-config";
import { loadReportTemplates, removeReportTemplate, saveReportTemplate } from "@/lib/report-templates";

const HEADER_FIELDS: { key: Exclude<keyof ReportHeaderFooterConfig, "formCode">; label: string; multiline?: boolean }[] = [
  { key: "companyName", label: "Tên đơn vị / công ty (đầu trang)" },
  { key: "department", label: "Phòng ban" },
  { key: "preparedByTitle", label: "Chức danh người lập" },
  { key: "reviewedByTitle", label: "Chức danh người kiểm soát" },
  { key: "approvedByTitle", label: "Chức danh người phê duyệt" },
  { key: "footerNote", label: "Ghi chú chân trang", multiline: true },
];

function blankTemplate(meterType: string, params: DeclaredReportParam[]): ReportTemplate {
  return {
    id: "",
    name: "",
    meterType,
    headerFooter: { ...DEFAULT_HEADER_FOOTER },
    enabledReports: reportsForMeterType(meterType),
    fieldsByReport: defaultFieldsForMeterType(meterType, params),
    titles: {},
    layout: { ...DEFAULT_REPORT_LAYOUT },
  };
}

/** Trang Cấu hình → Thư viện báo cáo: biểu mẫu báo cáo dùng chung, chia theo loại điểm đo. */
export function ReportLibraryConfig() {
  const [types, setTypes] = useState<string[]>([]);
  const [activeType, setActiveType] = useState("");
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [draft, setDraft] = useState<ReportTemplate | null>(null);
  const editorRef = useRef<HTMLElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [devices, setDevices] = useState<CatalogDevice[]>(loadDevices);

  useEffect(() => {
    const reloadDevices = () => void hydrateDevices().then(setDevices);
    reloadDevices();
    window.addEventListener("ems-devices-changed", reloadDevices);
    return () => window.removeEventListener("ems-devices-changed", reloadDevices);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([hydrateMeterTypeDefs(), loadReportTemplates()])
      .then(([defs, list]) => {
        if (!active) return;
        const names = defs.map((item) => item.name);
        setTypes(names);
        setTemplates(list);
        const first = names[0] ?? "";
        setActiveType(first);
        setDraft(list.find((item) => item.meterType === first) ?? null);
      })
      .catch((error) => {
        if (active) setMessage({ kind: "error", text: error instanceof Error ? error.message : "Không tải được thư viện báo cáo." });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const typeTemplates = useMemo(
    () => templates.filter((item) => item.meterType === activeType),
    [templates, activeType],
  );

  // Báo cáo / trường dữ liệu theo loại điểm đo của mẫu đang sửa (loại không phải điện: bỏ trường riêng của điện,
  // thêm trường theo thông số khai báo ở Hàm nhận dữ liệu của đồng hồ cùng loại).
  const draftType = draft?.meterType ?? activeType;
  const declaredParams = useMemo(() => declaredParamsForType(devices, draftType), [devices, draftType]);
  const availableReports = useMemo(() => reportsForMeterType(draftType), [draftType]);
  const fieldsFor = (id: ReportTypeId) => reportFieldsFor(id, draftType, declaredParams);

  function flash(kind: "ok" | "error", text: string) {
    setMessage({ kind, text });
    window.setTimeout(() => setMessage(null), 3500);
  }

  function selectType(type: string) {
    setActiveType(type);
    setDraft(templates.find((item) => item.meterType === type) ?? null);
  }

  function patch(next: Partial<ReportTemplate>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
  }

  function toggleReport(id: ReportTypeId) {
    if (!draft) return;
    const current = draft.enabledReports.filter((item) => availableReports.includes(item));
    const enabled = current.includes(id)
      ? current.filter((item) => item !== id)
      : availableReports.filter((item) => item === id || current.includes(item));
    if (enabled.length === 0) return flash("error", "Mẫu phải có ít nhất một loại báo cáo.");
    patch({ enabledReports: enabled });
  }

  function toggleField(id: ReportTypeId, key: string) {
    if (!draft) return;
    const keys = fieldsFor(id).map((f) => f.key);
    const current = (draft.fieldsByReport[id] ?? []).filter((item) => keys.includes(item));
    if (current.includes(key) && current.length <= 1) return flash("error", "Mỗi báo cáo phải giữ ít nhất một trường dữ liệu.");
    const next = current.includes(key)
      ? current.filter((item) => item !== key)
      : keys.filter((item) => item === key || current.includes(item));
    patch({ fieldsByReport: { ...draft.fieldsByReport, [id]: next } });
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) return flash("error", "Vui lòng nhập tên mẫu báo cáo.");
    const enabledReports = draft.enabledReports.filter((id) => availableReports.includes(id));
    if (enabledReports.length === 0) return flash("error", "Mẫu phải có ít nhất một loại báo cáo.");
    const fieldsByReport = { ...draft.fieldsByReport };
    for (const id of availableReports) {
      const keys = fieldsFor(id).map((f) => f.key);
      const kept = (draft.fieldsByReport[id] ?? []).filter((key) => keys.includes(key));
      fieldsByReport[id] = kept.length ? kept : defaultFieldsForMeterType(draftType, declaredParams)[id];
    }
    setSaving(true);
    try {
      const list = await saveReportTemplate({ ...draft, enabledReports, fieldsByReport });
      setTemplates(list);
      const saved =
        list.find((item) => (draft.id ? item.id === draft.id : item.meterType === draft.meterType && item.name === draft.name.trim())) ??
        null;
      setDraft(saved);
      flash("ok", "Đã lưu mẫu báo cáo.");
    } catch (error) {
      flash("error", error instanceof Error ? error.message : "Không lưu được mẫu báo cáo.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft?.id) return;
    setConfirmDelete(false);
    try {
      const list = await removeReportTemplate(draft.id);
      setTemplates(list);
      setDraft(list.find((item) => item.meterType === activeType) ?? null);
      flash("ok", "Đã xoá mẫu báo cáo.");
    } catch (error) {
      flash("error", error instanceof Error ? error.message : "Không xoá được mẫu báo cáo.");
    }
  }

  /** Mở mẫu để sửa; dưới lg khung sửa nằm dưới danh sách mẫu nên cuộn xuống cho thấy ngay. */
  function openTemplate(template: Parameters<typeof setDraft>[0]) {
    setDraft(template);
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    window.setTimeout(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Thư viện báo cáo</h1>

      {message ? (
        <p
          className={`rounded-xl border px-4 py-2.5 text-sm font-medium ${
            message.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-400">Đang tải…</p>
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

          <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between px-1 pb-1">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Mẫu · {activeType}</span>
              </div>
              {typeTemplates.length === 0 ? (
                <p className="px-1 py-4 text-sm text-slate-400">Chưa có mẫu nào cho loại này.</p>
              ) : (
                typeTemplates.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openTemplate(item)}
                    className={`block w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      draft?.id === item.id
                        ? "border-emerald-500 bg-emerald-50 font-semibold text-emerald-800"
                        : "border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {item.name}
                    <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
                      {item.enabledReports.length} loại báo cáo · xuất {item.layout.format === ".xlsx" ? "Excel" : "PDF"}
                    </span>
                  </button>
                ))
              )}
              <button
                type="button"
                onClick={() => openTemplate(blankTemplate(activeType, declaredParamsForType(devices, activeType)))}
                disabled={!activeType}
                className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2.5 text-sm font-semibold text-slate-600 hover:border-emerald-500 hover:text-emerald-700 disabled:opacity-50"
              >
                <span className="text-emerald-600">+</span> Thêm mẫu
              </button>
            </aside>

            {draft ? (
              <section ref={editorRef} className="scroll-mt-20 space-y-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <label className="block w-full min-w-0 flex-1 sm:w-auto sm:min-w-[260px]">
                    <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500">TÊN MẪU BÁO CÁO</span>
                    <input
                      className="input"
                      value={draft.name}
                      onChange={(e) => patch({ name: e.target.value })}
                      placeholder="VD: Báo cáo vận hành tháng"
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
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void save()}
                      disabled={saving}
                      className="h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {saving ? "Đang lưu..." : draft.id ? "Lưu mẫu" : "Tạo mẫu"}
                    </button>
                  </div>
                </div>

                <Block title="Header / Footer">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {HEADER_FIELDS.map((field) => (
                      <label key={field.key} className={`block ${field.multiline ? "sm:col-span-2" : ""}`}>
                        <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500">{field.label}</span>
                        {field.multiline ? (
                          <textarea
                            rows={3}
                            className="block min-h-[96px] w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-base leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 sm:text-sm"
                            value={draft.headerFooter[field.key]}
                            onChange={(e) => patch({ headerFooter: { ...draft.headerFooter, [field.key]: e.target.value } })}
                          />
                        ) : (
                          <input
                            className="input"
                            value={draft.headerFooter[field.key]}
                            onChange={(e) => patch({ headerFooter: { ...draft.headerFooter, [field.key]: e.target.value } })}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                </Block>

                <Block title="Loại báo cáo, tiêu đề và trường dữ liệu">
                  <div className="space-y-3">
                    {isElectricMeterType(draftType) ? null : (
                      <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs leading-relaxed text-amber-900">
                        Loại {draftType}: chỉ có các báo cáo và trường dữ liệu dùng được cho loại này (không có khung giờ
                        giá điện, chi phí 3 giá, khí nhà kính, điện áp, dòng điện).
                        {declaredParams.length === 0
                          ? ` Chưa có thông số đo nào: khai báo ở Thư viện loại đồng hồ → đồng hồ loại ${draftType} → Hàm nhận dữ liệu từ gateway.`
                          : ""}
                      </p>
                    )}
                    {REPORTS.filter((report) => availableReports.includes(report.id)).map((report) => {
                      const enabled = draft.enabledReports.includes(report.id);
                      const selected = draft.fieldsByReport[report.id] ?? [];
                      return (
                        <div key={report.id} className={`rounded-xl border p-3 ${enabled ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200"}`}>
                          <label className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-slate-800">
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={() => toggleReport(report.id)}
                              className="h-4 w-4 accent-emerald-600"
                            />
                            {report.name}
                            <span className="font-mono text-[11px] font-normal text-slate-400">{report.formCode}</span>
                          </label>
                          {enabled ? (
                            <div className="mt-2 space-y-2 sm:pl-6">
                              <input
                                className="input"
                                value={draft.titles[report.id] ?? ""}
                                onChange={(e) => patch({ titles: { ...draft.titles, [report.id]: e.target.value } })}
                                placeholder={`Tiêu đề in trên báo cáo (bỏ trống = ${report.title})`}
                              />
                              <div className="flex flex-wrap gap-1.5">
                                {fieldsFor(report.id).map((field) => {
                                  const on = selected.includes(field.key);
                                  return (
                                    <button
                                      key={field.key}
                                      type="button"
                                      onClick={() => toggleField(report.id, field.key)}
                                      className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                                        on
                                          ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                                          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                                      }`}
                                    >
                                      {on ? "✓ " : ""}
                                      {field.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </Block>

                <Block title="Bố cục mặc định">
                  <div className="flex flex-wrap items-center gap-4">
                    {(
                      [
                        ["chart", "Biểu đồ"],
                        ["summary", "Bảng tổng hợp"],
                        ["detail", "Bảng chi tiết"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={draft.layout[key]}
                          onChange={(e) => patch({ layout: { ...draft.layout, [key]: e.target.checked } })}
                          className="h-4 w-4 accent-emerald-600"
                        />
                        {label}
                      </label>
                    ))}
                    <div className="w-44">
                      <CustomSelect
                        className="input"
                        value={draft.layout.format}
                        onChange={(e) =>
                          patch({ layout: { ...draft.layout, format: e.target.value === ".xlsx" ? ".xlsx" : ".pdf" } })
                        }
                      >
                        <option value=".pdf">Xuất PDF</option>
                        <option value=".xlsx">Xuất Excel</option>
                      </CustomSelect>
                    </div>
                  </div>
                </Block>
              </section>
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
        title="Xoá mẫu báo cáo"
        description={`Xoá mẫu "${draft?.name ?? ""}" khỏi thư viện? Dự án đang dùng mẫu này sẽ quay về cấu hình riêng của dự án.`}
        confirmText="Xoá mẫu"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3 border-t border-slate-100 pt-4">
      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</h2>
      {children}
    </div>
  );
}
