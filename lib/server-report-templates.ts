import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { emsDb, jsonField, queryRows } from "@/lib/server-db";
import {
  DEFAULT_HEADER_FOOTER,
  DEFAULT_REPORT_LAYOUT,
  REPORT_FIELDS,
  REPORT_TYPE_IDS,
  defaultSelectedFieldsByReport,
  normalizeReportTemplate,
  type ReportTemplate,
  type ReportTypeId,
} from "@/lib/report-config";

/**
 * Thư viện mẫu báo cáo dùng chung (Cấu hình → Thư viện báo cáo), chia theo loại điểm đo.
 * Trang Báo cáo của dự án chọn mẫu ở ô "Mẫu báo cáo áp dụng".
 */

export class ReportTemplateError extends Error {}

let schemaReady: Promise<void> | null = null;

function allFields(): Record<ReportTypeId, string[]> {
  return Object.fromEntries(REPORT_TYPE_IDS.map((id) => [id, REPORT_FIELDS[id].map((f) => f.key)])) as Record<
    ReportTypeId,
    string[]
  >;
}

/** 4 mẫu có sẵn trước đây (chỉ là tên) nay thành mẫu thật cho loại Điện, để danh sách chọn không trống. */
function seedTemplates(): ReportTemplate[] {
  const defaults = defaultSelectedFieldsByReport();
  return [
    {
      id: "tpl-ems-standard",
      name: "Mẫu báo cáo chuẩn EMS",
      meterType: "Điện",
      headerFooter: { ...DEFAULT_HEADER_FOOTER },
      enabledReports: [...REPORT_TYPE_IDS],
      fieldsByReport: defaults,
      titles: {},
      layout: { ...DEFAULT_REPORT_LAYOUT },
    },
    {
      id: "tpl-iso-50001",
      name: "Mẫu báo cáo ISO 50001",
      meterType: "Điện",
      headerFooter: {
        ...DEFAULT_HEADER_FOOTER,
        department: "Ban Quản lý Năng lượng (EnMS – ISO 50001)",
        footerNote: "Báo cáo phục vụ hệ thống quản lý năng lượng theo ISO 50001.",
      },
      enabledReports: ["overview", "energy", "cost", "comparison"],
      fieldsByReport: { ...defaults, energy: allFields().energy },
      titles: { energy: "BÁO CÁO HIỆU QUẢ NĂNG LƯỢNG (ISO 50001)" },
      layout: { ...DEFAULT_REPORT_LAYOUT },
    },
    {
      id: "tpl-ghg-14064",
      name: "Mẫu báo cáo kiểm kê GHG (ISO 14064)",
      meterType: "Điện",
      headerFooter: {
        ...DEFAULT_HEADER_FOOTER,
        footerNote: "Kiểm kê khí nhà kính theo ISO 14064-1 và GHG Protocol.",
      },
      enabledReports: ["overview", "ghg"],
      fieldsByReport: { ...defaults, ghg: allFields().ghg },
      titles: { ghg: "BÁO CÁO KIỂM KÊ KHÍ NHÀ KÍNH (ISO 14064)" },
      layout: { ...DEFAULT_REPORT_LAYOUT },
    },
    {
      id: "tpl-custom",
      name: "Mẫu tùy chỉnh doanh nghiệp",
      meterType: "Điện",
      headerFooter: { ...DEFAULT_HEADER_FOOTER },
      enabledReports: [...REPORT_TYPE_IDS],
      fieldsByReport: allFields(),
      titles: {},
      layout: { ...DEFAULT_REPORT_LAYOUT, format: ".xlsx" },
    },
  ];
}

export function ensureReportTemplatesSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await emsDb.query(
        `CREATE TABLE IF NOT EXISTS report_templates (
           id VARCHAR(64) NOT NULL,
           meter_type VARCHAR(100) NOT NULL,
           name VARCHAR(200) NOT NULL,
           payload JSON NOT NULL,
           sort_order INT NOT NULL DEFAULT 0,
           updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
           PRIMARY KEY (id),
           KEY idx_report_templates_type (meter_type, sort_order)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );
      const [count] = await queryRows<RowDataPacket>("SELECT COUNT(*) AS n FROM report_templates");
      if (Number(count?.n ?? 0) === 0) {
        let order = 0;
        for (const tpl of seedTemplates()) {
          await emsDb.execute(
            `INSERT IGNORE INTO report_templates (id, meter_type, name, payload, sort_order) VALUES (?, ?, ?, ?, ?)`,
            [tpl.id, tpl.meterType, tpl.name, JSON.stringify(tpl), order++],
          );
        }
      }
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

export async function listReportTemplates(): Promise<ReportTemplate[]> {
  await ensureReportTemplatesSchema();
  const rows = await queryRows<RowDataPacket>(
    "SELECT id, meter_type AS meterType, name, payload FROM report_templates ORDER BY meter_type, sort_order, name",
  );
  return rows.map((row) =>
    normalizeReportTemplate({
      ...jsonField<Record<string, unknown>>(row.payload, {}),
      id: String(row.id),
      meterType: String(row.meterType),
      name: String(row.name),
    }),
  );
}

export async function saveReportTemplate(raw: unknown) {
  await ensureReportTemplatesSchema();
  const tpl = normalizeReportTemplate(raw);
  if (!tpl.name.trim()) throw new ReportTemplateError("Vui lòng nhập tên mẫu báo cáo.");
  if (!tpl.meterType.trim()) throw new ReportTemplateError("Thiếu loại điểm đo của mẫu báo cáo.");
  const id = tpl.id || `tpl-${Date.now()}`;
  const duplicate = await queryRows<RowDataPacket>(
    "SELECT id FROM report_templates WHERE meter_type = ? AND name = ? AND id <> ? LIMIT 1",
    [tpl.meterType, tpl.name.trim(), id],
  );
  if (duplicate.length) throw new ReportTemplateError(`Loại ${tpl.meterType} đã có mẫu tên "${tpl.name.trim()}".`);
  const [order] = await queryRows<RowDataPacket>(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM report_templates WHERE meter_type = ?",
    [tpl.meterType],
  );
  const saved: ReportTemplate = { ...tpl, id, name: tpl.name.trim() };
  await emsDb.execute(
    `INSERT INTO report_templates (id, meter_type, name, payload, sort_order) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE meter_type = VALUES(meter_type), name = VALUES(name), payload = VALUES(payload)`,
    [id, saved.meterType, saved.name, JSON.stringify(saved), Number(order?.next ?? 0)],
  );
  return listReportTemplates();
}

export async function deleteReportTemplate(id: string) {
  await ensureReportTemplatesSchema();
  if (!id) throw new ReportTemplateError("Thiếu mã mẫu báo cáo.");
  await emsDb.execute("DELETE FROM report_templates WHERE id = ?", [id]);
  return listReportTemplates();
}
