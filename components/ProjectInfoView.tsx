"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { MeterTypeIcon } from "@/components/AddProjectForm";
import { useAuth } from "@/components/auth/useAuth";
import { hasPermission } from "@/lib/permissions";
import { resolveMeterTypes, type Project, type ProjectStatus } from "@/lib/projects";
import { hydrateMeterTypeDefs, loadMeterTypeDefs, type MeterTypeDef } from "@/lib/meter-types";
import { loadProjectManagers, managerDisplayName, type ProjectManagerState } from "@/lib/project-managers";

const STATUS_LABEL: Record<ProjectStatus, { label: string; className: string }> = {
  active: { label: "Hoạt động", className: "bg-emerald-50 text-emerald-700" },
  maintenance: { label: "Bảo trì", className: "bg-amber-50 text-amber-700" },
  paused: { label: "Tạm dừng", className: "bg-slate-100 text-slate-600" },
};

function formatDate(value?: string) {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

export function ProjectInfoView({ project }: { project: Project }) {
  const { session } = useAuth();
  const canEdit = hasPermission(session, "manageProjects");
  const [managerState, setManagerState] = useState<ProjectManagerState | null>(null);
  const [meterCatalog, setMeterCatalog] = useState<MeterTypeDef[]>(loadMeterTypeDefs);
  const adminUserId = session?.portal === "admin" ? session.userId : null;

  useEffect(() => {
    void hydrateMeterTypeDefs().then(setMeterCatalog);
  }, []);

  useEffect(() => {
    if (!adminUserId) return;
    let active = true;
    loadProjectManagers(project.id)
      .then((state) => {
        if (active) setManagerState(state);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [adminUserId, project.id]);

  const currentManager = managerState?.accounts.find((item) => item.id === managerState.currentId) ?? null;
  const pendingManager = managerState?.pending
    ? managerState.accounts.find((item) => item.id === managerState.pending?.accountId) ?? null
    : null;
  const managerName = currentManager ? managerDisplayName(currentManager) : project.contactName || "";
  const email = currentManager?.email || project.email || "";
  const phone = currentManager?.phone || project.phone || "";
  const status = STATUS_LABEL[project.status] ?? STATUS_LABEL.active;
  const meterTypes = resolveMeterTypes(project);
  const recipients = (project.recipients ?? []).filter((item) => item.name || item.email || item.phone);
  const history = managerState?.history ?? [];

  return (
    <div className="mx-auto max-w-[980px] p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Thông tin dự án</h1>
        {canEdit ? (
          <Link
            href={`/sua-du-an/${encodeURIComponent(project.id)}/chinh-sua`}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700"
          >
            <EditIcon className="h-4 w-4" />
            Sửa
          </Link>
        ) : null}
      </div>

      <div className="space-y-5">
        <Card title="Thông tin khách hàng">
          <div className="mb-5 flex items-center gap-4">
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl text-lg font-bold text-white shadow-xs"
              style={{ backgroundColor: project.accent || "#059669" }}
            >
              {project.logoUrl ? (
                <img src={project.logoUrl} alt={`Logo ${project.name}`} className="h-full w-full bg-white object-contain" />
              ) : (
                project.initials
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-slate-900">{project.name}</p>
              <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.className}`}>
                {status.label}
              </span>
            </div>
          </div>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Item label="MÃ DỰ ÁN" value={project.id} />
            <Item label="TÊN DỰ ÁN" value={project.name} />
            <Item
              label="NGƯỜI QUẢN LÝ DỰ ÁN"
              value={managerName}
              extra={
                managerState?.pending ? (
                  <span className="mt-1 block text-xs text-amber-700">
                    Hẹn chuyển giao cho {pendingManager ? managerDisplayName(pendingManager) : "người quản lý mới"} từ{" "}
                    {formatDate(managerState.pending.startDate)}
                  </span>
                ) : null
              }
            />
            <Item label="NGÀY BẮT ĐẦU" value={formatDate(project.startDate)} />
            <Item label="EMAIL" value={email} />
            <Item label="SỐ ĐIỆN THOẠI" value={phone} />
            <div className="sm:col-span-2">
              <Item label="ĐỊA CHỈ" value={project.address} />
            </div>
          </dl>
        </Card>

        {managerState ? (
          <Card title="Lịch sử người quản lý dự án">
            {managerState.pending || history.length ? (
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-2.5">Người quản lý</th>
                      <th className="px-4 py-2.5">Từ ngày</th>
                      <th className="px-4 py-2.5">Đến ngày</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {managerState.pending ? (
                      <tr className="bg-amber-50/50">
                        <td className="px-4 py-2.5 font-semibold text-slate-800">
                          {pendingManager ? managerDisplayName(pendingManager) : "Chưa giao người quản lý"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">{formatDate(managerState.pending.startDate)}</td>
                        <td className="px-4 py-2.5">
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                            Đã hẹn chuyển giao
                          </span>
                        </td>
                      </tr>
                    ) : null}
                    {history.map((item, index) => (
                      <tr key={`${item.accountId ?? "none"}-${item.startDate}-${index}`}>
                        <td className="px-4 py-2.5 font-semibold text-slate-800">{item.managerName || "—"}</td>
                        <td className="px-4 py-2.5 text-slate-700">{item.startDate ? formatDate(item.startDate) : "Không rõ"}</td>
                        <td className="px-4 py-2.5">
                          {item.endDate ? (
                            <span className="text-slate-700">{formatDate(item.endDate)}</span>
                          ) : (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                              Đang quản lý
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Chưa có lịch sử người quản lý.</p>
            )}
          </Card>
        ) : null}

        <Card title="Loại điểm đo">
          {meterTypes.length ? (
            <div className="flex flex-wrap gap-2">
              {meterTypes.map((type) => {
                const def = meterCatalog.find((item) => item.name === type);
                return (
                  <span
                    key={type}
                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-sm font-semibold text-emerald-800"
                  >
                    {def ? <MeterTypeIcon type={def.icon} className="h-4 w-4" /> : null}
                    {type}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Chưa chọn loại điểm đo.</p>
          )}
        </Card>

        <Card title="Người nhận thông báo cảnh báo">
          {recipients.length ? (
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-2.5">Họ tên</th>
                    <th className="px-4 py-2.5">Email</th>
                    <th className="px-4 py-2.5">Số điện thoại</th>
                    <th className="px-4 py-2.5">Kênh nhận</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recipients.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-2.5 font-semibold text-slate-800">{item.name || "—"}</td>
                      <td className="px-4 py-2.5 text-slate-700">{item.email || "—"}</td>
                      <td className="px-4 py-2.5 text-slate-700">{item.phone || "—"}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {(item.channels ?? []).length ? (
                            (item.channels ?? []).map((channel) => (
                              <span
                                key={channel}
                                className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600"
                              >
                                {channel}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-slate-400">Chưa chọn kênh</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-400">Chưa có người nhận thông báo.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] lg:p-8">
      <h2 className="mb-5 text-[15px] font-semibold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}

function Item({ label, value, extra }: { label: string; value?: string; extra?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-slate-800">
        {value || <span className="text-slate-400">—</span>}
        {extra}
      </dd>
    </div>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
