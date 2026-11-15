import "server-only";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { AuthSession } from "@/lib/auth";
import { isAdminRole } from "@/lib/permissions";
import { ensureAccountProjectsSchema } from "@/lib/server-auth";
import { emsDb, queryRows } from "@/lib/server-db";

/**
 * Thông báo cho trang quản trị (chuông trên header) và yêu cầu xoá dự án cần Admin khác duyệt.
 * Thời gian lưu theo UTC (UTC_TIMESTAMP), client hiển thị giờ Việt Nam.
 */

export type ProjectEventType =
  | "project_created"
  | "project_delete_requested"
  | "project_deleted"
  | "project_delete_rejected"
  | "project_delete_cancelled";

export type AdminNotification = {
  id: number;
  type: ProjectEventType;
  projectId: string;
  projectName: string;
  actorName: string;
  createdAt: string;
  unread: boolean;
  /** Có khi thông báo gắn với một yêu cầu xoá. */
  request?: {
    id: number;
    status: "pending" | "approved" | "rejected" | "cancelled";
    requestedByName: string;
    decidedByName: string | null;
    /** Người đang xem có được duyệt / từ chối yêu cầu này không (Admin khác người gửi). */
    canDecide: boolean;
    /** Người đang xem là người gửi yêu cầu và yêu cầu còn chờ: được huỷ. */
    canCancel: boolean;
  };
};

let schemaReady: Promise<void> | null = null;

export function ensureProjectEventsSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await emsDb.query(
        `CREATE TABLE IF NOT EXISTS project_deletion_requests (
           id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
           project_id VARCHAR(64) NOT NULL,
           project_name VARCHAR(255) NOT NULL,
           requested_by VARCHAR(64) NOT NULL,
           requested_by_name VARCHAR(100) NOT NULL,
           status VARCHAR(20) NOT NULL DEFAULT 'pending',
           decided_by VARCHAR(64) NULL,
           decided_by_name VARCHAR(100) NULL,
           created_at DATETIME(3) NOT NULL,
           decided_at DATETIME(3) NULL,
           PRIMARY KEY (id),
           KEY idx_project_deletion_project (project_id, status)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );
      await emsDb.query(
        `CREATE TABLE IF NOT EXISTS admin_notifications (
           id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
           type VARCHAR(40) NOT NULL,
           project_id VARCHAR(64) NOT NULL,
           project_name VARCHAR(255) NOT NULL,
           actor_id VARCHAR(64) NULL,
           actor_name VARCHAR(100) NULL,
           request_id BIGINT UNSIGNED NULL,
           created_at DATETIME(3) NOT NULL,
           PRIMARY KEY (id),
           KEY idx_admin_notifications_created (created_at),
           KEY idx_admin_notifications_project (project_id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );
      await emsDb.query(
        `CREATE TABLE IF NOT EXISTS admin_notification_seen (
           account_id VARCHAR(64) NOT NULL,
           seen_at DATETIME(3) NOT NULL,
           PRIMARY KEY (account_id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

type Executor = Pick<PoolConnection, "execute">;

export async function addProjectEvent(
  db: Executor,
  input: {
    type: ProjectEventType;
    projectId: string;
    projectName: string;
    actor: AuthSession | null;
    requestId?: number | null;
  },
) {
  await db.execute(
    `INSERT INTO admin_notifications (type, project_id, project_name, actor_id, actor_name, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [
      input.type,
      input.projectId,
      input.projectName,
      input.actor?.userId ?? null,
      input.actor?.username ?? null,
      input.requestId ?? null,
    ],
  );
}

/** Xoá hẳn dự án và dữ liệu gán kèm (chỉ gọi sau khi yêu cầu xoá đã được duyệt). */
export async function deleteProjectNow(connection: PoolConnection, projectId: string) {
  await connection.execute("DELETE FROM account_projects WHERE project_id = ?", [projectId]);
  await connection.execute("UPDATE meter_points SET parent_id = NULL WHERE project_id = ?", [projectId]);
  await connection.execute("DELETE FROM projects WHERE id = ?", [projectId]);
}

export class ProjectEventError extends Error {}

async function inTransaction<T>(work: (connection: PoolConnection) => Promise<T>) {
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

/** Gửi yêu cầu xoá dự án; dự án chỉ bị xoá khi một Admin khác duyệt. */
export async function requestProjectDeletion(session: AuthSession, projectId: string) {
  await ensureProjectEventsSchema();
  return inTransaction(async (connection) => {
    const [projects] = await connection.execute<RowDataPacket[]>(
      "SELECT id, name FROM projects WHERE id = ? LIMIT 1",
      [projectId],
    );
    const project = projects[0];
    if (!project) throw new ProjectEventError("Dự án không tồn tại hoặc đã bị xoá.");
    const [pending] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM project_deletion_requests WHERE project_id = ? AND status = 'pending' LIMIT 1",
      [projectId],
    );
    if (pending[0]) throw new ProjectEventError("Dự án này đã có yêu cầu xoá đang chờ duyệt.");
    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO project_deletion_requests
         (project_id, project_name, requested_by, requested_by_name, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', UTC_TIMESTAMP(3))`,
      [projectId, String(project.name), session.userId, session.username],
    );
    await addProjectEvent(connection, {
      type: "project_delete_requested",
      projectId,
      projectName: String(project.name),
      actor: session,
      requestId: inserted.insertId,
    });
    return { requestId: inserted.insertId };
  });
}

/** Duyệt / từ chối (Admin khác người gửi) hoặc huỷ (chính người gửi) một yêu cầu xoá. */
export async function decideProjectDeletion(
  session: AuthSession,
  requestId: number,
  decision: "approve" | "reject" | "cancel",
) {
  await ensureProjectEventsSchema();
  await ensureAccountProjectsSchema();
  return inTransaction(async (connection) => {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, project_id AS projectId, project_name AS projectName, requested_by AS requestedBy, status
         FROM project_deletion_requests WHERE id = ? FOR UPDATE`,
      [requestId],
    );
    const request = rows[0];
    if (!request) throw new ProjectEventError("Không tìm thấy yêu cầu xoá.");
    if (request.status !== "pending") throw new ProjectEventError("Yêu cầu xoá này đã được xử lý.");
    const isRequester = String(request.requestedBy) === session.userId;

    if (decision === "cancel") {
      if (!isRequester) throw new ProjectEventError("Chỉ người gửi yêu cầu mới được huỷ yêu cầu xoá.");
    } else {
      if (!isAdminRole(session)) throw new ProjectEventError("Chỉ Admin mới được duyệt yêu cầu xoá dự án.");
      if (isRequester) {
        throw new ProjectEventError("Bạn không thể tự duyệt yêu cầu xoá của mình. Cần một Admin khác duyệt.");
      }
    }

    const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "cancelled";
    await connection.execute(
      `UPDATE project_deletion_requests
          SET status = ?, decided_by = ?, decided_by_name = ?, decided_at = UTC_TIMESTAMP(3)
        WHERE id = ?`,
      [status, session.userId, session.username, requestId],
    );
    const projectId = String(request.projectId);
    if (decision === "approve") await deleteProjectNow(connection, projectId);
    await addProjectEvent(connection, {
      type:
        decision === "approve"
          ? "project_deleted"
          : decision === "reject"
            ? "project_delete_rejected"
            : "project_delete_cancelled",
      projectId,
      projectName: String(request.projectName),
      actor: session,
      requestId,
    });
    return { status };
  });
}

/** Yêu cầu xoá đang chờ, theo dự án (để danh sách dự án gắn nhãn "Chờ duyệt xoá"). */
export async function pendingDeletionsByProject(projectIds: string[]) {
  await ensureProjectEventsSchema();
  const map = new Map<string, { requestId: number; requestedByName: string }>();
  if (!projectIds.length) return map;
  const rows = await queryRows<RowDataPacket>(
    `SELECT id, project_id AS projectId, requested_by_name AS requestedByName
       FROM project_deletion_requests
      WHERE status = 'pending' AND project_id IN (${projectIds.map(() => "?").join(",")})`,
    projectIds,
  );
  for (const row of rows) {
    map.set(String(row.projectId), { requestId: Number(row.id), requestedByName: String(row.requestedByName) });
  }
  return map;
}

/** Thông báo người đang đăng nhập được xem: Admin thấy tất cả; Manage thấy dự án được giao và việc của chính mình. */
export async function listNotifications(session: AuthSession, limit = 30) {
  await ensureProjectEventsSchema();
  const isAdmin = isAdminRole(session);
  const managed = session.managedProjectIds ?? [];
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (!isAdmin) {
    const scope = ["n.actor_id = ?"];
    params.push(session.userId);
    if (managed.length) {
      scope.push(`n.project_id IN (${managed.map(() => "?").join(",")})`);
      params.push(...managed);
    }
    clauses.push(`(${scope.join(" OR ")})`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await queryRows<RowDataPacket>(
    `SELECT n.id, n.type, n.project_id AS projectId, n.project_name AS projectName,
            n.actor_id AS actorId, n.actor_name AS actorName, n.request_id AS requestId,
            DATE_FORMAT(n.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
            r.status AS requestStatus, r.requested_by AS requestedBy,
            r.requested_by_name AS requestedByName, r.decided_by_name AS decidedByName
       FROM admin_notifications n
       LEFT JOIN project_deletion_requests r ON r.id = n.request_id
       ${where}
      ORDER BY n.id DESC
      LIMIT ${Math.max(1, Math.min(100, Math.floor(limit)))}`,
    params,
  );
  const [seenRow] = await queryRows<RowDataPacket>(
    "SELECT DATE_FORMAT(seen_at, '%Y-%m-%d %H:%i:%s') AS seenAt FROM admin_notification_seen WHERE account_id = ?",
    [session.userId],
  );
  const seenAt = seenRow ? String(seenRow.seenAt) : "";

  const items: AdminNotification[] = rows.map((row) => {
    const createdAt = String(row.createdAt);
    const item: AdminNotification = {
      id: Number(row.id),
      type: String(row.type) as ProjectEventType,
      projectId: String(row.projectId),
      projectName: String(row.projectName),
      actorName: String(row.actorName ?? "Hệ thống"),
      createdAt,
      // Cùng định dạng "YYYY-MM-DD HH:MM:SS" (UTC) nên so sánh chuỗi là đúng thứ tự thời gian.
      // Việc do chính mình làm không tính là thông báo mới.
      unread: String(row.actorId ?? "") !== session.userId && (!seenAt || createdAt > seenAt),
    };
    if (row.requestId != null && row.requestStatus) {
      const pending = row.requestStatus === "pending";
      const isRequester = String(row.requestedBy) === session.userId;
      item.request = {
        id: Number(row.requestId),
        status: row.requestStatus,
        requestedByName: String(row.requestedByName ?? ""),
        decidedByName: row.decidedByName ? String(row.decidedByName) : null,
        canDecide: pending && isAdmin && !isRequester,
        canCancel: pending && isRequester,
      };
    }
    return item;
  });
  // Yêu cầu xoá đang chờ mình duyệt luôn tính là chưa xử lý, kể cả khi đã mở chuông.
  const unread = items.filter((item) => item.unread || item.request?.canDecide).length;
  return { items, unread };
}

export async function markNotificationsSeen(session: AuthSession) {
  await ensureProjectEventsSchema();
  await emsDb.execute(
    `INSERT INTO admin_notification_seen (account_id, seen_at) VALUES (?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE seen_at = VALUES(seen_at)`,
    [session.userId],
  );
}
