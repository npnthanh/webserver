import { dbFetch, emitDbChange } from "@/lib/db-client";

/** Tài khoản Manage có thể được giao quản lý dự án (Admin xem mọi dự án nên không liệt kê). */
export type ManagerAccount = {
  id: string;
  username: string;
  fullName: string;
  email: string;
  phone: string;
};

export type ProjectManagerState = {
  accounts: ManagerAccount[];
  /** Người đang quản lý dự án. */
  currentId: string | null;
  /** Lịch hẹn chuyển giao (ngày bắt đầu ở tương lai). */
  pending: { accountId: string; startDate: string } | null;
};

export function loadProjectManagers(projectId: string) {
  return dbFetch<ProjectManagerState>("project-managers", { query: { projectId } });
}

/** Giao dự án cho một người quản lý; ngày bắt đầu ở tương lai thì hẹn chuyển giao tới ngày đó. */
export async function saveProjectManager(projectId: string, accountId: string | null, startDate: string) {
  const saved = await dbFetch<ProjectManagerState>("project-managers", {
    method: "POST",
    body: JSON.stringify({ projectId, accountId: accountId ?? "", startDate }),
  });
  emitDbChange("accounts");
  emitDbChange("projects");
  return saved;
}

export function managerDisplayName(account: Pick<ManagerAccount, "fullName" | "username">) {
  return account.fullName || account.username;
}
