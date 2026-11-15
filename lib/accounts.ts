import { dbFetch, emitDbChange } from "@/lib/db-client";
import { vietnamTodayLabel } from "@/lib/vietnam-time";

export type AccountRole = "Admin" | "Manage";

export type Account = {
  id: string;
  username: string;
  email: string;
  role: AccountRole;
  createdAt: string;
  projectIds?: string[];
  password?: string;
  /** Bắt buộc khi đổi mật khẩu của tài khoản đã có; server kiểm tra trước khi đổi. */
  currentPassword?: string;
  /** Admin đặt lại mật khẩu (không cần mật khẩu cũ). */
  resetPassword?: boolean;
};

export const ACCOUNT_ROLES: AccountRole[] = ["Admin", "Manage"];

export const ACCOUNT_ROLE_LABELS: Record<AccountRole, string> = {
  Admin: "Admin (Toàn quyền hệ thống)",
  Manage: "Manage (Quản trị theo dự án)",
};

export function normalizeAccountRole(role: string | undefined | null): AccountRole {
  const normalized = (role ?? "").trim().toLowerCase();
  if (normalized === "admin" || normalized === "quản trị viên") {
    return "Admin";
  }
  return "Manage";
}

let accountsCache: Account[] = [];
let accountsHydration: Promise<Account[]> | null = null;

export function loadAccounts(): Account[] {
  return accountsCache;
}

export async function saveAccounts(accounts: Account[]) {
  accountsCache = accounts;
  emitDbChange("accounts");
  const saved = await dbFetch<Account[]>("accounts", {
    method: "POST",
    body: JSON.stringify({ items: accounts }),
  });
  accountsCache = saved;
  emitDbChange("accounts");
  return saved;
}

export function hydrateAccounts() {
  if (typeof window === "undefined") return Promise.resolve(loadAccounts());
  if (accountsHydration) return accountsHydration;
  accountsHydration = dbFetch<Account[]>("accounts")
    .then((accounts) => {
      const prevJson = JSON.stringify(accountsCache);
      accountsCache = accounts;
      if (prevJson !== JSON.stringify(accounts)) {
        emitDbChange("accounts");
      }
      return accountsCache;
    })
    .catch(() => accountsCache)
    .finally(() => {
      accountsHydration = null;
    });
  return accountsHydration;
}

export async function upsertAccount(account: Account) {
  const saved = await dbFetch<Account[]>("accounts", {
    method: "POST",
    body: JSON.stringify(account),
  });
  accountsCache = saved;
  emitDbChange("accounts");
  return saved;
}

export async function removeAccount(id: string) {
  await dbFetch("accounts", { method: "DELETE", query: { id } });
  const next = loadAccounts().filter((item) => item.id !== id);
  accountsCache = next;
  emitDbChange("accounts");
  return next;
}

export function todayLabel() {
  return vietnamTodayLabel();
}
