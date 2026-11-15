import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { queryRows } from "@/lib/server-db";
import { ensureAccountProjectsSchema } from "@/lib/server-auth";

const SESSION_COOKIE = "ems-session";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!token) return Response.json({ session: null });
    const rows = await queryRows<Record<string, unknown>>(
      `SELECT s.portal, s.user_id AS userId,
              COALESCE(a.username, c.username) AS username,
              COALESCE(a.email, c.email) AS email,
              COALESCE(a.username, c.display_name) AS displayName,
              COALESCE(a.role, 'Khách hàng') AS role,
              s.project_id AS projectId
         FROM auth_sessions s
         LEFT JOIN accounts a ON s.portal = 'admin' AND a.id = s.user_id
         LEFT JOIN customer_accounts c ON s.portal = 'customer' AND c.id = s.user_id
        WHERE s.token_hash = SHA2(?, 256) AND s.expires_at > NOW()
        LIMIT 1`,
      [token],
    );
    const session = rows[0];
    if (!session) {
      cookieStore.delete(SESSION_COOKIE);
      return Response.json({ session: null });
    }
    // Tài khoản Manage chỉ thấy các dự án được giao: client lọc theo managedProjectIds,
    // nên phiên khôi phục sau khi tải lại trang phải mang đủ danh sách này như lúc đăng nhập.
    if (session.portal === "admin") {
      await ensureAccountProjectsSchema();
      const projectRows = await queryRows<{ projectId: string }>(
        "SELECT project_id AS projectId FROM account_projects WHERE account_id = ? ORDER BY project_id",
        [String(session.userId)],
      );
      session.managedProjectIds = projectRows.map((item) => String(item.projectId));
    }
    return Response.json({ session });
  } catch (error) {
    console.error("Auth session error", error);
    return Response.json({ error: "Không thể kiểm tra phiên đăng nhập." }, { status: 500 });
  }
}
