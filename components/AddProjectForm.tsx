"use client";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CustomSelect } from "@/components/ui/CustomSelect";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  hydrateProjects,
  nextProjectId,
  projectAccent,
  projectInitials,
  resolveMeterTypes,
  upsertProject,
  ALERT_CHANNELS,
  type AlertRecipient,
  type MeterType,
  type Project,
  type ProjectStatus,
} from "@/lib/projects";
import { ensureCustomerAccount } from "@/lib/customer-accounts";
import { useAuth } from "@/components/auth/useAuth";
import { hasPermission } from "@/lib/permissions";
import {
  loadProjectManagers,
  managerDisplayName,
  saveProjectManager,
  type ProjectManagerState,
} from "@/lib/project-managers";
import {
  loadMeterTypeDefs,
  hydrateMeterTypeDefs,
  type MeterTypeDef,
  type MeterTypeIconId,
} from "@/lib/meter-types";

function nextRecipient(): AlertRecipient {
  return {
    id: `rcpt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    email: "",
    phone: "",
    channels: ["Email"],
  };
}

/** Thông tin bắt buộc của từng kênh: Email → email, SMS → SĐT, Telegram → Chat ID, Zalo → Zalo user ID. */
function missingChannelInfo(item: AlertRecipient) {
  const channels = item.channels ?? [];
  if (channels.includes("Email") && !item.email) return "kênh Email cần email";
  if (channels.includes("SMS") && !item.phone) return "kênh SMS cần số điện thoại";
  if (channels.includes("Telegram") && !item.telegramChatId?.trim()) return "kênh Telegram cần Chat ID";
  if (channels.includes("Zalo") && !item.zaloUserId?.trim()) return "kênh Zalo cần Zalo user ID";
  return "";
}

function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function formatIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function toInputDate(value?: string) {
  if (!value) return todayIso();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : todayIso();
}

export function AddProjectForm({ initialProject }: { initialProject?: Project }) {
  const router = useRouter();

  const [code, setCode] = useState(() => initialProject?.id ?? nextProjectId());
  const [name, setName] = useState(() => initialProject?.name ?? "");
  // Tên khách hàng tự theo tên dự án; thông tin liên hệ tự theo người quản lý dự án (server đồng bộ).
  const legacyContact = {
    name: initialProject?.contactName ?? "",
    email: initialProject?.email ?? "",
    phone: initialProject?.phone ?? "",
  };
  const [address, setAddress] = useState(() => initialProject?.address ?? "");
  const [logoUrl, setLogoUrl] = useState(() => initialProject?.logoUrl ?? "");
  const [startDate, setStartDate] = useState(() => toInputDate(initialProject?.startDate));
  const [status, setStatus] = useState<ProjectStatus>(() => initialProject?.status ?? "active");
  const [meterTypes, setMeterTypes] = useState<MeterType[]>(() =>
    initialProject ? resolveMeterTypes(initialProject) : ["Điện"],
  );
  const [meterCatalog, setMeterCatalog] = useState<MeterTypeDef[]>(loadMeterTypeDefs);
  const [recipients, setRecipients] = useState<AlertRecipient[]>(() =>
    initialProject?.recipients?.length
      ? initialProject.recipients
      : [nextRecipient()],
  );
  const [error, setError] = useState("");
  const [recipientToDelete, setRecipientToDelete] = useState<AlertRecipient | null>(null);
  const { session } = useAuth();
  const canAssignManagers = hasPermission(session, "manageUsers");
  const [managerState, setManagerState] = useState<ProjectManagerState | null>(null);
  const [managerId, setManagerId] = useState("");
  const [managersError, setManagersError] = useState("");
  const editingProjectId = initialProject?.id;

  const adminUserId = session?.portal === "admin" ? session.userId : null;

  useEffect(() => {
    // Phụ thuộc theo userId (không theo object session) để không nạp lại và xoá lựa chọn đang sửa.
    if (!adminUserId) return;
    // Dự án mới chưa có mã trong DB: chỉ cần danh sách tài khoản Manage, chưa ai được giao.
    const projectId = editingProjectId ?? "__new__";
    let active = true;
    loadProjectManagers(projectId)
      .then((state) => {
        if (!active) return;
        setManagerState(state);
        setManagerId(state.pending?.accountId ?? state.currentId ?? "");
      })
      .catch((err) => {
        if (active) setManagersError(err instanceof Error ? err.message : "Không tải được danh sách người phụ trách.");
      });
    return () => {
      active = false;
    };
  }, [adminUserId, editingProjectId]);

  const selectedManager = managerState?.accounts.find((item) => item.id === managerId) ?? null;
  const currentManager = managerState?.accounts.find((item) => item.id === managerState.currentId) ?? null;
  const pendingManager = managerState?.pending
    ? managerState.accounts.find((item) => item.id === managerState.pending?.accountId) ?? null
    : null;
  const handoverInFuture = Boolean(managerState) && managerId !== (managerState?.currentId ?? "") && startDate > todayIso();

  function handleLogoChange(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Logo phải là một tệp hình ảnh.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Logo không được vượt quá 2 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setLogoUrl(reader.result);
        setError("");
      }
    };
    reader.onerror = () => setError("Không thể đọc tệp logo.");
    reader.readAsDataURL(file);
  }

  useEffect(() => {
    void Promise.all([hydrateProjects(), hydrateMeterTypeDefs()]).then(([projects, meterTypes]) => {
      if (!initialProject) setCode(nextProjectId(projects));
      setMeterCatalog(meterTypes);
    });
  }, []);

  function toggleMeter(type: MeterType) {
    setMeterTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }

  function updateRecipient(id: string, patch: Partial<AlertRecipient>) {
    setRecipients((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function handleSubmit() {
    const projectName = name.trim();
    const customerName = projectName;
    const projectCode = (initialProject?.id ?? code.trim().toUpperCase()) || nextProjectId();

    if (!projectName) {
      setError("Vui lòng nhập tên dự án.");
      return;
    }
    if (meterTypes.length === 0) {
      setError("Chọn ít nhất một loại điểm đo.");
      return;
    }

    const cleanedRecipients = recipients
      .map((item) => ({
        ...item,
        name: item.name.trim(),
        email: item.email.trim(),
        phone: item.phone.trim(),
      }))
      .filter((item) => item.name || item.email || item.phone);

    const invalid = cleanedRecipients.find(
      (item) => item.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email),
    );
    if (invalid) {
      setError("Email người nhận cảnh báo không hợp lệ.");
      return;
    }
    const missingInfo = cleanedRecipients.find((item) => missingChannelInfo(item));
    if (missingInfo) {
      setError(
        `Người nhận "${missingInfo.name || missingInfo.email || missingInfo.phone}": ${missingChannelInfo(missingInfo)}.`,
      );
      return;
    }

    try {
      await hydrateProjects();
      await upsertProject({
        id: projectCode,
        name: projectName,
        customer: customerName,
        initials: projectInitials(customerName || projectName),
        accent: initialProject?.accent ?? projectAccent(projectCode),
        logoUrl: logoUrl || undefined,
        status,
        startDate,
        contactName: legacyContact.name,
        phone: legacyContact.phone,
        email: legacyContact.email,
        address: address.trim(),
        meterTypes,
        recipients: cleanedRecipients,
      });
      if (!initialProject) ensureCustomerAccount({ id: projectCode, customer: customerName });
      if (
        canAssignManagers &&
        managerState &&
        (managerId !== (managerState.currentId ?? "") || managerState.pending)
      ) {
        await saveProjectManager(projectCode, managerId || null, startDate);
      }
      if (initialProject) {
        router.push(`/sua-du-an/${encodeURIComponent(initialProject.id)}`);
        router.refresh();
      } else {
        router.push("/");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể lưu dự án vào database.");
    }
  }

  return (
    <div className="mx-auto max-w-[980px] p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {initialProject ? "Sửa thông tin dự án" : "Tạo dự án mới"}
        </h1>
      </div>

      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] lg:p-8">
          <div className="mb-6">
            <h2 className="text-[15px] font-semibold text-slate-800">Thông tin khách hàng</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="MÃ DỰ ÁN">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="VD: PRJ-2443"
                className="input"
                readOnly={Boolean(initialProject)}
                required
              />
            </Field>
            <Field label="TÊN DỰ ÁN">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Công ty TNHH ABC"
                className="input"
                required
              />
            </Field>
            <Field label="NGƯỜI QUẢN LÝ DỰ ÁN">
              <div className="relative">
                <CustomSelect
                  value={managerId}
                  onChange={(e) => setManagerId(e.target.value)}
                  className="input appearance-none pr-9"
                  disabled={!canAssignManagers || !managerState}
                >
                  <option value="">{managerState ? "Chưa giao người quản lý" : "Đang tải…"}</option>
                  {(managerState?.accounts ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {managerDisplayName(item)}
                      {item.fullName ? ` (${item.username})` : ""}
                    </option>
                  ))}
                </CustomSelect>
                <ChevronIcon className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
              {managersError ? <p className="mt-1.5 text-xs text-red-500">{managersError}</p> : null}
              {managerState && managerState.accounts.length === 0 && canAssignManagers ? (
                <p className="mt-1.5 text-xs text-slate-500">
                  Chưa có tài khoản Manage nào.{" "}
                  <Link href="/tai-khoan/them-moi" className="font-semibold text-emerald-700 hover:underline">
                    Thêm tài khoản
                  </Link>
                </p>
              ) : null}
              {handoverInFuture ? (
                <p className="mt-1.5 text-xs text-amber-700">
                  Chuyển giao từ {formatIsoDate(startDate)}
                  {currentManager ? `, ${managerDisplayName(currentManager)} quản lý tới ngày đó.` : "."}
                </p>
              ) : managerState?.pending && managerId === managerState.pending.accountId ? (
                <p className="mt-1.5 text-xs text-amber-700">
                  Đã hẹn chuyển giao cho {pendingManager ? managerDisplayName(pendingManager) : "người quản lý mới"} từ{" "}
                  {formatIsoDate(managerState.pending.startDate)}
                  {currentManager ? ` (hiện tại: ${managerDisplayName(currentManager)})` : ""}.
                </p>
              ) : null}
            </Field>
            <Field label="NGÀY BẮT ĐẦU">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input"
                required
              />
            </Field>
            <Field label="EMAIL">
              <input
                value={selectedManager ? selectedManager.email : legacyContact.email}
                readOnly
                placeholder="Tự lấy theo người quản lý"
                className="input bg-slate-50 text-slate-600"
              />
            </Field>
            <Field label="SỐ ĐIỆN THOẠI">
              <input
                value={selectedManager ? selectedManager.phone : legacyContact.phone}
                readOnly
                placeholder="Tự lấy theo người quản lý"
                className="input bg-slate-50 text-slate-600"
              />
            </Field>
            <Field label="TRẠNG THÁI">
              <div className="relative">
                <CustomSelect
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                  className="input appearance-none pr-9"
                >
                  <option value="active">Hoạt động</option>
                  <option value="maintenance">Bảo trì</option>
                  <option value="paused">Tạm dừng</option>
                </CustomSelect>
                <ChevronIcon className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </Field>
          </div>

          <div className="mt-4">
            <Field label="ĐỊA CHỈ">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Địa chỉ nhà máy / văn phòng khách hàng"
                className="input"
              />
            </Field>
          </div>

          <div className="mt-4">
            <Field label="LOGO CÔNG TY">
              <div className="flex flex-wrap items-center gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
                <div
                  className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl text-lg font-bold text-white shadow-xs"
                  style={{ backgroundColor: initialProject?.accent ?? "#059669" }}
                >
                  {logoUrl ? (
                    <img src={logoUrl} alt={`Logo ${name || "công ty"}`} className="h-full w-full object-contain bg-white" />
                  ) : (
                    projectInitials(name)
                  )}
                </div>
                <div className="min-w-[220px] flex-1">
                  <label className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    Chọn logo công ty
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(event) => {
                        handleLogoChange(event.target.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <p className="mt-1.5 text-xs text-slate-400">PNG, JPG hoặc SVG · tối đa 2 MB</p>
                  {logoUrl ? (
                    <button
                      type="button"
                      onClick={() => setLogoUrl("")}
                      className="mt-1 text-xs font-semibold text-red-500 hover:underline"
                    >
                      Xóa logo, dùng chữ viết tắt
                    </button>
                  ) : null}
                </div>
              </div>
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] lg:p-8">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-slate-800">Loại điểm đo</h2>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {meterCatalog.map((item) => {
              const active = meterTypes.includes(item.name);
              return (
                <div
                  key={item.name}
                  className={`flex items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors ${
                    active
                      ? "border-emerald-600 bg-emerald-50/70 ring-1 ring-emerald-500/20"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleMeter(item.name)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  >
                    <span
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        active ? "bg-emerald-600 text-white shadow-xs" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      <MeterTypeIcon type={item.icon} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-800">{item.name}</span>
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
                            active ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white"
                          }`}
                        >
                          {active ? <CheckIcon className="h-3 w-3" /> : null}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">{item.description}</span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] lg:p-8">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-slate-800">Người nhận thông báo cảnh báo</h2>
            </div>
            <button
              type="button"
              onClick={() => setRecipients((current) => [...current, nextRecipient()])}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors shadow-xs"
            >
              <span className="text-lg leading-none text-emerald-600">+</span>
              Thêm người nhận
            </button>
          </div>

          <div className="space-y-3">
            {recipients.map((item, index) => (
              <div
                key={item.id}
                className="grid gap-3 rounded-xl border border-slate-100 bg-[#f8fafc] p-4 sm:grid-cols-[1fr_1fr_1fr_auto]"
              >
                <Field label={index === 0 ? "HỌ TÊN" : undefined}>
                  <input
                    value={item.name}
                    onChange={(e) => updateRecipient(item.id, { name: e.target.value })}
                    placeholder="Nguyễn Văn A"
                    className="input"
                  />
                </Field>
                <Field label={index === 0 ? "EMAIL" : undefined}>
                  <input
                    type="email"
                    value={item.email}
                    onChange={(e) => updateRecipient(item.id, { email: e.target.value })}
                    placeholder="alert@company.com"
                    className="input"
                  />
                </Field>
                <Field label={index === 0 ? "SỐ ĐIỆN THOẠI" : undefined}>
                  <input
                    type="tel"
                    value={item.phone}
                    onChange={(e) => updateRecipient(item.id, { phone: e.target.value })}
                    placeholder="0901 234 567"
                    className="input"
                  />
                </Field>
                <div className={index === 0 ? "flex items-end" : "flex items-center"}>
                  <button
                    type="button"
                    onClick={() =>
                      setRecipients((current) =>
                        current.length === 1 ? [nextRecipient()] : current.filter((row) => row.id !== item.id),
                      )
                    }
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                    aria-label="Xóa người nhận"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
                  <span className="text-[11px] font-semibold tracking-wide text-slate-500">KÊNH NHẬN</span>
                  {ALERT_CHANNELS.map((channel) => {
                    const checked = (item.channels ?? []).includes(channel);
                    return (
                      <button
                        key={channel}
                        type="button"
                        aria-pressed={checked}
                        onClick={() =>
                          updateRecipient(item.id, {
                            channels: checked
                              ? (item.channels ?? []).filter((value) => value !== channel)
                              : [...(item.channels ?? []), channel],
                          })
                        }
                        className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                          checked
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        <span
                          className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
                            checked ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white"
                          }`}
                        >
                          {checked ? <CheckIcon className="h-2.5 w-2.5" /> : null}
                        </span>
                        {channel}
                      </button>
                    );
                  })}
                </div>
                {(item.channels ?? []).includes("Telegram") || (item.channels ?? []).includes("Zalo") ? (
                  <div className="grid gap-3 sm:col-span-4 sm:grid-cols-2">
                    {(item.channels ?? []).includes("Telegram") ? (
                      <Field label="TELEGRAM CHAT ID">
                        <input
                          value={item.telegramChatId ?? ""}
                          onChange={(e) => updateRecipient(item.id, { telegramChatId: e.target.value })}
                          placeholder="Lấy ở Cấu hình thông báo → Lấy Chat ID"
                          className="input"
                        />
                      </Field>
                    ) : null}
                    {(item.channels ?? []).includes("Zalo") ? (
                      <Field label="MÃ NGƯỜI DÙNG ZALO (USER ID)">
                        <input
                          value={item.zaloUserId ?? ""}
                          onChange={(e) => updateRecipient(item.id, { zaloUserId: e.target.value })}
                          placeholder="User ID của người đã quan tâm Zalo OA"
                          className="input"
                        />
                      </Field>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        {error ? <p className="text-sm font-medium text-red-500">{error}</p> : null}

        <div className="flex flex-wrap justify-end gap-3">
          <Link
            href={initialProject ? `/sua-du-an/${encodeURIComponent(initialProject.id)}` : "/"}
            className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors shadow-xs"
          >
            Hủy
          </Link>
          <button
            type="submit"
            className="h-10 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors"
          >
            {initialProject ? "Lưu thay đổi" : "Tạo dự án"}
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={Boolean(recipientToDelete)}
        title="Xác nhận xóa người nhận"
        description={`Bạn có chắc chắn muốn xóa người nhận thông báo "${recipientToDelete?.name || "này"}" không?`}
        confirmText="Xác nhận xóa"
        onConfirm={() => {
          if (recipientToDelete) {
            setRecipients((current) =>
              current.length === 1 ? [nextRecipient()] : current.filter((row) => row.id !== recipientToDelete.id)
            );
            setRecipientToDelete(null);
          }
        }}
        onCancel={() => setRecipientToDelete(null)}
      />
    </div>
  );
}

function Field({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <label className="block">
      {label ? (
        <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500">{label}</span>
      ) : null}
      {children}
    </label>
  );
}

export function MeterTypeIcon({
  type,
  className,
}: {
  type: MeterTypeIconId;
  className?: string;
}) {
  if (type === "drop") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 3s6 7 6 11a6 6 0 1 1-12 0c0-4 6-11 6-11Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (type === "thermo") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M10 14.5V6.5a2 2 0 1 1 4 0v8a3.5 3.5 0 1 1-4 0Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 9v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "steam") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M5 17h14M7 14h10M9 11h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M8 8c0-2 1.5-3.5 4-3.5S16 6 16 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "air") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M4 9h11a3 3 0 1 0 0-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M4 13h14a3 3 0 1 1 0 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M4 17h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "generic") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 8v4l2.5 1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M13 2 4.5 13.5h6.2L9.2 22 19.5 10h-6.2L13 2Z" />
    </svg>
  );
}


function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12.5 10 17.5 19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}
