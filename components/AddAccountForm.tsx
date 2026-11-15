"use client";

import Link from "next/link";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/useAuth";
import {
  ACCOUNT_ROLES,
  ACCOUNT_ROLE_LABELS,
  hydrateAccounts,
  normalizeAccountRole,
  todayLabel,
  upsertAccount,
  type Account,
  type AccountRole,
} from "@/lib/accounts";
import { DEFAULT_PASSWORD } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { hydrateProjects, loadProjects, type Project } from "@/lib/projects";

export function AddAccountForm() {
  const router = useRouter();
  const { session } = useAuth();
  const canManage = hasPermission(session, "manageUsers");
  const searchParams = useSearchParams();
  const editingId = searchParams.get("id");

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AccountRole>("Manage");
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [createdAt, setCreatedAt] = useState(todayLabel());
  const [isEdit, setIsEdit] = useState(false);
  const [existing, setExisting] = useState<Account | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setProjects(loadProjects());
    let active = true;
    void hydrateProjects().then((items) => {
      if (active) setProjects(items);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!editingId) {
      setIsEdit(false);
      setExisting(null);
      setSelectedProjectIds([]);
      return;
    }
    let active = true;
    void hydrateAccounts().then((accounts) => {
      if (!active) return;
      const found = accounts.find((item) => item.id === editingId);
      if (!found) {
        setIsEdit(false);
        setExisting(null);
        setSelectedProjectIds([]);
        return;
      }
      setIsEdit(true);
      setExisting(found);
      setUsername(found.username);
      setEmail(found.email);
      setRole(normalizeAccountRole(found.role));
      setSelectedProjectIds(found.projectIds ?? []);
      setCreatedAt(found.createdAt);
      setPassword("");
      setCurrentPassword("");
      setConfirmPassword("");
    });
    return () => {
      active = false;
    };
  }, [editingId]);

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (item) =>
        item.id.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.customer.toLowerCase().includes(q),
    );
  }, [projects, projectSearch]);

  function toggleProject(projectId: string) {
    setSelectedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId],
    );
  }

  function selectAllFiltered() {
    setSelectedProjectIds((current) => {
      const next = new Set(current);
      for (const item of filteredProjects) next.add(item.id);
      return [...next];
    });
  }

  function clearAllProjects() {
    setSelectedProjectIds([]);
  }

  async function handleSubmit() {
    if (!canManage || saving) return;
    const name = username.trim();
    const mail = email.trim();
    if (!name || !mail) return;

    const nextPassword = password.trim();
    // Đổi mật khẩu (chế độ sửa): điền một ô thì phải điền đủ cả ba ô.
    const changingPassword = isEdit && Boolean(currentPassword || password || confirmPassword);
    if (changingPassword) {
      if (!currentPassword || !nextPassword || !confirmPassword) {
        setError("Để đổi mật khẩu, vui lòng nhập đủ mật khẩu cũ, mật khẩu mới và xác nhận mật khẩu mới.");
        return;
      }
      if (nextPassword.length < 6) {
        setError("Mật khẩu mới phải có ít nhất 6 ký tự.");
        return;
      }
      if (nextPassword !== confirmPassword.trim()) {
        setError("Xác nhận mật khẩu mới không khớp.");
        return;
      }
      if (nextPassword === currentPassword) {
        setError("Mật khẩu mới phải khác mật khẩu cũ.");
        return;
      }
    }

    setError("");
    setSaving(true);
    try {
      await upsertAccount({
        id: editingId && isEdit ? editingId : `acc-${Date.now()}`,
        username: name,
        email: mail,
        role,
        projectIds: role === "Admin" ? [] : selectedProjectIds,
        createdAt: isEdit && existing ? createdAt : todayLabel(),
        password: isEdit ? (changingPassword ? nextPassword : undefined) : nextPassword || DEFAULT_PASSWORD,
        currentPassword: changingPassword ? currentPassword : undefined,
      });
      router.push("/tai-khoan");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể lưu tài khoản.");
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <div className="mx-auto max-w-[640px] p-6 lg:p-8">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          Chỉ Quản trị viên được thêm hoặc sửa tài khoản người dùng.
          <div className="mt-4">
            <Link href="/" className="font-semibold text-emerald-700 hover:underline">
              Về danh sách dự án
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[980px] p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {isEdit ? "Cập nhật tài khoản" : "Thêm tài khoản"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">Quản trị người dùng — đăng nhập và phân quyền theo vai trò</p>
      </div>

      <form
        className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] lg:p-8"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <div className="mb-6">
          <h2 className="text-[15px] font-semibold text-slate-800">
            {isEdit ? "Thông tin tài khoản nội bộ" : "Thêm tài khoản nội bộ mới"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Cấp tài khoản nội bộ để quản trị hệ thống và quản lý các dự án khách hàng.
          </p>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="TÊN NGƯỜI DÙNG">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Ví dụ: admin_vanhanh"
              className="input"
              required
            />
          </Field>
          <Field label="EMAIL">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Ví dụ: admin@ems-precision.com"
              className="input"
              required
            />
          </Field>
          <Field label="VAI TRÒ PHÂN CẤP">
            <div className="relative">
              <CustomSelect
                value={role}
                onChange={(e) => setRole(e.target.value as AccountRole)}
                className="input appearance-none pr-9"
              >
                {ACCOUNT_ROLES.map((item) => (
                  <option key={item} value={item}>
                    {ACCOUNT_ROLE_LABELS[item]}
                  </option>
                ))}
              </CustomSelect>
              <ChevronIcon className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </Field>
          {!isEdit ? (
            <Field label="MẬT KHẨU">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu"
                className="input"
                autoComplete="new-password"
                required
              />
            </Field>
          ) : null}
        </div>

        {isEdit ? (
          <div className="mt-6 border-t border-slate-100 pt-6">
            <h3 className="text-[14px] font-semibold text-slate-800">Đổi mật khẩu</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Để trống cả ba ô nếu giữ nguyên mật khẩu hiện tại.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field label="MẬT KHẨU CŨ">
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Nhập mật khẩu hiện tại"
                  className="input"
                  autoComplete="current-password"
                />
              </Field>
              <Field label="MẬT KHẨU MỚI">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Ít nhất 6 ký tự"
                  className="input"
                  autoComplete="new-password"
                />
              </Field>
              <Field label="XÁC NHẬN MẬT KHẨU MỚI">
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Nhập lại mật khẩu mới"
                  className="input"
                  autoComplete="new-password"
                />
              </Field>
            </div>
            {confirmPassword && password.trim() !== confirmPassword.trim() ? (
              <p className="mt-2 text-xs font-medium text-rose-600">Xác nhận mật khẩu mới không khớp.</p>
            ) : null}
          </div>
        ) : null}

        {/* Danh sách các dự án / khách hàng được quản trị */}
        <div className="mt-6 border-t border-slate-100 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[14px] font-semibold text-slate-800">
                Các dự án / khách hàng được quản trị
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {role === "Admin"
                  ? "Tài khoản Admin có toàn quyền truy cập và cấu hình tất cả các dự án trên hệ thống."
                  : "Chọn các dự án (khách hàng) mà tài khoản Manage này được phép truy cập và cấu hình."}
              </p>
            </div>
            {role === "Admin" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                Toàn bộ dự án ({projects.length})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                Đã chọn {selectedProjectIds.length} / {projects.length} dự án
              </span>
            )}
          </div>

          {role === "Admin" ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              {projects.length === 0 ? (
                <p className="text-xs text-slate-500">Hiện chưa có dự án nào trên hệ thống.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {projects.map((project) => (
                    <span
                      key={project.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-2xs"
                    >
                      <span className="font-mono font-semibold text-emerald-700">{project.id}</span>
                      <span className="text-slate-300">•</span>
                      <span>{project.customer || project.name}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <input
                  type="search"
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.target.value)}
                  placeholder="Tìm kiếm mã dự án, tên dự án hoặc khách hàng..."
                  className="h-9 w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-emerald-500"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllFiltered}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Chọn tất cả
                  </button>
                  <button
                    type="button"
                    onClick={clearAllProjects}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    Bỏ chọn hết
                  </button>
                </div>
              </div>

              {filteredProjects.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                  Không tìm thấy dự án nào phù hợp.
                </div>
              ) : (
                <div className="grid max-h-[320px] gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2">
                  {filteredProjects.map((project) => {
                    const checked = selectedProjectIds.includes(project.id);
                    return (
                      <label
                        key={project.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-all ${
                          checked
                            ? "border-emerald-500 bg-emerald-50/50 shadow-2xs"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProject(project.id)}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-bold text-slate-900">
                              {project.customer || project.name}
                            </span>
                            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                              {project.id}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-slate-500">
                            Dự án: {project.name}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-8 flex flex-wrap justify-end gap-3">
          <Link
            href="/tai-khoan"
            className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors shadow-xs"
          >
            Quay lại danh sách
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="h-10 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-60 transition-colors"
          >
            {saving ? "Đang lưu..." : isEdit ? "Cập nhật tài khoản" : "Lưu tài khoản"}
          </button>
        </div>
      </form>

      <div className="mt-5 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 text-sm text-slate-700">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white shadow-xs">
          i
        </span>
        <p>
          <span className="font-semibold text-emerald-900">Phân cấp quyền:</span> Hệ thống chỉ gồm 2 cấp là{" "}
          <strong>Admin</strong> (truy cập toàn bộ dự án &amp; quản trị người dùng) và{" "}
          <strong>Manage</strong> (truy cập các dự án được cấp phép ở trên). Cả 2 cấp đều có quyền cấu hình đầy đủ các thông tin phần quản trị.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 10l5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
