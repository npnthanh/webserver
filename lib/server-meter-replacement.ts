import "server-only";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { AuthSession } from "@/lib/auth";
import { emsDb, queryRows } from "@/lib/server-db";
import { ensureProjectEventsSchema } from "@/lib/server-project-events";
import type { DetectedReset } from "@/lib/meter-continuity";
import type { MeterReplacementState } from "@/lib/meter-replacement";

/**
 * Biên bản thay đồng hồ của điểm đo + các lần hệ thống nghi thay đồng hồ (chỉ số tụt không hồi lại).
 * Biên bản lưu ngay trong meter_point_history: dòng của đồng hồ cũ được đóng tại thời điểm thay
 * (valid_to + final_index = chỉ số chốt), dòng mới mở từ thời điểm đó (valid_from + initial_index = chỉ số ban đầu).
 * Thời gian trong DB là UTC; giao diện nhập / hiển thị giờ Việt Nam.
 */

/** Lỗi nghiệp vụ: route trả nguyên văn cho người dùng (HTTP 400). */
export class MeterReplacementError extends Error {}

const SCHEMA_VERSION = "2026-11-19-meter-replacement";
let schemaReady: Promise<void> | null = null;

export function ensureMeterReplacementSchema() {
  schemaReady ??= (async () => {
    await emsDb.query(
      `CREATE TABLE IF NOT EXISTS meter_point_history (
         id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
         project_id VARCHAR(64) NOT NULL,
         meter_point_id VARCHAR(100) NOT NULL,
         category VARCHAR(100) NULL,
         serial_number VARCHAR(100) NOT NULL,
         valid_from DATETIME NOT NULL DEFAULT '2020-01-01 00:00:00',
         valid_to DATETIME NULL,
         final_index DECIMAL(18,6) NULL,
         initial_index DECIMAL(18,6) NULL,
         replaced_by VARCHAR(100) NULL,
         recorded_at DATETIME NULL,
         PRIMARY KEY (id),
         KEY idx_mph_point (project_id, meter_point_id, valid_from)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );
    for (const column of [
      "final_index DECIMAL(18,6) NULL",
      "initial_index DECIMAL(18,6) NULL",
      "replaced_by VARCHAR(100) NULL",
      "recorded_at DATETIME NULL",
    ]) {
      await emsDb.query(`ALTER TABLE meter_point_history ADD COLUMN ${column}`).catch(() => undefined);
    }
    await emsDb.query(
      `CREATE TABLE IF NOT EXISTS meter_reset_suspects (
         id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
         project_id VARCHAR(64) NOT NULL,
         meter_point_id VARCHAR(100) NOT NULL,
         serial_number VARCHAR(100) NOT NULL,
         detected_at DATETIME NOT NULL,
         before_index DECIMAL(18,6) NOT NULL,
         after_index DECIMAL(18,6) NOT NULL,
         status VARCHAR(20) NOT NULL DEFAULT 'open',
         created_at DATETIME NOT NULL,
         PRIMARY KEY (id),
         KEY idx_mrs_point (project_id, meter_point_id, detected_at)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );
    await emsDb.query("INSERT IGNORE INTO schema_migrations (version) VALUES (?)", [SCHEMA_VERSION]).catch(() => undefined);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

/* ---------------- thời gian ---------------- */

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function msToWall(ms: number) {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function wallToMs(wall: string) {
  return Date.parse(`${wall.slice(0, 19).replace(" ", "T")}Z`);
}

/** "YYYY-MM-DDTHH:mm" giờ Việt Nam → giờ tường UTC. */
function vietnamInputToWall(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi) - 7 * 3600_000;
  return Number.isFinite(ms) ? msToWall(ms) : null;
}

/** Giờ tường UTC → "YYYY-MM-DD HH:mm" giờ Việt Nam. */
export function wallToVietnamText(wall: string) {
  const ms = wallToMs(wall);
  if (!Number.isFinite(ms)) return wall;
  return msToWall(ms + 7 * 3600_000).slice(0, 16);
}

function normalizeSerial(value: unknown) {
  return String(value ?? "").trim().replace(/^SN:\s*/i, "");
}

function serialVariants(serial: string) {
  return [serial, `SN: ${serial}`, `SN:${serial}`];
}

function optionalIndex(value: unknown, label: string) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new MeterReplacementError(`${label} phải là số không âm.`);
  }
  return Number(number.toFixed(6));
}

/* ---------------- đọc ---------------- */

export async function listMeterReplacements(projectId: string): Promise<MeterReplacementState> {
  await ensureMeterReplacementSchema();
  const [history, suspects] = await Promise.all([
    queryRows<RowDataPacket>(
      `SELECT id, meter_point_id AS meterPointId, serial_number AS serialNumber,
              DATE_FORMAT(valid_from, '%Y-%m-%d %H:%i:%s') AS validFrom,
              DATE_FORMAT(valid_to, '%Y-%m-%d %H:%i:%s') AS validTo,
              final_index AS finalIndex, initial_index AS initialIndex, replaced_by AS replacedBy
         FROM meter_point_history
        WHERE project_id = ?
        ORDER BY meter_point_id, valid_from ASC, id ASC`,
      [projectId],
    ),
    queryRows<RowDataPacket>(
      `SELECT id, meter_point_id AS meterPointId, serial_number AS serialNumber,
              DATE_FORMAT(detected_at, '%Y-%m-%d %H:%i:%s') AS detectedAt,
              before_index AS beforeIndex, after_index AS afterIndex
         FROM meter_reset_suspects
        WHERE project_id = ? AND status = 'open'
        ORDER BY detected_at DESC`,
      [projectId],
    ),
  ]);

  const byPoint = new Map<string, RowDataPacket[]>();
  for (const row of history) {
    const list = byPoint.get(String(row.meterPointId)) ?? [];
    list.push(row);
    byPoint.set(String(row.meterPointId), list);
  }
  const replacements: MeterReplacementState["replacements"] = [];
  for (const [meterPointId, rows] of byPoint) {
    for (let i = 1; i < rows.length; i++) {
      const previous = rows[i - 1];
      const current = rows[i];
      // Chỉ các lần thay ghi qua biên bản (có người ghi) — đổi đồng hồ bằng form điểm đo không có chỉ số.
      if (!current.replacedBy) continue;
      replacements.push({
        id: Number(current.id),
        meterPointId,
        at: wallToVietnamText(String(current.validFrom)),
        oldSerial: String(previous.serialNumber),
        newSerial: String(current.serialNumber),
        finalIndex: previous.finalIndex == null ? null : Number(previous.finalIndex),
        initialIndex: current.initialIndex == null ? null : Number(current.initialIndex),
        recordedBy: String(current.replacedBy),
        // Chỉ hoàn tác được lần thay gần nhất (đồng hồ mới vẫn đang gắn).
        canUndo: i === rows.length - 1 && !current.validTo,
      });
    }
  }
  replacements.sort((a, b) => b.at.localeCompare(a.at));

  return {
    replacements,
    suspects: suspects.map((row) => ({
      id: Number(row.id),
      meterPointId: String(row.meterPointId),
      serial: String(row.serialNumber),
      at: wallToVietnamText(String(row.detectedAt)),
      beforeIndex: Number(row.beforeIndex),
      afterIndex: Number(row.afterIndex),
    })),
  };
}

/* ---------------- ghi biên bản ---------------- */

type ReplaceInput = {
  meterPointId?: unknown;
  replacedAt?: unknown;
  finalIndex?: unknown;
  initialIndex?: unknown;
  newDeviceId?: unknown;
};

async function inTransaction<T>(work: (connection: PoolConnection) => Promise<T>) {
  const connection = await emsDb.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

async function assertSerialFree(connection: PoolConnection, projectId: string, pointId: string, serial: string, deviceId: string) {
  const variants = serialVariants(serial);
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT mp.project_id AS projectId, mp.name AS pointName, COALESCE(p.name, mp.project_id) AS projectName
       FROM meter_points mp
       LEFT JOIN devices d ON d.id = mp.device_id
       LEFT JOIN projects p ON p.id = mp.project_id
      WHERE (mp.device_id = ? OR COALESCE(NULLIF(TRIM(mp.serial_number), ''), d.serial_number) IN (?, ?, ?))
        AND NOT (mp.project_id = ? AND mp.id = ?)
      LIMIT 1`,
    [deviceId, ...variants, projectId, pointId],
  );
  const conflict = rows[0];
  if (conflict) {
    throw new MeterReplacementError(
      `Đồng hồ serial ${serial} đang gắn cho điểm đo "${conflict.pointName}" (dự án ${conflict.projectName}).`,
    );
  }
}

export async function recordMeterReplacement(session: AuthSession | null, projectId: string, input: ReplaceInput) {
  await ensureMeterReplacementSchema();
  const pointId = String(input.meterPointId ?? "").trim();
  if (!pointId) throw new MeterReplacementError("Thiếu điểm đo.");
  const replacedWall = vietnamInputToWall(String(input.replacedAt ?? ""));
  if (!replacedWall) throw new MeterReplacementError("Thời điểm thay đồng hồ không hợp lệ.");
  if (wallToMs(replacedWall) > Date.now() + 5 * 60_000) {
    throw new MeterReplacementError("Thời điểm thay đồng hồ không được ở tương lai.");
  }
  const finalIndex = optionalIndex(input.finalIndex, "Chỉ số chốt đồng hồ cũ");
  const initialIndex = optionalIndex(input.initialIndex, "Chỉ số ban đầu đồng hồ mới") ?? 0;
  const newDeviceId = String(input.newDeviceId ?? "").trim();
  const actorName = session?.username || session?.userId || "Quản trị viên";

  await inTransaction(async (connection) => {
    const [[point]] = await connection.query<RowDataPacket[]>(
      `SELECT mp.id, mp.device_id AS deviceId, mp.serial_number AS serialNumber,
              d.serial_number AS deviceSerial, d.category AS category
         FROM meter_points mp
         LEFT JOIN devices d ON d.id = mp.device_id
        WHERE mp.project_id = ? AND mp.id = ?
        LIMIT 1`,
      [projectId, pointId],
    );
    if (!point) throw new MeterReplacementError("Không tìm thấy điểm đo.");
    const oldSerial = normalizeSerial(point.serialNumber) || normalizeSerial(point.deviceSerial);
    if (!oldSerial) throw new MeterReplacementError("Điểm đo chưa gắn đồng hồ nên không thể ghi biên bản thay.");
    const oldCategory = String(point.category ?? "").trim() || "PM2230";

    let newSerial = oldSerial;
    let newCategory = oldCategory;
    const changeDevice = Boolean(newDeviceId) && newDeviceId !== String(point.deviceId ?? "");
    if (changeDevice) {
      const [[device]] = await connection.query<RowDataPacket[]>(
        "SELECT id, serial_number AS serialNumber, category FROM devices WHERE id = ? LIMIT 1",
        [newDeviceId],
      );
      if (!device) throw new MeterReplacementError("Không tìm thấy đồng hồ mới.");
      newSerial = normalizeSerial(device.serialNumber);
      if (!newSerial) throw new MeterReplacementError("Đồng hồ mới chưa có số serial.");
      newCategory = String(device.category ?? "").trim() || oldCategory;
      await assertSerialFree(connection, projectId, pointId, newSerial, newDeviceId);
    }

    // Đóng đoạn của đồng hồ cũ tại thời điểm thay.
    const [[open]] = await connection.query<RowDataPacket[]>(
      `SELECT id, DATE_FORMAT(valid_from, '%Y-%m-%d %H:%i:%s') AS validFrom
         FROM meter_point_history
        WHERE project_id = ? AND meter_point_id = ? AND valid_to IS NULL
        ORDER BY valid_from DESC, id DESC
        LIMIT 1`,
      [projectId, pointId],
    );
    if (open) {
      if (String(open.validFrom) >= replacedWall) {
        throw new MeterReplacementError(
          `Thời điểm thay phải sau lần gắn / thay đồng hồ trước (${wallToVietnamText(String(open.validFrom))}).`,
        );
      }
      await connection.execute(
        "UPDATE meter_point_history SET valid_to = ?, final_index = ? WHERE id = ?",
        [replacedWall, finalIndex, open.id],
      );
    } else {
      const [[last]] = await connection.query<RowDataPacket[]>(
        `SELECT DATE_FORMAT(MAX(valid_to), '%Y-%m-%d %H:%i:%s') AS lastTo
           FROM meter_point_history WHERE project_id = ? AND meter_point_id = ?`,
        [projectId, pointId],
      );
      const lastTo = last?.lastTo ? String(last.lastTo) : "";
      if (lastTo && lastTo >= replacedWall) {
        throw new MeterReplacementError(
          `Thời điểm thay phải sau lần gắn / thay đồng hồ trước (${wallToVietnamText(lastTo)}).`,
        );
      }
      await connection.execute(
        `INSERT INTO meter_point_history
           (project_id, meter_point_id, category, serial_number, valid_from, valid_to, final_index)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [projectId, pointId, oldCategory, oldSerial, lastTo || "2020-01-01 00:00:00", replacedWall, finalIndex],
      );
    }

    // Mở đoạn của đồng hồ mới.
    await connection.execute(
      `INSERT INTO meter_point_history
         (project_id, meter_point_id, category, serial_number, valid_from, valid_to, initial_index, replaced_by, recorded_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, UTC_TIMESTAMP())`,
      [projectId, pointId, newCategory, newSerial, replacedWall, initialIndex, actorName.slice(0, 100)],
    );

    if (changeDevice) {
      await connection.execute(
        "UPDATE meter_points SET device_id = ?, serial_number = ? WHERE project_id = ? AND id = ?",
        [newDeviceId, newSerial, projectId, pointId],
      );
    }

    // Các lần "nghi thay đồng hồ" quanh mốc này đã được xác nhận bằng biên bản.
    const ms = wallToMs(replacedWall);
    await connection.execute(
      `UPDATE meter_reset_suspects SET status = 'confirmed'
        WHERE project_id = ? AND meter_point_id = ? AND status = 'open'
          AND detected_at >= ? AND detected_at <= ?`,
      [projectId, pointId, msToWall(ms - 2 * 86_400_000), msToWall(ms + 2 * 86_400_000)],
    );
  });
  forgetRecordedSuspects(projectId, pointId);
  return listMeterReplacements(projectId);
}

/** Hoàn tác lần thay gần nhất: xoá đoạn đồng hồ mới, mở lại đoạn đồng hồ cũ (và gắn lại đồng hồ cũ nếu đã đổi). */
export async function undoMeterReplacement(projectId: string, historyId: number) {
  await ensureMeterReplacementSchema();
  if (!Number.isInteger(historyId) || historyId <= 0) throw new MeterReplacementError("Biên bản không hợp lệ.");
  await inTransaction(async (connection) => {
    const [[row]] = await connection.query<RowDataPacket[]>(
      `SELECT id, meter_point_id AS meterPointId, serial_number AS serialNumber, valid_to AS validTo,
              replaced_by AS replacedBy, DATE_FORMAT(valid_from, '%Y-%m-%d %H:%i:%s') AS validFrom
         FROM meter_point_history WHERE project_id = ? AND id = ? LIMIT 1`,
      [projectId, historyId],
    );
    if (!row || !row.replacedBy) throw new MeterReplacementError("Không tìm thấy biên bản thay đồng hồ.");
    if (row.validTo) throw new MeterReplacementError("Chỉ hoàn tác được lần thay đồng hồ gần nhất.");
    const pointId = String(row.meterPointId);
    const [[previous]] = await connection.query<RowDataPacket[]>(
      `SELECT id, serial_number AS serialNumber
         FROM meter_point_history
        WHERE project_id = ? AND meter_point_id = ? AND id <> ? AND valid_to = ?
        ORDER BY id DESC
        LIMIT 1`,
      [projectId, pointId, historyId, String(row.validFrom)],
    );

    const newSerial = normalizeSerial(row.serialNumber);
    const oldSerial = previous ? normalizeSerial(previous.serialNumber) : "";
    if (previous && oldSerial && oldSerial !== newSerial) {
      // Gắn lại đồng hồ cũ cho điểm đo.
      const variants = serialVariants(oldSerial);
      const [[device]] = await connection.query<RowDataPacket[]>(
        "SELECT id FROM devices WHERE serial_number IN (?, ?, ?) LIMIT 1",
        variants,
      );
      await assertSerialFree(connection, projectId, pointId, oldSerial, device ? String(device.id) : "");
      await connection.execute(
        "UPDATE meter_points SET device_id = ?, serial_number = ? WHERE project_id = ? AND id = ?",
        [device ? String(device.id) : null, oldSerial, projectId, pointId],
      );
    }
    await connection.execute("DELETE FROM meter_point_history WHERE id = ?", [historyId]);
    if (previous) {
      await connection.execute(
        "UPDATE meter_point_history SET valid_to = NULL, final_index = NULL WHERE id = ?",
        [previous.id],
      );
    }
  });
  return listMeterReplacements(projectId);
}

export async function dismissResetSuspect(projectId: string, suspectId: number) {
  await ensureMeterReplacementSchema();
  await emsDb.execute(
    "UPDATE meter_reset_suspects SET status = 'dismissed' WHERE project_id = ? AND id = ?",
    [projectId, suspectId],
  );
  return listMeterReplacements(projectId);
}

/* ---------------- tự phát hiện ---------------- */

/** Chỉ ghi nhận các lần tụt chỉ số trong 30 ngày gần đây (dữ liệu cũ / dữ liệu test không báo nữa). */
const SUSPECT_LOOKBACK_MS = 30 * 86_400_000;
/** Khoá đã ghi trong tiến trình này — tránh truy vấn lặp mỗi lần biểu đồ tải lại. */
const recordedSuspectKeys = new Set<string>();

function forgetRecordedSuspects(projectId: string, pointId: string) {
  const prefix = `${projectId}|${pointId}|`;
  for (const key of recordedSuspectKeys) {
    if (key.startsWith(prefix)) recordedSuspectKeys.delete(key);
  }
}

/**
 * Lưu các lần chỉ số tụt không hồi lại (nghi thay đồng hồ) và báo lên chuông thông báo quản trị.
 * Gọi không chờ kết quả từ truy vấn điện năng; mỗi lần tụt chỉ ghi một lần (gộp các phát hiện cách nhau < 1 ngày).
 */
export async function recordResetSuspects(projectId: string, pointId: string, detected: DetectedReset[]) {
  const now = Date.now();
  const fresh = detected.filter((item) => {
    const ms = wallToMs(item.at);
    return Number.isFinite(ms) && now - ms <= SUSPECT_LOOKBACK_MS;
  });
  if (!fresh.length) return;
  await ensureMeterReplacementSchema();
  for (const item of fresh) {
    const key = `${projectId}|${pointId}|${item.at}`;
    if (recordedSuspectKeys.has(key)) continue;
    recordedSuspectKeys.add(key);
    const ms = wallToMs(item.at);
    const [existing] = await queryRows<RowDataPacket>(
      `SELECT id FROM meter_reset_suspects
        WHERE project_id = ? AND meter_point_id = ? AND detected_at >= ? AND detected_at <= ?
        LIMIT 1`,
      [projectId, pointId, msToWall(ms - 86_400_000), msToWall(ms + 86_400_000)],
    );
    if (existing) continue;
    await emsDb.execute(
      `INSERT INTO meter_reset_suspects
         (project_id, meter_point_id, serial_number, detected_at, before_index, after_index, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', UTC_TIMESTAMP())`,
      [projectId, pointId, item.meterId, item.at.slice(0, 19), item.before, item.after],
    );
    // Tên mặc định tính ở JS (không COALESCE cột với tham số: tránh lỗi trộn collation trên MariaDB).
    const [[project], [point]] = await Promise.all([
      queryRows<RowDataPacket>("SELECT name FROM projects WHERE id = ? LIMIT 1", [projectId]),
      queryRows<RowDataPacket>("SELECT name FROM meter_points WHERE project_id = ? AND id = ? LIMIT 1", [
        projectId,
        pointId,
      ]),
    ]);
    const projectName = project?.name ? String(project.name) : projectId;
    const pointName = point?.name ? String(point.name) : pointId;
    const detail = `điểm đo "${pointName}" (serial ${item.meterId}) lúc ${wallToVietnamText(item.at)}: ${formatIndex(item.before)} → ${formatIndex(item.after)} kWh`;
    await ensureProjectEventsSchema();
    await emsDb
      .execute(
        `INSERT INTO admin_notifications (type, project_id, project_name, actor_id, actor_name, request_id, detail, created_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, ?, UTC_TIMESTAMP(3))`,
        ["meter_reset_suspected", projectId, projectName, detail.slice(0, 255)],
      )
      .catch(() => undefined);
  }
}

function formatIndex(value: number) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(value);
}
