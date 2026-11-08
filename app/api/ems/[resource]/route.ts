import type { PoolConnection } from "mysql2/promise";
import { NextRequest } from "next/server";
import { normalizeAccountRole } from "@/lib/accounts";
import { getProjectsListTelemetry } from "@/lib/gateway-store";
import { isAdminRole } from "@/lib/permissions";
import { ensureAccountProjectsSchema, ensureCustomerAccountsSchema, getServerSession, requirePermission } from "@/lib/server-auth";
import { emsDb, jsonField, queryRows } from "@/lib/server-db";

type Params = { params: Promise<{ resource: string }> };
type Row = Record<string, any>;

const RESOURCE_NAMES = new Set([
  "accounts",
  "customer-accounts",
  "projects",
  "devices",
  "meter-types",
  "client-meters",
  "emission-factors",
  "ghg-sources",
  "alert-events",
  "meter-readings",
  "diagram-states",
  "project-settings",
  "project-telemetry",
]);

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function forbidden(message = "Không có quyền thực hiện thao tác này.") {
  return Response.json({ error: message }, { status: 403 });
}

function serverError(error: unknown) {
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
let projectSettingsReady: Promise<void> | null = null;
let diagramDisplaysReady: Promise<void> | null = null;

function ensureDiagramDisplaysColumn() {
  if (!diagramDisplaysReady) {
    diagramDisplaysReady = emsDb
      .query(
        `ALTER TABLE diagram_states
           ADD COLUMN IF NOT EXISTS displays JSON NULL AFTER viewport`,
      )
      .then(() => undefined)
      .catch((error) => {
        diagramDisplaysReady = null;
        console.error("diagram_states.displays migrate failed", error);
        return undefined;
      });
  }
  return diagramDisplaysReady;
}

function ensureDeviceColumns() {
  deviceColumnsReady ??= Promise.all([
    emsDb.execute("ALTER TABLE devices MODIFY COLUMN image MEDIUMTEXT NULL").catch(() => undefined),
    emsDb
      .execute(
        `UPDATE devices
            SET name = 'PM2230',
                brand_model = 'Schneider PM2230',
                brand = 'Schneider Electric',
                device_type = 'Đồng hồ điện 3 pha',
                category = 'PM2230'
          WHERE name = 'PM5000' OR brand_model = 'SBANK PM5000'`,
      )
      .catch(() => undefined),
    emsDb
      .execute("DELETE FROM devices WHERE id = 'dev-1791532720603' AND serial_number = '123456'")
      .catch(() => undefined),
    emsDb
      .execute(
        `UPDATE meter_points
            SET code = 'PM2230',
                device_type = 'Schneider PM2230'
          WHERE code = 'PM5000' OR device_type = 'SBANK PM5000'`,
      )
      .catch(() => undefined),
  ]).then(() => undefined);
  return deviceColumnsReady;
}

function ensureProjectSettingsTable() {
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
         ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,
    )
    .catch(() => undefined);
  await emsDb.query("ALTER TABLE project_settings ADD PRIMARY KEY (project_id)").catch(() => undefined);
}

function ensureGhgColumns() {
  ghgColumnsReady ??= Promise.all([
    emsDb.execute(
      "ALTER TABLE ghg_emission_sources ADD COLUMN IF NOT EXISTS multipliers_json JSON NULL",
    ),
    emsDb.execute(
      "ALTER TABLE ghg_emission_sources ADD COLUMN IF NOT EXISTS manual_value DECIMAL(18,6) NULL",
    ),
    emsDb.execute(
      "ALTER TABLE ghg_emission_sources ADD COLUMN IF NOT EXISTS manual_unit VARCHAR(40) NULL",
    ),
    emsDb
      .execute("ALTER TABLE ghg_emission_sources DROP FOREIGN KEY fk_ghg_sources_factor")
      .catch(() => undefined),
    emsDb
      .execute("ALTER TABLE ghg_emission_sources MODIFY COLUMN factor_group_id VARCHAR(100) NULL")
      .catch(() => undefined),
    emsDb
      .execute("ALTER TABLE ghg_emission_sources MODIFY COLUMN gas_key VARCHAR(10) NULL")
      .catch(() => undefined),
  ]).then(() => undefined);
  return ghgColumnsReady;
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
  const [accounts, mappings] = await Promise.all([
    queryRows<Row>(
      `SELECT id, username, email, role, DATE_FORMAT(created_at, '%d/%m/%Y') AS createdAt
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
      role,
      projectIds: role === "Admin" ? [] : (projectsByAccount.get(id) ?? []),
    };
  });
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
  const recipients = await queryRows<Row>(
    `SELECT id, project_id AS projectId, name, email, phone
       FROM alert_recipients WHERE project_id IN (${placeholders})
      ORDER BY project_id, id`,
    ids,
  );
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
    }]);
  }
  return projects.map((project) => ({
    ...project,
    meterTypes: typesByProject.get(project.id as string) ?? [],
    recipients: recipientsByProject.get(project.id as string) ?? [],
  }));
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
  if (resource === "devices") {
    await ensureDeviceColumns();
    const rows = await queryRows<Row>(
      `SELECT id, name, serial_number AS sn, brand_model AS brandModel, brand,
              device_type AS type, category, kind, status, last_sync_label AS lastSync,
              protocol, notes, image, extra_fields AS extraFields, registers
         FROM devices ORDER BY id`,
    );
    return rows.map((row) => ({
      ...row,
      extraFields: jsonField(row.extraFields, undefined),
      registers: jsonField(row.registers, undefined),
    }));
  }
  if (resource === "meter-types") {
    return queryRows<Row>("SELECT name, description, icon, builtin FROM meter_types ORDER BY builtin DESC, name");
  }
  if (resource === "client-meters") {
    if (!projectId) throw new Error("projectId is required");
    await ensureDeviceColumns();
    return queryRows<Row>(
      `SELECT id, name, code, device_type AS type, parent_id AS parentId,
              utility, device_id AS deviceId, serial_number AS serialNumber
         FROM meter_points WHERE project_id = ? ORDER BY id`,
      [projectId],
    );
  }
  if (resource === "emission-factors") {
    const groups = await queryRows<Row>(
      "SELECT id, name, source FROM emission_factor_groups ORDER BY id",
    );
    const gases = await queryRows<Row>(
      `SELECT group_id AS groupId, gas_key AS gasKey, gas_label AS gasLabel,
              factor_value AS value, unit
         FROM emission_factor_gases ORDER BY group_id, gas_key`,
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
    const rows = await queryRows<Row>(
      `SELECT id, project_id AS projectId, scope_id AS scope, name,
              meter_point_id AS meterPointId,
              input_method AS method, factor_group_id AS factorGroupId,
              gas_key AS gasKey, factor_value AS factorValue, formula,
              multipliers_json AS multipliers,
              manual_value AS manualValue, manual_unit AS manualUnit,
              DATE_FORMAT(applied_at, '%Y-%m-%d') AS appliedAt,
              tons_co2e AS tons
         FROM ghg_emission_sources ${projectId ? "WHERE project_id = ?" : ""}
        ORDER BY scope, id`,
      projectId ? [projectId] : [],
    );
    return rows.map((row) => ({
      ...row,
      scope: asNumber(row.scope),
      factorId:
        row.factorGroupId && row.gasKey
          ? `${row.factorGroupId}:${row.gasKey}`
          : "none:none",
      factorValue: asNumber(row.factorValue),
      multipliers: asMultipliers(row.multipliers),
      manualValue: row.manualValue == null ? undefined : asNumber(row.manualValue),
      manualUnit: asString(row.manualUnit) || undefined,
      tons: row.tons == null ? undefined : asNumber(row.tons),
    }));
  }
  if (resource === "alert-events") {
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

    return mappedEvents;
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
    const items = Array.isArray(body.items) ? body.items : [body];
    await transaction(async (connection) => {
      for (const item of items as Row[]) {
        const rawPassword = asString(item.password).trim();
        const insertPassword = rawPassword || "123456";
        const role = normalizeAccountRole(asString(item.role));
        await connection.execute(
          `INSERT INTO accounts (id, username, email, role, password_hash, created_at)
           VALUES (?, ?, ?, ?, SHA2(?, 256), STR_TO_DATE(?, '%d/%m/%Y'))
           ON DUPLICATE KEY UPDATE username=VALUES(username), email=VALUES(email),
             role=VALUES(role), created_at=VALUES(created_at),
             password_hash=IF(? = '', password_hash, SHA2(?, 256))`,
          [item.id, item.username, item.email, role, insertPassword, item.createdAt, rawPassword, rawPassword],
        );
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
    return getAccounts();
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
         password_hash=IF(? = '', password_hash, SHA2(?, 256))`,
      [body.id, body.username, body.email, body.displayName, role, body.projectId, insertPassword, rawPassword, rawPassword],
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
    const startDate = projectDateForDb(body.startDate);
    if (!startDate) throw new Error("startDate must use YYYY-MM-DD or DD/MM/YYYY format");
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
          `INSERT INTO alert_recipients (id, project_id, name, email, phone)
           VALUES (?, ?, ?, ?, ?)`,
          [recipientKey(recipient.id), body.id, recipient.name || "", recipient.email || "", recipient.phone || ""],
        );
      }
    });
    const session = await getServerSession();
    if (session?.portal === "admin" && !isAdminRole(session)) {
      await ensureAccountProjectsSchema();
      await emsDb.execute(
        "INSERT IGNORE INTO account_projects (account_id, project_id) VALUES (?, ?)",
        [session.userId, body.id],
      );
    }
    return getProjects(asString(body.id));
  }
  if (resource === "devices") {
    await ensureDeviceColumns();
    if (Array.isArray(body.items)) {
      for (const item of body.items as Row[]) await saveResource(resource, item);
      return getResource(resource, new NextRequest("http://localhost/api/ems/devices"));
    }
    await emsDb.execute(
      `INSERT INTO devices
        (id, name, serial_number, brand_model, brand, device_type, category, kind, status,
         last_sync_label, protocol, notes, image, extra_fields, registers)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), serial_number=VALUES(serial_number),
         brand_model=VALUES(brand_model), brand=VALUES(brand), device_type=VALUES(device_type),
         category=VALUES(category), kind=VALUES(kind), status=VALUES(status),
         last_sync_label=VALUES(last_sync_label), protocol=VALUES(protocol), notes=VALUES(notes),
         image=VALUES(image), extra_fields=VALUES(extra_fields), registers=VALUES(registers)`,
      [body.id, body.name, body.sn, body.brandModel, body.brand, body.type, body.category || null,
        body.kind, body.status, body.lastSync, body.protocol || null, body.notes || null,
        body.image || null,
        body.extraFields ? JSON.stringify(body.extraFields) : null,
        body.registers ? JSON.stringify(body.registers) : null],
    );
    return getResource(resource, new NextRequest("http://localhost/api/ems/devices"));
  }
  if (resource === "meter-types") {
    const previousName = asString(body.previousName);
    const name = asString(body.name).trim();
    if (!name) throw new Error("Tên loại điểm đo không được để trống.");
    await transaction(async (connection) => {
      if (previousName && previousName !== name) {
        await connection.execute(
          `INSERT INTO meter_types (name, description, icon, builtin)
           SELECT ?, description, icon, builtin FROM meter_types WHERE name = ?
           ON DUPLICATE KEY UPDATE description=VALUES(description)`,
          [name, previousName],
        );
        await connection.execute("UPDATE project_meter_types SET meter_type_name = ? WHERE meter_type_name = ?", [name, previousName]);
        await connection.execute("DELETE FROM meter_types WHERE name = ? AND builtin = 0", [previousName]);
      } else {
        await connection.execute(
          `INSERT INTO meter_types (name, description, icon, builtin) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE description=VALUES(description), icon=VALUES(icon), builtin=VALUES(builtin)`,
          [name, body.description || "Loại điểm đo tùy chỉnh", body.icon || "generic", body.builtin ? 1 : 0],
        );
      }
    });
    return getResource(resource, new NextRequest("http://localhost/api/ems/meter-types"));
  }
  if (resource === "client-meters") {
    const projectId = asString(body.projectId);
    const meters = Array.isArray(body.meters) ? body.meters as Row[] : [];
    if (!projectId) throw new Error("projectId is required");
    await transaction(async (connection) => {
      await connection.execute("DELETE FROM meter_points WHERE project_id = ?", [projectId]);
      const parents = meters.filter((meter) => !meter.parentId);
      const children = meters.filter((meter) => meter.parentId);
      for (const meter of [...parents, ...children]) {
        await connection.execute(
          `INSERT INTO meter_points
             (id, project_id, name, code, device_type, parent_id, utility, device_id, serial_number)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [meter.id, projectId, meter.name, meter.code, meter.type, meter.parentId || null,
            meter.utility, meter.deviceId || null, meter.serialNumber || null],
        );
      }
    });
    return getResource(resource, new NextRequest(`http://localhost/api/ems/client-meters?projectId=${encodeURIComponent(projectId)}`));
  }
  if (resource === "emission-factors") {
    const group = body;
    const gases = Array.isArray(group.gases) ? group.gases as Row[] : [];
    await transaction(async (connection) => {
      await connection.execute(
        `INSERT INTO emission_factor_groups (id, name, source) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name=VALUES(name), source=VALUES(source)`,
        [group.id, group.name, group.source || ""],
      );
      await connection.execute("DELETE FROM emission_factor_gases WHERE group_id = ?", [group.id]);
      for (const gas of gases) {
        await connection.execute(
          `INSERT INTO emission_factor_gases (group_id, gas_key, gas_label, factor_value, unit)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE gas_label=VALUES(gas_label), factor_value=VALUES(factor_value), unit=VALUES(unit)`,
          [group.id, gas.key, gas.label, asNumber(gas.value), gas.unit || ""],
        );
      }
    });
    return getResource(resource, new NextRequest("http://localhost/api/ems/emission-factors"));
  }
  if (resource === "ghg-sources") {
    await ensureGhgColumns();
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
        await connection.execute(
          `INSERT INTO ghg_emission_sources
            (id, project_id, scope_id, name, input_method, factor_group_id, gas_key,
             factor_value, formula, multipliers_json, applied_at, meter_point_id,
             manual_value, manual_unit, tons_co2e)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [source.id, projectId, asNumber(source.scope), source.name, source.method,
            factorGroupId, gasKey, asNumber(source.factorValue),
            source.formula || "", multipliers.length ? JSON.stringify(multipliers) : null,
            source.appliedAt, asString(source.meterPointId) || null,
            source.manualValue == null ? null : asNumber(source.manualValue),
            asString(source.manualUnit) || null,
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
    await ensureAccountProjectsSchema();
    await transaction(async (connection) => {
      await connection.execute("DELETE FROM account_projects WHERE project_id = ?", [id]);
      await connection.execute("UPDATE meter_points SET parent_id = NULL WHERE project_id = ?", [id]);
      await connection.execute("DELETE FROM projects WHERE id = ?", [id]);
    });
    return { ok: true };
  }
  const table = tables[resource];
  if (!table) throw new Error(`Delete is not supported for ${resource}`);
  const key = resource === "emission-factors" ? "id" : resource === "meter-types" ? "name" : "id";
  if (resource === "devices") {
    await ensureDeviceColumns();
    await emsDb.execute("UPDATE meter_points SET device_id = NULL WHERE device_id = ?", [id]);
  }
  if (resource === "accounts") {
    await ensureAccountProjectsSchema();
    await emsDb.execute("DELETE FROM account_projects WHERE account_id = ?", [id]);
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
    return Response.json(await getResource(resource, request));
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest, context: Params) {
  try {
    const resource = await resourceName(context);
    if (!RESOURCE_NAMES.has(resource)) return badRequest("Tài nguyên không hợp lệ.");
    if (resource === "accounts") {
      const gate = await requirePermission("manageUsers");
      if (!gate.ok) return forbidden("Chỉ Quản trị viên được quản lý người dùng.");
    }
    const body = (await request.json()) as Row;
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
    }
    return Response.json(await deleteResource(resource, request));
  } catch (error) {
    return serverError(error);
  }
}
