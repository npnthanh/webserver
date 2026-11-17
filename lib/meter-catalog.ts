import { dbFetch, emitDbChange } from "@/lib/db-client";

/** Giao thức của model = Protocol Version (PV) mà gateway gửi lên (VD "1.0"). */
export function loadGatewayProtocolVersions() {
  return dbFetch<string[]>("gateway-protocol-versions").catch(() => ["1.0"]);
}

/**
 * Model đồng hồ trong danh mục cấu hình.
 * - `meterType`: tên loại đồng hồ (dùng chung danh sách "Loại điểm đo": Điện, Nước, Nhiệt, Hơi, ...).
 * - `modelCode`: mã nhận dạng model (MM) gateway gửi lên.
 */
export type MeterModelDef = {
  id: string;
  meterType: string;
  brand: string;
  modelName: string;
  modelCode: number | null;
  protocol: string | null;
};

let modelCache: MeterModelDef[] = [];
let modelHydration: Promise<MeterModelDef[]> | null = null;

export function loadMeterModels(): MeterModelDef[] {
  return modelCache;
}

export function hydrateMeterModels(options?: { force?: boolean }) {
  if (typeof window === "undefined") return Promise.resolve(modelCache);
  if (modelHydration && !options?.force) return modelHydration;
  modelHydration = dbFetch<MeterModelDef[]>("meter-models")
    .then((rows) => {
      const changed = JSON.stringify(modelCache) !== JSON.stringify(rows);
      modelCache = rows;
      if (changed) emitDbChange("meter-models");
      return modelCache;
    })
    .catch(() => modelCache)
    .finally(() => {
      modelHydration = null;
    });
  return modelHydration;
}

export async function upsertMeterModel(model: MeterModelDef) {
  const rows = await dbFetch<MeterModelDef[]>("meter-models", {
    method: "POST",
    body: JSON.stringify(model),
  });
  modelCache = rows;
  emitDbChange("meter-models");
  return rows;
}

export async function removeMeterModel(id: string) {
  await dbFetch("meter-models", { method: "DELETE", query: { id } });
  modelCache = modelCache.filter((item) => item.id !== id);
  emitDbChange("meter-models");
  return modelCache;
}

/** Chuẩn hóa mã nhận dạng nhập tay: số nguyên 0–255 hoặc null (để trống). */
export function parseIdentCode(value: string): number | null | "invalid" {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d+$/.test(text)) return "invalid";
  const code = Number(text);
  return code >= 0 && code <= 255 ? code : "invalid";
}
