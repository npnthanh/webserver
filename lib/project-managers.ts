import { dbFetch, emitDbChange } from "@/lib/db-client";

/** Tài khoản Manage và trạng thái được giao phụ trách một dự án. */
export type ProjectManager = {
  id: string;
  username: string;
  email: string;
  assigned: boolean;
};

export function loadProjectManagers(projectId: string) {
  return dbFetch<ProjectManager[]>("project-managers", { query: { projectId } });
}

export async function saveProjectManagers(projectId: string, accountIds: string[]) {
  const saved = await dbFetch<ProjectManager[]>("project-managers", {
    method: "POST",
    body: JSON.stringify({ projectId, accountIds }),
  });
  emitDbChange("accounts");
  return saved;
}
