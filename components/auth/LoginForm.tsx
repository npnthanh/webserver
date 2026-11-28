"use client";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  homePathFor,
  isAuthPath,
  isClientPath,
  login,
  type AuthPortal,
} from "@/lib/auth";
import { hydrateCustomerAccounts } from "@/lib/customer-accounts";
import { hydrateProjects, type Project } from "@/lib/projects";

export function LoginForm({
  projectId,
}: {
  portal?: AuthPortal;
  projectId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [project, setProject] = useState<Project | undefined>();

  useEffect(() => {
    let active = true;
    if (projectId) {
      void Promise.all([hydrateProjects(), hydrateCustomerAccounts(projectId)]).then(([projects]) => {
        if (!active) return;
        setProject(projects.find((item) => item.id === projectId));
      });
    }
    return () => {
      active = false;
    };
  }, [projectId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const result = await login(identifier, password, projectId, rememberMe);

    if (!result.ok) {
      setError(result.message);
      setSubmitting(false);
      return;
    }

    if (isAuthPath(pathname) || isClientPath(pathname)) {
      router.replace(homePathFor(result.session));
      return;
    }

    setSubmitting(false);
  }

  return (
    // h-dvh: đúng chiều cao vùng nhìn thấy trên điện thoại (100vh tính cả thanh địa chỉ nên sinh cuộn thừa).
    // Chỉ khung ngoài được cuộn, và chỉ khi nội dung thật sự cao hơn màn hình (VD điện thoại xoay ngang).
    <div className="relative flex h-dvh w-full overflow-x-hidden overflow-y-auto bg-[#0b1120] font-sans text-slate-100 selection:bg-emerald-500 selection:text-white lg:overflow-hidden">
      {/* Cột trái (laptop / desktop): ảnh nền tối + thương hiệu, tối giản */}
      <div className="relative hidden h-full flex-col justify-between overflow-hidden p-10 lg:flex lg:w-7/12 xl:w-3/5 xl:p-14">
        <div className="absolute inset-0 z-0">
          <Image
            src="/images/login-hero.jpg"
            alt="Nhà máy công nghiệp"
            fill
            priority
            sizes="60vw"
            className="object-cover object-center"
          />
          {/* Phủ tối đậm để ảnh chỉ còn là nền, không tranh chú ý với nội dung */}
          <div className="absolute inset-0 bg-[#070b14]/85" />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#0b1120]" />
        </div>

        <BrandMark />

        <div className="relative z-10 max-w-lg">
          <h2 className="text-3xl font-bold leading-tight tracking-tight text-white xl:text-4xl">
            Quản lý năng lượng
            <br />
            <span className="text-emerald-400">và phát thải carbon</span>
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-slate-400 xl:text-base">
            Giám sát điện năng thời gian thực, chi phí và kiểm kê khí nhà kính cho doanh nghiệp.
          </p>
        </div>

        <p className="relative z-10 text-xs text-slate-500">© 2026 DTS</p>
      </div>

      {/* Cột phải: form đăng nhập */}
      <div className="relative flex min-h-full flex-1 flex-col justify-center px-6 py-10 sm:px-10 lg:px-12 xl:px-16">
        {/* Đốm sáng nền: bọc trong lớp overflow-hidden để không bao giờ làm tràn màn hình */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="absolute -top-32 right-0 h-72 w-72 rounded-full bg-emerald-500/10 blur-[110px]" />
          <div className="absolute -bottom-32 left-0 h-72 w-72 rounded-full bg-cyan-500/10 blur-[110px]" />
        </div>

        <div className="relative mx-auto w-full max-w-sm">
          {/* Logo trên điện thoại / máy tính bảng (cột trái bị ẩn) */}
          <div className="mb-8 lg:hidden">
            <BrandMark />
          </div>

          {/* Heading */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Đăng nhập hệ thống
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              {project
                ? `Giám sát dữ liệu vận hành dự án: ${project.name}`
                : "Đăng nhập để tiếp tục vào hệ thống."}
            </p>
          </div>

          {/* Project Context Badge if applicable */}
          {project && (
            <div className="mb-5 flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-300">
              <div className="flex items-center gap-2">
                <BuildingIcon className="h-4 w-4 text-emerald-400 shrink-0" />
                <span className="font-medium truncate">{project.name}</span>
              </div>
              <span className="shrink-0 rounded bg-emerald-900/60 px-2 py-0.5 font-mono text-[10px] text-emerald-200">
                {project.id}
              </span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Identifier Input */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Tài khoản hoặc Email
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                  <UserIcon className="h-4 w-4" />
                </div>
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    setError("");
                  }}
                  placeholder="Nhập tên đăng nhập hoặc email..."
                  className="w-full rounded-xl border border-slate-700/80 bg-slate-900/90 py-3 pl-10 pr-4 text-base sm:text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-400/20 transition-all"
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Mật khẩu
                </label>
                <a
                  href="#support"
                  onClick={(e) => {
                    e.preventDefault();
                    alert("Vui lòng liên hệ quản trị viên IT hoặc Hotline hỗ trợ 1900-xxxx để đặt lại mật khẩu.");
                  }}
                  className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  Quên mật khẩu?
                </a>
              </div>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                  <LockIcon className="h-4 w-4" />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                  placeholder="Nhập mật khẩu truy cập"
                  className="w-full rounded-xl border border-slate-700/80 bg-slate-900/90 py-3 pl-10 pr-11 text-base sm:text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-400/20 transition-all"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 hover:text-slate-200 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOffIcon className="h-4 w-4" />
                  ) : (
                    <EyeIcon className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Remember Me Checkbox */}
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500/20 focus:ring-offset-0"
                />
                <span className="text-xs text-slate-300">Ghi nhớ phiên đăng nhập này</span>
              </label>
            </div>

            {/* Error Message Alert */}
            {error && (
              <div className="flex items-center gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 animate-fadeIn">
                <AlertCircleIcon className="h-4 w-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting}
              className="group relative flex h-12 w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 p-px font-medium text-white shadow-lg shadow-emerald-950/50 hover:shadow-emerald-900/80 active:scale-[0.99] disabled:opacity-60 transition-all duration-200 mt-2 cursor-pointer"
            >
              <span className="flex h-full w-full items-center justify-center rounded-[11px] bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-6 text-sm font-semibold transition-all group-hover:bg-opacity-90">
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <SpinnerIcon className="h-4 w-4 animate-spin text-white" />
                    Đang xác thực bảo mật...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Đăng nhập hệ thống
                    <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                )}
              </span>
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}

/** Logo + tên sản phẩm (cột trái trên desktop, đầu form trên điện thoại). */
function BrandMark() {
  return (
    <div className="relative z-10 flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-400 p-0.5">
        <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-[#090d16]">
          <EnergyLogoIcon className="h-5 w-5 text-emerald-400" />
        </div>
      </div>
      <div>
        <p className="text-lg font-bold leading-tight tracking-tight text-white">DTS</p>
        <p className="text-xs text-slate-400">Energy &amp; Carbon Platform</p>
      </div>
    </div>
  );
}

// ---------------- SVG Icons ----------------

function EnergyLogoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function AlertCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="16" height="20" x="4" y="2" rx="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" strokeWidth="2.5" />
    </svg>
  );
}
