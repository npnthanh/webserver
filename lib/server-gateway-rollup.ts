import "server-only";
import type { RowDataPacket } from "mysql2";
import { emsDb, queryRows } from "@/lib/server-db";

/**
 * Bảng tổng hợp 15 phút cho dữ liệu gateway (gateway_rollup_15m), để biểu đồ tháng/năm, điện năng theo ngày,
 * slot giờ, chi phí, báo cáo... không phải quét hàng trăm nghìn mẫu thô mỗi lần mở trang.
 *
 * - Cập nhật cộng dồn theo id mẫu (watermark): mỗi lượt chỉ xử lý mẫu mới; mẫu gửi bù vào khung giờ cũ
 *   cũng có id mới nên khung đó được tính lại.
 * - Lần đầu tự xử lý dần toàn bộ dữ liệu cũ. Khi chưa xong, `isRollupReady()` = false để các truy vấn
 *   dùng lại cách tính trên dữ liệu thô (không hụt số liệu).
 * - Mọi thời gian là "giờ tường" UTC như cột gateway_samples.received_at.
 */

export const ROLLUP_SECONDS = 900;
const BATCH_ROWS = 5000;
const STATE_WATERMARK = "rollup_watermark";
const STATE_CAUGHT_UP = "rollup_caught_up";

/** Số ngày giữ mẫu thô (15 giây/mẫu). Dữ liệu cũ hơn chỉ còn ở bảng tổng hợp. */
export const RAW_RETENTION_DAYS = Math.max(14, Number(process.env.GATEWAY_RAW_RETENTION_DAYS) || 90);
/** Số ngày giữ nhật ký gói tin / log gateway. */
const LOG_RETENTION_DAYS = Math.max(7, Number(process.env.GATEWAY_LOG_RETENTION_DAYS) || 30);

let schemaReady: Promise<void> | null = null;
let readyCache: { value: boolean; at: number } = { value: false, at: 0 };
let lastRetentionAt = 0;

export function ensureRollupSchema() {
  schemaReady ??= (async () => {
    await emsDb.query(
      `CREATE TABLE IF NOT EXISTS gateway_rollup_15m (
        meter_id BIGINT UNSIGNED NOT NULL,
        bucket_start DATETIME NOT NULL,
        sample_count INT UNSIGNED NOT NULL,
        first_at DATETIME(3) NOT NULL,
        last_at DATETIME(3) NOT NULL,
        epaed_first DECIMAL(18,6) NULL,
        epaed_last DECIMAL(18,6) NULL,
        values_last LONGTEXT NULL,
        PRIMARY KEY (meter_id, bucket_start)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );
    await emsDb.query(
      `CREATE TABLE IF NOT EXISTS gateway_rollup_state (
        name VARCHAR(64) NOT NULL,
        value VARCHAR(64) NOT NULL,
        PRIMARY KEY (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );
    // Chỉ mục cho truy vấn theo đồng hồ + thời gian (chỉ mục cũ bắt đầu bằng meter_model nên không dùng được)
    // và cho việc dọn dữ liệu theo thời gian. InnoDB thêm chỉ mục trực tuyến, không chặn ghi.
    await emsDb
      .query("ALTER TABLE gateway_samples ADD INDEX idx_gateway_sample_meter_time (meter_id, received_at)")
      .catch(() => undefined);
    await emsDb
      .query("ALTER TABLE gateway_samples ADD INDEX idx_gateway_sample_time (received_at)")
      .catch(() => undefined);
    await emsDb
      .query("ALTER TABLE gateway_meter_latest ADD INDEX idx_gateway_latest_meter (meter_id)")
      .catch(() => undefined);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

/* ---------------- tiện ích thời gian (giờ tường UTC) ---------------- */

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

/** DATETIME từ mysql2 (Date theo giờ máy) hoặc chuỗi → "YYYY-MM-DD HH:MM:SS.mmm" đúng như lưu trong DB. */
function wallTime(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(
      value.getMinutes(),
    )}:${pad(value.getSeconds())}.${pad(value.getMilliseconds(), 3)}`;
  }
  const text = String(value ?? "").replace("T", " ").replace("Z", "");
  return text.length >= 19 ? text : "";
}

function bucketOf(wall: string) {
  const minute = Number(wall.slice(14, 16));
  return `${wall.slice(0, 14)}${pad(minute - (minute % 15))}:00`;
}

function wallToMs(wall: string) {
  return Date.parse(`${wall.slice(0, 19).replace(" ", "T")}Z`);
}

function msToWall(ms: number) {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function parseValues(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(raw ?? "{}"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function positiveEpaed(values: Record<string, unknown>) {
  const value = Number(values.EPaed);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/* ---------------- trạng thái ---------------- */

async function readState(name: string) {
  const rows = await queryRows<RowDataPacket>("SELECT value FROM gateway_rollup_state WHERE name = ? LIMIT 1", [name]);
  return rows[0] ? String(rows[0].value) : null;
}

async function writeState(name: string, value: string) {
  await emsDb.execute(
    "INSERT INTO gateway_rollup_state (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
    [name, value],
  );
}

/** Bảng tổng hợp đã theo kịp dữ liệu thô chưa (cache 60 giây). */
export async function isRollupReady() {
  if (Date.now() - readyCache.at < 60_000) return readyCache.value;
  try {
    await ensureRollupSchema();
    readyCache = { value: (await readState(STATE_CAUGHT_UP)) === "1", at: Date.now() };
  } catch {
    readyCache = { value: false, at: Date.now() };
  }
  return readyCache.value;
}

/* ---------------- cập nhật tổng hợp ---------------- */

type BucketAgg = {
  count: number;
  firstAt: string;
  lastAt: string;
  epaedFirst: number | null;
  epaedLast: number | null;
  valuesLast: string;
};

/** Tính lại toàn bộ các khung 15 phút của một đồng hồ trong khoảng [startWall, endWall). */
async function recomputeRange(meterId: string, startWall: string, endWall: string) {
  const rows = await queryRows<RowDataPacket>(
    `SELECT received_at, values_json
       FROM gateway_samples
      WHERE meter_id = ? AND received_at >= ? AND received_at < ?
      ORDER BY received_at ASC, id ASC`,
    [meterId, startWall, endWall],
  );
  const buckets = new Map<string, BucketAgg>();
  for (const row of rows) {
    const wall = wallTime(row.received_at);
    if (!wall) continue;
    const key = bucketOf(wall);
    const values = parseValues(row.values_json);
    const epaed = positiveEpaed(values);
    const agg = buckets.get(key);
    if (!agg) {
      buckets.set(key, {
        count: 1,
        firstAt: wall,
        lastAt: wall,
        epaedFirst: epaed,
        epaedLast: epaed,
        valuesLast: JSON.stringify(values),
      });
      continue;
    }
    agg.count += 1;
    agg.lastAt = wall;
    agg.valuesLast = JSON.stringify(values);
    if (epaed != null) {
      if (agg.epaedFirst == null) agg.epaedFirst = epaed;
      agg.epaedLast = epaed;
    }
  }
  const entries = [...buckets.entries()];
  for (let i = 0; i < entries.length; i += 200) {
    const chunk = entries.slice(i, i + 200);
    await emsDb.execute(
      `INSERT INTO gateway_rollup_15m
         (meter_id, bucket_start, sample_count, first_at, last_at, epaed_first, epaed_last, values_last)
       VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(",")}
       ON DUPLICATE KEY UPDATE sample_count = VALUES(sample_count), first_at = VALUES(first_at),
         last_at = VALUES(last_at), epaed_first = VALUES(epaed_first), epaed_last = VALUES(epaed_last),
         values_last = VALUES(values_last)`,
      chunk.flatMap(([bucket, agg]) => [
        meterId,
        bucket,
        agg.count,
        agg.firstAt,
        agg.lastAt,
        agg.epaedFirst,
        agg.epaedLast,
        agg.valuesLast,
      ]),
    );
  }
}

/** Xử lý mẫu mới theo watermark trong giới hạn thời gian; trả về số mẫu đã xử lý. */
export async function processRollups(budgetMs = 20_000) {
  await ensureRollupSchema();
  const started = Date.now();
  let processed = 0;
  while (Date.now() - started < budgetMs) {
    const watermark = Number((await readState(STATE_WATERMARK)) ?? 0) || 0;
    const rows = await queryRows<RowDataPacket>(
      `SELECT id, meter_id, received_at FROM gateway_samples WHERE id > ? ORDER BY id ASC LIMIT ${BATCH_ROWS}`,
      [watermark],
    );
    if (!rows.length) {
      await writeState(STATE_CAUGHT_UP, "1");
      readyCache = { value: true, at: Date.now() };
      break;
    }

    // Các khung 15 phút bị ảnh hưởng của từng đồng hồ → gom thành các đoạn liên tiếp (≤ 1 ngày) để tính lại.
    const byMeter = new Map<string, Set<string>>();
    for (const row of rows) {
      const wall = wallTime(row.received_at);
      if (!wall) continue;
      const meterId = String(row.meter_id);
      const set = byMeter.get(meterId) ?? new Set<string>();
      set.add(bucketOf(wall));
      byMeter.set(meterId, set);
    }
    for (const [meterId, set] of byMeter) {
      const buckets = [...set].sort();
      let rangeStart = buckets[0];
      let rangeEnd = buckets[0];
      for (const bucket of buckets.slice(1)) {
        if (wallToMs(bucket) - wallToMs(rangeEnd) <= 24 * 3600_000) {
          rangeEnd = bucket;
          continue;
        }
        await recomputeRange(meterId, rangeStart, msToWall(wallToMs(rangeEnd) + ROLLUP_SECONDS * 1000));
        rangeStart = bucket;
        rangeEnd = bucket;
      }
      await recomputeRange(meterId, rangeStart, msToWall(wallToMs(rangeEnd) + ROLLUP_SECONDS * 1000));
    }

    const lastId = String(rows[rows.length - 1].id);
    await writeState(STATE_WATERMARK, lastId);
    processed += rows.length;
    if (rows.length < BATCH_ROWS) {
      await writeState(STATE_CAUGHT_UP, "1");
      readyCache = { value: true, at: Date.now() };
      break;
    }
  }
  return processed;
}

/* ---------------- dọn dữ liệu cũ ---------------- */

async function deleteInBatches(sql: string, params: unknown[], budgetEnd: number) {
  let total = 0;
  while (Date.now() < budgetEnd) {
    const [result] = await emsDb.execute(sql, params as never);
    const affected = Number((result as { affectedRows?: number }).affectedRows ?? 0);
    total += affected;
    if (affected < 5000) break;
  }
  return total;
}

/** Xóa mẫu thô cũ (đã được tổng hợp) và nhật ký gói tin cũ. Chạy tối đa mỗi giờ một lần. */
export async function runRetention(budgetMs = 15_000) {
  if (Date.now() - lastRetentionAt < 3600_000) return;
  lastRetentionAt = Date.now();
  try {
    await ensureRollupSchema();
    const budgetEnd = Date.now() + budgetMs;
    const watermark = Number((await readState(STATE_WATERMARK)) ?? 0) || 0;
    const rawCutoff = msToWall(Date.now() - RAW_RETENTION_DAYS * 86_400_000);
    if (watermark > 0) {
      await deleteInBatches(
        "DELETE FROM gateway_samples WHERE received_at < ? AND id <= ? LIMIT 5000",
        [rawCutoff, watermark],
        budgetEnd,
      );
    }
    const logCutoffIso = new Date(Date.now() - LOG_RETENTION_DAYS * 86_400_000).toISOString();
    await deleteInBatches("DELETE FROM gateway_packets WHERE received_at < ? LIMIT 5000", [logCutoffIso], budgetEnd);
    await deleteInBatches("DELETE FROM gateway_logs WHERE received_at < ? LIMIT 5000", [logCutoffIso], budgetEnd);
  } catch (error) {
    console.error("[rollup] retention failed", error);
  }
}

/* ---------------- đọc tổng hợp ---------------- */

export type RollupBucket = {
  bucketStart: string;
  lastAt: string;
  count: number;
  epaedFirst: number | null;
  epaedLast: number | null;
  valuesLast: Record<string, unknown>;
};

/** Các khung 15 phút của một đồng hồ trong [startWall, endWall). */
export async function loadRollupBuckets(
  meterId: string,
  startWall: string,
  endWall: string,
  options?: { withValues?: boolean },
): Promise<RollupBucket[]> {
  await ensureRollupSchema();
  const rows = await queryRows<RowDataPacket>(
    `SELECT bucket_start, last_at, sample_count, epaed_first, epaed_last${options?.withValues ? ", values_last" : ""}
       FROM gateway_rollup_15m
      WHERE meter_id = ? AND bucket_start >= ? AND bucket_start < ?
      ORDER BY bucket_start ASC`,
    [meterId, bucketOf(wallTime(startWall) || startWall), endWall],
  );
  return rows.map((row) => ({
    bucketStart: wallTime(row.bucket_start).slice(0, 19),
    lastAt: wallTime(row.last_at),
    count: Number(row.sample_count) || 0,
    epaedFirst: row.epaed_first == null ? null : Number(row.epaed_first),
    epaedLast: row.epaed_last == null ? null : Number(row.epaed_last),
    valuesLast: options?.withValues ? parseValues(row.values_last) : {},
  }));
}

/** Giờ tường UTC "YYYY-MM-DD HH:MM:SS" → ngày giờ Việt Nam { day, hour, minute }. */
export function vietnamParts(wall: string) {
  const ms = wallToMs(wall) + 7 * 3600_000;
  const iso = new Date(ms).toISOString();
  return { day: iso.slice(0, 10), hour: Number(iso.slice(11, 13)), minute: Number(iso.slice(14, 16)) };
}

export function rawRetentionCutoffWall() {
  return msToWall(Date.now() - RAW_RETENTION_DAYS * 86_400_000);
}
