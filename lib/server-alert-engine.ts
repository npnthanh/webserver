import "server-only";
import type { ResultSetHeader } from "mysql2";
import { normalizeAlertConfig, ruleThresholdsForPoint } from "@/lib/alert-config";
import { alertCategory } from "@/lib/alert-events";
import { getProjectGatewayLatest } from "@/lib/gateway-store";
import { METER_PARAMETERS, readMeterValue } from "@/lib/meter-parameters";
import { emsDb, jsonField, queryRows } from "@/lib/server-db";
import { notifyAlertEvent } from "@/lib/server-notifier";

/**
 * Động cơ đánh giá cảnh báo (ngưỡng thông số + mất / có lại kết nối) dùng chung cho
 * route API (khi người dùng mở trang) và bộ lập lịch nền (lib/server-alert-scheduler.ts).
 * Thông báo chỉ gửi khi một sự kiện cảnh báo được TẠO MỚI (affectedRows = 1), nên nhiều tiến trình
 * cùng đánh giá cũng không gửi trùng.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// Giữ nguyên ngữ nghĩa các hàm cùng tên trong route EMS.
function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

let projectSettingsReady: Promise<void> | null = null;

/** "YYYYMMDDHH" của giờ liền trước (theo giờ UTC đang lưu). */
function previousHourKey(hourKey: string) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})/.exec(hourKey);
  if (!match) return null;
  const prev = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4]) - 3600_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${prev.getUTCFullYear()}${pad(prev.getUTCMonth() + 1)}${pad(prev.getUTCDate())}${pad(prev.getUTCHours())}`;
}

function storedUtcMs(value: string) {
  const ms = Date.parse(`${value.replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? ms : 0;
}

function isNewRow(result: unknown) {
  const header = Array.isArray(result) ? (result[0] as ResultSetHeader | undefined) : undefined;
  return header?.affectedRows === 1;
}

export function resetAlertEvalThrottle(projectId: string) {
  lastAlertEvalAt.delete(projectId);
}

const lastAlertEvalAt = new Map<string, number>();

const GAP_SCAN_LIMIT = 500;
/** Rà khoảng mất kết nối trong lịch sử: chỉ 3 ngày gần nhất, mỗi đồng hồ tối đa 10 phút/lần (tốn tài nguyên nhất). */
const GAP_SCAN_DAYS = 3;
const GAP_SCAN_EVERY_MS = 10 * 60_000;
const lastGapScanAt = new Map<string, number>();

/** Xóa các cặp sự kiện OFF/ONL của điểm đo không còn ứng với khoảng gián đoạn thực tế nào. */
async function reconcileConnectivityEvents(
  projectId: string,
  pointId: string,
  shortPoint: string,
  validGapKeys: Set<string>,
) {
  const rows = await queryRows<Row>(
    `SELECT id FROM alert_events
      WHERE project_id = ? AND meter_point_id = ?
        AND (id LIKE ? OR id LIKE ?)
        AND occurred_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${GAP_SCAN_DAYS - 1} DAY)`,
    [projectId, pointId, `OFF-${shortPoint}-%`, `ONL-${shortPoint}-%`],
  ).catch(() => [] as Row[]);
  const stale = rows
    .map((row) => asString(row.id))
    .filter((id) => {
      const key = id.slice(id.lastIndexOf("-") + 1);
      return key && !validGapKeys.has(key);
    });
  if (stale.length === 0) return;
  await emsDb
    .query(`DELETE FROM alert_events WHERE id IN (${stale.map(() => "?").join(",")})`, stale)
    .catch(() => undefined);
}

let alertCategoryFixReady: Promise<void> | null = null;

/** Sửa một lần các cảnh báo ngưỡng (VD: Van) từng bị lưu nhầm category "connectivity". */
function fixMisclassifiedAlertCategories() {
  alertCategoryFixReady ??= (async () => {
    const rows = await queryRows<Row>(
      `SELECT DISTINCT parameter_name AS parameter FROM alert_events
        WHERE category = 'connectivity' AND parameter_name NOT IN ('Mất kết nối', 'Kết nối trở lại')`,
    );
    for (const row of rows) {
      const parameter = asString(row.parameter);
      await emsDb.execute(
        `UPDATE alert_events SET category = ?
          WHERE category = 'connectivity' AND parameter_name = ?`,
        [alertCategory(parameter).slice(0, 40), parameter],
      );
    }
  })().catch((error) => {
    alertCategoryFixReady = null;
    console.error("fixMisclassifiedAlertCategories failed", error);
  });
  return alertCategoryFixReady;
}

export async function evaluateProjectAlerts(targetProjectId?: string) {
  try {
    await ensureProjectSettingsTable();
    await fixMisclassifiedAlertCategories();
    let projectIds: string[] = [];
    if (targetProjectId) {
      projectIds = [targetProjectId];
    } else {
      const projRows = await queryRows<Row>("SELECT id FROM projects ORDER BY id LIMIT 500").catch(() => [] as Row[]);
      projectIds = projRows.map((r) => asString(r.id)).filter(Boolean);
    }

    const nowMs = Date.now();
    for (const pid of projectIds) {
      const lastEval = lastAlertEvalAt.get(pid) ?? 0;
      if (nowMs - lastEval < 4000) continue;
      lastAlertEvalAt.set(pid, nowMs);

      const [settingsRows, meterRows, latestSamples] = await Promise.all([
        queryRows<Row>(
          "SELECT payload FROM project_settings WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1",
          [pid],
        ).catch(() => [] as Row[]),
        queryRows<Row>(
          `SELECT mp.id, mp.name, mp.code, mp.utility,
                  COALESCE(NULLIF(TRIM(mp.serial_number), ''), TRIM(d.serial_number)) AS serialNumber,
                  d.id AS deviceId, d.status AS deviceStatus
             FROM meter_points mp
             LEFT JOIN devices d ON d.id = mp.device_id
            WHERE mp.project_id = ?`,
          [pid],
        ).catch(() => [] as Row[]),
        getProjectGatewayLatest(pid).catch(() => []),
      ]);

      const payload = jsonField<Record<string, unknown>>(settingsRows[0]?.payload, {});
      const projectConfig = (payload.projectConfig ?? {}) as Record<string, unknown>;
      const adminAlertConfig = (payload.alertConfig ?? {}) as Record<string, unknown>;
      const timeoutMinutes = Math.max(
        1,
        Number(projectConfig.onlineTimeout ?? adminAlertConfig.commLossMinutes ?? 10) || 10,
      );
      const timeoutSeconds = Math.round(timeoutMinutes * 60);

      const alertCfg = normalizeAlertConfig(payload.alertsConfig, payload.alertConfig);
      const allRules = Object.values(alertCfg.rulesByGroup ?? {})
        .flat()
        .filter((r) => r.enabled && r.parameterKey);

      // 1. Đánh giá ngưỡng thông số đo từ mẫu mới nhất của các điểm đo thuộc dự án
      for (const sample of latestSamples) {
        const meter = meterRows.find((m) => asString(m.id) === sample.meterPointId);
        const pointName = asString(meter?.name) || sample.meterPointId;
        const hourKey = sample.at.replace(/\D/g, "").slice(0, 10) || "0000000000";
        const shortPoint = sample.meterPointId.replace(/[^a-zA-Z0-9]/g, "").slice(-14) || "pt";

        for (const rule of allRules) {
          // Ngưỡng riêng của điểm đo (hoặc ngưỡng mặc định); null = ngưỡng không áp cho điểm đo này.
          const limits = ruleThresholdsForPoint(rule, sample.meterPointId);
          if (!limits) continue;
          const actual = readMeterValue(sample.values, rule.parameterKey);
          if (actual === null || !Number.isFinite(actual)) continue;

          const minNum = limits.minValue.trim() !== "" ? Number(limits.minValue) : null;
          const maxNum = limits.maxValue.trim() !== "" ? Number(limits.maxValue) : null;
          const belowMin = minNum !== null && Number.isFinite(minNum) && actual < minNum;
          const aboveMax = maxNum !== null && Number.isFinite(maxNum) && actual > maxNum;
          if (!belowMin && !aboveMax) continue;

          const shortParam = rule.parameterKey.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 16) || "param";
          const eventId = `THR-${shortPoint}-${shortParam}-${hourKey}`.slice(0, 64);
          const thresholdVal = belowMin ? minNum : maxNum;
          const paramMeta = METER_PARAMETERS.find((p) => p.key === rule.parameterKey);
          const unit = (rule.unit || paramMeta?.unit || "").slice(0, 40);
          const category = alertCategory(
            rule.parameterKey,
            rule.groupId === "imbalance"
              ? "unbalance"
              : rule.groupId === "harmonics"
                ? "harmonics"
                : undefined,
          ).slice(0, 40);
          const boundText = belowMin ? `< Min ${minNum}` : `> Max ${maxNum}`;
          const message = `${rule.name || paramMeta?.name || rule.parameterKey}: giá trị đo ${actual}${unit ? ` ${unit}` : ""} vượt ngưỡng cài đặt (${boundText}${unit ? ` ${unit}` : ""}) tại ${pointName}`.slice(
            0,
            500,
          );

          const thrResult = await emsDb
            .execute<ResultSetHeader>(
              `INSERT INTO alert_events
                 (id, project_id, meter_point_id, occurred_at, parameter_name, value, unit, severity, status, category, message, threshold_value)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
               ON DUPLICATE KEY UPDATE
                 occurred_at = VALUES(occurred_at),
                 value = VALUES(value),
                 unit = VALUES(unit),
                 severity = VALUES(severity),
                 category = VALUES(category),
                 message = VALUES(message),
                 threshold_value = VALUES(threshold_value)`,
              [
                eventId,
                pid,
                sample.meterPointId,
                sample.at,
                rule.parameterKey,
                actual,
                unit,
                rule.severity || "warning",
                category,
                message,
                thresholdVal,
              ],
            )
            .catch(() => null);
          // Chỉ báo khi cảnh báo BẮT ĐẦU: sự kiện mới và giờ liền trước không có cảnh báo cùng thông số
          // (cảnh báo kéo dài nhiều giờ sẽ không gửi lặp lại mỗi giờ).
          if (isNewRow(thrResult)) {
            const prevKey = previousHourKey(hourKey);
            const prevId = prevKey ? `THR-${shortPoint}-${shortParam}-${prevKey}`.slice(0, 64) : "";
            const ongoing = prevId
              ? await queryRows<Row>("SELECT id FROM alert_events WHERE id = ? LIMIT 1", [prevId]).catch(() => [])
              : [];
            if (!ongoing.length) {
              void notifyAlertEvent({
                eventId,
                projectId: pid,
                pointName,
                parameter: rule.name || paramMeta?.name || rule.parameterKey,
                severity: rule.severity || "warning",
                message,
                occurredAt: sample.at,
              });
            }
          }
        }
      }

      // 2. Đánh giá cảnh báo Mất kết nối (quá timeout cài đặt) & Kết nối trở lại cho từng node
      for (const meter of meterRows) {
        const pointId = asString(meter.id);
        const pointName = asString(meter.name) || pointId;
        const rawSerial = asString(meter.serialNumber).replace(/^SN:\s*/i, "").trim();
        if (!rawSerial) continue;
        const shortPoint = pointId.replace(/[^a-zA-Z0-9]/g, "").slice(-14) || "pt";

        // 2a. Rà soát các khoảng gián đoạn lịch sử (GAP_SCAN_DAYS ngày gần nhất) vượt quá timeoutSeconds.
        const gapScanKey = `${pid}:${pointId}`;
        const gapScanDue = Date.now() - (lastGapScanAt.get(gapScanKey) ?? 0) >= GAP_SCAN_EVERY_MS;
        if (gapScanDue) lastGapScanAt.set(gapScanKey, Date.now());
        const gapRows = !gapScanDue ? null : await queryRows<Row>(
          `SELECT DATE_FORMAT(DATE_ADD(prev_at, INTERVAL ? SECOND), '%Y-%m-%d %H:%i:%s') AS offlineAt,
                  DATE_FORMAT(received_at, '%Y-%m-%d %H:%i:%s') AS onlineAt,
                  TIMESTAMPDIFF(SECOND, prev_at, received_at) AS gapSec,
                  DATE_FORMAT(prev_at, '%Y%m%d%H%i%s') AS stampKey
             FROM (
               SELECT received_at,
                      LAG(received_at) OVER (ORDER BY received_at ASC, id ASC) AS prev_at
                 FROM gateway_samples
                WHERE meter_id = ?
                  AND received_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${GAP_SCAN_DAYS} DAY)
             ) seq
            WHERE prev_at IS NOT NULL
              AND TIMESTAMPDIFF(SECOND, prev_at, received_at) > ?
            ORDER BY received_at DESC
            LIMIT ${GAP_SCAN_LIMIT}`,
          [timeoutSeconds, rawSerial, timeoutSeconds],
        ).catch(() => null);

        const validGapKeys = new Set<string>();
        for (const gap of gapRows ?? []) {
          const stampKey = asString(gap.stampKey);
          const offlineAt = asString(gap.offlineAt);
          const onlineAt = asString(gap.onlineAt);
          if (!stampKey || !offlineAt || !onlineAt) continue;
          validGapKeys.add(stampKey);

          const gapMinutes = Math.max(1, Math.round((asNumber(gap.gapSec) / 60) * 10) / 10);
          const offId = `OFF-${shortPoint}-${stampKey}`.slice(0, 64);
          const onlId = `ONL-${shortPoint}-${stampKey}`.slice(0, 64);
          const offMsg = `Node ${pointName} (SN: ${rawSerial}) mất kết nối quá timeout cài đặt ${timeoutMinutes} phút (không có dữ liệu từ Gateway trong ${gapMinutes} phút)`.slice(
            0,
            500,
          );
          const onlMsg = `Node ${pointName} (SN: ${rawSerial}) đã kết nối trở lại sau ${gapMinutes} phút mất kết nối`.slice(
            0,
            500,
          );

          await emsDb
            .execute(
              `INSERT INTO alert_events
                 (id, project_id, meter_point_id, occurred_at, parameter_name, value, unit, severity, status, category, message, threshold_value)
               VALUES (?, ?, ?, ?, 'Mất kết nối', ?, 'phút', 'critical', 'resolved', 'connectivity', ?, ?)
               ON DUPLICATE KEY UPDATE
                 value = VALUES(value),
                 status = IF(status = 'acknowledged', 'acknowledged', 'resolved'),
                 message = VALUES(message),
                 threshold_value = VALUES(threshold_value)`,
              [offId, pid, pointId, offlineAt, gapMinutes, offMsg, timeoutMinutes],
            )
            .catch(() => undefined);

          const onlResult = await emsDb
            .execute<ResultSetHeader>(
              `INSERT INTO alert_events
                 (id, project_id, meter_point_id, occurred_at, parameter_name, value, unit, severity, status, category, message, threshold_value)
               VALUES (?, ?, ?, ?, 'Kết nối trở lại', ?, 'phút', 'info', 'resolved', 'connectivity', ?, ?)
               ON DUPLICATE KEY UPDATE
                 value = VALUES(value),
                 message = VALUES(message),
                 threshold_value = VALUES(threshold_value)`,
              [onlId, pid, pointId, onlineAt, gapMinutes, onlMsg, timeoutMinutes],
            )
            .catch(() => null);
          // Chỉ báo "kết nối trở lại" vừa xảy ra; khoảng gián đoạn cũ phát hiện khi rà lịch sử thì không gửi.
          if (isNewRow(onlResult) && Date.now() - storedUtcMs(onlineAt) < 30 * 60_000) {
            void notifyAlertEvent({
              eventId: onlId,
              projectId: pid,
              pointName,
              parameter: "Kết nối trở lại",
              severity: "info",
              message: onlMsg,
              occurredAt: onlineAt,
            });
          }
        }

        // 2b. Kiểm tra trạng thái hiện tại so với bản tin cuối cùng từ Gateway
        const latestRows = await queryRows<Row>(
          `SELECT DATE_FORMAT(received_at, '%Y-%m-%d %H:%i:%s') AS lastAt,
                  DATE_FORMAT(DATE_ADD(received_at, INTERVAL ? SECOND), '%Y-%m-%d %H:%i:%s') AS offlineAt,
                  TIMESTAMPDIFF(SECOND, received_at, UTC_TIMESTAMP()) AS idleSec,
                  DATE_FORMAT(received_at, '%Y%m%d%H%i%s') AS stampKey
             FROM gateway_samples
            WHERE meter_id = ?
            ORDER BY received_at DESC, id DESC
            LIMIT 1`,
          [timeoutSeconds, rawSerial],
        ).catch(() => [] as Row[]);

        const latestRow = latestRows[0];
        if (!latestRow) continue;
        const idleSec = asNumber(latestRow.idleSec);
        const stampKey = asString(latestRow.stampKey);
        const offlineAt = asString(latestRow.offlineAt);

        // 2c. Dọn cảnh báo kết nối "ma": dữ liệu của khoảng gián đoạn đã được gateway gửi bù (RE=1)
        //     hoặc đồng bộ từ server upstream, nên khoảng mất kết nối đó thực tế không còn tồn tại.
        if (gapRows && gapRows.length < GAP_SCAN_LIMIT) {
          if (idleSec > timeoutSeconds && stampKey) validGapKeys.add(stampKey);
          await reconcileConnectivityEvents(pid, pointId, shortPoint, validGapKeys);
        }
        const deviceId = asString(meter.deviceId);
        const deviceStatus = asString(meter.deviceStatus);

        if (idleSec > timeoutSeconds && stampKey && offlineAt) {
          const idleMinutes = Math.max(1, Math.round((idleSec / 60) * 10) / 10);
          const offId = `OFF-${shortPoint}-${stampKey}`.slice(0, 64);
          const offMsg = `Node ${pointName} (SN: ${rawSerial}) đang mất kết nối quá timeout cài đặt ${timeoutMinutes} phút (${idleMinutes} phút chưa có dữ liệu từ Gateway)`.slice(
            0,
            500,
          );
          const offResult = await emsDb
            .execute<ResultSetHeader>(
              `INSERT INTO alert_events
                 (id, project_id, meter_point_id, occurred_at, parameter_name, value, unit, severity, status, category, message, threshold_value)
               VALUES (?, ?, ?, ?, 'Mất kết nối', ?, 'phút', 'critical', 'active', 'connectivity', ?, ?)
               ON DUPLICATE KEY UPDATE
                 value = VALUES(value),
                 status = IF(status = 'acknowledged', 'acknowledged', 'active'),
                 message = VALUES(message),
                 threshold_value = VALUES(threshold_value)`,
              [offId, pid, pointId, offlineAt, idleMinutes, offMsg, timeoutMinutes],
            )
            .catch(() => null);
          if (isNewRow(offResult)) {
            void notifyAlertEvent({
              eventId: offId,
              projectId: pid,
              pointName,
              parameter: "Mất kết nối",
              severity: "critical",
              message: offMsg,
              occurredAt: offlineAt,
            });
          }

          if (deviceId && deviceStatus !== "offline") {
            await emsDb
              .execute("UPDATE devices SET status = 'offline' WHERE id = ?", [deviceId])
              .catch(() => undefined);
          }
        } else if (idleSec >= 0 && idleSec <= timeoutSeconds) {
          if (deviceId && deviceStatus === "offline") {
            await emsDb
              .execute("UPDATE devices SET status = 'online' WHERE id = ?", [deviceId])
              .catch(() => undefined);
          }
        }
      }
    }
  } catch (error) {
    console.error("evaluateProjectAlerts failed", error);
  }
}

export function ensureProjectSettingsTable() {
  if (!projectSettingsReady) {
    projectSettingsReady = migrateProjectSettings().catch((error) => {
      projectSettingsReady = null;
      console.error("project_settings migrate failed", error);
      throw error;
    });
  }
  return projectSettingsReady;
}

async function migrateProjectSettings() {
  await emsDb.query(
    `CREATE TABLE IF NOT EXISTS project_settings (
       project_id VARCHAR(64) NOT NULL,
       payload JSON NOT NULL,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       PRIMARY KEY (project_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  await emsDb
    .query(
      `ALTER TABLE project_settings
         ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,
    )
    .catch(() => undefined);
  await emsDb.query("ALTER TABLE project_settings ADD PRIMARY KEY (project_id)").catch(() => undefined);
  await emsDb
    .query(
      `UPDATE project_settings
          SET payload = JSON_SET(
                payload,
                '$.costConfig.electricity.prices.normal', '1.833',
                '$.costConfig.electricity.prices.off', '1.190',
                '$.costConfig.electricity.prices.peak', '3.398'
              )
        WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.costConfig.electricity.prices.normal')) = '1'
          AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.costConfig.electricity.prices.off')) = '1'
          AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.costConfig.electricity.prices.peak')) = '1'`,
    )
    .catch(() => undefined);
}
