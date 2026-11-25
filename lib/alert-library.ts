import { dbFetch, emitDbChange } from "@/lib/db-client";

/**
 * Thư viện cảnh báo dùng chung (trang Cấu hình → Thư viện cảnh báo): mẫu ngưỡng theo từng loại điểm đo.
 * Cùng cấu trúc với alertConfig của dự án; dự án chép mẫu này bằng nút "Áp dụng từ thư viện".
 */
export type AlertLibraryPayload = {
  categoriesByUtility?: Record<string, Array<{ id: string; label: string }>>;
  alarmsByCategory?: Record<string, unknown[]>;
};

export function loadAlertLibrary() {
  return dbFetch<AlertLibraryPayload>("alert-library");
}

export async function saveAlertLibrary(payload: AlertLibraryPayload) {
  const saved = await dbFetch<AlertLibraryPayload>("alert-library", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  emitDbChange("alert-library");
  return saved;
}
