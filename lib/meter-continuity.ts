/**
 * Chỉ số điện năng liên tục khi thay đồng hồ / đồng hồ reset về 0.
 *
 * Điện năng tiêu thụ = chỉ số cuối − chỉ số đầu. Khi thay đồng hồ, chỉ số đồng hồ mới bắt đầu lại từ 0
 * (hoặc một số bất kỳ) nên phép trừ đó ra âm / mất phần điện của khung có thay. Module này ghép các
 * đoạn chỉ số của một điểm đo thành MỘT chuỗi liên tục ("chỉ số quy đổi"): mỗi lần thay đồng hồ, đoạn sau
 * được cộng thêm một độ lệch để nối tiếp đúng chỗ đoạn trước dừng lại. Mọi biểu đồ / báo cáo phía client
 * vẫn chỉ lấy "cuối − đầu" như cũ và tự ra đúng.
 *
 * Hai nguồn mốc thay đồng hồ:
 * 1. Biên bản thay đồng hồ (meter_point_history): thời điểm thay, chỉ số chốt đồng hồ cũ, chỉ số ban đầu đồng hồ mới.
 *    Điện năng của khung thay = (chốt cũ − lần đọc cuối của đồng hồ cũ) + (lần đọc đầu của đồng hồ mới − chỉ số ban đầu).
 * 2. Tự phát hiện: chỉ số tụt mạnh và KHÔNG hồi lại mức cũ (khác bản tin nhiễu / test tụt rồi nhảy về ngay).
 *    Không biết chỉ số chốt nên nối tiếp từ lần đọc đầu tiên của đồng hồ mới (không cộng phần điện chưa đo được).
 *
 * Mọi thời gian là giờ tường UTC "YYYY-MM-DD HH:MM:SS" (cùng định dạng với received_at / valid_from).
 */

/** Một khung chỉ số (thường là khung 15 phút của bảng tổng hợp) của một đồng hồ. */
export type RegisterEntry = {
  /** Đầu khung (UTC). */
  at: string;
  /** Khoá gom nhóm kết quả (ngày / khung giờ Việt Nam). */
  key: string;
  first: number;
  last: number;
  meterId: string;
  /** Thứ tự đoạn lịch sử gán đồng hồ của điểm đo (0 = cũ nhất). */
  segment: number;
};

/** Mốc thay đồng hồ giữa đoạn `toSegment - 1` và `toSegment`. */
export type MeterSwapEvent = {
  at: string;
  toSegment: number;
  /** Đồng hồ mới dùng lại serial cũ: dữ liệu cùng một mã đồng hồ, phải tìm chỗ chỉ số tụt quanh mốc thay. */
  sameMeter: boolean;
  /** Chỉ số chốt đồng hồ cũ (null = lấy lần đọc cuối). */
  finalIndex: number | null;
  /** Chỉ số ban đầu đồng hồ mới (null = lấy lần đọc đầu). */
  initialIndex: number | null;
};

export type NormalizedEntry = RegisterEntry & {
  /** Chỉ số quy đổi (liên tục) — dùng để tính điện năng. */
  vFirst: number;
  vLast: number;
  /** Chỉ số thực trên mặt đồng hồ — dùng để hiển thị (đã áp chỉ số chốt / ban đầu của biên bản). */
  rFirst: number;
  rLast: number;
};

export type DetectedReset = {
  /** Đầu khung có chỉ số tụt (UTC). */
  at: string;
  meterId: string;
  /** Chỉ số trước khi tụt / sau khi tụt. */
  before: number;
  after: number;
};

/** Tụt quá mức này (kWh) mới xét là đổi đồng hồ / reset. */
const DROP_MIN_KWH = 1;
/** Sau khi tụt, xét tiếp trong 24 giờ: còn quay lại mức cũ thì chỉ là bản tin nhiễu. */
const CONFIRM_WINDOW_MS = 24 * 3600_000;
/** Biên bản ghi giờ thay lệch với dữ liệu thực tế: tìm chỗ chỉ số tụt trong ±24 giờ quanh mốc. */
const EVENT_SEARCH_MS = 24 * 3600_000;

function wallMs(wall: string) {
  return Date.parse(`${wall.slice(0, 19).replace(" ", "T")}Z`);
}

/**
 * Từ khung `from` trở đi (trong 24 giờ) chỉ số KHÔNG quay lại `level` — tức là chỉ số tụt thật, không phải nhiễu.
 * `minCount`: cần ít nhất ngần ấy khung để khẳng định (khung cuối dòng dữ liệu chưa đủ căn cứ).
 */
function staysBelow(entries: RegisterEntry[], from: number, level: number, minCount: number) {
  const startMs = wallMs(entries[Math.max(0, from - 1)]?.at ?? entries[from]?.at ?? "");
  let count = 0;
  for (let i = from; i < entries.length; i++) {
    const entry = entries[i];
    if (Number.isFinite(startMs) && wallMs(entry.at) - startMs > CONFIRM_WINDOW_MS) break;
    if (entry.first >= level - DROP_MIN_KWH || entry.last >= level - DROP_MIN_KWH) return false;
    count += 1;
  }
  return count >= minCount;
}

type Placement = { kind: "between" | "intra"; event: MeterSwapEvent };

/** Gắn mỗi mốc thay đồng hồ vào đúng khung dữ liệu: giữa hai khung ("between") hay bên trong một khung ("intra"). */
function placeEvents(entries: RegisterEntry[], events: MeterSwapEvent[], windowStart: string) {
  const placements = new Map<number, Placement>();
  for (const event of events) {
    const eventMs = wallMs(event.at);
    if (!Number.isFinite(eventMs)) continue;
    let index = -1;
    let kind: Placement["kind"] = "between";
    if (event.sameMeter) {
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let i = 0; i < entries.length; i++) {
        const distance = Math.abs(wallMs(entries[i].at) - eventMs);
        if (distance > EVENT_SEARCH_MS || distance >= bestDistance) continue;
        const previous = entries[i - 1];
        if (previous && entries[i].first < previous.last - DROP_MIN_KWH && staysBelow(entries, i, previous.last, 1)) {
          index = i;
          kind = "between";
          bestDistance = distance;
        } else if (entries[i].last < entries[i].first - DROP_MIN_KWH && staysBelow(entries, i + 1, entries[i].first, 0)) {
          index = i;
          kind = "intra";
          bestDistance = distance;
        }
      }
    }
    if (index < 0) {
      // Đồng hồ khác serial (hoặc không thấy chỗ tụt): mốc thay là khung đầu tiên của đoạn mới.
      index = entries.findIndex((entry) => entry.segment >= event.toSegment);
      kind = "between";
      // Mốc thay nằm trước cửa sổ đang xem: khung đầu cửa sổ không phải lần đọc đầu của đồng hồ mới.
      if (index === 0 && event.at < windowStart) index = -1;
    }
    if (index >= 0 && !placements.has(index)) placements.set(index, { kind, event });
  }
  return placements;
}

/**
 * Ghép các khung chỉ số của MỘT điểm đo (đã sắp theo đoạn rồi theo thời gian) thành chuỗi liên tục.
 * `windowStart`: đầu cửa sổ truy vấn (UTC) — mốc thay trước đó không áp chỉ số ban đầu.
 */
export function normalizeRegisterStream(
  entries: RegisterEntry[],
  events: MeterSwapEvent[],
  windowStart: string,
): { entries: NormalizedEntry[]; detected: DetectedReset[] } {
  const placements = placeEvents(entries, events, windowStart);
  const detected: DetectedReset[] = [];
  const out: NormalizedEntry[] = [];
  let offset = 0;
  let previousRaw: number | null = null;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const placement = placements.get(i);
    let vFirst: number;
    let vLast: number;
    let rFirst = entry.first;

    if (placement?.kind === "between") {
      const { finalIndex, initialIndex } = placement.event;
      const startNew = initialIndex != null && initialIndex <= entry.first ? initialIndex : entry.first;
      if (previousRaw != null) {
        const endOld = finalIndex != null && finalIndex >= previousRaw ? finalIndex : previousRaw;
        const previousOut = out[out.length - 1];
        previousOut.vLast = endOld + offset;
        previousOut.rLast = endOld;
        offset = endOld + offset - startNew;
      }
      rFirst = startNew;
      vFirst = startNew + offset;
      vLast = entry.last + offset;
    } else if (placement?.kind === "intra") {
      // Thay đồng hồ ngay trong khung: phần đầu khung là đồng hồ cũ, phần sau là đồng hồ mới.
      const { finalIndex, initialIndex } = placement.event;
      vFirst = entry.first + offset;
      const endOld = finalIndex != null && finalIndex >= entry.first ? finalIndex : entry.first;
      const startNew = initialIndex != null && initialIndex <= entry.last ? initialIndex : entry.last;
      offset = endOld + offset - startNew;
      vLast = entry.last + offset;
    } else {
      if (
        previousRaw != null &&
        entry.first < previousRaw - DROP_MIN_KWH &&
        staysBelow(entries, i, previousRaw, 2)
      ) {
        detected.push({ at: entry.at, meterId: entry.meterId, before: previousRaw, after: entry.first });
        offset = previousRaw + offset - entry.first;
      }
      vFirst = entry.first + offset;
      if (entry.last < entry.first - DROP_MIN_KWH && staysBelow(entries, i + 1, entry.first, 1)) {
        detected.push({ at: entry.at, meterId: entry.meterId, before: entry.first, after: entry.last });
        offset = entry.first + offset - entry.last;
      }
      vLast = entry.last + offset;
    }

    out.push({ ...entry, vFirst, vLast, rFirst, rLast: entry.last });
    previousRaw = entry.last;
  }
  return { entries: out, detected };
}

/** Gom các khung đã chuẩn hoá theo `key` (ngày / khung giờ), giữ thứ tự xuất hiện. */
export function aggregateNormalized(entries: NormalizedEntry[]) {
  const groups = new Map<
    string,
    { firstWh: number; lastWh: number; rawFirstWh: number; rawLastWh: number; meterId: string }
  >();
  for (const entry of entries) {
    const group = groups.get(entry.key);
    if (!group) {
      groups.set(entry.key, {
        firstWh: entry.vFirst,
        lastWh: entry.vLast,
        rawFirstWh: entry.rFirst,
        rawLastWh: entry.rLast,
        meterId: entry.meterId,
      });
    } else {
      group.lastWh = entry.vLast;
      group.rawLastWh = entry.rLast;
      group.meterId = entry.meterId;
    }
  }
  return groups;
}
