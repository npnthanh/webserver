import { formatAppNumber, parseAppNumber } from "@/lib/number-format";

/** Biểu giá điện sản xuất, Quyết định 1279/QĐ-BCT ngày 09/05/2025. Chưa gồm VAT. */
export const INDUSTRIAL_TARIFF_DECISION = "1279/QĐ-BCT ngày 09/05/2025";
/** Khung giờ sử dụng điện, Quyết định 963/QĐ-BCT năm 2026. */
export const INDUSTRIAL_SCHEDULE_DECISION = "963/QĐ-BCT năm 2026";

export const INDUSTRIAL_VOLTAGE_LEVELS = [
  { id: "kv110", label: "Từ 110 kV trở lên", normal: 1811, off: 1146, peak: 3266 },
  { id: "kv22", label: "Từ 22 đến dưới 110 kV", normal: 1833, off: 1190, peak: 3398 },
  { id: "kv6", label: "Từ 6 đến dưới 22 kV", normal: 1899, off: 1234, peak: 3508 },
  { id: "kv-under-6", label: "Dưới 6 kV", normal: 1987, off: 1300, peak: 3640 },
] as const;

export type VoltageLevelId = (typeof INDUSTRIAL_VOLTAGE_LEVELS)[number]["id"];
export type TouBand = "normal" | "off" | "peak";

export type TouPrices = Record<TouBand, number>;

export const DEFAULT_VOLTAGE_LEVEL: VoltageLevelId = "kv-under-6";

export function voltageLevelById(id: string | undefined) {
  return INDUSTRIAL_VOLTAGE_LEVELS.find((level) => level.id === id) ?? INDUSTRIAL_VOLTAGE_LEVELS[3];
}

export function formatTariffPrice(value: number) {
  return formatAppNumber(value, { maxDecimals: 3 });
}

export function parseTariffPrice(value: unknown) {
  return parseAppNumber(value, 0);
}

export function pricesForLevel(id: string | undefined): TouPrices {
  const level = voltageLevelById(id);
  return { normal: level.normal, off: level.off, peak: level.peak };
}

export function resolveTouPrices(
  voltageLevel: string | undefined,
  raw?: Partial<Record<TouBand, unknown>>,
): { levelId: VoltageLevelId; prices: TouPrices } {
  const level = voltageLevelById(voltageLevel);
  const official = pricesForLevel(level.id);
  const pick = (band: TouBand) => {
    const text = raw?.[band];
    if (text == null || String(text).trim() === "") return official[band];
    const parsed = parseTariffPrice(text);
    return parsed > 0 ? parsed : official[band];
  };
  const n = pick("normal");
  const o = pick("off");
  const p = pick("peak");
  // Nếu dữ liệu cũ đang lưu giá trị test 1 đ/kWh cho cả 3 khung thì dùng biểu giá chuẩn EVN theo cấp điện áp
  if (n === 1 && o === 1 && p === 1) {
    return { levelId: level.id, prices: official };
  }
  return {
    levelId: level.id,
    prices: { normal: n, off: o, peak: p },
  };
}

export type CustomTariffSlot = {
  id: string;
  name: string;
  color: string;
  /** Giờ bắt đầu HH:mm */
  from: string;
  /** Giờ kết thúc HH:mm */
  to: string;
  /** Đơn giá đ/kWh */
  price: string;
  /** Nhóm quy đổi biểu đồ (peak / normal / off) */
  bandGroup?: TouBand;
  /** Có áp dụng Chủ nhật không (mặc định true trừ khung Cao điểm) */
  applySunday?: boolean;
};

export type TariffHistoryEntry = {
  id?: string;
  /** Ngày bắt đầu hiệu lực YYYY-MM-DD */
  applyDate: string;
  note?: string;
  voltageLevel: VoltageLevelId;
  prices: Record<TouBand, string>;
  /** Nếu có danh sách khung giờ tùy chỉnh (ví dụ 4 khung giá) thì ưu tiên tính theo slots */
  slots?: CustomTariffSlot[];
};

export type SavedElectricityCostConfig = {
  utility?: string;
  applyDate?: string;
  slots?: CustomTariffSlot[];
  flatPrices?: Record<string, string>;
  electricity?: {
    voltageLevel?: string;
    prices?: Partial<Record<TouBand, unknown>>;
  };
  tariffHistory?: TariffHistoryEntry[];
};

function parseHmMinutes(hm: string, isEnd = false) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return isEnd ? 24 * 60 : 0;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 24 && min === 0) return 24 * 60;
  return Math.max(0, Math.min(24 * 60, h * 60 + min));
}

function normalizeDateKey(input: string | undefined): string {
  if (!input) return "";
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  return "";
}

/**
 * Tra cứu đơn giá & khung giờ điện tại thời điểm `parts` (hỗ trợ đổi từ 3 khung giá sang 4+ khung giá từ ngày hiệu lực `applyDate`).
 */
export function resolveElectricityRateAt(
  config: SavedElectricityCostConfig | undefined,
  parts: { year: number; month: number; day: number; hour: number; minute: number; date?: string },
): { price: number; band: TouBand; slotName?: string } {
  const dayKey =
    parts.date ??
    `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const weekday = civilWeekday(parts.year, parts.month, parts.day);
  const minuteOfDay = parts.hour * 60 + parts.minute;

  // 1. Kiểm tra lịch sử biểu giá theo ngày hiệu lực (tariffHistory)
  const history = Array.isArray(config?.tariffHistory) ? config!.tariffHistory : [];
  if (history.length > 0) {
    const sorted = [...history]
      .map((item) => ({ ...item, normDate: normalizeDateKey(item.applyDate) || "0000-01-01" }))
      .sort((a, b) => a.normDate.localeCompare(b.normDate));
    let active = sorted[0];
    for (const entry of sorted) {
      if (entry.normDate <= dayKey) active = entry;
    }
    if (active.slots && active.slots.length > 0) {
      const matched = matchCustomSlot(active.slots, weekday, minuteOfDay);
      if (matched) return matched;
    }
    const resolved = resolveTouPrices(active.voltageLevel, active.prices);
    const band = industrialBand(weekday, parts.hour, parts.minute);
    return { price: resolved.prices[band], band };
  }

  // 2. Nếu có cấu hình slots tùy chỉnh (ví dụ 4 khung giờ) và ngày hiện tại >= applyDate (hoặc không đặt applyDate)
  const configApplyDate = normalizeDateKey(config?.applyDate);
  const customSlots = Array.isArray(config?.slots) ? config!.slots : [];
  if (customSlots.length > 0 && (!configApplyDate || dayKey >= configApplyDate)) {
    const matched = matchCustomSlot(customSlots, weekday, minuteOfDay);
    if (matched) return matched;
  }

  // 3. Mặc định dùng biểu giá 3 khung chuẩn EVN
  const baseTou = resolveTouPrices(config?.electricity?.voltageLevel, config?.electricity?.prices);
  const band = industrialBand(weekday, parts.hour, parts.minute);
  return { price: baseTou.prices[band], band };
}

function matchCustomSlot(
  slots: CustomTariffSlot[],
  weekday: number,
  minuteOfDay: number,
): { price: number; band: TouBand; slotName: string } | null {
  for (const slot of slots) {
    const price = parseTariffPrice(slot.price);
    if (price <= 0) continue;
    const isPeakLike =
      slot.bandGroup === "peak" || /cao\s*điểm/i.test(slot.name);
    const applySun = slot.applySunday ?? !isPeakLike;
    if (weekday === 0 && !applySun) continue;
    const startMin = parseHmMinutes(slot.from, false);
    const endMin = parseHmMinutes(slot.to, true);
    const inSlot =
      startMin <= endMin
        ? minuteOfDay >= startMin && minuteOfDay < endMin
        : minuteOfDay >= startMin || minuteOfDay < endMin;
    if (inSlot) {
      const band: TouBand =
        slot.bandGroup ??
        (/cao/i.test(slot.name) ? "peak" : /thấp/i.test(slot.name) ? "off" : "normal");
      return { price, band, slotName: slot.name };
    }
  }
  return null;
}

/** 0 = Chủ nhật … 6 = thứ Bảy, theo ngày dương lịch Việt Nam. */
export function civilWeekday(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Khung giờ điện công nghiệp.
 * Thấp điểm 00:00–06:00 mọi ngày.
 * Cao điểm 17:30–22:30 thứ Hai–thứ Bảy.
 * Chủ nhật từ 06:00 là giờ bình thường.
 */
export function industrialBand(weekday: number, hour: number, minute: number): TouBand {
  const minutes = hour * 60 + minute;
  if (minutes < 6 * 60) return "off";
  if (weekday === 0) return "normal";
  if (minutes >= 17 * 60 + 30 && minutes < 22 * 60 + 30) return "peak";
  return "normal";
}

/** T = A_bt×G_bt + A_td×G_td + A_cd×G_cd */
export function industrialEnergyCost(kwh: TouPrices, prices: TouPrices) {
  const normal = kwh.normal * prices.normal;
  const off = kwh.off * prices.off;
  const peak = kwh.peak * prices.peak;
  return { normal, off, peak, total: normal + off + peak };
}
