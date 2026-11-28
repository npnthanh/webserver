/**
 * Khung giờ tính chi phí cho loại điểm đo không phải điện (Nước, Khí nén, Hơi, …).
 * Mỗi khung: giờ bắt đầu – giờ kết thúc (giờ Việt Nam) và đơn giá riêng. Một khung 00:00–24:00 = giá cố định.
 * Khung có giờ kết thúc nhỏ hơn giờ bắt đầu là khung qua đêm (VD 22:00–04:00).
 */
export type UtilityBand = {
  id: string;
  label: string;
  /** "HH:MM" */
  from: string;
  /** "HH:MM", "24:00" = hết ngày */
  to: string;
  /** Đơn giá dạng chuỗi như ô nhập (VD "12,500") */
  price: string;
};

export function defaultUtilityBands(price = ""): UtilityBand[] {
  return [{ id: "band-all", label: "Cả ngày", from: "00:00", to: "24:00", price }];
}

function minuteOf(text: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute > 0)) return null;
  return hour * 60 + minute;
}

/** Các phút [start, end) trong ngày mà khung bao phủ (khung qua đêm tách làm 2 đoạn). */
function bandRanges(band: UtilityBand): Array<[number, number]> {
  const from = minuteOf(band.from);
  const to = minuteOf(band.to);
  if (from === null || to === null || from === to) return [];
  return from < to ? [[from, to]] : [[from, 1440], [0, to]];
}

/** Khung giờ chứa phút `minuteOfDay` (0–1439); khung đứng trước được ưu tiên khi chồng nhau. */
export function bandAtMinute(bands: UtilityBand[], minuteOfDay: number): UtilityBand | null {
  for (const band of bands) {
    if (bandRanges(band).some(([start, end]) => minuteOfDay >= start && minuteOfDay < end)) return band;
  }
  return null;
}

function hhmm(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Kiểm tra khung giờ: giờ sai định dạng, khoảng chưa có khung, khoảng bị trùng. */
export function bandIssues(bands: UtilityBand[]) {
  const invalid = bands.filter((band) => bandRanges(band).length === 0).map((band) => band.label || band.id);
  const cover = new Array<number>(1440).fill(0);
  for (const band of bands) {
    for (const [start, end] of bandRanges(band)) for (let m = start; m < end; m++) cover[m] += 1;
  }
  const spans = (test: (count: number) => boolean) => {
    const result: string[] = [];
    let start = -1;
    for (let m = 0; m <= 1440; m++) {
      const hit = m < 1440 && test(cover[m]);
      if (hit && start < 0) start = m;
      if (!hit && start >= 0) {
        result.push(`${hhmm(start)}–${hhmm(m)}`);
        start = -1;
      }
    }
    return result;
  };
  return { invalid, gaps: spans((count) => count === 0), overlaps: spans((count) => count > 1) };
}

function parsePrice(text: string) {
  const value = Number(String(text).replace(/[,\s]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

/** Khung giờ đã lưu của một loại; chưa có thì 1 khung cả ngày theo đơn giá cố định cũ (flatPrices). */
export function readUtilityBands(costConfig: unknown, utility: string): UtilityBand[] {
  const source = costConfig && typeof costConfig === "object" ? (costConfig as Record<string, unknown>) : {};
  const all = source.utilityBands;
  const raw = all && typeof all === "object" && !Array.isArray(all) ? (all as Record<string, unknown>)[utility] : null;
  if (Array.isArray(raw)) {
    const bands = raw
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item, index) => ({
        id: typeof item.id === "string" && item.id ? item.id : `band-${index + 1}`,
        label: typeof item.label === "string" ? item.label : `Khung ${index + 1}`,
        from: typeof item.from === "string" ? item.from : "00:00",
        to: typeof item.to === "string" ? item.to : "24:00",
        price: typeof item.price === "string" ? item.price : String(item.price ?? ""),
      }));
    if (bands.length) return bands;
  }
  const flat = source.flatPrices && typeof source.flatPrices === "object" ? (source.flatPrices as Record<string, unknown>)[utility] : "";
  return defaultUtilityBands(typeof flat === "string" ? flat : flat == null ? "" : String(flat));
}

/** Đơn giá (số) của khung chứa thời điểm (giờ, phút Việt Nam); không thuộc khung nào = null. */
export function priceAt(bands: UtilityBand[], hour: number, minute: number) {
  const band = bandAtMinute(bands, hour * 60 + minute);
  return band ? { band, price: parsePrice(band.price) } : null;
}

export { parsePrice as parseBandPrice };
