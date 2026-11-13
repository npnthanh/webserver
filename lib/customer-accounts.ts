import { DEFAULT_PASSWORD } from "@/lib/auth-constants";
import { dbFetch, emitDbChange } from "@/lib/db-client";
import { loadProjects } from "@/lib/projects";

export type CustomerBranchRole = "Chỉ xem" | "Xem và chỉnh sửa";
export type CustomerAccountRole = "Admin" | CustomerBranchRole;

export const CUSTOMER_BRANCH_ROLES: {
  value: CustomerBranchRole;
  label: string;
  description: string;
}[] = [
  {
    value: "Chỉ xem",
    label: "Chỉ xem",
    description: "Chỉ được phép xem dữ liệu và thông số cấu hình, không được chỉnh sửa.",
  },
  {
    value: "Xem và chỉnh sửa",
    label: "Xem và chỉnh sửa",
    description: "Được phép xem và chỉnh sửa các thông số trong phần cấu hình người dùng.",
  },
];

export function normalizeCustomerRole(
  role?: string | null,
  isPrimaryAdmin = false,
): CustomerAccountRole {
  if (isPrimaryAdmin) return "Admin";
  const trimmed = (role ?? "").trim();
  if (trimmed === "Admin") return "Admin";
  if (trimmed === "Xem và chỉnh sửa") return "Xem và chỉnh sửa";
  return "Chỉ xem";
}

export function canEditCustomerConfig(
  session: { portal?: string; role?: string; userId?: string } | null | undefined,
  projectId?: string,
): boolean {
  if (!session) return true;
  if (session.portal === "admin") return true;
  if (projectId && session.userId === `cus-${projectId}`) return true;
  const normalized = normalizeCustomerRole(session.role, false);
  return normalized === "Admin" || normalized === "Xem và chỉnh sửa";
}

export type CustomerAccount = {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role?: CustomerAccountRole | string;
  projectId: string;
  password?: string;
};

let customerAccountsCache: CustomerAccount[] = [];
let customerAccountsHydration: Promise<CustomerAccount[]> | null = null;

export function defaultCustomerAccount(project: {
  id: string;
  customer: string;
}): CustomerAccount {
  const username = project.id.toLowerCase();
  return {
    id: `cus-${project.id}`,
    username,
    email: `${username}@ems.local`,
    displayName: project.customer,
    role: "Admin",
    projectId: project.id,
    password: DEFAULT_PASSWORD,
  };
}

export function loadCustomerAccounts(): CustomerAccount[] {
  return customerAccountsCache;
}

export function saveCustomerAccounts(accounts: CustomerAccount[]) {
  customerAccountsCache = accounts;
  emitDbChange("customer-accounts");
  for (const account of accounts) {
    void dbFetch("customer-accounts", {
      method: "POST",
      body: JSON.stringify(account),
    }).catch((error) => console.error("Không thể lưu tài khoản khách hàng", error));
  }
}

export function hydrateCustomerAccounts(projectId?: string) {
  if (typeof window === "undefined") return Promise.resolve(loadCustomerAccounts());
  if (!projectId && customerAccountsHydration) return customerAccountsHydration;
  const request = dbFetch<CustomerAccount[]>("customer-accounts", {
    query: { projectId },
  })
    .then((accounts) => {
      const prevJson = JSON.stringify(customerAccountsCache);
      if (projectId) {
        const others = customerAccountsCache.filter((item) => item.projectId !== projectId);
        customerAccountsCache = [...others, ...accounts];
      } else {
        customerAccountsCache = accounts;
      }
      if (prevJson !== JSON.stringify(customerAccountsCache)) {
        emitDbChange("customer-accounts");
      }
      return projectId
        ? customerAccountsCache.filter((item) => item.projectId === projectId)
        : customerAccountsCache;
    })
    .catch(() =>
      projectId
        ? customerAccountsCache.filter((item) => item.projectId === projectId)
        : customerAccountsCache,
    )
    .finally(() => {
      if (!projectId) customerAccountsHydration = null;
    });
  if (!projectId) customerAccountsHydration = request;
  return request;
}

export async function upsertCustomerAccount(account: CustomerAccount) {
  const saved = await dbFetch<CustomerAccount[]>("customer-accounts", {
    method: "POST",
    body: JSON.stringify(account),
  });
  customerAccountsCache = saved;
  emitDbChange("customer-accounts");
  return saved;
}

export async function removeCustomerAccount(id: string) {
  await dbFetch("customer-accounts", { method: "DELETE", query: { id } });
  customerAccountsCache = customerAccountsCache.filter((item) => item.id !== id);
  emitDbChange("customer-accounts");
  return customerAccountsCache;
}

export function getPrimaryCustomerAccount(
  project: { id: string; customer: string },
  accounts: CustomerAccount[] = loadCustomerAccounts(),
): CustomerAccount {
  const forProject = accounts.filter((item) => item.projectId === project.id);
  const adminMatch =
    forProject.find((item) => item.id === `cus-${project.id}`) ??
    forProject.find((item) => (item.role ?? "Admin") === "Admin") ??
    forProject[0];
  return adminMatch ?? defaultCustomerAccount(project);
}

export function getCustomerAccountForProject(projectId: string): CustomerAccount | undefined {
  const forProject = loadCustomerAccounts().filter((item) => item.projectId === projectId);
  const stored =
    forProject.find((item) => item.id === `cus-${projectId}`) ??
    forProject.find((item) => (item.role ?? "Admin") === "Admin") ??
    forProject[0];
  if (stored) return stored;
  const project = loadProjects().find((item) => item.id === projectId);
  if (!project) return undefined;
  return defaultCustomerAccount(project);
}

export function ensureCustomerAccount(project: { id: string; customer: string }) {
  const existing = getCustomerAccountForProject(project.id);
  if (existing && loadCustomerAccounts().some((item) => item.id === existing.id)) {
    return existing;
  }
  const created = defaultCustomerAccount(project);
  void upsertCustomerAccount(created).catch((error) =>
    console.error("Không thể tạo tài khoản khách hàng mặc định", error),
  );
  return created;
}

export function customerPassword(account: CustomerAccount) {
  return account.password || DEFAULT_PASSWORD;
}
