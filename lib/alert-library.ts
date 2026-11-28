import { dbFetch, emitDbChange } from "@/lib/db-client";

/**
 * Thư viện cảnh báo dùng chung (trang Cấu hình → Thư viện cảnh báo): nhiều mẫu ngưỡng có tên cho từng loại
 * điểm đo. Dự án chọn mẫu cho từng loại (Điện / Nước / …) để chép ngưỡng vào cấu hình cảnh báo của dự án.
 */
export type AlertTemplate = {
  id: string;
  name: string;
  /** Loại điểm đo (Điện, Nước, …) */
  meterType: string;
  /** Ngưỡng theo nhóm (cùng cấu trúc alertConfig.alarmsByCategory của dự án), chỉ gồm nhóm của loại này. */
  alarmsByCategory: Record<string, unknown[]>;
};

export type AlertLibraryPayload = {
  templates?: AlertTemplate[];
  /** Dữ liệu cũ (một bộ ngưỡng cho mọi loại): tự chuyển thành "Mẫu mặc định" của từng loại. */
  categoriesByUtility?: Record<string, Array<{ id: string; label: string }>>;
  alarmsByCategory?: Record<string, unknown[]>;
};

/** Nhóm cảnh báo của đồng hồ điện. */
export const ELECTRIC_ALERT_GROUP_IDS = ["energy", "ui", "frequency", "power", "harmonics", "imbalance"];

function isElectric(utility: string) {
  const value = utility.trim().toLowerCase();
  return value.includes("điện") || value.includes("dien");
}

/** Nhóm cảnh báo mặc định của một loại điểm đo (khớp với trang cấu hình cảnh báo). */
export function alertGroupIdsForUtility(utility: string): string[] {
  const value = utility.trim().toLowerCase();
  if (isElectric(utility)) return [...ELECTRIC_ALERT_GROUP_IDS];
  if (value.includes("nước") || value.includes("nuoc")) return ["water"];
  if (value.includes("nhiệt") || value.includes("nhiet")) return ["temperature"];
  if (value.includes("hơi") || value.includes("hoi")) return ["steam"];
  return [`utility-${value.replace(/\s+/g, "-")}`];
}

/** Loại điểm đo của một nhóm cảnh báo (theo cấu hình đã lưu, không có thì theo nhóm mặc định). */
export function utilityForAlertGroup(
  groupId: string,
  utilities: string[],
  categoriesByUtility?: Record<string, Array<{ id: string }>>,
): string | null {
  for (const [utility, list] of Object.entries(categoriesByUtility ?? {})) {
    if (Array.isArray(list) && list.some((item) => item?.id === groupId)) return utility;
  }
  return utilities.find((utility) => alertGroupIdsForUtility(utility).includes(groupId)) ?? null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readAlarms(raw: unknown): Record<string, unknown[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, unknown[]> = {};
  for (const [groupId, list] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(list)) result[groupId] = list;
  }
  return result;
}

export function normalizeAlertTemplates(payload: AlertLibraryPayload | null | undefined): AlertTemplate[] {
  if (Array.isArray(payload?.templates)) {
    return payload.templates
      .map((item) => ({
        id: text(item?.id),
        name: text(item?.name),
        meterType: text(item?.meterType),
        alarmsByCategory: readAlarms(item?.alarmsByCategory),
      }))
      .filter((item) => item.id && item.name && item.meterType);
  }
  // Dữ liệu cũ: một bộ ngưỡng → mỗi loại có ngưỡng thành một "Mẫu mặc định".
  const legacy = readAlarms(payload?.alarmsByCategory);
  const byUtility = new Map<string, Record<string, unknown[]>>();
  for (const [groupId, list] of Object.entries(legacy)) {
    if (list.length === 0) continue;
    const utility =
      utilityForAlertGroup(groupId, Object.keys(payload?.categoriesByUtility ?? {}), payload?.categoriesByUtility) ??
      (ELECTRIC_ALERT_GROUP_IDS.includes(groupId)
        ? "Điện"
        : groupId === "water"
          ? "Nước"
          : groupId === "temperature"
            ? "Nhiệt"
            : groupId === "steam"
              ? "Hơi"
              : null);
    if (!utility) continue;
    byUtility.set(utility, { ...(byUtility.get(utility) ?? {}), [groupId]: list });
  }
  return [...byUtility.entries()].map(([meterType, alarmsByCategory], index) => ({
    id: `atpl-legacy-${index + 1}`,
    name: "Mẫu mặc định",
    meterType,
    alarmsByCategory,
  }));
}

export async function loadAlertTemplates() {
  return normalizeAlertTemplates(await dbFetch<AlertLibraryPayload>("alert-library"));
}

export async function saveAlertTemplates(templates: AlertTemplate[]) {
  const saved = await dbFetch<AlertLibraryPayload>("alert-library", {
    method: "POST",
    body: JSON.stringify({ templates }),
  });
  emitDbChange("alert-library");
  return normalizeAlertTemplates(saved);
}
