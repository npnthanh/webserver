import { createHash } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { NextRequest } from "next/server";
import { normalizeAccountRole } from "@/lib/accounts";
import { getProjectsListTelemetry } from "@/lib/gateway-store";
import { PROTOCOL_VERSION } from "@/lib/gateway-protocol";
import { canAccessAdminProject, canManageAccountRole, isAdminRole } from "@/lib/permissions";
import { ensureAccountProjectsSchema, ensureCustomerAccountsSchema, getServerSession, requirePermission } from "@/lib/server-auth";
import {
  dismissResetSuspect,
  listMeterReplacements,
  MeterReplacementError,
  recordMeterReplacement,
  undoMeterReplacement,
} from "@/lib/server-meter-replacement";
import { emsDb, jsonField, queryRows } from "@/lib/server-db";
import {
  ensureNotifierSchema,
  getMaskedSettings,
  listDeliveries,
  listTelegramChats,
  saveSettings as saveNotificationSettings,
  sendTestNotification,
  type NotificationChannel,
} from "@/lib/server-notifier";
import {
  ensureProjectSettingsTable,
  evaluateProjectAlerts,
  resetAlertEvalThrottle,
} from "@/lib/server-alert-engine";
import {
  ensureProjectManagerSchema,
  getProjectManagerState,
  setProjectManager,
  syncProjectContact,
} from "@/lib/server-project-manager";
import { vietnamNow } from "@/lib/vietnam-time";
import {
  CatalogUserError,
  assertTypeCodeAvailable,
  assertTypeDeletable,
  deleteMeterModel,
  ensureMeterCatalogSchema,
  invalidateCatalogCache,
  listMeterModels,
  parseTypeCode,
  saveMeterModel,
} from "@/lib/server-meter-catalog";
import {
  addProjectEvent,
  decideProjectDeletion,
  ensureProjectEventsSchema,
  listNotifications,
  markNotificationsSeen,
  pendingDeletionsByProject,
  ProjectEventError,
  requestProjectDeletion,
} from "@/lib/server-project-events";

type Params = { params: Promise<{ resource: string }> };
type Row = Record<string, any>;

const RESOURCE_NAMES = new Set([
  "accounts",
  "customer-accounts",
  "projects",
  "devices",
  "meter-types",
  "meter-models",
  "gateway-protocol-versions",
  "client-meters",
  "emission-factors",
  "ghg-sources",
  "ghg-templates",
  "alert-events",
  "meter-readings",
  "diagram-states",
  "project-settings",
  "project-telemetry",
  "project-managers",
  "notification-settings",
  "notification-test",
  "telegram-chats",
  "notifications",
  "project-deletions",
  "meter-replacements",
]);

/** Lỗi nghiệp vụ: thông điệp được trả nguyên văn cho người dùng với HTTP 400. */
class UserFacingError extends Error {}

function normalizeSerial(value: unknown) {
  return asString(value).trim().replace(/^SN:\s*/i, "");
}

type SerialConflict = { serial: string; projectId: string; projectName: string; pointName: string; pointCode: string };

/**
 * Điểm đo ở dự án KHÁC đang dùng các số serial này (serial nhập tay, hoặc serial của thiết bị nếu để trống).
 * Một serial chỉ được gắn với một dự án để dữ liệu gateway không bị lẫn giữa các dự án.
 */
async function findSerialConflicts(projectId: string, serials: unknown[]): Promise<SerialConflict[]> {
  const wanted = [...new Set(serials.map(normalizeSerial).filter(Boolean))];
  if (!wanted.length) return [];
  const variants = [...new Set(wanted.flatMap((serial) => [serial, `SN: ${serial}`, `SN:${serial}`]))];
  const marks = variants.map(() => "?").join(", ");
  const rows = await queryRows<Row>(
    `SELECT mp.project_id AS projectId, COALESCE(p.name, mp.project_id) AS projectName,
            mp.name AS pointName, mp.code AS pointCode,
            COALESCE(NULLIF(TRIM(mp.serial_number), ''), d.serial_number) AS serial
       FROM meter_points mp
       LEFT JOIN devices d ON d.id = mp.device_id
       LEFT JOIN projects p ON p.id = mp.project_id
      WHERE mp.project_id <> ?
        AND (TRIM(mp.serial_number) IN (${marks})
             OR (COALESCE(TRIM(mp.serial_number), '') = '' AND d.serial_number IN (${marks})))
      LIMIT 50`,
    [projectId, ...variants, ...variants],
  );
  const wantedKeys = new Set(wanted.map((serial) => serial.toLowerCase()));
  return rows
    .map((row) => ({
      serial: normalizeSerial(row.serial),
      projectId: asString(row.projectId),
      projectName: asString(row.projectName),
      pointName: asString(row.pointName),
      pointCode: asString(row.pointCode),
    }))
    .filter((row) => wantedKeys.has(row.serial.toLowerCase()));
}

function serialConflictMessage(conflict: SerialConflict) {
  const point = conflict.pointName || conflict.pointCode;
  return `Số serial "${conflict.serial}" đã được dùng ở dự án "${conflict.projectName}"${point ? ` (điểm đo "${point}")` : ""}.`;
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function forbidden(message = "Không có quyền thực hiện thao tác này.") {
  return Response.json({ error: message }, { status: 403 });
}

function serverError(error: unknown) {
  if (error instanceof UserFacingError || error instanceof ProjectEventError || error instanceof CatalogUserError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  const sqlMessage =
    typeof error === "object" && error && "sqlMessage" in error
      ? String((error as { sqlMessage?: string }).sqlMessage ?? "")
      : "";
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code) : "";
  const message = error instanceof Error ? error.message : "";
  const detail = `${sqlMessage} ${message}`;
  console.error("EMS API error", { code, message, sqlMessage, error });
  if (
    detail.includes("uq_accounts_username") ||
    detail.includes("uq_customer_accounts_username")
  ) {
    return Response.json({ error: "Tên người dùng này đã tồn tại trên hệ thống." }, { status: 400 });
  }
  if (
    detail.includes("uq_accounts_email") ||
    detail.includes("uq_customer_accounts_email")
  ) {
    return Response.json({ error: "Địa chỉ email này đã tồn tại trên hệ thống." }, { status: 400 });
  }
  if (code === "ER_DUP_ENTRY" || detail.includes("uq_devices_serial_number")) {
    return Response.json({ error: "Serial này đã được dùng cho loại thiết bị khác." }, { status: 400 });
  }
  if (code === "ER_DATA_TOO_LONG" || message.includes("Data too long")) {
    return Response.json({ error: "Dữ liệu quá dài, không lưu được vào database." }, { status: 400 });
  }
  if (code === "ER_NO_REFERENCED_ROW_2" || code === "ER_NO_REFERENCED_ROW") {
    return Response.json({ error: "Mã dự án không tồn tại trên database, không lưu được cấu hình." }, { status: 400 });
  }
  return Response.json({ error: "Không thể xử lý dữ liệu trên database." }, { status: 500 });
}

let deviceColumnsReady: Promise<void> | null = null;
let ghgColumnsReady: Promise<void> | null = null;
let diagramDisplaysReady: Promise<void> | null = null;
function ensureDiagramDisplaysColumn() {
  if (!diagramDisplaysReady) {
    diagramDisplaysReady = emsDb
      .query("ALTER TABLE diagram_states ADD COLUMN displays JSON NULL AFTER viewport")
      .then(() => undefined)
      .catch(() => undefined);
  }
  return diagramDisplaysReady;
}

let emissionFactorOrderReady: Promise<void> | null = null;

/** Thứ tự hiển thị hệ số phát thải: nhóm mới nhất lên đầu, khí trong nhóm theo đúng thứ tự đã nhập. */
function ensureEmissionFactorOrdering() {
  emissionFactorOrderReady ??= (async () => {
    await emsDb
      .query("ALTER TABLE emission_factor_groups ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP")
      .catch(() => undefined);
    await emsDb
      .query("ALTER TABLE emission_factor_gases ADD COLUMN sort_order INT NOT NULL DEFAULT 0")
      .catch(() => undefined);
  })();
  return emissionFactorOrderReady;
}

let ghgTemplatesReady: Promise<void> | null = null;

/** Mẫu nguồn phát thải nhập thủ công (Cấu hình → Nguồn phát thải thủ công). */
function ensureGhgTemplatesTable() {
  ghgTemplatesReady ??= emsDb
    .query(
      `CREATE TABLE IF NOT EXISTS ghg_manual_templates (
         id VARCHAR(64) NOT NULL,
         name VARCHAR(255) NOT NULL,
         unit VARCHAR(40) NOT NULL,
         default_value DECIMAL(18,6) NULL,
         factor_group_id VARCHAR(100) NULL,
         multipliers_json LONGTEXT NULL,
         formula VARCHAR(500) NOT NULL,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         PRIMARY KEY (id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )
    .then(() => undefined)
    .catch((error) => {
      ghgTemplatesReady = null;
      throw error;
    });
  return ghgTemplatesReady;
}

async function listGhgTemplates() {
  await ensureGhgTemplatesTable();
  const rows = await queryRows<Row>(
    `SELECT id, name, unit, default_value AS defaultValue, factor_group_id AS factorGroupId,
            multipliers_json AS multipliers, formula
       FROM ghg_manual_templates ORDER BY name, id`,
  );
  return rows.map((row) => ({
    id: asString(row.id),
    name: asString(row.name),
    unit: asString(row.unit),
    defaultValue: row.defaultValue == null ? null : asNumber(row.defaultValue),
    factorGroupId: asString(row.factorGroupId),
    multipliers: jsonField<unknown[]>(row.multipliers, []),
    formula: asString(row.formula),
  }));
}

let recipientChannelsReady: Promise<void> | null = null;

/** Kênh nhận cảnh báo của từng người nhận (VD "Email,SMS,Zalo"). */
function ensureRecipientChannelsColumn() {
  recipientChannelsReady ??= emsDb
    .query("ALTER TABLE alert_recipients ADD COLUMN channels VARCHAR(100) NULL")
    .then(() => undefined)
    .catch(() => undefined);
  return recipientChannelsReady;
}

const RECIPIENT_CHANNELS = new Set(["Email", "SMS", "Zalo", "Telegram"]);

function cleanChannels(value: unknown) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return Array.from(new Set(list.map((item) => asString(item).trim()).filter((item) => RECIPIENT_CHANNELS.has(item))));
}

function ensureDeviceColumns() {
  deviceColumnsReady ??= emsDb
    .execute("ALTER TABLE devices MODIFY COLUMN image MEDIUMTEXT NULL")
    .then(() => undefined)
    .catch(() => undefined);
  return deviceColumnsReady;
}

function ensureGhgColumns() {
  if (!ghgColumnsReady) {
    ghgColumnsReady = (async () => {
      const queries = [
        "ALTER TABLE ghg_emission_sources ADD COLUMN multipliers_json JSON NULL",
        "ALTER TABLE ghg_emission_sources ADD COLUMN manual_value DECIMAL(18,6) NULL",
        "ALTER TABLE ghg_emission_sources ADD COLUMN manual_unit VARCHAR(40) NULL",
        "ALTER TABLE ghg_emission_sources ADD COLUMN manual_monthly_json JSON NULL",
        "ALTER TABLE ghg_emission_sources DROP FOREIGN KEY fk_ghg_sources_factor",
        "ALTER TABLE ghg_emission_sources MODIFY COLUMN factor_group_id VARCHAR(100) NULL",
        "ALTER TABLE ghg_emission_sources MODIFY COLUMN gas_key VARCHAR(10) NULL",
      ];
      for (const sql of queries) {
        await emsDb.execute(sql).catch(() => undefined);
      }
    })();
  }
  return ghgColumnsReady;
}

function asManualMonthly(value: unknown): Record<string, number> | undefined {
  const raw = jsonField<Record<string, unknown> | null>(value, null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}$/.test(k)) continue;
    const num = Number(v);
    if (Number.isFinite(num) && num >= 0) {
      out[k] = num;
    }
  }
  return out;
}

function asMultipliers(value: unknown) {
  const rows = jsonField<Row[]>(value, []);
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row, index) => ({
      id: asString(row.id) || `mul-${index + 1}`,
      label: asString(row.label).trim(),
      symbol: asString(row.symbol).trim(),
      value: asNumber(row.value),
      unit: asString(row.unit).trim(),
    }))
    .filter((row) => row.label || row.symbol);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function recipientKey(value: unknown) {
  const id = asString(value).trim();
  if (id && id !== "rcpt-new") return id;
  return `rcpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function projectDateForDb(value: unknown) {
  const input = asString(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const match = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function asNumber(value: unknown, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

async function resourceName(context: Params) {
  const { resource } = await context.params;
  return resource;
}

async function getAccounts() {
  await ensureAccountProjectsSchema();
  await ensureProjectManagerSchema();
  const [accounts, mappings] = await Promise.all([
    queryRows<Row>(
      `SELECT id, username, email, full_name AS fullName, phone, role, DATE_FORMAT(created_at, '%d/%m/%Y') AS createdAt
         FROM accounts ORDER BY created_at DESC, id`,
    ),
    queryRows<Row>(
      "SELECT account_id AS accountId, project_id AS projectId FROM account_projects ORDER BY account_id, project_id",
    ),
  ]);
  const projectsByAccount = new Map<string, string[]>();
  for (const row of mappings) {
    const accountId = String(row.accountId);
    const projectId = String(row.projectId);
    projectsByAccount.set(accountId, [...(projectsByAccount.get(accountId) ?? []), projectId]);
  }
  return accounts.map((row) => {
    const id = String(row.id);
    const role = normalizeAccountRole(asString(row.role));
    return {
      ...row,
      fullName: asString(row.fullName),
      phone: asString(row.phone),
      role,
      projectIds: role === "Admin" ? [] : (projectsByAccount.get(id) ?? []),
    };
  });
}

/** Tài khoản Manage và việc có được giao dự án này hay không (Admin luôn thấy mọi dự án nên không liệt kê). */
async function getProjectManagers(projectId: string) {
  await ensureAccountProjectsSchema();
  const rows = await queryRows<Row>(
    `SELECT a.id, a.username, a.email, a.role,
            CASE WHEN ap.project_id IS NULL THEN 0 ELSE 1 END AS assigned
       FROM accounts a
       LEFT JOIN account_projects ap ON ap.account_id = a.id AND ap.project_id = ?
      ORDER BY a.username, a.id`,
    [projectId],
  );
  return rows
    .filter((row) => normalizeAccountRole(asString(row.role)) === "Manage")
    .map((row) => ({
      id: asString(row.id),
      username: asString(row.username),
      email: asString(row.email),
      assigned: Number(row.assigned) === 1,
    }));
}

async function getProjects(projectId?: string, allowedProjectIds?: string[]) {
  if (allowedProjectIds && allowedProjectIds.length === 0) return [];
  const clauses: string[] = [];
  const params: string[] = [];
  if (projectId) {
    clauses.push("p.id = ?");
    params.push(projectId);
  }
  if (allowedProjectIds) {
    clauses.push(`p.id IN (${allowedProjectIds.map(() => "?").join(",")})`);
    params.push(...allowedProjectIds);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const projects = await queryRows<Row>(
    `SELECT p.id, p.initials, p.accent, p.name, p.customer, p.status,
            DATE_FORMAT(p.start_date, '%Y-%m-%d') AS startDate,
            p.contact_name AS contactName, p.phone, p.email, p.address,
            p.logo_url AS logoUrl
       FROM projects p ${where}
      ORDER BY p.id DESC`,
    params,
  );
  if (!projects.length) return [];

  const ids = projects.map((project) => project.id as string);
  const placeholders = ids.map(() => "?").join(",");
  const types = await queryRows<Row>(
    `SELECT project_id AS projectId, meter_type_name AS meterType
       FROM project_meter_types WHERE project_id IN (${placeholders})
      ORDER BY project_id, meter_type_name`,
    ids,
  );
  await ensureRecipientChannelsColumn();
  await ensureNotifierSchema();
  const recipients = await queryRows<Row>(
    `SELECT id, project_id AS projectId, name, email, phone, channels,
            telegram_chat_id AS telegramChatId, zalo_user_id AS zaloUserId
       FROM alert_recipients WHERE project_id IN (${placeholders})
      ORDER BY project_id, id`,
    ids,
  );
  // Kỹ thuật phụ trách = các tài khoản Manage được giao dự án (Admin xem mọi dự án nên không liệt kê).
  await ensureAccountProjectsSchema();
  const managerRows = await queryRows<Row>(
    `SELECT ap.project_id AS projectId, a.id, a.username, a.email, a.role
       FROM account_projects ap
       JOIN accounts a ON a.id = ap.account_id
      WHERE ap.project_id IN (${placeholders})
      ORDER BY a.username, a.id`,
    ids,
  );
  const managersByProject = new Map<string, Row[]>();
  for (const row of managerRows) {
    if (normalizeAccountRole(asString(row.role)) !== "Manage") continue;
    const id = asString(row.projectId);
    managersByProject.set(id, [
      ...(managersByProject.get(id) ?? []),
      { id: asString(row.id), username: asString(row.username), email: asString(row.email) },
    ]);
  }
  const pendingByProject = await pendingDeletionsByProject(ids);
  const typesByProject = new Map<string, string[]>();
  const recipientsByProject = new Map<string, Row[]>();
  for (const row of types) {
    const id = row.projectId as string;
    typesByProject.set(id, [...(typesByProject.get(id) ?? []), row.meterType as string]);
  }
  for (const row of recipients) {
    const id = row.projectId as string;
    recipientsByProject.set(id, [...(recipientsByProject.get(id) ?? []), {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      telegramChatId: asString(row.telegramChatId),
      zaloUserId: asString(row.zaloUserId),
      // Dữ liệu cũ chưa có kênh: mặc định theo thông tin đã nhập (có email → Email, có SĐT → SMS).
      channels:
        row.channels == null
          ? [...(asString(row.email) ? ["Email"] : []), ...(asString(row.phone) ? ["SMS"] : [])]
          : cleanChannels(row.channels),
    }]);
  }
  return projects.map((project) => ({
    ...project,
    meterTypes: typesByProject.get(project.id as string) ?? [],
    recipients: recipientsByProject.get(project.id as string) ?? [],
    managers: managersByProject.get(project.id as string) ?? [],
    pendingDeletion: pendingByProject.get(project.id as string) ?? null,
  }));
}

type DeviceProjectLink = { projectId: string; projectName: string; meterId: string; meterName: string };

/** Điểm đo gắn với đồng hồ qua device_id hoặc trùng số serial (gateway ghép theo serial). */
async function deviceProjectLinks() {
  const rows = await queryRows<Row>(
    `SELECT d.id AS deviceId, p.id AS projectId, p.name AS projectName, mp.id AS meterId, mp.name AS meterName
       FROM devices d
       JOIN meter_points mp
         ON mp.device_id = d.id
         OR (TRIM(COALESCE(mp.serial_number, '')) <> '' AND TRIM(mp.serial_number) = TRIM(d.serial_number))
       JOIN projects p ON p.id = mp.project_id
      ORDER BY p.name, mp.name`,
  );
  const map = new Map<string, DeviceProjectLink[]>();
  for (const row of rows) {
    const key = asString(row.deviceId);
    const list = map.get(key) ?? [];
    if (!list.some((item) => item.meterId === asString(row.meterId))) {
      list.push({
        projectId: asString(row.projectId),
        projectName: asString(row.projectName),
        meterId: asString(row.meterId),
        meterName: asString(row.meterName),
      });
    }
    map.set(key, list);
  }
  return map;
}

async function getResource(resource: string, request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId") || undefined;
  if (resource === "accounts") {
    return getAccounts();
  }
  if (resource === "customer-accounts") {
    await ensureCustomerAccountsSchema();
    return queryRows<Row>(
      `SELECT id, username, email, display_name AS displayName, COALESCE(role, 'Admin') AS role, project_id AS projectId
         FROM customer_accounts ${projectId ? "WHERE project_id = ?" : ""}
        ORDER BY CASE WHEN COALESCE(role, 'Admin') = 'Admin' THEN 0 ELSE 1 END, id`,
      projectId ? [projectId] : [],
    );
  }
  if (resource === "projects") {
    const session = await getServerSession();
    const allowedProjectIds =
      session?.portal === "admin" && !isAdminRole(session)
        ? (session.managedProjectIds ?? [])
        : undefined;
    return getProjects(projectId, allowedProjectIds);
  }
  if (resource === "project-telemetry") return getProjectsListTelemetry();
  if (resource === "project-managers") {
    if (!projectId) throw new UserFacingError("Thiếu mã dự án.");
    await ensureAccountProjectsSchema();
    return getProjectManagerState(projectId);
  }
  if (resource === "devices") {
    await ensureDeviceColumns();
    await ensureMeterCatalogSchema();
    const rows = await queryRows<Row>(
      `SELECT id, name, serial_number AS sn, brand_model AS brandModel, brand,
              device_type AS type, category, kind, status, last_sync_label AS lastSync,
              protocol, notes, image, extra_fields AS extraFields, registers, model_id AS modelId
         FROM devices ORDER BY id`,
    );
    const links = await deviceProjectLinks();
    return rows.map((row) => ({
      ...row,
      extraFields: jsonField(row.extraFields, undefined),
      registers: jsonField(row.registers, undefined),
      projects: links.get(asString(row.id)) ?? [],
    }));
  }
  if (resource === "meter-types") {
    await ensureMeterCatalogSchema();
    const rows = await queryRows<Row>(
      "SELECT name, description, icon, builtin, gateway_code AS gatewayCode FROM meter_types ORDER BY builtin DESC, name",
    );
    return rows.map((row) => ({
      ...row,
      builtin: Boolean(Number(row.builtin)),
      gatewayCode: row.gatewayCode == null ? null : Number(row.gatewayCode),
    }));
  }
  if (resource === "meter-models") {
    return listMeterModels();
  }
  if (resource === "gateway-protocol-versions") {
    // Protocol Version (PV) do gateway gửi lên + phiên bản server đang hỗ trợ.
    const rows = await queryRows<Row>(
      "SELECT DISTINCT protocol_version AS version FROM gateway_devices WHERE protocol_version IS NOT NULL",
    ).catch(() => [] as Row[]);
    const versions = new Set<string>([PROTOCOL_VERSION]);
    for (const row of rows) {
      const version = asString(row.version).trim();
      if (version) versions.add(version);
    }
    return [...versions].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  }
  if (resource === "ghg-templates") {
    return listGhgTemplates();
  }
  if (resource === "client-meters") {
    if (!projectId) throw new Error("projectId is required");
    const [rows, historyRows] = await Promise.all([
      queryRows<Row>(
        `SELECT id, name, code, device_type AS type, parent_id AS parentId,
                utility, device_id AS deviceId, serial_number AS serialNumber
           FROM meter_points WHERE project_id = ? ORDER BY id`,
        [projectId],
      ),
      queryRows<Row>(
        `SELECT meter_point_id AS meterPointId, category, serial_number AS serialNumber,
                DATE_FORMAT(DATE_ADD(valid_from, INTERVAL 7 HOUR), '%Y-%m-%d %H:%i') AS validFrom,
                DATE_FORMAT(DATE_ADD(valid_to, INTERVAL 7 HOUR), '%Y-%m-%d %H:%i') AS validTo
           FROM meter_point_history
          WHERE project_id = ?
          ORDER BY valid_from ASC, id ASC`,
        [projectId],
      ).catch(() => [] as Row[]),
    ]);
    const historyByPoint = new Map<string, Row[]>();
    for (const h of historyRows) {
      const pid = String(h.meterPointId);
      const list = historyByPoint.get(pid) ?? [];
      list.push({
        serialNumber: String(h.serialNumber),
        category: h.category ? String(h.category) : undefined,
        validFrom: h.validFrom ? String(h.validFrom) : undefined,
        validTo: h.validTo ? String(h.validTo) : undefined,
      });
      historyByPoint.set(pid, list);
    }
    return rows.map((r) => ({
      ...r,
      serialHistory: historyByPoint.get(String(r.id)) ?? [],
    }));
  }
  if (resource === "emission-factors") {
    await ensureEmissionFactorOrdering();
    const groups = await queryRows<Row>(
      "SELECT id, name, source FROM emission_factor_groups ORDER BY created_at DESC, name, id",
    );
    const gases = await queryRows<Row>(
      `SELECT group_id AS groupId, gas_key AS gasKey, gas_label AS gasLabel,
              factor_value AS value, unit
         FROM emission_factor_gases ORDER BY group_id, sort_order, CASE gas_key WHEN 'co2' THEN 0 WHEN 'ch4' THEN 1 WHEN 'n2o' THEN 2 ELSE 3 END, gas_key`,
    );
    return groups.map((group) => ({
      ...group,
      gases: gases
        .filter((gas) => gas.groupId === group.id)
        .map((gas) => ({
          key: asString(gas.gasKey),
          label: asString(gas.gasLabel),
          value: asNumber(gas.value),
          unit: asString(gas.unit),
        })),
    }));
  }
  if (resource === "ghg-sources") {
    await ensureGhgColumns();
    await ensureEmissionFactorOrdering();
    const [rows, gasRows] = await Promise.all([
      queryRows<Row>(
        `SELECT id, project_id AS projectId, scope_id AS scope, name,
                meter_point_id AS meterPointId,
                input_method AS method, factor_group_id AS factorGroupId,
                gas_key AS gasKey, factor_value AS factorValue, formula,
                multipliers_json AS multipliers,
                manual_value AS manualValue, manual_unit AS manualUnit,
                manual_monthly_json AS manualMonthly,
                DATE_FORMAT(applied_at, '%Y-%m-%d') AS appliedAt,
                tons_co2e AS tons
           FROM ghg_emission_sources ${projectId ? "WHERE project_id = ?" : ""}
          ORDER BY scope, id`,
        projectId ? [projectId] : [],
      ),
      queryRows<Row>(
        `SELECT group_id AS groupId, gas_key AS gasKey, gas_label AS gasLabel,
                factor_value AS value, unit
           FROM emission_factor_gases ORDER BY group_id, sort_order, CASE gas_key WHEN 'co2' THEN 0 WHEN 'ch4' THEN 1 WHEN 'n2o' THEN 2 ELSE 3 END, gas_key`,
      ).catch(() => [] as Row[]),
    ]);
    const gasesByGroup = new Map<string, { key: string; label: string; value: number; unit: string }[]>();
    for (const gas of gasRows) {
      const gid = asString(gas.groupId);
      if (!gid) continue;
      const list = gasesByGroup.get(gid) ?? [];
      list.push({
        key: asString(gas.gasKey),
        label: asString(gas.gasLabel),
        value: asNumber(gas.value),
        unit: asString(gas.unit),
      });
      gasesByGroup.set(gid, list);
    }
    return rows.map((row) => ({
      ...row,
      scope: asNumber(row.scope),
      factorId:
        row.factorGroupId && row.gasKey
          ? `${row.factorGroupId}:${row.gasKey}`
          : "none:none",
      factorValue: asNumber(row.factorValue),
      gases: row.factorGroupId ? (gasesByGroup.get(asString(row.factorGroupId)) ?? undefined) : undefined,
      multipliers: asMultipliers(row.multipliers),
      manualValue: row.manualValue == null ? undefined : asNumber(row.manualValue),
      manualUnit: asString(row.manualUnit) || undefined,
      manualMonthly: asManualMonthly(row.manualMonthly),
      tons: row.tons == null ? undefined : asNumber(row.tons),
    }));
  }
  if (resource === "alert-events") {
    // Bộ lập lịch nền đánh giá cảnh báo mỗi phút: không bắt người dùng chờ.
    void evaluateProjectAlerts(projectId);
    const rows = await queryRows<Row>(
      `SELECT a.id, a.project_id AS projectId, a.meter_point_id AS meterPointId,
              DATE_FORMAT(a.occurred_at, '%Y-%m-%d %H:%i:%s') AS occurredAt,
              a.parameter_name AS parameter, a.value, a.unit, a.severity, a.status, a.note,
              a.category, a.message, a.threshold_value AS thresholdValue,
              a.acknowledged_by AS acknowledgedBy,
              DATE_FORMAT(a.acknowledged_at, '%Y-%m-%d %H:%i:%s') AS acknowledgedAt,
              p.code AS pointCode, p.name AS pointName, p.utility
         FROM alert_events a
         LEFT JOIN meter_points p ON p.id = a.meter_point_id
        ${projectId ? "WHERE a.project_id = ?" : ""}
        ORDER BY occurred_at DESC`,
      projectId ? [projectId] : [],
    );
    const mappedEvents: Record<string, unknown>[] = rows.map((row) => ({
      ...row,
      value: asNumber(row.value),
      thresholdValue: row.thresholdValue == null ? undefined : asNumber(row.thresholdValue),
    }));

    // Bổ sung các bản ghi cảnh báo thực tế từ bảng gateway_alarms của các đồng hồ thuộc dự án
    try {
      const gwRows = await queryRows<Row>(
        `SELECT ga.id, ga.source, ga.gateway_id AS gatewayId, ga.meter_model AS meterModel,
                ga.meter_id AS meterId, ga.occurred_at AS occurredAt, ga.created_at AS createdAt,
                ga.alarm_code AS alarmCode, ga.alarm_name AS alarmName, ga.alarm_value AS alarmValue,
                ga.parameter_name AS parameterName, ga.parameter_value AS parameterValue,
                ga.min_value AS minValue, ga.max_value AS maxValue,
                mp.id AS meterPointId, mp.project_id AS projectId, mp.code AS pointCode,
                mp.name AS pointName, mp.utility
           FROM gateway_alarms ga
           LEFT JOIN devices d ON d.serial_number = ga.meter_id
           LEFT JOIN meter_points mp
             ON (mp.serial_number = ga.meter_id OR (d.id IS NOT NULL AND mp.device_id = d.id))
            ${projectId ? "AND mp.project_id = ?" : ""}
          ${projectId ? "WHERE mp.project_id = ? OR NOT EXISTS (SELECT 1 FROM meter_points WHERE project_id = ? AND (serial_number IS NOT NULL OR device_id IS NOT NULL))" : ""}
          ORDER BY ga.id DESC
          LIMIT 200`,
        projectId ? [projectId, projectId, projectId] : [],
      );

      for (const gw of gwRows) {
        const isGatewayHw = asString(gw.source) === "gateway";
        const param = isGatewayHw
          ? asString(gw.alarmName) || `IDAlarm #${asNumber(gw.alarmCode)}`
          : asString(gw.parameterName) || "Gateway";
        const val = isGatewayHw ? asNumber(gw.alarmValue) : asNumber(gw.parameterValue);
        const minVal = gw.minValue == null ? null : asNumber(gw.minValue);
        const maxVal = gw.maxValue == null ? null : asNumber(gw.maxValue);
        const thresh = maxVal ?? minVal ?? undefined;
        const rawTime = asString(gw.occurredAt) || asString(gw.createdAt);
        const normalizedTime = rawTime.replace("T", " ").replace("Z", "").slice(0, 19);
        mappedEvents.push({
          id: `GW-ALM-${gw.id}`,
          projectId: asString(gw.projectId) || projectId || "default",
          meterPointId: asString(gw.meterPointId) || undefined,
          occurredAt: normalizedTime,
          parameter: param,
          value: val,
          unit: "",
          severity: isGatewayHw ? "critical" : "warning",
          status: "active",
          category: undefined,
          message: isGatewayHw
            ? `Cảnh báo tức thời từ Gateway (${param}): giá trị ${val}`
            : `Thông số ${param} = ${val} vượt ngưỡng cài đặt (${minVal != null ? `Min ${minVal}` : ""}${minVal != null && maxVal != null ? " / " : ""}${maxVal != null ? `Max ${maxVal}` : ""})`,
          thresholdValue: thresh,
          pointCode: asString(gw.pointCode) || asString(gw.meterId) || `GW-${gw.gatewayId}`,
          pointName: asString(gw.pointName) || `${asString(gw.meterModel) || "Đồng hồ"} (${asString(gw.meterId)})`,
          utility: asString(gw.utility) || "Điện",
        });
      }
    } catch {
      // Bảng gateway_alarms chưa khởi tạo hoặc truy vấn phụ lỗi thì vẫn trả về mappedEvents
    }

    // Trạng thái gửi thông báo thật (notification_log) thay cho dữ liệu mẫu.
    const deliveries = await listDeliveries(
      mappedEvents.map((event) => asString(event.id)).filter(Boolean),
    ).catch(() => new Map());
    return mappedEvents.map((event) => ({ ...event, deliveries: deliveries.get(asString(event.id)) ?? [] }));
  }
  if (resource === "meter-readings") {
    const meterPointId = request.nextUrl.searchParams.get("meterPointId") || undefined;
    const metric = request.nextUrl.searchParams.get("metric") || undefined;
    if (!projectId && !meterPointId) throw new Error("projectId or meterPointId is required");
    const filters = [
      projectId ? "m.project_id = ?" : "",
      meterPointId ? "r.meter_point_id = ?" : "",
      metric ? "r.metric = ?" : "",
    ].filter(Boolean);
    const params = [projectId, meterPointId, metric].filter((item): item is string => Boolean(item));
    const rows = await queryRows<Row>(
      `SELECT r.id, r.meter_point_id AS meterPointId,
              DATE_FORMAT(r.recorded_at, '%Y-%m-%d %H:%i:%s') AS recordedAt,
              r.metric, r.value, r.unit, r.quality,
              m.code, m.name, m.utility
         FROM meter_readings r
         JOIN meter_points m ON m.id = r.meter_point_id
        WHERE ${filters.join(" AND ")}
        ORDER BY r.recorded_at ASC, r.id ASC`,
      params,
    );
    return rows.map((row) => ({ ...row, value: asNumber(row.value) }));
  }
  if (resource === "diagram-states") {
    if (!projectId) throw new Error("projectId is required");
    await ensureDiagramDisplaysColumn();
    const utility = request.nextUrl.searchParams.get("utility");
    const rows = await queryRows<Row>(
      `SELECT project_id AS projectId, utility, positions, viewport, displays, updated_at AS updatedAt
         FROM diagram_states WHERE project_id = ? ${utility ? "AND utility = ?" : ""}
        ORDER BY utility`,
      utility ? [projectId, utility] : [projectId],
    );
    return rows.map((row) => ({
      ...row,
      positions: jsonField(row.positions, {}),
      viewport: jsonField(row.viewport, undefined),
      displays: jsonField(row.displays, {}),
    }));
  }
  if (resource === "project-settings") {
    if (!projectId) throw new Error("projectId is required");
    await ensureProjectSettingsTable();
    const rows = await queryRows<Row>(
      `SELECT project_id AS projectId, payload, updated_at AS updatedAt
         FROM project_settings WHERE project_id = ?
         ORDER BY updated_at DESC LIMIT 1`,
      [projectId],
    );
    if (!rows[0]) return [];
    return [{
      projectId: rows[0].projectId,
      payload: jsonField(rows[0].payload, {}),
      updatedAt: rows[0].updatedAt,
    }];
  }
  throw new Error(`Unknown resource: ${resource}`);
}

async function transaction<T>(work: (connection: PoolConnection) => Promise<T>) {
  const connection = await emsDb.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function saveResource(resource: string, body: Row) {
  if (resource === "accounts") {
    await ensureAccountProjectsSchema();
    await ensureProjectManagerSchema();
    const items = Array.isArray(body.items) ? body.items : [body];
    const session = await getServerSession();
    // Dự án của từng tài khoản trước khi lưu: để áp quy tắc "mỗi dự án một người quản lý" cho dự án mới giao.
    const previousProjects = new Map<string, Set<string>>();
    for (const item of items as Row[]) {
      const rows = await queryRows<Row>("SELECT project_id AS projectId FROM account_projects WHERE account_id = ?", [
        asString(item.id),
      ]);
      previousProjects.set(asString(item.id), new Set(rows.map((row) => asString(row.projectId))));
    }
    await transaction(async (connection) => {
      for (const item of items as Row[]) {
        const rawPassword = asString(item.password).trim();
        const insertPassword = rawPassword || "123456";
        const role = normalizeAccountRole(asString(item.role));
        const [found] = await connection.execute<RowDataPacket[]>(
          "SELECT password_hash AS passwordHash, role FROM accounts WHERE id = ? LIMIT 1",
          [item.id],
        );
        const existingRole = found[0] ? normalizeAccountRole(asString(found[0].role)) : null;
        if (existingRole && existingRole !== role) {
          // Đổi vai trò: chỉ người cấp cao hơn tài khoản đó mới được làm, không ai tự đổi vai trò của mình.
          if (session?.userId === asString(item.id)) {
            throw new UserFacingError("Bạn không thể tự thay đổi vai trò của chính mình.");
          }
          if (!canManageAccountRole(session, { id: asString(item.id), role: existingRole })) {
            throw new UserFacingError("Chỉ người có cấp cao hơn mới được thay đổi vai trò của tài khoản này.");
          }
        }
        if (rawPassword) {
          const currentHash = found[0] ? asString(found[0].passwordHash).toLowerCase() : null;
          // Admin "Đặt lại mật khẩu" (route này chỉ Admin gọi được) thì bỏ qua bước kiểm tra mật khẩu cũ.
          const isReset = item.resetPassword === true;
          if (currentHash && !isReset) {
            // Đổi mật khẩu tài khoản đã có: bắt buộc đúng mật khẩu hiện tại (so sánh hash ở Node, không so chuỗi trong SQL).
            const currentPassword = asString(item.currentPassword);
            if (!currentPassword) throw new UserFacingError("Vui lòng nhập mật khẩu hiện tại.");
            const provided = createHash("sha256").update(currentPassword, "utf8").digest("hex");
            if (provided !== currentHash) throw new UserFacingError("Mật khẩu hiện tại không đúng.");
          }
          // Mật khẩu của tài khoản đã có bị đổi: đăng xuất các phiên cũ của tài khoản đó
          // (trừ khi đang tự đổi cho chính mình, để không tự đăng xuất).
          if (currentHash && session?.userId !== asString(item.id)) {
            await connection.execute("DELETE FROM auth_sessions WHERE portal = 'admin' AND user_id = ?", [item.id]);
          }
        }
        // Đổi mật khẩu khi có nhập: cờ số thay cho `? = ''` (tránh lỗi trộn collation trên MariaDB Hostinger).
        await connection.execute(
          `INSERT INTO accounts (id, username, email, role, password_hash, created_at)
           VALUES (?, ?, ?, ?, SHA2(?, 256), STR_TO_DATE(?, '%d/%m/%Y'))
           ON DUPLICATE KEY UPDATE username=VALUES(username), email=VALUES(email),
             role=VALUES(role), created_at=VALUES(created_at),
             password_hash=IF(? = 1, SHA2(?, 256), password_hash)`,
          [item.id, item.username, item.email, role, insertPassword, item.createdAt, rawPassword ? 1 : 0, rawPassword],
        );
        // Họ tên / SĐT chỉ cập nhật khi client gửi trường đó (lưu hàng loạt từ luồng cũ không làm mất dữ liệu).
        const hasFullName = Object.prototype.hasOwnProperty.call(item, "fullName");
        const hasPhone = Object.prototype.hasOwnProperty.call(item, "phone");
        if (hasFullName || hasPhone) {
          await connection.execute(
            `UPDATE accounts SET full_name = IF(? = 1, ?, full_name), phone = IF(? = 1, ?, phone) WHERE id = ?`,
            [
              hasFullName ? 1 : 0,
              asString(item.fullName).trim() || null,
              hasPhone ? 1 : 0,
              asString(item.phone).trim() || null,
              item.id,
            ],
          );
        }
        if (role === "Admin" || Array.isArray(item.projectIds)) {
          await connection.execute("DELETE FROM account_projects WHERE account_id = ?", [item.id]);
        }
        if (role === "Manage" && Array.isArray(item.projectIds)) {
          const uniqueProjectIds = Array.from(
            new Set(item.projectIds.map((pid: unknown) => asString(pid).trim()).filter(Boolean)),
          );
          for (const pid of uniqueProjectIds) {
            await connection.execute(
              "INSERT IGNORE INTO account_projects (account_id, project_id) VALUES (?, ?)",
              [item.id, pid],
            );
          }
        }
      }
    });
    // Mỗi dự án một người quản lý: dự án vừa giao cho tài khoản Manage này thì gỡ người cũ;
    // dự án bị bỏ khỏi tài khoản thì cập nhật lại thông tin liên hệ.
    const today = vietnamNow().date;
    for (const item of items as Row[]) {
      const accountId = asString(item.id);
      const role = normalizeAccountRole(asString(item.role));
      const before = previousProjects.get(accountId) ?? new Set<string>();
      const after = new Set(
        role === "Manage" && Array.isArray(item.projectIds)
          ? (item.projectIds as unknown[]).map((pid) => asString(pid).trim()).filter(Boolean)
          : role === "Admin"
            ? []
            : [...before],
      );
      for (const pid of after) {
        if (!before.has(pid)) await setProjectManager(pid, accountId, today);
        else await syncProjectContact(pid);
      }
      for (const pid of before) {
        if (!after.has(pid)) await syncProjectContact(pid);
      }
    }
    return getAccounts();
  }
  if (resource === "project-managers" && !Array.isArray(body.accountIds)) {
    await ensureAccountProjectsSchema();
    const projectId = asString(body.projectId).trim();
    if (!projectId) throw new UserFacingError("Thiếu mã dự án.");
    return setProjectManager(projectId, asString(body.accountId).trim() || null, asString(body.startDate));
  }
  if (resource === "project-managers") {
    await ensureAccountProjectsSchema();
    const projectId = asString(body.projectId).trim();
    if (!projectId) throw new UserFacingError("Thiếu mã dự án.");
    const requested = new Set(
      (Array.isArray(body.accountIds) ? body.accountIds : []).map((id: unknown) => asString(id).trim()).filter(Boolean),
    );
    const managerIds = (await getProjectManagers(projectId)).map((item) => item.id);
    await transaction(async (connection) => {
      // Chỉ thay phần gán của các tài khoản Manage cho đúng dự án này, không đụng tới dự án khác.
      for (const accountId of managerIds) {
        if (requested.has(accountId)) {
          await connection.execute(
            "INSERT IGNORE INTO account_projects (account_id, project_id) VALUES (?, ?)",
            [accountId, projectId],
          );
        } else {
          await connection.execute(
            "DELETE FROM account_projects WHERE account_id = ? AND project_id = ?",
            [accountId, projectId],
          );
        }
      }
    });
    return getProjectManagers(projectId);
  }
  if (resource === "customer-accounts") {
    await ensureCustomerAccountsSchema();
    const rawPassword = asString(body.password).trim();
    const insertPassword = rawPassword || "123456";
    const role = asString(body.role).trim() || "Admin";
    await emsDb.execute(
      `INSERT INTO customer_accounts (id, username, email, display_name, role, project_id, password_hash)
       VALUES (?, ?, ?, ?, ?, ?, SHA2(?, 256))
       ON DUPLICATE KEY UPDATE username=VALUES(username), email=VALUES(email),
         display_name=VALUES(display_name), role=VALUES(role), project_id=VALUES(project_id),
         password_hash=IF(? = 1, SHA2(?, 256), password_hash)`,
      [body.id, body.username, body.email, body.displayName, role, body.projectId, insertPassword, rawPassword ? 1 : 0, rawPassword],
    );
    return getResource(resource, new NextRequest("http://localhost/api/ems/customer-accounts"));
  }
  if (resource === "projects") {
    if (Array.isArray(body.items)) {
      for (const item of body.items as Row[]) await saveResource(resource, item);
      return getProjects();
    }
    const meterTypes = Array.isArray(body.meterTypes) ? body.meterTypes.filter(Boolean) as string[] : [];
    const recipients = Array.isArray(body.recipients) ? body.recipients as Row[] : [];
    await ensureRecipientChannelsColumn();
    await ensureNotifierSchema();
    const startDate = projectDateForDb(body.startDate);
    if (!startDate) throw new Error("startDate must use YYYY-MM-DD or DD/MM/YYYY format");
    const [existingProject] = await queryRows<Row>("SELECT id FROM projects WHERE id = ? LIMIT 1", [body.id]);
    await transaction(async (connection) => {
      await connection.execute(
        `INSERT INTO projects (id, initials, accent, name, customer, status, start_date,
           contact_name, phone, email, address, logo_url)
         VALUES (?, ?, ?, ?, ?, ?, STR_TO_DATE(?, '%Y-%m-%d'),
           ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE initials=VALUES(initials), accent=VALUES(accent),
           name=VALUES(name), customer=VALUES(customer), status=VALUES(status),
           start_date=VALUES(start_date), contact_name=VALUES(contact_name),
           phone=VALUES(phone), email=VALUES(email), address=VALUES(address),
           logo_url=VALUES(logo_url)`,
        [body.id, body.initials, body.accent, body.name, body.customer, body.status,
          startDate, body.contactName || null, body.phone || null,
          body.email || null, body.address || null, body.logoUrl || null],
      );
      await connection.execute("DELETE FROM project_meter_types WHERE project_id = ?", [body.id]);
      for (const meterType of meterTypes) {
        await connection.execute(
          `INSERT IGNORE INTO meter_types (name, description, icon, builtin)
           VALUES (?, 'Loại điểm đo tùy chỉnh', 'generic', 0)`,
          [meterType],
        );
        await connection.execute(
          "INSERT IGNORE INTO project_meter_types (project_id, meter_type_name) VALUES (?, ?)",
          [body.id, meterType],
        );
      }
      await connection.execute("DELETE FROM alert_recipients WHERE project_id = ?", [body.id]);
      for (const recipient of recipients) {
        if (!recipient.name && !recipient.email && !recipient.phone) continue;
        await connection.execute(
          `INSERT INTO alert_recipients (id, project_id, name, email, phone, channels, telegram_chat_id, zalo_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            recipientKey(recipient.id),
            body.id,
            recipient.name || "",
            recipient.email || "",
            recipient.phone || "",
            cleanChannels(recipient.channels).join(","),
            asString(recipient.telegramChatId).trim().slice(0, 64) || null,
            asString(recipient.zaloUserId).trim().slice(0, 64) || null,
          ],
        );
      }
    });
    const session = await getServerSession();
    if (session?.portal === "admin" && !isAdminRole(session)) {
      await ensureAccountProjectsSchema();
      if (!existingProject) {
        // Tài khoản Manage tự tạo dự án thì là người quản lý dự án đó.
        await setProjectManager(asString(body.id), session.userId, vietnamNow().date);
      } else {
        await emsDb.execute(
          "INSERT IGNORE INTO account_projects (account_id, project_id) VALUES (?, ?)",
          [session.userId, body.id],
        );
      }
    }
    // Thông tin liên hệ luôn theo người quản lý (nếu dự án đã có người quản lý).
    await ensureAccountProjectsSchema();
    await syncProjectContact(asString(body.id), undefined, { keepIfNone: true });
    if (!existingProject) {
      // Thông báo (chuông) cho các quản trị viên: có dự án mới được khởi tạo.
      await ensureProjectEventsSchema();
      await addProjectEvent(emsDb, {
        type: "project_created",
        projectId: asString(body.id),
        projectName: asString(body.name) || asString(body.id),
        actor: session,
      });
    }
    return getProjects(asString(body.id));
  }
  if (resource === "devices") {
    await ensureDeviceColumns();
    await ensureMeterCatalogSchema();
    if (Array.isArray(body.items)) {
      for (const item of body.items as Row[]) await saveResource(resource, item);
      return getResource(resource, new NextRequest("http://localhost/api/ems/devices"));
    }
    const [previousDevice] = await queryRows<Row>("SELECT serial_number AS sn FROM devices WHERE id = ?", [
      asString(body.id),
    ]);
    if (previousDevice) {
      // Đồng hồ đang gắn vào điểm đo của dự án: khoá chỉnh sửa (đổi serial / model sẽ làm lệch dữ liệu đã đo).
      const linked = (await deviceProjectLinks()).get(asString(body.id)) ?? [];
      if (linked.length > 0) {
        const where = linked.map((item) => `${item.projectName} (${item.meterName})`).join(", ");
        throw new UserFacingError(
          `Đồng hồ đang được gắn tại: ${where}. Không thể chỉnh sửa khi đồng hồ đang gắn vào dự án — hãy gỡ đồng hồ khỏi điểm đo trước.`,
        );
      }
    }
    await emsDb.execute(
      `INSERT INTO devices
        (id, name, serial_number, brand_model, brand, device_type, category, kind, status,
         last_sync_label, protocol, notes, image, extra_fields, registers, model_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), serial_number=VALUES(serial_number),
         brand_model=VALUES(brand_model), brand=VALUES(brand), device_type=VALUES(device_type),
         category=VALUES(category), kind=VALUES(kind), status=VALUES(status),
         last_sync_label=VALUES(last_sync_label), protocol=VALUES(protocol), notes=VALUES(notes),
         image=VALUES(image), extra_fields=VALUES(extra_fields), registers=VALUES(registers),
         model_id=VALUES(model_id)`,
      [body.id, body.name, body.sn, body.brandModel, body.brand, body.type, body.category || null,
        body.kind, body.status, body.lastSync, body.protocol || null, body.notes || null,
        body.image || null,
        body.extraFields ? JSON.stringify(body.extraFields) : null,
        body.registers ? JSON.stringify(body.registers) : null,
        asString(body.modelId) || null],
    );
    // Điểm đo lưu kèm serial của thiết bị đã chọn: đổi serial ở trang Thiết bị thì cập nhật theo.
    const oldSerial = asString(previousDevice?.sn).trim();
    const newSerial = asString(body.sn).trim();
    if (oldSerial && newSerial && oldSerial !== newSerial) {
      await emsDb.execute(
        "UPDATE meter_points SET serial_number = ? WHERE device_id = ? AND TRIM(serial_number) = ?",
        [newSerial, asString(body.id), oldSerial],
      );
    }
    return getResource(resource, new NextRequest("http://localhost/api/ems/devices"));
  }
  if (resource === "meter-types") {
    await ensureMeterCatalogSchema();
    const previousName = asString(body.previousName);
    const name = asString(body.name).trim();
    if (!name) throw new Error("Tên loại điểm đo không được để trống.");
    // Chỉ cập nhật mã nhận dạng khi client gửi trường gatewayCode (các luồng cũ không gửi → giữ nguyên).
    const hasGatewayCode = Object.prototype.hasOwnProperty.call(body, "gatewayCode");
    const gatewayCode = hasGatewayCode ? parseTypeCode(body.gatewayCode) : null;
    if (hasGatewayCode) await assertTypeCodeAvailable(previousName || name, gatewayCode);
    await transaction(async (connection) => {
      if (previousName && previousName !== name) {
        await connection.execute(
          `INSERT INTO meter_types (name, description, icon, builtin)
           SELECT ?, description, icon, builtin FROM meter_types WHERE name = ?
           ON DUPLICATE KEY UPDATE description=VALUES(description)`,
          [name, previousName],
        );
        await connection.execute("UPDATE project_meter_types SET meter_type_name = ? WHERE meter_type_name = ?", [name, previousName]);
        await connection.execute("UPDATE meter_models SET meter_type_name = ? WHERE meter_type_name = ?", [name, previousName]);
        await connection.execute("UPDATE devices SET device_type = ? WHERE device_type = ?", [name, previousName]);
        await connection.execute(
          "UPDATE meter_types SET gateway_code = (SELECT code FROM (SELECT gateway_code AS code FROM meter_types WHERE name = ?) prev) WHERE name = ?",
          [previousName, name],
        );
        await connection.execute("DELETE FROM meter_types WHERE name = ? AND builtin = 0", [previousName]);
      } else {
        await connection.execute(
          `INSERT INTO meter_types (name, description, icon, builtin) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE description=VALUES(description), icon=VALUES(icon), builtin=VALUES(builtin)`,
          [name, body.description || "Loại điểm đo tùy chỉnh", body.icon || "generic", body.builtin ? 1 : 0],
        );
      }
      if (hasGatewayCode) {
        await connection.execute("UPDATE meter_types SET gateway_code = ? WHERE name = ?", [gatewayCode, name]);
      }
    });
    invalidateCatalogCache();
    return getResource(resource, new NextRequest("http://localhost/api/ems/meter-types"));
  }
  if (resource === "client-meters") {
    const projectId = asString(body.projectId);
    const meters = Array.isArray(body.meters) ? body.meters as Row[] : [];
    if (!projectId) throw new Error("projectId is required");
    {
      const serialDevices = await queryRows<Row>("SELECT id, serial_number AS sn FROM devices").catch(() => [] as Row[]);
      const snByDevice = new Map(serialDevices.map((d) => [String(d.id), asString(d.sn)]));
      const effectiveSerial = (serial: unknown, deviceId: unknown) =>
        normalizeSerial(serial) || normalizeSerial(snByDevice.get(asString(deviceId)) ?? "");
      // Chỉ kiểm tra serial mới hoặc vừa đổi: dữ liệu cũ đã trùng không chặn các lần lưu khác của dự án.
      const currentRows = await queryRows<Row>(
        "SELECT id, serial_number AS serialNumber, device_id AS deviceId FROM meter_points WHERE project_id = ?",
        [projectId],
      ).catch(() => [] as Row[]);
      const currentSerial = new Map(
        currentRows.map((row) => [asString(row.id), effectiveSerial(row.serialNumber, row.deviceId).toLowerCase()]),
      );
      const serials = meters
        .map((meter) => effectiveSerial(meter.serialNumber, meter.deviceId))
        .filter((serial, index) => serial && currentSerial.get(asString(meters[index].id)) !== serial.toLowerCase());
      const [conflict] = await findSerialConflicts(projectId, serials);
      if (conflict) throw new UserFacingError(serialConflictMessage(conflict));

      // Trong cùng dự án: một đồng hồ chỉ được gắn cho MỘT điểm đo (gắn 2 điểm đo thì dữ liệu bị tính 2 lần).
      // Chỉ chặn khi có điểm đo vừa gắn / vừa đổi sang đồng hồ đó, để dữ liệu cũ đã trùng không chặn lần lưu khác.
      const pointsBySerial = new Map<string, { name: string; changed: boolean }[]>();
      meters.forEach((meter) => {
        const serial = effectiveSerial(meter.serialNumber, meter.deviceId);
        if (!serial) return;
        const key = serial.toLowerCase();
        const list = pointsBySerial.get(key) ?? [];
        list.push({
          name: asString(meter.name) || asString(meter.code) || asString(meter.id),
          changed: currentSerial.get(asString(meter.id)) !== key,
        });
        pointsBySerial.set(key, list);
      });
      for (const [serial, points] of pointsBySerial) {
        if (points.length > 1 && points.some((point) => point.changed)) {
          throw new UserFacingError(
            `Đồng hồ serial ${serial} đang được gắn cho ${points.length} điểm đo (${points
              .map((point) => `"${point.name}"`)
              .join(", ")}). Mỗi đồng hồ chỉ được gắn cho một điểm đo.`,
          );
        }
      }
    }
    await emsDb
      .query(
        `CREATE TABLE IF NOT EXISTS meter_point_history (
           id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
           project_id VARCHAR(64) NOT NULL,
           meter_point_id VARCHAR(100) NOT NULL,
           category VARCHAR(100) NULL,
           serial_number VARCHAR(100) NOT NULL,
           valid_from DATETIME NOT NULL DEFAULT '2020-01-01 00:00:00',
           valid_to DATETIME NULL,
           PRIMARY KEY (id),
           KEY idx_mph_point (project_id, meter_point_id, valid_from)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      )
      .catch(() => undefined);

    const existingPoints = await queryRows<Row>(
      `SELECT mp.id, COALESCE(NULLIF(TRIM(mp.serial_number), ''), d.serial_number) AS serialNumber, d.category
         FROM meter_points mp
         LEFT JOIN devices d ON d.id = mp.device_id
        WHERE mp.project_id = ?`,
      [projectId],
    ).catch(() => [] as Row[]);
    const allDevices = await queryRows<Row>(
      `SELECT id, serial_number AS sn, category FROM devices`,
    ).catch(() => [] as Row[]);
    const deviceById = new Map(allDevices.map((d) => [String(d.id), d]));
    const oldByPoint = new Map(existingPoints.map((p) => [String(p.id), p]));

    await transaction(async (connection) => {
      for (const meter of meters) {
        const pointId = asString(meter.id);
        const dev = meter.deviceId ? deviceById.get(asString(meter.deviceId)) : undefined;
        const newSerial = (asString(meter.serialNumber).trim() || asString(dev?.sn).trim()).replace(/^SN:\s*/i, "");
        const newCat = asString(dev?.category).trim() || "PM2230";
        const prev = oldByPoint.get(pointId);
        const oldSerial = prev ? asString(prev.serialNumber).trim().replace(/^SN:\s*/i, "") : "";
        const oldCat = prev ? asString(prev.category).trim() || "PM2230" : "PM2230";

        if (oldSerial && !newSerial) {
          // Gỡ đồng hồ khỏi điểm đo: giữ dữ liệu cũ (tới thời điểm gỡ), dữ liệu mới không tính cho điểm đo này nữa.
          const [closed] = await connection.execute(
            `UPDATE meter_point_history
                SET valid_to = UTC_TIMESTAMP()
              WHERE project_id = ? AND meter_point_id = ? AND serial_number = ? AND valid_to IS NULL`,
            [projectId, pointId, oldSerial],
          );
          if (((closed as { affectedRows?: number }).affectedRows ?? 0) === 0) {
            const [[lastRow]] = await connection.query<RowDataPacket[]>(
              `SELECT DATE_FORMAT(MAX(valid_to), '%Y-%m-%d %H:%i:%s') AS lastTo
                 FROM meter_point_history WHERE project_id = ? AND meter_point_id = ?`,
              [projectId, pointId],
            );
            await connection.execute(
              `INSERT INTO meter_point_history (project_id, meter_point_id, category, serial_number, valid_from, valid_to)
               VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
              [projectId, pointId, oldCat, oldSerial, asString(lastRow?.lastTo) || "2020-01-01 00:00:00"],
            );
          }
        }
        if (oldSerial && newSerial && oldSerial !== newSerial) {
          // Đóng hiệu lực của đồng hồ cũ tại thời điểm thay thế
          const [updated] = await connection.execute(
            `UPDATE meter_point_history
                SET valid_to = UTC_TIMESTAMP()
              WHERE project_id = ? AND meter_point_id = ? AND serial_number = ? AND valid_to IS NULL`,
            [projectId, pointId, oldSerial],
          );
          const affected = (updated as { affectedRows?: number }).affectedRows ?? 0;
          if (affected === 0) {
            await connection.execute(
              `INSERT INTO meter_point_history (project_id, meter_point_id, category, serial_number, valid_from, valid_to)
               VALUES (?, ?, ?, ?, '2020-01-01 00:00:00', UTC_TIMESTAMP())`,
              [projectId, pointId, oldCat, oldSerial],
            );
          }
          // Mở hiệu lực cho đồng hồ mới
          await connection.execute(
            `INSERT INTO meter_point_history (project_id, meter_point_id, category, serial_number, valid_from, valid_to)
             VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), NULL)`,
            [projectId, pointId, newCat, newSerial],
          );
        }
      }

      await connection.execute("DELETE FROM meter_points WHERE project_id = ?", [projectId]);
      const parents = meters.filter((meter) => !meter.parentId);
      const children = meters.filter((meter) => meter.parentId);
      for (const meter of [...parents, ...children]) {
        const dev = meter.deviceId ? deviceById.get(asString(meter.deviceId)) : undefined;
        const resolvedSerial = asString(meter.serialNumber).trim() || asString(dev?.sn).trim() || null;
        await connection.execute(
          `INSERT INTO meter_points
             (id, project_id, name, code, device_type, parent_id, utility, device_id, serial_number)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [meter.id, projectId, meter.name, meter.code, meter.type, meter.parentId || null,
            meter.utility, meter.deviceId || null, resolvedSerial],
        );
      }
    });
    return getResource(resource, new NextRequest(`http://localhost/api/ems/client-meters?projectId=${encodeURIComponent(projectId)}`));
  }
  if (resource === "emission-factors") {
    const group = body;
    const gases = Array.isArray(group.gases) ? group.gases as Row[] : [];
    await ensureEmissionFactorOrdering();
    await transaction(async (connection) => {
      await connection.execute(
        `INSERT INTO emission_factor_groups (id, name, source) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name=VALUES(name), source=VALUES(source)`,
        [group.id, group.name, group.source || ""],
      );
      await connection.execute("DELETE FROM emission_factor_gases WHERE group_id = ?", [group.id]);
      for (const [index, gas] of gases.entries()) {
        await connection.execute(
          `INSERT INTO emission_factor_gases (group_id, gas_key, gas_label, factor_value, unit, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE gas_label=VALUES(gas_label), factor_value=VALUES(factor_value), unit=VALUES(unit),
             sort_order=VALUES(sort_order)`,
          [group.id, gas.key, gas.label, asNumber(gas.value), gas.unit || "", index],
        );
      }
    });
    return getResource(resource, new NextRequest("http://localhost/api/ems/emission-factors"));
  }
  if (resource === "ghg-sources") {
    await ensureGhgColumns();
    await ensureEmissionFactorOrdering();
    const projectId = asString(body.projectId);
    const sources = Array.isArray(body.sources) ? body.sources as Row[] : [];
    if (!projectId) throw new Error("projectId is required");
    await transaction(async (connection) => {
      await connection.execute("DELETE FROM ghg_emission_sources WHERE project_id = ?", [projectId]);
      for (const source of sources) {
        const factorId = asString(source.factorId);
        const [rawGroupId, rawGasKey] = factorId.split(":");
        const factorGroupId =
          !rawGroupId || rawGroupId === "none" ? null : rawGroupId;
        const gasKey = !rawGasKey || rawGasKey === "none" ? null : rawGasKey;
        const multipliers = asMultipliers(source.multipliers);
        const manualMonthly = asManualMonthly(source.manualMonthly);
        await connection.execute(
          `INSERT INTO ghg_emission_sources
            (id, project_id, scope_id, name, input_method, factor_group_id, gas_key,
             factor_value, formula, multipliers_json, applied_at, meter_point_id,
             manual_value, manual_unit, manual_monthly_json, tons_co2e)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [source.id, projectId, asNumber(source.scope), source.name, source.method,
            factorGroupId, gasKey, asNumber(source.factorValue),
            source.formula || "", multipliers.length ? JSON.stringify(multipliers) : null,
            source.appliedAt, asString(source.meterPointId) || null,
            source.manualValue == null ? null : asNumber(source.manualValue),
            asString(source.manualUnit) || null,
            manualMonthly ? JSON.stringify(manualMonthly) : null,
            source.tons == null ? null : asNumber(source.tons)],
        );
      }
    });
    return getResource(resource, new NextRequest(`http://localhost/api/ems/ghg-sources?projectId=${encodeURIComponent(projectId)}`));
  }
  if (resource === "alert-events") {
    const id = asString(body.id);
    const projectId = asString(body.projectId);
    if (!id || !projectId) throw new Error("id and projectId are required");
    await emsDb.execute(
      `UPDATE alert_events
          SET status = COALESCE(?, status), note = ?, category = COALESCE(?, category),
              message = COALESCE(?, message), threshold_value = COALESCE(?, threshold_value),
              acknowledged_by = ?, acknowledged_at = ?
        WHERE id = ? AND project_id = ?`,
      [body.status || null, body.note ?? null, body.category || null, body.message || null,
        body.thresholdValue == null ? null : asNumber(body.thresholdValue), body.acknowledgedBy || null,
        body.acknowledgedAt || null, id, projectId],
    );
    return getResource(resource, new NextRequest(`http://localhost/api/ems/alert-events?projectId=${encodeURIComponent(projectId)}`));
  }
  if (resource === "diagram-states") {
    const projectId = asString(body.projectId);
    const utility = asString(body.utility);
    if (!projectId || !utility) throw new Error("projectId and utility are required");
    await ensureDiagramDisplaysColumn();
    await emsDb.execute(
      `INSERT INTO diagram_states (project_id, utility, positions, viewport, displays)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         positions=VALUES(positions),
         viewport=VALUES(viewport),
         displays=VALUES(displays)`,
      [
        projectId,
        utility,
        JSON.stringify(body.positions ?? {}),
        body.viewport ? JSON.stringify(body.viewport) : null,
        body.displays ? JSON.stringify(body.displays) : null,
      ],
    );
    return getResource(resource, new NextRequest(`http://localhost/api/ems/diagram-states?projectId=${encodeURIComponent(projectId)}&utility=${encodeURIComponent(utility)}`));
  }
  if (resource === "project-settings") {
    const projectId = asString(body.projectId);
    if (!projectId) throw new Error("projectId is required");
    await ensureProjectSettingsTable();
    const existing = await queryRows<Row>(
      `SELECT payload FROM project_settings WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [projectId],
    );
    const current = jsonField<Row>(existing[0]?.payload, {});
    const incoming =
      body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
        ? (body.payload as Row)
        : jsonField<Row>(body.payload, {});
    const merged = { ...current, ...incoming };
    const payload = JSON.stringify(merged);
    await emsDb.execute(
      `INSERT INTO project_settings (project_id, payload) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
      [projectId, payload],
    );
    resetAlertEvalThrottle(projectId);
    void evaluateProjectAlerts(projectId);
    return getResource(resource, new NextRequest(`http://localhost/api/ems/project-settings?projectId=${encodeURIComponent(projectId)}`));
  }
  throw new Error(`Unknown resource: ${resource}`);
}

async function deleteResource(resource: string, request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) throw new Error("id is required");
  const tables: Record<string, string> = {
    accounts: "accounts",
    devices: "devices",
    "emission-factors": "emission_factor_groups",
    "meter-types": "meter_types",
    "customer-accounts": "customer_accounts",
    "ghg-sources": "ghg_emission_sources",
  };
  if (resource === "diagram-states") {
    const projectId = request.nextUrl.searchParams.get("projectId");
    const utility = request.nextUrl.searchParams.get("utility");
    if (!projectId || !utility) throw new Error("projectId and utility are required");
    await emsDb.execute("DELETE FROM diagram_states WHERE project_id = ? AND utility = ?", [projectId, utility]);
    return { ok: true };
  }
  if (resource === "projects") {
    // Không xoá trực tiếp: DELETE /projects tạo yêu cầu xoá, dự án chỉ bị xoá khi một Admin khác duyệt.
    throw new UserFacingError("Xoá dự án phải qua yêu cầu và được Admin khác duyệt.");
  }
  const table = tables[resource];
  if (!table) throw new Error(`Delete is not supported for ${resource}`);
  const key = resource === "emission-factors" ? "id" : resource === "meter-types" ? "name" : "id";
  if (resource === "meter-types") {
    const [typeRow] = await queryRows<Row>("SELECT builtin FROM meter_types WHERE name = ? LIMIT 1", [id]);
    if (typeRow && Number(typeRow.builtin)) {
      throw new UserFacingError("Không thể xóa loại đồng hồ mặc định (chỉ sửa mô tả và mã nhận dạng).");
    }
    await assertTypeDeletable(id);
    invalidateCatalogCache();
  }
  if (resource === "devices") {
    await ensureDeviceColumns();
    const linked = (await deviceProjectLinks()).get(id) ?? [];
    if (linked.length > 0) {
      const names = linked.map((item) => `${item.projectName} (${item.meterName})`).join(", ");
      throw new UserFacingError(
        `Đồng hồ đang được gắn trong dự án: ${names}. Hãy gỡ đồng hồ khỏi điểm đo trong dự án trước khi xóa.`,
      );
    }
  }
  if (resource === "accounts") {
    await ensureAccountProjectsSchema();
    const ownProjects = await queryRows<Row>("SELECT project_id AS projectId FROM account_projects WHERE account_id = ?", [id]);
    await emsDb.execute("DELETE FROM account_projects WHERE account_id = ?", [id]);
    for (const row of ownProjects) await syncProjectContact(asString(row.projectId));
    await emsDb.execute("DELETE FROM auth_sessions WHERE portal = 'admin' AND user_id = ?", [id]);
  }
  if (resource === "customer-accounts") {
    await emsDb.execute("DELETE FROM auth_sessions WHERE portal = 'customer' AND user_id = ?", [id]);
  }
  if (resource === "emission-factors") {
    await emsDb.execute("DELETE FROM emission_factor_gases WHERE group_id = ?", [id]);
  }
  await emsDb.execute(`DELETE FROM ${table} WHERE ${key} = ?`, [id]);
  return { ok: true };
}

export async function GET(request: NextRequest, context: Params) {
  try {
    const resource = await resourceName(context);
    if (!RESOURCE_NAMES.has(resource)) return badRequest("Tài nguyên không hợp lệ.");
    if (resource === "notifications") {
      const gate = await requirePermission("viewProjects");
      if (!gate.ok || !gate.session) return forbidden();
      return Response.json(await listNotifications(gate.session));
    }
    if (resource === "notification-settings" || resource === "telegram-chats" || resource === "notification-test") {
      const gate = await requirePermission("manageUsers");
      if (!gate.ok) return forbidden("Chỉ Quản trị viên được cấu hình thông báo.");
      if (resource === "notification-settings") return Response.json(await getMaskedSettings());
      if (resource === "telegram-chats") {
        try {
          return Response.json(await listTelegramChats());
        } catch (error) {
          return badRequest(error instanceof Error ? error.message : "Không lấy được danh sách Telegram.");
        }
      }
      return badRequest("Dùng POST để gửi thử.");
    }
    if (resource === "project-managers") {
      const gate = await requirePermission("viewProjects");
      const projectId = request.nextUrl.searchParams.get("projectId") ?? "";
      if (!gate.ok || !canAccessAdminProject(gate.session, projectId)) return forbidden();
    }
    if (resource === "meter-replacements") {
      const gate = await requirePermission("viewProjects");
      const projectId = request.nextUrl.searchParams.get("projectId") ?? "";
      if (!gate.ok || !canAccessAdminProject(gate.session, projectId)) return forbidden();
      return Response.json(await listMeterReplacements(projectId));
    }
    return Response.json(await getResource(resource, request));
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest, context: Params) {
  try {
    const resource = await resourceName(context);
    if (!RESOURCE_NAMES.has(resource)) return badRequest("Tài nguyên không hợp lệ.");
    if (resource === "accounts" || resource === "project-managers") {
      const gate = await requirePermission("manageUsers");
      if (!gate.ok) return forbidden("Chỉ Quản trị viên được quản lý người dùng.");
    }
    const body = (await request.json()) as Row;
    if (resource === "notification-settings" || resource === "notification-test" || resource === "telegram-chats") {
      const gate = await requirePermission("manageUsers");
      if (!gate.ok) return forbidden("Chỉ Quản trị viên được cấu hình thông báo.");
      if (resource === "notification-settings") return Response.json(await saveNotificationSettings(body));
      if (resource === "notification-test") {
        const channel = asString(body.channel) as NotificationChannel;
        if (!["Email", "SMS", "Zalo", "Telegram"].includes(channel)) return badRequest("Kênh không hợp lệ.");
        try {
          return Response.json(await sendTestNotification(channel, asString(body.target)));
        } catch (error) {
          return badRequest(error instanceof Error ? error.message : "Gửi thử thất bại.");
        }
      }
      return badRequest("Dùng GET để lấy danh sách Telegram.");
    }
    if (resource === "notifications") {
      const gate = await requirePermission("viewProjects");
      if (!gate.ok || !gate.session) return forbidden();
      await markNotificationsSeen(gate.session);
      return Response.json(await listNotifications(gate.session));
    }
    if (resource === "project-deletions") {
      const gate = await requirePermission("viewProjects");
      if (!gate.ok || !gate.session) return forbidden();
      const decision = asString(body.decision);
      if (decision !== "approve" && decision !== "reject" && decision !== "cancel") {
        return badRequest("Quyết định không hợp lệ.");
      }
      return Response.json(await decideProjectDeletion(gate.session, Number(body.requestId), decision));
    }
    if (resource === "meter-replacements") {
      const gate = await requirePermission("manageProjects");
      const projectId = asString(body.projectId).trim();
      if (!gate.ok || !canAccessAdminProject(gate.session, projectId)) {
        return forbidden("Bạn không có quyền ghi biên bản thay đồng hồ cho dự án này.");
      }
      try {
        const action = asString(body.action);
        if (action === "undo") return Response.json(await undoMeterReplacement(projectId, Number(body.id)));
        if (action === "dismiss") return Response.json(await dismissResetSuspect(projectId, Number(body.id)));
        if (action === "replace") return Response.json(await recordMeterReplacement(gate.session, projectId, body));
        return badRequest("Thao tác không hợp lệ.");
      } catch (error) {
        if (error instanceof MeterReplacementError) return badRequest(error.message);
        throw error;
      }
    }
    if (resource === "meter-models") {
      const gate = await requirePermission("manageDevices");
      if (!gate.ok) return forbidden("Bạn không có quyền cấu hình loại đồng hồ.");
      return Response.json(await saveMeterModel(body));
    }
    if (resource === "ghg-templates") {
      const gate = await requirePermission("manageEmissionFactors");
      if (!gate.ok) return forbidden("Bạn không có quyền cấu hình nguồn phát thải.");
      await ensureGhgTemplatesTable();
      const name = asString(body.name).trim();
      const unit = asString(body.unit).trim();
      const formula = asString(body.formula).trim();
      if (!name || !unit || !formula) return badRequest("Vui lòng nhập tên nguồn, đơn vị và công thức tính.");
      const defaultValue = body.defaultValue == null || body.defaultValue === "" ? null : Number(body.defaultValue);
      if (defaultValue != null && !Number.isFinite(defaultValue)) return badRequest("Giá trị mặc định không hợp lệ.");
      await emsDb.execute(
        `INSERT INTO ghg_manual_templates (id, name, unit, default_value, factor_group_id, multipliers_json, formula)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), unit = VALUES(unit), default_value = VALUES(default_value),
           factor_group_id = VALUES(factor_group_id), multipliers_json = VALUES(multipliers_json), formula = VALUES(formula)`,
        [
          asString(body.id).trim() || `ghgt-${Date.now()}`,
          name.slice(0, 255),
          unit.slice(0, 40),
          defaultValue,
          asString(body.factorGroupId).trim() || null,
          JSON.stringify(Array.isArray(body.multipliers) ? body.multipliers : []),
          formula.slice(0, 500),
        ],
      );
      return Response.json(await listGhgTemplates());
    }
    return Response.json(await saveResource(resource, body));
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: NextRequest, context: Params) {
  try {
    const resource = await resourceName(context);
    if (!RESOURCE_NAMES.has(resource)) return badRequest("Tài nguyên không hợp lệ.");
    if (resource === "accounts") {
      const gate = await requirePermission("manageUsers");
      if (!gate.ok) return forbidden("Chỉ Quản trị viên được quản lý người dùng.");
      const id = request.nextUrl.searchParams.get("id") ?? "";
      if (id === gate.session?.userId) return forbidden("Bạn không thể tự xoá tài khoản của chính mình.");
      const [target] = await queryRows<Row>("SELECT id, role FROM accounts WHERE id = ? LIMIT 1", [id]);
      if (target && !canManageAccountRole(gate.session, { id, role: asString(target.role) })) {
        return forbidden("Chỉ người có cấp cao hơn mới được xoá tài khoản này.");
      }
    }
    if (resource === "projects") {
      const gate = await requirePermission("manageProjects");
      const id = request.nextUrl.searchParams.get("id") ?? "";
      if (!gate.ok || !gate.session || !canAccessAdminProject(gate.session, id)) return forbidden();
      return Response.json({ pending: true, ...(await requestProjectDeletion(gate.session, id)) });
    }
    if (resource === "meter-models") {
      const gate = await requirePermission("manageDevices");
      if (!gate.ok) return forbidden("Bạn không có quyền cấu hình loại đồng hồ.");
      return Response.json(await deleteMeterModel(request.nextUrl.searchParams.get("id") ?? ""));
    }
    if (resource === "ghg-templates") {
      const gate = await requirePermission("manageEmissionFactors");
      if (!gate.ok) return forbidden("Bạn không có quyền cấu hình nguồn phát thải.");
      await ensureGhgTemplatesTable();
      await emsDb.execute("DELETE FROM ghg_manual_templates WHERE id = ?", [
        request.nextUrl.searchParams.get("id") ?? "",
      ]);
      return Response.json({ ok: true });
    }
    return Response.json(await deleteResource(resource, request));
  } catch (error) {
    return serverError(error);
  }
}
