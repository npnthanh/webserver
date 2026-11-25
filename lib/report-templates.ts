import { dbFetch, emitDbChange } from "@/lib/db-client";
import type { ReportTemplate } from "@/lib/report-config";

/** Thư viện mẫu báo cáo dùng chung (Cấu hình → Thư viện báo cáo). */
export function loadReportTemplates() {
  return dbFetch<ReportTemplate[]>("report-templates");
}

export async function saveReportTemplate(template: ReportTemplate) {
  const list = await dbFetch<ReportTemplate[]>("report-templates", {
    method: "POST",
    body: JSON.stringify(template),
  });
  emitDbChange("report-templates");
  return list;
}

export async function removeReportTemplate(id: string) {
  const list = await dbFetch<ReportTemplate[]>("report-templates", { method: "DELETE", query: { id } });
  emitDbChange("report-templates");
  return list;
}
