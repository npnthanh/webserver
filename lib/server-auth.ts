import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { normalizeAccountRole } from "@/lib/accounts";
import type { AuthSession } from "@/lib/auth";
import { hasPermission, type Permission } from "@/lib/permissions";
import { emsDb, queryRows } from "@/lib/server-db";
import { applyDueManagerSchedules } from "@/lib/server-project-manager";

const SESSION_COOKIE = "ems-session";

let accountProjectsReady: Promise<void> | null = null;
let customerAccountsReady: Promise<void> | null = null;

export function ensureAccountProjectsSchema() {
  if (!accountProjectsReady) {
    accountProjectsReady = emsDb
      .query(
        `CREATE TABLE IF NOT EXISTS account_projects (
           account_id VARCHAR(64) NOT NULL,
           project_id VARCHAR(64) NOT NULL,
           PRIMARY KEY (account_id, project_id),
           KEY idx_account_projects_project (project_id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      )
      .then(() => undefined)
      .catch((error) => {
        accountProjectsReady = null;
        throw error;
      });
  }
  return accountProjectsReady;
}

export function ensureCustomerAccountsSchema() {
  if (!customerAccountsReady) {
    customerAccountsReady = (async () => {
      await emsDb
        .query("ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS role VARCHAR(60) NOT NULL DEFAULT 'Admin' AFTER display_name")
        .catch(() => undefined);
      await emsDb
        .query("ALTER TABLE customer_accounts ADD INDEX IF NOT EXISTS idx_customer_accounts_project (project_id)")
        .catch(() => undefined);
      await emsDb
        .query("ALTER TABLE customer_accounts DROP INDEX IF EXISTS uq_customer_accounts_project")
        .catch(() => undefined);
    })().catch((error) => {
      customerAccountsReady = null;
      throw error;
    });
  }
  return customerAccountsReady;
}

export async function getServerSession(): Promise<AuthSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    await ensureCustomerAccountsSchema();
    const rows = await queryRows<{
      portal: "admin" | "customer";
      userId: string;
      username: string;
      email: string;
      displayName: string;
      role: string;
      projectId: string | null;
    }>(
      `SELECT s.portal, s.user_id AS userId,
              COALESCE(a.username, c.username) AS username,
              COALESCE(a.email, c.email) AS email,
              COALESCE(a.username, c.display_name) AS displayName,
              COALESCE(a.role, c.role, 'Admin') AS role,
              s.project_id AS projectId
         FROM auth_sessions s
         LEFT JOIN accounts a ON s.portal = 'admin' AND a.id = s.user_id
         LEFT JOIN customer_accounts c ON s.portal = 'customer' AND c.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > NOW()
        LIMIT 1`,
      [createHash("sha256").update(token).digest("hex")],
    );
    const row = rows[0];
    if (!row) return null;
    const userId = String(row.userId);
    const role = row.portal === "admin" ? normalizeAccountRole(row.role) : String(row.role ?? "");
    let managedProjectIds: string[] | undefined;
    if (row.portal === "admin") {
      await ensureAccountProjectsSchema();
      // Đến ngày hẹn chuyển giao người quản lý thì áp dụng trước khi tính quyền theo dự án.
      await applyDueManagerSchedules();
      const projectRows = await queryRows<{ projectId: string }>(
        "SELECT project_id AS projectId FROM account_projects WHERE account_id = ? ORDER BY project_id",
        [userId],
      );
      managedProjectIds = projectRows.map((item) => String(item.projectId));
    }
    return {
      portal: row.portal,
      userId,
      username: String(row.username ?? ""),
      displayName: String(row.displayName ?? row.username ?? ""),
      email: String(row.email ?? ""),
      role,
      ...(row.projectId ? { projectId: String(row.projectId) } : {}),
      ...(managedProjectIds !== undefined ? { managedProjectIds } : {}),
    };
  } catch (error) {
    console.error("getServerSession failed", error);
    return null;
  }
}

export async function requirePermission(permission: Permission) {
  const session = await getServerSession();
  if (!hasPermission(session, permission)) {
    return { session: null as AuthSession | null, ok: false as const };
  }
  return { session, ok: true as const };
}
