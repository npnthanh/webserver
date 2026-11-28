import { dbFetch, emitDbChange } from "@/lib/db-client";
import type { UtilityBand } from "@/lib/utility-tariff";

/**
 * Thư viện chi phí (Cấu hình → Thư viện chi phí): nhiều mẫu biểu giá có tên theo loại điểm đo.
 * Dự án chọn mẫu ở Cấu hình → Chi phí để chép biểu giá vào cấu hình của dự án.
 */
export type CostTemplateSlot = { id: string; name: string; color: string; from: string; to: string; price: string };

export type CostTemplate = {
  id: string;
  name: string;
  /** Loại điểm đo (Điện, Nước, …) */
  meterType: string;
  /** Điện: cấp điện áp, đơn giá 3 khung (+ Không xác định) và khung giá tùy chỉnh mở rộng. */
  electricity?: {
    voltageLevel: string;
    prices: { normal: string; off: string; peak: string; none: string };
    slots: CostTemplateSlot[];
  };
  /** Loại khác: khung giờ và đơn giá. */
  bands?: UtilityBand[];
};

function text(value: unknown) {
  return typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function normalizeCostTemplates(payload: unknown): CostTemplate[] {
  const list = record(payload).templates;
  if (!Array.isArray(list)) return [];
  return list
    .map((raw) => {
      const item = record(raw);
      const electricity = record(item.electricity);
      const prices = record(electricity.prices);
      const template: CostTemplate = {
        id: text(item.id).trim(),
        name: text(item.name).trim(),
        meterType: text(item.meterType).trim(),
      };
      if (item.electricity) {
        template.electricity = {
          voltageLevel: text(electricity.voltageLevel),
          prices: { normal: text(prices.normal), off: text(prices.off), peak: text(prices.peak), none: text(prices.none) },
          slots: (Array.isArray(electricity.slots) ? electricity.slots : []).map((slotRaw, index) => {
            const slot = record(slotRaw);
            return {
              id: text(slot.id) || `slot-${index + 1}`,
              name: text(slot.name),
              color: text(slot.color) || "#64748b",
              from: text(slot.from),
              to: text(slot.to),
              price: text(slot.price),
            };
          }),
        };
      }
      if (Array.isArray(item.bands)) {
        template.bands = item.bands.map((bandRaw, index) => {
          const band = record(bandRaw);
          return {
            id: text(band.id) || `band-${index + 1}`,
            label: text(band.label),
            from: text(band.from),
            to: text(band.to),
            price: text(band.price),
          };
        });
      }
      return template;
    })
    .filter((item) => item.id && item.name && item.meterType);
}

export async function loadCostTemplates() {
  return normalizeCostTemplates(await dbFetch<unknown>("cost-library"));
}

export async function saveCostTemplates(templates: CostTemplate[]) {
  const saved = await dbFetch<unknown>("cost-library", {
    method: "POST",
    body: JSON.stringify({ templates }),
  });
  emitDbChange("cost-library");
  return normalizeCostTemplates(saved);
}
