import type { AuthSession } from "@/lib/auth";
import { normalizeAccountRole, type AccountRole } from "@/lib/accounts";

export type Permission =
  | "manageUsers"
  | "manageProjects"
  | "manageDevices"
  | "manageGateway"
  | "manageEmissionFactors"
  | "viewProjects";

const ROLE_PERMISSIONS: Record<AccountRole, Permission[]> = {
  Admin: [
    "manageUsers",
    "manageProjects",
    "manageDevices",
    "manageGateway",
    "manageEmissionFactors",
    "viewProjects",
  ],
  Manage: [
    "manageProjects",
    "manageDevices",
    "manageGateway",
    "manageEmissionFactors",
    "viewProjects",
  ],
};

export function permissionsForRole(role: string | undefined | null): Permission[] {
  if (!role) return [];
  return ROLE_PERMISSIONS[normalizeAccountRole(role)] ?? [];
}

export function hasPermission(session: AuthSession | null | undefined, permission: Permission) {
  if (!session || session.portal !== "admin") return false;
  return permissionsForRole(session.role).includes(permission);
}

export function isAdminRole(session: AuthSession | null | undefined) {
  if (!session || session.portal !== "admin") return false;
  return normalizeAccountRole(session.role) === "Admin";
}

/** Kiểm tra tài khoản quản trị (Admin/Manage) có quyền truy cập vào dự án cụ thể hay không. */
export function canAccessAdminProject(
  session: AuthSession | null | undefined,
  projectId: string | undefined | null,
) {
  if (!session || session.portal !== "admin" || !projectId) return false;
  if (isAdminRole(session)) return true;
  return Array.isArray(session.managedProjectIds) && session.managedProjectIds.includes(projectId);
}

function extractAdminProjectId(pathname: string): string | null {
  const editMatch = pathname.match(/^\/sua-du-an\/([^/]+)/);
  if (editMatch?.[1]) return decodeURIComponent(editMatch[1]);
  const configMatch = pathname.match(/^\/chinh-sua-du-an\/([^/]+)/);
  if (configMatch?.[1]) return decodeURIComponent(configMatch[1]);
  return null;
}

/** Quyền tối thiểu để mở từng khu vực quản trị. */
export function permissionForPath(pathname: string): Permission | null {
  if (pathname === "/tai-khoan" || pathname.startsWith("/tai-khoan/")) return "manageUsers";
  if (
    pathname === "/tao-du-an" ||
    pathname.startsWith("/tao-du-an/") ||
    pathname.startsWith("/sua-du-an/") ||
    pathname.startsWith("/chinh-sua-du-an/")
  ) {
    return "manageProjects";
  }
  if (pathname === "/gateway" || pathname.startsWith("/gateway/")) return "manageGateway";
  if (pathname === "/thiet-bi" || pathname.startsWith("/thiet-bi/")) return "manageDevices";
  if (pathname === "/he-so-phat-thai" || pathname.startsWith("/he-so-phat-thai/")) {
    return "manageEmissionFactors";
  }
  return null;
}

export function canAccessPath(session: AuthSession | null | undefined, pathname: string) {
  const required = permissionForPath(pathname);
  if (required && !hasPermission(session, required)) return false;
  const targetProjectId = extractAdminProjectId(pathname);
  if (targetProjectId && !canAccessAdminProject(session, targetProjectId)) {
    return false;
  }
  return true;
}
