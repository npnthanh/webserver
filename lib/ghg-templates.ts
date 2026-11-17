import { dbFetch, emitDbChange } from "@/lib/db-client";
import type { GhgMultiplier } from "@/lib/ghg-sources";

/**
 * Mẫu nguồn phát thải "Nhập thủ công" (trang Cấu hình → Nguồn phát thải thủ công).
 * Trong cấu hình khí nhà kính của dự án chỉ cần chọn mẫu, các thông số tính toán lấy từ đây.
 */
export type GhgManualTemplate = {
  id: string;
  name: string;
  unit: string;
  defaultValue: number | null;
  /** Nhóm hệ số phát thải (thư viện hệ số); "" nếu chỉ dùng hệ số nhân. */
  factorGroupId: string;
  multipliers: GhgMultiplier[];
  formula: string;
};

export const DEFAULT_TEMPLATE_FORMULA = "{Giá trị thủ công} * {Hệ số phát thải}";

let cache: GhgManualTemplate[] = [];

export function loadGhgTemplates() {
  return cache;
}

export async function hydrateGhgTemplates() {
  if (typeof window === "undefined") return cache;
  try {
    cache = await dbFetch<GhgManualTemplate[]>("ghg-templates");
  } catch {
    // giữ cache cũ
  }
  return cache;
}

export async function saveGhgTemplate(template: GhgManualTemplate) {
  cache = await dbFetch<GhgManualTemplate[]>("ghg-templates", {
    method: "POST",
    body: JSON.stringify(template),
  });
  emitDbChange("ghg-templates");
  return cache;
}

export async function deleteGhgTemplate(id: string) {
  await dbFetch("ghg-templates", { method: "DELETE", query: { id } });
  cache = cache.filter((item) => item.id !== id);
  emitDbChange("ghg-templates");
  return cache;
}
