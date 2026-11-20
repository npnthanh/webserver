"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/useAuth";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  hydrateAccounts,
  loadAccounts,
  normalizeAccountRole,
  removeAccount,
  type Account,
  type AccountRole,
} from "@/lib/accounts";
import { canManageAccountRole, hasPermission } from "@/lib/permissions";
import { hydrateProjects, loadProjects, type Project } from "@/lib/projects";

const PAGE_SIZE = 6;

const ROLE_STYLE: Record<AccountRole, string> = {
  Admin: "bg-slate-900 text-white shadow-xs",
  Manage: "bg-emerald-50 text-emerald-700 border border-emerald-200/60",
};

export function AccountList() {
  const { session } = useAuth();
  const canManage = hasPermission(session, "manageUsers");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    setAccounts(loadAccounts());
    setProjects(loadProjects());
    let active = true;
    void hydrateAccounts().then((items) => {
      if (active) setAccounts(items);
    });
    void hydrateProjects().then((items) => {
      if (active) setProjects(items);
    });
    const onChanged = () => {
      if (active) setAccounts(loadAccounts());
    };
    window.addEventListener("ems-accounts-changed", onChanged);
    return () => {
      active = false;
      window.removeEventListener("ems-accounts-changed", onChanged);
    };
  }, []);

  const projectMap = useMemo(() => {
    const map = new Map<string, Project>();
    for (const item of projects) map.set(item.id, item);
    return map;
  }, [projects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (item) =>
        item.username.toLowerCase().includes(q) ||
        item.email.toLowerCase().includes(q) ||
        item.role.toLowerCase().includes(q),
    );
  }, [accounts, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const pageNumbers = visiblePages(currentPage, totalPages);

  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8 font-sans">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Quản trị người dùng
            </h1>
          </div>
        </div>
        {canManage ? (
          <Link
            href="/tai-khoan/them-moi"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 transition-colors shrink-0"
          >
            <span className="text-base leading-none font-bold">+</span>
            Thêm tài khoản
          </Link>
        ) : null}
      </div>

      {deleteError ? (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
          {deleteError}
        </div>
      ) : null}

      {/* Search Input */}
      <div className="relative mb-6 max-w-md">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400">
          <SearchIcon className="h-4 w-4" />
        </span>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm kiếm tài khoản, email hoặc vai trò..."
          className="h-10 w-full rounded-xl border border-slate-200 bg-white pr-3 pl-9 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-xs"
        />
      </div>

      {/* Main Table */}
      <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                <th className="px-5 py-3">Tên người dùng</th>
                <th className="px-5 py-3">Địa chỉ Email</th>
                <th className="px-5 py-3">Vai trò phân cấp</th>
                <th className="px-5 py-3">Dự án được quản trị</th>
                <th className="px-5 py-3">Ngày tạo</th>
                <th className="px-5 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pageRows.map((account) => {
                const role = normalizeAccountRole(account.role);
                const assignedIds = account.projectIds ?? [];
                return (
                <tr
                  key={account.id}
                  className="hover:bg-slate-50/80 transition-colors"
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700 font-semibold text-xs border border-slate-200/60 uppercase">
                        {account.username.slice(0, 2)}
                      </div>
                      <span className="font-semibold text-slate-900">{account.username}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-slate-600 font-mono text-[11px]">
                    {account.email}
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${ROLE_STYLE[role]}`}
                    >
                      {role}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    {role === "Admin" ? (
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                        Toàn bộ dự án ({projects.length})
                      </span>
                    ) : assignedIds.length === 0 ? (
                      <span className="text-[11px] italic text-slate-400">Chưa gán dự án</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {assignedIds.map((pid) => {
                          const proj = projectMap.get(pid);
                          return (
                            <span
                              key={pid}
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-200/80 bg-emerald-50/70 px-2 py-0.5 text-[11px] font-medium text-emerald-800"
                            >
                              <span className="font-mono font-semibold">{pid}</span>
                              {proj ? <span className="text-emerald-600">· {proj.customer || proj.name}</span> : null}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-slate-500 font-mono text-[11px]">
                    {account.createdAt}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {canManage ? (
                      <div className="flex justify-end gap-1">
                        <Link
                          href={`/tai-khoan/them-moi?id=${account.id}`}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors"
                          title={`Sửa tài khoản ${account.username}`}
                        >
                          <EditIcon className="h-3.5 w-3.5" />
                        </Link>
                        <button
                          type="button"
                          onClick={() => setAccountToDelete(account)}
                          disabled={!canManageAccountRole(session, account)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-400 disabled:hover:border-slate-200"
                          title={
                            canManageAccountRole(session, account)
                              ? `Xóa tài khoản ${account.username}`
                              : account.id === session?.userId
                                ? "Không thể tự xoá tài khoản của chính mình"
                                : "Chỉ người có cấp cao hơn mới được xoá tài khoản này"
                          }
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400">Chỉ xem</span>
                    )}
                  </td>
                </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-xs text-slate-400">
                    Không tìm thấy tài khoản nào phù hợp với từ khóa tìm kiếm.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3.5 text-xs text-slate-500 bg-white">
          <p>
            Hiển thị {filtered.length === 0 ? 0 : start + 1}-
            {Math.min(start + PAGE_SIZE, filtered.length)} trên tổng số {filtered.length} tài khoản
          </p>
          <div className="flex items-center gap-1">
            <PageBtn disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
              ‹
            </PageBtn>
            {pageNumbers.map((p, idx) =>
              p === "ellipsis" ? (
                <span key={`e-${idx}`} className="px-1 text-slate-400">
                  …
                </span>
              ) : (
                <PageBtn key={p} active={p === currentPage} onClick={() => setPage(p)}>
                  {p}
                </PageBtn>
              ),
            )}
            <PageBtn
              disabled={currentPage === totalPages}
              onClick={() => setPage(currentPage + 1)}
            >
              ›
            </PageBtn>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(accountToDelete)}
        title="Xác nhận xóa tài khoản"
        description={`Bạn có chắc chắn muốn xóa tài khoản "${accountToDelete?.username}" (${accountToDelete?.email}) không? Người dùng sẽ không thể đăng nhập vào hệ thống sau khi bị xóa.`}
        confirmText="Xác nhận xóa"
        onConfirm={() => {
          if (!accountToDelete) return;
          const target = accountToDelete;
          setAccountToDelete(null);
          setDeleteError("");
          void removeAccount(target.id)
            .then((next) => setAccounts(next))
            .catch((err) =>
              setDeleteError(err instanceof Error ? err.message : "Không thể xóa tài khoản."),
            );
        }}
        onCancel={() => setAccountToDelete(null)}
      />
    </div>
  );
}

function visiblePages(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items: Array<number | "ellipsis"> = [1];
  if (current > 3) items.push("ellipsis");
  for (let n = Math.max(2, current - 1); n <= Math.min(total - 1, current + 1); n += 1) {
    items.push(n);
  }
  if (current < total - 2) items.push("ellipsis");
  items.push(total);
  return items;
}

function PageBtn({
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-semibold transition-colors disabled:opacity-30 ${
        active
          ? "bg-emerald-600 text-white shadow-xs"
          : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}
