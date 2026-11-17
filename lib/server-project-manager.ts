import "server-only";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { normalizeAccountRole } from "@/lib/accounts";
import { emsDb, queryRows } from "@/lib/server-db";
import { vietnamNow } from "@/lib/vietnam-time";

/**
 * Người quản lý dự án (tài khoản Manage):
 * - Mỗi dự án chỉ có một người quản lý; giao cho người mới thì các tài khoản Manage khác bị gỡ khỏi dự án.
 * - Ngày bắt đầu ở tương lai: lưu lịch hẹn (project_manager_schedule), đến ngày thì tự chuyển giao.
 * - Thông tin liên hệ của dự án (contact_name / email / phone) luôn lấy theo người quản lý hiện tại.
 * Tài khoản Admin xem mọi dự án nên không nằm trong danh sách người quản lý.
 */

type Row = Record<string, unknown>;

export type ManagerAccount = {
  id: string;
  username: string;
  fullName: string;
  email: string;
  phone: string;
};

export type ManagerHistoryItem = {
  accountId: string | null;
  managerName: string;
  /** "YYYY-MM-DD"; rỗng nếu không rõ (người quản lý từ trước khi có lịch sử). */
  startDate: string;
  /** "YYYY-MM-DD"; rỗng nếu đang quản lý. */
  endDate: string;
};

export type ProjectManagerState = {
  accounts: ManagerAccount[];
  currentId: string | null;
  pending: { accountId: string; startDate: string } | null;
  /** Lịch sử người quản lý, mới nhất trước. */
  history: ManagerHistoryItem[];
};

let schemaReady: Promise<void> | null = null;
let lastScheduleRunAt = 0;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

export function ensureProjectManagerSchema() {
  schemaReady ??= (async () => {
    await emsDb.query("ALTER TABLE accounts ADD COLUMN full_name VARCHAR(150) NULL").catch(() => undefined);
    await emsDb.query("ALTER TABLE accounts ADD COLUMN phone VARCHAR(40) NULL").catch(() => undefined);
    await emsDb.query(
      `CREATE TABLE IF NOT EXISTS project_manager_schedule (
        project_id VARCHAR(64) NOT NULL,
        account_id VARCHAR(64) NOT NULL,
        start_date DATE NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (project_id),
        KEY idx_pm_schedule_date (start_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );
    await emsDb.query(
      `CREATE TABLE IF NOT EXISTS project_manager_history (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        project_id VARCHAR(64) NOT NULL,
        account_id VARCHAR(64) NULL,
        manager_name VARCHAR(200) NOT NULL,
        start_date DATE NULL,
        end_date DATE NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_pm_history_project (project_id, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function todayVn() {
  return vietnamNow().date;
}

async function manageAccounts(): Promise<ManagerAccount[]> {
  const rows = await queryRows<Row>(
    "SELECT id, username, full_name AS fullName, email, phone, role FROM accounts ORDER BY username, id",
  );
  return rows
    .filter((row) => normalizeAccountRole(text(row.role)) === "Manage")
    .map((row) => ({
      id: text(row.id),
      username: text(row.username),
      fullName: text(row.fullName),
      email: text(row.email),
      phone: text(row.phone),
    }));
}

/** Cập nhật thông tin liên hệ dự án theo người quản lý hiện tại (hoặc xóa nếu không còn ai). */
export async function syncProjectContact(
  projectId: string,
  connection?: PoolConnection,
  options?: { keepIfNone?: boolean },
) {
  await ensureProjectManagerSchema();
  const run = (sql: string, params: unknown[]) =>
    connection ? connection.execute<RowDataPacket[]>(sql, params as never) : emsDb.execute<RowDataPacket[]>(sql, params as never);
  const [rows] = await run(
    `SELECT a.username, a.full_name AS fullName, a.email, a.phone, a.role
       FROM account_projects ap JOIN accounts a ON a.id = ap.account_id
      WHERE ap.project_id = ?
      ORDER BY a.username`,
    [projectId],
  );
  const manager = rows.find((row) => normalizeAccountRole(text(row.role)) === "Manage");
  // Dự án cũ chưa có người quản lý: giữ thông tin liên hệ đã nhập tay trước đây.
  if (!manager && options?.keepIfNone) return;
  await run("UPDATE projects SET contact_name = ?, email = ?, phone = ? WHERE id = ?", [
    manager ? text(manager.fullName) || text(manager.username) : null,
    manager ? text(manager.email) || null : null,
    manager ? text(manager.phone) || null : null,
    projectId,
  ]);
}

function displayName(account: Pick<ManagerAccount, "fullName" | "username"> | undefined) {
  return account ? account.fullName || account.username : "";
}

/**
 * Giao ngay: chỉ `accountId` là tài khoản Manage của dự án, các tài khoản Manage khác bị gỡ.
 * Ghi lịch sử: người cũ kết thúc ngày trước `effectiveDate`, người mới bắt đầu từ `effectiveDate`.
 */
async function assignNow(projectId: string, accountId: string | null, effectiveDate: string) {
  const accounts = await manageAccounts();
  const manageIds = accounts.map((item) => item.id);
  const connection = await emsDb.getConnection();
  try {
    await connection.beginTransaction();
    const [assignedRows] = await connection.execute<RowDataPacket[]>(
      "SELECT account_id AS accountId FROM account_projects WHERE project_id = ?",
      [projectId],
    );
    const assignedIds = new Set(assignedRows.map((row) => text(row.accountId)));
    const previous = accounts.find((item) => assignedIds.has(item.id));
    if ((previous?.id ?? null) !== accountId) {
      const [openRows] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM project_manager_history WHERE project_id = ? AND end_date IS NULL ORDER BY id DESC LIMIT 1",
        [projectId],
      );
      if (openRows.length) {
        await connection.execute(
          `UPDATE project_manager_history
              SET end_date = GREATEST(COALESCE(start_date, DATE_SUB(?, INTERVAL 1 DAY)), DATE_SUB(?, INTERVAL 1 DAY))
            WHERE id = ?`,
          [effectiveDate, effectiveDate, openRows[0].id],
        );
      } else if (previous) {
        // Người quản lý từ trước khi có lịch sử: không rõ ngày bắt đầu.
        await connection.execute(
          `INSERT INTO project_manager_history (project_id, account_id, manager_name, start_date, end_date)
           VALUES (?, ?, ?, NULL, DATE_SUB(?, INTERVAL 1 DAY))`,
          [projectId, previous.id, displayName(previous), effectiveDate],
        );
      }
      if (accountId) {
        await connection.execute(
          `INSERT INTO project_manager_history (project_id, account_id, manager_name, start_date, end_date)
           VALUES (?, ?, ?, ?, NULL)`,
          [projectId, accountId, displayName(accounts.find((item) => item.id === accountId)) || accountId, effectiveDate],
        );
      }
    }
    const removeIds = manageIds.filter((id) => id !== accountId);
    if (removeIds.length) {
      await connection.execute(
        `DELETE FROM account_projects WHERE project_id = ? AND account_id IN (${removeIds.map(() => "?").join(",")})`,
        [projectId, ...removeIds],
      );
    }
    if (accountId) {
      await connection.execute("INSERT IGNORE INTO account_projects (account_id, project_id) VALUES (?, ?)", [
        accountId,
        projectId,
      ]);
    }
    await connection.execute("DELETE FROM project_manager_schedule WHERE project_id = ?", [projectId]);
    await syncProjectContact(projectId, connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Đến ngày hẹn thì chuyển giao (chạy tối đa mỗi phút một lần, gọi khi xác thực phiên / tải dự án). */
export async function applyDueManagerSchedules(force = false) {
  if (!force && Date.now() - lastScheduleRunAt < 60_000) return;
  lastScheduleRunAt = Date.now();
  try {
    await ensureProjectManagerSchema();
    const due = await queryRows<Row>(
      `SELECT project_id AS projectId, account_id AS accountId, DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate
         FROM project_manager_schedule WHERE start_date <= ?`,
      [todayVn()],
    );
    for (const row of due) {
      await assignNow(text(row.projectId), text(row.accountId) || null, text(row.startDate) || todayVn());
    }
  } catch (error) {
    console.error("applyDueManagerSchedules failed", error);
  }
}

export async function getProjectManagerState(projectId: string): Promise<ProjectManagerState> {
  await ensureProjectManagerSchema();
  await applyDueManagerSchedules(true);
  const accounts = await manageAccounts();
  const [assigned, pendingRows] = await Promise.all([
    queryRows<Row>("SELECT account_id AS accountId FROM account_projects WHERE project_id = ?", [projectId]),
    queryRows<Row>(
      "SELECT account_id AS accountId, DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate FROM project_manager_schedule WHERE project_id = ? LIMIT 1",
      [projectId],
    ),
  ]);
  const assignedIds = new Set(assigned.map((row) => text(row.accountId)));
  const current = accounts.find((item) => assignedIds.has(item.id)) ?? null;
  const pending = pendingRows[0]
    ? { accountId: text(pendingRows[0].accountId), startDate: text(pendingRows[0].startDate) }
    : null;
  const history = await loadHistory(projectId);
  // Dự án đã có người quản lý từ trước khi có tính năng lịch sử: ghi nhận người đang quản lý (không rõ ngày bắt đầu).
  if (current && !history.some((item) => !item.endDate)) {
    await emsDb.execute(
      `INSERT INTO project_manager_history (project_id, account_id, manager_name, start_date, end_date)
       VALUES (?, ?, ?, NULL, NULL)`,
      [projectId, current.id, displayName(current)],
    );
    return { accounts, currentId: current.id, pending, history: await loadHistory(projectId) };
  }
  return { accounts, currentId: current?.id ?? null, pending, history };
}

async function loadHistory(projectId: string): Promise<ManagerHistoryItem[]> {
  const rows = await queryRows<Row>(
    `SELECT account_id AS accountId, manager_name AS managerName,
            DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate, DATE_FORMAT(end_date, '%Y-%m-%d') AS endDate
       FROM project_manager_history WHERE project_id = ? ORDER BY id DESC LIMIT 50`,
    [projectId],
  );
  return rows.map((row) => ({
    accountId: text(row.accountId) || null,
    managerName: text(row.managerName),
    startDate: text(row.startDate),
    endDate: text(row.endDate),
  }));
}

/**
 * Đặt người quản lý: ngày bắt đầu hôm nay / đã qua → giao ngay (gỡ người cũ);
 * ngày ở tương lai → hẹn chuyển giao, người hiện tại vẫn quản lý tới ngày đó.
 */
export async function setProjectManager(projectId: string, accountId: string | null, startDate: string) {
  await ensureProjectManagerSchema();
  const manageIds = new Set((await manageAccounts()).map((item) => item.id));
  if (accountId && !manageIds.has(accountId)) {
    throw new Error("Tài khoản được chọn không phải tài khoản quản lý (Manage).");
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : todayVn();
  const state = await getProjectManagerState(projectId);
  if (date > todayVn() && accountId !== state.currentId) {
    await emsDb.execute(
      `INSERT INTO project_manager_schedule (project_id, account_id, start_date) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE account_id = VALUES(account_id), start_date = VALUES(start_date)`,
      [projectId, accountId ?? "", date],
    );
  } else {
    // Dự án chưa có người quản lý (VD vừa tạo): tính từ ngày bắt đầu đã chọn; chuyển giao người khác: tính từ hôm nay.
    const effective = state.currentId ? todayVn() : date;
    await assignNow(projectId, accountId, effective);
  }
  return getProjectManagerState(projectId);
}
