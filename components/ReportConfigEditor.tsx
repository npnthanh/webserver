"use client";

import { useEffect, useState } from "react";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { hydrateClientMeters } from "@/lib/client-meters";
import { declaredParamsForType, hydrateDevices, loadDevices, type CatalogDevice } from "@/lib/devices";
import { hydrateProjectSettings, saveProjectSettings } from "@/lib/project-settings";
import { hydrateProjects } from "@/lib/projects";
import {
  PARAM_FIELD_PREFIX,
  REPORTS,
  REPORT_FIELDS,
  defaultSelectedFieldsByReport,
  isElectricMeterType,
  isReportFieldAllowed,
  readReportConfig,
  reportFieldsFor,
  reportsForMeterType,
  type ReportConfig,
  type ReportHeaderFooterConfig,
  type ReportTypeId,
} from "@/lib/report-config";

const HEADER_FIELDS: { key: Exclude<keyof ReportHeaderFooterConfig, "formCode" | "footerNote">; label: string }[] = [
  { key: "companyName", label: "Tên đơn vị / hệ thống (dòng đầu báo cáo)" },
  { key: "department", label: "Phòng ban lập báo cáo" },
  { key: "preparedByTitle", label: "Chức danh ô ký 1" },
  { key: "reviewedByTitle", label: "Chức danh ô ký 2" },
  { key: "approvedByTitle", label: "Chức danh ô ký 3" },
];

/**
 * Cấu hình báo cáo của dự án (Quản lý dự án → Cấu hình báo cáo).
 * Lưu vào project_settings.reportConfig; trang Báo cáo của khách hàng dùng làm mặc định.
 */
export function ReportConfigEditor({ projectId }: { projectId: string }) {
  const [config, setConfig] = useState<ReportConfig | null>(null);
  const [fieldTab, setFieldTab] = useState<ReportTypeId>("overview");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // Loại điểm đo đang xem ở mục "Trường dữ liệu" (Điện / Nước / …) — trường hiển thị theo loại.
  const [meterTypes, setMeterTypes] = useState<string[]>([]);
  const [fieldUtility, setFieldUtility] = useState("Điện");
  const [devices, setDevices] = useState<CatalogDevice[]>(loadDevices);

  useEffect(() => {
    let active = true;
    void Promise.all([
      hydrateProjects().catch(() => []),
      hydrateClientMeters(projectId).catch(() => []),
      hydrateDevices().catch(() => loadDevices()),
    ]).then(([projects, meters, deviceList]) => {
      if (!active) return;
      const project = projects.find((item) => item.id === projectId);
      const types = Array.from(
        new Set([...(project?.meterTypes ?? []), ...meters.map((m) => m.utility)].filter(Boolean) as string[]),
      );
      setMeterTypes(types);
      setDevices(deviceList);
      setFieldUtility((current) =>
        types.includes(current) ? current : types.find((type) => isElectricMeterType(type)) ?? types[0] ?? "Điện",
      );
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    let active = true;
    void hydrateProjectSettings(projectId, { force: true })
      .then((settings) => {
        if (active) setConfig(readReportConfig(settings as Record<string, unknown>));
      })
      .catch(() => {
        if (active) setConfig(readReportConfig(null));
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  if (!config) {
    return <p className="py-16 text-center text-sm text-slate-400">Đang tải cấu hình báo cáo...</p>;
  }

  const update = (patch: Partial<ReportConfig>) => setConfig({ ...config, ...patch });

  function toggleReport(id: ReportTypeId) {
    if (!config) return;
    const enabled = config.enabledReports.includes(id);
    // Luôn giữ ít nhất một loại báo cáo cho khách hàng.
    if (enabled && config.enabledReports.length === 1) return;
    const next = enabled ? config.enabledReports.filter((item) => item !== id) : [...config.enabledReports, id];
    update({ enabledReports: REPORTS.map((item) => item.id).filter((item) => next.includes(item)) });
  }

  /** Bật / tắt trường khách hàng được xem; trường đang tích ở trang khách cũng bỏ theo nếu bị tắt. */
  function toggleField(id: ReportTypeId, key: string) {
    if (!config) return;
    const current = config.allowedFields[id] ?? [];
    if (current.includes(key) && current.length <= 1) return;
    const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    const allowed = REPORT_FIELDS[id].map((field) => field.key).filter((item) => next.includes(item));
    const selected = (config.fieldsByReport[id] ?? []).filter((item) => allowed.includes(item));
    update({
      allowedFields: { ...config.allowedFields, [id]: allowed },
      fieldsByReport: { ...config.fieldsByReport, [id]: selected.length ? selected : allowed },
    });
  }

  /** Trường theo thông số đo (param:…): mặc định được xem, bỏ tích thì ghi vào danh sách ẩn. */
  function toggleParamField(id: ReportTypeId, key: string) {
    if (!config) return;
    const hidden = config.hiddenParamFields?.[id] ?? [];
    const next = hidden.includes(key) ? hidden.filter((item) => item !== key) : [...hidden, key];
    update({ hiddenParamFields: { ...config.hiddenParamFields, [id]: next } });
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    setNotice(null);
    try {
      await saveProjectSettings(projectId, { reportConfig: config });
      setNotice({ ok: true, text: "Đã lưu cấu hình báo cáo." });
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "Không lưu được cấu hình báo cáo." });
    } finally {
      setSaving(false);
    }
  }

  const cardClass = "rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]";
  const inputClass =
    "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-emerald-500";
  const electricFields = isElectricMeterType(fieldUtility);
  const declaredParams = electricFields ? [] : declaredParamsForType(devices, fieldUtility);
  const fieldReports = REPORTS.filter((item) => reportsForMeterType(fieldUtility).includes(item.id));
  const activeFieldTab = fieldReports.some((item) => item.id === fieldTab) ? fieldTab : fieldReports[0]?.id ?? "overview";
  const fieldsOf = (id: ReportTypeId) => reportFieldsFor(id, fieldUtility, declaredParams);
  const allowedCount = (id: ReportTypeId) =>
    fieldsOf(id).filter((field) => isReportFieldAllowed(config, id, field.key)).length;

  return (
    <div className="space-y-5">
      {/* 1. Loại báo cáo + tiêu đề */}
      <section className={cardClass}>
        <h2 className="text-base font-bold text-slate-900">Loại báo cáo khách hàng được xem</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Loại báo cáo bỏ tích sẽ không hiện ở trang Báo cáo của khách. Đặt tiêu đề in trên báo cáo (bỏ trống = tiêu đề
          chuẩn).
        </p>
        <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {REPORTS.map((item, index) => {
            const enabled = config.enabledReports.includes(item.id);
            return (
              <div key={item.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(220px,1fr)_2fr] sm:items-center">
                <label className="inline-flex cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleReport(item.id)}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  <span>
                    <span className={`block text-sm font-semibold ${enabled ? "text-slate-800" : "text-slate-400"}`}>
                      {index + 1}. {item.name}
                    </span>
                    <span className="block font-mono text-[11px] text-slate-400">{item.formCode}</span>
                  </span>
                </label>
                <input
                  value={config.titles[item.id] ?? ""}
                  disabled={!enabled}
                  onChange={(event) => update({ titles: { ...config.titles, [item.id]: event.target.value } })}
                  placeholder={item.title}
                  className={`${inputClass} font-semibold tracking-wide disabled:bg-slate-50 disabled:text-slate-400`}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* 2. Bố cục mặc định */}
      <section className={cardClass}>
        <h2 className="text-base font-bold text-slate-900">Bố cục mặc định</h2>
        <p className="mt-0.5 text-sm text-slate-500">Khách hàng vẫn đổi được khi xuất từng báo cáo.</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          {(
            [
              ["chart", "Hiển thị biểu đồ"],
              ["summary", "Bảng dữ liệu tổng hợp"],
              ["detail", "Bảng dữ liệu chi tiết"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={config.layout[key]}
                onChange={() => update({ layout: { ...config.layout, [key]: !config.layout[key] } })}
                className="h-4 w-4 accent-emerald-600"
              />
              {label}
            </label>
          ))}
          <div className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
            Định dạng xuất mặc định
            <CustomSelect
              value={config.layout.format}
              onChange={(event) =>
                update({ layout: { ...config.layout, format: event.target.value === ".xlsx" ? ".xlsx" : ".pdf" } })
              }
              className="h-9 min-w-[170px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-500"
            >
              <option value=".pdf">.pdf (Bản in chuẩn A4)</option>
              <option value=".xlsx">.xlsx (Bảng tính Excel)</option>
            </CustomSelect>
          </div>
        </div>
      </section>

      {/* 3. Header & Footer */}
      <section className={cardClass}>
        <h2 className="text-base font-bold text-slate-900">Header & Footer</h2>
        <p className="mt-0.5 text-sm text-slate-500">In ở đầu và cuối mọi báo cáo của dự án (bản xem trước, PDF, Excel).</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {HEADER_FIELDS.map((field) => (
            <label key={field.key} className="block">
              <span className="mb-1 block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{field.label}</span>
              <input
                value={config.headerFooter[field.key]}
                onChange={(event) =>
                  update({ headerFooter: { ...config.headerFooter, [field.key]: event.target.value } })
                }
                className={inputClass}
              />
            </label>
          ))}
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Ghi chú cuối trang</span>
            <textarea
              value={config.headerFooter.footerNote}
              onChange={(event) => update({ headerFooter: { ...config.headerFooter, footerNote: event.target.value } })}
              rows={2}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-500"
            />
          </label>
        </div>
      </section>

      {/* 4. Trường dữ liệu mặc định */}
      <section className={cardClass}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">Trường dữ liệu khách hàng được xem</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Trường bỏ tích sẽ ẩn hẳn ở trang Báo cáo của khách (cả bản xem trước và file xuất). Khách chỉ chọn trong các
              trường được tích ở đây.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const all = REPORT_FIELDS[activeFieldTab].map((field) => field.key);
              update({
                allowedFields: { ...config.allowedFields, [activeFieldTab]: all },
                fieldsByReport: {
                  ...config.fieldsByReport,
                  [activeFieldTab]: defaultSelectedFieldsByReport()[activeFieldTab],
                },
                hiddenParamFields: { ...config.hiddenParamFields, [activeFieldTab]: [] },
              });
            }}
            className="text-xs font-semibold text-slate-500 hover:underline"
          >
            Cho xem tất cả
          </button>
        </div>
        {meterTypes.length > 1 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Loại điểm đo:</span>
            {meterTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setFieldUtility(type)}
                className={`h-8 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                  type === fieldUtility
                    ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        ) : null}
        {electricFields ? null : (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs leading-relaxed text-amber-900">
            Loại {fieldUtility} không có báo cáo chi phí 3 giá / khí nhà kính và các trường riêng của điện. Trường cùng tên
            (điểm đo, tổng tiêu thụ, chỉ số đầu / cuối kỳ…) dùng chung quyền xem với Điện; trường thông số đo (VD Qm3s) chỉ
            áp cho loại này.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {fieldReports.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFieldTab(item.id)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${
                activeFieldTab === item.id
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-emerald-50"
              }`}
            >
              {item.name}
              <span className={activeFieldTab === item.id ? "text-white/80" : "text-slate-400"}>
                {allowedCount(item.id)}/{fieldsOf(item.id).length}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {fieldsOf(activeFieldTab).map((field) => {
            const isParam = field.key.startsWith(PARAM_FIELD_PREFIX);
            const checked = isReportFieldAllowed(config, activeFieldTab, field.key);
            return (
              <label
                key={field.key}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                  checked
                    ? "border-emerald-200 bg-emerald-50/70 font-semibold text-emerald-900"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    isParam ? toggleParamField(activeFieldTab, field.key) : toggleField(activeFieldTab, field.key)
                  }
                  className="h-3.5 w-3.5 accent-emerald-600"
                />
                <span className="truncate">{field.label}</span>
              </label>
            );
          })}
        </div>
      </section>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-white/95 px-1 py-3 backdrop-blur">
        {notice ? (
          <span className={`text-sm font-medium ${notice.ok ? "text-emerald-600" : "text-rose-600"}`}>{notice.text}</span>
        ) : null}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex h-10 items-center rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Đang lưu..." : "Lưu cấu hình báo cáo"}
        </button>
      </div>
    </div>
  );
}
